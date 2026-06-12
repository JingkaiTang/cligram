import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CAPTURE_LINES, getConfig, getSessionStartDir } from "../config.js";
import {
  TerminalTargetError,
  type CmuxTarget,
  type CreateTargetOptions,
  type TerminalBackend,
  type TerminalTarget,
} from "./types.js";

const execFileAsync = promisify(execFile);
const MACOS_CMUX_PATH = "/Applications/cmux.app/Contents/MacOS/cmux";
const BROKEN_SOCKET_DETAIL = "cmux 已安装，但当前 socket 不可用。请启动或重启 cmux。";
const TIMEOUT_SOCKET_DETAIL = "cmux CLI 调用超时，当前 socket 可能无响应。请启动或重启 cmux。";
const MISSING_CLI_DETAIL = "未找到 cmux CLI，请安装 cmux，或在配置中设置 cmuxPath。";
const CMUX_COMMAND_TIMEOUT_MS = 5000;

type CmuxResult = { stdout: string; stderr: string };

export interface CmuxBackendDeps {
  run?: (command: string, args: string[]) => Promise<CmuxResult>;
  getCmuxPath?: () => string;
  getConfig?: () => { cmuxPath?: string };
  getStartDir?: () => string;
}

export function createCmuxBackend(deps: CmuxBackendDeps = {}): TerminalBackend {
  const run = deps.run ?? runCommand;
  const getPathFromConfig = deps.getCmuxPath ?? (() => (deps.getConfig ?? getConfig)().cmuxPath ?? "");
  const getStartDir = deps.getStartDir ?? getSessionStartDir;

  async function runCmux(args: string[]): Promise<CmuxResult> {
    const configuredPath = getPathFromConfig().trim();
    if (configuredPath) {
      return run(configuredPath, args);
    }

    try {
      return await run("cmux", args);
    } catch (err) {
      if (!isMissingCliError(err)) {
        throw err;
      }
    }

    try {
      return await run(MACOS_CMUX_PATH, args);
    } catch (err) {
      if (isMissingCliError(err)) {
        throw new CmuxBackendError("missing", MISSING_CLI_DETAIL);
      }
      throw err;
    }
  }

  async function listTargets(): Promise<CmuxTarget[]> {
    const { stdout } = await runCmux(["tree", "--all", "--json"]);
    return parseCmuxTree(stdout);
  }

  async function createTarget(
    chatId: number,
    options: CreateTargetOptions = {},
  ): Promise<CmuxTarget> {
    const name = options.name ?? defaultTargetName(chatId);
    const cwd = options.cwd ?? getStartDir();
    await runCmux(["new-workspace", "--name", name, "--cwd", cwd, "--focus", "false"]);

    const targets = await listTargets();
    const created = targets.find((target) => hasWorkspaceLabel(target, name));
    if (!created) {
      throw new TerminalTargetError(`cmux 已创建 workspace，但未能从 cmux tree 中找到 ${name}`);
    }
    return created;
  }

  return {
    kind: "cmux",

    async isAvailable() {
      try {
        await runCmux(["tree", "--all", "--json"]);
        return { available: true };
      } catch (err) {
        return normalizeAvailabilityError(err);
      }
    },

    async defaultTarget(chatId) {
      const name = defaultTargetName(chatId);
      const existing = (await listTargets()).find((target) => hasWorkspaceLabel(target, name));
      return existing ?? createTarget(chatId, { name });
    },

    createTarget,

    async targetExists(target) {
      const cmuxTarget = requireCmuxTarget(target);
      return (await listTargets()).some((candidate) => candidate.ref === cmuxTarget.ref);
    },

    listTargets,

    async sendText(target, text) {
      await runCmux([...targetArgs("send", requireCmuxTarget(target)), "--", text]);
    },

    async sendTextAndEnter(target, text) {
      await runCmux([...targetArgs("send", requireCmuxTarget(target)), "--", text]);
      await runCmux([...targetArgs("send-key", requireCmuxTarget(target)), "--", "enter"]);
    },

    async sendKey(target, key) {
      await runCmux([...targetArgs("send-key", requireCmuxTarget(target)), "--", translateCmuxKey(key)]);
    },

    async capturePane(target, lines = CAPTURE_LINES) {
      const { stdout } = await runCmux([
        ...targetArgs("read-screen", requireCmuxTarget(target)),
        "--scrollback",
        "--lines",
        String(lines),
      ]);
      return stdout;
    },

    async captureVisible(target) {
      const { stdout } = await runCmux(targetArgs("read-screen", requireCmuxTarget(target)));
      return stdout;
    },

    async targetSignature(target) {
      const cmuxTarget = requireCmuxTarget(target);
      const { stdout } = await runCmux(targetArgs("read-screen", cmuxTarget));
      return `${cmuxTarget.ref}:${stdout.length}:${stdout.slice(-200)}`;
    },

    async openInTerminal(target) {
      requireCmuxTarget(target);
      throw new TerminalTargetError("cmux target 暂不支持通过 /open 打开，请在 cmux 应用中切换到对应 workspace/surface。");
    },
  };
}

export function translateCmuxKey(key: string): string {
  const knownKeys = new Map([
    ["Enter", "enter"],
    ["Escape", "escape"],
    ["Esc", "escape"],
    ["Up", "up"],
    ["Down", "down"],
    ["Left", "left"],
    ["Right", "right"],
  ]);
  const known = knownKeys.get(key);
  if (known) {
    return known;
  }

  const modifier = /^([CMS])-([A-Za-z0-9_+-]+)$/.exec(key);
  if (modifier) {
    const prefix = modifier[1] === "C" ? "ctrl" : modifier[1] === "M" ? "alt" : "shift";
    return `${prefix}+${modifier[2].toLowerCase()}`;
  }

  return key.toLowerCase();
}

