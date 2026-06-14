import {
  catalogControlDatabaseUrl,
  catalogControlSql,
  catalogDatabaseClients,
  catalogShardForId,
  catalogShards,
  clearCatalogShardClientsForTests,
  isCatalogSharded,
  type CatalogSqlClient,
} from "./catalog-shards.server";
import { log, serializeError } from "./logger.server";
import { tmdbCachedRequest } from "./tmdb-cache.server";
import type { DiscoverSort, MediaType, TmdbDetail, TmdbGenre, TmdbItem, TmdbPage } from "./tmdb";

type CacheMode = "discover" | "search" | "similar";
type CacheParams = {
  genre?: number;
  id?: string | number;
  query?: string;
  sort?: DiscoverSort;
};
type TitleRow = {
  media_type: MediaType;
  tmdb_id: number;
  title: string;
  original_title: string | null;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | Date | null;
  first_air_date: string | Date | null;
  vote_average: number | string | null;
  vote_count: number | null;
  popularity: number | string | null;
  adult: boolean | null;
  original_language: string | null;
  raw: Record<string, unknown> | null;
  detail_raw?: TmdbDetail | null;
  detail_synced_at?: string | Date | null;
  genre_ids?: number[] | null;
};

const PAGE_SIZE = 20;
const TITLE_CARD_COLUMNS = `
  mt.media_type,
  mt.tmdb_id,
  mt.title,
  mt.overview,
  mt.poster_path,
  mt.backdrop_path,
  mt.release_date,
  mt.first_air_date,
  mt.vote_average,
  mt.vote_count,
  mt.popularity`;
const DETAIL_TTL_SECONDS = 60 * 60 * 24 * 7;
const DETAIL_MEMORY_TTL_MS = 1000 * 60 * 10;
const MAX_DETAIL_MEMORY_ENTRIES = 200;
const PAGE_MEMORY_TTL_MS = 1000 * 60 * 5;
const MAX_PAGE_MEMORY_ENTRIES = 300;
const GENRE_MEMORY_TTL_MS = 1000 * 60 * 60;
const BACKGROUND_REFRESH_FAILURE_COOLDOWN_MS = 1000 * 60 * 5;
const MAX_BACKGROUND_REFRESH_COOLDOWNS = 300;
const REQUIRED_MIGRATIONS = [
  "001_initial.sql",
  "002_rate_limit_buckets.sql",
  "003_job_leases.sql",
  "004_tmdb_payload_cache.sql",
  "005_product_operations.sql",
  "006_admin_audit.sql",
];
const backgroundRefreshes = new Set<string>();
const backgroundRefreshRetryAfter = new Map<string, number>();
const detailMemoryCache = new Map<string, { detail: TmdbDetail; expiresAt: number }>();
const pageMemoryCache = new Map<string, { page: TmdbPage<TmdbItem>; expiresAt: number }>();
const genreMemoryCache = new Map<MediaType, { genres: TmdbGenre[]; expiresAt: number }>();
const schemaReady = new Map<CatalogSqlClient, Promise<void>>();

export function isCatalogDatabaseConfigured() {
  return Boolean(catalogControlDatabaseUrl());
}

async function ensureCatalogSchema(db: CatalogSqlClient) {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = db
      .query(
        `SELECT count(*)::integer AS count
         FROM schema_migrations
         WHERE name = ANY($1::text[])`,
        [REQUIRED_MIGRATIONS],
      )
      .then((rows) => {
        if (Number(rows[0]?.count) !== REQUIRED_MIGRATIONS.length) {
          throw new Error(
            "Required database migrations are missing. Run `npm run db:migrate` before startup.",
          );
        }
      })
      .catch((error) => {
        schemaReady.delete(db);
        throw error;
      });
    schemaReady.set(db, ready);
  }

  return ready;
}

export async function checkCatalogDatabaseReadiness() {
  const databases = catalogDatabaseClients();
  if (!databases.length) throw new Error("DATABASE_URL is not configured.");
  await Promise.all(databases.flatMap((db) => [ensureCatalogSchema(db), db.query("SELECT 1")]));
}

function cacheKey(mode: CacheMode, type: MediaType, params: CacheParams = {}) {
  const query = params.query?.trim().toLocaleLowerCase() || "";
  return [mode, type, params.sort ?? "popular", params.genre ?? "all", params.id ?? "", query].join(
    ":",
  );
}

function cacheTtlSeconds(mode: CacheMode) {
  if (mode === "discover") return 60 * 60 * 8;
  if (mode === "search") return 60 * 60 * 12;
  return 60 * 60 * 24 * 3;
}

function detailCacheKey(type: MediaType, id: string | number) {
  return `${type}:${id}`;
}

