import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { envFlag, envValue, isProduction } from "./env.server";
import { log, serializeError } from "./logger.server";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let lastCleanup = 0;
let sharedSql: ReturnType<typeof neon> | undefined;

function clientKey(request: Request) {
  if (!envFlag("TRUST_PROXY")) return "origin";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = request.headers.get("cf-connecting-ip") || forwarded || "unknown";
  return createHash("sha256").update(address).digest("hex").slice(0, 24);
}

export function consumeRateLimit(request: Request, scope: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup > windowMs) {
    lastCleanup = now;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  const key = `${scope}:${clientKey(request)}`;
  const current = buckets.get(key);
  const bucket =
    !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  bucket.count += 1;
  buckets.set(key, bucket);
  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

async function consumeSharedRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowMs: number,
) {
  const databaseUrl = envValue("DATABASE_URL");
  if (!isProduction() || !databaseUrl || !envFlag("TRUST_PROXY")) {
    return consumeRateLimit(request, scope, limit, windowMs);
  }

  sharedSql ??= neon(databaseUrl);
  const windowSeconds = Math.max(1, Math.floor(windowMs / 1000));
  const key = `${scope}:${clientKey(request)}`;
  try {
    const [row] = (await sharedSql.query(
      `INSERT INTO rate_limit_buckets (bucket_key, window_start, request_count, expires_at)
       VALUES (
         $1,
         to_timestamp(floor(extract(epoch FROM now()) / $2) * $2),
         1,
         now() + make_interval(secs => $2 * 2)
       )
       ON CONFLICT (bucket_key, window_start) DO UPDATE
         SET request_count = rate_limit_buckets.request_count + 1
       RETURNING request_count, expires_at`,
      [key, windowSeconds],
    )) as Array<{ request_count: number; expires_at: string | Date }>;
    return {
      allowed: Number(row.request_count) <= limit,
      remaining: Math.max(0, limit - Number(row.request_count)),
      resetAt: new Date(row.expires_at).getTime(),
    };
  } catch (error) {
    log("warn", "shared_rate_limit_failed", { error: serializeError(error) });
    return consumeRateLimit(request, scope, limit, windowMs);
  }
}

export async function rateLimitResponse(request: Request, scope: string, limit: number) {
  // Without a trusted proxy there is no reliable client IP. Use a generous global
  // circuit breaker instead of accidentally applying one user's quota to everyone.
  const effectiveLimit = envFlag("TRUST_PROXY") ? limit : limit * 100;
  const result = await consumeSharedRateLimit(request, scope, effectiveLimit, 60_000);
  if (result.allowed) return null;
  return new Response("Too many requests.", {
    status: 429,
    headers: {
      "retry-after": String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))),
      "x-ratelimit-remaining": "0",
    },
  });
}
