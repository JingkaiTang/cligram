import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTargetRef,
  parseAttachRef,
  parseTargetRef,
} from "../src/terminal/target-ref.js";
import { TerminalTargetError } from "../src/terminal/types.js";

test("target-ref: parses tmux session refs", () => {
  assert.deepEqual(parseTargetRef("tmux:work"), {
    backend: "tmux",
    id: "work",
    label: "work",
    ref: "tmux:work",
    tmuxSession: "work",
  });
});

test("target-ref: parses cmux surface-only refs", () => {
  assert.deepEqual(parseTargetRef("cmux:surface:2"), {
    backend: "cmux",
    id: "surface:2",
    label: "surface:2",
    ref: "cmux:surface:2",
    cmuxWorkspace: undefined,
    cmuxSurface: "surface:2",
  });
});

test("target-ref: parses cmux workspace and surface refs", () => {
  assert.deepEqual(parseTargetRef("cmux:workspace:1/surface:2"), {
    backend: "cmux",
    id: "workspace:1/surface:2",
    label: "workspace:1/surface:2",
    ref: "cmux:workspace:1/surface:2",
    cmuxWorkspace: "workspace:1",
    cmuxSurface: "surface:2",
  });
});

test("target-ref: rejects ambiguous and invalid refs", () => {
  assert.throws(() => parseTargetRef(""), {
    name: "TerminalTargetError",
    message: /目标不能为空/,
  });
  assert.throws(() => parseTargetRef("work"), {
    name: "TerminalTargetError",
    message: /缺少后端前缀/,
  });
  assert.throws(() => parseTargetRef("ssh:host"), {
    name: "TerminalTargetError",
    message: /不支持的目标后端/,
  });
  assert.throws(() => parseTargetRef("cmux:workspace:1/"), {
    name: "TerminalTargetError",
    message: /cmux target/,
  });
  assert.throws(() => parseTargetRef("tmux:work:0.0"), {
    name: "TerminalTargetError",
    message: /tmux target|session/,
  });
});

test("target-ref: formats refs from target-like objects", () => {
  assert.equal(formatTargetRef({ backend: "tmux", tmuxSession: "work" }), "tmux:work");
  assert.equal(
    formatTargetRef({
      backend: "cmux",
      cmuxWorkspace: "workspace:1",
      cmuxSurface: "surface:2",
    }),
    "cmux:workspace:1/surface:2",
  );
});

test("target-ref: parseAttachRef keeps legacy tmux names compatible", () => {
  assert.deepEqual(parseAttachRef("work"), { kind: "legacy-tmux", sessionName: "work" });
  assert.deepEqual(parseAttachRef("tmux:work"), {
    kind: "target",
    target: parseTargetRef("tmux:work"),
  });
});

test("target-ref: parse errors use TerminalTargetError", () => {
  assert.throws(() => parseTargetRef("ssh:host"), TerminalTargetError);
});