export function parseCmuxTree(raw: string): CmuxTarget[] {
  const parsed: unknown = JSON.parse(raw);
  const targets: CmuxTarget[] = [];

  for (const workspace of findWorkspaces(parsed)) {
    const workspaceId = stringValue(workspace, ["ref", "id", "workspaceId", "workspace"]);
    if (!workspaceId) {
      continue;
    }
    const workspaceTitle = stringValue(workspace, ["title", "name", "label"]) ?? workspaceId;
    for (const surface of findSurfaces(workspace)) {
      if (!isTerminalSurface(surface)) {
        continue;
      }
      const surfaceId = stringValue(surface, ["ref", "id", "surfaceId", "surface"]);
      if (!surfaceId) {
        continue;
      }
      const surfaceTitle = stringValue(surface, ["title", "name", "label"]) ?? surfaceId;
      targets.push(makeTarget(workspaceId, surfaceId, `${workspaceTitle} / ${surfaceTitle}`));
    }
  }

  return targets;
}

function targetArgs(command: string, target: CmuxTarget): string[] {
  const args = [command];
  if (target.cmuxWorkspace) {
    args.push("--workspace", target.cmuxWorkspace);
  }
  args.push("--surface", target.cmuxSurface);
  return args;
}

function makeTarget(workspace: string | undefined, surface: string, label?: string): CmuxTarget {
  const id = workspace ? `${workspace}/${surface}` : surface;
  return {
    backend: "cmux",
    id,
    label: label ?? id,
    ref: `cmux:${id}`,
    cmuxWorkspace: workspace,
    cmuxSurface: surface,
  };
}

function requireCmuxTarget(target: TerminalTarget): CmuxTarget {
  if (target.backend !== "cmux") {
    throw new TerminalTargetError(`目标 ${target.ref} 不是 cmux target`);
  }
  return target;
}

function defaultTargetName(chatId: number): string {
  return `cg-${chatId}`;
}

function hasWorkspaceLabel(target: CmuxTarget, name: string): boolean {
  return target.label === name || target.label.startsWith(`${name} / `);
}

async function runCommand(command: string, args: string[]): Promise<CmuxResult> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout: CMUX_COMMAND_TIMEOUT_MS,
  });
  return { stdout, stderr };
}

function normalizeAvailabilityError(err: unknown) {
  if (err instanceof CmuxBackendError) {
    return { available: false, reason: err.reason, detail: err.message };
  }
  if (isBrokenSocketError(err)) {
    return { available: false, reason: "socket", detail: BROKEN_SOCKET_DETAIL };
  }
  if (isSocketTimeoutError(err)) {
    return { available: false, reason: "socket", detail: TIMEOUT_SOCKET_DETAIL };
  }
  if (isMissingCliError(err)) {
    return { available: false, reason: "missing", detail: MISSING_CLI_DETAIL };
  }
  return {
    available: false,
    reason: "cmux unavailable",
    detail: err instanceof Error ? err.message : String(err),
  };
}

function isBrokenSocketError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Failed to write to socket.*Broken pipe|Broken pipe, errno 32/i.test(message);
}

function isSocketTimeoutError(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "ETIMEDOUT") {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /timed?\s*out|timeout/i.test(message);
}

function isMissingCliError(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "ENOENT") {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /ENOENT|not found|no such file or directory/i.test(message);
}

class CmuxBackendError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "CmuxBackendError";
  }
}

function findWorkspaces(value: unknown): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  const seen = new Set<Record<string, unknown>>();

  function visit(node: unknown, inWorkspacesArray: boolean): void {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, inWorkspacesArray);
      }
      return;
    }
    if (!node || typeof node !== "object") {
      return;
    }

    const record = node as Record<string, unknown>;
    if (isWorkspaceRecord(record, inWorkspacesArray) && !seen.has(record)) {
      seen.add(record);
      result.push(record);
    }

    for (const [key, child] of Object.entries(record)) {
      if (key === "workspaces" && Array.isArray(child)) {
        visit(child, true);
      } else {
        visit(child, false);
      }
    }
  }

  visit(value, false);
  return result;
}

function isWorkspaceRecord(record: Record<string, unknown>, inWorkspacesArray: boolean): boolean {
  if (inWorkspacesArray) {
    return true;
  }
  const ref = stringValue(record, ["ref"]);
  if (ref?.startsWith("workspace:")) {
    return true;
  }
  return stringValue(record, ["type", "kind"]) === "workspace";
}

function findSurfaces(workspace: Record<string, unknown>): Record<string, unknown>[] {
  const direct = [
    ...arrayRecords(workspace.surfaces),
    ...arrayRecords(workspace.children),
    ...arrayRecords(workspace.panes).flatMap((pane) => arrayRecords(pane.surfaces)),
  ];
  if (direct.length > 0) {
    return direct;
  }
  return collectRecords(workspace).filter((record) => record !== workspace && isSurfaceLike(record));
}

function isSurfaceLike(record: Record<string, unknown>): boolean {
  return Boolean(stringValue(record, ["surfaceId", "surface"])) || stringValue(record, ["type", "kind"]) === "terminal";
}

function isTerminalSurface(record: Record<string, unknown>): boolean {
  const type = stringValue(record, ["type", "kind", "surfaceType"]);
  if (!type) {
    return true;
  }
  return type.toLowerCase() === "terminal";
}

function collectRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectRecords);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap(collectRecords)];
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function stringValue(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}
