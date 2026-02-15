import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { loadConfig } from "../src/config.ts";
import {
  __resetAuthStateForTests,
  isPaired,
  loadPairedUsersFromConfig,
  pairUser,
  unpair,
} from "../src/auth.ts";
import { createTempConfig, withArgvConfig } from "./helpers.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("auth: pairUser and unpair persist paired users", async () => {
  const configPath = await createTempConfig();

  await withArgvConfig(configPath, async () => {
    await loadConfig();
    __resetAuthStateForTests();
    loadPairedUsersFromConfig();

    const paired = await pairUser(42);
    assert.equal(paired, "paired");
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

test("auth: isPaired picks up external config changes", async () => {
  const configPath = await createTempConfig();

  await withArgvConfig(configPath, async () => {
    await loadConfig();
    __resetAuthStateForTests();
    loadPairedUsersFromConfig();
    assert.equal(isPaired(99), false);

    const raw = JSON.parse(await readFile(configPath, "utf-8")) as Record<string, unknown>;
    raw.pairedUsers = [99];
    await sleep(10);
    await writeFile(configPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");

    assert.equal(isPaired(99), true);
  });
});
