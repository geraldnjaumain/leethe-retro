import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { envValue } from "./env.server";
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
type SqlClient = NeonQueryFunction<false, false>;
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
  genre_ids?: number[] | null;
};

const PAGE_SIZE = 20;
const DETAIL_TTL_SECONDS = 60 * 60 * 24 * 7;
const REQUIRED_MIGRATIONS = [
  "001_initial.sql",
  "002_rate_limit_buckets.sql",
  "003_job_leases.sql",
  "004_tmdb_payload_cache.sql",
  "005_product_operations.sql",
];
const sqlCache = new Map<string, SqlClient>();
let schemaReady: Promise<void> | null = null;

function databaseUrl() {
  return envValue("DATABASE_URL") || envValue("NEON_DATABASE_URL") || envValue("POSTGRES_URL");
}

function sql() {
  const url = databaseUrl();
  if (!url) return null;
  const cached = sqlCache.get(url);
  if (cached) return cached;
  const next = neon(url);
  sqlCache.set(url, next);
  return next;
}

export function isCatalogDatabaseConfigured() {
  return Boolean(databaseUrl());
}

async function ensureCatalogSchema(db: SqlClient) {
  if (!schemaReady) {
    schemaReady = db
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
        schemaReady = null;
        throw error;
      });
  }

  return schemaReady;
}

