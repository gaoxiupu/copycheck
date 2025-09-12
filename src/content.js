// This script is injected into the page to extract text.

function extractVisibleText() {
    const allText = [];
    
    // Get text from main body
    document.body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, span, a, button, label, td, th').forEach(el => {
        const text = el.innerText.trim();
        if (text) {
            allText.push(text);
        }
    });

    // Get text from image alt attributes
    document.body.querySelectorAll('img').forEach(img => {
        const altText = img.alt.trim();
        if (altText) {
            allText.push(`(Image Alt: ${altText})`);
        }
    });
    
    // Get text from meta tags
    const title = document.title;
    if (title) {
        allText.unshift(`(Page Title: ${title})`);
    }
    
    const description = document.querySelector('meta[name="description"]');
    if (description && description.content) {
        allText.unshift(`(Meta Description: ${description.content})`);
    }

    // Remove duplicates and join
    return [...new Set(allText)].join('\n');
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extractText") {
        const text = extractVisibleText();
        sendResponse({ text: text });
    }
    return true; // Indicates that the response is sent asynchronously
});
