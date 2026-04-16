document.addEventListener('DOMContentLoaded', () => {
    // --- Constants and Configuration ---
    const STORAGE_KEYS = {
        ACTIVE_PROVIDER: 'activeProvider',
        PROVIDER_CONFIGS: 'providerConfigs',
        RECENT_CHECKS: 'recentChecks',
        CUSTOM_RULES: 'customRules'  // synced storage
    };
    const DEFAULT_PROVIDER = 'zhipu';
    
    const PROVIDER_PRESETS = {
        zhipu: { models: ['glm-5.1', 'glm-5', 'glm-4-flash', 'glm-4.7'], defaultModel: 'glm-5.1' },
        deepseek: { models: ['deepseek-chat', 'deepseek-reasoner'], defaultModel: 'deepseek-chat' },
        qwen: { models: ['qwen-max', 'qwen-plus', 'qwen-turbo'], defaultModel: 'qwen-max' },
        gemini: { models: ['gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview'], defaultModel: 'gemini-3.1-pro-preview' },
        custom: { models: [], defaultModel: '' }
    };
    const MAX_RECENT_CHECKS = 5;

    // --- UI Element References ---
    const views = {
        unconfigured: document.getElementById('unconfigured-view'),
        idle: document.getElementById('idle-view'),
        inProgress: document.getElementById('in-progress-view'),
        results: document.getElementById('results-view'),
        settings: document.getElementById('settings-view')
    };
    const buttons = {
        startCheck: document.getElementById('start-check'),
        goToSettings: document.getElementById('go-to-settings-btn'),
        goToSettingsFromUnconfigured: document.getElementById('go-to-settings-from-unconfigured-btn'),
        importFromUnconfigured: document.getElementById('import-btn-unconfigured'),
        backToIdle: document.getElementById('back-to-idle'),
        backToIdleFromSettings: document.getElementById('back-to-idle-from-settings'),
        cancelCheck: document.getElementById('cancel-check'),
        exportCsv: document.getElementById('export-csv-button'),
        openPage: document.getElementById('open-page-button'),
        saveSettings: document.getElementById('save-settings-btn'),
        testConnection: document.getElementById('test-connection-btn')
    };
    const settingsForm = {
        providerSelect: document.getElementById('provider-select'),
        baseUrlContainer: document.getElementById('base-url-container'),
        baseUrlInput: document.getElementById('base-url'),
        modelIdInput: document.getElementById('model-id'),
        modelSuggestions: document.getElementById('model-suggestions'),
        apiKeyInput: document.getElementById('api-key'),
        statusMessage: document.getElementById('status-message')
    };
    const recentChecksContainer = document.getElementById('recent-checks-container');
    const progressSteps = { extract: document.getElementById('step-extract'), preprocess: document.getElementById('step-preprocess'), analyze: document.getElementById('step-analyze'), report: document.getElementById('step-report') };
    const resultsSummary = document.getElementById('results-summary');
    const resultsFilterContainer = document.getElementById('results-filter-container');
    const resultsList = document.getElementById('results-list');

    // Custom Rules UI
    const rulesList = document.getElementById('rules-list');
    const addRuleBtn = document.getElementById('add-rule-btn');
    const ruleModal = document.getElementById('rule-modal');
    const modalTitle = document.getElementById('modal-title');
    const ruleNameInput = document.getElementById('rule-name');
    const rulePromptInput = document.getElementById('rule-prompt');
    const ruleEnabledInput = document.getElementById('rule-enabled');
    const ruleEditIdInput = document.getElementById('rule-edit-id');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const cancelRuleBtn = document.getElementById('cancel-rule-btn');
    const saveRuleBtn = document.getElementById('save-rule-btn');

    // Backup UI
    const exportBtn = document.getElementById('export-btn');
    const importBtn = document.getElementById('import-btn');
    const importFileInput = document.getElementById('import-file-input');
    const backupStatus = document.getElementById('backup-status');

    // --- State Variables ---
    let isCheckCancelled = false;
    let allIssues = [];
    let activeFilters = { severity: '全部', type: '全部' };
    let currentView = null;
    let currentReportTimestamp = null;
    let currentReportUrl = null;
    let customRules = [];  // Custom check rules (synced)

    // --- Helper Functions ---
    // --- Initialization ---
    async function initialize() {
        const result = await chrome.storage.sync.get([STORAGE_KEYS.ACTIVE_PROVIDER, STORAGE_KEYS.PROVIDER_CONFIGS]);
        const providerConfigs = result[STORAGE_KEYS.PROVIDER_CONFIGS] || {};
        const activeProvider = result[STORAGE_KEYS.ACTIVE_PROVIDER] || DEFAULT_PROVIDER;
        const localResult = await chrome.storage.local.get([STORAGE_KEYS.RECENT_CHECKS]);
        const recentChecks = localResult[STORAGE_KEYS.RECENT_CHECKS] || [];

        settingsForm.providerSelect.value = activeProvider;
        updateSettingsForm(activeProvider, providerConfigs);

        // Load custom rules from synced storage
        const rulesResult = await chrome.storage.sync.get([STORAGE_KEYS.CUSTOM_RULES]);
        customRules = rulesResult[STORAGE_KEYS.CUSTOM_RULES] || [];
        renderRulesList();

        const currentConfig = providerConfigs[activeProvider];
        if (currentConfig && currentConfig.apiKey && currentConfig.modelId) {
            showView('idle');
            renderRecentChecks(recentChecks);
        } else {
            showView('unconfigured');
        }
    }

    // --- Event Listeners ---
    function addEventListeners() {
        buttons.startCheck.addEventListener('click', startCheck);
        buttons.goToSettings.addEventListener('click', () => showView('settings'));
        buttons.goToSettingsFromUnconfigured.addEventListener('click', () => showView('settings'));
        buttons.importFromUnconfigured.addEventListener('click', () => importFileInput.click());
        buttons.backToIdle.addEventListener('click', () => showView('idle'));
        buttons.backToIdleFromSettings.addEventListener('click', handleBackFromSettings);
        buttons.cancelCheck.addEventListener('click', () => { isCheckCancelled = true; showView('idle'); });
        buttons.exportCsv.addEventListener('click', () => downloadCSV(allIssues));
        buttons.openPage.addEventListener('click', () => {
            if (currentReportUrl) chrome.tabs.create({ url: currentReportUrl });
        });
        buttons.saveSettings.addEventListener('click', saveApiKey);
        buttons.testConnection.addEventListener('click', testConnection);
        settingsForm.providerSelect.addEventListener('change', handleProviderChange);

        // Custom rules event listeners
        addRuleBtn.addEventListener('click', () => openRuleModal());
        closeModalBtn.addEventListener('click', closeRuleModal);
        cancelRuleBtn.addEventListener('click', closeRuleModal);
        saveRuleBtn.addEventListener('click', handleSaveRule);
        ruleModal.addEventListener('click', (e) => {
            if (e.target === ruleModal) closeRuleModal();
        });

        // Backup event listeners
        exportBtn.addEventListener('click', handleExport);
        importBtn.addEventListener('click', () => importFileInput.click());
        importFileInput.addEventListener('change', handleImport);
    }

    // --- Core Functions ---

    async function handleProviderChange() {
        const selectedProvider = settingsForm.providerSelect.value;
        const result = await chrome.storage.sync.get([STORAGE_KEYS.PROVIDER_CONFIGS]);
        const providerConfigs = result[STORAGE_KEYS.PROVIDER_CONFIGS] || {};
        
        updateSettingsForm(selectedProvider, providerConfigs);
    }

    function updateSettingsForm(provider, providerConfigs) {
        const config = providerConfigs[provider] || {};
        const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom;
        
        // Show/hide baseUrl for custom
        if (provider === 'custom') {
            settingsForm.baseUrlContainer.style.display = 'block';
            settingsForm.baseUrlInput.value = config.baseUrl || 'https://api.openai.com/v1/chat/completions';
        } else {
            settingsForm.baseUrlContainer.style.display = 'none';
        }

        // Fill Datalist
        settingsForm.modelSuggestions.innerHTML = '';
        preset.models.forEach(m => {
            const option = document.createElement('option');
            option.value = m;
            settingsForm.modelSuggestions.appendChild(option);
        });

        settingsForm.modelIdInput.value = config.modelId || preset.defaultModel;
        settingsForm.apiKeyInput.value = config.apiKey || '';
        settingsForm.apiKeyInput.placeholder = `请输入 ${provider} 的 API Key`;
    }

    async function saveApiKey() {
        const selectedProvider = settingsForm.providerSelect.value;
        const newApiKey = settingsForm.apiKeyInput.value.trim();
        const newModelId = settingsForm.modelIdInput.value.trim();
        const newBaseUrl = settingsForm.baseUrlInput.value.trim();

        if (!newApiKey || !newModelId) {
            showStatusMessage('API Key 和 模型ID 不能为空。', 'error');
            return;
        }

        try {
            const result = await chrome.storage.sync.get([STORAGE_KEYS.PROVIDER_CONFIGS]);
            const providerConfigs = result[STORAGE_KEYS.PROVIDER_CONFIGS] || {};

            providerConfigs[selectedProvider] = {
                apiKey: newApiKey,
                modelId: newModelId,
                ...(selectedProvider === 'custom' ? { baseUrl: newBaseUrl } : {})
            };

            await chrome.storage.sync.set({
                [STORAGE_KEYS.PROVIDER_CONFIGS]: providerConfigs,
                [STORAGE_KEYS.ACTIVE_PROVIDER]: selectedProvider
            });

            showStatusMessage('配置已保存!', 'success');
            setTimeout(() => {
                showStatusMessage('');
                showView('idle');
                initialize();
            }, 1000);
        } catch (err) {
            if (err.message && err.message.includes('QUOTA')) {
                showStatusMessage('存储空间不足，请删除不需要的配置后重试。', 'error');
            } else {
                showStatusMessage('保存失败: ' + err.message, 'error');
            }
        }
    }

    async function testConnection() {
        const provider = settingsForm.providerSelect.value;
        const apiKey = settingsForm.apiKeyInput.value.trim();
        const modelId = settingsForm.modelIdInput.value.trim();
        const baseUrl = settingsForm.baseUrlInput.value.trim();

        if (!apiKey || !modelId) {
            showStatusMessage('请先填写 API Key 和模型ID。', 'error');
            return;
        }

        buttons.testConnection.disabled = true;
        buttons.testConnection.textContent = '测试中...';
        showStatusMessage('正在测试连接...', '');

        chrome.runtime.sendMessage({
            action: "testConnection",
            provider,
            apiKey,
            modelId,
            baseUrl: provider === 'custom' ? baseUrl : ''
        }, (response) => {
            buttons.testConnection.disabled = false;
            buttons.testConnection.textContent = '测试连接';

            if (chrome.runtime.lastError) {
                showStatusMessage('测试失败: ' + chrome.runtime.lastError.message, 'error');
                return;
            }

            if (response && response.success) {
                showStatusMessage(response.message, 'success');
            } else {
                showStatusMessage('连接失败: ' + (response?.message || '未知错误'), 'error');
            }
        });
    }
    
    async function handleBackFromSettings() {
        const result = await chrome.storage.sync.get([STORAGE_KEYS.ACTIVE_PROVIDER, STORAGE_KEYS.PROVIDER_CONFIGS]);
        const activeProvider = result[STORAGE_KEYS.ACTIVE_PROVIDER] || DEFAULT_PROVIDER;
        const providerConfigs = result[STORAGE_KEYS.PROVIDER_CONFIGS] || {};
        
        const config = providerConfigs[activeProvider];
        if (config && config.apiKey && config.modelId) {
            showView('idle');
        } else {
            showView('unconfigured');
        }
    }

    async function startCheck() {
        isCheckCancelled = false;
        showView('inProgress');
        resetProgressSteps();
        updateProgressStep('extract', 'in-progress');
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTab = tabs[0];
            if (!currentTab) { return handleError("无法获取当前标签页信息。", true); }
            if (!currentTab.url) {
                return handleError("无法获取当前页面地址，请检查扩展权限设置。", true);
            }
            if (currentTab.url.startsWith('chrome://') || currentTab.url.startsWith('chrome-extension://') || currentTab.url.startsWith('about:')) {
                return handleError("不支持在浏览器内置页面上使用。", true);
            }
            // 先尝试注入 content script，确保接收端存在
            chrome.scripting.executeScript({
                target: { tabId: currentTab.id },
                files: ['content.js']
            }, () => {
                if (chrome.runtime.lastError) {
                    return handleError("无法注入脚本到当前页面：" + chrome.runtime.lastError.message, true);
                }
                chrome.tabs.sendMessage(currentTab.id, { action: "extractText" }, (response) => {
                    if (handleError("无法从页面提取文本。", chrome.runtime.lastError || !response)) return;
                    updateProgressStep('extract', 'done');
                    updateProgressStep('preprocess', 'in-progress');
                    updateProgressStep('preprocess', 'done');
                    updateProgressStep('analyze', 'in-progress');

                    // Build the performCheck request - handle both old single-text and new chunked format
                    const performCheckReq = response.totalChunks > 1
                        ? { action: "performCheck", chunks: response.chunks, totalChunks: response.totalChunks }
                        : { action: "performCheck", text: response.text };

                    chrome.runtime.sendMessage(performCheckReq, (aiResponse) => {
                        if (handleError(`检查失败: ${aiResponse?.message || '未知错误'}`, chrome.runtime.lastError || !aiResponse || aiResponse.error)) return;
                        updateProgressStep('analyze', 'done');
                        updateProgressStep('report', 'in-progress');

                        allIssues = aiResponse.map(issue => ({ ...issue, completed: false }));
                        currentReportUrl = currentTab.url;

                        saveReportToHistory(currentTab, allIssues).then(updatedReports => {
                            if (updatedReports && updatedReports.length > 0) {
                                currentReportTimestamp = updatedReports[0].timestamp;
                            }
                            renderRecentChecks(updatedReports);
                        });

                        setupFilters();
                        applyAndRenderResults();
                        updateProgressStep('report', 'done');
                        setTimeout(() => { if (!isCheckCancelled) showView('results'); }, 500);
                    });
                });
            });
        });
    }

    // Listen for progress messages from background.js during multi-chunk analysis
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "analysisProgress" && currentView === 'inProgress') {
            updateProgressStep('analyze', 'in-progress');
            progressSteps.analyze.textContent = `正在分析第 ${message.current}/${message.total} 段...`;
        }
    });

    // --- UI & Helper Functions ---
    function showView(viewKey) {
        currentView = viewKey;
        for (const key in views) {
            views[key].style.display = (key === viewKey) ? 'block' : 'none';
        }
        // Show/hide open-page button based on whether we have a URL
        buttons.openPage.style.display = (viewKey === 'results' && currentReportUrl) ? 'inline-flex' : 'none';
        // Clear page highlights when leaving results view
        if (viewKey !== 'results') {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, { action: "clearHighlights" }).catch(() => {});
                }
            });
        }
    }

    function showStatusMessage(message, type) {
        settingsForm.statusMessage.textContent = message;
        settingsForm.statusMessage.className = '';
        if (type === 'error') settingsForm.statusMessage.classList.add('status-error');
        else if (type === 'success') settingsForm.statusMessage.classList.add('status-success');
    }

    async function saveReportToHistory(tab, issues) {
        const syncData = await chrome.storage.sync.get([STORAGE_KEYS.ACTIVE_PROVIDER, STORAGE_KEYS.PROVIDER_CONFIGS]);
        const activeProvider = syncData[STORAGE_KEYS.ACTIVE_PROVIDER] || DEFAULT_PROVIDER;
        const pc = syncData[STORAGE_KEYS.PROVIDER_CONFIGS] || {};
        const selectedModel = pc[activeProvider] ? pc[activeProvider].modelId : '';

        const localData = await chrome.storage.local.get([STORAGE_KEYS.RECENT_CHECKS]);
        let reports = localData[STORAGE_KEYS.RECENT_CHECKS] || [];

        const newReport = {
            title: tab.title,
            url: tab.url,
            timestamp: new Date().toISOString(),
            model: selectedModel,
            issues: issues
        };

        reports.unshift(newReport);
        reports = reports.slice(0, MAX_RECENT_CHECKS);
        await chrome.storage.local.set({ [STORAGE_KEYS.RECENT_CHECKS]: reports });
        return reports;
    }

    function renderRecentChecks(reports) {
        recentChecksContainer.innerHTML = '';
        if (!reports || reports.length === 0) return;
        const title = document.createElement('h4');
        title.className = 'recent-checks-title';
        title.textContent = '最近检查记录';
        recentChecksContainer.appendChild(title);
        const list = document.createElement('ul');
        list.className = 'recent-checks-list';
        reports.forEach(report => {
            const item = document.createElement('li');
            item.className = 'recent-check-item';
            const modelTag = report.model ? `<span class="model-tag"> [模型: ${report.model}]</span>` : '';
            item.innerHTML = `<span class="recent-check-title">${report.title || '无标题'}</span><span class="recent-check-meta">${new Date(report.timestamp).toLocaleString()} - ${report.issues.length}个问题${modelTag}</span>`;
            item.addEventListener('click', () => {
                currentReportTimestamp = report.timestamp;
                currentReportUrl = report.url || null;
                allIssues = report.issues;
                setupFilters();
                applyAndRenderResults();
                showView('results');
            });
            list.appendChild(item);
        });
        recentChecksContainer.appendChild(list);
    }

    function setupFilters() {
        resultsFilterContainer.innerHTML = '';
        activeFilters = { severity: '全部', type: '全部' };
        if (!allIssues || allIssues.length === 0) return;

        const severities = ['全部', '严重', '中等', '轻微'];
        const types = ['全部', ...new Set(allIssues.map(i => i.type).filter(Boolean))];

        const createLabel = (text) => {
            const label = document.createElement('p');
            label.className = 'filter-label';
            label.textContent = text;
            return label;
        };

        const createBtn = (filterGroup, value) => {
            const btn = document.createElement('button');
            btn.className = 'filter-button';
            btn.dataset.group = filterGroup;
            btn.dataset.value = value;
            btn.textContent = value;
            if (activeFilters[filterGroup] === value) btn.classList.add('active');
            btn.addEventListener('click', (e) => {
                activeFilters[filterGroup] = value;
                document.querySelectorAll(`.filter-button[data-group="${filterGroup}"]`).forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                applyAndRenderResults();
            });
            return btn;
        };

        resultsFilterContainer.appendChild(createLabel('严重等级:'));
        const severityContainer = document.createElement('div');
        severityContainer.className = 'filter-button-group';
        severities.forEach(s => severityContainer.appendChild(createBtn('severity', s)));
        resultsFilterContainer.appendChild(severityContainer);

        if (types.length > 1) {
            resultsFilterContainer.appendChild(createLabel('问题类型:'));
            const typeContainer = document.createElement('div');
            typeContainer.className = 'filter-button-group';
            types.forEach(t => typeContainer.appendChild(createBtn('type', t)));
            resultsFilterContainer.appendChild(typeContainer);
        }
    }

    function applyAndRenderResults() {
        let filteredIssues = allIssues;
        if (activeFilters.severity !== '全部') filteredIssues = filteredIssues.filter(i => i.severity === activeFilters.severity);
        if (activeFilters.type !== '全部') filteredIssues = filteredIssues.filter(i => i.type === activeFilters.type);
        renderResults(filteredIssues);
    }

    function renderResults(issues) {
        resultsList.innerHTML = '';
        resultsSummary.textContent = `总计发现 ${allIssues.length} 个问题，当前显示 ${issues.length} 个。`;
        if (allIssues.length === 0) resultsSummary.innerHTML = '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> 未发现任何问题。';

        issues.forEach(issue => {
            const originalIndex = allIssues.findIndex(i => i === issue);
            const card = document.createElement('div');
            card.className = `issue-card severity-${issue.severity || '轻微'}`;
            if (issue.completed) {
                card.classList.add('completed');
            }
            card.dataset.index = originalIndex;

            card.innerHTML = `
                <button class="issue-ignore-btn" data-index="${originalIndex}" title="忽略此问题">
                    <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    忽略
                </button>
                <div class="issue-header">
                    <input type="checkbox" class="issue-checkbox" data-index="${originalIndex}" ${issue.completed ? 'checked' : ''}>
                    <h4>${issue.type || '未知类型'}<span class="severity-badge severity-${issue.severity || '轻微'}">${issue.severity || '轻微'}</span></h4>
                </div>
                <p><span class="label">描述:</span> ${issue.description || ''}</p>
                ${issue.location ? `<p><span class="label">位置:</span> ${issue.location}</p>` : ''}
                ${issue.suggestion ? `<p><span class="label">建议:</span> ${issue.suggestion}</p>` : ''}
            `;

            // Click card to highlight on page
            card.addEventListener('click', (e) => {
                if (e.target.classList.contains('issue-checkbox')) return;
                if (e.target.closest('.issue-ignore-btn')) return;
                highlightIssueOnPage(issue, card);
            });

            // Ignore button handler
            const ignoreBtn = card.querySelector('.issue-ignore-btn');
            ignoreBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                ignoreIssue(originalIndex);
            });

            resultsList.appendChild(card);
        });

        document.querySelectorAll('.issue-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', toggleIssueStatus);
        });
    }

    function ignoreIssue(issueIndex) {
        if (isNaN(issueIndex) || issueIndex < 0 || issueIndex >= allIssues.length) return;

        // Remove from allIssues
        allIssues.splice(issueIndex, 1);

        // Update storage if this is from a historical report
        if (currentReportTimestamp) {
            chrome.storage.local.get(STORAGE_KEYS.RECENT_CHECKS).then(({ [STORAGE_KEYS.RECENT_CHECKS]: reports }) => {
                if (reports) {
                    const reportIndex = reports.findIndex(r => r.timestamp === currentReportTimestamp);
                    if (reportIndex !== -1) {
                        reports[reportIndex].issues = allIssues;
                        chrome.storage.local.set({ [STORAGE_KEYS.RECENT_CHECKS]: reports });
                    }
                }
            });
        }

        // Re-render with updated list
        applyAndRenderResults();
    }

    function highlightIssueOnPage(issue, card) {
        if (!issue.location) return;

        // Remove active state from previous card
        document.querySelectorAll('.issue-card.active').forEach(c => c.classList.remove('active'));
        card.classList.add('active');

        // Get current active tab dynamically (works from both fresh check and history)
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (!tab || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
            }, () => {
                if (chrome.runtime.lastError) return;
                chrome.tabs.sendMessage(tab.id, { action: "clearHighlights" }, () => {
                    chrome.tabs.sendMessage(tab.id, {
                        action: "highlightIssue",
                        text: issue.location,
                        severity: issue.severity,
                        description: issue.description
                    });
                });
            });
        });
    }

    async function toggleIssueStatus(event) {
        const issueIndex = parseInt(event.target.dataset.index, 10);
        if (isNaN(issueIndex) || issueIndex < 0 || issueIndex >= allIssues.length) return;

        allIssues[issueIndex].completed = !allIssues[issueIndex].completed;

        if (currentReportTimestamp) {
            const { [STORAGE_KEYS.RECENT_CHECKS]: reports } = await chrome.storage.local.get(STORAGE_KEYS.RECENT_CHECKS);
            if (reports) {
                const reportIndex = reports.findIndex(r => r.timestamp === currentReportTimestamp);
                if (reportIndex !== -1) {
                    reports[reportIndex].issues = allIssues;
                    await chrome.storage.local.set({ [STORAGE_KEYS.RECENT_CHECKS]: reports });
                }
            }
        }
        applyAndRenderResults();
    }

    function downloadCSV(issues) {
        if (!issues || issues.length === 0) {
            const errorEl = document.getElementById('inline-error');
            if (errorEl) {
                errorEl.textContent = '没有可导出的问题。';
                errorEl.style.display = 'block';
                setTimeout(() => { errorEl.style.display = 'none'; }, 3000);
            }
            return;
        }
        const headers = ["type", "severity", "description", "location", "suggestion"];
        const csvRows = [headers.join(',')];
        const escapeCsvCell = (cell) => {
            if (cell === null || cell === undefined) return '';
            const str = String(cell);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`;
            return str;
        };
        issues.forEach(issue => {
            const row = headers.map(header => escapeCsvCell(issue[header]));
            csvRows.push(row.join(','));
        });
        const csvString = csvRows.join('\r\n');
        const blob = new Blob(["\uFEFF" + csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `copycheck_report_${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function resetProgressSteps() {
        Object.values(progressSteps).forEach(step => step.className = '');
        // Reset step text to defaults
        progressSteps.extract.textContent = '提取页面内容...';
        progressSteps.preprocess.textContent = '文本预处理...';
        progressSteps.analyze.textContent = 'AI智能分析...';
        progressSteps.report.textContent = '生成报告...';
    }
    function updateProgressStep(step, status) { if (progressSteps[step]) progressSteps[step].className = status; }

    function handleError(userMessage, condition) {
        if (isCheckCancelled) return true;
        if (condition) {
            console.error(userMessage, condition.message || '');
            const errorEl = document.getElementById('inline-error');
            errorEl.textContent = userMessage;
            errorEl.style.display = 'block';
            showView('idle');
            setTimeout(() => { errorEl.style.display = 'none'; }, 5000);
            return true;
        }
        return false;
    }

    // --- Custom Rules Functions ---

    function renderRulesList() {
        rulesList.innerHTML = '';

        if (customRules.length === 0) {
            rulesList.innerHTML = `
                <div class="rules-empty">
                    <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
                    <p>暂无自定义规则</p>
                </div>
            `;
            return;
        }

        customRules.forEach((rule) => {
            const item = document.createElement('div');
            item.className = `rule-item${rule.enabled ? '' : ' disabled'}`;
            item.dataset.id = rule.id;

            item.innerHTML = `
                <input type="checkbox" ${rule.enabled ? 'checked' : ''} title="${rule.enabled ? '禁用' : '启用'}此规则">
                <div class="rule-item-content">
                    <div class="rule-item-name">${escapeHtml(rule.name)}</div>
                    <div class="rule-item-preview">${escapeHtml(rule.prompt)}</div>
                </div>
                <div class="rule-item-actions">
                    <button class="rule-action-btn edit-btn" title="编辑">
                        <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                    </button>
                    <button class="rule-action-btn delete-btn" title="删除">
                        <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                    </button>
                </div>
            `;

            // Toggle enable/disable
            const checkbox = item.querySelector('input[type="checkbox"]');
            checkbox.addEventListener('change', () => toggleRule(rule.id));

            // Edit button
            item.querySelector('.edit-btn').addEventListener('click', () => openRuleModal(rule.id));

            // Delete button
            item.querySelector('.delete-btn').addEventListener('click', () => handleDeleteRule(rule.id));

            rulesList.appendChild(item);
        });
    }

    function openRuleModal(editId = null) {
        if (editId) {
            const rule = customRules.find(r => r.id === editId);
            if (!rule) return;
            modalTitle.textContent = '编辑规则';
            ruleNameInput.value = rule.name;
            rulePromptInput.value = rule.prompt;
            ruleEnabledInput.checked = rule.enabled;
            ruleEditIdInput.value = rule.id;
        } else {
            modalTitle.textContent = '添加规则';
            ruleNameInput.value = '';
            rulePromptInput.value = '';
            ruleEnabledInput.checked = true;
            ruleEditIdInput.value = '';
        }
        ruleModal.style.display = 'flex';
        ruleNameInput.focus();
    }

    function closeRuleModal() {
        ruleModal.style.display = 'none';
        ruleEditIdInput.value = '';
    }

    async function handleSaveRule() {
        const name = ruleNameInput.value.trim();
        const prompt = rulePromptInput.value.trim();
        const enabled = ruleEnabledInput.checked;
        const editId = ruleEditIdInput.value;

        if (!name) {
            ruleNameInput.focus();
            return;
        }
        if (!prompt) {
            rulePromptInput.focus();
            return;
        }

        if (editId) {
            // Edit existing rule
            const index = customRules.findIndex(r => r.id === editId);
            if (index !== -1) {
                customRules[index] = { ...customRules[index], name, prompt, enabled };
            }
        } else {
            // Add new rule
            customRules.push({
                id: generateRuleId(),
                name,
                prompt,
                enabled
            });
        }

        await saveRules();
        renderRulesList();
        closeRuleModal();
    }

    async function handleDeleteRule(id) {
        const rule = customRules.find(r => r.id === id);
        if (!rule) return;
        if (!confirm(`确定删除规则「${rule.name}」吗？`)) return;

        customRules = customRules.filter(r => r.id !== id);
        await saveRules();
        renderRulesList();
    }

    async function toggleRule(id) {
        const rule = customRules.find(r => r.id === id);
        if (!rule) return;
        rule.enabled = !rule.enabled;
        await saveRules();
        renderRulesList();
    }

    async function saveRules() {
        try {
            await chrome.storage.sync.set({ [STORAGE_KEYS.CUSTOM_RULES]: customRules });
        } catch (err) {
            if (err.message && err.message.includes('QUOTA')) {
                alert('存储空间不足，无法保存规则。请减少规则数量后重试。');
            } else {
                throw err;
            }
        }
    }

    function generateRuleId() {
        return 'rule-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // --- Backup Functions ---

    function showBackupStatus(message, type) {
        backupStatus.textContent = message;
        backupStatus.className = `status-${type}`;
        if (type === 'success') {
            setTimeout(() => { backupStatus.textContent = ''; backupStatus.className = ''; }, 5000);
        }
    }

    async function handleExport() {
        try {
            const syncData = await chrome.storage.sync.get([
                STORAGE_KEYS.ACTIVE_PROVIDER,
                STORAGE_KEYS.PROVIDER_CONFIGS,
                STORAGE_KEYS.CUSTOM_RULES
            ]);
            const localData = await chrome.storage.local.get([STORAGE_KEYS.RECENT_CHECKS]);

            const backup = {
                version: '1.0',
                app: 'CopyCheck',
                exportedAt: new Date().toISOString(),
                data: {
                    activeProvider: syncData[STORAGE_KEYS.ACTIVE_PROVIDER] || null,
                    providerConfigs: syncData[STORAGE_KEYS.PROVIDER_CONFIGS] || {},
                    customRules: syncData[STORAGE_KEYS.CUSTOM_RULES] || [],
                    recentChecks: localData[STORAGE_KEYS.RECENT_CHECKS] || []
                }
            };

            const json = JSON.stringify(backup, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `copycheck_backup_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showBackupStatus('备份已导出。', 'success');
        } catch (err) {
            console.error('Export failed:', err);
            showBackupStatus('导出失败: ' + err.message, 'error');
        }
    }

    async function handleImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Reset file input so same file can be re-imported
        importFileInput.value = '';

        try {
            const text = await file.text();
            let backup;
            try {
                backup = JSON.parse(text);
            } catch (parseErr) {
                showBackupStatus('导入失败: 文件格式错误。', 'error');
                return;
            }

            // Validate backup structure
            if (!backup.app || backup.app !== 'CopyCheck') {
                showBackupStatus('导入失败: 无效的备份文件。', 'error');
                return;
            }

            const data = backup.data || {};

            // Confirm overwrite
            const existing = await chrome.storage.sync.get([STORAGE_KEYS.ACTIVE_PROVIDER]);
            if (existing[STORAGE_KEYS.ACTIVE_PROVIDER]) {
                if (!confirm('导入将覆盖当前设置，是否继续？')) return;
            }

            // Write imported data — sync for config, local for history
            const syncToWrite = {};
            if (data.activeProvider !== undefined) syncToWrite[STORAGE_KEYS.ACTIVE_PROVIDER] = data.activeProvider;
            if (data.providerConfigs) syncToWrite[STORAGE_KEYS.PROVIDER_CONFIGS] = data.providerConfigs;
            if (data.customRules) syncToWrite[STORAGE_KEYS.CUSTOM_RULES] = data.customRules;

            await chrome.storage.sync.set(syncToWrite);

            if (data.recentChecks) {
                await chrome.storage.local.set({ [STORAGE_KEYS.RECENT_CHECKS]: data.recentChecks });
            }

            // Reload state
            customRules = data.customRules || [];
            renderRulesList();
            settingsForm.providerSelect.value = data.activeProvider || DEFAULT_PROVIDER;
            updateSettingsForm(data.activeProvider || DEFAULT_PROVIDER, data.providerConfigs || {});

            const config = (data.providerConfigs || {})[data.activeProvider];
            if (config && config.apiKey && config.modelId) {
                showBackupStatus(`已从备份恢复 [${backup.exportedAt ? new Date(backup.exportedAt).toLocaleString() : '未知时间'}]`, 'success');
            } else {
                showBackupStatus('已导入，但 API 配置不完整。', 'error');
            }

            // Reinitialize to refresh UI
            setTimeout(() => initialize(), 300);

        } catch (err) {
            console.error('Import failed:', err);
            showBackupStatus('导入失败: ' + err.message, 'error');
        }
    }

    // Initialize the extension
    addEventListeners();
    initialize();
});