/**
 * Pure presentation helpers for the chat interface.
 *
 * Message formatting intentionally supports only the small Markdown-like
 * subset used by this sample application: fenced code, block quotes, bold,
 * emphasis, inline code and line breaks. It is not a full Markdown parser.
 */

const HTML_ENTITIES = Object.freeze({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
});

const timeFormatter = new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit"
});

const calendarDateFormatter = new Intl.DateTimeFormat([], {
    month: "short",
    day: "numeric"
});

/** Escape untrusted values before inserting them into an HTML string. */
export function escapeHtml(value) {
    return String(value ?? "").replace(
        /[&<>"']/g,
        (character) => HTML_ENTITIES[character]
    );
}

function formatInlineText(text) {
    return escapeHtml(text)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

/** Convert the supported message syntax into escaped HTML. */
export function formatMessage(source) {
    const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
    const output = [];
    let paragraph = [];
    let quote = [];
    let code = [];
    let language = "code";
    let inCode = false;

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

    lines.forEach((line) => {
        if (line.startsWith("```")) {
            if (inCode) {
                output.push(
                    `<pre data-language="${escapeHtml(language)}"><code>${escapeHtml(code.join("\n"))}</code></pre>`
                );
                code = [];
                inCode = false;
            } else {
                flushParagraph();
                flushQuote();
                language = line.slice(3).trim() || "code";
                inCode = true;
            }
            return;
        }

        if (inCode) {
            code.push(line);
        } else if (line.startsWith("> ")) {
            flushParagraph();
            quote.push(line.slice(2));
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

    flushQuote();
    flushParagraph();
    return output.join("");
}

/** Format an ISO timestamp using the browser's current locale. */
export function shortTime(isoTimestamp) {
    return timeFormatter.format(new Date(isoTimestamp));
}

/** Format today's timestamp with a time and older timestamps with a date. */
export function relativeDate(isoTimestamp) {
    const date = new Date(isoTimestamp);
    const today = new Date();

    if (date.toDateString() === today.toDateString()) {
        return `Today, ${shortTime(isoTimestamp)}`;
    }
    return calendarDateFormatter.format(date);
}

/** Format a byte count for attachment labels. */
export function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}