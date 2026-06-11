import test from "node:test";
import assert from "node:assert/strict";
import { formatBotError } from "../src/bot-errors.js";

test("bot errors: formats Error messages for Telegram replies", () => {
  assert.equal(
    formatBotError(new Error("当前默认终端不是 tmux，旧命令暂不支持 cmux target。")),
    "终端操作失败: 当前默认终端不是 tmux，旧命令暂不支持 cmux target。",
  );
});

test("bot errors: formats non-Error values with String", () => {
  assert.equal(formatBotError("plain failure"), "终端操作失败: plain failure");
});
