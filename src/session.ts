import { SESSION_PREFIX } from "./config.js";
import * as tmux from "./tmux.js";

/** chatId → 手动绑定的 tmux session 名称 */
const chatSessionMap = new Map<number, string>();
type TmuxApi = Pick<typeof tmux, "sessionExists" | "createSession" | "killSession">;
let tmuxApi: TmuxApi = tmux;

function sessionName(chatId: number): string {
  return `${SESSION_PREFIX}${chatId}`;
}

function target(chatId: number): string {
  return `${sessionName(chatId)}:0.0`;
}

export async function ensureSession(chatId: number): Promise<string> {
  // 优先使用手动绑定的 session
  const bound = chatSessionMap.get(chatId);
  if (bound) {
    const exists = await tmuxApi.sessionExists(bound);
    if (exists) {
      return `${bound}:0.0`;
    }
    // session 已不存在，清除绑定
    chatSessionMap.delete(chatId);
  }

  const name = sessionName(chatId);
  const exists = await tmuxApi.sessionExists(name);
  if (!exists) {
    await tmuxApi.createSession(name);
  }
  return target(chatId);
}

export async function resetSession(chatId: number): Promise<string> {
  // 重置时清除绑定
  chatSessionMap.delete(chatId);
  const name = sessionName(chatId);
  await tmuxApi.killSession(name);
  await tmuxApi.createSession(name);
  return target(chatId);
}

/** 将 chatId 绑定到指定的已有 tmux session */
export async function attachSession(chatId: number, sessionName: string): Promise<boolean> {
  const exists = await tmuxApi.sessionExists(sessionName);
  if (!exists) {
    return false;
  }
  chatSessionMap.set(chatId, sessionName);
  return true;
}

/** 解绑 chatId 的 session 绑定 */
export function detachSession(chatId: number): void {
  chatSessionMap.delete(chatId);
}

/** 获取当前 chatId 绑定的 session 名称，未绑定返回 null */
export function getCurrentSession(chatId: number): string | null {
  return chatSessionMap.get(chatId) ?? null;
}

/** 获取当前 chatId 对应的 session 名称（绑定的或默认的） */
export function getSessionName(chatId: number): string {
  return chatSessionMap.get(chatId) ?? sessionName(chatId);
}

// 仅用于测试
export function __setTmuxApiForTests(next: TmuxApi | null): void {
  tmuxApi = next ?? tmux;
}

// 仅用于测试
export function __resetSessionStateForTests(): void {
  chatSessionMap.clear();
  tmuxApi = tmux;
}
