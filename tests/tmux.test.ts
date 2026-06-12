import test from "node:test";
import assert from "node:assert/strict";
import { __shellEscapeForTests as shellEscape } from "../src/tmux.ts";

test("tmux: shellEscape passes safe alphanumeric strings through", () => {
  assert.equal(shellEscape("simple"), "simple");
  assert.equal(shellEscape("test123"), "test123");
});

test("tmux: shellEscape passes safe path characters through", () => {
  assert.equal(shellEscape("path/to/file"), "path/to/file");
  assert.equal(shellEscape("/usr/local/bin"), "/usr/local/bin");
  assert.equal(shellEscape("name-1.0"), "name-1.0");
  assert.equal(shellEscape("under_score"), "under_score");
});

test("tmux: shellEscape quotes strings with spaces", () => {
  assert.equal(shellEscape("hello world"), "'hello world'");
});

test("tmux: shellEscape quotes strings with special shell chars", () => {
  assert.equal(shellEscape("file;rm -rf /"), "'file;rm -rf /'");
  assert.equal(shellEscape("a&&b"), "'a&&b'");
  assert.equal(shellEscape("a|b"), "'a|b'");
});

test("tmux: shellEscape escapes single quotes inside quoted strings", () => {
  assert.equal(shellEscape("it's"), "'it'\\''s'");
  assert.equal(shellEscape("don't"), "'don'\\''t'");
});

test("tmux: shellEscape handles empty string", () => {
  // Empty string doesn't match safe pattern, so it gets quoted
  assert.equal(shellEscape(""), "''");
});
