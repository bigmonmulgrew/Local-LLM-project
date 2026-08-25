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

test("headings and both common list styles are rendered", () => {
    const result = formatMessage([
        "## Tasks",
        "",
        "* first",
        "- second",
        "",
        "1. one",
        "2. two"
    ].join("\n"));

    assert.match(result, /<h2>Tasks<\/h2>/);
    assert.match(result, /<ul><li>first<\/li><li>second<\/li><\/ul>/);
    assert.match(result, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
});

test("links are restricted to safe targets", () => {
    const result = formatMessage([
        "[safe](https://example.com)",
        "[unsafe](javascript:alert(1))"
    ].join("\n"));

    assert.match(result, /href="https:\/\/example.com"/);
    assert.doesNotMatch(result, /href="javascript:/);
    assert.doesNotMatch(result, /<script>/);
});

test("attachment sizes use readable binary units", () => {
    assert.equal(formatBytes(900), "900 B");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(2 * 1024 * 1024), "2.0 MB");
});
