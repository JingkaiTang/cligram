import test from "node:test";
import assert from "node:assert/strict";
import { createTmuxBackend } from "../src/terminal/tmux-backend.js";
import type { TerminalTarget } from "../src/terminal/types.js";

type TmuxCall = string[];

function tmuxTarget(session: string): TerminalTarget {
  return {
    backend: "tmux",
    id: session,
    label: session,
    ref: `tmux:${session}`,
    tmuxSession: session,
  };
}

function fakeDeps(options: {
  existingSessions?: string[];
  listSessionsOutput?: string;
  startDir?: string;
} = {}) {
  const calls: TmuxCall[] = [];
  const openedSessions: string[] = [];
  const sessions = new Set(options.existingSessions ?? []);

  return {
    calls,
    openedSessions,
    deps: {
      async runTmux(args: string[]) {
        calls.push(args);

        if (args[0] === "has-session") {
          const session = args[2];
          if (!sessions.has(session)) {
            throw new Error(`missing session ${session}`);
          }
          return { stdout: "", stderr: "" };
        }

        if (args[0] === "new-session") {
          const session = args[4];
          sessions.add(session);
          return { stdout: "", stderr: "" };
        }

        if (args[0] === "list-sessions") {
          return {
            stdout: options.listSessionsOutput ?? [...sessions].join("\n"),
            stderr: "",
          };
        }

        if (args[0] === "capture-pane") {
          return { stdout: "captured pane", stderr: "" };
        }

        if (args[0] === "display-message") {
          return { stdout: "signature\n", stderr: "" };
        }

        return { stdout: "", stderr: "" };
      },
      getStartDir() {
        return options.startDir ?? "/tmp/cligram";
      },
      async openInTerminal(sessionName: string) {
        openedSessions.push(sessionName);
      },
    },
  };
}

test("tmux backend: defaultTarget creates the canonical cg target", async () => {
  const { deps } = fakeDeps({ existingSessions: ["cg-42"] });
  const backend = createTmuxBackend(deps);

  assert.deepEqual(await backend.defaultTarget(42), {
    backend: "tmux",
    id: "cg-42",
    label: "cg-42",
    ref: "tmux:cg-42",
    tmuxSession: "cg-42",
  });
});

test("tmux backend: defaultTarget creates a missing session in the injected start dir", async () => {
  const { calls, deps } = fakeDeps({ startDir: "/work/start" });
  const backend = createTmuxBackend(deps);

  await backend.defaultTarget(42);

  assert.deepEqual(calls, [
    ["has-session", "-t", "cg-42"],
    ["new-session", "-d", "-s", "cg-42", "-n", "shell", "-c", "/work/start"],
  ]);
});

test("tmux backend: pane operations address the first pane of the session", async () => {
  const { calls, deps } = fakeDeps();
  const backend = createTmuxBackend(deps);
  const target = tmuxTarget("cg-42");

  await backend.sendText(target, "hello");
  await backend.sendKey(target, "Enter");
  assert.equal(await backend.capturePane(target, 25), "captured pane");

  assert.deepEqual(calls, [
    ["send-keys", "-t", "cg-42:0.0", "-l", "--", "hello"],
    ["send-keys", "-t", "cg-42:0.0", "Enter"],
    ["capture-pane", "-p", "-J", "-t", "cg-42:0.0", "-S", "-25"],
  ]);
});

test("tmux backend: listTargets maps tmux session names to tmux targets", async () => {
  const { deps } = fakeDeps({ listSessionsOutput: "alpha\nbeta\n" });
  const backend = createTmuxBackend(deps);

  assert.deepEqual(await backend.listTargets(), [
    tmuxTarget("alpha"),
    tmuxTarget("beta"),
  ]);
});

test("tmux backend: openInTerminal passes the tmux session name", async () => {
  const { deps, openedSessions } = fakeDeps();
  const backend = createTmuxBackend(deps);

  await backend.openInTerminal(tmuxTarget("cg-42"));

  assert.deepEqual(openedSessions, ["cg-42"]);
});
