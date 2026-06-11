import { CAPTURE_LINES, getSessionStartDir } from "../config.js";
import {
  ensureSocketDir,
  openInTerminal as openTmuxInTerminal,
  runTmux,
} from "../tmux.js";
import {
  TerminalTargetError,
  type CreateTargetOptions,
  type TerminalBackend,
  type TerminalTarget,
  type TmuxTarget,
} from "./types.js";

type TmuxResult = { stdout: string; stderr: string };

export interface TmuxBackendDeps {
  runTmux?: (args: string[]) => Promise<TmuxResult>;
  getStartDir?: () => string;
  openInTerminal?: (sessionName: string) => Promise<void>;
  ensureSocketDir?: () => Promise<void>;
}

export function createTmuxBackend(deps: TmuxBackendDeps = {}): TerminalBackend {
  const tmux = deps.runTmux ?? runTmux;
  const getStartDir = deps.getStartDir ?? getSessionStartDir;
  const openInTerminal = deps.openInTerminal ?? openTmuxInTerminal;
  const prepareSocketDir = deps.ensureSocketDir ?? ensureSocketDir;

  async function targetExists(target: TerminalTarget): Promise<boolean> {
    const tmuxTarget = requireTmuxTarget(target);
    try {
      await tmux(["has-session", "-t", tmuxTarget.tmuxSession]);
      return true;
    } catch {
      return false;
    }
  }

  async function createTarget(
    chatId: number,
    options: CreateTargetOptions = {},
  ): Promise<TmuxTarget> {
    const sessionName = options.name ?? defaultSessionName(chatId);
    const cwd = options.cwd ?? getStartDir();
    await prepareSocketDir();
    await tmux(["new-session", "-d", "-s", sessionName, "-n", "shell", "-c", cwd]);
    return makeTarget(sessionName);
  }

  return {
    kind: "tmux",

    async isAvailable() {
      try {
        const { stdout, stderr } = await tmux(["-V"]);
        return {
          available: true,
          detail: (stdout || stderr).trim() || undefined,
        };
      } catch (err) {
        return {
          available: false,
          reason: "tmux unavailable",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async defaultTarget(chatId) {
      const target = makeTarget(defaultSessionName(chatId));
      if (!(await targetExists(target))) {
        return createTarget(chatId, { name: target.tmuxSession });
      }
      return target;
    },

    createTarget,
    targetExists,

    async listTargets() {
      try {
        const { stdout } = await tmux(["list-sessions", "-F", "#{session_name}"]);
        return stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(makeTarget);
      } catch {
        return [];
      }
    },

    async sendText(target, text) {
      await tmux(["send-keys", "-t", paneTarget(target), "-l", "--", text]);
    },

    async sendTextAndEnter(target, text) {
      await tmux(["send-keys", "-t", paneTarget(target), "-l", "--", text]);
      await sleep(100);
      await tmux(["send-keys", "-t", paneTarget(target), "Enter"]);
    },

    async sendKey(target, key) {
      await tmux(["send-keys", "-t", paneTarget(target), key]);
    },

    async capturePane(target, lines = CAPTURE_LINES) {
      const { stdout } = await tmux([
        "capture-pane",
        "-p",
        "-J",
        "-t",
        paneTarget(target),
        "-S",
        `-${lines}`,
      ]);
      return stdout;
    },

    async captureVisible(target) {
      const { stdout } = await tmux([
        "capture-pane",
        "-p",
        "-J",
        "-t",
        paneTarget(target),
      ]);
      return stdout;
    },

    async targetSignature(target) {
      const { stdout } = await tmux([
        "display-message",
        "-p",
        "-t",
        paneTarget(target),
        "#{session_id}:#{window_id}:#{pane_id}:#{history_size}:#{cursor_x}:#{cursor_y}:#{pane_dead}:#{pane_current_command}",
      ]);
      return stdout.trim();
    },

    async openInTerminal(target) {
      await openInTerminal(requireTmuxTarget(target).tmuxSession);
    },
  };
}

function defaultSessionName(chatId: number): string {
  return `cg-${chatId}`;
}

function makeTarget(sessionName: string): TmuxTarget {
  return {
    backend: "tmux",
    id: sessionName,
    label: sessionName,
    ref: `tmux:${sessionName}`,
    tmuxSession: sessionName,
  };
}

function paneTarget(target: TerminalTarget): string {
  return `${requireTmuxTarget(target).tmuxSession}:0.0`;
}

function requireTmuxTarget(target: TerminalTarget): TmuxTarget {
  if (target.backend !== "tmux") {
    throw new TerminalTargetError(`目标 ${target.ref} 不是 tmux target`);
  }
  return target;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
