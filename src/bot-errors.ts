export function formatBotError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `终端操作失败: ${message}`;
}