export async function checkCatalogDatabaseReadiness() {
  const db = sql();
  if (!db) throw new Error("DATABASE_URL is not configured.");
  await ensureCatalogSchema(db);
  await db.query("SELECT 1");
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

function upsertGenres(db: SqlClient, type: MediaType, genres: TmdbGenre[]) {
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

function ensureGenrePlaceholders(db: SqlClient, type: MediaType, genreIds: number[]) {
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

async function upsertTitles(db: SqlClient, type: MediaType, items: Array<TmdbItem | TmdbDetail>) {
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

async function upsertDetail(db: SqlClient, type: MediaType, detail: TmdbDetail) {
  await upsertTitles(db, type, [detail]);
  await db.query(
    `UPDATE media_titles
    SET detail_raw = $3::jsonb,
        detail_synced_at = now(),
        updated_at = now()
    WHERE media_type = $1 AND tmdb_id = $2`,
    [type, detail.id, JSON.stringify(detail)],
  );
}

async function readTitlesByIds(db: SqlClient, type: MediaType, ids: number[]) {
  if (!ids.length) return [];
  const rows = (await db.query(
    `SELECT mt.*,
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

async function readCatalogPage(
  db: SqlClient,
  mode: CacheMode,
  type: MediaType,
  params: CacheParams,
  page: number,
  allowStale = false,
) {
  const key = cacheKey(mode, type, params);
  const rows = (await db.query(
    `SELECT title_tmdb_ids, total_pages
    FROM catalog_pages
    WHERE cache_key = $1
      AND page = $2
      AND ($3::boolean OR synced_at > now() - make_interval(secs => $4))`,
    [key, page, allowStale, cacheTtlSeconds(mode)],
  )) as { title_tmdb_ids: number[]; total_pages: number }[];
  const cached = rows[0];
  if (!cached) return null;
  const results = await readTitlesByIds(db, type, cached.title_tmdb_ids);
  return {
    page,
    total_pages: Math.max(page, cached.total_pages || 1),
    results,
  } satisfies TmdbPage<TmdbItem>;
}

async function readDetail(db: SqlClient, type: MediaType, id: string | number, allowStale = false) {
  const rows = (await db.query(
    `SELECT *
    FROM media_titles
    WHERE media_type = $1
      AND tmdb_id = $2
      AND detail_raw IS NOT NULL
      AND ($3::boolean OR detail_synced_at > now() - make_interval(secs => $4))
    LIMIT 1`,
    [type, Number(id), allowStale, DETAIL_TTL_SECONDS],
  )) as TitleRow[];
  return rows[0] ? toTmdbDetail(rows[0]) : null;
}

function staleFallback<T>(operation: string, value: T, error: unknown) {
  log("warn", "catalog_stale_fallback", {
    operation,
    error: serializeError(error),
  });
  return value;
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
  db: SqlClient,
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

async function dbSearchPage(db: SqlClient, type: MediaType, query: string, page: number) {
  const offset = (page - 1) * PAGE_SIZE;
  const rows = (await db.query(
    `WITH matches AS (
      SELECT mt.*,
        COALESCE((
          SELECT array_agg(mtg.genre_tmdb_id ORDER BY mtg.genre_tmdb_id)
          FROM media_title_genres mtg
          WHERE mtg.media_type = mt.media_type AND mtg.title_tmdb_id = mt.tmdb_id
        ), '{}'::integer[]) AS genre_ids,
        COUNT(*) OVER() AS total_count
      FROM media_titles mt
      WHERE mt.media_type = $1
        AND (
          mt.title ILIKE '%' || $2 || '%'
          OR similarity(mt.title, $2) > 0.18
        )
      ORDER BY
        CASE
          WHEN lower(mt.title) = lower($2) THEN 0
          WHEN lower(mt.title) LIKE lower($2) || '%' THEN 1
          ELSE 2
        END,
        similarity(mt.title, $2) DESC,
        mt.popularity DESC,
        mt.vote_count DESC
      LIMIT $3 OFFSET $4
    )
    SELECT * FROM matches`,
    [type, query, PAGE_SIZE, offset],
  )) as Array<TitleRow & { total_count: number }>;

  if (!rows.length) return null;
  const total = Number(rows[0].total_count || rows.length);
  return {
    page,
    total_pages: Math.max(page, Math.ceil(total / PAGE_SIZE)),
    results: rows.map(toTmdbItem),
  } satisfies TmdbPage<TmdbItem>;
}

async function dbSimilarTitles(db: SqlClient, type: MediaType, id: string | number) {
  const rows = (await db.query(
    `WITH source_genres AS (
      SELECT genre_tmdb_id
      FROM media_title_genres
      WHERE media_type = $1 AND title_tmdb_id = $2
    )
    SELECT mt.*,
      COALESCE((
        SELECT array_agg(mtg.genre_tmdb_id ORDER BY mtg.genre_tmdb_id)
        FROM media_title_genres mtg
        WHERE mtg.media_type = mt.media_type AND mtg.title_tmdb_id = mt.tmdb_id
      ), '{}'::integer[]) AS genre_ids,
      COUNT(sg.genre_tmdb_id) AS shared_genres
    FROM media_titles mt
    JOIN media_title_genres mtg
      ON mtg.media_type = mt.media_type AND mtg.title_tmdb_id = mt.tmdb_id
    JOIN source_genres sg ON sg.genre_tmdb_id = mtg.genre_tmdb_id
    WHERE mt.media_type = $1 AND mt.tmdb_id <> $2
    GROUP BY mt.media_type, mt.tmdb_id
    ORDER BY shared_genres DESC, mt.popularity DESC, mt.vote_count DESC
    LIMIT 20`,
    [type, Number(id)],
  )) as TitleRow[];

  return rows.map(toTmdbItem);
}

async function tmdbPage<T extends TmdbItem>(
  type: MediaType,
  path: string,
  params: Record<string, string | number | undefined>,
) {
  const page = await tmdbCachedRequest<TmdbPage<T>>(path, params);
  const db = sql();
  if (!db) return page;
  await databaseFallback(`upsert_titles:${type}:${path}`, async () => {
    await ensureCatalogSchema(db);
    await upsertTitles(db, type, page.results);
  });
  return page;
}

export async function fetchGenresWithDatabase(type: MediaType) {
  const db = sql();
  if (db) {
    const rows = await databaseFallback(`read_genres:${type}`, async () => {
      await ensureCatalogSchema(db);
      return (await db.query(
        `SELECT tmdb_id AS id, name
        FROM genres
        WHERE media_type = $1 AND name NOT LIKE 'Genre %'
        ORDER BY name`,
        [type],
      )) as TmdbGenre[];
    });
    if (rows?.length) return rows;
  }

  const response = await tmdbCachedRequest<{ genres: TmdbGenre[] }>(`/genre/${type}/list`);
  if (db) {
    await databaseFallback(`write_genres:${type}`, async () => {
      await ensureCatalogSchema(db);
      await upsertGenres(db, type, response.genres);
    });
  }
  return response.genres;
}

export async function discoverWithDatabase(
  type: MediaType,
  opts: { genre?: number; sort?: DiscoverSort; page?: number } = {},
) {
  const sort = opts.sort ?? "popular";
  const page = opts.page ?? 1;
  const params = { genre: opts.genre, sort };
  const db = sql();
  let stale: TmdbPage<TmdbItem> | null = null;

  if (db) {
    const stored = await databaseFallback(`read_discover:${type}:${sort}:${page}`, async () => {
      await ensureCatalogSchema(db);
      return {
        cached: await readCatalogPage(db, "discover", type, params, page),
        stale: await readCatalogPage(db, "discover", type, params, page, true),
      };
    });
    if (stored?.cached?.results.length) return stored.cached;
    stale = stored?.stale ?? null;
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

  if (!db) return tmdbResult;
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
  return stored ?? tmdbResult;
}

export async function searchTitlesWithDatabase(type: MediaType, query: string, page = 1) {
  const cleanQuery = query.trim();
  const db = sql();
  let stale: TmdbPage<TmdbItem> | null = null;
  let local: TmdbPage<TmdbItem> | null = null;

  if (db) {
    const stored = await databaseFallback(`read_search:${type}:${cleanQuery}:${page}`, async () => {
      await ensureCatalogSchema(db);
      return {
        cached: await readCatalogPage(db, "search", type, { query: cleanQuery }, page),
        stale: await readCatalogPage(db, "search", type, { query: cleanQuery }, page, true),
        local: await dbSearchPage(db, type, cleanQuery, page),
      };
    });
    if (stored?.cached?.results.length) return stored.cached;
    stale = stored?.stale ?? null;
    local = stored?.local ?? null;
    if (local && (local.results.length >= 5 || page > 1)) return local;
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

  if (!db) return tmdbResult;
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
  return stored ?? tmdbResult;
}

export async function fetchDetailWithDatabase(type: MediaType, id: string | number) {
  const db = sql();
  let stale: TmdbDetail | null = null;
  if (db) {
    const stored = await databaseFallback(`read_detail:${type}:${id}`, async () => {
      await ensureCatalogSchema(db);
      return {
        cached: await readDetail(db, type, id),
        stale: await readDetail(db, type, id, true),
      };
    });
    if (stored?.cached) return stored.cached;
    stale = stored?.stale ?? null;
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
    await databaseFallback(`write_detail:${type}:${id}`, () => upsertDetail(db, type, detail));
  }
  return detail;
}

export async function fetchSimilarWithDatabase(type: MediaType, id: string | number) {
  const db = sql();
  let local: TmdbItem[] = [];
  let stale: TmdbPage<TmdbItem> | null = null;
  if (db) {
    const stored = await databaseFallback(`read_similar:${type}:${id}`, async () => {
      await ensureCatalogSchema(db);
      return {
        local: await dbSimilarTitles(db, type, id),
        stale: await readCatalogPage(db, "similar", type, { id }, 1, true),
      };
    });
    local = stored?.local ?? [];
    stale = stored?.stale ?? null;
    if (local.length >= 6) return local;
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
  return page.results;
}
