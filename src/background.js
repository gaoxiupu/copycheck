const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

const BASE_PROMPT = `请分析以下网页文本内容，它以JSON数组格式提供。数组中的每个对象都包含一个“tag”（HTML标签）和一个“text”（文本内容）。请根据“tag”提供的上下文（例如，“h1”是主标题，“button”是可点击的按钮）来分析“text”中的问题。

请检查以下方面：

1. 拼写错误（如单词拼错：accessory 错误拼写成 accesory）
2. 排版错误（如中英文、数字混排时的空格与符号不规范： 5V 应写为 5 V）
3. 一致性问题（同一表达在同一页面有多种形式，如混用公制和英制单位）
4. 其他（仅限文案表达问题，例如歧义、表述不明确等）

不检查的文案内容：
- metadata 中的文案
- 图片 alt 文案

请返回JSON格式的检查结果。要求：
- 输出必须是一个合法的JSON对象数组，不得包含额外文字。
- 每个对象必须包含以下字段：
  - "type": "拼写错误" | "排版错误" | "一致性问题" | "其他"
  - "severity": "严重" | "中等" | "轻微"
  - "description": 对问题的具体描述
  - "location": 问题出现的位置（请用原始文本片段）
  - "suggestion": 修改或优化建议
  请尽量覆盖所有发现的问题。

示例:
[
  {
    "type": "拼写错误",
    "severity": "中等",
    "description": "'登入' 可能是不规范用法，应为 '登录'",
    "location": "登录",
    "suggestion": "将 '登入' 修改为 '登录'"
  }
]
`;

async function callOpenAICompatibleAPI(apiKey, model, text, baseUrl) {
    try {
        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: "system", content: BASE_PROMPT },
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

    } catch (error) {
        console.error('Error calling OpenAI Compatible AI:', error);
        return { error: true, message: error.message };
    }
}

async function callGeminiAI(apiKey, model, text) {
    try {
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
                        text: `${BASE_PROMPT}\n\n网页内容的JSON数据如下:\n${text}`
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

    } catch (error) {
        console.error('Error calling Gemini AI:', error);
        return { error: true, message: error.message };
    }
}

// Main message listener for incoming requests from content scripts.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "performCheck") {
        
        chrome.storage.local.get(['activeProvider', 'providerConfigs'], async (result) => {
            try {
                const activeProvider = result.activeProvider;
                const configs = result.providerConfigs || {};
                const currentConfig = configs[activeProvider];

                if (!currentConfig || !currentConfig.apiKey || !currentConfig.modelId) {
                    throw new Error('提供商未配置或配置不完整。');
                }

                const apiKey = currentConfig.apiKey;
                const modelId = currentConfig.modelId;

                let callResult;

                if (activeProvider === 'gemini') {
                    callResult = await callGeminiAI(apiKey, modelId, request.text);
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
                    callResult = await callOpenAICompatibleAPI(apiKey, modelId, request.text, baseUrl);
                }

                sendResponse(callResult);

            } catch (error) {
                console.error("Error during API call:", error);
                sendResponse({ error: true, message: error.message });
            }
        });
        return true; // Indicates that the response is sent asynchronously.
    }
    return false; // Handle other messages if any
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});
