import test from "node:test";
import assert from "node:assert/strict";
import { parseModifierKey } from "../src/commands.ts";

test("commands: parseModifierKey supports common styles", () => {
  assert.equal(parseModifierKey("/ctrl + c", "ctrl"), "c");
  assert.equal(parseModifierKey("/CTRL+c", "ctrl"), "c");
  assert.equal(parseModifierKey("/alt x", "alt"), "x");
  assert.equal(parseModifierKey("/cmd    +   K", "cmd"), "k");
});

test("commands: parseModifierKey returns null for invalid input", () => {
  assert.equal(parseModifierKey("/ctrl", "ctrl"), null);
  assert.equal(parseModifierKey("ctrl + c", "ctrl"), null);
  assert.equal(parseModifierKey("/shift", "shift"), null);
});
