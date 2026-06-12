import test from "node:test";
import assert from "node:assert/strict";
import {
  createMockBot,
  createMockContext,
  getReplies,
  type MockBot,
  type MockContext,
} from "./helpers/telegraf-mock.js";
import { loadConfig } from "../src/config.ts";
import { __resetAuthStateForTests, loadPairedUsersFromConfig, pairUser } from "../src/auth.ts";
import {
  __resetSessionStateForTests,
  attachTarget,
} from "../src/session.ts";
import {
  __resetTerminalBackendsForTests,
  registerTerminalBackend,
} from "../src/terminal/registry.js";
import type {
  BackendAvailability,
  BackendKind,
  CreateTargetOptions,
  TerminalBackend,
  TerminalTarget,
} from "../src/terminal/types.js";
import { createTempConfig, withArgvConfig, type TestConfigOverrides } from "./helpers.js";
import { registerCommands } from "../src/commands.js";

// ── helpers ────────────────────────────────────────────

function tmuxTarget(id: string): TerminalTarget {
  return {
    backend: "tmux",
    id,
    label: id,
    ref: `tmux:${id}`,
    tmuxSession: id,
  };
}

function cmuxTarget(id: string): TerminalTarget {
  return {
    backend: "cmux",
    id,
    label: id,
    ref: `cmux:${id}`,
    cmuxSurface: id,
  };
}

interface BackendState {
  defaultTarget: TerminalTarget;
  created: TerminalTarget[];
  sentText: Array<{ target: string; text: string }>;
  sentKeys: Array<{ target: string; key: string }>;
  captured: string;
  listTargetsResult: TerminalTarget[];
  exists: Set<string>;
}

function fakeBackend(
  kind: BackendKind,
  state: BackendState,
): TerminalBackend {
  return {
    kind,
    async isAvailable(): Promise<BackendAvailability> {
      return { available: true };
    },
    async defaultTarget() {
      return state.defaultTarget;
    },
    async createTarget(_chatId, options: CreateTargetOptions = {}) {
      const name = options.name ?? `${kind}-created-${state.created.length + 1}`;
      const target = kind === "tmux" ? tmuxTarget(name) : cmuxTarget(name);
      state.created.push(target);
      state.exists.add(target.ref);
      return target;
    },
    async targetExists(target) {
      return state.exists.has(target.ref);
    },
    async listTargets() {
      return state.listTargetsResult;
    },
    async sendText(target, text) {
      state.sentText.push({ target: target.ref, text });
    },
    async sendTextAndEnter(target, text) {
      state.sentText.push({ target: target.ref, text: `${text}\n` });
    },
    async sendKey(target, key) {
      state.sentKeys.push({ target: target.ref, key });
    },
    async capturePane() {
      return state.captured;
    },
    async captureVisible() {
      return state.captured;
    },
    async targetSignature(target) {
      return target.ref;
    },
    async openInTerminal() {},
  };
}

async function setupTest(configOverrides: TestConfigOverrides = {}) {
  const configPath = await createTempConfig(configOverrides);

  await withArgvConfig(configPath, async () => {
    await loadConfig();
  });

  __resetAuthStateForTests();
  __resetSessionStateForTests();
  __resetTerminalBackendsForTests();

  loadPairedUsersFromConfig();

  const bot = createMockBot();
  registerCommands(bot as any);

  return { bot, configPath };
}

async function setupPairedTest(configOverrides: TestConfigOverrides = {}) {
  const result = await setupTest(configOverrides);
  await pairUser(42);
  return result;
}

function setupBackend(kind: BackendKind, state: Partial<BackendState> = {}) {
  const fullState: BackendState = {
    defaultTarget: tmuxTarget("cg-default"),
    created: [],
    sentText: [],
    sentKeys: [],
    captured: "mock output",
    listTargetsResult: [],
    exists: new Set(),
    ...state,
  };
  registerTerminalBackend(fakeBackend(kind, fullState));
  return fullState;
}

// ── tests ──────────────────────────────────────────────

test.afterEach(() => {
  __resetAuthStateForTests();
  __resetSessionStateForTests();
  __resetTerminalBackendsForTests();
});

