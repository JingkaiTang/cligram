import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../src/config.ts";
import {
  __resetAuthStateForTests,
  isPaired,
  refreshPairCode,
  tryPair,
  unpair,
} from "../src/auth.ts";
import { createTempConfig, withArgvConfig } from "./helpers.ts";

function wrongCodeFor(code: string): string {
  return code === "000000" ? "000001" : "000000";
}

test("auth: pair and unpair updates state and config", async () => {
  const configPath = await createTempConfig();

  await withArgvConfig(configPath, async () => {
    await loadConfig();
    __resetAuthStateForTests();

    const code = refreshPairCode();
    const paired = await tryPair(42, code);
    assert.equal(paired.ok, true);
    assert.equal(isPaired(42), true);

    const removed = await unpair(42);
    assert.equal(removed, true);
    assert.equal(isPaired(42), false);
  });

  const persisted = JSON.parse(await readFile(configPath, "utf-8")) as {
    pairedUsers: number[];
  };
  assert.deepEqual(persisted.pairedUsers, []);
});

test("auth: wrong code increments failure and enforces cooldown", async () => {
  const configPath = await createTempConfig();

  await withArgvConfig(configPath, async () => {
    await loadConfig();
    __resetAuthStateForTests();

    const code = refreshPairCode();
    let lastResult = await tryPair(7, wrongCodeFor(code));
    assert.equal(lastResult.ok, false);
    assert.equal(lastResult.reason, "invalid");
    assert.equal(lastResult.remainingAttempts, 4);

    for (let i = 0; i < 4; i++) {
      lastResult = await tryPair(7, wrongCodeFor(code));
    }

    assert.equal(lastResult.ok, false);
    assert.equal(lastResult.reason, "cooldown");
    assert.ok(lastResult.retryAfterMs > 0);
  });
});
