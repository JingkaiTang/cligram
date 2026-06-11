# cligram multi-backend terminal design

## Summary

cligram should support both tmux and cmux at the same time. It should not run in a single global `terminalBackend` mode. Instead, cligram should discover available terminal backends, expose all usable targets to Telegram users, and bind each Telegram chat to one concrete terminal target.

The first implementation should keep tmux behavior compatible with existing users while adding cmux as a peer backend. A machine only needs one backend installed to run cligram, but if both tmux and cmux are available, both should be controllable in the same cligram process.

## Goals

- Keep existing tmux-based workflows working without configuration changes.
- Add cmux remote-control support for command input, key input, screen capture, monitoring, target listing, attach, detach, and new target creation.
- Let a Telegram chat bind to either a tmux target or a cmux target.
- Avoid a global backend switch. Backend choice belongs to the target, not the process.
- Make cmux operational errors readable, especially missing CLI, app not running, broken socket, and unstable surface references.

## Non-goals

- Full tmux/cmux feature parity in the first implementation.
- Cross-restart persistence of cmux surface bindings. cmux surface identifiers may change across app lifecycle events, so the first version should treat cmux bindings as runtime state.
- Replacing tmux with cmux internally.
- Implementing direct cmux socket RPC. The first version should use the public `cmux` CLI.

## Current State

cligram currently assumes tmux as its only terminal backend:

- `src/tmux.ts` wraps tmux CLI operations.
- `src/session.ts` maps Telegram chats to tmux session names and pane targets.
- `src/commands.ts` directly calls tmux operations for command input and session management.
- `src/output.ts` directly calls tmux capture and pane-signature operations.
- `tmuxSocket` is a tmux-specific configuration field and should remain supported.

cmux 0.64.14 is available on the local machine at `/Applications/cmux.app/Contents/MacOS/cmux`, though it is not currently on `PATH`. The CLI help shows the required primitives exist:

- `cmux send`
- `cmux send-key`
- `cmux read-screen`
- `cmux capture-pane`
- `cmux tree --json`
- `cmux new-workspace`

However, current socket-backed calls can fail with `Failed to write to socket (Broken pipe, errno 32)`. The implementation must not treat cmux CLI presence as proof that cmux is usable.

## Architecture

Add a backend-neutral terminal layer and move tmux-specific behavior behind it.

```ts
export type BackendKind = "tmux" | "cmux";

export interface TerminalTarget {
  backend: BackendKind;
  id: string;
  label: string;
  ref: string;
}

export interface TerminalBackend {
  kind: BackendKind;
  isAvailable(): Promise<BackendAvailability>;
  defaultTarget(chatId: number): Promise<TerminalTarget>;
  createTarget(chatId: number, options?: CreateTargetOptions): Promise<TerminalTarget>;
  targetExists(target: TerminalTarget): Promise<boolean>;
  listTargets(): Promise<TerminalTarget[]>;
  sendText(target: TerminalTarget, text: string): Promise<void>;
  sendTextAndEnter(target: TerminalTarget, text: string): Promise<void>;
  sendKey(target: TerminalTarget, key: string): Promise<void>;
  capturePane(target: TerminalTarget, lines?: number): Promise<string>;
  captureVisible(target: TerminalTarget): Promise<string>;
  targetSignature(target: TerminalTarget): Promise<string>;
  openInTerminal(target: TerminalTarget): Promise<void>;
}
```

The exact TypeScript names can change during implementation, but the boundary should stay: commands, session binding, and output monitoring should depend on a backend-neutral interface rather than importing `tmux.ts` directly.

## Target Model

Use explicit, user-facing target refs:

- tmux target refs: `tmux:<session>`
- cmux target refs: `cmux:<surface>` for globally resolvable surface refs or UUIDs
- cmux expanded refs: `cmux:<workspace>/<surface>` when workspace context is needed

Examples:

- `tmux:work`
- `tmux:cg-123456`
- `cmux:surface:2`
- `cmux:workspace:1/surface:2`
- `cmux:550e8400-e29b-41d4-a716-446655440000`

The parser should reject ambiguous refs with a clear message. For backward compatibility, `/attach work` may continue to mean `tmux:work` when a tmux session named `work` exists.

## Backend Discovery

On startup, discover backends independently:

1. tmux is available if the `tmux` executable is found and basic CLI invocation succeeds.
2. cmux is available if a cmux executable is found and a lightweight socket-backed check succeeds.

cmux path resolution:

1. `cmuxPath` from config, if set.
2. `cmux` from `PATH`.
3. `/Applications/cmux.app/Contents/MacOS/cmux` on macOS.

cligram can start if at least one backend is usable. If neither backend is usable, startup should fail with concrete remediation hints.

## Default Target Selection

Each Telegram chat binds to one concrete `TerminalTarget`.

