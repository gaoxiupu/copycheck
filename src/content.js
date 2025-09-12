// This script is injected into the page to extract text.

function extractVisibleText() {
    const uniqueTexts = new Set();
    const processedElements = new WeakSet();
    
    // Helper function to check if text is substantially unique
    function isSubstantiallyUnique(text, existingTexts) {
        const cleanText = text.toLowerCase().trim();
        return !Array.from(existingTexts).some(existing => {
            const cleanExisting = existing.toLowerCase().trim();
            // Check if one text is mostly contained within another (>80% overlap)
            if (cleanText.length > cleanExisting.length) {
                return cleanExisting.length / cleanText.length > 0.8 && cleanText.includes(cleanExisting);
            } else {
                return cleanText.length / cleanExisting.length > 0.8 && cleanExisting.includes(cleanText);
            }
        });
    }
    
    // Helper function to should skip element based on class or content
    function shouldSkipElement(el) {
        const skipClasses = ['nav', 'navigation', 'menu', 'footer', 'copyright', 'social', 'newsletter', 'header', 'banner', 'sidebar'];
        const className = el.className.toLowerCase();
        
        // Skip by class name
        if (skipClasses.some(cls => className.includes(cls))) {
            return true;
        }
        
        // Skip if contains mostly navigation links or short phrases
        const text = el.innerText.trim();
        if (text.length < 10) return true;
        
        // Skip if contains mostly repeated single words or numbers
        const words = text.split(/\s+/);
        if (words.length <= 2 && words.every(word => word.length <= 5)) return true;
        
        return false;
    }
    
    // Get text from standard HTML elements first
    const standardElements = document.body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, span, a, button, label, td, th');
    standardElements.forEach(el => {
        if (processedElements.has(el)) return;
        
        const text = el.innerText.trim();
        if (text && !shouldSkipElement(el) && isSubstantiallyUnique(text, uniqueTexts)) {
            uniqueTexts.add(text);
            processedElements.add(el);
        }
    });
    
    // Get text from main content areas (div elements with content)
    const contentDivs = document.body.querySelectorAll('div');
    contentDivs.forEach(el => {
        if (processedElements.has(el)) return;
        
        const text = el.innerText.trim();
        if (!text || text.length < 20) return; // Skip very short content
        
        if (shouldSkipElement(el)) return;
        
        // For divs, be more selective to avoid nested duplicates
        const hasSubstantialContent = text.length > 30 && text.split('\n').length >= 2;
        if (hasSubstantialContent && isSubstantiallyUnique(text, uniqueTexts)) {
            uniqueTexts.add(text);
            processedElements.add(el);
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

    // Convert to array and filter out any remaining near-duplicates
    const finalTexts = Array.from(uniqueTexts).filter((text, index, array) => {
        return array.findIndex(t => 
            t.toLowerCase().trim() === text.toLowerCase().trim()
        ) === index;
    });

    return finalTexts.join('\n');
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
