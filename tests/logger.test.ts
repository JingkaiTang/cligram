import test from "node:test";
import assert from "node:assert/strict";
import { __normalizeErrorForTests as normalizeError } from "../src/logger.ts";

test("logger: normalizeError returns undefined for falsy values", () => {
  assert.equal(normalizeError(null), undefined);
  assert.equal(normalizeError(undefined), undefined);
  assert.equal(normalizeError(""), undefined);
  assert.equal(normalizeError(0), undefined);
});

test("logger: normalizeError extracts Error properties", () => {
  const err = new Error("test message");
  const result = normalizeError(err);
  assert.ok(result);
  assert.equal(result.name, "Error");
  assert.equal(result.message, "test message");
  assert.ok(typeof result.stack === "string");
});

test("logger: normalizeError preserves custom Error subclasses", () => {
  class CustomError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "CustomError";
      this.code = code;
    }
  }
  const err = new CustomError("custom msg", "ERR_CUSTOM");
  const result = normalizeError(err);
  assert.ok(result);
  assert.equal(result.name, "CustomError");
  assert.equal(result.message, "custom msg");
});

test("logger: normalizeError converts non-Error to string value", () => {
  assert.deepEqual(normalizeError("string error"), { value: "string error" });
  assert.deepEqual(normalizeError(42), { value: "42" });
  assert.deepEqual(normalizeError(true), { value: "true" });
  assert.deepEqual(normalizeError({ foo: "bar" }), { value: "[object Object]" });
});
