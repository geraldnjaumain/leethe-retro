import { randomUUID } from "node:crypto";
import { envValue } from "./env.server";

type LogLevel = "debug" | "info" | "warn" | "error";
const weights: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
  const configured = (envValue("LOG_LEVEL") as LogLevel | undefined) ?? "info";
  if (weights[level] < (weights[configured] ?? weights.info)) return;
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === "error") console.error(record);
  else if (level === "warn") console.warn(record);
  else console.log(record);
}

export function requestId(request: Request) {
  return request.headers.get("x-request-id")?.slice(0, 100) || randomUUID();
}

export function serializeError(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error) };
  return {
    name: error.name,
    message: error.message,
    stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
  };
}
