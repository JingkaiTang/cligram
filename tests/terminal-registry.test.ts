import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetTerminalBackendsForTests,
  getAvailableBackends,
  getBackend,
  getBackendForTarget,
  getDefaultTarget,
  listAllTargets,
  registerTerminalBackend,
} from "../src/terminal/registry.js";
import {
  TerminalTargetError,
  type BackendAvailability,
  type BackendKind,
  type TerminalBackend,
  type TerminalTarget,
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

function backend(
  kind: BackendKind,
  options: {
    available?: boolean;
    defaultTarget?: TerminalTarget;
    targets?: TerminalTarget[];
  } = {},
): TerminalBackend {
  const availability: BackendAvailability = {
    available: options.available ?? true,
    reason: options.available === false ? "missing" : undefined,
  };
  const fallbackTarget = kind === "tmux" ? tmuxTarget("default") : cmuxTarget("default");

  return {
    kind,
    async isAvailable() {
      return availability;
    },
    async defaultTarget() {
      return options.defaultTarget ?? fallbackTarget;
    },
    async createTarget() {
      return options.defaultTarget ?? fallbackTarget;
    },
    async targetExists() {
      return true;
    },
    async listTargets() {
      return options.targets ?? [];
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

test("terminal registry: returns only available backends", async () => {
  __resetTerminalBackendsForTests();
  const tmux = backend("tmux", { available: true });
  const cmux = backend("cmux", { available: false });

  registerTerminalBackend(tmux);
  registerTerminalBackend(cmux);

  assert.deepEqual(await getAvailableBackends(), [tmux]);
});

test("terminal registry: default target prefers tmux then falls back to cmux", async () => {
  __resetTerminalBackendsForTests();
  registerTerminalBackend(backend("cmux", { defaultTarget: cmuxTarget("cmux-default") }));
  registerTerminalBackend(backend("tmux", { defaultTarget: tmuxTarget("tmux-default") }));

  assert.deepEqual(await getDefaultTarget(1001), tmuxTarget("tmux-default"));

  __resetTerminalBackendsForTests();
  registerTerminalBackend(backend("tmux", { available: false }));
  registerTerminalBackend(backend("cmux", { defaultTarget: cmuxTarget("cmux-default") }));

  assert.deepEqual(await getDefaultTarget(1001), cmuxTarget("cmux-default"));
});

test("terminal registry: default target reports a readable error when no backend is available", async () => {
  __resetTerminalBackendsForTests();
  registerTerminalBackend(backend("tmux", { available: false }));
  registerTerminalBackend(backend("cmux", { available: false }));

  await assert.rejects(() => getDefaultTarget(1001), {
    name: "TerminalTargetError",
    message: /未找到可用终端后端.*安装 tmux.*启动 cmux/s,
  });
});

test("terminal registry: routes targets by target backend", () => {
  __resetTerminalBackendsForTests();
  const tmux = backend("tmux");
  const cmux = backend("cmux");
  registerTerminalBackend(tmux);
  registerTerminalBackend(cmux);

  assert.equal(getBackend("tmux"), tmux);
  assert.equal(getBackendForTarget(tmuxTarget("work")), tmux);
  assert.equal(getBackendForTarget(cmuxTarget("surface:1")), cmux);
});

test("terminal registry: lists targets from available backends in registry order", async () => {
  __resetTerminalBackendsForTests();
  registerTerminalBackend(
    backend("cmux", {
      targets: [cmuxTarget("cmux-a"), cmuxTarget("cmux-b")],
    }),
  );
  registerTerminalBackend(
    backend("tmux", {
      targets: [tmuxTarget("tmux-a")],
    }),
  );

  assert.deepEqual(await listAllTargets(), [
    cmuxTarget("cmux-a"),
    cmuxTarget("cmux-b"),
    tmuxTarget("tmux-a"),
  ]);
});

test("terminal registry: skips unavailable backends when listing targets", async () => {
  __resetTerminalBackendsForTests();
  registerTerminalBackend(
    backend("tmux", {
      available: false,
      targets: [tmuxTarget("hidden")],
    }),
  );
  registerTerminalBackend(
    backend("cmux", {
      targets: [cmuxTarget("visible")],
    }),
  );

  assert.deepEqual(await listAllTargets(), [cmuxTarget("visible")]);
});
