# cmux Multi-Backend Terminal Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend-neutral terminal targets so cligram can control tmux and cmux targets in the same process.

**Architecture:** Introduce a small terminal backend layer with explicit target refs (`tmux:<session>`, `cmux:<workspace>/<surface>`). Wrap the current tmux CLI code behind that interface first, then add cmux CLI support and move session binding, output capture, and Telegram commands onto the backend-neutral API.

**Tech Stack:** TypeScript ESM, Node.js `node:test`, Telegraf, tmux CLI, cmux CLI.

---

## File Structure

- Create `src/terminal/types.ts`: shared backend, target, availability, and error types.
- Create `src/terminal/target-ref.ts`: parse and format user-facing target refs.
- Create `src/terminal/registry.ts`: discover/register tmux and cmux backends and route targets to the right backend.
- Create `src/terminal/tmux-backend.ts`: adapter over existing tmux operations.
- Create `src/terminal/cmux-backend.ts`: cmux CLI adapter with key translation and error normalization.
- Modify `src/tmux.ts`: export a small additional command-builder hook if needed, but keep behavior compatible.
- Modify `src/config.ts`: add `cmuxPath` config, add `targets` to built-in command names, keep `tmuxSocket` unchanged.
- Modify `src/session.ts`: replace string tmux targets with `TerminalTarget` bindings.
- Modify `src/output.ts`: accept `TerminalTarget` and route capture/signature through the registry backend.
- Modify `src/commands.ts`: replace direct tmux calls with terminal backend calls and add `/targets`.
- Modify `src/index.ts`: update Telegram bot command menu text.
- Modify `config.example.json`: add `cmuxPath`.
- Modify `README.md`: document multi-backend behavior and target refs.
- Add tests:
  - `tests/target-ref.test.ts`
  - `tests/terminal-registry.test.ts`
  - `tests/tmux-backend.test.ts`
  - `tests/cmux-backend.test.ts`
  - update `tests/session.test.ts`
  - update `tests/output.test.ts` where needed
  - update `tests/config.test.ts`

---

### Task 1: Target Ref Types And Parsing

**Files:**
- Create: `src/terminal/types.ts`
- Create: `src/terminal/target-ref.ts`
- Test: `tests/target-ref.test.ts`

- [ ] **Step 1: Write failing target ref tests**

Create `tests/target-ref.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTargetRef,
  parseTargetRef,
  parseAttachRef,
} from "../src/terminal/target-ref.ts";

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

test("target-ref: rejects ambiguous and empty refs", () => {
  assert.throws(() => parseTargetRef(""), /目标不能为空/);
  assert.throws(() => parseTargetRef("work"), /缺少后端前缀/);
  assert.throws(() => parseTargetRef("ssh:host"), /不支持的目标后端/);
  assert.throws(() => parseTargetRef("cmux:workspace:1/"), /cmux target/);
});

test("target-ref: formats refs from target objects", () => {
  assert.equal(formatTargetRef({ backend: "tmux", tmuxSession: "work" }), "tmux:work");
  assert.equal(
    formatTargetRef({ backend: "cmux", cmuxWorkspace: "workspace:1", cmuxSurface: "surface:2" }),
    "cmux:workspace:1/surface:2",
  );
});

test("target-ref: parseAttachRef keeps legacy tmux names compatible", () => {
  assert.deepEqual(parseAttachRef("work"), { kind: "legacy-tmux", sessionName: "work" });
  assert.deepEqual(parseAttachRef("tmux:work"), { kind: "target", target: parseTargetRef("tmux:work") });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/target-ref.test.ts
```

Expected: FAIL because `src/terminal/target-ref.ts` does not exist.

- [ ] **Step 3: Add terminal types**

Create `src/terminal/types.ts`:

```ts
export type BackendKind = "tmux" | "cmux";

export interface BaseTerminalTarget {
  backend: BackendKind;
  id: string;
  label: string;
  ref: string;
}

export interface TmuxTarget extends BaseTerminalTarget {
  backend: "tmux";
  tmuxSession: string;
}

export interface CmuxTarget extends BaseTerminalTarget {
  backend: "cmux";
  cmuxWorkspace?: string;
  cmuxSurface: string;
}

export type TerminalTarget = TmuxTarget | CmuxTarget;

export interface BackendAvailability {
  available: boolean;
  reason?: string;
  detail?: string;
}

export interface CreateTargetOptions {
  cwd?: string;
  name?: string;
}

export interface TerminalBackend {
  kind: BackendKind;
  isAvailable(): Promise<BackendAvailability>;
  defaultTarget(chatId: number): Promise<TerminalTarget>;
  createTarget(chatId: number, options?: CreateTargetOptions): Promise<TerminalTarget>;
  targetExists(target: TerminalTarget): Promise<boolean>;
  listTargets(): Promise<TerminalTarget[]>;
  sendText(target: TerminalTarget, text: string): Promise<void>;
  sendTextAndEnter(target: TerminalTarget, text: string): Promise<void>;
  sendKey(target: TerminalTarget, key: string): Promise<void>;
  capturePane(target: TerminalTarget, lines?: number): Promise<string>;
  captureVisible(target: TerminalTarget): Promise<string>;
  targetSignature(target: TerminalTarget): Promise<string>;
  openInTerminal(target: TerminalTarget): Promise<void>;
}

export class TerminalTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalTargetError";
  }
}
```

- [ ] **Step 4: Add target ref parser**

Create `src/terminal/target-ref.ts`:

