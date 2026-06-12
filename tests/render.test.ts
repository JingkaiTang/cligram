import test from "node:test";
import assert from "node:assert/strict";
import { __escapeXmlForTests as escapeXml, __displayWidthForTests as displayWidth } from "../src/render.ts";

test("render: escapeXml escapes ampersand", () => {
  assert.equal(escapeXml("a & b"), "a &amp; b");
});

test("render: escapeXml escapes angle brackets", () => {
  assert.equal(escapeXml("<div>text</div>"), "&lt;div&gt;text&lt;/div&gt;");
});

test("render: escapeXml escapes quotes", () => {
  assert.equal(escapeXml('"hello"'), "&quot;hello&quot;");
  assert.equal(escapeXml("it's"), "it&apos;s");
});

test("render: escapeXml handles combined special chars", () => {
  assert.equal(
    escapeXml("a & b < c > d"),
    "a &amp; b &lt; c &gt; d",
  );
});

test("render: escapeXml passes plain text through", () => {
  assert.equal(escapeXml("hello world 123"), "hello world 123");
});

test("render: displayWidth counts ASCII characters as 1", () => {
  assert.equal(displayWidth("hello"), 5);
  assert.equal(displayWidth(""), 0);
  assert.equal(displayWidth("abc"), 3);
});

test("render: displayWidth counts CJK characters as 2", () => {
  assert.equal(displayWidth("你好"), 4);
  assert.equal(displayWidth("你好世界"), 8);
});

test("render: displayWidth handles mixed ASCII and CJK", () => {
  assert.equal(displayWidth("a你b"), 4); // 1 + 2 + 1
  assert.equal(displayWidth("hi你好"), 6); // 2 + 4
});

test("render: displayWidth handles fullwidth forms as 2", () => {
  // Fullwidth Latin letters: Ａ (U+FF21)
  assert.equal(displayWidth("Ａ"), 2);
});

test("render: displayWidth handles empty string", () => {
  assert.equal(displayWidth(""), 0);
});
