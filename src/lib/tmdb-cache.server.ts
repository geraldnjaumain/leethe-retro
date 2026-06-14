import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { brotliCompress, brotliDecompress, constants as zlibConstants } from "node:zlib";
import { promisify } from "node:util";
import { neon } from "@neondatabase/serverless";
import { envValue, localCacheDirectory } from "./env.server";
import { log, serializeError } from "./logger.server";
import { readBoundedBytes, readBoundedText } from "./upstream-response.server";

const compress = promisify(brotliCompress);
const decompress = promisify(brotliDecompress);

const DEFAULT_TMDB_BASE = "https://api.themoviedb.org/3";
const DEFAULT_TMDB_IMG_BASE = "https://image.tmdb.org/t/p";
const CACHE_VERSION = 1;
const MAX_JSON_BYTES = 8_000_000;
const MAX_IMAGE_BYTES = 14_000_000;
const MAX_MEMORY_ENTRIES = 300;
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [0, 200, 600];
const localCacheRoot = localCacheDirectory();
const cacheRoot = localCacheRoot ? join(localCacheRoot, "tmdb-v1") : undefined;
const imageCacheRoot = localCacheRoot ? join(localCacheRoot, "tmdb-images-v1") : undefined;
const imageSizes = new Set(["w300", "w342", "w500", "w780", "w1280", "original"]);
const persistentPayloadPaths = [/^\/collection\/\d{1,12}$/, /^\/tv\/\d{1,12}\/season\/\d{1,3}$/];

type CacheParams = Record<string, string | number | undefined>;

type CacheRecord<T> = {
  version: number;
  path: string;
  params: CacheParams;
  storedAt: number;
  expiresAt: number;
  body: T;
};

const memory = new Map<string, CacheRecord<unknown>>();
let payloadSql: ReturnType<typeof neon> | undefined;

function remember<T>(key: string, record: CacheRecord<T>) {
  memory.delete(key);
  memory.set(key, record as CacheRecord<unknown>);
  while (memory.size > MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (!oldest) break;
    memory.delete(oldest);
  }
}

function configuredBaseUrl(key: string, fallback: string) {
  const configured = envValue(key)?.trim();
  if (!configured) return fallback;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.protocol !== "http:") return fallback;
    return configured.replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

