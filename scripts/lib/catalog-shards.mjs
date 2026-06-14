function uniqueUrls(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/[\n,]+/)
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  ];
}

export function catalogShardAppUrls(env = process.env) {
  const configured = uniqueUrls(env.CATALOG_DATABASE_SHARD_URLS);
  return configured.length ? configured : uniqueUrls(env.DATABASE_URL);
}

export function catalogShardAdminUrls(env = process.env) {
  const configured = uniqueUrls(env.CATALOG_DATABASE_SHARD_ADMIN_URLS);
  if (configured.length) return configured;
  if (env.CATALOG_DATABASE_SHARD_URLS) {
    throw new Error(
      "Set CATALOG_DATABASE_SHARD_ADMIN_URLS before migrating configured catalog shards.",
    );
  }
  return uniqueUrls(env.DATABASE_ADMIN_URL || env.DATABASE_URL);
}

export function catalogShardIndex(id, count) {
  if (!Number.isInteger(count) || count < 1)
    throw new Error("Catalog shard count must be positive.");
  const text = String(id);
  const numericId = /^\d+$/.test(text) ? BigInt(text) : 0n;
  return Number(numericId % BigInt(count));
}

export function groupRecordsByCatalogShard(records, shardCount) {
  const groups = Array.from({ length: shardCount }, () => []);
  for (const record of records) {
    groups[catalogShardIndex(record.tmdb_id ?? record.id, shardCount)].push(record);
  }
  return groups;
}
