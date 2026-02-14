import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import { isPaired, tryPair, unpair } from "./auth.js";
import { ensureSession, resetSession, attachSession, detachSession, getCurrentSession, getSessionName } from "./session.js";
import * as tmux from "./tmux.js";
import { captureAndSend, sendScreen, getOrCreateMonitor } from "./output.js";
import { getConfig, setOutputMode, type OutputMode } from "./config.js";

function getAuthId(ctx: Context): number | null {
  return ctx.from?.id ?? ctx.chat?.id ?? null;
}

// Middleware: require paired user for most commands
function authMiddleware(
  ctx: Context,
  next: () => Promise<void>,
): Promise<void> | void {
  const authId = getAuthId(ctx);
  if (!authId || !isPaired(authId)) {
    return ctx.reply("未配对。请先发送 /pair <配对码> 进行配对。") as unknown as void;
  }
  return next();
}

/** 命令执行后启动/重置屏幕监控 */
async function startMonitor(chatId: number, target: string, ctx: Context): Promise<void> {
  const monitor = getOrCreateMonitor(chatId, target, ctx);
  await monitor.start(target, ctx);
}

export function registerCommands(bot: Telegraf): void {
  // --- Public commands (no auth required) ---

  bot.start((ctx) => {
    ctx.reply(
      "欢迎使用 cligram！\n\n请发送 /pair <配对码> 完成配对后开始使用。\n配对码可在启动 cligram 的终端中找到。",
    );
  });

  bot.command("pair", (ctx) => {
    const code = ctx.message.text.split(/\s+/)[1] ?? "";
    if (!code) {
      return ctx.reply("用法: /pair <配对码>");
    }
    const authId = getAuthId(ctx);
    if (!authId) {
      return ctx.reply("无法识别当前用户，无法完成配对。");
    }
    if (isPaired(authId)) {
      return ctx.reply("你已经配对过了。");
    }
    if (tryPair(authId, code)) {
      return ctx.reply("配对成功！现在可以使用终端指令了。\n发送 /help 查看可用指令。");
    }
    return ctx.reply("配对码错误，请重试。");
  });

  // --- Authenticated commands ---

  bot.command("unpair", authMiddleware, (ctx) => {
    const authId = getAuthId(ctx);
    if (authId) {
      unpair(authId);
    }
    ctx.reply("已取消配对。");
  });

  bot.command("help", authMiddleware, (ctx) => {
    const lines = [
      "<b>可用指令:</b>",
      "/exec &lt;command&gt; — 执行命令",
      "/cd &lt;path&gt; — 切换目录",
      "/ls — 列出文件",
      "/pwd — 显示当前目录",
      "/screen [n] — 截屏（n=页数，默认1）",
      "/new — 新建终端会话",
      "/mode [text|image] — 查看/切换输出模式",
      "/enter — 输入回车键",
      "/up /down /left /right — 方向键",
      "/esc — Escape 键",
      "/ctrl + &lt;key&gt; — Ctrl 组合键",
      "/alt + &lt;key&gt; — Alt 组合键",
      "/shift + &lt;key&gt; — Shift 组合键",
      "/cmd + &lt;key&gt; — Cmd 组合键 (映射为 Ctrl)",
      "/unpair — 取消配对",
      "/pair &lt;配对码&gt; — 配对设备",
      "",
      "<b>会话管理:</b>",
      "/sessions — 列出所有 tmux 会话",
      "/attach &lt;session&gt; — 绑定到指定 tmux 会话",
      "/detach — 解绑当前会话",
      "/open — 在本机终端打开当前会话",
    ];

    const custom = getConfig().customCommands;
    const customKeys = Object.keys(custom);
    if (customKeys.length > 0) {
      lines.push("", "<b>自定义指令:</b>");
      for (const key of customKeys) {
        const desc = custom[key].description || custom[key].command;
        lines.push(`/${key} — ${desc}`);
      }
    }

    lines.push(
      "",
      "直接输入文本会发送到终端（不带回车）。",
      "命令执行后会自动监控屏幕变化（30秒无变化自动停止）。",
      "图片模式下终端输出渲染为 PNG 图片发送，适合手机端查看。",
    );

    ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });

  bot.command("screen", authMiddleware, async (ctx) => {
    const arg = ctx.message.text.replace(/^\/screen\s*/, "").trim();
    const pages = Math.max(1, Math.round(Number(arg) || 1));
    const target = await ensureSession(ctx.chat.id);
    await sendScreen(ctx, target, pages);
  });

  bot.command("mode", authMiddleware, (ctx) => {
    const arg = ctx.message.text.replace(/^\/mode\s*/, "").trim().toLowerCase();
    if (!arg) {
      const current = getConfig().outputMode;
      return ctx.reply(`当前输出模式: <b>${current}</b>\n用法: /mode text 或 /mode image`, {
        parse_mode: "HTML",
      });
    }
    if (arg !== "text" && arg !== "image") {
      return ctx.reply("无效模式。可选: text / image");
    }
    setOutputMode(arg as OutputMode);
    return ctx.reply(`输出模式已切换为: <b>${arg}</b>`, { parse_mode: "HTML" });
  });

  bot.command("new", authMiddleware, async (ctx) => {
    const target = await resetSession(ctx.chat.id);
    await captureAndSend(ctx, target, 200);
    await ctx.reply("已创建新的终端会话。");
  });

  bot.command("exec", authMiddleware, async (ctx) => {
    const cmd = ctx.message.text.replace(/^\/exec\s*/, "");
    if (!cmd) {
      return ctx.reply("用法: /exec <command>");
    }
    const target = await ensureSession(ctx.chat.id);
    await tmux.sendTextAndEnter(target, cmd);
    await captureAndSend(ctx, target);
    await startMonitor(ctx.chat.id, target, ctx);
  });

  bot.command("cd", authMiddleware, async (ctx) => {
    const dir = ctx.message.text.replace(/^\/cd\s*/, "").trim();
    if (!dir) {
      return ctx.reply("用法: /cd <path>");
    }
    const target = await ensureSession(ctx.chat.id);
    await tmux.sendTextAndEnter(target, `cd ${dir}`);
    await captureAndSend(ctx, target);
    await startMonitor(ctx.chat.id, target, ctx);
  });

  bot.command("ls", authMiddleware, async (ctx) => {
    const target = await ensureSession(ctx.chat.id);
    await tmux.sendTextAndEnter(target, "ls -alh");
    await captureAndSend(ctx, target);
    await startMonitor(ctx.chat.id, target, ctx);
  });

  bot.command("pwd", authMiddleware, async (ctx) => {
    const target = await ensureSession(ctx.chat.id);
    await tmux.sendTextAndEnter(target, "pwd");
    await captureAndSend(ctx, target);
    await startMonitor(ctx.chat.id, target, ctx);
  });

  bot.command("enter", authMiddleware, async (ctx) => {
    const target = await ensureSession(ctx.chat.id);
    await tmux.sendKey(target, "Enter");
    await captureAndSend(ctx, target);
    await startMonitor(ctx.chat.id, target, ctx);
  });

  bot.command("up", authMiddleware, async (ctx) => {
    const target = await ensureSession(ctx.chat.id);
    await tmux.sendKey(target, "Up");
    await captureAndSend(ctx, target);
    await startMonitor(ctx.chat.id, target, ctx);
  });

  bot.command("down", authMiddleware, async (ctx) => {
    const target = await ensureSession(ctx.chat.id);
    await tmux.sendKey(target, "Down");
    await captureAndSend(ctx, target);
    await startMonitor(ctx.chat.id, target, ctx);
  });

  bot.command("left", authMiddleware, async (ctx) => {
    const target = await ensureSession(ctx.chat.id);
    await tmux.sendKey(target, "Left");
    await captureAndSend(ctx, target);
    await startMonitor(ctx.chat.id, target, ctx);
  });

  bot.command("right", authMiddleware, async (ctx) => {
    const target = await ensureSession(ctx.chat.id);
    await tmux.sendKey(target, "Right");
    await captureAndSend(ctx, target);
    await startMonitor(ctx.chat.id, target, ctx);
  });

  bot.command("esc", authMiddleware, async (ctx) => {
    const target = await ensureSession(ctx.chat.id);
    await tmux.sendKey(target, "Escape");
    await captureAndSend(ctx, target);
    await startMonitor(ctx.chat.id, target, ctx);
  });

  bot.command("ctrl", authMiddleware, async (ctx) => {
    const key = parseModifierKey(ctx.message.text, "ctrl");
    if (!key) {
      return ctx.reply("用法: /ctrl + <key>");
    }
    const target = await ensureSession(ctx.chat.id);
    await tmux.sendKey(target, `C-${key}`);
    await captureAndSend(ctx, target);
    await startMonitor(ctx.chat.id, target, ctx);
  });

  bot.command("alt", authMiddleware, async (ctx) => {
    const key = parseModifierKey(ctx.message.text, "alt");
    if (!key) {
      return ctx.reply("用法: /alt + <key>");
    }
    const target = await ensureSession(ctx.chat.id);
    await tmux.sendKey(target, `M-${key}`);
    await captureAndSend(ctx, target);
    await startMonitor(ctx.chat.id, target, ctx);
  });

  bot.command("shift", authMiddleware, async (ctx) => {
    const key = parseModifierKey(ctx.message.text, "shift");
    if (!key) {
      return ctx.reply("用法: /shift + <key>");
    }
    const target = await ensureSession(ctx.chat.id);
    await tmux.sendKey(target, `S-${key}`);
    await captureAndSend(ctx, target);
    await startMonitor(ctx.chat.id, target, ctx);
  });

  bot.command("cmd", authMiddleware, async (ctx) => {
    // macOS 终端中 cmd 映射为 ctrl
    const key = parseModifierKey(ctx.message.text, "cmd");
    if (!key) {
      return ctx.reply("用法: /cmd + <key>");
    }
    const target = await ensureSession(ctx.chat.id);
    await tmux.sendKey(target, `C-${key}`);
    await captureAndSend(ctx, target);
    await startMonitor(ctx.chat.id, target, ctx);
  });

  // --- 会话管理指令 ---

  bot.command("sessions", authMiddleware, async (ctx) => {
    const sessions = await tmux.listSessions();
    if (sessions.length === 0) {
      return ctx.reply("当前没有 tmux 会话。");
    }
    const current = getCurrentSession(ctx.chat.id);
    const lines = sessions.map((s) => {
      const marker = s === current ? " ← 当前绑定" : "";
      return `• <code>${s}</code>${marker}`;
    });
    ctx.reply(`<b>tmux 会话列表:</b>\n${lines.join("\n")}`, { parse_mode: "HTML" });
  });

  bot.command("attach", authMiddleware, async (ctx) => {
    const name = ctx.message.text.replace(/^\/attach\s*/, "").trim();
    if (!name) {
      return ctx.reply("用法: /attach <session>");
    }
    const ok = await attachSession(ctx.chat.id, name);
    if (!ok) {
      return ctx.reply(`会话 "${name}" 不存在。使用 /sessions 查看可用会话。`);
    }
    const target = await ensureSession(ctx.chat.id);
    await captureAndSend(ctx, target, 200);
    await ctx.reply(`已绑定到会话: <code>${name}</code>`, { parse_mode: "HTML" });
  });

  bot.command("detach", authMiddleware, (ctx) => {
    const current = getCurrentSession(ctx.chat.id);
    if (!current) {
      return ctx.reply("当前没有绑定的会话。");
    }
    detachSession(ctx.chat.id);
    ctx.reply(`已解绑会话: <code>${current}</code>\n后续命令将使用默认会话。`, { parse_mode: "HTML" });
  });

  bot.command("open", authMiddleware, async (ctx) => {
    const terminal = getConfig().terminal;
    if (!terminal) {
      return ctx.reply("未配置终端程序。请在配置文件中设置 \"terminal\" 字段（如 \"iterm2\"）。");
    }
    const sessionName = getSessionName(ctx.chat.id);
    // 确保 session 存在
    await ensureSession(ctx.chat.id);
    try {
      await tmux.openInTerminal(sessionName);
      ctx.reply(`已在终端中打开会话: <code>${sessionName}</code>`, { parse_mode: "HTML" });
    } catch (err) {
      ctx.reply(`打开终端失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // --- 动态注册自定义指令 ---
  const customCommands = getConfig().customCommands;
  for (const [name, def] of Object.entries(customCommands)) {
    bot.command(name, authMiddleware, async (ctx) => {
      const args = ctx.message.text.replace(new RegExp(`^/${name}\\s*`), "");
      let cmd: string;
      if (def.command.includes("$args")) {
        cmd = def.command.replace(/\$args/g, args);
      } else {
        cmd = args ? `${def.command} ${args}` : def.command;
      }
      const target = await ensureSession(ctx.chat.id);
      await tmux.sendTextAndEnter(target, cmd);
      await captureAndSend(ctx, target);
      await startMonitor(ctx.chat.id, target, ctx);
    });
  }

  // --- Plain text: send to tmux (no Enter) ---
  bot.on(message("text"), authMiddleware, async (ctx) => {
    const text = ctx.message.text;
    const target = await ensureSession(ctx.chat.id);
    await tmux.sendText(target, text);
  });
}

function parseModifierKey(text: string, modifier: string): string | null {
  // Match patterns like "/ctrl + c", "/ctrl c", "/ctrl+c"
  const pattern = new RegExp(`^/${modifier}\\s*\\+?\\s*(.+)$`, "i");
  const match = text.match(pattern);
  if (!match) return null;
  return match[1].trim().toLowerCase();
}
