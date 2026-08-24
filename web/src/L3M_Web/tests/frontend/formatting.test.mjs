import assert from "node:assert/strict";
import test from "node:test";

import {
    escapeHtml,
    formatBytes,
    formatMessage
} from "../../static/js/chat/formatting.js";

test("untrusted markup is escaped", () => {
    assert.equal(
        escapeHtml('<script data-test="x">&</script>'),
        "&lt;script data-test=&quot;x&quot;&gt;&amp;&lt;/script&gt;"
    );
});

test("supported inline message formatting is rendered", () => {
    assert.equal(
        formatMessage("**bold** and *emphasis* with `code`"),
        "<p><strong>bold</strong> and <em>emphasis</em> with <code>code</code></p>"
    );
});

test("code blocks and quotes remain escaped", () => {
    const source = [
        "> quoted <value>",
        "",
        "```js",
        "const value = '<script>';",
        "```"
    ].join("\n");
    const result = formatMessage(source);

    assert.match(result, /<blockquote>quoted &lt;value&gt;<\/blockquote>/);
    assert.match(result, /data-language="js"/);
    assert.match(result, /&lt;script&gt;/);
    assert.doesNotMatch(result, /<script>/);
});

test("attachment sizes use readable binary units", () => {
    assert.equal(formatBytes(900), "900 B");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(2 * 1024 * 1024), "2.0 MB");
});