import {
  TerminalTargetError,
  type BackendKind,
  type TerminalBackend,
  type TerminalTarget,
} from "./types.js";

const backends = new Map<BackendKind, TerminalBackend>();
const defaultBackendPriority: BackendKind[] = ["tmux", "cmux"];

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

export async function getDefaultTarget(chatId: number): Promise<TerminalTarget> {
  for (const kind of defaultBackendPriority) {
    const backend = backends.get(kind);
    if (!backend) {
      continue;
    }

    if (await isBackendAvailable(backend)) {
      return backend.defaultTarget(chatId);
    }
  }

  throw new TerminalTargetError(
    "未找到可用终端后端，请安装 tmux 或启动 cmux 后重试。",
  );
}

export async function listAllTargets(): Promise<TerminalTarget[]> {
  const targets: TerminalTarget[] = [];
  for (const backend of backends.values()) {
    if (!(await isBackendAvailable(backend))) {
      continue;
    }

    try {
      targets.push(...(await backend.listTargets()));
    } catch {
      continue;
    }
  }
  return targets;
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
