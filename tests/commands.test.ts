import test from "node:test";
import assert from "node:assert/strict";
import { formatTargetList, parseModifierKey } from "../src/commands.ts";
import type { TerminalTarget } from "../src/terminal/types.ts";

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
