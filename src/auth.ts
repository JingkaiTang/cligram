import { readFile, unlink } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { getConfig, getCligramHome, getConfigPath, saveConfig } from "./config.js";
import { logInfo, logWarn } from "./logger.js";

const pairedUsers = new Set<number>();
let lastConfigMtimeMs = 0;

function replacePairedUsers(ids: number[]): void {
  pairedUsers.clear();
  for (const id of ids) {
    if (Number.isInteger(id)) {
      pairedUsers.add(id);
    }
  }
}

function updateConfigMtimeCache(): void {
  const configPath = getConfigPath();
  if (!configPath) return;
  try {
    lastConfigMtimeMs = statSync(configPath).mtimeMs;
  } catch {
    // ignore
  }
}

function syncPairedUsersFromDiskIfChanged(): void {
  const configPath = getConfigPath();
  if (!configPath) {
    return;
  }
  try {
    const mtimeMs = statSync(configPath).mtimeMs;
    if (mtimeMs <= lastConfigMtimeMs) {
      return;
    }
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as { pairedUsers?: unknown };
    const ids = Array.isArray(parsed.pairedUsers)
      ? parsed.pairedUsers.filter((item): item is number => Number.isInteger(item))
      : [];
    replacePairedUsers(ids);
    getConfig().pairedUsers = [...pairedUsers];
    lastConfigMtimeMs = mtimeMs;
  } catch (err) {
    logWarn("auth.sync", "failed to sync paired users from disk", { configPath }, err);
  }
}

export function isPaired(authId: number): boolean {
  syncPairedUsersFromDiskIfChanged();
  return pairedUsers.has(authId);
}

export async function pairUser(authId: number): Promise<"paired" | "already_paired"> {
  syncPairedUsersFromDiskIfChanged();
  if (pairedUsers.has(authId)) {
    return "already_paired";
  }
  pairedUsers.add(authId);
  try {
    await syncToConfig();
    return "paired";
  } catch (err) {
    pairedUsers.delete(authId);
    throw err;
  }
}

export async function unpair(authId: number): Promise<boolean> {
  syncPairedUsersFromDiskIfChanged();
  const removed = pairedUsers.delete(authId);
  if (!removed) {
    return false;
  }
  try {
    await syncToConfig();
    return true;
  } catch (err) {
    pairedUsers.add(authId);
    throw err;
  }
}

/** 从 config 的 pairedUsers 字段初始化内存集合 */
export function loadPairedUsersFromConfig(): void {
  const cfg = getConfig();
  replacePairedUsers(cfg.pairedUsers);
  updateConfigMtimeCache();
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
  updateConfigMtimeCache();
}

// 仅用于测试
export function __resetAuthStateForTests(): void {
  pairedUsers.clear();
  lastConfigMtimeMs = 0;
}