async function fetchWithRetry(url: string, init: RequestInit = {}) {
  let lastError: unknown;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status !== 429 && response.status < 500) return response;
      lastError = new Error(`Upstream returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Upstream request failed.");
}

function stableParams(params: CacheParams = {}) {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== "")
      .sort(([a], [b]) => a.localeCompare(b)),
  ) as CacheParams;
}

function cacheTtlMs(path: string) {
  if (path.startsWith("/discover/")) return 1000 * 60 * 60 * 8;
  if (path.startsWith("/search/")) return 1000 * 60 * 60 * 12;
  if (path.includes("/similar")) return 1000 * 60 * 60 * 24 * 3;
  if (path.includes("/season/")) return 1000 * 60 * 60 * 24 * 14;
  if (path.startsWith("/genre/")) return 1000 * 60 * 60 * 24 * 30;
  return 1000 * 60 * 60 * 24 * 7;
}

function cacheKey(path: string, params: CacheParams) {
  return createHash("sha256")
    .update(JSON.stringify({ version: CACHE_VERSION, path, params: stableParams(params) }))
    .digest("hex");
}

function cachePath(key: string) {
  if (!cacheRoot) throw new Error("Filesystem cache is disabled.");
  return join(cacheRoot, key.slice(0, 2), `${key}.json.br`);
}

async function readCached<T>(key: string): Promise<CacheRecord<T> | null> {
  const hit = memory.get(key) as CacheRecord<T> | undefined;
  if (hit) {
    remember(key, hit);
    return hit;
  }
  if (cacheRoot) {
    try {
      const file = await readFile(cachePath(key));
      const raw = await decompress(file);
      const parsed = JSON.parse(raw.toString("utf8")) as CacheRecord<T>;
      if (parsed.version !== CACHE_VERSION) return null;
      remember(key, parsed);
      return parsed;
    } catch {
      // Filesystem cache miss.
    }
  }
  return null;
}

function isPersistentPayloadPath(path: string) {
  return persistentPayloadPaths.some((pattern) => pattern.test(path));
}

function persistentSql() {
  const databaseUrl = envValue("DATABASE_URL");
  if (!databaseUrl) return null;
  payloadSql ??= neon(databaseUrl);
  return payloadSql;
}

async function readPersistent<T>(key: string, path: string): Promise<CacheRecord<T> | null> {
  if (!isPersistentPayloadPath(path)) return null;
  const sql = persistentSql();
  if (!sql) return null;
  try {
    const [row] = (await sql.query(
      `SELECT path, params, body, stored_at, expires_at
       FROM tmdb_payload_cache
       WHERE cache_key = $1`,
      [key],
    )) as Array<{
      path: string;
      params: CacheParams;
      body: T;
      stored_at: string | Date;
      expires_at: string | Date;
    }>;
    if (!row) return null;
    const record = {
      version: CACHE_VERSION,
      path: row.path,
      params: row.params,
      body: row.body,
      storedAt: new Date(row.stored_at).getTime(),
      expiresAt: new Date(row.expires_at).getTime(),
    };
    remember(key, record);
    return record;
  } catch (error) {
    log("warn", "tmdb_payload_cache_read_failed", { error: serializeError(error) });
    return null;
  }
}

async function writePersistent<T>(key: string, record: CacheRecord<T>) {
  if (!isPersistentPayloadPath(record.path)) return;
  const sql = persistentSql();
  if (!sql) return;
  try {
    await sql.query(
      `INSERT INTO tmdb_payload_cache (
        cache_key, path, params, body, stored_at, expires_at, updated_at
      )
      VALUES ($1, $2, $3::jsonb, $4::jsonb, to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0), now())
      ON CONFLICT (cache_key) DO UPDATE
        SET path = EXCLUDED.path,
            params = EXCLUDED.params,
            body = EXCLUDED.body,
            stored_at = EXCLUDED.stored_at,
            expires_at = EXCLUDED.expires_at,
            updated_at = now()`,
      [
        key,
        record.path,
        JSON.stringify(record.params),
        JSON.stringify(record.body),
        record.storedAt,
        record.expiresAt,
      ],
    );
  } catch (error) {
    log("warn", "tmdb_payload_cache_write_failed", { error: serializeError(error) });
  }
}

async function writeFilesystem<T>(key: string, record: CacheRecord<T>) {
  if (!cacheRoot) return;
  try {
    const file = cachePath(key);
    const payload = Buffer.from(JSON.stringify(record), "utf8");
    const compressed = await compress(payload, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
      },
    });
    await mkdir(join(cacheRoot, key.slice(0, 2)), { recursive: true });
    await writeFile(file, compressed);
  } catch (error) {
    log("warn", "tmdb_filesystem_cache_write_failed", { error: serializeError(error) });
  }
}

async function writeCached<T>(key: string, record: CacheRecord<T>) {
  remember(key, record);
  await Promise.all([writeFilesystem(key, record), writePersistent(key, record)]);
}

async function fetchTmdb<T>(path: string, params: CacheParams) {
  const url = new URL(configuredBaseUrl("TMDB_API_BASE_URL", DEFAULT_TMDB_BASE) + path);
  const headers: HeadersInit = {};
  const token = envValue("TMDB_READ_ACCESS_TOKEN")?.trim();
  const apiKey = envValue("TMDB_API_KEY")?.trim();

  if (token) headers.Authorization = `Bearer ${token}`;
  else if (apiKey) url.searchParams.set("api_key", apiKey);
  else throw new Error("Missing TMDB API credentials.");

  for (const [key, value] of Object.entries(stableParams(params))) {
    url.searchParams.set(key, String(value));
  }

  const res = await fetchWithRetry(url.toString(), { headers });
  const text = await readBoundedText(res, MAX_JSON_BYTES);
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text) as T;
}

export async function tmdbCachedRequest<T>(path: string, params: CacheParams = {}) {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid TMDB path.");
  const safeParams = stableParams(params);
  const key = cacheKey(path, safeParams);
  const cached = (await readCached<T>(key)) ?? (await readPersistent<T>(key, path));
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.body;

  try {
    const body = await fetchTmdb<T>(path, safeParams);
    await writeCached(key, {
      version: CACHE_VERSION,
      path,
      params: safeParams,
      storedAt: now,
      expiresAt: now + cacheTtlMs(path),
      body,
    });
    return body;
  } catch (error) {
    if (cached) return cached.body;
    throw error;
  }
}

function imageContentType(path: string, fallback = "image/jpeg") {
  if (/\.webp(?:$|\?)/i.test(path)) return "image/webp";
  if (/\.png(?:$|\?)/i.test(path)) return "image/png";
  if (/\.gif(?:$|\?)/i.test(path)) return "image/gif";
  return fallback;
}

function imageCacheKey(size: string, path: string) {
  return createHash("sha256")
    .update(JSON.stringify({ version: CACHE_VERSION, size, path }))
    .digest("hex");
}

function imageCachePaths(key: string, path: string) {
  if (!imageCacheRoot) throw new Error("Filesystem image cache is disabled.");
  const ext = path.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() || ".img";
  const dir = join(imageCacheRoot, key.slice(0, 2));
  return {
    dir,
    body: join(dir, `${key}${ext}`),
    meta: join(dir, `${key}.json`),
  };
}

function cachedImageResponse(bytes: Buffer, contentType: string) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

export async function serveCachedTmdbImage(request: Request) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/tmdb-img\/([^/]+)\/(.+)$/);
  if (!match) return null;

  const size = match[1];
  const imagePath = `/${match[2]}`;
  if (!imageSizes.has(size) || imagePath.includes("..") || !/\.[a-z0-9]+$/i.test(imagePath)) {
    return new Response("Invalid TMDB image path.", { status: 400 });
  }

  const key = imageCacheKey(size, imagePath);
  const files = imageCacheRoot ? imageCachePaths(key, imagePath) : undefined;
  if (files) {
    try {
      const [bytes, meta] = await Promise.all([
        readFile(files.body),
        readFile(files.meta).then(
          (raw) => JSON.parse(raw.toString("utf8")) as { contentType: string },
        ),
      ]);
      return cachedImageResponse(bytes, meta.contentType || imageContentType(imagePath));
    } catch {
      // Cache miss.
    }
  }

  const imageUrl = `${configuredBaseUrl("TMDB_IMAGE_BASE_URL", DEFAULT_TMDB_IMG_BASE)}/${size}${imagePath}`;
  const response = await fetchWithRetry(imageUrl);
  if (!response.ok) {
    return new Response("TMDB image not found.", { status: response.status });
  }
  const contentType = response.headers.get("content-type") || imageContentType(imagePath);
  const bytes = Buffer.from(await readBoundedBytes(response, MAX_IMAGE_BYTES));

  if (files) {
    try {
      await mkdir(files.dir, { recursive: true });
      await Promise.all([
        writeFile(files.body, bytes),
        writeFile(files.meta, JSON.stringify({ contentType, storedAt: Date.now(), imageUrl })),
      ]);
    } catch (error) {
      log("warn", "tmdb_image_cache_write_failed", { error: serializeError(error) });
    }
  }
  return cachedImageResponse(bytes, contentType);
}
