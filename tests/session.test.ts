import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetSessionStateForTests,
  attachSession,
  attachTarget,
  detachSession,
  ensureTarget,
  getCurrentTarget,
  resetTarget,
} from "../src/session.js";
import {
  __resetTerminalBackendsForTests,
  registerTerminalBackend,
} from "../src/terminal/registry.js";
import type {
  BackendAvailability,
  BackendKind,
  TerminalBackend,
  TerminalTarget,
} from "../src/terminal/types.js";

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

function fakeBackend(
  kind: BackendKind,
  state: {
    defaultTarget: TerminalTarget;
    created?: TerminalTarget[];
    defaultCalls?: number;
    exists?: Set<string>;
  },
): TerminalBackend {
  return {
    kind,
    async isAvailable(): Promise<BackendAvailability> {
      return { available: true };
    },
    async defaultTarget() {
      state.defaultCalls = (state.defaultCalls ?? 0) + 1;
      return state.defaultTarget;
    },
    async createTarget() {
      const target =
        kind === "tmux"
          ? tmuxTarget(`${kind}-created-${(state.created?.length ?? 0) + 1}`)
          : cmuxTarget(`${kind}-created-${(state.created?.length ?? 0) + 1}`);
      state.created?.push(target);
      state.exists?.add(target.ref);
      return target;
    },
    async targetExists(target) {
      return state.exists?.has(target.ref) ?? true;
    },
    async listTargets() {
      return [];
    },
    async sendText() {},
    async sendTextAndEnter() {},
    async sendKey() {},
    async capturePane() {
      return "";
    },
    async captureVisible() {
      return "";
    },
    async targetSignature(target) {
      return target.ref;
    },
    async openInTerminal() {},
  };
}

test.afterEach(() => {
  __resetSessionStateForTests();
  __resetTerminalBackendsForTests();
});

test("session: ensureTarget returns registry default target", async () => {
  const defaultTarget = tmuxTarget("cg-123");
  __resetTerminalBackendsForTests();
  registerTerminalBackend(fakeBackend("tmux", { defaultTarget }));

  assert.deepEqual(await ensureTarget(123), defaultTarget);
  assert.equal(getCurrentTarget(123), null);
});

test("session: attachTarget binds current target and ensureTarget returns it", async () => {
  const defaultTarget = tmuxTarget("cg-9");
  const attached = cmuxTarget("surface-1");
  __resetTerminalBackendsForTests();
  registerTerminalBackend(fakeBackend("tmux", { defaultTarget }));
  registerTerminalBackend(fakeBackend("cmux", { defaultTarget: attached }));

  assert.equal(await attachTarget(9, attached), true);
  assert.deepEqual(getCurrentTarget(9), attached);
  assert.deepEqual(await ensureTarget(9), attached);
});

test("session: detachSession clears target binding", async () => {
  const attached = cmuxTarget("surface-2");
  __resetTerminalBackendsForTests();
  registerTerminalBackend(fakeBackend("cmux", { defaultTarget: attached }));

  assert.equal(await attachTarget(9, attached), true);
  detachSession(9);

  assert.equal(getCurrentTarget(9), null);
});

test("session: resetTarget creates target on current/default backend and binds chat", async () => {
  const defaultTarget = cmuxTarget("default-surface");
  const created: TerminalTarget[] = [];
  __resetTerminalBackendsForTests();
  registerTerminalBackend(fakeBackend("cmux", { defaultTarget, created }));

  const target = await resetTarget(42);

  assert.deepEqual(created, [target]);
  assert.deepEqual(getCurrentTarget(42), target);
  assert.deepEqual(await ensureTarget(42), target);
});

test("session: resetTarget without binding does not call defaultTarget", async () => {
  const state = {
    defaultTarget: tmuxTarget("cg-42"),
    created: [] as TerminalTarget[],
    defaultCalls: 0,
  };
  __resetTerminalBackendsForTests();
  registerTerminalBackend(fakeBackend("tmux", state));

  const target = await resetTarget(42);

  assert.equal(state.defaultCalls, 0);
  assert.deepEqual(state.created, [target]);
  assert.deepEqual(getCurrentTarget(42), target);
});

test("session: resetTarget creates target on currently bound backend", async () => {
  const defaultTarget = tmuxTarget("cg-42");
  const attached = cmuxTarget("surface-3");
  const created: TerminalTarget[] = [];
  __resetTerminalBackendsForTests();
  registerTerminalBackend(fakeBackend("tmux", { defaultTarget }));
  registerTerminalBackend(fakeBackend("cmux", { defaultTarget: attached, created }));
  await attachTarget(42, attached);

  const target = await resetTarget(42);

  assert.equal(target.backend, "cmux");
  assert.deepEqual(created, [target]);
  assert.deepEqual(getCurrentTarget(42), target);
});

test("session: attachSession returns false when tmux backend is not registered", async () => {
  __resetTerminalBackendsForTests();
  registerTerminalBackend(fakeBackend("cmux", { defaultTarget: cmuxTarget("surface-4") }));

  assert.equal(await attachSession(42, "work"), false);
  assert.equal(getCurrentTarget(42), null);
});

test("session: ensureTarget clears missing binding and falls back to default target", async () => {
  const defaultTarget = tmuxTarget("cg-77");
  const attached = cmuxTarget("gone");
  const exists = new Set<string>();
  __resetTerminalBackendsForTests();
  registerTerminalBackend(fakeBackend("tmux", { defaultTarget }));
  registerTerminalBackend(fakeBackend("cmux", { defaultTarget: attached, exists }));
  await attachTarget(77, attached);

  assert.deepEqual(await ensureTarget(77), defaultTarget);
  assert.equal(getCurrentTarget(77), null);
});
