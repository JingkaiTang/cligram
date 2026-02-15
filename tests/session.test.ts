import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetSessionStateForTests,
  __setTmuxApiForTests,
  attachSession,
  detachSession,
  ensureSession,
  getCurrentSession,
  getSessionName,
  resetSession,
} from "../src/session.ts";

interface FakeTmuxState {
  sessions: Set<string>;
  created: string[];
  killed: string[];
}

function createFakeTmux(state: FakeTmuxState) {
  return {
    async sessionExists(name: string): Promise<boolean> {
      return state.sessions.has(name);
    },
    async createSession(name: string): Promise<void> {
      state.created.push(name);
      state.sessions.add(name);
    },
    async killSession(name: string): Promise<void> {
      state.killed.push(name);
      state.sessions.delete(name);
    },
  };
}

test("session: ensureSession creates default session when missing", async () => {
  const state: FakeTmuxState = { sessions: new Set(), created: [], killed: [] };
  __resetSessionStateForTests();
  __setTmuxApiForTests(createFakeTmux(state));

  const target = await ensureSession(123);
  assert.equal(target, "cg-123:0.0");
  assert.deepEqual(state.created, ["cg-123"]);

  __resetSessionStateForTests();
});

test("session: attach/detach and reset flow", async () => {
  const state: FakeTmuxState = { sessions: new Set(["work", "cg-9"]), created: [], killed: [] };
  __resetSessionStateForTests();
  __setTmuxApiForTests(createFakeTmux(state));

  assert.equal(await attachSession(9, "work"), true);
  assert.equal(getCurrentSession(9), "work");
  assert.equal(await ensureSession(9), "work:0.0");

  detachSession(9);
  assert.equal(getCurrentSession(9), null);
  assert.equal(getSessionName(9), "cg-9");

  const target = await resetSession(9);
  assert.equal(target, "cg-9:0.0");
  assert.deepEqual(state.killed, ["cg-9"]);
  assert.deepEqual(state.created, ["cg-9"]);

  __resetSessionStateForTests();
});
