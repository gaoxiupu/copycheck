// This script is injected into the page to extract text.

function extractVisibleText() {
    const shouldSkipElement = (el) => {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;

        const skipTags = ['script', 'style', 'noscript', 'iframe', 'head', 'nav', 'footer'];
        if (skipTags.includes(el.tagName.toLowerCase())) return true;

        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') {
            return true;
        }

        // Check for elements that are visually hidden but not with display:none or visibility:hidden
        if (el.offsetWidth === 0 && el.offsetHeight === 0) {
            return true;
        }

        return false;
    };

    const extractedContent = [];
    const seenTexts = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);

    let node;
    while (node = walker.nextNode()) {
        const parent = node.parentElement;
        if (shouldSkipElement(parent)) {
            continue;
        }

        const text = node.textContent.trim();
        if (text.length > 2 && !seenTexts.has(text)) {
            extractedContent.push({ tag: parent.tagName.toLowerCase(), text: text });
            seenTexts.add(text);
        }
    }

    return JSON.stringify(extractedContent, null, 2);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extractText") {
        const text = extractVisibleText();
        sendResponse({ text: text });
    }
    return true; // Indicates that the response is sent asynchronously
});