```ts
import {
  TerminalTargetError,
  type CmuxTarget,
  type TerminalTarget,
  type TmuxTarget,
} from "./types.js";

export type AttachRef =
  | { kind: "target"; target: TerminalTarget }
  | { kind: "legacy-tmux"; sessionName: string };

export function formatTargetRef(
  target: Pick<TerminalTarget, "backend"> & Partial<TmuxTarget & CmuxTarget>,
): string {
  if (target.backend === "tmux") {
    if (!target.tmuxSession) {
      throw new TerminalTargetError("tmux target 缺少 session 名称");
    }
    return `tmux:${target.tmuxSession}`;
  }

  if (!target.cmuxSurface) {
    throw new TerminalTargetError("cmux target 缺少 surface");
  }
  if (target.cmuxWorkspace) {
    return `cmux:${target.cmuxWorkspace}/${target.cmuxSurface}`;
  }
  return `cmux:${target.cmuxSurface}`;
}

export function parseTargetRef(value: string): TerminalTarget {
  const raw = value.trim();
  if (!raw) {
    throw new TerminalTargetError("目标不能为空");
  }

  const colon = raw.indexOf(":");
  if (colon <= 0) {
    throw new TerminalTargetError("目标缺少后端前缀，请使用 tmux:<session> 或 cmux:<surface>");
  }

  const backend = raw.slice(0, colon);
  const body = raw.slice(colon + 1);
  if (backend === "tmux") {
    if (!body) {
      throw new TerminalTargetError("tmux target 缺少 session 名称");
    }
    return {
      backend: "tmux",
      id: body,
      label: body,
      ref: `tmux:${body}`,
      tmuxSession: body,
    };
  }

  if (backend === "cmux") {
    return parseCmuxTarget(body);
  }

  throw new TerminalTargetError(`不支持的目标后端: ${backend}`);
}

function parseCmuxTarget(body: string): CmuxTarget {
  if (!body) {
    throw new TerminalTargetError("cmux target 缺少 surface");
  }
  const parts = body.split("/");
  if (parts.length > 2 || parts.some((part) => !part.trim())) {
    throw new TerminalTargetError("cmux target 格式应为 cmux:<surface> 或 cmux:<workspace>/<surface>");
  }
  const cmuxWorkspace = parts.length === 2 ? parts[0] : undefined;
  const cmuxSurface = parts.length === 2 ? parts[1] : parts[0];
  return {
    backend: "cmux",
    id: body,
    label: body,
    ref: `cmux:${body}`,
    cmuxWorkspace,
    cmuxSurface,
  };
}

export function parseAttachRef(value: string): AttachRef {
  const raw = value.trim();
  if (!raw) {
    throw new TerminalTargetError("目标不能为空");
  }
  if (!raw.includes(":")) {
    return { kind: "legacy-tmux", sessionName: raw };
  }
  return { kind: "target", target: parseTargetRef(raw) };
}
```

- [ ] **Step 5: Run target ref tests**

Run:

```bash
npm test -- tests/target-ref.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/terminal/types.ts src/terminal/target-ref.ts tests/target-ref.test.ts
git commit -m "feat: add terminal target refs"
```

---

### Task 2: Backend Registry And Discovery

**Files:**
- Create: `src/terminal/registry.ts`
- Test: `tests/terminal-registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

Create `tests/terminal-registry.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetTerminalBackendsForTests,
  getAvailableBackends,
  getBackendForTarget,
  getDefaultTarget,
  listAllTargets,
  registerTerminalBackend,
} from "../src/terminal/registry.ts";
import type { BackendAvailability, TerminalBackend, TerminalTarget } from "../src/terminal/types.ts";

function fakeBackend(kind: "tmux" | "cmux", available: boolean, targets: TerminalTarget[]): TerminalBackend {
  return {
    kind,
    async isAvailable(): Promise<BackendAvailability> {
      return available ? { available: true } : { available: false, reason: "missing" };
    },
    async defaultTarget(chatId: number): Promise<TerminalTarget> {
      return targets[0] ?? {
        backend: kind,
        id: `${kind}-${chatId}`,
        label: `${kind}-${chatId}`,
        ref: `${kind}:${kind}-${chatId}`,
        ...(kind === "tmux"
          ? { tmuxSession: `${kind}-${chatId}` }
          : { cmuxSurface: `${kind}-${chatId}` }),
      } as TerminalTarget;
    },
    async createTarget(): Promise<TerminalTarget> {
      return this.defaultTarget(1);
    },
    async targetExists(target: TerminalTarget): Promise<boolean> {
      return targets.some((item) => item.ref === target.ref);
    },
    async listTargets(): Promise<TerminalTarget[]> {
      return targets;
    },
    async sendText(): Promise<void> {},
    async sendTextAndEnter(): Promise<void> {},
    async sendKey(): Promise<void> {},
    async capturePane(): Promise<string> { return ""; },
    async captureVisible(): Promise<string> { return ""; },
    async targetSignature(): Promise<string> { return ""; },
    async openInTerminal(): Promise<void> {},
  };
}

test("registry: lists available backends only", async () => {
  __resetTerminalBackendsForTests();
  registerTerminalBackend(fakeBackend("tmux", true, []));
  registerTerminalBackend(fakeBackend("cmux", false, []));

  const available = await getAvailableBackends();
  assert.deepEqual(available.map((backend) => backend.kind), ["tmux"]);
});

test("registry: default target prefers tmux then cmux", async () => {
  __resetTerminalBackendsForTests();
  const tmuxTarget: TerminalTarget = {
    backend: "tmux",
    id: "cg-9",
    label: "cg-9",
    ref: "tmux:cg-9",
    tmuxSession: "cg-9",
  };
  registerTerminalBackend(fakeBackend("cmux", true, []));
  registerTerminalBackend(fakeBackend("tmux", true, [tmuxTarget]));

  assert.deepEqual(await getDefaultTarget(9), tmuxTarget);
});

test("registry: default target falls back to cmux", async () => {
  __resetTerminalBackendsForTests();
  const cmuxTarget: TerminalTarget = {
    backend: "cmux",
    id: "surface:1",
    label: "surface:1",
    ref: "cmux:surface:1",
    cmuxSurface: "surface:1",
  };
  registerTerminalBackend(fakeBackend("tmux", false, []));
  registerTerminalBackend(fakeBackend("cmux", true, [cmuxTarget]));

  assert.deepEqual(await getDefaultTarget(9), cmuxTarget);
});

