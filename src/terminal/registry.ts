import {
  TerminalTargetError,
  type BackendKind,
  type BackendAvailability,
  type TerminalBackend,
  type TerminalTarget,
} from "./types.js";

const backends = new Map<BackendKind, TerminalBackend>();
const defaultBackendPriority: BackendKind[] = ["tmux", "cmux"];

export interface UnavailableBackend {
  kind: BackendKind;
  reason: string;
  detail: string;
}

export interface TargetListResult {
  targets: TerminalTarget[];
  unavailableBackends: UnavailableBackend[];
}

export function registerTerminalBackend(backend: TerminalBackend): void {
  backends.set(backend.kind, backend);
}

export function getBackend(kind: BackendKind): TerminalBackend {
  const backend = backends.get(kind);
  if (!backend) {
    throw new TerminalTargetError(`未注册终端后端 "${kind}"`);
  }
  return backend;
}

export function getBackendForTarget(target: TerminalTarget): TerminalBackend {
  return getBackend(target.backend);
}

export async function getAvailableBackends(): Promise<TerminalBackend[]> {
  const availableBackends: TerminalBackend[] = [];
  for (const backend of backends.values()) {
    if (await isBackendAvailable(backend)) {
      availableBackends.push(backend);
    }
  }
  return availableBackends;
}

export async function getDefaultBackend(): Promise<TerminalBackend> {
  for (const kind of defaultBackendPriority) {
    const backend = backends.get(kind);
    if (!backend) {
      continue;
    }

    if (await isBackendAvailable(backend)) {
      return backend;
    }
  }

  throw new TerminalTargetError(
    "未找到可用终端后端，请安装 tmux 或启动 cmux 后重试。",
  );
}

export async function getDefaultTarget(chatId: number): Promise<TerminalTarget> {
  return (await getDefaultBackend()).defaultTarget(chatId);
}

export async function listAllTargets(): Promise<TerminalTarget[]> {
  return (await listAllTargetsWithStatus()).targets;
}

export async function listAllTargetsWithStatus(): Promise<TargetListResult> {
  const targets: TerminalTarget[] = [];
  const unavailableBackends: UnavailableBackend[] = [];
  for (const backend of backends.values()) {
    let availability: BackendAvailability;
    try {
      availability = await backend.isAvailable();
    } catch (err) {
      unavailableBackends.push({
        kind: backend.kind,
        reason: "availability check failed",
        detail: errorDetail(err),
      });
      continue;
    }

    if (!availability.available) {
      unavailableBackends.push({
        kind: backend.kind,
        reason: availability.reason ?? "unavailable",
        detail: availability.detail ?? availability.reason ?? "不可用",
      });
      continue;
    }

    try {
      targets.push(...(await backend.listTargets()));
    } catch (err) {
      unavailableBackends.push({
        kind: backend.kind,
        reason: "list failed",
        detail: errorDetail(err),
      });
      continue;
    }
  }
  return { targets, unavailableBackends };
}

export function __resetTerminalBackendsForTests(): void {
  backends.clear();
}

async function isBackendAvailable(backend: TerminalBackend): Promise<boolean> {
  try {
    const availability = await backend.isAvailable();
    return availability.available;
  } catch {
    return false;
  }
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
