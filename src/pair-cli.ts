import { loadConfig } from "./config.js";
import { pairUser } from "./auth.js";
import { consumePairRequest, listPairRequests } from "./pair-request.js";

function usage(): void {
  console.log("用法:");
  console.log("  cligram pair approve <配对码>    批准配对请求");
  console.log("  cligram pair ls          查看当前待审批队列");
}

async function main(): Promise<void> {
  const sub = process.argv[2]?.trim();
  if (!sub) {
    usage();
    process.exit(1);
  }

  await loadConfig();

  if (sub === "ls" || sub === "list") {
    const requests = await listPairRequests();
    if (requests.length === 0) {
      console.log("当前没有待审批配对请求。");
      return;
    }
    console.log("待审批配对请求：");
    for (const req of requests) {
      const requestedAt = new Date(req.requestedAt).toLocaleString("zh-CN", { hour12: false });
      const expiresAt = new Date(req.expiresAt).toLocaleString("zh-CN", { hour12: false });
      const remainingMin = Math.max(0, Math.ceil((req.expiresAt - Date.now()) / 60000));
      const username = req.username ? `@${req.username}` : "-";
      console.log(
        `- code=${req.code} user=${req.authId} chat=${req.chatId} username=${username} requested=${requestedAt} expires=${expiresAt} remaining=${remainingMin}m`,
      );
    }
    return;
  }

  if (sub !== "approve") {
    usage();
    process.exit(1);
  }
  const code = process.argv[3]?.trim() ?? "";
  if (!code) {
    usage();
    process.exit(1);
  }

  const consumed = await consumePairRequest(code);
  if (!consumed.ok) {
    if (consumed.reason === "expired") {
      console.error("配对失败：配对码已过期，请让用户重新发送 /pair 获取新配对码。");
    } else {
      console.error("配对失败：配对码不存在或已被使用。");
    }
    process.exit(1);
  }

  const result = await pairUser(consumed.request.authId);
  if (result === "already_paired") {
    console.log(`用户 ${consumed.request.authId} 已经配对，无需重复操作。`);
    return;
  }

  const username = consumed.request.username ? ` (@${consumed.request.username})` : "";
  console.log(`配对成功：用户 ${consumed.request.authId}${username} 已授权。`);
}

main().catch((err) => {
  console.error("执行失败:", err);
  process.exit(1);
});
