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
  windows: [
    {
      workspaces: [
        {
          id: "workspace-uuid",
          ref: "workspace:1",
          title: "Main",
          panes: [
            {
              surfaces: [
                {
                  id: "surface-uuid",
                  ref: "surface:2",
                  type: "terminal",
                  title: "Shell",
                },
                {
                  id: "browser-uuid",
                  ref: "surface:3",
                  type: "browser",
                  title: "Docs",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

function cmuxTarget(): CmuxTarget {
  return {
    backend: "cmux",
    id: "workspace:1/surface:2",
    label: "Main / Shell",
    ref: "cmux:workspace:1/surface:2",
    cmuxWorkspace: "workspace:1",
    cmuxSurface: "surface:2",
  };
}

function cmuxTargetWithLabel(label: string, workspace = "workspace:1", surface = "surface:2"): CmuxTarget {
  return {
    backend: "cmux",
    id: `${workspace}/${surface}`,
    label,
    ref: `cmux:${workspace}/${surface}`,
    cmuxWorkspace: workspace,
    cmuxSurface: surface,
  };
}

function treeForWorkspace(title: string, workspace = "workspace:1", surface = "surface:2"): string {
  return JSON.stringify({
    windows: [
      {
        workspaces: [
          {
            ref: workspace,
            title,
            panes: [
              {
                ref: "pane:1",
                surfaces: [
                  {
                    ref: surface,
                    type: "terminal",
                    title: "Shell",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
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

  const surfaceArgs = ["--workspace", "workspace:1", "--surface", "surface:2"];
  assert.deepEqual(calls.slice(0, 3), [
    { command: "/opt/cmux", args: ["send", ...surfaceArgs, "--", "text"] },
    { command: "/opt/cmux", args: ["send-key", ...surfaceArgs, "--", "ctrl+c"] },
    { command: "/opt/cmux", args: ["read-screen", ...surfaceArgs, "--scrollback", "--lines", "50"] },
  ]);

  // When scrollback returns fewer lines than expected, capturePane falls back to page scroll
  const keyCalls = calls.filter((c) => c.args[0] === "send-key");
  assert.ok(keyCalls.some((c) => c.args[c.args.length - 1] === "pageup"), "expected pageup");
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

test("cmux backend: does not treat panes or containers as workspaces", () => {
  const tree = JSON.stringify({
    windows: [
      {
        workspaces: [
          {
            ref: "workspace:1",
            title: "Main",
            panes: [
              {
                id: "pane-uuid",
                ref: "pane:1",
                surfaces: [
                  {
                    ref: "surface:2",
                    type: "terminal",
                    title: "Shell",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(parseCmuxTree(tree), [cmuxTarget()]);
});

test("cmux backend: defaultTarget matches cg workspace labels exactly", async () => {
  let treeOutput = treeForWorkspace("cg-123");
  const calls: CmuxCall[] = [];
  const backend = createCmuxBackend({
    async run(command, args) {
      calls.push({ command, args });
      if (args[0] === "tree") {
        return { stdout: treeOutput, stderr: "" };
      }
      if (args[0] === "new-workspace") {
        treeOutput = treeForWorkspace("cg-12", "workspace:12");
      }
      return { stdout: "", stderr: "" };
    },
    getCmuxPath() {
      return "/opt/cmux";
    },
    getStartDir() {
      return "/tmp/cligram";
    },
  });

  assert.deepEqual(await backend.defaultTarget(12), cmuxTargetWithLabel("cg-12 / Shell", "workspace:12"));
  assert.deepEqual(calls.map((call) => call.args[0]), ["tree", "new-workspace", "tree"]);
  assert.deepEqual(calls[1], {
    command: "/opt/cmux",
    args: ["new-workspace", "--name", "cg-12", "--cwd", "/tmp/cligram", "--focus", "false"],
  });
});

test("cmux backend: defaultTarget reuses exact cg workspace label", async () => {
  const { calls, deps } = fakeDeps({ treeOutput: treeForWorkspace("cg-12") });
  const backend = createCmuxBackend(deps);

  assert.deepEqual(await backend.defaultTarget(12), cmuxTargetWithLabel("cg-12 / Shell"));
  assert.deepEqual(calls.map((call) => call.args[0]), ["tree"]);
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

test("cmux backend: isAvailable reports timed out CLI calls as socket unavailable", async () => {
  const timeoutError = Object.assign(new Error("Command timed out"), { code: "ETIMEDOUT" });
  const { deps } = fakeDeps({
    reject: timeoutError,
  });
  const backend = createCmuxBackend(deps);

  assert.deepEqual(await backend.isAvailable(), {
    available: false,
    reason: "socket",
    detail: "cmux CLI 调用超时，当前 socket 可能无响应。请启动或重启 cmux。",
  });
});

test("cmux backend: listTargets queries all cmux windows", async () => {
  const { calls, deps } = fakeDeps({ treeOutput: terminalTree });
  const backend = createCmuxBackend(deps);

  assert.deepEqual(await backend.listTargets(), [cmuxTarget()]);
  assert.deepEqual(calls, [
    {
      command: "/opt/cmux",
      args: ["tree", "--all", "--json"],
    },
  ]);
});

test("cmux backend: openInTerminal throws readable unsupported error", async () => {
  const backend = createCmuxBackend(fakeDeps().deps);

  await assert.rejects(() => backend.openInTerminal(cmuxTarget()), {
    name: "TerminalTargetError",
    message: /cmux.*暂不支持.*打开|open/i,
  });
});

test("cmux backend: capturePane returns scrollback when available", async () => {
  const scrollbackContent = Array.from({ length: 150 }, (_, i) => `line ${i}`).join("\n");
  const calls: CmuxCall[] = [];
  const backend = createCmuxBackend({
    async run(command, args) {
      calls.push({ command, args });
      if (args[0] === "read-screen") {
        if (args.includes("--scrollback")) {
          return { stdout: scrollbackContent, stderr: "" };
        }
        return { stdout: "visible screen", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
    getCmuxPath() { return "/opt/cmux"; },
    getStartDir() { return "/tmp"; },
  });

  const result = await backend.capturePane(cmuxTarget(), 200);
  assert.equal(result, scrollbackContent);

  const keyCalls = calls.filter(c => c.args[0] === "send-key");
  assert.equal(keyCalls.length, 0);
});

test("cmux backend: capturePane falls back to pageup scroll when scrollback is empty", async () => {
  const visibleContent = "line1\nline2\nline3\nline4\nline5";
  const scrolledContent = "older1\nolder2\nolder3\nolder4\nolder5";
  let readScreenCallCount = 0;
  const calls: CmuxCall[] = [];

  const backend = createCmuxBackend({
    async run(command, args) {
      calls.push({ command, args });
      if (args[0] === "read-screen") {
        if (args.includes("--scrollback")) {
          return { stdout: visibleContent, stderr: "" };
        }
        readScreenCallCount++;
        if (readScreenCallCount === 1) {
          return { stdout: visibleContent, stderr: "" };
        }
        return { stdout: scrolledContent, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
    getCmuxPath() { return "/opt/cmux"; },
    getStartDir() { return "/tmp"; },
  });

  const result = await backend.capturePane(cmuxTarget(), 100);

  assert.ok(result.includes("line1"));
  assert.ok(result.includes("older1"));

  const keyCalls = calls.filter(c => c.args[0] === "send-key");
  const keyNames = keyCalls.map(c => c.args[c.args.length - 1]);
  assert.ok(keyNames.includes("pageup"), `expected pageup in ${keyNames}`);
  assert.ok(keyNames.includes("pagedown"), `expected pagedown in ${keyNames}`);
});

test("cmux backend: capturePane stops scrolling when content repeats (reached top)", async () => {
  const sameContent = "top of history\nline2\nline3";
  let readScreenCount = 0;
  const calls: CmuxCall[] = [];

  const backend = createCmuxBackend({
    async run(command, args) {
      calls.push({ command, args });
      if (args[0] === "read-screen") {
        if (args.includes("--scrollback")) {
          return { stdout: sameContent, stderr: "" };
        }
        readScreenCount++;
        return { stdout: sameContent, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
    getCmuxPath() { return "/opt/cmux"; },
    getStartDir() { return "/tmp"; },
  });

  await backend.capturePane(cmuxTarget(), 200);

  const readScreenCalls = calls.filter(c => c.args[0] === "read-screen");
  assert.ok(readScreenCalls.length <= 3, `too many read-screen calls: ${readScreenCalls.length}`);
});

test("cmux backend: capturePane sends correct number of pagedown to restore position", async () => {
  const page1 = "page1_line1\npage1_line2";
  const page2 = "page2_line1\npage2_line2";
  const page3 = "page3_line1\npage3_line2";
  let readScreenCount = 0;
  const calls: CmuxCall[] = [];

  const backend = createCmuxBackend({
    async run(command, args) {
      calls.push({ command, args });
      if (args[0] === "read-screen") {
        if (args.includes("--scrollback")) {
          return { stdout: page1, stderr: "" };
        }
        readScreenCount++;
        if (readScreenCount <= 2) return { stdout: page1, stderr: "" };
        if (readScreenCount <= 4) return { stdout: page2, stderr: "" };
        return { stdout: page3, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
    getCmuxPath() { return "/opt/cmux"; },
    getStartDir() { return "/tmp"; },
  });

  await backend.capturePane(cmuxTarget(), 200);

  const keyCalls = calls.filter(c => c.args[0] === "send-key");
  const keyNames = keyCalls.map(c => c.args[c.args.length - 1]);
  const pageupCount = keyNames.filter(k => k === "pageup").length;
  const pagedownCount = keyNames.filter(k => k === "pagedown").length;

  assert.equal(pagedownCount, pageupCount, `pagedown(${pagedownCount}) should match pageup(${pageupCount})`);
});
