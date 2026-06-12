import test from "node:test";
import assert from "node:assert/strict";
import {
  __escapeHtmlForTests as escapeHtml,
  __trimOutputForTests as trimOutput,
  __detectInteractivePromptForTests as detectInteractivePrompt,
} from "../src/output.ts";

// ── escapeHtml ─────────────────────────────────────────

test("output helpers: escapeHtml escapes ampersand", () => {
  assert.equal(escapeHtml("a & b"), "a &amp; b");
});

test("output helpers: escapeHtml escapes angle brackets", () => {
  assert.equal(escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("output helpers: escapeHtml passes plain text through", () => {
  assert.equal(escapeHtml("hello world"), "hello world");
});

// ── trimOutput ─────────────────────────────────────────

test("output helpers: trimOutput removes trailing empty lines", () => {
  assert.equal(trimOutput("line1\n\n\n"), "line1");
  assert.equal(trimOutput("line1\nline2\n\n"), "line1\nline2");
});

test("output helpers: trimOutput preserves content lines", () => {
  assert.equal(trimOutput("line1\nline2\n"), "line1\nline2");
  assert.equal(trimOutput("line1\nline2"), "line1\nline2");
});

test("output helpers: trimOutput handles empty string", () => {
  assert.equal(trimOutput(""), "");
});

test("output helpers: trimOutput handles only whitespace lines", () => {
  assert.equal(trimOutput("   \n  \n"), "");
});

test("output helpers: trimOutput preserves internal empty lines", () => {
  assert.equal(trimOutput("line1\n\nline3"), "line1\n\nline3");
});

// ── detectInteractivePrompt ────────────────────────────

test("output helpers: detectInteractivePrompt detects [Y/n]", () => {
  assert.equal(detectInteractivePrompt("[Y/n]"), true);
  assert.equal(detectInteractivePrompt("Continue? [Y/n]"), true);
});

test("output helpers: detectInteractivePrompt detects [y/N]", () => {
  assert.equal(detectInteractivePrompt("[y/N]"), true);
});

test("output helpers: detectInteractivePrompt detects (yes/no)", () => {
  assert.equal(detectInteractivePrompt("(yes/no)"), true);
});

test("output helpers: detectInteractivePrompt detects password prompt", () => {
  assert.equal(detectInteractivePrompt("password:"), true);
  assert.equal(detectInteractivePrompt("Password: "), true);
  assert.equal(detectInteractivePrompt("enter password: "), true);
});

test("output helpers: detectInteractivePrompt detects sudo prompt", () => {
  assert.equal(detectInteractivePrompt("[sudo] password for user:"), true);
});

test("output helpers: detectInteractivePrompt detects press any key", () => {
  assert.equal(detectInteractivePrompt("press any key to continue"), true);
  assert.equal(detectInteractivePrompt("Press any key"), true);
});

test("output helpers: detectInteractivePrompt detects press enter", () => {
  assert.equal(detectInteractivePrompt("press enter"), true);
});

test("output helpers: detectInteractivePrompt detects continue?", () => {
  assert.equal(detectInteractivePrompt("continue?"), true);
  assert.equal(detectInteractivePrompt("Continue?"), true);
});

test("output helpers: detectInteractivePrompt detects proceed?", () => {
  assert.equal(detectInteractivePrompt("proceed?"), true);
});

test("output helpers: detectInteractivePrompt returns false for normal output", () => {
  assert.equal(detectInteractivePrompt("Hello, World!"), false);
  assert.equal(detectInteractivePrompt("total 42"), false);
  assert.equal(detectInteractivePrompt("ls -la"), false);
  assert.equal(detectInteractivePrompt(""), false);
});
