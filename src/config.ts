import path from "node:path";
import os from "node:os";
import { readFile, writeFile, mkdir } from "node:fs/promises";

// ── 类型 ──────────────────────────────────────────────

export type OutputMode = "text" | "image";

export interface CustomCommand {
  command: string;
  description: string;
}

export interface FontConfig {
  /** 字体族，默认 "Menlo, 'SF Mono', Consolas, 'DejaVu Sans Mono', 'PingFang SC', 'Noto Sans CJK SC', monospace" */
  family: string;
  /** 字号（px），默认 14 */
  size: number;
  /** 行高（px），默认 18 */
  lineHeight: number;
  /** 等宽字符宽度（px），默认 8.4 */
  charWidth: number;
}

export interface CligramConfig {
  botToken: string;
  pairedUsers: number[];
  outputMode: OutputMode;
  outputModeByChat: Record<string, OutputMode>;
  /** 命令执行后等待输出的延迟（毫秒），默认 500 */
  outputDelayMs: number;
  /** 屏幕监控轮询间隔（毫秒），默认 5000 */
  pollIntervalMs: number;
  /** 屏幕监控无变化自动停止超时（毫秒），默认 30000 */
  idleTimeoutMs: number;
  /** /screen 单屏行数（也是图片分页行数），默认 50 */
  screenLines: number;
  /** 自定义指令映射 */
  customCommands: Record<string, CustomCommand>;
  /** tmux socket 路径，空字符串表示使用系统默认 socket */
  tmuxSocket: string;
  /** 终端程序配置，用于 /open 指令。预设值: "iterm2"、"terminal"，或自定义命令 */
  terminal: string;
  /** 图片模式渲染字体配置 */
  font: FontConfig;
}

// ── 常量 ──────────────────────────────────────────────

export const SESSION_PREFIX = "cg-";
export const CAPTURE_LINES = 200;
export const MAX_MESSAGE_LENGTH = 4096;

// 默认值
const DEFAULT_OUTPUT_DELAY_MS = 500;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_IDLE_TIMEOUT_MS = 30000;
const DEFAULT_SCREEN_LINES = 50;

const DEFAULT_FONT: FontConfig = {
  family: "Menlo, 'SF Mono', Consolas, 'DejaVu Sans Mono', 'PingFang SC', 'Noto Sans CJK SC', monospace",
  size: 14,
  lineHeight: 18,
  charWidth: 8.4,
};

// ── 运行时状态（loadConfig 后填充）──────────────────

let configPath = "";
let config: CligramConfig = {
  botToken: "",
  pairedUsers: [],
  outputMode: "text",
  outputModeByChat: {},
  outputDelayMs: DEFAULT_OUTPUT_DELAY_MS,
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
  screenLines: DEFAULT_SCREEN_LINES,
  customCommands: {},
  tmuxSocket: "",
  terminal: "",
  font: { ...DEFAULT_FONT },
};
let tmuxSocket = "";
let tmuxSocketDir = "";
let cligramHome = "";

export function getConfig(): CligramConfig {
  return config;
}

export function getConfigPath(): string {
  return configPath;
}

export function getTmuxSocket(): string {
  return tmuxSocket;
}

export function getTmuxSocketDir(): string {
  return tmuxSocketDir;
}

export function getCligramHome(): string {
  return cligramHome;
}

// ── 配置文件读写 ─────────────────────────────────────

function parseArgs(): string | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) {
      return path.resolve(args[i + 1]);
    }
  }
  return null;
}

function positiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  return fallback;
}

function positiveNum(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

/** 内置指令名称，用于检测自定义指令冲突 */
const BUILTIN_COMMANDS = new Set([
  "start", "pair", "unpair", "help", "screen", "mode", "new",
  "exec", "cd", "ls", "pwd", "enter", "up", "down", "left",
  "right", "esc", "ctrl", "alt", "shift", "cmd",
  "sessions", "attach", "detach", "open",
]);

function parseFont(raw: unknown): FontConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_FONT };
  }
  const r = raw as Record<string, unknown>;
  return {
    family: typeof r.family === "string" && r.family ? r.family : DEFAULT_FONT.family,
    size: positiveNum(r.size, DEFAULT_FONT.size),
    lineHeight: positiveNum(r.lineHeight, DEFAULT_FONT.lineHeight),
    charWidth: positiveNum(r.charWidth, DEFAULT_FONT.charWidth),
  };
}

