import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getConfig, getCligramHome, saveConfig } from "./config.js";
import { logInfo, logWarn } from "./logger.js";

let pairCode: string = "";
let pairCodeGeneratedAt = 0;
let failedPairAttempts = 0;
let pairCooldownUntil = 0;
const pairedUsers = new Set<number>();

const PAIR_CODE_TTL_MS = 10 * 60 * 1000;
const PAIR_MAX_FAILS = 5;
const PAIR_COOLDOWN_MS = 60 * 1000;

export type PairAttemptResult =
  | { ok: true }
  | { ok: false; reason: "invalid"; remainingAttempts: number }
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "cooldown"; retryAfterMs: number };

function generateCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

function issuePairCode(): string {
  pairCode = generateCode();
  pairCodeGeneratedAt = Date.now();
  return pairCode;
}

function announcePairCode(message: string): void {
  logInfo("auth.pair", message, { pairCode });
  logInfo("auth.pair", "send /pair <code> in Telegram to pair", { pairCode });
}

export function refreshPairCode(): string {
  failedPairAttempts = 0;
  pairCooldownUntil = 0;
  return issuePairCode();
}

export function getCurrentPairCode(): string {
  return pairCode;
}

export function isPaired(chatId: number): boolean {
  return pairedUsers.has(chatId);
}

export async function tryPair(chatId: number, code: string): Promise<PairAttemptResult> {
  const now = Date.now();
  if (pairCooldownUntil > now) {
    return { ok: false, reason: "cooldown", retryAfterMs: pairCooldownUntil - now };
  }
  if (!pairCodeGeneratedAt || now - pairCodeGeneratedAt > PAIR_CODE_TTL_MS) {
    const nextCode = refreshPairCode();
    announcePairCode(`配对码已过期，已生成新的配对码: ${nextCode}`);
    return { ok: false, reason: "expired" };
  }
  if (code !== pairCode) {
    failedPairAttempts += 1;
    const remainingAttempts = Math.max(0, PAIR_MAX_FAILS - failedPairAttempts);
    if (remainingAttempts === 0) {
      pairCooldownUntil = Date.now() + PAIR_COOLDOWN_MS;
      failedPairAttempts = 0;
      const nextCode = issuePairCode();
      announcePairCode(
        `配对失败次数过多，进入冷却 ${Math.ceil(PAIR_COOLDOWN_MS / 1000)} 秒，已生成新的配对码: ${nextCode}`,
      );
      return { ok: false, reason: "cooldown", retryAfterMs: PAIR_COOLDOWN_MS };
    }
    return { ok: false, reason: "invalid", remainingAttempts };
  }
  pairedUsers.add(chatId);
  try {
    await syncToConfig();
    refreshPairCode();
    return { ok: true };
  } catch (err) {
    pairedUsers.delete(chatId);
    throw err;
  }
}

export async function unpair(chatId: number): Promise<boolean> {
  const removed = pairedUsers.delete(chatId);
  if (!removed) {
    return false;
  }
  try {
    await syncToConfig();
    return true;
  } catch (err) {
    pairedUsers.add(chatId);
    throw err;
  }
}

/** 从 config 的 pairedUsers 字段初始化内存集合 */
export function loadPairedUsersFromConfig(): void {
  const cfg = getConfig();
  for (const id of cfg.pairedUsers) {
    pairedUsers.add(id);
  }
}

/** 迁移旧的 paired-users.json 到 config.json */
export async function migrateLegacyPairedUsers(): Promise<void> {
  const legacyPath = path.join(getCligramHome(), "paired-users.json");
  try {
    const data = await readFile(legacyPath, "utf-8");
    const ids: number[] = JSON.parse(data);
    let changed = false;
    for (const id of ids) {
      if (!pairedUsers.has(id)) {
        pairedUsers.add(id);
        changed = true;
      }
    }
    if (changed) {
      await syncToConfig();
    }
    // 删除旧文件
    await unlink(legacyPath);
    logInfo("auth.migrate", "migrated legacy paired-users.json to config.json", { path: legacyPath });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return;
    }
    logWarn("auth.migrate", "failed to migrate legacy paired users", { path: legacyPath }, err);
  }
}

/** 将内存中的 pairedUsers 同步回 config 文件 */
async function syncToConfig(): Promise<void> {
  const cfg = getConfig();
  cfg.pairedUsers = [...pairedUsers];
  await saveConfig();
}