function readMemoryDetail(type: MediaType, id: string | number) {
  const key = detailCacheKey(type, id);
  const cached = detailMemoryCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    detailMemoryCache.delete(key);
    return null;
  }
  detailMemoryCache.delete(key);
  detailMemoryCache.set(key, cached);
  return cached.detail;
}

function rememberDetail(type: MediaType, detail: TmdbDetail) {
  const key = detailCacheKey(type, detail.id);
  detailMemoryCache.delete(key);
  detailMemoryCache.set(key, {
    detail,
    expiresAt: Date.now() + DETAIL_MEMORY_TTL_MS,
  });
  while (detailMemoryCache.size > MAX_DETAIL_MEMORY_ENTRIES) {
    const oldest = detailMemoryCache.keys().next().value;
    if (!oldest) break;
    detailMemoryCache.delete(oldest);
  }
}

function pageMemoryKey(mode: CacheMode, type: MediaType, params: CacheParams, page: number) {
  return `${cacheKey(mode, type, params)}:${page}`;
}

function readMemoryPage(mode: CacheMode, type: MediaType, params: CacheParams, page: number) {
  const key = pageMemoryKey(mode, type, params, page);
  const cached = pageMemoryCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    pageMemoryCache.delete(key);
    return null;
  }
  pageMemoryCache.delete(key);
  pageMemoryCache.set(key, cached);
  return cached.page;
}

function rememberPage(
  mode: CacheMode,
  type: MediaType,
  params: CacheParams,
  page: number,
  value: TmdbPage<TmdbItem>,
) {
  const key = pageMemoryKey(mode, type, params, page);
  pageMemoryCache.delete(key);
  pageMemoryCache.set(key, { page: value, expiresAt: Date.now() + PAGE_MEMORY_TTL_MS });
  while (pageMemoryCache.size > MAX_PAGE_MEMORY_ENTRIES) {
    const oldest = pageMemoryCache.keys().next().value;
    if (!oldest) break;
    pageMemoryCache.delete(oldest);
  }
}

function readMemoryGenres(type: MediaType) {
  const cached = genreMemoryCache.get(type);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    genreMemoryCache.delete(type);
    return null;
  }
  return cached.genres;
}

function rememberGenres(type: MediaType, genres: TmdbGenre[]) {
  genreMemoryCache.set(type, { genres, expiresAt: Date.now() + GENRE_MEMORY_TTL_MS });
}

export function clearCatalogMemoryCachesForTests() {
  detailMemoryCache.clear();
  pageMemoryCache.clear();
  genreMemoryCache.clear();
  backgroundRefreshRetryAfter.clear();
  schemaReady.clear();
  clearCatalogShardClientsForTests();
}

function discoverSortValue(type: MediaType, sort: DiscoverSort) {
  if (sort === "new") return type === "movie" ? "primary_release_date.desc" : "first_air_date.desc";
  if (sort === "rated") return "vote_average.desc";
  return "popularity.desc";
}

