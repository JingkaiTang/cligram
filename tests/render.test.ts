import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  __displayWidthForTests as displayWidth,
  __escapeXmlForTests as escapeXml,
  renderTerminalImage,
} from "../src/render.ts";
import { loadConfig } from "../src/config.ts";
import { createTempConfig, withArgvConfig } from "./helpers.ts";

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

test("render: terminal image tolerates ANSI and control characters from terminal output", async () => {
  const configPath = await createTempConfig();
  await withArgvConfig(configPath, async () => {
    await loadConfig();
  });

  const png = await renderTerminalImage("normal\n\u001b[31mred text\u001b[0m\nbell:\u0007 done");

  assert.ok(png.length > 0);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
});

test("render: terminal image wraps very long lines to a bounded width", async () => {
  const configPath = await createTempConfig();
  await withArgvConfig(configPath, async () => {
    await loadConfig();
  });

  const png = await renderTerminalImage("x".repeat(1000));
  const metadata = await sharp(png).metadata();

  assert.ok((metadata.width ?? 0) <= 3000);
  assert.ok((metadata.height ?? 0) > 84);
});
