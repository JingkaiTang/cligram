import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetTerminalBackendsForTests,
  getAvailableBackends,
  getBackend,
  getBackendForTarget,
  getDefaultBackend,
  getDefaultTarget,
  listAllTargets,
  listAllTargetsWithStatus,
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
    isAvailableError?: Error;
    listTargetsError?: Error;
    reason?: string;
    detail?: string;
    targets?: TerminalTarget[];
  } = {},
): TerminalBackend {
  const availability: BackendAvailability = {
    available: options.available ?? true,
    reason: options.reason ?? (options.available === false ? "missing" : undefined),
    detail: options.detail,
  };
  const fallbackTarget = kind === "tmux" ? tmuxTarget("default") : cmuxTarget("default");

  return {
    kind,
    async isAvailable() {
      if (options.isAvailableError) {
        throw options.isAvailableError;
      }
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
      if (options.listTargetsError) {
        throw options.listTargetsError;
      }
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

test("terminal registry: skips backends whose availability check throws", async () => {
  __resetTerminalBackendsForTests();
  const tmux = backend("tmux", { available: true });
  const cmux = backend("cmux", { isAvailableError: new Error("cmux socket failed") });

  registerTerminalBackend(cmux);
  registerTerminalBackend(tmux);

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

test("terminal registry: default backend prefers tmux then falls back to cmux without creating targets", async () => {
  __resetTerminalBackendsForTests();
  const cmux = backend("cmux");
  const tmux = backend("tmux");
  registerTerminalBackend(cmux);
  registerTerminalBackend(tmux);

  assert.equal(await getDefaultBackend(), tmux);

  __resetTerminalBackendsForTests();
  const unavailableTmux = backend("tmux", { available: false });
  const availableCmux = backend("cmux");
  registerTerminalBackend(unavailableTmux);
  registerTerminalBackend(availableCmux);

  assert.equal(await getDefaultBackend(), availableCmux);
});

test("terminal registry: default backend reports a readable error when no backend is available", async () => {
  __resetTerminalBackendsForTests();
  registerTerminalBackend(backend("tmux", { available: false }));
  registerTerminalBackend(backend("cmux", { available: false }));

  await assert.rejects(() => getDefaultBackend(), {
    name: "TerminalTargetError",
    message: /未找到可用终端后端.*安装 tmux.*启动 cmux/s,
  });
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

test("terminal registry: skips backends whose target listing throws", async () => {
  __resetTerminalBackendsForTests();
  registerTerminalBackend(
    backend("tmux", {
      targets: [tmuxTarget("visible")],
    }),
  );
  registerTerminalBackend(
    backend("cmux", {
      listTargetsError: new Error("cmux list failed"),
      targets: [cmuxTarget("hidden")],
    }),
  );

  assert.deepEqual(await listAllTargets(), [tmuxTarget("visible")]);
});

test("terminal registry: reports unavailable backends when listing targets with status", async () => {
  __resetTerminalBackendsForTests();
  registerTerminalBackend(
    backend("tmux", {
      targets: [tmuxTarget("visible")],
    }),
  );
  registerTerminalBackend(
    backend("cmux", {
      available: false,
      reason: "socket",
      detail: "cmux socket unavailable",
      targets: [cmuxTarget("hidden")],
    }),
  );

  assert.deepEqual(await listAllTargetsWithStatus(), {
    targets: [tmuxTarget("visible")],
    unavailableBackends: [
      {
        kind: "cmux",
        reason: "socket",
        detail: "cmux socket unavailable",
      },
    ],
  });
});

test("terminal registry: reports target listing errors when listing targets with status", async () => {
  __resetTerminalBackendsForTests();
  registerTerminalBackend(
    backend("tmux", {
      targets: [tmuxTarget("visible")],
    }),
  );
  registerTerminalBackend(
    backend("cmux", {
      listTargetsError: new Error("cmux list failed"),
      targets: [cmuxTarget("hidden")],
    }),
  );

  assert.deepEqual(await listAllTargetsWithStatus(), {
    targets: [tmuxTarget("visible")],
    unavailableBackends: [
      {
        kind: "cmux",
        reason: "list failed",
        detail: "cmux list failed",
      },
    ],
  });
});
