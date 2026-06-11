import { Telegraf } from "telegraf";
import { loadConfig, getConfig } from "./config.js";
import {
  loadPairedUsersFromConfig,
  migrateLegacyPairedUsers,
} from "./auth.js";
import { formatBotError } from "./bot-errors.js";
import { registerCommands } from "./commands.js";
import { createCmuxBackend } from "./terminal/cmux-backend.js";
import { getAvailableBackends, registerTerminalBackend } from "./terminal/registry.js";
import { createTmuxBackend } from "./terminal/tmux-backend.js";

async function main(): Promise<void> {
  await loadConfig();

  registerTerminalBackend(createTmuxBackend());
  registerTerminalBackend(createCmuxBackend());
  const availableBackends = await getAvailableBackends();
  if (availableBackends.length === 0) {
    console.error("未找到可用终端后端，请安装 tmux 或启动 cmux 后重试。");
    process.exit(1);
  }
  console.log(`可用终端后端: ${availableBackends.map((backend) => backend.kind).join(", ")}`);

  loadPairedUsersFromConfig();
  await migrateLegacyPairedUsers();

  console.log("=================================");
  console.log("  cligram 已启动");
  console.log("  配对方式: Telegram 中发送 /pair 申请配对码");
  console.log("  然后在本机执行: cligram pair approve <配对码>");
  console.log("=================================");
  console.log("");

  const bot = new Telegraf(getConfig().botToken);
  bot.catch(async (err, ctx) => {
    console.error("Bot handler failed:", err);
    try {
      await ctx.reply(formatBotError(err));
    } catch (replyErr) {
      console.error("Bot error reply failed:", replyErr);
    }
  });
  registerCommands(bot);

  // 设置 Bot 命令菜单（聊天输入框的快捷指令按钮）
  const builtinCommands = [
    { command: "exec", description: "执行命令" },
    { command: "enter", description: "输入回车键" },
    { command: "cd", description: "切换目录" },
    { command: "ls", description: "列出文件" },
    { command: "pwd", description: "显示当前目录" },
    { command: "screen", description: "截屏（可加页数）" },
    { command: "mode", description: "查看/切换输出模式" },
    { command: "new", description: "新建终端目标" },
    { command: "targets", description: "列出所有终端目标" },
    { command: "sessions", description: "兼容别名，等同 targets" },
    { command: "attach", description: "绑定到指定终端目标" },
    { command: "detach", description: "解绑当前终端目标" },
    { command: "open", description: "在本机终端打开当前终端目标" },
    { command: "up", description: "↑ 方向键" },
    { command: "down", description: "↓ 方向键" },
    { command: "esc", description: "Escape 键" },
    { command: "ctrl", description: "Ctrl 组合键" },
    { command: "help", description: "查看帮助" },
  ];

  const customCommands = getConfig().customCommands;
  const customMenuItems = Object.entries(customCommands).map(([name, def]) => ({
    command: name,
    description: def.description || def.command,
  }));

  await bot.telegram.setMyCommands([...builtinCommands, ...customMenuItems]);

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`\n收到 ${signal}，正在关闭...`);
    bot.stop(signal);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  await bot.launch();
  console.log("Bot 正在运行，等待连接...");
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