function parseCustomCommands(raw: unknown): Record<string, CustomCommand> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, CustomCommand> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (BUILTIN_COMMANDS.has(key)) {
      console.warn(`警告: 自定义指令 "${key}" 与内置指令同名，已跳过`);
      continue;
    }
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).command === "string"
    ) {
      const v = value as Record<string, unknown>;
      result[key] = {
        command: v.command as string,
        description: typeof v.description === "string" ? v.description : "",
      };
    }
  }
  return result;
}

function parseOutputModeByChat(raw: unknown): Record<string, OutputMode> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, OutputMode> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === "image" || value === "text") {
      result[key] = value;
    }
  }
  return result;
}

export async function loadConfig(): Promise<CligramConfig> {
  cligramHome = path.join(os.homedir(), ".cligram");
  configPath = parseArgs() ?? path.join(cligramHome, "config.json");

  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch {
    console.error(`错误: 无法读取配置文件 ${configPath}`);
    console.error("请创建配置文件，参考 config.example.json");
    process.exit(1);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`错误: 配置文件 ${configPath} 不是合法的 JSON`);
    process.exit(1);
  }

  if (!parsed.botToken || typeof parsed.botToken !== "string") {
    console.error("错误: 配置文件缺少 botToken 字段");
    process.exit(1);
  }

  config = {
    botToken: parsed.botToken,
    pairedUsers: Array.isArray(parsed.pairedUsers)
      ? (parsed.pairedUsers as number[])
      : [],
    outputMode:
      parsed.outputMode === "image" ? "image" : "text",
    outputModeByChat: parseOutputModeByChat(parsed.outputModeByChat),
    outputDelayMs: positiveInt(parsed.outputDelayMs, DEFAULT_OUTPUT_DELAY_MS),
    pollIntervalMs: positiveInt(parsed.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS),
    idleTimeoutMs: positiveInt(parsed.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS),
    screenLines: positiveInt(parsed.screenLines, DEFAULT_SCREEN_LINES),
    customCommands: parseCustomCommands(parsed.customCommands),
    tmuxSocket: typeof parsed.tmuxSocket === "string" ? parsed.tmuxSocket : "",
    terminal: typeof parsed.terminal === "string" ? parsed.terminal : "",
    font: parseFont(parsed.font),
  };

  // 派生 tmux socket 路径
  if (config.tmuxSocket) {
    // 用户指定了 socket 路径
    tmuxSocket = config.tmuxSocket;
    tmuxSocketDir = path.dirname(tmuxSocket);
  } else {
    // 空字符串 → 使用系统默认 socket（不传 -S）
    tmuxSocket = "";
    tmuxSocketDir = "";
  }

  return config;
}

export async function saveConfig(): Promise<void> {
  const dir = path.dirname(configPath);
  await mkdir(dir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ── 输出模式辅助函数 ───────────────────────────────

export function getOutputMode(chatId?: number): OutputMode {
  if (typeof chatId === "number") {
    return config.outputModeByChat[String(chatId)] ?? config.outputMode;
  }
  return config.outputMode;
}

export function isImageMode(chatId?: number): boolean {
  return getOutputMode(chatId) === "image";
}

export async function setOutputMode(mode: OutputMode, chatId?: number): Promise<void> {
  const previous = config.outputMode;
  const previousByChat = { ...config.outputModeByChat };
  if (typeof chatId === "number") {
    config.outputModeByChat[String(chatId)] = mode;
  } else {
    config.outputMode = mode;
  }
  try {
    await saveConfig();
  } catch (err) {
    config.outputMode = previous;
    config.outputModeByChat = previousByChat;
    throw err;
  }
}
