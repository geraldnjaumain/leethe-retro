import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { envValue } from "./env.server";

export type CatalogSqlClient = NeonQueryFunction<false, false>;
export type CatalogShard = {
  index: number;
  url: string;
  db: CatalogSqlClient;
};

const clients = new Map<string, CatalogSqlClient>();

function client(url: string) {
  const cached = clients.get(url);
  if (cached) return cached;
  const next = neon(url);
  clients.set(url, next);
  return next;
}

function uniqueUrls(value: string | undefined) {
  return [
    ...new Set(
      (value ?? "")
        .split(/[\n,]+/)
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  ];
}

export function catalogControlDatabaseUrl() {
  return envValue("DATABASE_URL") || envValue("NEON_DATABASE_URL") || envValue("POSTGRES_URL");
}

export function catalogControlSql() {
  const url = catalogControlDatabaseUrl();
  return url ? client(url) : null;
}

export function catalogShards() {
  const controlUrl = catalogControlDatabaseUrl();
  const configured = uniqueUrls(envValue("CATALOG_DATABASE_SHARD_URLS"));
  const urls = configured.length ? configured : controlUrl ? [controlUrl] : [];
  return urls.map((url, index) => ({ index, url, db: client(url) })) satisfies CatalogShard[];
}

export function catalogShardForId(id: string | number) {
  const shards = catalogShards();
  if (!shards.length) return null;
  const numericId = String(id).match(/^\d+$/) ? BigInt(String(id)) : 0n;
  return shards[Number(numericId % BigInt(shards.length))];
}

export function catalogDatabaseClients() {
  const control = catalogControlSql();
  const shardClients = catalogShards().map((shard) => shard.db);
  return [
    ...new Set([control, ...shardClients].filter((db): db is CatalogSqlClient => Boolean(db))),
  ];
}

export function isCatalogSharded() {
  return catalogShards().length > 1;
}

export function clearCatalogShardClientsForTests() {
  clients.clear();
}
