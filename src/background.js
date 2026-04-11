const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];
const MAX_RETRIES = 2;

async function withRetry(fn, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const isRetryable = RETRYABLE_STATUS_CODES.some(code => error.message.includes(`${code}`)) ||
                error.message.includes('Failed to fetch') ||
                error.message.includes('NetworkError') ||
                error.message.includes('network');

            if (!isRetryable || attempt === retries) throw error;

            const delay = (attempt + 1) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

const BASE_PROMPT = `### Role
你是一位资深的网页内容质量审计专家。你拥有极高的语言敏感度，擅长发现网页文案中细微的逻辑、格式和法律合规问题。

### Task
对输入的 JSON 数据（包含 tag 和 text）进行多维度审计。你必须结合 HTML 标签的语义（如 <h1> 是核心标题，<button> 是操作指令）来评估文案的得体性。

### Audit_Dimensions
1. **拼写与术语**：
   - 识别错别字、繁简体混用。
   - 检查专有名词的大小写（如 "iPhone" 而非 "iphone"）。
2. **排版与标点**：
   - **盘古规范**：中文与英文、数字之间必须保留一个空格（例：使用 Gemini 1.5 而非 使用Gemini1.5）。
   - **标点正确**：中文语境使用全角标点，英文语境使用半角；标题末尾不应有句号。
3. **一致性**：
   - 全局人称统一（如“你”与“您”不可混用）。
   - 单位符号统一（如 kg, m, cm）。
   - 操作指引统一（如“点击” vs “按一下”）。
4. **语境适用性**：
   - **UI 规范**：按钮文字应简洁明确；链接文字应具备描述性。
   - **逻辑严谨**：是否存在表述模糊、前后矛盾的情况。

### Severity_Levels
- **严重**：导致品牌形象受损、违反法律法规、或产生严重误导。
- **中等**：明显的错别字、标点错误、排版混乱。
- **轻微**：建议性的风格润色、非强制性的审美优化。

### Principles (Priority: High)
- **非错不报**：若 suggestion 与 location 实质相同，或不确定是否为错误，严禁返回该条目。
- **原文定位**：\`location\` 字段必须与输入 JSON 中的原始 \`text\` 片段**逐字对应**，严禁进行任何改写。
- **不干预代码**：忽略所有代码片段、占位符（如 {{name}}）。
- **知识局限性**：你的知识库有截止日期。若网页内容涉及你知识库之外的新产品、新技术或未来年份（如 2025/2026 年），**严禁** 仅因其不在你的知识库内而判定为“事实错误”或“逻辑矛盾”。除非有非常明显的拼写错误，否则应优先相信网页内容的描述。

### Output_Format
必须返回一个纯 JSON 数组，不含任何 Markdown 代码块标签或解释文字。结构如下：
[
  {
    "type": "拼写错误" | "排版错误" | "一致性问题" | "合规风险" | "其他",
    "severity": "严重" | "中等" | "轻微",
    "description": "简要说明原因",
    "location": "发现问题的原始文本片段",
    "suggestion": "修改后的建议文本"
  }
]
`;


// Build the full prompt by appending enabled custom rules
function buildFullPrompt(customRules) {
    const now = new Date();
    const dateStr = now.toLocaleString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    });

    let prompt = `当前系统时间：${dateStr}\n\n${BASE_PROMPT}`;

    const enabledRules = (customRules || []).filter(r => r.enabled && r.prompt && r.prompt.trim());
    if (enabledRules.length > 0) {
        prompt += '\n\n--- 用户自定义检查要求（请严格遵守） ---\n';
        enabledRules.forEach((rule, i) => {
            prompt += `\n${i + 1}. ${rule.prompt.trim()}\n`;
        });
    }

    return prompt;
}

async function callOpenAICompatibleAPI(apiKey, model, text, baseUrl, prompt) {
    try {
        return await withRetry(async () => {
            const response = await fetch(baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: "system", content: prompt },
                        { role: "user", content: `网页内容的JSON数据如下:\n${text}` }
                    ],
                    stream: false,
                    response_format: { type: "json_object" }
                })
            });

            if (!response.ok) {
                const errorBody = await response.json();
                console.error("API Error:", errorBody);
                throw new Error(`API request failed with status ${response.status}: ${errorBody.error?.message || 'Unknown error'}`);
            }

            const data = await response.json();
            const content = data.choices[0].message.content;
            return JSON.parse(content);
        });
    } catch (error) {
        console.error('Error calling OpenAI Compatible AI:', error);
        return { error: true, message: error.message };
    }
}

