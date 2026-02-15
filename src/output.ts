import type { Context } from "telegraf";
import * as tmux from "./tmux.js";
import { MAX_MESSAGE_LENGTH, isImageMode, getConfig } from "./config.js";
import { renderTerminalImage } from "./render.js";
import { logError, logWarn } from "./logger.js";

// ── 工具函数 ─────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function trimOutput(raw: string): string {
  const lines = raw.split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  return lines.join("\n");
}

function resolveChatId(ctx: Context): number | undefined {
  return typeof ctx.chat?.id === "number" ? ctx.chat.id : undefined;
}

// ── 交互提示检测 ─────────────────────────────────────

const INTERACTIVE_PATTERNS = [
  /\[Y\/n\]/i,
  /\[y\/N\]/i,
  /\(yes\/no\)/i,
  /password\s*:/i,
  /\[sudo\]/i,
  /press any key/i,
  /press enter/i,
  /continue\?/i,
  /proceed\?/i,
];

function detectInteractivePrompt(text: string): boolean {
  return INTERACTIVE_PATTERNS.some((re) => re.test(text));
}

// ── 消息发送（支持分块）────────────────────────────

async function sendHtmlMessage(
  chatId: number,
  ctx: Context,
  html: string,
): Promise<void> {
  if (html.length <= MAX_MESSAGE_LENGTH) {
    await ctx.telegram.sendMessage(chatId, html, { parse_mode: "HTML" });
    return;
  }

  // 去掉 <pre></pre> 标签后按行分块
  const inner = html.replace(/^<pre>/, "").replace(/<\/pre>$/, "");
  const lines = inner.split("\n");
  let chunk = "";
  for (const line of lines) {
    const candidate = chunk ? chunk + "\n" + line : line;
    if (candidate.length + 13 > MAX_MESSAGE_LENGTH) {
      if (chunk) {
        await ctx.telegram.sendMessage(chatId, `<pre>${chunk}</pre>`, {
          parse_mode: "HTML",
        });
      }
      chunk = line;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) {
    await ctx.telegram.sendMessage(chatId, `<pre>${chunk}</pre>`, {
      parse_mode: "HTML",
    });
  }
}

// ── 图片发送辅助 ─────────────────────────────────────

async function replyWithImage(
  ctx: Context,
  text: string,
  caption?: string,
): Promise<boolean> {
  try {
    const png = await renderTerminalImage(text);
    await ctx.replyWithPhoto(
      { source: png, filename: "terminal.png" },
      caption ? { caption } : undefined,
    );
    return true;
  } catch (err) {
    logWarn("output.replyWithImage", "image render failed, fallback to text", undefined, err);
    return false;
  }
}

async function sendImageMessage(
  chatId: number,
  ctx: Context,
  text: string,
  caption?: string,
): Promise<boolean> {
  try {
    const png = await renderTerminalImage(text);
    await ctx.telegram.sendPhoto(
      chatId,
      { source: png, filename: "terminal.png" },
      caption ? { caption } : undefined,
    );
    return true;
  } catch (err) {
    logWarn("output.sendImageMessage", "image render failed, fallback to text", { chatId }, err);
    return false;
  }
}

// ── captureAndSend（原有功能保持）────────────────

export async function captureAndSend(
  ctx: Context,
  target: string,
  delayMs?: number,
): Promise<void> {
  await sleep(delayMs ?? getConfig().outputDelayMs);
  const chatId = resolveChatId(ctx);

  // 图片模式：只截取可见屏幕，避免图片过长
  if (isImageMode(chatId)) {
    const raw = await tmux.captureVisible(target);
    const output = trimOutput(raw);
    if (!output) return;
    const ok = await replyWithImage(ctx, output);
    if (ok) return;
    // 渲染失败，回退到文本模式（下面重新用完整历史截取）
  }

  const raw = await tmux.capturePane(target);
  const output = trimOutput(raw);

  if (!output) {
    return;
  }

  const escaped = escapeHtml(output);
  const formatted = `<pre>${escaped}</pre>`;

  if (formatted.length <= MAX_MESSAGE_LENGTH) {
    await ctx.reply(formatted, { parse_mode: "HTML" });
    return;
  }

  const lines = escaped.split("\n");
  let chunk = "";
  for (const line of lines) {
    const candidate = chunk ? chunk + "\n" + line : line;
    if (candidate.length + 13 > MAX_MESSAGE_LENGTH) {
      if (chunk) {
        await ctx.reply(`<pre>${chunk}</pre>`, { parse_mode: "HTML" });
      }
      chunk = line;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) {
    await ctx.reply(`<pre>${chunk}</pre>`, { parse_mode: "HTML" });
  }
}

// ── /screen 手动截屏 ────────────────────────────────

export async function sendScreen(
  ctx: Context,
  target: string,
  pages: number = 1,
): Promise<void> {
  const linesPerPage = getConfig().screenLines;
  const captureLines = linesPerPage * pages;

  const raw = await tmux.capturePane(target, captureLines);
  const output = trimOutput(raw);
  const chatId = resolveChatId(ctx);

  if (!output) {
    await ctx.reply("(屏幕为空)");
    return;
  }

  // 图片模式：按 screenLines 分页发送
  if (isImageMode(chatId)) {
    // 只保留最后 captureLines 行，避免 tmux 多返回导致多出一页
    let allLines = output.split("\n");
    if (allLines.length > captureLines) {
      allLines = allLines.slice(allLines.length - captureLines);
    }
    const totalPages = Math.ceil(allLines.length / linesPerPage);
    let allOk = true;

    for (let page = 0; page < totalPages; page++) {
      const slice = allLines.slice(
        page * linesPerPage,
        (page + 1) * linesPerPage,
      );
      const caption = totalPages > 1
        ? `[截屏 ${page + 1}/${totalPages}]`
        : undefined;
      const ok = await replyWithImage(ctx, slice.join("\n"), caption);
      if (!ok) {
        allOk = false;
        break;
      }
    }
    if (allOk) return;
    // 渲染失败，回退到文本模式
  }

  const escaped = escapeHtml(output);
  const formatted = `<pre>${escaped}</pre>`;

  if (formatted.length <= MAX_MESSAGE_LENGTH) {
    await ctx.reply(formatted, { parse_mode: "HTML" });
    return;
  }

  const lines = escaped.split("\n");
  let chunk = "";
  for (const line of lines) {
    const candidate = chunk ? chunk + "\n" + line : line;
    if (candidate.length + 13 > MAX_MESSAGE_LENGTH) {
      if (chunk) {
        await ctx.reply(`<pre>${chunk}</pre>`, { parse_mode: "HTML" });
      }
      chunk = line;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) {
    await ctx.reply(`<pre>${chunk}</pre>`, { parse_mode: "HTML" });
  }
}

// ── ScreenMonitor：per-chat 后台轮询 ───────────────

export class ScreenMonitor {
  private chatId: number;
  private target: string;
  private ctx: Context;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastContent: string = "";
  private lastSignature: string = "";
  private lastChangeAt: number = 0;
  private onStop: (chatId: number) => void;

  constructor(chatId: number, target: string, ctx: Context, onStop: (chatId: number) => void) {
    this.chatId = chatId;
    this.target = target;
    this.ctx = ctx;
    this.onStop = onStop;
  }

  /** 启动或重置监控 */
  async start(target: string, ctx: Context): Promise<void> {
    this.target = target;
    this.ctx = ctx;
    this.lastChangeAt = Date.now();

    // 用当前屏幕内容作为基线，避免首次 poll 误报
    // 截取方式须与 poll() 一致，否则基线不匹配会导致误报
    try {
      this.lastSignature = await tmux.paneSignature(this.target);
      const raw = isImageMode(this.chatId)
        ? await tmux.captureVisible(this.target)
        : await tmux.capturePane(this.target);
      this.lastContent = trimOutput(raw);
    } catch (err) {
      logWarn("output.monitor.start", "failed to initialize monitor baseline", {
        chatId: this.chatId,
        target: this.target,
      }, err);
    }

    if (this.timer) {
      // 已在运行，只需重置计时器和基线
      return;
    }

    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        logError("output.monitor.poll", "unexpected poll error", err, {
          chatId: this.chatId,
          target: this.target,
        });
      });
    }, getConfig().pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.onStop(this.chatId);
  }

  private async poll(): Promise<void> {
    // 检查空闲超时
    if (Date.now() - this.lastChangeAt > getConfig().idleTimeoutMs) {
      this.stop();
      return;
    }

    let signature: string;
    try {
      signature = await tmux.paneSignature(this.target);
    } catch (err) {
      logWarn("output.monitor.poll", "failed to read pane signature, stop monitor", {
        chatId: this.chatId,
        target: this.target,
      }, err);
      this.stop();
      return;
    }

    if (signature === this.lastSignature) {
      return;
    }
    this.lastSignature = signature;

    let raw: string;
    try {
      // 图片模式下只截取可见屏幕，文本模式截取完整历史
      raw = isImageMode(this.chatId)
        ? await tmux.captureVisible(this.target)
        : await tmux.capturePane(this.target);
    } catch (err) {
      // tmux 会话可能已关闭
      logWarn("output.monitor.poll", "failed to capture pane, stop monitor", {
        chatId: this.chatId,
        target: this.target,
      }, err);
      this.stop();
      return;
    }

    const content = trimOutput(raw);

    if (content === this.lastContent) {
      return;
    }

    this.lastContent = content;
    this.lastChangeAt = Date.now();

    if (!content) {
      return;
    }

    const isInteractive = detectInteractivePrompt(content);
    const prefix = isInteractive ? "[需要操作] " : "[屏幕更新] ";

    // 图片模式：尝试发送图片，失败回退文本
    if (isImageMode(this.chatId)) {
      try {
        const ok = await sendImageMessage(this.chatId, this.ctx, content, prefix);
        if (ok) return;
      } catch {
        // fall through to text
      }
    }

    const escaped = escapeHtml(content);
    const html = `<b>${escapeHtml(prefix)}</b>\n<pre>${escaped}</pre>`;

    try {
      await sendHtmlMessage(this.chatId, this.ctx, html);
    } catch (err) {
      logError("output.monitor.poll", "failed to send monitor message", err, {
        chatId: this.chatId,
      });
    }
  }
}

// ── 全局 monitor 管理 ────────────────────────────────

const monitors = new Map<number, ScreenMonitor>();

export function getOrCreateMonitor(
  chatId: number,
  target: string,
  ctx: Context,
): ScreenMonitor {
  let monitor = monitors.get(chatId);
  if (!monitor) {
    const created = new ScreenMonitor(chatId, target, ctx, (stoppedChatId) => {
      const current = monitors.get(stoppedChatId);
      if (current === created) {
        monitors.delete(stoppedChatId);
      }
    });
    monitor = created;
    monitors.set(chatId, monitor);
  }
  return monitor;
}

export function stopMonitor(chatId: number): boolean {
  const monitor = monitors.get(chatId);
  if (!monitor) {
    return false;
  }
  monitor.stop();
  return true;
}