// /start

test("commands: /start sends welcome message", async () => {
  const { bot } = await setupTest();
  const ctx = createMockContext();
  const handler = bot.getStartHandler();
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("欢迎使用 cligram"));
});

// /pair

test("commands: /pair sends pair code for new user", async () => {
  const { bot } = await setupTest();
  const ctx = createMockContext({ message: { text: "/pair" } });
  const handler = bot.getHandler("pair");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("配对码"));
});

test("commands: /pair rejects already paired user", async () => {
  const { bot } = await setupPairedTest();
  const ctx = createMockContext({ message: { text: "/pair" } });
  const handler = bot.getHandler("pair");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("已经配对"));
});

// /unpair

test("commands: /unpair requires auth", async () => {
  const { bot } = await setupTest();
  const ctx = createMockContext({
    from: { id: 999 },
    message: { text: "/unpair" },
  });
  const handler = bot.getHandler("unpair");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("未配对"));
});

test("commands: /unpair removes pairing", async () => {
  const { bot } = await setupPairedTest();
  const ctx = createMockContext({ message: { text: "/unpair" } });
  const handler = bot.getHandler("unpair");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("已取消配对"));
});

// /help

test("commands: /help lists available commands", async () => {
  const { bot } = await setupPairedTest();
  const ctx = createMockContext({ message: { text: "/help" } });
  const handler = bot.getHandler("help");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("/exec"));
  assert.ok(replies[0].text.includes("/screen"));
  assert.ok(replies[0].text.includes("/targets"));
});

// /mode

test("commands: /mode shows current mode", async () => {
  const { bot } = await setupPairedTest();
  const ctx = createMockContext({ message: { text: "/mode" } });
  const handler = bot.getHandler("mode");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("text"));
});

test("commands: /mode switches to image", async () => {
  const { bot } = await setupPairedTest();
  const ctx = createMockContext({ message: { text: "/mode image" } });
  const handler = bot.getHandler("mode");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("image"));
});

test("commands: /mode rejects invalid mode", async () => {
  const { bot } = await setupPairedTest();
  const ctx = createMockContext({ message: { text: "/mode invalid" } });
  const handler = bot.getHandler("mode");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("无效模式"));
});

// /new

test("commands: /new creates new terminal target", async () => {
  const { bot } = await setupPairedTest();
  const state = setupBackend("tmux");
  const ctx = createMockContext({ message: { text: "/new" } });
  const handler = bot.getHandler("new");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.ok(replies.length >= 1);
  assert.ok(replies.some(r => r.text.includes("已创建新的终端目标")));
  assert.equal(state.created.length, 1);
});

// /exec

test("commands: /exec sends command to terminal", async () => {
  const { bot } = await setupPairedTest();
  const state = setupBackend("tmux", { captured: "$ ls\nfile1 file2\n" });
  const ctx = createMockContext({ message: { text: "/exec ls -la" } });
  const handler = bot.getHandler("exec");
  assert.ok(handler);

  await handler!(ctx);
  assert.equal(state.sentText.length, 1);
  assert.ok(state.sentText[0].text.includes("ls -la"));
});

test("commands: /exec rejects empty command", async () => {
  const { bot } = await setupPairedTest();
  setupBackend("tmux");
  const ctx = createMockContext({ message: { text: "/exec" } });
  const handler = bot.getHandler("exec");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("用法"));
});

test("commands: /exec blocked by whitelist", async () => {
  const { bot } = await setupPairedTest({
    commandSafetyMode: "whitelist",
    commandAllowlist: ["ls"],
  });
  setupBackend("tmux");
  const ctx = createMockContext({ message: { text: "/exec rm -rf /" } });
  const handler = bot.getHandler("exec");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("安全策略已阻止"));
});

// /cd

test("commands: /cd sends cd command", async () => {
  const { bot } = await setupPairedTest();
  const state = setupBackend("tmux");
  const ctx = createMockContext({ message: { text: "/cd /tmp" } });
  const handler = bot.getHandler("cd");
  assert.ok(handler);

  await handler!(ctx);
  assert.equal(state.sentText.length, 1);
  assert.ok(state.sentText[0].text.includes("cd -- '/tmp'"));
});

