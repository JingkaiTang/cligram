import { SESSION_PREFIX } from "./config.js";
import {
  getBackendForTarget,
  getDefaultBackend,
  getDefaultTarget,
} from "./terminal/registry.js";
import { TerminalTargetError, type TerminalTarget } from "./terminal/types.js";

/** chatId -> 手动绑定的终端目标 */
const chatTargetMap = new Map<number, TerminalTarget>();

function sessionName(chatId: number): string {
  return `${SESSION_PREFIX}${chatId}`;
}

function tmuxPaneTarget(target: TerminalTarget): string {
  if (target.backend !== "tmux") {
    throw new Error("当前默认终端不是 tmux，旧命令暂不支持 cmux target。");
  }
  return `${target.tmuxSession}:0.0`;
}

function tmuxTarget(sessionName: string): TerminalTarget {
  return {
    backend: "tmux",
    id: sessionName,
    label: sessionName,
    ref: `tmux:${sessionName}`,
    tmuxSession: sessionName,
  };
}

export async function ensureTarget(chatId: number): Promise<TerminalTarget> {
  const bound = chatTargetMap.get(chatId);
  if (bound) {
    const backend = getBackendForTarget(bound);
    if (await backend.targetExists(bound)) {
      return bound;
    }
    chatTargetMap.delete(chatId);
  }

  return getDefaultTarget(chatId);
}

export async function resetTarget(chatId: number): Promise<TerminalTarget> {
  const current = chatTargetMap.get(chatId);
  if (current) {
    const backend = getBackendForTarget(current);
    if (await backend.targetExists(current)) {
      const target = await backend.createTarget(chatId);
      chatTargetMap.set(chatId, target);
      return target;
    }
    chatTargetMap.delete(chatId);
  }

  const backend = await getDefaultBackend();
  const target = await backend.createTarget(chatId);
  chatTargetMap.set(chatId, target);
  return target;
}

export async function attachTarget(
  chatId: number,
  target: TerminalTarget,
): Promise<boolean> {
  const backend = getBackendForTarget(target);
  if (!(await backend.targetExists(target))) {
    return false;
  }

  chatTargetMap.set(chatId, target);
  return true;
}

export function getCurrentTarget(chatId: number): TerminalTarget | null {
  return chatTargetMap.get(chatId) ?? null;
}

/** 解绑 chatId 的 target 绑定 */
export function detachSession(chatId: number): void {
  chatTargetMap.delete(chatId);
}

export async function ensureSession(chatId: number): Promise<string> {
  return tmuxPaneTarget(await ensureTarget(chatId));
}

export async function resetSession(chatId: number): Promise<string> {
  return tmuxPaneTarget(await resetTarget(chatId));
}

/** 将 chatId 绑定到指定的已有 tmux session */
export async function attachSession(chatId: number, sessionName: string): Promise<boolean> {
  try {
    return await attachTarget(chatId, tmuxTarget(sessionName));
  } catch (err) {
    if (err instanceof TerminalTargetError) {
      return false;
    }
    throw err;
  }
}

/** 获取当前 chatId 绑定的 session 名称，未绑定或非 tmux 返回 null */
export function getCurrentSession(chatId: number): string | null {
  const target = chatTargetMap.get(chatId);
  return target?.backend === "tmux" ? target.tmuxSession : null;
}

/** 获取当前 chatId 对应的 session 名称（绑定的 tmux 或默认名） */
export function getSessionName(chatId: number): string {
  return getCurrentSession(chatId) ?? sessionName(chatId);
}

// 旧测试注入点已迁移到 terminal registry fake backend，保留空函数兼容。
export function __setTmuxApiForTests(): void {}

// 仅用于测试
export function __resetSessionStateForTests(): void {
  chatTargetMap.clear();
}
