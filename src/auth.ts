import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getConfig, getCligramHome, saveConfig } from "./config.js";

let pairCode: string = "";
const pairedUsers = new Set<number>();

function generateCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

export function refreshPairCode(): string {
  pairCode = generateCode();
  return pairCode;
}

export function getCurrentPairCode(): string {
  return pairCode;
}

export function isPaired(chatId: number): boolean {
  return pairedUsers.has(chatId);
}

export function tryPair(chatId: number, code: string): boolean {
  if (code === pairCode) {
    pairedUsers.add(chatId);
    syncToConfig();
    refreshPairCode();
    return true;
  }
  return false;
}

export function unpair(chatId: number): boolean {
  const removed = pairedUsers.delete(chatId);
  if (removed) {
    syncToConfig();
  }
  return removed;
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
    console.log("已迁移旧的 paired-users.json 到 config.json");
  } catch {
    // 旧文件不存在，忽略
  }
}

/** 将内存中的 pairedUsers 同步回 config 文件 */
async function syncToConfig(): Promise<void> {
  const cfg = getConfig();
  cfg.pairedUsers = [...pairedUsers];
  try {
    await saveConfig();
  } catch (err) {
    console.error("保存配对用户失败:", err);
  }
}
