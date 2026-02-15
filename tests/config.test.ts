import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getConfig,
  getOutputMode,
  isCommandAllowed,
  loadConfig,
  setOutputMode,
} from "../src/config.ts";
import { createTempConfig, withArgvConfig } from "./helpers.ts";

test("config: parses custom commands and safety settings", async () => {
  const configPath = await createTempConfig({
    commandSafetyMode: "whitelist",
    commandAllowlist: ["ls", "git", "LS", " "],
    customCommands: {
      "good_cmd": { command: "echo ok", description: "ok" },
      "bad-name": { command: "echo bad", description: "bad" },
      "Start": { command: "echo bad", description: "bad" },
      "start": { command: "echo bad", description: "bad" },
    },
  });

  await withArgvConfig(configPath, async () => {
    await loadConfig();
  });

  const cfg = getConfig();
  assert.equal(cfg.commandSafetyMode, "whitelist");
  assert.deepEqual(cfg.commandAllowlist, ["ls", "git"]);
  assert.deepEqual(Object.keys(cfg.customCommands), ["good_cmd"]);

  assert.equal(isCommandAllowed("ls -al").allowed, true);
  const rejected = isCommandAllowed("pwd");
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.reason, "not_in_allowlist");
});

test("config: chat mode fallback and persistence", async () => {
  const configPath = await createTempConfig({
    outputMode: "text",
    outputModeByChat: { "100": "image" },
  });

  await withArgvConfig(configPath, async () => {
    await loadConfig();
    assert.equal(getOutputMode(100), "image");
    assert.equal(getOutputMode(200), "text");

    await setOutputMode("image", 200);
  });

  const persisted = JSON.parse(await readFile(configPath, "utf-8")) as {
    outputModeByChat: Record<string, string>;
  };
  assert.equal(persisted.outputModeByChat["200"], "image");
});
