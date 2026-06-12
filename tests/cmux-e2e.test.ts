import test from "node:test";
import assert from "node:assert/strict";
import {
  createMockBot,
  dispatchTextMessage,
  getReplies,
} from "./helpers/telegraf-mock.js";
import { createTempConfig, withArgvConfig, type TestConfigOverrides } from "./helpers.js";
import { loadConfig } from "../src/config.js";
import { __resetAuthStateForTests, loadPairedUsersFromConfig, pairUser } from "../src/auth.js";
import { __resetSessionStateForTests } from "../src/session.js";
import { stopMonitor } from "../src/output.js";
import { registerCommands } from "../src/commands.js";
import {
  __resetTerminalBackendsForTests,
  registerTerminalBackend,
} from "../src/terminal/registry.js";
import type {
  BackendAvailability,
  CreateTargetOptions,
  TerminalBackend,
  TerminalTarget,
} from "../src/terminal/types.js";

function cmuxTarget(workspace: string, surface: string): TerminalTarget {
  const id = `${workspace}/${surface}`;
  return {
    backend: "cmux",
    id,
    label: `${workspace} / ${surface}`,
    ref: `cmux:${id}`,
    cmuxWorkspace: workspace,
    cmuxSurface: surface,
  };
}

interface CmuxE2EState {
  targets: TerminalTarget[];
  sentText: Array<{ target: string; text: string; enter: boolean }>;
  sentKeys: Array<{ target: string; key: string }>;
  screen: string;
}

function fakeCmuxBackend(state: CmuxE2EState): TerminalBackend {
  return {
    kind: "cmux",
    async isAvailable(): Promise<BackendAvailability> {
      return { available: true };
    },
    async defaultTarget() {
      return state.targets[0];
    },
    async createTarget(_chatId: number, options: CreateTargetOptions = {}) {
      const name = options.name ?? `cg-${state.targets.length + 1}`;
      const target = cmuxTarget(name, "shell");
      state.targets.push(target);
      return target;
    },
    async targetExists(target) {
      return state.targets.some((candidate) => candidate.ref === target.ref);
    },
    async listTargets() {
      return state.targets;
    },
    async sendText(target, text) {
      state.sentText.push({ target: target.ref, text, enter: false });
      state.screen += text;
    },
    async sendTextAndEnter(target, text) {
      state.sentText.push({ target: target.ref, text, enter: true });
      state.screen += `\n$ ${text}\n/Users/t7kai/workspace/playground/cligram\n`;
    },
    async sendKey(target, key) {
      state.sentKeys.push({ target: target.ref, key });
    },
    async capturePane() {
      return state.screen;
    },
    async captureVisible() {
      return state.screen;
    },
    async targetSignature(target) {
      return `${target.ref}:${state.screen.length}:${state.screen.slice(-80)}`;
    },
    async openInTerminal() {},
  };
}

async function setupPairedBot(configOverrides: TestConfigOverrides = {}) {
  const configPath = await createTempConfig({
    outputDelayMs: 1,
    pollIntervalMs: 60000,
    idleTimeoutMs: 60000,
    ...configOverrides,
  });

  await withArgvConfig(configPath, async () => {
    await loadConfig();
  });

  __resetAuthStateForTests();
  __resetSessionStateForTests();
  __resetTerminalBackendsForTests();
  loadPairedUsersFromConfig();
  await pairUser(42);

  const bot = createMockBot();
  registerCommands(bot as any);
  return bot;
}

test.afterEach(() => {
  stopMonitor(100);
  __resetAuthStateForTests();
  __resetSessionStateForTests();
  __resetTerminalBackendsForTests();
});

test("e2e: Telegram 用户可以列出、绑定并操作 cmux 终端目标", async () => {
  const target = cmuxTarget("ops", "shell");
  const state: CmuxE2EState = {
    targets: [target],
    sentText: [],
    sentKeys: [],
    screen: "cmux shell ready\n",
  };
  const bot = await setupPairedBot();
  registerTerminalBackend(fakeCmuxBackend(state));

  const targetsCtx = await dispatchTextMessage(bot, "/targets");
  assert.equal(getReplies(targetsCtx).length, 1);
  assert.match(getReplies(targetsCtx)[0].text, /cmux:ops\/shell/);

  const attachCtx = await dispatchTextMessage(bot, "/attach cmux:ops/shell");
  assert.ok(getReplies(attachCtx).some((reply) => reply.text.includes("已绑定到终端目标")));

  const execCtx = await dispatchTextMessage(bot, "/exec pwd");
  assert.deepEqual(state.sentText, [
    { target: "cmux:ops/shell", text: "pwd", enter: true },
  ]);
  assert.ok(getReplies(execCtx).some((reply) => reply.text.includes("/Users/t7kai/workspace/playground/cligram")));

  await dispatchTextMessage(bot, "echo typed-without-enter");
  assert.deepEqual(state.sentText.at(-1), {
    target: "cmux:ops/shell",
    text: "echo typed-without-enter",
    enter: false,
  });
});

test("e2e: /mode image 后 /screen 将带控制字符的终端上下文作为图片发送", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let fetchCalled = false;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    fetchCalled = true;
    assert.equal(init?.method, "POST");
    assert.ok(init?.body instanceof FormData);
    return new Response(JSON.stringify({ ok: true, result: { photo: [{}] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const target = cmuxTarget("ops", "shell");
  const state: CmuxE2EState = {
    targets: [target],
    sentText: [],
    sentKeys: [],
    screen: "cmux shell ready\n\u001b[31magent context\u001b[0m\nbell:\u0007 done\n",
  };
  const bot = await setupPairedBot();
  registerTerminalBackend(fakeCmuxBackend(state));

  const modeCtx = await dispatchTextMessage(bot, "/mode image");
  assert.ok(getReplies(modeCtx).some((reply) => reply.text.includes("image")));

  const screenCtx = await dispatchTextMessage(bot, "/screen");

  assert.equal(fetchCalled, true);
  assert.equal(getReplies(screenCtx).length, 0);
});
