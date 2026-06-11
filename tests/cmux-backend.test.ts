import test from "node:test";
import assert from "node:assert/strict";
import {
  createCmuxBackend,
  parseCmuxTree,
  translateCmuxKey,
} from "../src/terminal/cmux-backend.js";
import type { CmuxTarget } from "../src/terminal/types.js";

type CmuxCall = { command: string; args: string[] };

const terminalTree = JSON.stringify({
  workspaces: [
    {
      id: "workspace:1",
      title: "Alpha",
      surfaces: [
        { id: "surface:2", title: "Shell", type: "terminal" },
        { id: "surface:3", title: "Docs", type: "browser" },
      ],
    },
  ],
});

function cmuxTarget(): CmuxTarget {
  return {
    backend: "cmux",
    id: "workspace:1/surface:2",
    label: "Alpha / Shell",
    ref: "cmux:workspace:1/surface:2",
    cmuxWorkspace: "workspace:1",
    cmuxSurface: "surface:2",
  };
}

function fakeDeps(options: {
  treeOutput?: string;
  reject?: Error;
  cmuxPath?: string;
} = {}) {
  const calls: CmuxCall[] = [];
  return {
    calls,
    deps: {
      async run(command: string, args: string[]) {
        calls.push({ command, args });
        if (options.reject) {
          throw options.reject;
        }
        if (args[0] === "tree") {
          return { stdout: options.treeOutput ?? terminalTree, stderr: "" };
        }
        if (args[0] === "read-screen") {
          return { stdout: "screen text", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      },
      getCmuxPath() {
        return options.cmuxPath ?? "/opt/cmux";
      },
      getStartDir() {
        return "/tmp/cligram";
      },
    },
  };
}

test("cmux backend: translates tmux-style keys to cmux key names", () => {
  assert.equal(translateCmuxKey("Enter"), "enter");
  assert.equal(translateCmuxKey("Escape"), "escape");
  assert.equal(translateCmuxKey("Up"), "up");
  assert.equal(translateCmuxKey("Down"), "down");
  assert.equal(translateCmuxKey("Left"), "left");
  assert.equal(translateCmuxKey("Right"), "right");
  assert.equal(translateCmuxKey("C-c"), "ctrl+c");
  assert.equal(translateCmuxKey("M-x"), "alt+x");
  assert.equal(translateCmuxKey("S-tab"), "shift+tab");
});

test("cmux backend: sends text, keys, and scrollback capture to explicit workspace surface", async () => {
  const { calls, deps } = fakeDeps();
  const backend = createCmuxBackend(deps);
  const target = cmuxTarget();

  await backend.sendText(target, "text");
  await backend.sendKey(target, "C-c");
  assert.equal(await backend.capturePane(target, 50), "screen text");

  assert.deepEqual(calls, [
    {
      command: "/opt/cmux",
      args: ["send", "--workspace", "workspace:1", "--surface", "surface:2", "--", "text"],
    },
    {
      command: "/opt/cmux",
      args: [
        "send-key",
        "--workspace",
        "workspace:1",
        "--surface",
        "surface:2",
        "--",
        "ctrl+c",
      ],
    },
    {
      command: "/opt/cmux",
      args: [
        "read-screen",
        "--workspace",
        "workspace:1",
        "--surface",
        "surface:2",
        "--scrollback",
        "--lines",
        "50",
      ],
    },
  ]);
});

test("cmux backend: visible capture reads current screen without scrollback args", async () => {
  const { calls, deps } = fakeDeps();
  const backend = createCmuxBackend(deps);

  assert.equal(await backend.captureVisible(cmuxTarget()), "screen text");

  assert.deepEqual(calls, [
    {
      command: "/opt/cmux",
      args: ["read-screen", "--workspace", "workspace:1", "--surface", "surface:2"],
    },
  ]);
});

test("cmux backend: parses terminal surfaces from cmux tree json", async () => {
  assert.deepEqual(parseCmuxTree(terminalTree), [cmuxTarget()]);

  const { deps } = fakeDeps({ treeOutput: terminalTree });
  const backend = createCmuxBackend(deps);

  assert.deepEqual(await backend.listTargets(), [cmuxTarget()]);
});

test("cmux backend: isAvailable reports broken socket as socket unavailable", async () => {
  const { deps } = fakeDeps({
    reject: new Error("Failed to write to socket (Broken pipe, errno 32)"),
  });
  const backend = createCmuxBackend(deps);

  assert.deepEqual(await backend.isAvailable(), {
    available: false,
    reason: "socket",
    detail: "cmux 已安装，但当前 socket 不可用。请启动或重启 cmux。",
  });
});

test("cmux backend: openInTerminal throws readable unsupported error", async () => {
  const backend = createCmuxBackend(fakeDeps().deps);

  await assert.rejects(() => backend.openInTerminal(cmuxTarget()), {
    name: "TerminalTargetError",
    message: /cmux.*暂不支持.*打开|open/i,
  });
});