function cleanDate(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function dateString(value: unknown) {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return text ? text.slice(0, 10) : undefined;
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toTitleRecord(type: MediaType, item: TmdbItem | TmdbDetail) {
  const detailGenres = "genres" in item && Array.isArray(item.genres) ? item.genres : [];
  const genreIds =
    item.genre_ids ??
    detailGenres.map((genre) => genre.id).filter((id): id is number => Number.isInteger(id));

  return {
    tmdb_id: item.id,
    title: item.title ?? item.name ?? "Untitled",
    original_title:
      "original_title" in item && typeof item.original_title === "string"
        ? item.original_title
        : "original_name" in item && typeof item.original_name === "string"
          ? item.original_name
          : null,
    overview: item.overview ?? "",
    poster_path: item.poster_path ?? null,
    backdrop_path: item.backdrop_path ?? null,
    release_date: cleanDate(item.release_date),
    first_air_date: cleanDate(item.first_air_date),
    vote_average: numberValue(item.vote_average),
    vote_count: numberValue("vote_count" in item ? item.vote_count : 0),
    popularity: numberValue("popularity" in item ? item.popularity : 0),
    adult: Boolean("adult" in item ? item.adult : false),
    original_language:
      "original_language" in item && typeof item.original_language === "string"
        ? item.original_language
        : null,
    raw: item,
    genre_ids: genreIds,
    detail_genres: detailGenres,
  };
}

function toTmdbItem(row: TitleRow): TmdbItem {
  const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
  const base = {
    ...raw,
    id: row.tmdb_id,
    poster_path: row.poster_path,
    backdrop_path: row.backdrop_path,
    overview: row.overview ?? "",
    vote_average: numberValue(row.vote_average),
    genre_ids: row.genre_ids ?? [],
  } as TmdbItem;

  if (row.media_type === "movie") {
    base.title = row.title;
    base.release_date = dateString(row.release_date);
  } else {
    base.name = row.title;
    base.first_air_date = dateString(row.first_air_date);
  }

  return base;
}

function toTmdbDetail(row: TitleRow): TmdbDetail | null {
  if (!row.detail_raw) return null;
  return {
    ...row.detail_raw,
    id: row.tmdb_id,
    poster_path: row.poster_path,
    backdrop_path: row.backdrop_path,
    overview: row.overview ?? row.detail_raw.overview ?? "",
    vote_average: numberValue(row.vote_average),
  };
}

function upsertGenres(db: CatalogSqlClient, type: MediaType, genres: TmdbGenre[]) {
  if (!genres.length) return null;
  return db.query(
    `WITH input AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(tmdb_id integer, name text)
    )
    INSERT INTO genres (media_type, tmdb_id, name, synced_at)
    SELECT $1, tmdb_id, name, now()
    FROM input
    ON CONFLICT (media_type, tmdb_id) DO UPDATE
      SET name = EXCLUDED.name,
          synced_at = now()`,
    [type, JSON.stringify(genres.map((genre) => ({ tmdb_id: genre.id, name: genre.name })))],
  );
}

function ensureGenrePlaceholders(db: CatalogSqlClient, type: MediaType, genreIds: number[]) {
  const uniqueIds = [...new Set(genreIds)].filter((id) => Number.isInteger(id));
  if (!uniqueIds.length) return null;

  return db.query(
    `INSERT INTO genres (media_type, tmdb_id, name, synced_at)
    SELECT $1, genre_id, concat('Genre ', genre_id), now()
    FROM unnest($2::integer[]) AS genre_id
    ON CONFLICT (media_type, tmdb_id) DO NOTHING`,
    [type, uniqueIds],
  );
}

async function upsertTitlesOnShard(
  db: CatalogSqlClient,
  type: MediaType,
  items: Array<TmdbItem | TmdbDetail>,
) {
  if (!items.length) return;
  const records = items.map((item) => toTitleRecord(type, item));
  const genres = records.flatMap((record) => record.detail_genres);
  const relationRecords = records.flatMap((record) =>
    record.genre_ids.map((genreId) => ({
      title_tmdb_id: record.tmdb_id,
      genre_tmdb_id: genreId,
    })),
  );

  const genreQuery = upsertGenres(db, type, genres);
  const placeholderQuery = ensureGenrePlaceholders(
    db,
    type,
    relationRecords.map((record) => record.genre_tmdb_id),
  );
  const titleQuery = db.query(
    `WITH input AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(
        tmdb_id integer,
        title text,
        original_title text,
        overview text,
        poster_path text,
        backdrop_path text,
        release_date text,
        first_air_date text,
        vote_average numeric,
        vote_count integer,
        popularity numeric,
        adult boolean,
        original_language text,
        raw jsonb
      )
    )
    INSERT INTO media_titles (
      media_type,
      tmdb_id,
      title,
      original_title,
      overview,
      poster_path,
      backdrop_path,
      release_date,
      first_air_date,
      vote_average,
      vote_count,
      popularity,
      adult,
      original_language,
      raw,
      synced_at,
      updated_at
    )
    SELECT
      $1,
      tmdb_id,
      title,
      original_title,
      overview,
      poster_path,
      backdrop_path,
      NULLIF(release_date, '')::date,
      NULLIF(first_air_date, '')::date,
      vote_average,
      vote_count,
      popularity,
      adult,
      original_language,
      raw,
      now(),
      now()
    FROM input
    ON CONFLICT (media_type, tmdb_id) DO UPDATE
      SET title = EXCLUDED.title,
          original_title = EXCLUDED.original_title,
          overview = EXCLUDED.overview,
          poster_path = EXCLUDED.poster_path,
          backdrop_path = EXCLUDED.backdrop_path,
          release_date = EXCLUDED.release_date,
          first_air_date = EXCLUDED.first_air_date,
          vote_average = EXCLUDED.vote_average,
          vote_count = EXCLUDED.vote_count,
          popularity = EXCLUDED.popularity,
          adult = EXCLUDED.adult,
          original_language = EXCLUDED.original_language,
          raw = EXCLUDED.raw,
          synced_at = now(),
          updated_at = now()`,
    [type, JSON.stringify(records)],
  );

  const relationQuery = relationRecords.length
    ? db.query(
        `WITH input AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(
        title_tmdb_id integer,
        genre_tmdb_id integer
      )
    )
    INSERT INTO media_title_genres (media_type, title_tmdb_id, genre_tmdb_id)
    SELECT $1, title_tmdb_id, genre_tmdb_id
    FROM input
    ON CONFLICT DO NOTHING`,
        [type, JSON.stringify(relationRecords)],
      )
    : null;

  const queries = [genreQuery, placeholderQuery, titleQuery, relationQuery].filter(
    (query): query is NonNullable<typeof query> => Boolean(query),
  );
  await db.transaction(queries);
}

async function upsertGenresOnShards(type: MediaType, genres: TmdbGenre[]) {
  await Promise.all(catalogShards().map(({ db }) => upsertGenres(db, type, genres)));
}

async function upsertTitles(type: MediaType, items: Array<TmdbItem | TmdbDetail>) {
  const groups = new Map<number, { db: CatalogSqlClient; items: Array<TmdbItem | TmdbDetail> }>();
  for (const item of items) {
    const shard = catalogShardForId(item.id);
    if (!shard) continue;
    const group = groups.get(shard.index) ?? { db: shard.db, items: [] };
    group.items.push(item);
    groups.set(shard.index, group);
  }
  await Promise.all(
    [...groups.values()].map((group) => upsertTitlesOnShard(group.db, type, group.items)),
  );
}

async function upsertDetail(type: MediaType, detail: TmdbDetail) {
  const shard = catalogShardForId(detail.id);
  if (!shard) return;
  await upsertTitlesOnShard(shard.db, type, [detail]);
  await shard.db.query(
    `UPDATE media_titles
    SET detail_raw = $3::jsonb,
        detail_synced_at = now(),
        updated_at = now()
    WHERE media_type = $1 AND tmdb_id = $2`,
    [type, detail.id, JSON.stringify(detail)],
  );
}

async function readTitlesFromShard(db: CatalogSqlClient, type: MediaType, ids: number[]) {
  if (!ids.length) return [];
  const rows = (await db.query(
    `SELECT ${TITLE_CARD_COLUMNS},
      COALESCE((
        SELECT array_agg(mtg.genre_tmdb_id ORDER BY mtg.genre_tmdb_id)
        FROM media_title_genres mtg
        WHERE mtg.media_type = mt.media_type AND mtg.title_tmdb_id = mt.tmdb_id
      ), '{}'::integer[]) AS genre_ids
    FROM unnest($2::integer[]) WITH ORDINALITY ids(tmdb_id, ord)
    JOIN media_titles mt ON mt.media_type = $1 AND mt.tmdb_id = ids.tmdb_id
    ORDER BY ids.ord`,
    [type, ids],
  )) as TitleRow[];

  return rows.map(toTmdbItem);
}

async function readTitlesByIds(type: MediaType, ids: number[]) {
  const groups = new Map<number, { db: CatalogSqlClient; ids: number[] }>();
  for (const id of ids) {
    const shard = catalogShardForId(id);
    if (!shard) continue;
    const group = groups.get(shard.index) ?? { db: shard.db, ids: [] };
    group.ids.push(id);
    groups.set(shard.index, group);
  }
  const pages = await Promise.all(
    [...groups.values()].map((group) => readTitlesFromShard(group.db, type, group.ids)),
  );
  const byId = new Map(pages.flat().map((item) => [item.id, item]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

async function readCatalogPageState(
  db: CatalogSqlClient,
  mode: CacheMode,
  type: MediaType,
  params: CacheParams,
  page: number,
) {
  const key = cacheKey(mode, type, params);
  const onlyShard = catalogShards()[0];
  if (!isCatalogSharded() && onlyShard?.db === db) {
    const rows = (await db.query(
      `SELECT ${TITLE_CARD_COLUMNS},
        cp.total_pages,
        cp.synced_at AS page_synced_at,
        COALESCE((
          SELECT array_agg(mtg.genre_tmdb_id ORDER BY mtg.genre_tmdb_id)
          FROM media_title_genres mtg
          WHERE mtg.media_type = mt.media_type AND mtg.title_tmdb_id = mt.tmdb_id
        ), '{}'::integer[]) AS genre_ids
      FROM catalog_pages cp
      CROSS JOIN LATERAL unnest(cp.title_tmdb_ids) WITH ORDINALITY ids(tmdb_id, ord)
      JOIN media_titles mt ON mt.media_type = $3 AND mt.tmdb_id = ids.tmdb_id
      WHERE cp.cache_key = $1
        AND cp.page = $2
      ORDER BY ids.ord`,
      [key, page, type],
    )) as Array<TitleRow & { page_synced_at: string | Date; total_pages: number }>;
    if (!rows.length) return null;
    return {
      value: {
        page,
        total_pages: Math.max(page, rows[0].total_pages || 1),
        results: rows.map(toTmdbItem),
      } satisfies TmdbPage<TmdbItem>,
      fresh: new Date(rows[0].page_synced_at).getTime() > Date.now() - cacheTtlSeconds(mode) * 1000,
    };
  }

  const rows = (await db.query(
    `SELECT title_tmdb_ids, total_pages, synced_at
    FROM catalog_pages
    WHERE cache_key = $1
      AND page = $2`,
    [key, page],
  )) as { synced_at: string | Date; title_tmdb_ids: number[]; total_pages: number }[];
  const cached = rows[0];
  if (!cached) return null;
  const results = await readTitlesByIds(type, cached.title_tmdb_ids);
  return {
    value: {
      page,
      total_pages: Math.max(page, cached.total_pages || 1),
      results,
    } satisfies TmdbPage<TmdbItem>,
    fresh: new Date(cached.synced_at).getTime() > Date.now() - cacheTtlSeconds(mode) * 1000,
  };
}

async function readCatalogPage(
  db: CatalogSqlClient,
  mode: CacheMode,
  type: MediaType,
  params: CacheParams,
  page: number,
  allowStale = false,
) {
  const state = await readCatalogPageState(db, mode, type, params, page);
  return state && (allowStale || state.fresh) ? state.value : null;
}

async function readDetail(db: CatalogSqlClient, type: MediaType, id: string | number) {
  const rows = (await db.query(
    `SELECT
      media_type,
      tmdb_id,
      poster_path,
      backdrop_path,
      overview,
      vote_average,
      detail_raw,
      detail_synced_at
    FROM media_titles
    WHERE media_type = $1
      AND tmdb_id = $2
      AND detail_raw IS NOT NULL
    LIMIT 1`,
    [type, Number(id)],
  )) as TitleRow[];
  const row = rows[0];
  const detail = row ? toTmdbDetail(row) : null;
  const syncedAt = row?.detail_synced_at ? new Date(row.detail_synced_at).getTime() : 0;
  return {
    detail,
    fresh: Boolean(detail && syncedAt > Date.now() - DETAIL_TTL_SECONDS * 1000),
  };
}

function staleFallback<T>(operation: string, value: T, error: unknown) {
  log("warn", "catalog_stale_fallback", {
    operation,
    error: serializeError(error),
  });
  return value;
}

function refreshInBackground(operation: string, task: () => Promise<void>) {
  if (backgroundRefreshes.has(operation)) return;
  const retryAfter = backgroundRefreshRetryAfter.get(operation) ?? 0;
  if (retryAfter > Date.now()) return;
  backgroundRefreshes.add(operation);
  void task()
    .then(() => {
      backgroundRefreshRetryAfter.delete(operation);
    })
    .catch((error) => {
      backgroundRefreshRetryAfter.delete(operation);
      backgroundRefreshRetryAfter.set(
        operation,
        Date.now() + BACKGROUND_REFRESH_FAILURE_COOLDOWN_MS,
      );
      while (backgroundRefreshRetryAfter.size > MAX_BACKGROUND_REFRESH_COOLDOWNS) {
        const oldest = backgroundRefreshRetryAfter.keys().next().value;
        if (!oldest) break;
        backgroundRefreshRetryAfter.delete(oldest);
      }
      log("warn", "catalog_background_refresh_failed", {
        operation,
        error: serializeError(error),
      });
    })
    .finally(() => {
      backgroundRefreshes.delete(operation);
    });
}

async function databaseFallback<T>(operation: string, task: () => Promise<T>) {
  try {
    return await task();
  } catch (error) {
    log("warn", "catalog_database_degraded", {
      operation,
      error: serializeError(error),
    });
    return null;
  }
}

async function writeCatalogPage(
  db: CatalogSqlClient,
  mode: CacheMode,
  type: MediaType,
  params: CacheParams,
  page: number,
  totalPages: number,
  ids: number[],
) {
  const pageQuery = db.query(
    `INSERT INTO catalog_pages (
      cache_key,
      page,
      media_type,
      mode,
      sort,
      genre_tmdb_id,
      query,
      total_pages,
      title_tmdb_ids,
      synced_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::integer[], now())
    ON CONFLICT (cache_key, page) DO UPDATE
      SET total_pages = EXCLUDED.total_pages,
          title_tmdb_ids = EXCLUDED.title_tmdb_ids,
          synced_at = now()`,
    [
      cacheKey(mode, type, params),
      page,
      type,
      mode,
      params.sort ?? null,
      params.genre ?? null,
      params.query ?? null,
      totalPages,
      ids,
    ],
  );
  const eventQuery = db.query(
    `INSERT INTO catalog_sync_events (media_type, source, query, page, item_count)
    VALUES ($1, $2, $3, $4, $5)`,
    [type, mode, params.query ?? null, page, ids.length],
  );
  await db.transaction([pageQuery, eventQuery]);
}

async function dbSearchShard(db: CatalogSqlClient, type: MediaType, query: string, limit: number) {
  const rows = (await db.query(
    `WITH matches AS (
      SELECT ${TITLE_CARD_COLUMNS},
        COALESCE((
          SELECT array_agg(mtg.genre_tmdb_id ORDER BY mtg.genre_tmdb_id)
          FROM media_title_genres mtg
          WHERE mtg.media_type = mt.media_type AND mtg.title_tmdb_id = mt.tmdb_id
        ), '{}'::integer[]) AS genre_ids,
        COUNT(*) OVER() AS total_count,
        CASE
          WHEN lower(mt.title) = lower($2) THEN 0
          WHEN lower(mt.title) LIKE lower($2) || '%' THEN 1
          ELSE 2
        END AS match_rank,
        similarity(mt.title, $2) AS title_similarity
      FROM media_titles mt
      WHERE mt.media_type = $1
        AND (
          mt.title ILIKE '%' || $2 || '%'
          OR mt.title % $2
        )
      ORDER BY
        match_rank,
        title_similarity DESC,
        mt.popularity DESC,
        mt.vote_count DESC
      LIMIT $3
    )
    SELECT * FROM matches`,
    [type, query, limit],
  )) as Array<
    TitleRow & { match_rank: number; title_similarity: number | string; total_count: number }
  >;
  return rows;
}

async function dbSearchPage(type: MediaType, query: string, page: number) {
  const offset = (page - 1) * PAGE_SIZE;
  const shardRows = await Promise.all(
    catalogShards().map(({ db }) => dbSearchShard(db, type, query, page * PAGE_SIZE)),
  );
  const rows = shardRows
    .flat()
    .sort(
      (a, b) =>
        Number(a.match_rank) - Number(b.match_rank) ||
        numberValue(b.title_similarity) - numberValue(a.title_similarity) ||
        numberValue(b.popularity) - numberValue(a.popularity) ||
        numberValue(b.vote_count) - numberValue(a.vote_count),
    );
  if (!rows.length) return null;
  const total = shardRows.reduce(
    (sum, shard) => sum + Number(shard[0]?.total_count ?? shard.length),
    0,
  );
  return {
    page,
    total_pages: Math.max(page, Math.ceil(total / PAGE_SIZE)),
    results: rows.slice(offset, offset + PAGE_SIZE).map(toTmdbItem),
  } satisfies TmdbPage<TmdbItem>;
}

async function dbSimilarTitlesFromShard(
  db: CatalogSqlClient,
  type: MediaType,
  id: string | number,
  genreIds: number[],
) {
  if (!genreIds.length) return [];
  const rows = (await db.query(
    `SELECT ${TITLE_CARD_COLUMNS},
      COALESCE((
        SELECT array_agg(mtg.genre_tmdb_id ORDER BY mtg.genre_tmdb_id)
        FROM media_title_genres mtg
        WHERE mtg.media_type = mt.media_type AND mtg.title_tmdb_id = mt.tmdb_id
      ), '{}'::integer[]) AS genre_ids,
      COUNT(mtg.genre_tmdb_id) AS shared_genres
    FROM media_titles mt
    JOIN media_title_genres mtg
      ON mtg.media_type = mt.media_type AND mtg.title_tmdb_id = mt.tmdb_id
    WHERE mt.media_type = $1
      AND mt.tmdb_id <> $2
      AND mtg.genre_tmdb_id = ANY($3::integer[])
    GROUP BY mt.media_type, mt.tmdb_id
    ORDER BY shared_genres DESC, mt.popularity DESC, mt.vote_count DESC
    LIMIT 20`,
    [type, Number(id), genreIds],
  )) as Array<TitleRow & { shared_genres: number }>;

  return rows;
}

async function dbSimilarTitles(type: MediaType, id: string | number) {
  const sourceShard = catalogShardForId(id);
  if (!sourceShard) return [];
  const genres = (await sourceShard.db.query(
    `SELECT genre_tmdb_id
    FROM media_title_genres
    WHERE media_type = $1 AND title_tmdb_id = $2`,
    [type, Number(id)],
  )) as Array<{ genre_tmdb_id: number }>;
  const genreIds = genres.map((genre) => genre.genre_tmdb_id);
  const rows = (
    await Promise.all(
      catalogShards().map(({ db }) => dbSimilarTitlesFromShard(db, type, id, genreIds)),
    )
  )
    .flat()
    .sort(
      (a, b) =>
        numberValue(b.shared_genres) - numberValue(a.shared_genres) ||
        numberValue(b.popularity) - numberValue(a.popularity) ||
        numberValue(b.vote_count) - numberValue(a.vote_count),
    )
    .slice(0, 20);

  return rows.map(toTmdbItem);
}

async function tmdbPage<T extends TmdbItem>(
  type: MediaType,
  path: string,
  params: Record<string, string | number | undefined>,
) {
  const page = await tmdbCachedRequest<TmdbPage<T>>(path, params);
  const shards = catalogShards();
  if (!shards.length) return page;
  await databaseFallback(`upsert_titles:${type}:${path}`, async () => {
    await Promise.all(shards.map(({ db }) => ensureCatalogSchema(db)));
    await upsertTitles(type, page.results);
  });
  return page;
}

export async function fetchGenresWithDatabase(type: MediaType) {
  const memoryGenres = readMemoryGenres(type);
  if (memoryGenres) return memoryGenres;

  const db = catalogShards()[0]?.db ?? null;
  if (db) {
    const rows = await databaseFallback(`read_genres:${type}`, async () => {
      return (await db.query(
        `SELECT tmdb_id AS id, name
        FROM genres
        WHERE media_type = $1 AND name NOT LIKE 'Genre %'
        ORDER BY name`,
        [type],
      )) as TmdbGenre[];
    });
    if (rows?.length) {
      rememberGenres(type, rows);
      return rows;
    }
  }

  const response = await tmdbCachedRequest<{ genres: TmdbGenre[] }>(`/genre/${type}/list`);
  if (catalogShards().length) {
    await databaseFallback(`write_genres:${type}`, async () => {
      await Promise.all(catalogShards().map(({ db: shardDb }) => ensureCatalogSchema(shardDb)));
      await upsertGenresOnShards(type, response.genres);
    });
  }
  rememberGenres(type, response.genres);
  return response.genres;
}

export async function discoverWithDatabase(
  type: MediaType,
  opts: { genre?: number; sort?: DiscoverSort; page?: number } = {},
) {
  const sort = opts.sort ?? "popular";
  const page = opts.page ?? 1;
  const params = { genre: opts.genre, sort };
  const memoryPage = readMemoryPage("discover", type, params, page);
  if (memoryPage) return memoryPage;

  const db = catalogControlSql();
  let stale: TmdbPage<TmdbItem> | null = null;

  if (db) {
    const stored = await databaseFallback(`read_discover:${type}:${sort}:${page}`, async () => {
      const state = await readCatalogPageState(db, "discover", type, params, page);
      return {
        cached: state?.fresh ? state.value : null,
        stale: state && !state.fresh ? state.value : null,
      };
    });
    if (stored?.cached?.results.length) {
      rememberPage("discover", type, params, page, stored.cached);
      return stored.cached;
    }
    stale = stored?.stale ?? null;
    if (stale?.results.length) {
      rememberPage("discover", type, params, page, stale);
      refreshInBackground(`discover:${type}:${sort}:${page}`, async () => {
        const fresh = await tmdbPage<TmdbItem>(type, `/discover/${type}`, {
          with_genres: opts.genre,
          sort_by: discoverSortValue(type, sort),
          page,
          "vote_count.gte": 50,
        });
        await writeCatalogPage(
          db,
          "discover",
          type,
          params,
          page,
          fresh.total_pages,
          fresh.results.map((item) => item.id),
        );
      });
      return stale;
    }
  }

  let tmdbResult: TmdbPage<TmdbItem>;
  try {
    tmdbResult = await tmdbPage<TmdbItem>(type, `/discover/${type}`, {
      with_genres: opts.genre,
      sort_by: discoverSortValue(type, sort),
      page,
      "vote_count.gte": 50,
    });
  } catch (error) {
    if (stale?.results.length) {
      return staleFallback(`discover:${type}:${sort}:${page}`, stale, error);
    }
    throw error;
  }

  if (!db) {
    rememberPage("discover", type, params, page, tmdbResult);
    return tmdbResult;
  }
  const stored = await databaseFallback(`write_discover:${type}:${sort}:${page}`, async () => {
    await writeCatalogPage(
      db,
      "discover",
      type,
      params,
      page,
      tmdbResult.total_pages,
      tmdbResult.results.map((item) => item.id),
    );
    return readCatalogPage(db, "discover", type, params, page);
  });
  const result = stored ?? tmdbResult;
  rememberPage("discover", type, params, page, result);
  return result;
}

export async function searchTitlesWithDatabase(type: MediaType, query: string, page = 1) {
  const cleanQuery = query.trim();
  if (cleanQuery.length < 2) {
    return { page: 1, total_pages: 1, results: [] };
  }
  const params = { query: cleanQuery };
  const memoryPage = readMemoryPage("search", type, params, page);
  if (memoryPage) return memoryPage;

  const db = catalogControlSql();
  let stale: TmdbPage<TmdbItem> | null = null;
  let local: TmdbPage<TmdbItem> | null = null;

  if (db) {
    const stored = await databaseFallback(`read_search:${type}:${cleanQuery}:${page}`, async () => {
      const state = await readCatalogPageState(db, "search", type, params, page);
      if (state?.fresh) return { cached: state.value, stale: null, local: null };
      if (state) return { cached: null, stale: state.value, local: null };
      const localResult = await dbSearchPage(type, cleanQuery, page);
      return {
        cached: null,
        stale: null,
        local: localResult,
      };
    });
    if (stored?.cached?.results.length) {
      rememberPage("search", type, params, page, stored.cached);
      return stored.cached;
    }
    stale = stored?.stale ?? null;
    local = stored?.local ?? null;
    if (local?.results.length) {
      rememberPage("search", type, params, page, local);
      return local;
    }
    if (stale?.results.length) {
      rememberPage("search", type, params, page, stale);
      refreshInBackground(`search:${type}:${cleanQuery}:${page}`, async () => {
        const fresh = await tmdbPage<TmdbItem>(type, `/search/${type}`, {
          query: cleanQuery,
          page,
        });
        await writeCatalogPage(
          db,
          "search",
          type,
          { query: cleanQuery },
          page,
          fresh.total_pages,
          fresh.results.map((item) => item.id),
        );
      });
      return stale;
    }
  }

  let tmdbResult: TmdbPage<TmdbItem>;
  try {
    tmdbResult = await tmdbPage<TmdbItem>(type, `/search/${type}`, {
      query: cleanQuery,
      page,
    });
  } catch (error) {
    const fallback = stale?.results.length ? stale : local?.results.length ? local : null;
    if (fallback) return staleFallback(`search:${type}:${cleanQuery}:${page}`, fallback, error);
    throw error;
  }

  if (!db) {
    rememberPage("search", type, params, page, tmdbResult);
    return tmdbResult;
  }
  const stored = await databaseFallback(`write_search:${type}:${cleanQuery}:${page}`, async () => {
    await writeCatalogPage(
      db,
      "search",
      type,
      { query: cleanQuery },
      page,
      tmdbResult.total_pages,
      tmdbResult.results.map((item) => item.id),
    );
    return readCatalogPage(db, "search", type, { query: cleanQuery }, page);
  });
  const result = stored ?? tmdbResult;
  rememberPage("search", type, params, page, result);
  return result;
}

export async function fetchDetailWithDatabase(type: MediaType, id: string | number) {
  const memoryDetail = readMemoryDetail(type, id);
  if (memoryDetail) return memoryDetail;

  const db = catalogShardForId(id)?.db ?? null;
  let stale: TmdbDetail | null = null;
  if (db) {
    const stored = await databaseFallback(`read_detail:${type}:${id}`, () =>
      readDetail(db, type, id),
    );
    if (stored?.detail && stored.fresh) {
      rememberDetail(type, stored.detail);
      return stored.detail;
    }
    stale = stored?.detail ?? null;
    if (stale) {
      rememberDetail(type, stale);
      refreshInBackground(`detail:${type}:${id}`, async () => {
        const detail = await tmdbCachedRequest<TmdbDetail>(`/${type}/${id}`, {
          append_to_response: "credits,videos",
        });
        await upsertDetail(type, detail);
        rememberDetail(type, detail);
      });
      return stale;
    }
  }

  let detail: TmdbDetail;
  try {
    detail = await tmdbCachedRequest<TmdbDetail>(`/${type}/${id}`, {
      append_to_response: "credits,videos",
    });
  } catch (error) {
    if (stale) return staleFallback(`detail:${type}:${id}`, stale, error);
    throw error;
  }
  if (db) {
    await databaseFallback(`write_detail:${type}:${id}`, () => upsertDetail(type, detail));
  }
  rememberDetail(type, detail);
  return detail;
}

export async function fetchSimilarWithDatabase(type: MediaType, id: string | number) {
  const params = { id };
  const memoryPage = readMemoryPage("similar", type, params, 1);
  if (memoryPage) return memoryPage.results;

  const db = catalogControlSql();
  let local: TmdbItem[] = [];
  let stale: TmdbPage<TmdbItem> | null = null;
  if (db) {
    const stored = await databaseFallback(`read_similar:${type}:${id}`, async () => {
      const [localResult, staleResult] = await Promise.all([
        dbSimilarTitles(type, id),
        readCatalogPage(db, "similar", type, params, 1, true),
      ]);
      return {
        local: localResult,
        stale: staleResult,
      };
    });
    local = stored?.local ?? [];
    stale = stored?.stale ?? null;
    if (local.length >= 6) {
      rememberPage("similar", type, params, 1, { page: 1, total_pages: 1, results: local });
      return local;
    }
  }

  let page: TmdbPage<TmdbItem>;
  try {
    page = await tmdbPage<TmdbItem>(type, `/${type}/${id}/similar`, {});
  } catch (error) {
    const fallback = stale?.results.length ? stale.results : local;
    if (fallback.length) return staleFallback(`similar:${type}:${id}`, fallback, error);
    throw error;
  }
  if (db) {
    await databaseFallback(`write_similar:${type}:${id}`, () =>
      writeCatalogPage(
        db,
        "similar",
        type,
        { id },
        page.page,
        page.total_pages,
        page.results.map((item) => item.id),
      ),
    );
  }
  rememberPage("similar", type, params, 1, page);
  return page.results;
}
