import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { getTmuxSocket, getTmuxSocketDir, getConfig, CAPTURE_LINES } from "./config.js";
import { logWarn } from "./logger.js";

const execFile = promisify(execFileCb);

function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_/:.-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function tmux(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  const socket = getTmuxSocket();
  if (socket) {
    return execFile("tmux", ["-S", socket, ...args]);
  }
  return execFile("tmux", args);
}

export async function ensureSocketDir(): Promise<void> {
  const dir = getTmuxSocketDir();
  if (dir) {
    await mkdir(dir, { recursive: true });
  }
}

export async function createSession(name: string): Promise<void> {
  await ensureSocketDir();
  await tmux("new-session", "-d", "-s", name, "-n", "shell");
}

export async function killSession(name: string): Promise<void> {
  try {
    await tmux("kill-session", "-t", name);
  } catch {
    // session might not exist, ignore
  }
}

export async function sessionExists(name: string): Promise<boolean> {
  try {
    await tmux("has-session", "-t", name);
    return true;
  } catch {
    return false;
  }
}

export async function sendText(target: string, text: string): Promise<void> {
  await tmux("send-keys", "-t", target, "-l", "--", text);
}

export async function sendTextAndEnter(
  target: string,
  text: string,
): Promise<void> {
  await sendText(target, text);
  await sleep(100);
  await sendKey(target, "Enter");
}

export async function sendKey(target: string, key: string): Promise<void> {
  await tmux("send-keys", "-t", target, key);
}

export async function capturePane(
  target: string,
  lines: number = CAPTURE_LINES,
): Promise<string> {
  const { stdout } = await tmux(
    "capture-pane",
    "-p",
    "-J",
    "-t",
    target,
    "-S",
    `-${lines}`,
  );
  return stdout;
}

/** 只截取当前可见屏幕（不含滚动历史） */
export async function captureVisible(target: string): Promise<string> {
  const { stdout } = await tmux(
    "capture-pane",
    "-p",
    "-J",
    "-t",
    target,
  );
  return stdout;
}

export async function paneSignature(target: string): Promise<string> {
  const { stdout } = await tmux(
    "display-message",
    "-p",
    "-t",
    target,
    "#{session_id}:#{window_id}:#{pane_id}:#{history_size}:#{cursor_x}:#{cursor_y}:#{pane_dead}:#{pane_current_command}",
  );
  return stdout.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 列出当前 tmux 所有 session 名称 */
export async function listSessions(): Promise<string[]> {
  try {
    const { stdout } = await tmux("list-sessions", "-F", "#{session_name}");
    return stdout.trim().split("\n").filter(Boolean);
  } catch (err) {
    logWarn("tmux.listSessions", "list-sessions failed", undefined, err);
    return [];
  }
}

/** 探测 tmux 绝对路径（缓存结果） */
let resolvedTmuxPath = "";
async function getTmuxAbsPath(): Promise<string> {
  if (resolvedTmuxPath) return resolvedTmuxPath;
  const { stdout } = await execFile("which", ["tmux"]);
  resolvedTmuxPath = stdout.trim();
  return resolvedTmuxPath;
}

/** 构建使用绝对路径的 tmux attach 命令 */
async function buildAbsAttachCmd(sessionName: string): Promise<string> {
  const tmuxPath = await getTmuxAbsPath();
  const socket = getTmuxSocket();
  if (socket) {
    return `${shellEscape(tmuxPath)} -S ${shellEscape(socket)} attach -t ${shellEscape(sessionName)}`;
  }
  return `${shellEscape(tmuxPath)} attach -t ${shellEscape(sessionName)}`;
}

/** 在本机配置的终端程序中打开新窗口并 attach 到指定 session */
export async function openInTerminal(sessionName: string): Promise<void> {
  const terminal = getConfig().terminal;
  const attachCmd = await buildAbsAttachCmd(sessionName);

  if (terminal === "iterm2") {
    const script = `
      on run argv
        set attachCmd to item 1 of argv
        tell application "iTerm2"
          create window with default profile command attachCmd
          activate
        end tell
      end run
    `;
    await execFile("osascript", ["-e", script, attachCmd]);
  } else if (terminal === "terminal") {
    const script = `
      on run argv
        set attachCmd to item 1 of argv
        tell application "Terminal"
          do script attachCmd
          activate
        end tell
      end run
    `;
    await execFile("osascript", ["-e", script, attachCmd]);
  } else {
    // 自定义命令，替换占位符
    const socket = getTmuxSocket();
    const cmd = terminal
      .replace(/\$SESSION/g, shellEscape(sessionName))
      .replace(/\$SOCKET/g, shellEscape(socket));
    await execFile("sh", ["-c", cmd]);
  }
}