test("registry: routes targets by backend and lists grouped targets", async () => {
  __resetTerminalBackendsForTests();
  const tmuxTarget: TerminalTarget = {
    backend: "tmux",
    id: "work",
    label: "work",
    ref: "tmux:work",
    tmuxSession: "work",
  };
  const cmuxTarget: TerminalTarget = {
    backend: "cmux",
    id: "surface:2",
    label: "surface:2",
    ref: "cmux:surface:2",
    cmuxSurface: "surface:2",
  };
  registerTerminalBackend(fakeBackend("tmux", true, [tmuxTarget]));
  registerTerminalBackend(fakeBackend("cmux", true, [cmuxTarget]));

  assert.equal(getBackendForTarget(cmuxTarget).kind, "cmux");
  assert.deepEqual(await listAllTargets(), [tmuxTarget, cmuxTarget]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/terminal-registry.test.ts
```

Expected: FAIL because `src/terminal/registry.ts` does not exist.

- [ ] **Step 3: Add registry implementation**

Create `src/terminal/registry.ts`:

```ts
import type { BackendKind, TerminalBackend, TerminalTarget } from "./types.js";

const backends = new Map<BackendKind, TerminalBackend>();

export function registerTerminalBackend(backend: TerminalBackend): void {
  backends.set(backend.kind, backend);
}

export function getBackend(kind: BackendKind): TerminalBackend {
  const backend = backends.get(kind);
  if (!backend) {
    throw new Error(`终端后端未注册: ${kind}`);
  }
  return backend;
}

export function getBackendForTarget(target: TerminalTarget): TerminalBackend {
  return getBackend(target.backend);
}

export async function getAvailableBackends(): Promise<TerminalBackend[]> {
  const result: TerminalBackend[] = [];
  for (const backend of backends.values()) {
    const availability = await backend.isAvailable();
    if (availability.available) {
      result.push(backend);
    }
  }
  return result;
}

export async function getDefaultTarget(chatId: number): Promise<TerminalTarget> {
  for (const kind of ["tmux", "cmux"] as const) {
    const backend = backends.get(kind);
    if (!backend) continue;
    const availability = await backend.isAvailable();
    if (availability.available) {
      return backend.defaultTarget(chatId);
    }
  }
  throw new Error("没有可用的终端后端。请安装 tmux，或启动 cmux 并确认 cmux CLI 可用。");
}

export async function listAllTargets(): Promise<TerminalTarget[]> {
  const result: TerminalTarget[] = [];
  for (const backend of backends.values()) {
    const availability = await backend.isAvailable();
    if (!availability.available) continue;
    result.push(...await backend.listTargets());
  }
  return result;
}

export function __resetTerminalBackendsForTests(): void {
  backends.clear();
}
```

- [ ] **Step 4: Run registry tests**

Run:

```bash
npm test -- tests/terminal-registry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/terminal/registry.ts tests/terminal-registry.test.ts
git commit -m "feat: add terminal backend registry"
```

---

### Task 3: tmux Backend Adapter

**Files:**
- Create: `src/terminal/tmux-backend.ts`
- Test: `tests/tmux-backend.test.ts`

- [ ] **Step 1: Write failing tmux backend tests**

Create `tests/tmux-backend.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTmuxBackend } from "../src/terminal/tmux-backend.ts";
import type { TerminalTarget } from "../src/terminal/types.ts";

test("tmux-backend: builds default chat target", async () => {
  const calls: string[][] = [];
  const backend = createTmuxBackend({
    run: async (args) => {
      calls.push(args);
      if (args[0] === "has-session") throw new Error("missing");
      return { stdout: "", stderr: "" };
    },
    getStartDir: () => "/tmp",
    getSocket: () => "",
    openInTerminal: async () => {},
  });

  assert.deepEqual(await backend.defaultTarget(42), {
    backend: "tmux",
    id: "cg-42",
    label: "cg-42",
    ref: "tmux:cg-42",
    tmuxSession: "cg-42",
  });
  assert.deepEqual(calls, [
    ["has-session", "-t", "cg-42"],
    ["new-session", "-d", "-s", "cg-42", "-n", "shell", "-c", "/tmp"],
  ]);
});

test("tmux-backend: sends and captures using pane target", async () => {
  const calls: string[][] = [];
  const backend = createTmuxBackend({
    run: async (args) => {
      calls.push(args);
      return { stdout: args[0] === "capture-pane" ? "ok\n" : "", stderr: "" };
    },
    getStartDir: () => "/tmp",
    getSocket: () => "",
    openInTerminal: async () => {},
  });
  const target: TerminalTarget = {
    backend: "tmux",
    id: "work",
    label: "work",
    ref: "tmux:work",
    tmuxSession: "work",
  };

  await backend.sendText(target, "ls");
  await backend.sendKey(target, "Enter");
  assert.equal(await backend.capturePane(target, 20), "ok\n");

  assert.deepEqual(calls, [
    ["send-keys", "-t", "work:0.0", "-l", "--", "ls"],
    ["send-keys", "-t", "work:0.0", "Enter"],
    ["capture-pane", "-p", "-J", "-t", "work:0.0", "-S", "-20"],
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/tmux-backend.test.ts
```

Expected: FAIL because `src/terminal/tmux-backend.ts` does not exist.

- [ ] **Step 3: Add tmux backend implementation**

Create `src/terminal/tmux-backend.ts`:

```ts
import { SESSION_PREFIX, CAPTURE_LINES, getSessionStartDir } from "../config.js";
import * as tmux from "../tmux.js";
import type {
  BackendAvailability,
  TerminalBackend,
  TerminalTarget,
  TmuxTarget,
} from "./types.js";

type RunResult = { stdout: string; stderr: string };

export interface TmuxBackendDeps {
  run?: (args: string[]) => Promise<RunResult>;
  getStartDir?: () => string;
  getSocket?: () => string;
  openInTerminal?: (sessionName: string) => Promise<void>;
}

function toTmuxTarget(target: TerminalTarget): TmuxTarget {
  if (target.backend !== "tmux") {
    throw new Error(`目标不是 tmux: ${target.ref}`);
  }
  return target;
}

function paneTarget(target: TmuxTarget): string {
  return `${target.tmuxSession}:0.0`;
}

function makeTarget(sessionName: string): TmuxTarget {
  return {
    backend: "tmux",
    id: sessionName,
    label: sessionName,
    ref: `tmux:${sessionName}`,
    tmuxSession: sessionName,
  };
}

export function createTmuxBackend(deps: TmuxBackendDeps = {}): TerminalBackend {
  const run = deps.run ?? ((args) => tmux.runTmux(args));
  const getStartDir = deps.getStartDir ?? getSessionStartDir;
  const openInTerminal = deps.openInTerminal ?? tmux.openInTerminal;

  return {
    kind: "tmux",

    async isAvailable(): Promise<BackendAvailability> {
      try {
        await run(["-V"]);
        return { available: true };
      } catch (err) {
        return { available: false, reason: "missing", detail: String(err) };
      }
    },

    async defaultTarget(chatId: number): Promise<TerminalTarget> {
      const name = `${SESSION_PREFIX}${chatId}`;
      const target = makeTarget(name);
      if (!await this.targetExists(target)) {
        await this.createTarget(chatId, { name, cwd: getStartDir() });
      }
      return target;
    },

    async createTarget(chatId: number, options = {}): Promise<TerminalTarget> {
      const name = options.name ?? `${SESSION_PREFIX}${chatId}`;
      const cwd = options.cwd ?? getStartDir();
      if (cwd) {
        await run(["new-session", "-d", "-s", name, "-n", "shell", "-c", cwd]);
      } else {
        await run(["new-session", "-d", "-s", name, "-n", "shell"]);
      }
      return makeTarget(name);
    },

    async targetExists(target: TerminalTarget): Promise<boolean> {
      const tmuxTarget = toTmuxTarget(target);
      try {
        await run(["has-session", "-t", tmuxTarget.tmuxSession]);
        return true;
      } catch {
        return false;
      }
    },

    async listTargets(): Promise<TerminalTarget[]> {
      try {
        const { stdout } = await run(["list-sessions", "-F", "#{session_name}"]);
        return stdout.trim().split("\n").filter(Boolean).map(makeTarget);
      } catch {
        return [];
      }
    },

    async sendText(target: TerminalTarget, text: string): Promise<void> {
      await run(["send-keys", "-t", paneTarget(toTmuxTarget(target)), "-l", "--", text]);
    },

    async sendTextAndEnter(target: TerminalTarget, text: string): Promise<void> {
      await this.sendText(target, text);
      await this.sendKey(target, "Enter");
    },

    async sendKey(target: TerminalTarget, key: string): Promise<void> {
      await run(["send-keys", "-t", paneTarget(toTmuxTarget(target)), key]);
    },

    async capturePane(target: TerminalTarget, lines: number = CAPTURE_LINES): Promise<string> {
      const { stdout } = await run([
        "capture-pane",
        "-p",
        "-J",
        "-t",
        paneTarget(toTmuxTarget(target)),
        "-S",
        `-${lines}`,
      ]);
      return stdout;
    },

    async captureVisible(target: TerminalTarget): Promise<string> {
      const { stdout } = await run([
        "capture-pane",
        "-p",
        "-J",
        "-t",
        paneTarget(toTmuxTarget(target)),
      ]);
      return stdout;
    },

    async targetSignature(target: TerminalTarget): Promise<string> {
      const { stdout } = await run([
        "display-message",
        "-p",
        "-t",
        paneTarget(toTmuxTarget(target)),
        "#{session_id}:#{window_id}:#{pane_id}:#{history_size}:#{cursor_x}:#{cursor_y}:#{pane_dead}:#{pane_current_command}",
      ]);
      return stdout.trim();
    },

    async openInTerminal(target: TerminalTarget): Promise<void> {
      await openInTerminal(toTmuxTarget(target).tmuxSession);
    },
  };
}
```

- [ ] **Step 4: Export `runTmux` from current tmux module**

Modify `src/tmux.ts`:

```ts
export function runTmux(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return tmux(...args);
}
```

Place it immediately after the private `tmux(...args)` function. This keeps the existing functions untouched while allowing `TmuxBackend` to reuse socket handling.

- [ ] **Step 5: Run tmux backend tests**

Run:

```bash
npm test -- tests/tmux-backend.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/terminal/tmux-backend.ts src/tmux.ts tests/tmux-backend.test.ts
git commit -m "feat: wrap tmux as terminal backend"
```

---

### Task 4: Config And cmux Path Parsing

**Files:**
- Modify: `src/config.ts`
- Modify: `config.example.json`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Add failing config test**

Append to `tests/config.test.ts`:

```ts
test("config: parses cmuxPath", async () => {
  const configPath = await createTempConfig({
    cmuxPath: "/Applications/cmux.app/Contents/MacOS/cmux",
  });

  await withArgvConfig(configPath, async () => {
    await loadConfig();
  });

  assert.equal(getConfig().cmuxPath, "/Applications/cmux.app/Contents/MacOS/cmux");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/config.test.ts
```

Expected: FAIL because `cmuxPath` is not in `CligramConfig`.

- [ ] **Step 3: Add config field and command-name reservation**

Modify `src/config.ts`:

```ts
export interface CligramConfig {
  botToken: string;
  pairedUsers: number[];
  outputMode: OutputMode;
  outputModeByChat: Record<string, OutputMode>;
  sessionStartDir: string;
  commandSafetyMode: CommandSafetyMode;
  commandAllowlist: string[];
  commandBlocklist: string[];
  outputDelayMs: number;
  pollIntervalMs: number;
  idleTimeoutMs: number;
  screenLines: number;
  customCommands: Record<string, CustomCommand>;
  tmuxSocket: string;
  cmuxPath: string;
  terminal: string;
  font: FontConfig;
}
```

Add the default:

```ts
cmuxPath: "",
```

Add `targets` to `BUILTIN_COMMANDS`:

```ts
"sessions", "targets", "attach", "detach", "open",
```

Add parsing in `loadConfig()`:

```ts
cmuxPath: typeof parsed.cmuxPath === "string" ? parsed.cmuxPath.trim() : "",
```

- [ ] **Step 4: Update example config**

Modify `config.example.json` to include:

```json
"tmuxSocket": "",
"cmuxPath": "",
"terminal": "iterm2"
```

- [ ] **Step 5: Run config tests**

Run:

```bash
npm test -- tests/config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts config.example.json tests/config.test.ts
git commit -m "feat: add cmux path config"
```

---

### Task 5: cmux Backend Adapter

**Files:**
- Create: `src/terminal/cmux-backend.ts`
- Test: `tests/cmux-backend.test.ts`

- [ ] **Step 1: Write failing cmux backend tests**

Create `tests/cmux-backend.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createCmuxBackend, translateCmuxKey } from "../src/terminal/cmux-backend.ts";
import type { TerminalTarget } from "../src/terminal/types.ts";

test("cmux-backend: translates tmux-style key names", () => {
  assert.equal(translateCmuxKey("Enter"), "enter");
  assert.equal(translateCmuxKey("Escape"), "escape");
  assert.equal(translateCmuxKey("Up"), "up");
  assert.equal(translateCmuxKey("C-c"), "ctrl+c");
  assert.equal(translateCmuxKey("M-x"), "alt+x");
  assert.equal(translateCmuxKey("S-tab"), "shift+tab");
});

test("cmux-backend: sends and captures with explicit surface", async () => {
  const calls: string[][] = [];
  const backend = createCmuxBackend({
    getCmuxPath: () => "/Applications/cmux.app/Contents/MacOS/cmux",
    run: async (_cmd, args) => {
      calls.push(args);
      return { stdout: args[0] === "read-screen" ? "screen\n" : "", stderr: "" };
    },
    getStartDir: () => "/tmp",
  });
  const target: TerminalTarget = {
    backend: "cmux",
    id: "workspace:1/surface:2",
    label: "workspace:1/surface:2",
    ref: "cmux:workspace:1/surface:2",
    cmuxWorkspace: "workspace:1",
    cmuxSurface: "surface:2",
  };

  await backend.sendText(target, "ls");
  await backend.sendKey(target, "C-c");
  assert.equal(await backend.capturePane(target, 50), "screen\n");

  assert.deepEqual(calls, [
    ["send", "--workspace", "workspace:1", "--surface", "surface:2", "--", "ls"],
    ["send-key", "--workspace", "workspace:1", "--surface", "surface:2", "--", "ctrl+c"],
    ["read-screen", "--workspace", "workspace:1", "--surface", "surface:2", "--scrollback", "--lines", "50"],
  ]);
});

test("cmux-backend: parses tree json terminal surfaces", async () => {
  const tree = {
    windows: [{
      workspaces: [{
        id: "workspace-uuid",
        ref: "workspace:1",
        title: "Main",
        panes: [{
          surfaces: [
            { id: "surface-uuid", ref: "surface:2", type: "terminal", title: "Shell" },
            { id: "browser-uuid", ref: "surface:3", type: "browser", title: "Docs" },
          ],
        }],
      }],
    }],
  };
  const backend = createCmuxBackend({
    getCmuxPath: () => "cmux",
    run: async () => ({ stdout: JSON.stringify(tree), stderr: "" }),
    getStartDir: () => "/tmp",
  });

  assert.deepEqual(await backend.listTargets(), [{
    backend: "cmux",
    id: "workspace:1/surface:2",
    label: "Main / Shell",
    ref: "cmux:workspace:1/surface:2",
    cmuxWorkspace: "workspace:1",
    cmuxSurface: "surface:2",
  }]);
});

test("cmux-backend: normalizes broken socket availability", async () => {
  const backend = createCmuxBackend({
    getCmuxPath: () => "cmux",
    run: async () => {
      throw new Error("Failed to write to socket (Broken pipe, errno 32)");
    },
    getStartDir: () => "/tmp",
  });

  assert.deepEqual(await backend.isAvailable(), {
    available: false,
    reason: "socket",
    detail: "cmux 已安装，但当前 socket 不可用。请启动或重启 cmux。",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/cmux-backend.test.ts
```

Expected: FAIL because `src/terminal/cmux-backend.ts` does not exist.

- [ ] **Step 3: Add cmux backend implementation**

Create `src/terminal/cmux-backend.ts`:

```ts
import { execFile as execFileCb } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { CAPTURE_LINES, getConfig, getSessionStartDir } from "../config.js";
import type {
  BackendAvailability,
  CmuxTarget,
  TerminalBackend,
  TerminalTarget,
} from "./types.js";

const execFile = promisify(execFileCb);
const MACOS_CMUX_PATH = "/Applications/cmux.app/Contents/MacOS/cmux";

type RunResult = { stdout: string; stderr: string };

export interface CmuxBackendDeps {
  getCmuxPath?: () => string;
  getStartDir?: () => string;
  run?: (cmd: string, args: string[]) => Promise<RunResult>;
}

export function translateCmuxKey(key: string): string {
  const lower = key.toLowerCase();
  const named: Record<string, string> = {
    enter: "enter",
    escape: "escape",
    up: "up",
    down: "down",
    left: "left",
    right: "right",
  };
  if (named[lower]) return named[lower];
  if (/^c-.+/.test(lower)) return `ctrl+${lower.slice(2)}`;
  if (/^m-.+/.test(lower)) return `alt+${lower.slice(2)}`;
  if (/^s-.+/.test(lower)) return `shift+${lower.slice(2)}`;
  return lower;
}

function toCmuxTarget(target: TerminalTarget): CmuxTarget {
  if (target.backend !== "cmux") {
    throw new Error(`目标不是 cmux: ${target.ref}`);
  }
  return target;
}

function cmuxTargetArgs(target: CmuxTarget): string[] {
  const args: string[] = [];
  if (target.cmuxWorkspace) {
    args.push("--workspace", target.cmuxWorkspace);
  }
  args.push("--surface", target.cmuxSurface);
  return args;
}

function normalizeAvailabilityError(err: unknown): BackendAvailability {
  const text = err instanceof Error ? err.message : String(err);
  if (/Broken pipe|socket/i.test(text)) {
    return {
      available: false,
      reason: "socket",
      detail: "cmux 已安装，但当前 socket 不可用。请启动或重启 cmux。",
    };
  }
  return {
    available: false,
    reason: "missing",
    detail: "未找到可用 cmux CLI。请安装 cmux，或在配置中设置 cmuxPath。",
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveCmuxPath(configured: string): Promise<string> {
  if (configured) return configured;
  try {
    await execFile("cmux", ["version"]);
    return "cmux";
  } catch {
    if (await fileExists(MACOS_CMUX_PATH)) {
      return MACOS_CMUX_PATH;
    }
    return "cmux";
  }
}

export function createCmuxBackend(deps: CmuxBackendDeps = {}): TerminalBackend {
  const getCmuxPath = deps.getCmuxPath ?? (() => getConfig().cmuxPath);
  const getStartDir = deps.getStartDir ?? getSessionStartDir;
  const run = deps.run ?? ((cmd, args) => execFile(cmd, args));

  async function command(): Promise<string> {
    return resolveCmuxPath(getCmuxPath());
  }

  return {
    kind: "cmux",

    async isAvailable(): Promise<BackendAvailability> {
      try {
        const cmd = await command();
        await run(cmd, ["tree", "--json"]);
        return { available: true };
      } catch (err) {
        return normalizeAvailabilityError(err);
      }
    },

    async defaultTarget(chatId: number): Promise<TerminalTarget> {
      const existing = (await this.listTargets()).find((target) => target.id.includes(`cg-${chatId}`));
      if (existing) return existing;
      return this.createTarget(chatId, { name: `cg-${chatId}`, cwd: getStartDir() });
    },

    async createTarget(chatId: number, options = {}): Promise<TerminalTarget> {
      const cmd = await command();
      const name = options.name ?? `cg-${chatId}`;
      const cwd = options.cwd ?? getStartDir();
      await run(cmd, ["new-workspace", "--name", name, "--cwd", cwd, "--focus", "false"]);
      const targets = await this.listTargets();
      return targets.find((target) => target.label.includes(name)) ?? targets[targets.length - 1];
    },

    async targetExists(target: TerminalTarget): Promise<boolean> {
      const ref = target.ref;
      return (await this.listTargets()).some((item) => item.ref === ref);
    },

    async listTargets(): Promise<TerminalTarget[]> {
      const cmd = await command();
      const { stdout } = await run(cmd, ["tree", "--json"]);
      return parseCmuxTree(stdout);
    },

    async sendText(target: TerminalTarget, text: string): Promise<void> {
      const cmd = await command();
      await run(cmd, ["send", ...cmuxTargetArgs(toCmuxTarget(target)), "--", text]);
    },

    async sendTextAndEnter(target: TerminalTarget, text: string): Promise<void> {
      await this.sendText(target, text);
      await this.sendKey(target, "Enter");
    },

    async sendKey(target: TerminalTarget, key: string): Promise<void> {
      const cmd = await command();
      await run(cmd, ["send-key", ...cmuxTargetArgs(toCmuxTarget(target)), "--", translateCmuxKey(key)]);
    },

    async capturePane(target: TerminalTarget, lines: number = CAPTURE_LINES): Promise<string> {
      const cmd = await command();
      const { stdout } = await run(cmd, [
        "read-screen",
        ...cmuxTargetArgs(toCmuxTarget(target)),
        "--scrollback",
        "--lines",
        String(lines),
      ]);
      return stdout;
    },

    async captureVisible(target: TerminalTarget): Promise<string> {
      const cmd = await command();
      const { stdout } = await run(cmd, ["read-screen", ...cmuxTargetArgs(toCmuxTarget(target))]);
      return stdout;
    },

    async targetSignature(target: TerminalTarget): Promise<string> {
      const visible = await this.captureVisible(target);
      return `${target.ref}:${visible}`;
    },

    async openInTerminal(): Promise<void> {
      throw new Error("cmux target 暂不支持 /open；请在 cmux 中直接选择对应 workspace/surface。");
    },
  };
}

export function parseCmuxTree(raw: string): TerminalTarget[] {
  const parsed = JSON.parse(raw) as unknown;
  const result: TerminalTarget[] = [];
  walkCmuxTree(parsed, undefined, undefined, result);
  return result;
}

function walkCmuxTree(
  value: unknown,
  workspace: { ref: string; title: string } | undefined,
  surface: { ref: string; title: string; type?: string } | undefined,
  result: TerminalTarget[],
): void {
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;

  const nextWorkspace = typeof obj.ref === "string" && obj.ref.startsWith("workspace:")
    ? { ref: obj.ref, title: typeof obj.title === "string" ? obj.title : obj.ref }
    : workspace;

  const nextSurface = typeof obj.ref === "string" && obj.ref.startsWith("surface:")
    ? { ref: obj.ref, title: typeof obj.title === "string" ? obj.title : obj.ref, type: typeof obj.type === "string" ? obj.type : undefined }
    : surface;

  if (nextWorkspace && nextSurface && nextSurface.type !== "browser") {
    const id = `${nextWorkspace.ref}/${nextSurface.ref}`;
    result.push({
      backend: "cmux",
      id,
      label: `${nextWorkspace.title} / ${nextSurface.title}`,
      ref: `cmux:${id}`,
      cmuxWorkspace: nextWorkspace.ref,
      cmuxSurface: nextSurface.ref,
    });
  }

  for (const child of Object.values(obj)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        walkCmuxTree(item, nextWorkspace, undefined, result);
      }
    } else if (child && typeof child === "object") {
      walkCmuxTree(child, nextWorkspace, undefined, result);
    }
  }
}
```

- [ ] **Step 4: Run cmux tests**

Run:

```bash
npm test -- tests/cmux-backend.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/terminal/cmux-backend.ts tests/cmux-backend.test.ts
git commit -m "feat: add cmux terminal backend"
```

---

### Task 6: Session Binding Migration

**Files:**
- Modify: `src/session.ts`
- Test: `tests/session.test.ts`

- [ ] **Step 1: Rewrite session tests for TerminalTarget**

Replace `tests/session.test.ts` with tests that assert backend-neutral binding:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetSessionStateForTests,
  attachTarget,
  detachSession,
  ensureTarget,
  getCurrentTarget,
  resetTarget,
} from "../src/session.ts";
import {
  __resetTerminalBackendsForTests,
  registerTerminalBackend,
} from "../src/terminal/registry.ts";
import type { BackendAvailability, TerminalBackend, TerminalTarget } from "../src/terminal/types.ts";

function backend(kind: "tmux" | "cmux", targets: TerminalTarget[]): TerminalBackend {
  return {
    kind,
    async isAvailable(): Promise<BackendAvailability> { return { available: true }; },
    async defaultTarget(chatId: number): Promise<TerminalTarget> {
      return targets[0] ?? {
        backend: "tmux",
        id: `cg-${chatId}`,
        label: `cg-${chatId}`,
        ref: `tmux:cg-${chatId}`,
        tmuxSession: `cg-${chatId}`,
      };
    },
    async createTarget(chatId: number): Promise<TerminalTarget> {
      const created: TerminalTarget = kind === "tmux"
        ? { backend: "tmux", id: `cg-${chatId}`, label: `cg-${chatId}`, ref: `tmux:cg-${chatId}`, tmuxSession: `cg-${chatId}` }
        : { backend: "cmux", id: `surface:${chatId}`, label: `surface:${chatId}`, ref: `cmux:surface:${chatId}`, cmuxSurface: `surface:${chatId}` };
      targets.push(created);
      return created;
    },
    async targetExists(target: TerminalTarget): Promise<boolean> {
      return targets.some((item) => item.ref === target.ref);
    },
    async listTargets(): Promise<TerminalTarget[]> { return targets; },
    async sendText(): Promise<void> {},
    async sendTextAndEnter(): Promise<void> {},
    async sendKey(): Promise<void> {},
    async capturePane(): Promise<string> { return ""; },
    async captureVisible(): Promise<string> { return ""; },
    async targetSignature(): Promise<string> { return ""; },
    async openInTerminal(): Promise<void> {},
  };
}

test("session: ensureTarget returns default backend target", async () => {
  __resetSessionStateForTests();
  __resetTerminalBackendsForTests();
  const target: TerminalTarget = {
    backend: "tmux",
    id: "cg-123",
    label: "cg-123",
    ref: "tmux:cg-123",
    tmuxSession: "cg-123",
  };
  registerTerminalBackend(backend("tmux", [target]));

  assert.deepEqual(await ensureTarget(123), target);
});

test("session: attachTarget and detach flow", async () => {
  __resetSessionStateForTests();
  __resetTerminalBackendsForTests();
  const target: TerminalTarget = {
    backend: "cmux",
    id: "workspace:1/surface:2",
    label: "Main / Shell",
    ref: "cmux:workspace:1/surface:2",
    cmuxWorkspace: "workspace:1",
    cmuxSurface: "surface:2",
  };
  registerTerminalBackend(backend("cmux", [target]));

  assert.equal(await attachTarget(9, target), true);
  assert.deepEqual(getCurrentTarget(9), target);
  assert.deepEqual(await ensureTarget(9), target);

  detachSession(9);
  assert.equal(getCurrentTarget(9), null);
});

test("session: resetTarget creates and binds a fresh target", async () => {
  __resetSessionStateForTests();
  __resetTerminalBackendsForTests();
  const targets: TerminalTarget[] = [];
  registerTerminalBackend(backend("cmux", targets));

  const created = await resetTarget(77);
  assert.equal(created.backend, "cmux");
  assert.deepEqual(getCurrentTarget(77), created);
});
```

- [ ] **Step 2: Run session tests to verify they fail**

Run:

```bash
npm test -- tests/session.test.ts
```

Expected: FAIL because `ensureTarget`, `attachTarget`, and `resetTarget` do not exist.

- [ ] **Step 3: Replace session implementation**

Modify `src/session.ts` to expose backend-neutral functions while keeping compatibility wrappers for callers not yet migrated:

```ts
import { getBackendForTarget, getDefaultTarget } from "./terminal/registry.js";
import type { TerminalTarget } from "./terminal/types.js";

const chatTargetMap = new Map<number, TerminalTarget>();

export async function ensureTarget(chatId: number): Promise<TerminalTarget> {
  const bound = chatTargetMap.get(chatId);
  if (bound) {
    const exists = await getBackendForTarget(bound).targetExists(bound);
    if (exists) return bound;
    chatTargetMap.delete(chatId);
  }
  return getDefaultTarget(chatId);
}

export async function resetTarget(chatId: number): Promise<TerminalTarget> {
  const current = chatTargetMap.get(chatId) ?? await getDefaultTarget(chatId);
  const backend = getBackendForTarget(current);
  const created = await backend.createTarget(chatId);
  chatTargetMap.set(chatId, created);
  return created;
}

export async function attachTarget(chatId: number, target: TerminalTarget): Promise<boolean> {
  const exists = await getBackendForTarget(target).targetExists(target);
  if (!exists) return false;
  chatTargetMap.set(chatId, target);
  return true;
}

export function detachSession(chatId: number): void {
  chatTargetMap.delete(chatId);
}

export function getCurrentTarget(chatId: number): TerminalTarget | null {
  return chatTargetMap.get(chatId) ?? null;
}

export function __resetSessionStateForTests(): void {
  chatTargetMap.clear();
}
```

- [ ] **Step 4: Run session tests**

Run:

```bash
npm test -- tests/session.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session.ts tests/session.test.ts
git commit -m "feat: bind chats to terminal targets"
```

---

### Task 7: Output Layer Migration

**Files:**
- Modify: `src/output.ts`
- Test: `tests/output.test.ts`

- [ ] **Step 1: Add output backend smoke test**

Append to `tests/output.test.ts`:

```ts
import { getBackendForTarget } from "../src/terminal/registry.ts";
import type { TerminalTarget } from "../src/terminal/types.ts";

test("output: ScreenMonitor accepts backend-neutral targets", () => {
  const target: TerminalTarget = {
    backend: "tmux",
    id: "work",
    label: "work",
    ref: "tmux:work",
    tmuxSession: "work",
  };
  assert.equal(getBackendForTarget.name, "getBackendForTarget");
  assert.equal(target.ref, "tmux:work");
});
```

This is a smoke test to force TypeScript compilation against the terminal target imports. The behavior tests remain covered through command/session tests because `ScreenMonitor.poll()` is private.

- [ ] **Step 2: Run output tests to verify they fail until imports compile**

Run:

```bash
npm test -- tests/output.test.ts
```

Expected: FAIL if `output.ts` still accepts only string targets after migration starts.

- [ ] **Step 3: Update output signatures and backend routing**

Modify `src/output.ts`:

```ts
import type { TerminalTarget } from "./terminal/types.js";
import { getBackendForTarget } from "./terminal/registry.js";
```

Remove:

```ts
import * as tmux from "./tmux.js";
```

Change function signatures:

```ts
export async function captureAndSend(ctx: Context, target: TerminalTarget, delayMs?: number): Promise<void>
export async function sendScreen(ctx: Context, target: TerminalTarget, pages: number = 1): Promise<void>
```

Inside `captureAndSend`, replace tmux calls:

```ts
const backend = getBackendForTarget(target);
const raw = await backend.captureVisible(target);
```

and:

```ts
const raw = await backend.capturePane(target);
```

Inside `sendScreen`, replace:

```ts
const backend = getBackendForTarget(target);
const raw = await backend.capturePane(target, captureLines);
```

Change `ScreenMonitor` fields and constructor:

```ts
private target: TerminalTarget;

constructor(chatId: number, target: TerminalTarget, ctx: Context, onStop: (chatId: number) => void)
```

In `start()`:

```ts
async start(target: TerminalTarget, ctx: Context): Promise<void> {
  this.target = target;
  const backend = getBackendForTarget(this.target);
  this.lastSignature = await backend.targetSignature(this.target);
  const raw = isImageMode(this.chatId)
    ? await backend.captureVisible(this.target)
    : await backend.capturePane(this.target);
}
```

In `poll()`:

```ts
const backend = getBackendForTarget(this.target);
signature = await backend.targetSignature(this.target);
raw = isImageMode(this.chatId)
  ? await backend.captureVisible(this.target)
  : await backend.capturePane(this.target);
```

Change `getOrCreateMonitor()` target parameter to `TerminalTarget`.

- [ ] **Step 4: Run output tests**

Run:

```bash
npm test -- tests/output.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/output.ts tests/output.test.ts
git commit -m "feat: route output through terminal backends"
```

---

### Task 8: Command Layer Migration And `/targets`

**Files:**
- Modify: `src/commands.ts`
- Modify: `src/index.ts`
- Test: `tests/commands.test.ts`

- [ ] **Step 1: Add command helper tests**

Append to `tests/commands.test.ts`:

```ts
import { formatTargetList } from "../src/commands.ts";
import type { TerminalTarget } from "../src/terminal/types.ts";

test("commands: formatTargetList groups targets by backend", () => {
  const current: TerminalTarget = {
    backend: "cmux",
    id: "workspace:1/surface:2",
    label: "Main / Shell",
    ref: "cmux:workspace:1/surface:2",
    cmuxWorkspace: "workspace:1",
    cmuxSurface: "surface:2",
  };
  const targets: TerminalTarget[] = [
    { backend: "tmux", id: "work", label: "work", ref: "tmux:work", tmuxSession: "work" },
    current,
  ];

  assert.equal(formatTargetList(targets, current), [
    "<b>终端目标列表:</b>",
    "",
    "<b>tmux</b>",
    "• <code>tmux:work</code> — work",
    "",
    "<b>cmux</b>",
    "• <code>cmux:workspace:1/surface:2</code> — Main / Shell ← 当前绑定",
  ].join("\n"));
});
```

- [ ] **Step 2: Run command tests to verify they fail**

Run:

```bash
npm test -- tests/commands.test.ts
```

Expected: FAIL because `formatTargetList` does not exist.

- [ ] **Step 3: Update imports and helpers**

Modify `src/commands.ts` imports:

```ts
import { attachTarget, detachSession, ensureTarget, getCurrentTarget, resetTarget } from "./session.js";
import { getBackendForTarget, listAllTargets } from "./terminal/registry.js";
import { parseAttachRef, parseTargetRef } from "./terminal/target-ref.js";
import type { TerminalTarget } from "./terminal/types.js";
```

Remove:

```ts
import * as tmux from "./tmux.js";
```

Add exported helper:

```ts
export function formatTargetList(targets: TerminalTarget[], current: TerminalTarget | null): string {
  if (targets.length === 0) {
    return "当前没有可用终端目标。";
  }
  const groups = new Map<string, TerminalTarget[]>();
  for (const target of targets) {
    const list = groups.get(target.backend) ?? [];
    list.push(target);
    groups.set(target.backend, list);
  }
  const lines = ["<b>终端目标列表:</b>"];
  for (const [backend, items] of groups) {
    lines.push("", `<b>${backend}</b>`);
    for (const target of items) {
      const marker = current?.ref === target.ref ? " ← 当前绑定" : "";
      lines.push(`• <code>${target.ref}</code> — ${target.label}${marker}`);
    }
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Replace command operations**

In each command, replace:

```ts
const target = await ensureSession(ctx.chat.id);
await tmux.sendTextAndEnter(target, cmd);
```

with:

```ts
const target = await ensureTarget(ctx.chat.id);
await getBackendForTarget(target).sendTextAndEnter(target, cmd);
```

Replace key operations similarly:

```ts
await getBackendForTarget(target).sendKey(target, "Enter");
```

Replace `/new`:

```ts
const target = await resetTarget(ctx.chat.id);
await captureAndSend(ctx, target, 200);
await ctx.reply(`已创建新的终端目标: <code>${target.ref}</code>`, { parse_mode: "HTML" });
```

Replace `/sessions` block with a shared handler:

```ts
async function replyTargets(ctx: Context): Promise<void> {
  const targets = await listAllTargets();
  await ctx.reply(formatTargetList(targets, getCurrentTarget(ctx.chat!.id)), { parse_mode: "HTML" });
}

bot.command("sessions", authMiddleware, replyTargets);
bot.command("targets", authMiddleware, replyTargets);
```

Replace `/attach`:

```ts
const raw = ctx.message.text.replace(/^\/attach\s*/, "").trim();
if (!raw) return ctx.reply("用法: /attach <tmux:session|cmux:surface|cmux:workspace/surface>");
const parsed = parseAttachRef(raw);
let target: TerminalTarget;
if (parsed.kind === "legacy-tmux") {
  target = parseTargetRef(`tmux:${parsed.sessionName}`);
} else {
  target = parsed.target;
}
const ok = await attachTarget(ctx.chat.id, target);
if (!ok) return ctx.reply(`目标不存在: ${raw}\n使用 /targets 查看可用目标。`);
await captureAndSend(ctx, target, 200);
return ctx.reply(`已绑定到终端目标: <code>${target.ref}</code>`, { parse_mode: "HTML" });
```

Replace `/detach` current-target text:

```ts
const current = getCurrentTarget(ctx.chat.id);
if (!current) return ctx.reply("当前没有绑定的终端目标。");
detachSession(ctx.chat.id);
ctx.reply(`已解绑终端目标: <code>${current.ref}</code>\n后续命令将使用默认目标。`, { parse_mode: "HTML" });
```

Replace `/open`:

```ts
const target = await ensureTarget(ctx.chat.id);
try {
  await getBackendForTarget(target).openInTerminal(target);
  ctx.reply(`已在本机打开终端目标: <code>${target.ref}</code>`, { parse_mode: "HTML" });
} catch (err) {
  ctx.reply(`打开终端失败: ${err instanceof Error ? err.message : String(err)}`);
}
```

Replace plain text handler:

```ts
const target = await ensureTarget(ctx.chat.id);
await getBackendForTarget(target).sendText(target, text);
```

- [ ] **Step 5: Update help and bot menu**

In `src/commands.ts` help text:

```ts
"/targets — 列出所有终端目标",
"/sessions — /targets 的兼容别名",
"/attach &lt;target&gt; — 绑定到指定终端目标",
```

In `src/index.ts` builtin commands:

```ts
{ command: "targets", description: "列出所有终端目标" },
{ command: "sessions", description: "列出所有终端目标" },
{ command: "attach", description: "绑定到指定终端目标" },
```

- [ ] **Step 6: Run command tests**

Run:

```bash
npm test -- tests/commands.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/commands.ts src/index.ts tests/commands.test.ts
git commit -m "feat: control terminal targets from commands"
```

---

### Task 9: Backend Registration At Startup

**Files:**
- Modify: `src/index.ts`
- Test: `npm run build`

- [ ] **Step 1: Add backend registration imports**

Modify `src/index.ts`:

```ts
import { createCmuxBackend } from "./terminal/cmux-backend.js";
import { registerTerminalBackend, getAvailableBackends } from "./terminal/registry.js";
import { createTmuxBackend } from "./terminal/tmux-backend.js";
```

- [ ] **Step 2: Register and validate backends after config load**

In `main()` after `await loadConfig();`:

```ts
registerTerminalBackend(createTmuxBackend());
registerTerminalBackend(createCmuxBackend());
const availableBackends = await getAvailableBackends();
if (availableBackends.length === 0) {
  console.error("错误: 没有可用的终端后端。请安装 tmux，或启动 cmux 并确认 cmux CLI 可用。");
  process.exit(1);
}
```

Add startup log:

```ts
console.log(`  可用终端后端: ${availableBackends.map((backend) => backend.kind).join(", ")}`);
```

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: discover terminal backends on startup"
```

---

### Task 10: Documentation And Final Verification

**Files:**
- Modify: `README.md`
- Modify: `config.example.json`

- [ ] **Step 1: Update README terminology**

In `README.md`, replace tmux-only wording with multi-backend wording in the intro and session sections:

```md
通过 Telegram Bot 远程控制终端的命令行工具，支持 tmux 与 cmux 管理终端目标。
```

Add a target refs section:

```md
### 终端目标

cligram 可以同时管理 tmux 和 cmux 目标。使用 `/targets` 查看目标列表：

- `tmux:<session>` 表示 tmux session，例如 `tmux:work`
- `cmux:<surface>` 表示 cmux surface，例如 `cmux:surface:2`
- `cmux:<workspace>/<surface>` 表示带 workspace 上下文的 cmux surface

绑定目标：

```text
/attach tmux:work
/attach cmux:workspace:1/surface:2
```

`/sessions` 仍然可用，是 `/targets` 的兼容别名。
```
```

Add config docs:

```md
| `cmuxPath` | string | `""` | cmux CLI 路径；空值时自动尝试 `cmux` 和 macOS app 内置路径 |
```

- [ ] **Step 2: Ensure example config has cmuxPath**

Verify `config.example.json` includes:

```json
"cmuxPath": ""
```

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS for all tests.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Check git diff**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` exits 0. `git status --short` shows only intended files.

- [ ] **Step 6: Commit**

```bash
git add README.md config.example.json
git commit -m "docs: document terminal targets"
```

---

## Self-Review

Spec coverage:

- Multi-backend instead of a global backend selector: Tasks 1, 2, 6, 8, 9.
- tmux compatibility: Tasks 3, 6, 8.
- cmux CLI adapter: Task 5.
- `/targets`, `/sessions`, `/attach`, `/new`, `/open`: Task 8.
- `cmuxPath` config: Task 4.
- Error normalization for cmux broken socket: Task 5.
- README/config docs: Task 10.

Placeholder scan:

- No unfinished-work markers are intentionally present.
- The one optional area is `/open` for cmux, and it is resolved by returning a clear unsupported message in the first implementation.

Type consistency:

- `TerminalTarget`, `TmuxTarget`, `CmuxTarget`, and `TerminalBackend` originate in Task 1 and are reused consistently.
- `ensureTarget`, `resetTarget`, `attachTarget`, and `getCurrentTarget` originate in Task 6 and are used by Task 8.
- Backend registry functions originate in Task 2 and are used by Tasks 6, 7, 8, and 9.
