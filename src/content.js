// This script is injected into the page to extract text.

// --- Inject highlight styles ---
if (!document.getElementById('pagepilot-highlight-styles')) {
    const style = document.createElement('style');
    style.id = 'pagepilot-highlight-styles';
    style.textContent = `
        mark.pagepilot-highlight {
            padding: 1px 2px;
            border-radius: 3px;
            animation: pagepilot-pulse 1s ease-out 1;
            outline: 2px solid transparent;
            outline-offset: 1px;
            transition: outline-color 0.3s ease;
        }
        mark.pagepilot-severity-严重 {
            background: oklch(0.85 0.1 25 / 0.35);
            outline-color: oklch(0.65 0.15 25 / 0.5);
        }
        mark.pagepilot-severity-中等 {
            background: oklch(0.9 0.08 85 / 0.35);
            outline-color: oklch(0.7 0.12 85 / 0.5);
        }
        mark.pagepilot-severity-轻微 {
            background: oklch(0.9 0.06 250 / 0.3);
            outline-color: oklch(0.65 0.1 250 / 0.5);
        }
        @keyframes pagepilot-pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.02); }
            100% { transform: scale(1); }
        }
    `;
    document.head.appendChild(style);
}

// --- Highlight functions ---

function clearHighlights() {
    const highlights = document.querySelectorAll('mark.pagepilot-highlight');
    highlights.forEach(mark => {
        const parent = mark.parentNode;
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
    });
}

function highlightText(searchText, severity, description) {
    clearHighlights();
    if (!searchText || typeof searchText !== 'string') return false;

    // Build a prioritized list of terms to try matching
    const candidates = buildSearchCandidates(searchText, description);

    for (const term of candidates) {
        const found = tryHighlight(term, severity);
        if (found) return true;
    }
    return false;
}

// Extract precise error text from description (e.g., quotes like 'xxx' or "xxx")
function buildSearchCandidates(location, description) {
    const candidates = [];
    const seen = new Set();
    const add = (text) => {
        const trimmed = text.trim();
        if (trimmed.length >= 2 && !seen.has(trimmed)) {
            seen.add(trimmed);
            candidates.push(trimmed);
        }
    };

    // 1. Extract quoted text from description (most precise - the actual error word)
    if (description) {
        const quoted = description.match(/[''""']([^''""']+)[''""']/g);
        if (quoted) {
            quoted.forEach(q => add(q.replace(/^[''""']|[''""']$/g, '')));
        }
    }

    // 2. Full location text
    add(location);

    // 3. Location split into segments (for long multi-clause text)
    const segments = location.split(/[，,、；;。！!？?\s]+/).filter(s => s.length >= 2);
    segments.forEach(add);

    // 4. Trailing portion of location (error often appears at the end)
    if (location.length > 10) {
        add(location.slice(-20));
        add(location.slice(-10));
    }

    return candidates;
}

function tryHighlight(searchTerm, severity) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName.toLowerCase();
            if (['script', 'style', 'noscript', 'iframe', 'head', 'mark'].includes(tag)) return NodeFilter.FILTER_REJECT;
            if (parent.classList.contains('pagepilot-highlight')) return NodeFilter.FILTER_REJECT;
            if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    let node;
    while (node = walker.nextNode()) {
        const text = node.textContent;
        const index = text.indexOf(searchTerm);
        if (index === -1) continue;

        const parent = node.parentNode;
        const before = text.substring(0, index);
        const match = text.substring(index, index + searchTerm.length);
        const after = text.substring(index + searchTerm.length);

        const mark = document.createElement('mark');
        mark.className = `pagepilot-highlight pagepilot-severity-${severity || '轻微'}`;
        mark.textContent = match;

        if (before) parent.insertBefore(document.createTextNode(before), node);
        parent.insertBefore(mark, node);
        if (after) parent.insertBefore(document.createTextNode(after), node);
        parent.removeChild(node);

        mark.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        return true;
    }
    return false;
}

// Estimate token count from a string.
// Rough heuristic: JSON-encoded text length / 2 works well for mixed CN/EN content.
function estimateTokens(str) {
    return Math.ceil(str.length / 2);
}

const CHUNK_TOKEN_LIMIT = 20000;

function chunkContent(items) {
    const chunks = [];
    let currentChunk = [];
    let currentTokens = 0;

    for (const item of items) {
        const itemJson = JSON.stringify(item);
        const itemTokens = estimateTokens(itemJson);

        // If a single item exceeds the limit, split its text into smaller pieces
        if (itemTokens > CHUNK_TOKEN_LIMIT) {
            // Flush current chunk first
            if (currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = [];
                currentTokens = 0;
            }

            // Split the oversized item's text into sub-chunks
            const tag = item.tag;
            const text = item.text;
            const charsPerChunk = CHUNK_TOKEN_LIMIT * 2; // reverse of estimate: tokens * 2 ≈ chars
            for (let i = 0; i < text.length; i += charsPerChunk) {
                const segment = text.substring(i, i + charsPerChunk);
                const segmentItem = { tag: tag + (i > 0 ? ` (续${Math.floor(i / charsPerChunk) + 1})` : ''), text: segment };
                chunks.push([segmentItem]);
            }
            continue;
        }

        // If adding this item would exceed the limit, start a new chunk
        if (currentTokens + itemTokens > CHUNK_TOKEN_LIMIT && currentChunk.length > 0) {
            chunks.push(currentChunk);
            currentChunk = [];
            currentTokens = 0;
        }

        currentChunk.push(item);
        currentTokens += itemTokens;
    }

    // Don't forget the last chunk
    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }

    return chunks.length > 0 ? chunks : [[]];
}

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

    // Chunk the content
    const chunks = chunkContent(extractedContent);

    // If only one chunk, return as simple text for backwards compatibility
    if (chunks.length === 1) {
        return { text: JSON.stringify(chunks[0], null, 2), totalChunks: 1 };
    }

    // Return multiple chunks
    return {
        chunks: chunks.map(c => JSON.stringify(c, null, 2)),
        totalChunks: chunks.length
    };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extractText") {
        const result = extractVisibleText();
        sendResponse(result);
    } else if (request.action === "highlightIssue") {
        const found = highlightText(request.text, request.severity, request.description);
        sendResponse({ found });
    } else if (request.action === "clearHighlights") {
        clearHighlights();
        sendResponse({ done: true });
    }
    return true;
});