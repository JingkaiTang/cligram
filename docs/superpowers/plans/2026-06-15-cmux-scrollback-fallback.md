# cmux Scrollback Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When cmux's `read-screen --scrollback` doesn't return extra content (TUI surfaces), fallback to pageup scroll capture so `/screen N` works everywhere.

**Architecture:** Modify `capturePane` in `cmux-backend.ts` to detect ineffective scrollback and fallback to `send-key pageup` + `read-screen` cycling. Extract fallback logic into a `captureByPageScroll` helper. No interface changes.

**Tech Stack:** TypeScript, Node.js built-in test framework (`node:test`), cmux CLI

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/terminal/cmux-backend.ts` | Modify | Add `captureByPageScroll` helper, modify `capturePane` with detection + fallback |
| `tests/cmux-backend.test.ts` | Modify | Add 4 test cases for scrollback fallback behavior |

---

### Task 1: Write tests for scrollback fallback

**Files:**
- Modify: `tests/cmux-backend.test.ts`

The existing `fakeDeps` mock returns `"screen text"` for all `read-screen` calls. We need a more flexible mock that returns different content based on whether `--scrollback` is passed, and tracks `send-key` calls.

- [ ] **Step 1: Add scrollback-aware mock helper and 4 test cases**

Add at the bottom of `tests/cmux-backend.test.ts`:

```typescript
test("cmux backend: capturePane returns scrollback when available", async () => {
  // Mock: --scrollback returns 150 lines (well above 50% threshold of 200*0.5=100)
  const scrollbackContent = Array.from({ length: 150 }, (_, i) => `line ${i}`).join("\n");
  const calls: CmuxCall[] = [];
  const backend = createCmuxBackend({
    async run(command, args) {
      calls.push({ command, args });
      if (args[0] === "read-screen") {
        if (args.includes("--scrollback")) {
          return { stdout: scrollbackContent, stderr: "" };
        }
        return { stdout: "visible screen", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
    getCmuxPath() { return "/opt/cmux"; },
    getStartDir() { return "/tmp"; },
  });

  const result = await backend.capturePane(cmuxTarget(), 200);
  assert.equal(result, scrollbackContent);

  // Should NOT have sent any pageup/pagedown keys
  const keyCalls = calls.filter(c => c.args[0] === "send-key");
  assert.equal(keyCalls.length, 0);
});

test("cmux backend: capturePane falls back to pageup scroll when scrollback is empty", async () => {
  // Mock: --scrollback returns only visible content (~5 lines), below 50% threshold of 100*0.5=50
  const visibleContent = "line1\nline2\nline3\nline4\nline5";
  const scrolledContent = "older1\nolder2\nolder3\nolder4\nolder5";
  let readScreenCallCount = 0;
  const calls: CmuxCall[] = [];

  const backend = createCmuxBackend({
    async run(command, args) {
      calls.push({ command, args });
      if (args[0] === "read-screen") {
        if (args.includes("--scrollback")) {
          return { stdout: visibleContent, stderr: "" };
        }
        // First call = visible, second call = after pageup
        readScreenCallCount++;
        if (readScreenCallCount === 1) {
          return { stdout: visibleContent, stderr: "" };
        }
        return { stdout: scrolledContent, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
    getCmuxPath() { return "/opt/cmux"; },
    getStartDir() { return "/tmp"; },
  });

  const result = await backend.capturePane(cmuxTarget(), 100);

  // Should contain both pages of content
  assert.ok(result.includes("line1"));
  assert.ok(result.includes("older1"));

  // Should have sent pageup and pagedown keys
  const keyCalls = calls.filter(c => c.args[0] === "send-key");
  const keyNames = keyCalls.map(c => c.args[c.args.length - 1]);
  assert.ok(keyNames.includes("pageup"), `expected pageup in ${keyNames}`);
  assert.ok(keyNames.includes("pagedown"), `expected pagedown in ${keyNames}`);
});

test("cmux backend: capturePane stops scrolling when content repeats (reached top)", async () => {
  const sameContent = "top of history\nline2\nline3";
  let readScreenCount = 0;
  const calls: CmuxCall[] = [];

  const backend = createCmuxBackend({
    async run(command, args) {
      calls.push({ command, args });
      if (args[0] === "read-screen") {
        if (args.includes("--scrollback")) {
          return { stdout: sameContent, stderr: "" };
        }
        readScreenCount++;
        return { stdout: sameContent, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
    getCmuxPath() { return "/opt/cmux"; },
    getStartDir() { return "/tmp"; },
  });

  await backend.capturePane(cmuxTarget(), 200);

  // Should have stopped early: only 1 visible read (duplicate detected immediately)
  // plus 1 scrollback read = 2 read-screen calls total
  const readScreenCalls = calls.filter(c => c.args[0] === "read-screen");
  // 1 scrollback attempt + 1 visible capture (duplicate detected, no pageup sent)
  assert.ok(readScreenCalls.length <= 3, `too many read-screen calls: ${readScreenCalls.length}`);
});

test("cmux backend: capturePane sends correct number of pagedown to restore position", async () => {
  const page1 = "page1_line1\npage1_line2";
  const page2 = "page2_line1\npage2_line2";
  const page3 = "page3_line1\npage3_line2";
  let readScreenCount = 0;
  const calls: CmuxCall[] = [];

  const backend = createCmuxBackend({
    async run(command, args) {
      calls.push({ command, args });
      if (args[0] === "read-screen") {
        if (args.includes("--scrollback")) {
          return { stdout: page1, stderr: "" };
        }
        readScreenCount++;
        if (readScreenCount <= 2) return { stdout: page1, stderr: "" };
        if (readScreenCount <= 4) return { stdout: page2, stderr: "" };
        return { stdout: page3, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
    getCmuxPath() { return "/opt/cmux"; },
    getStartDir() { return "/tmp"; },
  });

  await backend.capturePane(cmuxTarget(), 200);

  const keyCalls = calls.filter(c => c.args[0] === "send-key");
  const keyNames = keyCalls.map(c => c.args[c.args.length - 1]);
  const pageupCount = keyNames.filter(k => k === "pageup").length;
  const pagedownCount = keyNames.filter(k => k === "pagedown").length;

  // pagedown count should match pageup count to restore position
  assert.equal(pagedownCount, pageupCount, `pagedown(${pagedownCount}) should match pageup(${pageupCount})`);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/cmux-backend.test.ts`
Expected: New tests FAIL (capturePane doesn't have fallback logic yet)

- [ ] **Step 3: Commit**

```bash
git add tests/cmux-backend.test.ts
git commit -m "test: add scrollback fallback test cases for cmux backend"
```

---

### Task 2: Implement captureByPageScroll helper

**Files:**
- Modify: `src/terminal/cmux-backend.ts:17-19` (add constant + helper before `createCmuxBackend`)

- [ ] **Step 1: Add sleep constant and helper function**

Add after line 17 (`const CMUX_COMMAND_TIMEOUT_MS = 5000;`) in `src/terminal/cmux-backend.ts`:

```typescript
const SCROLL_WAIT_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 2: Add captureByPageScroll function**

Add before the `createCmuxBackend` function (after the `sleep` function):

```typescript
type RunCmuxFn = (args: string[]) => Promise<CmuxResult>;

async function captureByPageScroll(
  runCmux: RunCmuxFn,
  target: CmuxTarget,
  totalLines: number,
): Promise<string> {
  const args = targetArgs("read-screen", target);

  // Read visible screen to determine page size
  const { stdout: visibleRaw } = await runCmux(args);
  const visibleLines = visibleRaw.split("\n").length;
  const pages = Math.ceil(totalLines / Math.max(visibleLines, 1));

  const screens: string[] = [];
  let prevContent = "";

  for (let i = 0; i < pages; i++) {
    const { stdout } = await runCmux(args);
    // Stop if content didn't change (reached top of history)
    if (stdout === prevContent) break;
    screens.push(stdout);
    prevContent = stdout;

    if (i < pages - 1) {
      await runCmux([...targetArgs("send-key", target), "--", "pageup"]);
      await sleep(SCROLL_WAIT_MS);
    }
  }

  // Restore position: send pagedown for each pageup we sent
  const scrollCount = screens.length - 1;
  for (let i = 0; i < scrollCount; i++) {
    await runCmux([...targetArgs("send-key", target), "--", "pagedown"]);
  }

  // Return pages joined: current page first, older pages after
  return screens.join("\n");
}
```

- [ ] **Step 3: Run tests to verify helper compiles**

Run: `node --import tsx --test tests/cmux-backend.test.ts`
Expected: Tests still fail (capturePane not yet using the helper), but no compilation errors

- [ ] **Step 4: Commit**

```bash
git add src/terminal/cmux-backend.ts
git commit -m "feat: add captureByPageScroll helper for cmux scrollback fallback"
```

---

### Task 3: Modify capturePane with detection + fallback

**Files:**
- Modify: `src/terminal/cmux-backend.ts:118-126` (capturePane method)

- [ ] **Step 1: Replace capturePane implementation**

Replace the existing `capturePane` method:

```typescript
    async capturePane(target, lines = CAPTURE_LINES) {
      const cmuxTarget = requireCmuxTarget(target);
      const args = targetArgs("read-screen", cmuxTarget);
      const { stdout } = await runCmux([...args, "--scrollback", "--lines", String(lines)]);

      // Check if --scrollback actually returned extra content
      const scrollbackLines = stdout.split("\n").length;
      if (scrollbackLines > lines * 0.5) {
        return stdout;
      }

      // Fallback: scroll through pages using pageup
      return captureByPageScroll(runCmux, cmuxTarget, lines);
    },
```

- [ ] **Step 2: Run all tests**

Run: `node --import tsx --test tests/cmux-backend.test.ts`
Expected: ALL tests PASS (including existing tests + new fallback tests)

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: ALL tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/terminal/cmux-backend.ts tests/cmux-backend.test.ts
git commit -m "feat: cmux capturePane falls back to pageup scroll for TUI surfaces"
```

---

### Task 4: Manual verification

- [ ] **Step 1: Test with a real cmux TUI surface**

Run `/screen 3` on a cmux surface running Claude Code (or other TUI app) via Telegram. Verify:
- Content from multiple pages is returned
- Terminal view restores to the bottom after capture
- No error messages

- [ ] **Step 2: Test with a regular shell surface (scrollback available)**

Run `/screen 3` on a cmux surface running a normal shell. Verify:
- Existing behavior preserved (scrollback returned directly)
- No pageup/pagedown keys sent
