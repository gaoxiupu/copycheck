document.addEventListener('DOMContentLoaded', () => {
    // --- Constants and Configuration ---
    const STORAGE_KEYS = {
        ACTIVE_PROVIDER: 'activeProvider',
        PROVIDER_CONFIGS: 'providerConfigs',
        RECENT_CHECKS: 'recentChecks'
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
        backToIdle: document.getElementById('back-to-idle'),
        backToIdleFromSettings: document.getElementById('back-to-idle-from-settings'),
        cancelCheck: document.getElementById('cancel-check'),
        exportCsv: document.getElementById('export-csv-button'),
        saveSettings: document.getElementById('save-settings-btn')
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

    // --- State Variables ---
    let isCheckCancelled = false;
    let allIssues = [];
    let activeFilters = { severity: 'All', type: 'All' };
    let currentView = null;
    let currentReportTimestamp = null;

    // --- Helper Functions ---
    // --- Initialization ---
    async function initialize() {
        const result = await chrome.storage.local.get([STORAGE_KEYS.ACTIVE_PROVIDER, STORAGE_KEYS.PROVIDER_CONFIGS, STORAGE_KEYS.RECENT_CHECKS]);
        const providerConfigs = result[STORAGE_KEYS.PROVIDER_CONFIGS] || {};
        const activeProvider = result[STORAGE_KEYS.ACTIVE_PROVIDER] || DEFAULT_PROVIDER;
        const recentChecks = result[STORAGE_KEYS.RECENT_CHECKS] || [];

        settingsForm.providerSelect.value = activeProvider;
        updateSettingsForm(activeProvider, providerConfigs);

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
        buttons.backToIdle.addEventListener('click', () => showView('idle'));
        buttons.backToIdleFromSettings.addEventListener('click', handleBackFromSettings);
        buttons.cancelCheck.addEventListener('click', () => { isCheckCancelled = true; showView('idle'); });
        buttons.exportCsv.addEventListener('click', () => downloadCSV(allIssues));
        buttons.saveSettings.addEventListener('click', saveApiKey);
        settingsForm.providerSelect.addEventListener('change', handleProviderChange);
    }

    // --- Core Functions ---

    async function handleProviderChange() {
        const selectedProvider = settingsForm.providerSelect.value;
        const result = await chrome.storage.local.get([STORAGE_KEYS.PROVIDER_CONFIGS]);
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
            showStatusMessage('API Key 和 模型ID 不能为空。', 'red');
            return;
        }

        const result = await chrome.storage.local.get([STORAGE_KEYS.PROVIDER_CONFIGS]);
        const providerConfigs = result[STORAGE_KEYS.PROVIDER_CONFIGS] || {};
        
        providerConfigs[selectedProvider] = {
            apiKey: newApiKey,
            modelId: newModelId,
            ...(selectedProvider === 'custom' ? { baseUrl: newBaseUrl } : {})
        };

        await chrome.storage.local.set({ 
            [STORAGE_KEYS.PROVIDER_CONFIGS]: providerConfigs,
            [STORAGE_KEYS.ACTIVE_PROVIDER]: selectedProvider
        });
        
        showStatusMessage('配置已保存!', 'green');
        setTimeout(() => {
            showStatusMessage('');
            showView('idle');
            initialize(); 
        }, 1000);
    }
    
    async function handleBackFromSettings() {
        const result = await chrome.storage.local.get([STORAGE_KEYS.ACTIVE_PROVIDER, STORAGE_KEYS.PROVIDER_CONFIGS]);
        const activeProvider = result[STORAGE_KEYS.ACTIVE_PROVIDER] || DEFAULT_PROVIDER;
        const providerConfigs = result[STORAGE_KEYS.PROVIDER_CONFIGS] || {};
        
        const config = providerConfigs[activeProvider];
        if (config && config.apiKey && config.modelId) {
            showView('idle');
        } else {
            showView('unconfigured');
        }
    }

    function startCheck() {
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

                    chrome.runtime.sendMessage({ action: "performCheck", text: response.text }, (aiResponse) => {
                        if (handleError(`检查失败: ${aiResponse?.message || '未知错误'}`, chrome.runtime.lastError || !aiResponse || aiResponse.error)) return;
                        updateProgressStep('analyze', 'done');
                        updateProgressStep('report', 'in-progress');

                        allIssues = aiResponse.map(issue => ({ ...issue, completed: false }));

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

    // --- UI & Helper Functions ---
    function showView(viewKey) {
        currentView = viewKey;
        for (const key in views) {
            views[key].style.display = (key === viewKey) ? 'block' : 'none';
        }
    }

    function showStatusMessage(message, color) {
        settingsForm.statusMessage.textContent = message;
        settingsForm.statusMessage.style.color = color || 'black';
    }

    async function saveReportToHistory(tab, issues) {
        const storageData = await chrome.storage.local.get([STORAGE_KEYS.RECENT_CHECKS, STORAGE_KEYS.ACTIVE_PROVIDER, STORAGE_KEYS.PROVIDER_CONFIGS]);
        let reports = storageData[STORAGE_KEYS.RECENT_CHECKS] || [];
        const activeProvider = storageData[STORAGE_KEYS.ACTIVE_PROVIDER] || DEFAULT_PROVIDER;
        const pc = storageData[STORAGE_KEYS.PROVIDER_CONFIGS] || {};
        const selectedModel = pc[activeProvider] ? pc[activeProvider].modelId : '';

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
        activeFilters = { severity: 'All', type: 'All' };
        if (!allIssues || allIssues.length === 0) return;

        const severities = ['All', '严重', '中等', '轻微'];
        const types = ['All', ...new Set(allIssues.map(i => i.type).filter(Boolean))];

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
        if (activeFilters.severity !== 'All') filteredIssues = filteredIssues.filter(i => i.severity === activeFilters.severity);
        if (activeFilters.type !== 'All') filteredIssues = filteredIssues.filter(i => i.type === activeFilters.type);
        renderResults(filteredIssues);
    }

    function renderResults(issues) {
        resultsList.innerHTML = '';
        resultsSummary.textContent = `总计发现 ${allIssues.length} 个问题，当前显示 ${issues.length} 个。`;
        if (allIssues.length === 0) resultsSummary.textContent = '✅ 未发现任何问题。';

        issues.forEach(issue => {
            const originalIndex = allIssues.findIndex(i => i === issue);
            const card = document.createElement('div');
            card.className = `issue-card severity-${issue.severity || '轻微'}`;
            if (issue.completed) {
                card.classList.add('completed');
            }

            card.innerHTML = `
                <div class="issue-header">
                    <input type="checkbox" class="issue-checkbox" data-index="${originalIndex}" ${issue.completed ? 'checked' : ''}>
                    <h4>${issue.type || '未知类型'} <span class="severity-label">(${issue.severity || '轻微'})</span></h4>
                </div>
                <p><span class="label">描述:</span> ${issue.description || ''}</p>
                ${issue.location ? `<p><span class="label">位置:</span> ${issue.location}</p>` : ''}
                ${issue.suggestion ? `<p><span class="label">建议:</span> ${issue.suggestion}</p>` : ''}
            `;
            resultsList.appendChild(card);
        });

        document.querySelectorAll('.issue-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', toggleIssueStatus);
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
        if (!issues || issues.length === 0) { alert("没有可导出的问题。"); return; }
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
        a.download = `pagepilot_report_${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function resetProgressSteps() { Object.values(progressSteps).forEach(step => step.className = ''); }
    function updateProgressStep(step, status) { if (progressSteps[step]) progressSteps[step].className = status; }

    function handleError(userMessage, condition) {
        if (isCheckCancelled) return true;
        if (condition) {
            console.error(userMessage, condition.message || '');
            alert(userMessage);
            showView('idle');
            return true;
        }
        return false;
    }

    // Initialize the extension
    addEventListeners();
    initialize();
});