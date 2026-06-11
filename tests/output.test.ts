import test from "node:test";
import assert from "node:assert/strict";
import type { Context } from "telegraf";
import { chunkEscapedText, sendScreen } from "../src/output.ts";
import {
  __resetTerminalBackendsForTests,
  registerTerminalBackend,
} from "../src/terminal/registry.js";
import type {
  TerminalBackend,
  TerminalTarget,
} from "../src/terminal/types.js";

function cmuxTarget(id: string): TerminalTarget {
  return {
    backend: "cmux",
    id,
    label: id,
    ref: `cmux:${id}`,
    cmuxSurface: id,
  };
}

function fakeBackend(target: TerminalTarget, calls: string[]): TerminalBackend {
  return {
    kind: target.backend,
    async isAvailable() {
      return { available: true };
    },
    async defaultTarget() {
      return target;
    },
    async createTarget() {
      return target;
    },
    async targetExists() {
      return true;
    },
    async listTargets() {
      return [target];
    },
    async sendText() {},
    async sendTextAndEnter() {},
    async sendKey() {},
    async capturePane(capturedTarget, lines) {
      calls.push(`capturePane:${capturedTarget.ref}:${lines ?? ""}`);
      return "fake backend output\n";
    },
    async captureVisible(capturedTarget) {
      calls.push(`captureVisible:${capturedTarget.ref}`);
      return "fake visible output\n";
    },
    async targetSignature(capturedTarget) {
      return capturedTarget.ref;
    },
    async openInTerminal() {},
  };
}

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

test("output: sendScreen routes TerminalTarget capture through registered backend", async (t) => {
  __resetTerminalBackendsForTests();
  t.after(() => __resetTerminalBackendsForTests());
  const target = cmuxTarget("surface-1");
  const calls: string[] = [];
  registerTerminalBackend(fakeBackend(target, calls));

  const replies: Array<{ text: string; options?: unknown }> = [];
  const ctx = {
    chat: { id: 101 },
    reply(text: string, options?: unknown) {
      replies.push({ text, options });
      return Promise.resolve();
    },
  } as unknown as Context;

  await sendScreen(ctx, target, 1);

  assert.deepEqual(calls, ["capturePane:cmux:surface-1:50"]);
  assert.deepEqual(replies, [
    {
      text: "<pre>fake backend output</pre>",
      options: { parse_mode: "HTML" },
    },
  ]);
});
