import test from "node:test";
import assert from "node:assert/strict";
import { buildCdCommand, formatTargetList, parseModifierKey } from "../src/commands.js";
import type { TerminalTarget } from "../src/terminal/types.js";

test("commands: parseModifierKey supports common styles", () => {
  assert.equal(parseModifierKey("/ctrl + c", "ctrl"), "c");
  assert.equal(parseModifierKey("/CTRL+c", "ctrl"), "c");
  assert.equal(parseModifierKey("/alt x", "alt"), "x");
  assert.equal(parseModifierKey("/cmd    +   K", "cmd"), "k");
});

test("commands: parseModifierKey returns null for invalid input", () => {
  assert.equal(parseModifierKey("/ctrl", "ctrl"), null);
  assert.equal(parseModifierKey("ctrl + c", "ctrl"), null);
  assert.equal(parseModifierKey("/shift", "shift"), null);
});

test("commands: buildCdCommand quotes shell metacharacters as a single argument", () => {
  assert.equal(buildCdCommand("/tmp/a; rm -rf / && echo nope"), "cd -- '/tmp/a; rm -rf / && echo nope'");
});

test("commands: buildCdCommand escapes single quotes and preserves newlines inside argument", () => {
  assert.equal(
    buildCdCommand("/tmp/it's\nfine"),
    "cd -- '/tmp/it'\\''s\nfine'",
  );
});

test("commands: formatTargetList groups targets and marks current binding", () => {
  const targets: TerminalTarget[] = [
    {
      backend: "tmux",
      id: "work",
      label: "work",
      ref: "tmux:work",
      tmuxSession: "work",
    },
    {
      backend: "cmux",
      id: "ops/shell",
      label: "ops/shell",
      ref: "cmux:ops/shell",
      cmuxWorkspace: "ops",
      cmuxSurface: "shell",
    },
    {
      backend: "tmux",
      id: "scratch",
      label: "scratch",
      ref: "tmux:scratch",
      tmuxSession: "scratch",
    },
    {
      backend: "cmux",
      id: "logs",
      label: "logs",
      ref: "cmux:logs",
      cmuxSurface: "logs",
    },
  ];

  assert.equal(
    formatTargetList(targets, targets[1]),
    [
      "<b>终端目标列表:</b>",
      "",
      "<b>tmux:</b>",
      "• <code>tmux:work</code> — work",
      "• <code>tmux:scratch</code> — scratch",
      "",
      "<b>cmux:</b>",
      "• <code>cmux:ops/shell</code> — ops/shell ← 当前绑定",
      "• <code>cmux:logs</code> — logs",
    ].join("\n"),
  );
});

test("commands: formatTargetList escapes target refs and labels for HTML", () => {
  const target: TerminalTarget = {
    backend: "tmux",
    id: "bad<x>",
    label: "A & B",
    ref: "tmux:bad<x>",
    tmuxSession: "bad<x>",
  };

  assert.equal(
    formatTargetList([target], target),
    [
      "<b>终端目标列表:</b>",
      "",
      "<b>tmux:</b>",
      "• <code>tmux:bad&lt;x&gt;</code> — A &amp; B ← 当前绑定",
    ].join("\n"),
  );
});