When a chat already has a valid binding:

- Use that bound target.
- If the target no longer exists, clear the binding and select a new default target.

When a chat has no binding:

1. If tmux is available, create or reuse `tmux:cg-<chatId>`.
2. If tmux is unavailable and cmux is available, create or reuse a cmux workspace/surface for that chat.
3. If neither is available, return a readable error.

This keeps existing behavior stable and makes cmux the fallback for cmux-only environments. Do not add a global backend selector in the first implementation.

## Command Semantics

Keep the existing command surface as much as possible:

- `/exec <command>` sends text and Enter to the current target.
- Plain text sends text without Enter to the current target.
- `/enter`, arrows, `/esc`, `/ctrl`, `/alt`, `/shift`, `/cmd` send key events to the current target.
- `/screen [n]` captures the current target.
- `/new` creates a new target on the current target backend. If the chat has no current target, it follows the default target selection rule.
- `/sessions` remains supported as a compatibility command, but its reply should become backend-neutral and list all controllable targets grouped by backend.
- `/attach <target>` binds the chat to a target ref.
- `/detach` clears the binding and returns future commands to default target selection.
- `/open` should keep the current tmux behavior for tmux targets. For cmux targets, it should focus or select the cmux workspace/surface if cmux offers a reliable CLI path; otherwise it should return a clear unsupported message.

Add `/targets` as a clearer alias for the backend-neutral target list. Keep `/sessions` as an alias to avoid breaking existing users.

## cmux Backend Mapping

The cmux backend should use the cmux CLI:

- `sendText`: `cmux send --workspace <workspace> --surface <surface> -- <text>`
- `sendTextAndEnter`: either `cmux send` with newline handling or `sendText` followed by `send-key enter`
- `sendKey`: `cmux send-key --workspace <workspace> --surface <surface> -- <key>`
- `captureVisible`: `cmux read-screen --workspace <workspace> --surface <surface>`
- `capturePane`: `cmux read-screen --workspace <workspace> --surface <surface> --scrollback --lines <n>`
- `listTargets`: parse `cmux tree --json`
- `createTarget`: `cmux new-workspace --name <name> --cwd <dir> --focus false`, then resolve the created workspace/surface through `tree --json`

Key-name translation should be explicit because tmux and cmux use different conventions:

- `Enter` -> `enter`
- `Up` -> `up`
- `Down` -> `down`
- `Left` -> `left`
- `Right` -> `right`
- `Escape` -> `escape`
- `C-x` -> `ctrl+x`
- `M-x` -> `alt+x`
- `S-x` -> `shift+x`

## tmux Backend Mapping

The tmux backend should preserve current behavior:

- Move current `src/tmux.ts` operations behind the new backend interface.
- Keep `tmuxSocket` semantics unchanged.
- Keep default session naming as `cg-<chatId>`.
- Keep tmux target format internally as `<session>:0.0`, while exposing user refs as `tmux:<session>`.

## Error Handling

Errors should be normalized before they reach Telegram replies:

- Missing backend executable: explain how to install or configure the path.
- cmux app not running or socket broken: explain that cmux is installed but not currently controllable.
- Target missing: suggest `/sessions` and `/attach <target>`.
- Ambiguous target ref: show accepted forms.
- Unsupported operation: name the backend and operation.

cmux socket health must be checked with a real command, not only executable discovery. The observed `Broken pipe` failure should be covered by tests through mocked process execution.

## Testing

Add unit tests around the new boundaries:

- Target ref parsing for tmux and cmux forms.
- Default target selection with tmux-only, cmux-only, both available, and neither available.
- Chat binding lifecycle: attach, detach, missing target fallback.
- tmux backend command argument construction, including `tmuxSocket`.
- cmux backend command argument construction, including key translation.
- cmux error normalization for broken socket and missing executable.
- Output monitoring depends on the backend interface rather than direct tmux imports.

Keep integration tests optional because local cmux socket state is environment-dependent.

## Migration Plan

1. Introduce backend-neutral types and target parsing without changing behavior.
2. Wrap existing tmux behavior as `TmuxBackend`.
3. Update session binding and output monitoring to use `TerminalTarget` and `TerminalBackend`.
4. Add `CmuxBackend` using CLI calls.
5. Update `/sessions`, `/attach`, `/new`, and `/open` replies for multi-backend targets.
6. Update README and `config.example.json`.
7. Add focused unit tests.

## Decisions

- Add `/targets` in the first implementation and keep `/sessions` as a compatibility alias.
- `/new` creates a new target each time. For tmux this matches the existing reset/create behavior for the chat's default session. For cmux this creates a new workspace/surface and binds the chat to that new target.
- Store cmux bindings in memory only for the first implementation. If cmux restarts and a surface disappears, clear the binding and ask the user to pick a target again.
