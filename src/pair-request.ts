import path from "node:path";
import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { getCligramHome } from "./config.js";
import { logInfo, logWarn } from "./logger.js";

const PAIR_REQUEST_FILE = "pair-requests.json";
const PAIR_REQUEST_INTERVAL_MS = 60 * 60 * 1000;
const PAIR_REQUEST_TTL_MS = 60 * 60 * 1000;
const PAIR_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIR_CODE_LEN = 8;
let pairRequestPathOverride = "";

export interface PairRequest {
  code: string;
  authId: number;
  chatId: number;
  username: string;
  requestedAt: number;
  expiresAt: number;
}

type PairRequestFile = {
  requests: PairRequest[];
};

function getPairRequestPath(): string {
  if (pairRequestPathOverride) {
    return pairRequestPathOverride;
  }
  return path.join(getCligramHome(), PAIR_REQUEST_FILE);
}

function sanitizeRequest(raw: unknown): PairRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (
    typeof r.code !== "string" ||
    !Number.isInteger(r.authId) ||
    !Number.isInteger(r.chatId) ||
    typeof r.username !== "string" ||
    typeof r.requestedAt !== "number" ||
    typeof r.expiresAt !== "number"
  ) {
    return null;
  }
  return {
    code: r.code.toUpperCase(),
    authId: Number(r.authId),
    chatId: Number(r.chatId),
    username: r.username,
    requestedAt: r.requestedAt,
    expiresAt: r.expiresAt,
  };
}

async function loadRequests(): Promise<PairRequest[]> {
  const filePath = getPairRequestPath();
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as PairRequestFile;
    if (!Array.isArray(parsed.requests)) {
      return [];
    }
    const result: PairRequest[] = [];
    for (const item of parsed.requests) {
      const req = sanitizeRequest(item);
      if (req) result.push(req);
    }
    return result;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return [];
    }
    logWarn("pair-request.load", "failed to read pair request file", { filePath }, err);
    return [];
  }
}

async function saveRequests(requests: PairRequest[]): Promise<void> {
  const filePath = getPairRequestPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload: PairRequestFile = { requests };
  await writeFile(filePath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
}

function cleanupExpiredRequests(requests: PairRequest[], now: number): PairRequest[] {
  return requests.filter((req) => req.expiresAt > now);
}

function randomCode(): string {
  let result = "";
  for (let i = 0; i < PAIR_CODE_LEN; i++) {
    const idx = crypto.randomInt(0, PAIR_CODE_ALPHABET.length);
    result += PAIR_CODE_ALPHABET[idx];
  }
  return result;
}

function generateUniqueCode(existingCodes: Set<string>): string {
  for (let i = 0; i < 10; i++) {
    const code = randomCode();
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  throw new Error("无法生成唯一配对码，请稍后重试");
}

export async function createPairRequest(authId: number, chatId: number, username?: string): Promise<
  | { ok: true; code: string; expiresAt: number }
  | { ok: false; retryAfterMs: number }
> {
  const now = Date.now();
  const requests = cleanupExpiredRequests(await loadRequests(), now);
  const lastRequest = requests
    .filter((req) => req.authId === authId)
    .sort((a, b) => b.requestedAt - a.requestedAt)[0];
  if (lastRequest && now - lastRequest.requestedAt < PAIR_REQUEST_INTERVAL_MS) {
    return {
      ok: false,
      retryAfterMs: PAIR_REQUEST_INTERVAL_MS - (now - lastRequest.requestedAt),
    };
  }

  const existingCodes = new Set(requests.map((req) => req.code));
  const code = generateUniqueCode(existingCodes);
  const expiresAt = now + PAIR_REQUEST_TTL_MS;
  requests.push({
    code,
    authId,
    chatId,
    username: username ?? "",
    requestedAt: now,
    expiresAt,
  });
  await saveRequests(requests);
  logInfo("pair-request.create", "pair request created", { authId, code, expiresAt });
  return { ok: true, code, expiresAt };
}

export async function consumePairRequest(code: string): Promise<
  | { ok: true; request: PairRequest }
  | { ok: false; reason: "not_found" | "expired" }
> {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) {
    return { ok: false, reason: "not_found" };
  }

  const now = Date.now();
  const requests = await loadRequests();
  const match = requests.find((req) => req.code === normalizedCode);
  const remaining = requests.filter((req) => req.code !== normalizedCode);
  const cleanedRemaining = cleanupExpiredRequests(remaining, now);

  if (!match) {
    if (cleanedRemaining.length !== requests.length) {
      await saveRequests(cleanedRemaining);
    }
    return { ok: false, reason: "not_found" };
  }

  if (match.expiresAt <= now) {
    await saveRequests(cleanedRemaining);
    return { ok: false, reason: "expired" };
  }

  await saveRequests(cleanedRemaining);
  logInfo("pair-request.consume", "pair request consumed", { authId: match.authId, code: match.code });
  return { ok: true, request: match };
}

export async function listPairRequests(): Promise<PairRequest[]> {
  const now = Date.now();
  const requests = await loadRequests();
  const active = cleanupExpiredRequests(requests, now);
  if (active.length !== requests.length) {
    await saveRequests(active);
  }
  return active.sort((a, b) => a.requestedAt - b.requestedAt);
}

// 仅用于测试
export function __getPairRequestConstantsForTests(): {
  intervalMs: number;
  ttlMs: number;
} {
  return {
    intervalMs: PAIR_REQUEST_INTERVAL_MS,
    ttlMs: PAIR_REQUEST_TTL_MS,
  };
}

// 仅用于测试
export function __setPairRequestPathForTests(filePath: string): void {
  pairRequestPathOverride = filePath;
}
