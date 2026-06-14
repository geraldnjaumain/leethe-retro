import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const truthy = new Set(["1", "true", "yes", "on"]);
const localValues = new Map<string, string>();
let localLoaded = false;

function loadLocalEnv() {
  if (localLoaded || process.env.NODE_ENV === "production") return;
  localLoaded = true;
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([^#][^=]*)=(.*)$/);
    if (!match) continue;
    localValues.set(match[1].trim(), match[2].trim().replace(/^['"]|['"]$/g, ""));
  }
}

export function envValue(key: string) {
  loadLocalEnv();
  return process.env[key] || localValues.get(key);
}

export function envFlag(key: string, fallback = false) {
  const value = envValue(key);
  return value ? truthy.has(value.toLowerCase()) : fallback;
}

export function isProduction() {
  return process.env.NODE_ENV === "production" || import.meta.env.MODE === "production";
}

const productionSchema = z.object({
  DATABASE_URL: z.string().url(),
  TMDB_READ_ACCESS_TOKEN: z.string().min(20),
  SITE_URL: z.string().url(),
  LEGAL_CONTACT_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(16).max(256).optional(),
});

export function validateProductionEnv() {
  if (!isProduction()) return;
  productionSchema.parse({
    DATABASE_URL: envValue("DATABASE_URL"),
    TMDB_READ_ACCESS_TOKEN: envValue("TMDB_READ_ACCESS_TOKEN"),
    SITE_URL: envValue("SITE_URL"),
    LEGAL_CONTACT_EMAIL: envValue("LEGAL_CONTACT_EMAIL"),
    ADMIN_PASSWORD: envValue("ADMIN_PASSWORD") || undefined,
  });

  if (envFlag("ENABLE_EXTERNAL_STREAM_RESOLVER") && !envFlag("STREAMING_RIGHTS_CONFIRMED")) {
    throw new Error(
      "ENABLE_EXTERNAL_STREAM_RESOLVER requires STREAMING_RIGHTS_CONFIRMED=true in production.",
    );
  }
}

export function localCacheDirectory() {
  const configured = envValue("LOCAL_CACHE_DIR")?.trim();
  if (configured) return configured;
  return isProduction() ? undefined : join(process.cwd(), ".leethe-db");
}
