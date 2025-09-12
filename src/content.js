// This script is injected into the page to extract text.

function extractVisibleText() {
    const shouldSkipElement = (el) => {
        if (!el || !el.tagName) return true;
        const skipTags = ['script', 'style', 'noscript', 'iframe', 'head'];
        if (skipTags.includes(el.tagName.toLowerCase())) return true;

        const skipClasses = ['nav', 'navigation', 'menu', 'footer', 'copyright', 'social', 'newsletter', 'header', 'banner', 'sidebar', 'advertisement', 'ad'];
        const className = el.className?.toLowerCase() || '';
        if (skipClasses.some(cls => className.includes(cls))) {
            return true;
        }
        // Skip invisible elements
        return el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0;
    };

    const getOwnText = (node) => {
        const clone = node.cloneNode(true);
        Array.from(clone.children).forEach(child => clone.removeChild(child));
        return clone.textContent.replace(/\s+/g, ' ').trim();
    };
    
    const extractedContent = [];
    const seenTexts = new Set();

    const traverse = (node, isRoot = false) => {
        // Don't skip the root node based on visibility checks
        if (!isRoot && shouldSkipElement(node)) {
            return;
        }

        const ownText = getOwnText(node);
        if (ownText && ownText.length > 2 && !seenTexts.has(ownText)) {
            extractedContent.push({ tag: node.tagName.toLowerCase(), text: ownText });
            seenTexts.add(ownText);
        }

        if (node.childNodes) {
            node.childNodes.forEach(child => {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    traverse(child);
                }
            });
        }
    };

    traverse(document.body, true); // Start with isRoot = true
    return JSON.stringify(extractedContent, null, 2);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extractText") {
        const text = extractVisibleText();
        console.log('=== PagePilot 提取的文案内容 ===');
        console.log(text);
        console.log('=== 文案内容长度:', text.length, '字符 ===');
        
        // 复制到剪贴板
        navigator.clipboard.writeText(text).then(() => {
            console.log('文案内容已复制到剪贴板');
        }).catch(err => {
            console.error('复制到剪贴板失败:', err);
        });
        sendResponse({ text: text });
    }
    return true; // Indicates that the response is sent asynchronously
});
