import { Telegraf } from "telegraf";
import { loadConfig, getConfig } from "./config.js";
import {
  loadPairedUsersFromConfig,
  migrateLegacyPairedUsers,
  refreshPairCode,
} from "./auth.js";
import { registerCommands } from "./commands.js";

async function main(): Promise<void> {
  await loadConfig();

  loadPairedUsersFromConfig();
  await migrateLegacyPairedUsers();

  const code = refreshPairCode();
  console.log("=================================");
  console.log("  cligram 已启动");
  console.log(`  配对码: ${code}`);
  console.log("=================================");
  console.log("在 Telegram 中发送 /pair " + code + " 进行配对");
  console.log("");

  const bot = new Telegraf(getConfig().botToken);
  registerCommands(bot);

  // 设置 Bot 命令菜单（聊天输入框的快捷指令按钮）
  const builtinCommands = [
    { command: "exec", description: "执行命令" },
    { command: "cd", description: "切换目录" },
    { command: "ls", description: "列出文件" },
    { command: "pwd", description: "显示当前目录" },
    { command: "screen", description: "截屏（可加页数）" },
    { command: "mode", description: "查看/切换输出模式" },
    { command: "new", description: "新建终端会话" },
    { command: "sessions", description: "列出所有 tmux 会话" },
    { command: "attach", description: "绑定到指定 tmux 会话" },
    { command: "detach", description: "解绑当前会话" },
    { command: "open", description: "在本机终端打开当前会话" },
    { command: "enter", description: "输入回车键" },
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