test("commands: /cd rejects empty path", async () => {
  const { bot } = await setupPairedTest();
  setupBackend("tmux");
  const ctx = createMockContext({ message: { text: "/cd" } });
  const handler = bot.getHandler("cd");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("用法"));
});

// /ls, /pwd

test("commands: /ls sends ls -alh", async () => {
  const { bot } = await setupPairedTest();
  const state = setupBackend("tmux");
  const ctx = createMockContext({ message: { text: "/ls" } });
  const handler = bot.getHandler("ls");
  assert.ok(handler);

  await handler!(ctx);
  assert.equal(state.sentText.length, 1);
  assert.ok(state.sentText[0].text.includes("ls -alh"));
});

test("commands: /pwd sends pwd", async () => {
  const { bot } = await setupPairedTest();
  const state = setupBackend("tmux");
  const ctx = createMockContext({ message: { text: "/pwd" } });
  const handler = bot.getHandler("pwd");
  assert.ok(handler);

  await handler!(ctx);
  assert.equal(state.sentText.length, 1);
  assert.ok(state.sentText[0].text.includes("pwd"));
});

// 键盘按键

test("commands: /enter sends Enter key", async () => {
  const { bot } = await setupPairedTest();
  const state = setupBackend("tmux");
  const ctx = createMockContext({ message: { text: "/enter" } });
  const handler = bot.getHandler("enter");
  assert.ok(handler);

  await handler!(ctx);
  assert.equal(state.sentKeys.length, 1);
  assert.equal(state.sentKeys[0].key, "Enter");
});

test("commands: /up /down /left /right send arrow keys", async () => {
  const { bot } = await setupPairedTest();
  const state = setupBackend("tmux");

  for (const [dir, expected] of [["up", "Up"], ["down", "Down"], ["left", "Left"], ["right", "Right"]] as const) {
    state.sentKeys.length = 0;
    const ctx = createMockContext({ message: { text: `/${dir}` } });
    const handler = bot.getHandler(dir);
    assert.ok(handler);

    await handler!(ctx);
    assert.equal(state.sentKeys.length, 1);
    assert.equal(state.sentKeys[0].key, expected);
  }
});

test("commands: /esc sends Escape key", async () => {
  const { bot } = await setupPairedTest();
  const state = setupBackend("tmux");
  const ctx = createMockContext({ message: { text: "/esc" } });
  const handler = bot.getHandler("esc");
  assert.ok(handler);

  await handler!(ctx);
  assert.equal(state.sentKeys.length, 1);
  assert.equal(state.sentKeys[0].key, "Escape");
});

// 修饰键

test("commands: /ctrl sends C- prefix", async () => {
  const { bot } = await setupPairedTest();
  const state = setupBackend("tmux");
  const ctx = createMockContext({ message: { text: "/ctrl + c" } });
  const handler = bot.getHandler("ctrl");
  assert.ok(handler);

  await handler!(ctx);
  assert.equal(state.sentKeys.length, 1);
  assert.equal(state.sentKeys[0].key, "C-c");
});

test("commands: /alt sends M- prefix", async () => {
  const { bot } = await setupPairedTest();
  const state = setupBackend("tmux");
  const ctx = createMockContext({ message: { text: "/alt + x" } });
  const handler = bot.getHandler("alt");
  assert.ok(handler);

  await handler!(ctx);
  assert.equal(state.sentKeys.length, 1);
  assert.equal(state.sentKeys[0].key, "M-x");
});

test("commands: /cmd maps to C- prefix", async () => {
  const { bot } = await setupPairedTest();
  const state = setupBackend("tmux");
  const ctx = createMockContext({ message: { text: "/cmd + c" } });
  const handler = bot.getHandler("cmd");
  assert.ok(handler);

  await handler!(ctx);
  assert.equal(state.sentKeys.length, 1);
  assert.equal(state.sentKeys[0].key, "C-c");
});

