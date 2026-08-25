/** Pure, dependency-free presentation helpers for the chat interface. */

const HTML_ENTITIES = Object.freeze({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
});

const timeFormatter = new Intl.DateTimeFormat([], {
    hour: "2-digit", minute: "2-digit"
});
const calendarDateFormatter = new Intl.DateTimeFormat([], {
    month: "short", day: "numeric"
});

/** @param {unknown} value @returns {string} */
export function escapeHtml(value) {
    return String(value ?? "").replace(
        /[&<>"']/g,
        (character) => HTML_ENTITIES[character]
    );
}

/** @param {string} target @returns {string|null} */
function safeLinkTarget(target) {
    const cleaned = target.trim();
    if (/^(https?:|mailto:)/i.test(cleaned)) return cleaned;
    if (/^(\/|#)/.test(cleaned)) return cleaned;
    return null;
}

/** @param {string} text @returns {string} */
function formatInlineText(text) {
    const tokens = [];
    const protect = (html) => {
        const marker = `\u0000${tokens.length}\u0000`;
        tokens.push(html);
        return marker;
    };

    let source = String(text)
        .replace(/`([^`]+)`/g, (_match, code) => (
            protect(`<code>${escapeHtml(code)}</code>`)
        ))
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, target) => {
            const safeTarget = safeLinkTarget(target);
            if (!safeTarget) return `${label} (${target})`;
            return protect([
                `<a href="${escapeHtml(safeTarget)}"`,
                ' target="_blank" rel="noopener noreferrer">',
                `${escapeHtml(label)}</a>`
            ].join(""));
        });

    source = escapeHtml(source)
        .replace(/~~([^~]+)~~/g, "<del>$1</del>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/__([^_]+)__/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
        .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");

    return source.replace(/\u0000(\d+)\u0000/g, (_match, index) => (
        tokens[Number(index)]
    ));
}

/**
 * Convert common Markdown-style syntax into escaped HTML. Supported blocks:
 * paragraphs, headings, quotes, lists, rules and fenced code. Supported inline
 * syntax: bold, emphasis, strike-through, code and safe links.
 *
 * @param {unknown} source
 * @returns {string}
 */
export function formatMessage(source) {
    const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
    const output = [];
    let paragraph = [];
    let quote = [];
    let code = [];
    let language = "code";
    let inCode = false;
    let listType = null;
    let listItems = [];

    const flushParagraph = () => {
        if (paragraph.length) {
            output.push(`<p>${paragraph.map(formatInlineText).join("<br>")}</p>`);
        }
        paragraph = [];
    };
    const flushQuote = () => {
        if (quote.length) {
            output.push(`<blockquote>${quote.map(formatInlineText).join("<br>")}</blockquote>`);
        }
        quote = [];
    };
    const flushList = () => {
        if (listType && listItems.length) {
            output.push(
                `<${listType}>${listItems.map((item) => `<li>${formatInlineText(item)}</li>`).join("")}</${listType}>`
            );
        }
        listType = null;
        listItems = [];
    };
    const flushTextBlocks = () => {
        flushParagraph();
        flushQuote();
        flushList();
    };

    lines.forEach((line) => {
        if (line.startsWith("```")) {
            if (inCode) {
                output.push(
                    `<pre data-language="${escapeHtml(language)}"><code>${escapeHtml(code.join("\n"))}</code></pre>`
                );
                code = [];
                inCode = false;
            } else {
                flushTextBlocks();
                language = line.slice(3).trim() || "code";
                inCode = true;
            }
            return;
        }
        if (inCode) {
            code.push(line);
            return;
        }

        const unorderedItem = line.match(/^\s*[-+*]\s+(.+)$/);
        const orderedItem = line.match(/^\s*\d+[.)]\s+(.+)$/);
        if (unorderedItem || orderedItem) {
            flushParagraph();
            flushQuote();
            const nextType = unorderedItem ? "ul" : "ol";
            if (listType && listType !== nextType) flushList();
            listType = nextType;
            listItems.push((unorderedItem || orderedItem)[1]);
            return;
        }

        flushList();
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
            flushParagraph();
            flushQuote();
            const level = heading[1].length;
            output.push(`<h${level}>${formatInlineText(heading[2])}</h${level}>`);
        } else if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
            flushParagraph();
            flushQuote();
            output.push("<hr>");
        } else if (/^>\s?/.test(line)) {
            flushParagraph();
            quote.push(line.replace(/^>\s?/, ""));
        } else {
            flushQuote();
            if (line.trim()) paragraph.push(line);
            else flushParagraph();
        }
    });

    if (inCode) {
        output.push(
            `<pre data-language="${escapeHtml(language)}"><code>${escapeHtml(code.join("\n"))}</code></pre>`
        );
    }
    flushTextBlocks();
    return output.join("");
}

/** @param {string} isoTimestamp @returns {string} */
export function shortTime(isoTimestamp) {
    return timeFormatter.format(new Date(isoTimestamp));
}

/** @param {string} isoTimestamp @returns {string} */
export function relativeDate(isoTimestamp) {
    const date = new Date(isoTimestamp);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
        return `Today, ${shortTime(isoTimestamp)}`;
    }
    return calendarDateFormatter.format(date);
}

/** @param {number} bytes @returns {string} */
export function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
