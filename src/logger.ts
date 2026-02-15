type LogLevel = "INFO" | "WARN" | "ERROR";

type LogMeta = Record<string, unknown>;

function normalizeError(err: unknown): Record<string, unknown> | undefined {
  if (!err) {
    return undefined;
  }
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return { value: String(err) };
}

function emit(level: LogLevel, scope: string, message: string, meta?: LogMeta, err?: unknown): void {
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
  };
  if (meta && Object.keys(meta).length > 0) {
    payload.meta = meta;
  }
  const normalizedErr = normalizeError(err);
  if (normalizedErr) {
    payload.error = normalizedErr;
  }
  const line = JSON.stringify(payload);
  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function logInfo(scope: string, message: string, meta?: LogMeta): void {
  emit("INFO", scope, message, meta);
}

export function logWarn(scope: string, message: string, meta?: LogMeta, err?: unknown): void {
  emit("WARN", scope, message, meta, err);
}

export function logError(scope: string, message: string, err?: unknown, meta?: LogMeta): void {
  emit("ERROR", scope, message, meta, err);
}
