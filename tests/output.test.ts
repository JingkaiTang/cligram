import test from "node:test";
import assert from "node:assert/strict";
import { chunkEscapedText } from "../src/output.ts";

test("output: chunkEscapedText keeps short text in one chunk", () => {
  const chunks = chunkEscapedText("hello\nworld", 100);
  assert.deepEqual(chunks, ["hello\nworld"]);
});

test("output: chunkEscapedText splits by lines when needed", () => {
  const chunks = chunkEscapedText("line1\nline2\nline3", 20);
  assert.deepEqual(chunks, ["line1", "line2", "line3"]);
});

test("output: chunkEscapedText hard-splits super long single line", () => {
  const chunks = chunkEscapedText("abcdefghij", 20);
  assert.deepEqual(chunks, ["abcdefg", "hij"]);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 7);
  }
});