async function callGeminiAI(apiKey, model, text, prompt) {
    try {
        return await withRetry(async () => {
            const geminiModel = model || 'gemini-3-flash-preview';
            const url = `${GEMINI_API_URL}${geminiModel}:generateContent?key=${apiKey}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `${prompt}\n\n网页内容的JSON数据如下:\n${text}`
                        }]
                    }],
                    generationConfig: {
                        responseMimeType: "application/json"
                    }
                })
            });

            if (!response.ok) {
                const errorBody = await response.json();
                console.error("Gemini API Error:", errorBody);
                throw new Error(`Gemini API request failed with status ${response.status}: ${errorBody.error?.message || 'Unknown error'}`);
            }

            const data = await response.json();
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!content) {
                throw new Error('No content in Gemini response');
            }

            return JSON.parse(content);
        });
    } catch (error) {
        console.error('Error calling Gemini AI:', error);
        return { error: true, message: error.message };
    }
}

// Merge and deduplicate issues from multiple chunk results.
// Dedup key: type + description + location
function mergeAndDedupIssues(allResults) {
    const seen = new Map();
    for (const result of allResults) {
        if (!Array.isArray(result)) continue;
        for (const issue of result) {
            // Filter out no-op suggestions (where suggestion is identical to location)
            if (issue.location && issue.suggestion) {
                const loc = issue.location.trim();
                const sug = issue.suggestion.trim();
                // Extract possible "将 'xxx' 修改为 'yyy'" format if AI didn't follow instruction perfectly
                // but usually they return the direct string.
                if (loc === sug) continue;
            }

            const key = `${issue.type || ''}|${issue.description || ''}|${issue.location || ''}`;
            if (!seen.has(key)) {
                seen.set(key, issue);
            }
        }
    }
    return Array.from(seen.values());
}

// Call AI for a single chunk, returning parsed JSON array of issues
async function callAIForChunk(activeProvider, currentConfig, chunkText, prompt) {
    const apiKey = currentConfig.apiKey;
    const modelId = currentConfig.modelId;

    if (activeProvider === 'gemini') {
        return await callGeminiAI(apiKey, modelId, chunkText, prompt);
    } else {
        let baseUrl = '';
        switch (activeProvider) {
            case 'zhipu':
                baseUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
                break;
            case 'deepseek':
                baseUrl = 'https://api.deepseek.com/chat/completions';
                break;
            case 'qwen':
                baseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
                break;
            case 'custom':
                baseUrl = currentConfig.baseUrl;
                if (!baseUrl) throw new Error('自定义接口地址未配置。');
                break;
            default:
                throw new Error(`不支持的提供商: ${activeProvider}`);
        }
        return await callOpenAICompatibleAPI(apiKey, modelId, chunkText, baseUrl, prompt);
    }
}

// Main message listener for incoming requests from content scripts.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "performCheck") {
        chrome.storage.sync.get(['customRules', 'activeProvider', 'providerConfigs'], async (syncResult) => {
            try {
                const customRules = syncResult.customRules || [];
                const prompt = buildFullPrompt(customRules);

                const activeProvider = syncResult.activeProvider;
                const configs = syncResult.providerConfigs || {};
                const currentConfig = configs[activeProvider];

                if (!currentConfig || !currentConfig.apiKey || !currentConfig.modelId) {
                    throw new Error('提供商未配置或配置不完整。');
                }

                const { chunks, totalChunks } = request;

                // Single chunk (backwards compatible)
                if (!chunks || totalChunks === 1) {
                    const text = chunks ? chunks[0] : request.text;
                    const callResult = await callAIForChunk(activeProvider, currentConfig, text, prompt);
                    sendResponse(callResult);
                    return;
                }

                // Multiple chunks: loop, collect, merge
                const allResults = [];
                for (let i = 0; i < totalChunks; i++) {
                    // Notify side panel of progress
                    chrome.runtime.sendMessage({
                        action: "analysisProgress",
                        current: i + 1,
                        total: totalChunks
                    });

                    const callResult = await callAIForChunk(activeProvider, currentConfig, chunks[i], prompt);

                    // Handle error responses
                    if (callResult && callResult.error) {
                        sendResponse(callResult);
                        return;
                    }

                    if (Array.isArray(callResult)) {
                        allResults.push(callResult);
                    }
                }

                const merged = mergeAndDedupIssues(allResults);
                sendResponse(merged);

            } catch (error) {
                console.error("Error during API call:", error);
                sendResponse({ error: true, message: error.message });
            }
        });
        return true; // Indicates that the response is sent asynchronously.
    }

    if (request.action === "testConnection") {
        const { provider, apiKey, modelId, baseUrl } = request;

        if (!apiKey || !modelId) {
            sendResponse({ success: false, message: 'API Key 和模型ID不能为空。' });
            return true;
        }

        (async () => {
            try {
                const testText = JSON.stringify([{ tag: "p", text: "测试文本 test content" }]);
                const testPrompt = buildFullPrompt([]);

                if (provider === 'gemini') {
                    await callGeminiAI(apiKey, modelId, testText, testPrompt);
                } else {
                    let url = baseUrl;
                    if (!url) {
                        switch (provider) {
                            case 'zhipu': url = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'; break;
                            case 'deepseek': url = 'https://api.deepseek.com/chat/completions'; break;
                            case 'qwen': url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'; break;
                            default:
                                sendResponse({ success: false, message: '缺少接口地址。' });
                                return;
                        }
                    }
                    await callOpenAICompatibleAPI(apiKey, modelId, testText, url, testPrompt);
                }
                sendResponse({ success: true, message: '连接成功！API 配置正确。' });
            } catch (error) {
                sendResponse({ success: false, message: error.message || '连接失败。' });
            }
        })();
        return true;
    }

    return false; // Handle other messages if any
});

chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId });
});
