import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import { loadConfig } from "../src/config.ts";
import {
  __getPairRequestConstantsForTests,
  __setPairRequestPathForTests,
  consumePairRequest,
  createPairRequest,
  listPairRequests,
} from "../src/pair-request.ts";
import { createTempConfig, withArgvConfig } from "./helpers.ts";

test("pair-request: create uses uppercase alpha-numeric code", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cligram-pr-"));
  const requestPath = path.join(tempDir, "pair-requests.json");
  const configPath = await createTempConfig();

  await withArgvConfig(configPath, async () => {
    await loadConfig();
    __setPairRequestPathForTests(requestPath);

    const created = await createPairRequest(1, 1, "tester");
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.match(created.code, /^[A-Z0-9]+$/);
    assert.equal(created.code.length, 8);
  });

  __setPairRequestPathForTests("");
});

test("pair-request: same user is rate-limited within 1 hour", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cligram-pr-"));
  const requestPath = path.join(tempDir, "pair-requests.json");
  const configPath = await createTempConfig();

  await withArgvConfig(configPath, async () => {
    await loadConfig();
    __setPairRequestPathForTests(requestPath);

    const first = await createPairRequest(7, 7);
    assert.equal(first.ok, true);

    const second = await createPairRequest(7, 7);
    assert.equal(second.ok, false);
    if (second.ok) return;
    const { intervalMs } = __getPairRequestConstantsForTests();
    assert.ok(second.retryAfterMs > 0);
    assert.ok(second.retryAfterMs <= intervalMs);
  });

  __setPairRequestPathForTests("");
});

test("pair-request: consume is one-time", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cligram-pr-"));
  const requestPath = path.join(tempDir, "pair-requests.json");
  const configPath = await createTempConfig();

  await withArgvConfig(configPath, async () => {
    await loadConfig();
    __setPairRequestPathForTests(requestPath);

    const created = await createPairRequest(12, 34, "alice");
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const consumed = await consumePairRequest(created.code.toLowerCase());
    assert.equal(consumed.ok, true);
    if (consumed.ok) {
      assert.equal(consumed.request.authId, 12);
      assert.equal(consumed.request.chatId, 34);
      assert.equal(consumed.request.username, "alice");
    }

    const consumedAgain = await consumePairRequest(created.code);
    assert.equal(consumedAgain.ok, false);
    if (!consumedAgain.ok) {
      assert.equal(consumedAgain.reason, "not_found");
    }
  });

  __setPairRequestPathForTests("");
});

test("pair-request: list shows current queue and reflects consume", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cligram-pr-"));
  const requestPath = path.join(tempDir, "pair-requests.json");
  const configPath = await createTempConfig();

  await withArgvConfig(configPath, async () => {
    await loadConfig();
    __setPairRequestPathForTests(requestPath);

    const a = await createPairRequest(21, 21, "u1");
    const b = await createPairRequest(22, 22, "u2");
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (!a.ok || !b.ok) return;

    const listed = await listPairRequests();
    assert.equal(listed.length, 2);

    const consumed = await consumePairRequest(a.code);
    assert.equal(consumed.ok, true);

    const listedAfterConsume = await listPairRequests();
    assert.equal(listedAfterConsume.length, 1);
    assert.equal(listedAfterConsume[0].code, b.code);
  });

  __setPairRequestPathForTests("");
});
