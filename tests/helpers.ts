import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";

export interface TestConfigOverrides {
  [key: string]: unknown;
}

export async function createTempConfig(overrides: TestConfigOverrides = {}): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cligram-test-"));
  const configPath = path.join(dir, "config.json");
  const base = {
    botToken: "test-token",
    pairedUsers: [],
    outputMode: "text",
    outputModeByChat: {},
    commandSafetyMode: "off",
    commandAllowlist: [],
    commandBlocklist: [],
    outputDelayMs: 500,
    pollIntervalMs: 5000,
    idleTimeoutMs: 30000,
    screenLines: 50,
    customCommands: {},
    tmuxSocket: "",
    terminal: "",
    font: {
      family: "monospace",
      size: 14,
      lineHeight: 18,
      charWidth: 8.4,
    },
  };
  const config = { ...base, ...overrides };
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return configPath;
}

export async function withArgvConfig<T>(configPath: string, fn: () => Promise<T>): Promise<T> {
  const originalArgv = process.argv.slice();
  process.argv = [originalArgv[0], originalArgv[1], "--config", configPath];
  try {
    return await fn();
  } finally {
    process.argv = originalArgv;
  }
}
