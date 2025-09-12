document.addEventListener('DOMContentLoaded', () => {
    // Constants
    const STORAGE_KEYS = {
        API_KEY: 'apiKey',
        SELECTED_MODEL: 'selectedModel',
        RECENT_CHECKS: 'recentChecks'
    };
    const MAX_RECENT_CHECKS = 5;

    // Views
    const views = {
        unconfigured: document.getElementById('unconfigured-view'),
        idle: document.getElementById('idle-view'),
        inProgress: document.getElementById('in-progress-view'),
        results: document.getElementById('results-view'),
        settings: document.getElementById('settings-view')
    };

    // All Buttons
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

    // Settings Form Elements
    const settingsForm = {
        apiKeyInput: document.getElementById('api-key'),
        modelSelect: document.getElementById('model-select'),
        statusMessage: document.getElementById('status-message')
    };

    // Other UI Elements
    const recentChecksContainer = document.getElementById('recent-checks-container');
    const progressSteps = { extract: document.getElementById('step-extract'), preprocess: document.getElementById('step-preprocess'), analyze: document.getElementById('step-analyze'), report: document.getElementById('step-report') };
    const resultsSummary = document.getElementById('results-summary');
    const resultsFilterContainer = document.getElementById('results-filter-container');
    const resultsList = document.getElementById('results-list');

    // State
    let isCheckCancelled = false;
    let allIssues = [];
    let activeFilters = { severity: 'All', type: 'All' };
    let currentView = null;

    // --- Initialization ---
    function initialize() {
        chrome.storage.local.get(Object.values(STORAGE_KEYS), (result) => {
            // Populate settings form first
            if (result[STORAGE_KEYS.API_KEY]) settingsForm.apiKeyInput.value = result[STORAGE_KEYS.API_KEY];
            if (result[STORAGE_KEYS.SELECTED_MODEL]) settingsForm.modelSelect.value = result[STORAGE_KEYS.SELECTED_MODEL];

            // Determine initial view
            if (result[STORAGE_KEYS.API_KEY]) {
                showView('idle');
                renderRecentChecks(result[STORAGE_KEYS.RECENT_CHECKS] || []);
            } else {
                showView('unconfigured');
            }
        });
        addEventListeners();
    }

    // --- Event Listeners ---
    function addEventListeners() {
        buttons.startCheck.addEventListener('click', startCheck);
        buttons.goToSettings.addEventListener('click', () => showView('settings'));
        buttons.goToSettingsFromUnconfigured.addEventListener('click', () => showView('settings'));
        buttons.backToIdle.addEventListener('click', () => showView('idle'));
        buttons.backToIdleFromSettings.addEventListener('click', () => {
             // Only go back to idle if API key is configured
            chrome.storage.local.get(STORAGE_KEYS.API_KEY, (result) => {
                if(result.apiKey) showView('idle'); else showView('unconfigured');
            });
        });
        buttons.cancelCheck.addEventListener('click', () => { isCheckCancelled = true; showView('idle'); });
        buttons.exportCsv.addEventListener('click', () => downloadCSV(allIssues));
        buttons.saveSettings.addEventListener('click', saveSettings);
    }

    // --- Core Functions ---
    function saveSettings() {
        const apiKey = settingsForm.apiKeyInput.value.trim();
        const selectedModel = settingsForm.modelSelect.value;
        if (!apiKey) {
            settingsForm.statusMessage.textContent = '请输入有效的API Key。';
            settingsForm.statusMessage.style.color = 'red';
            return;
        }
        chrome.storage.local.set({ [STORAGE_KEYS.API_KEY]: apiKey, [STORAGE_KEYS.SELECTED_MODEL]: selectedModel }, () => {
            settingsForm.statusMessage.textContent = '设置已保存!';
            settingsForm.statusMessage.style.color = 'green';
            setTimeout(() => {
                settingsForm.statusMessage.textContent = '';
                showView('idle'); // Go back to idle view after saving
                initialize(); // Re-initialize to load recent checks
            }, 1000);
        });
    }

    function startCheck() {
        isCheckCancelled = false;
        showView('inProgress');
        resetProgressSteps();
        updateProgressStep('extract', 'in-progress');
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTab = tabs[0];
            if (!currentTab) { return handleError("无法获取当前标签页信息。", true); }
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
                    allIssues = aiResponse;
                    saveReportToHistory(currentTab, allIssues).then(renderRecentChecks);
                    setupFilters();
                    applyAndRenderResults();
                    updateProgressStep('report', 'done');
                    setTimeout(() => { if (!isCheckCancelled) showView('results'); }, 500);
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

    async function saveReportToHistory(tab, issues) {
        const newReport = { title: tab.title, url: tab.url, timestamp: new Date().toISOString(), issues: issues };
        const result = await chrome.storage.local.get(STORAGE_KEYS.RECENT_CHECKS);
        let reports = result[STORAGE_KEYS.RECENT_CHECKS] || [];
        reports.unshift(newReport);
        reports = reports.slice(0, MAX_RECENT_CHECKS);
        await chrome.storage.local.set({ [STORAGE_KEYS.RECENT_CHECKS]: reports });
        return reports;
    }

    function renderRecentChecks(reports) { /* ... same as before ... */ }
    function setupFilters() { /* ... same as before ... */ }
    function applyAndRenderResults() { /* ... same as before ... */ }
    function renderResults(issues) { /* ... same as before ... */ }
    function downloadCSV(issues) { /* ... same as before ... */ }
    function resetProgressSteps() { /* ... same as before ... */ }
    function updateProgressStep(step, status) { /* ... same as before ... */ }
    function handleError(userMessage, condition) { /* ... same as before ... */ }

    // Re-pasting functions here to be self-contained, as I can't reference outside this block
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
            item.innerHTML = `<span class="recent-check-title">${report.title || '无标题'}</span><span class="recent-check-meta">${new Date(report.timestamp).toLocaleString()} - ${report.issues.length}个问题</span>`;
            item.addEventListener('click', () => {
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

        // Create and append severity filters
        resultsFilterContainer.appendChild(createLabel('严重等级:'));
        const severityContainer = document.createElement('div');
        severityContainer.className = 'filter-button-group';
        severities.forEach(s => severityContainer.appendChild(createBtn('severity', s)));
        resultsFilterContainer.appendChild(severityContainer);

        // Create and append type filters if there are any types
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
            const card = document.createElement('div');
            card.className = `issue-card severity-${issue.severity || '轻微'}`;
            card.innerHTML = `<h4>${issue.type || '未知类型'} <span class="severity-label">(${issue.severity || '轻微'})</span></h4><p><span class="label">描述:</span> ${issue.description || ''}</p>${issue.location ? `<p><span class="label">位置:</span> ${issue.location}</p>` : ''}${issue.suggestion ? `<p><span class="label">建议:</span> ${issue.suggestion}</p>` : ''}`;
            resultsList.appendChild(card);
        });
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
    initialize();
});
