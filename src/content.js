// This script is injected into the page to extract text.

function extractVisibleText() {
    const uniqueTexts = new Set();
    const processedElements = new WeakSet();

    // Function to check if an element or its ancestors have been processed
    function isAlreadyProcessed(el) {
        let current = el;
        while (current) {
            if (processedElements.has(current)) {
                return true;
            }
            current = current.parentElement;
        }
        return false;
    }

    // Helper function to should skip element based on class or content
    function shouldSkipElement(el) {
        const skipClasses = ['nav', 'navigation', 'menu', 'footer', 'copyright', 'social', 'newsletter', 'header', 'banner', 'sidebar'];
        // Use optional chaining for safety, though className should exist.
        const className = el.className?.toLowerCase() || '';

        // Skip by class name
        if (skipClasses.some(cls => className.includes(cls))) {
            return true;
        }

        const text = el.innerText?.trim();
        if (!text || text.length < 20) return true; // Skip elements with very short text

        // Skip if it's likely a container with just a few short links
        const links = el.querySelectorAll('a');
        if (links.length > 3 && text.length < 100) {
            const linkTextLength = Array.from(links).reduce((acc, a) => acc + a.innerText.length, 0);
            if (linkTextLength / text.length > 0.8) {
                return true;
            }
        }
        
        return false;
    }

    // Select a broad range of potential content-holding elements
    const candidateElements = document.body.querySelectorAll('div, section, article, main, p, h1, h2, h3');

    candidateElements.forEach(el => {
        // If this element or any of its parents have been processed, skip it.
        if (isAlreadyProcessed(el)) {
            return;
        }

        // Skip elements that are likely not main content
        if (shouldSkipElement(el)) {
            processedElements.add(el); // Mark as processed so we don't check its children
            return;
        }
        
        const text = el.innerText?.trim();

        if (text) {
            // Before adding, check if this exact text is already there.
            // This is a final safeguard.
            const cleanText = text.replace(/\s+/g, ' ').trim();
            if (!uniqueTexts.has(cleanText)) {
                 uniqueTexts.add(cleanText);
                 // Mark the element as processed to avoid processing its children or itself again.
                 processedElements.add(el);
            }
        }
    });

    // Get text from meta tags
    const title = document.title;
    if (title) {
        uniqueTexts.add(`(Page Title: ${title})`);
    }

    const description = document.querySelector('meta[name="description"]');
    if (description && description.content) {
        uniqueTexts.add(`(Meta Description: ${description.content})`);
    }

    return Array.from(uniqueTexts).join('\n');
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