test("commands: /ctrl rejects invalid format", async () => {
  const { bot } = await setupPairedTest();
  setupBackend("tmux");
  const ctx = createMockContext({ message: { text: "/ctrl" } });
  const handler = bot.getHandler("ctrl");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("用法"));
});

// /targets, /sessions

test("commands: /targets lists available targets", async () => {
  const { bot } = await setupPairedTest();
  setupBackend("tmux", {
    listTargetsResult: [tmuxTarget("work"), tmuxTarget("ops")],
  });
  const ctx = createMockContext({ message: { text: "/targets" } });
  const handler = bot.getHandler("targets");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("终端目标列表"));
  assert.ok(replies[0].text.includes("tmux:work"));
  assert.ok(replies[0].text.includes("tmux:ops"));
});

test("commands: /sessions is alias for /targets", async () => {
  const { bot } = await setupPairedTest();
  setupBackend("tmux", {
    listTargetsResult: [tmuxTarget("work")],
  });
  const ctx = createMockContext({ message: { text: "/sessions" } });
  const handler = bot.getHandler("sessions");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("终端目标列表"));
  assert.ok(replies[0].text.includes("tmux:work"));
});

// /attach

test("commands: /attach binds to target", async () => {
  const { bot } = await setupPairedTest();
  setupBackend("tmux", {
    listTargetsResult: [tmuxTarget("work")],
    exists: new Set(["tmux:work"]),
  });
  const ctx = createMockContext({ message: { text: "/attach tmux:work" } });
  const handler = bot.getHandler("attach");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.ok(replies.some(r => r.text.includes("已绑定")));
});

test("commands: /attach rejects empty arg", async () => {
  const { bot } = await setupPairedTest();
  setupBackend("tmux");
  const ctx = createMockContext({ message: { text: "/attach" } });
  const handler = bot.getHandler("attach");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("用法"));
});

// /detach

test("commands: /detach clears binding", async () => {
  const { bot } = await setupPairedTest();
  const backendState = setupBackend("tmux");
  backendState.exists.add("tmux:work");
  await attachTarget(100, tmuxTarget("work"));

  const ctx = createMockContext({ message: { text: "/detach" } });
  const handler = bot.getHandler("detach");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("已解绑"));
});

test("commands: /detach with no binding", async () => {
  const { bot } = await setupPairedTest();
  setupBackend("tmux");
  const ctx = createMockContext({ message: { text: "/detach" } });
  const handler = bot.getHandler("detach");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("没有绑定"));
});

// /screen

test("commands: /screen captures screen", async () => {
  const { bot } = await setupPairedTest();
  setupBackend("tmux", { captured: "terminal content here" });
  const ctx = createMockContext({ message: { text: "/screen" } });
  const handler = bot.getHandler("screen");
  assert.ok(handler);

  await handler!(ctx);
  const replies = getReplies(ctx);
  assert.ok(replies.length >= 1);
  assert.ok(replies[0].text.includes("terminal content here"));
});

// 纯文本消息

test("commands: plain text sent to terminal without enter", async () => {
  const { bot } = await setupPairedTest();
  const state = setupBackend("tmux");
  const ctx = createMockContext({ message: { text: "hello world" } });
  const handler = bot.getTextHandler();
  assert.ok(handler);

  await handler!(ctx);
  assert.equal(state.sentText.length, 1);
  assert.equal(state.sentText[0].text, "hello world");
});

// 认证中间件

test("commands: authenticated commands reject unpaired users", async () => {
  const { bot } = await setupTest();
  const commands = ["exec", "cd", "ls", "pwd", "screen", "mode", "new",
    "enter", "up", "down", "left", "right", "esc",
    "ctrl", "alt", "shift", "cmd", "targets", "attach", "detach", "open"];

  for (const cmd of commands) {
    const ctx = createMockContext({ message: { text: `/${cmd}` } });
    const handler = bot.getHandler(cmd);
    assert.ok(handler, `handler for /${cmd} not found`);

    await handler!(ctx);
    const replies = getReplies(ctx);
    assert.ok(
      replies.some(r => r.text.includes("未配对")),
      `/${cmd} should reject unpaired user`,
    );
  }
});
