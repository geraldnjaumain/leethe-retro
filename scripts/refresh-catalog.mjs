import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { catalogShardAppUrls, groupRecordsByCatalogShard } from "./lib/catalog-shards.mjs";

const databaseUrl = process.env.DATABASE_URL;
const tmdbToken = process.env.TMDB_READ_ACCESS_TOKEN;
if (!databaseUrl) throw new Error("Set the least-privileged DATABASE_URL before refreshing.");
if (!tmdbToken) throw new Error("Set TMDB_READ_ACCESS_TOKEN before refreshing.");

const controlSql = neon(databaseUrl);
const shardUrls = catalogShardAppUrls();
const shardSqls = shardUrls.map((url) => neon(url));
const pageCount = Math.min(20, Math.max(1, Number(process.env.CATALOG_REFRESH_PAGES) || 5));
const leaseOwner = randomUUID();
const leaseName = "catalog-refresh";
const leaseSeconds = 30 * 60;
const maxAttempts = 5;
const maxConsecutiveFailures = 3;
const mediaTypes = ["movie", "tv"];
const sorts = {
  popular: "popularity.desc",
  new: { movie: "primary_release_date.desc", tv: "first_air_date.desc" },
  rated: "vote_average.desc",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function tmdbError(message, fatal = false) {
  const error = new Error(message);
  error.fatal = fatal;
  return error;
}

async function tmdb(path, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${tmdbToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return response.json();

      const detail = (await response.text()).slice(0, 200);
      if (response.status !== 429 && response.status < 500) {
        throw tmdbError(`TMDB ${response.status}: ${detail}`, true);
      }

      lastError = tmdbError(`TMDB ${response.status}: ${detail}`);
      const retryAfter = Number(response.headers.get("retry-after"));
      if (attempt < maxAttempts) {
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 60_000)
            : Math.min(1000 * 2 ** (attempt - 1), 15_000),
        );
      }
    } catch (error) {
      if (error?.fatal) throw error;
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 15_000));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("TMDB request failed.");
}

async function acquireLease() {
  const rows = await controlSql.query(
    `INSERT INTO job_leases (name, lease_owner, expires_at, updated_at)
     VALUES ($1, $2, now() + make_interval(secs => $3), now())
     ON CONFLICT (name) DO UPDATE
       SET lease_owner = EXCLUDED.lease_owner,
           expires_at = EXCLUDED.expires_at,
           updated_at = now()
       WHERE job_leases.expires_at < now()
     RETURNING lease_owner`,
    [leaseName, leaseOwner, leaseSeconds],
  );
  return rows[0]?.lease_owner === leaseOwner;
}

async function renewLease() {
  const rows = await controlSql.query(
    `UPDATE job_leases
     SET expires_at = now() + make_interval(secs => $3),
         updated_at = now()
     WHERE name = $1 AND lease_owner = $2
     RETURNING lease_owner`,
    [leaseName, leaseOwner, leaseSeconds],
  );
  if (!rows.length) throw new Error("Catalog refresh lease was lost.");
}

async function releaseLease() {
  await controlSql.query("DELETE FROM job_leases WHERE name = $1 AND lease_owner = $2", [
    leaseName,
    leaseOwner,
  ]);
}

async function recordFailure(type, source, page, error) {
  try {
    await controlSql.query(
      `INSERT INTO catalog_sync_events (media_type, source, query, page, item_count)
       VALUES ($1, $2, $3, $4, 0)`,
      [type, `failed:${source}`, errorMessage(error).slice(0, 500), page ?? null],
    );
  } catch (recordError) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "catalog_refresh_failure_record_failed",
        error: errorMessage(recordError),
      }),
    );
  }
}

function titleRecord(type, item) {
  return {
    tmdb_id: item.id,
    title: item.title || item.name || "Untitled",
    original_title: item.original_title || item.original_name || null,
    overview: item.overview || "",
    poster_path: item.poster_path || null,
    backdrop_path: item.backdrop_path || null,
    release_date: /^\d{4}-\d{2}-\d{2}$/.test(item.release_date || "") ? item.release_date : null,
    first_air_date: /^\d{4}-\d{2}-\d{2}$/.test(item.first_air_date || "")
      ? item.first_air_date
      : null,
    vote_average: Number(item.vote_average || 0),
    vote_count: Number(item.vote_count || 0),
    popularity: Number(item.popularity || 0),
    adult: Boolean(item.adult),
    original_language: item.original_language || null,
    raw: item,
    genre_ids: Array.isArray(item.genre_ids) ? item.genre_ids.filter(Number.isInteger) : [],
    media_type: type,
  };
}

async function upsertGenres(type, genres) {
  await Promise.all(
    shardSqls.map((sql) =>
      sql.query(
        `WITH input AS (
          SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(tmdb_id integer, name text)
        )
        INSERT INTO genres (media_type, tmdb_id, name, synced_at)
        SELECT $1, tmdb_id, name, now() FROM input
        ON CONFLICT (media_type, tmdb_id) DO UPDATE SET name = EXCLUDED.name, synced_at = now()`,
        [type, JSON.stringify(genres.map((genre) => ({ tmdb_id: genre.id, name: genre.name })))],
      ),
    ),
  );
}

async function upsertTitleRecords(sql, type, records) {
  const relations = records.flatMap((item) =>
    item.genre_ids.map((genre) => ({ title_tmdb_id: item.tmdb_id, genre_tmdb_id: genre })),
  );
  const genreIds = [...new Set(relations.map((relation) => relation.genre_tmdb_id))];
  const queries = [
    sql.query(
      `INSERT INTO genres (media_type, tmdb_id, name, synced_at)
       SELECT $1, genre_id, concat('Genre ', genre_id), now()
       FROM unnest($2::integer[]) AS genre_id
       ON CONFLICT (media_type, tmdb_id) DO NOTHING`,
      [type, genreIds],
    ),
    sql.query(
      `WITH input AS (
        SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(
          tmdb_id integer, title text, original_title text, overview text, poster_path text,
          backdrop_path text, release_date text, first_air_date text, vote_average numeric,
          vote_count integer, popularity numeric, adult boolean, original_language text, raw jsonb
        )
      )
      INSERT INTO media_titles (
        media_type, tmdb_id, title, original_title, overview, poster_path, backdrop_path,
        release_date, first_air_date, vote_average, vote_count, popularity, adult,
        original_language, raw, synced_at, updated_at
      )
      SELECT $1, tmdb_id, title, original_title, overview, poster_path, backdrop_path,
        release_date::date, first_air_date::date, vote_average, vote_count, popularity, adult,
        original_language, raw, now(), now()
      FROM input
      ON CONFLICT (media_type, tmdb_id) DO UPDATE SET
        title = EXCLUDED.title, original_title = EXCLUDED.original_title,
        overview = EXCLUDED.overview, poster_path = EXCLUDED.poster_path,
        backdrop_path = EXCLUDED.backdrop_path, release_date = EXCLUDED.release_date,
        first_air_date = EXCLUDED.first_air_date, vote_average = EXCLUDED.vote_average,
        vote_count = EXCLUDED.vote_count, popularity = EXCLUDED.popularity, adult = EXCLUDED.adult,
        original_language = EXCLUDED.original_language, raw = EXCLUDED.raw,
        synced_at = now(), updated_at = now()`,
      [type, JSON.stringify(records)],
    ),
  ];
  if (relations.length) {
    queries.push(
      sql.query(
        `WITH input AS (
          SELECT * FROM jsonb_to_recordset($2::jsonb)
            AS x(title_tmdb_id integer, genre_tmdb_id integer)
        )
        INSERT INTO media_title_genres (media_type, title_tmdb_id, genre_tmdb_id)
        SELECT $1, title_tmdb_id, genre_tmdb_id FROM input
        ON CONFLICT DO NOTHING`,
        [type, JSON.stringify(relations)],
      ),
    );
  }
  await sql.transaction(queries);
}

async function upsertPage(type, sort, page, response) {
  const records = response.results.map((item) => titleRecord(type, item));
  const groups = groupRecordsByCatalogShard(records, shardSqls.length);
  await Promise.all(
    groups.map((recordsForShard, index) =>
      recordsForShard.length
        ? upsertTitleRecords(shardSqls[index], type, recordsForShard)
        : Promise.resolve(),
    ),
  );

  const cacheKey = ["discover", type, sort, "all", "", ""].join(":");
  await controlSql.transaction([
    controlSql.query(
      `INSERT INTO catalog_pages (
        cache_key, page, media_type, mode, sort, total_pages, title_tmdb_ids, synced_at
      ) VALUES ($1, $2, $3, 'discover', $4, $5, $6::integer[], now())
      ON CONFLICT (cache_key, page) DO UPDATE SET
        total_pages = EXCLUDED.total_pages, title_tmdb_ids = EXCLUDED.title_tmdb_ids,
        synced_at = now()`,
      [cacheKey, page, type, sort, response.total_pages, records.map((record) => record.tmdb_id)],
    ),
    controlSql.query(
      `INSERT INTO catalog_sync_events (media_type, source, page, item_count)
       VALUES ($1, $2, $3, $4)`,
      [type, `scheduled:${sort}`, page, records.length],
    ),
  ]);
  return records.length;
}

async function main() {
  if (!(await acquireLease())) {
    console.log(
      JSON.stringify({
        level: "info",
        event: "catalog_refresh_skipped",
        reason: "active_lease",
      }),
    );
    return;
  }

  let refreshed = 0;
  let completedPages = 0;
  let consecutiveFailures = 0;
  const failures = [];

  try {
    for (const type of mediaTypes) {
      try {
        const genreResponse = await tmdb(`/genre/${type}/list`);
        await upsertGenres(type, genreResponse.genres || []);
        await renewLease();
        consecutiveFailures = 0;
      } catch (error) {
        failures.push({ type, source: "genres", error: errorMessage(error) });
        await recordFailure(type, "genres", null, error);
        consecutiveFailures += 1;
        if (error?.fatal || consecutiveFailures >= maxConsecutiveFailures) throw error;
      }

      for (const [sort, sortValue] of Object.entries(sorts)) {
        for (let page = 1; page <= pageCount; page += 1) {
          try {
            const response = await tmdb(`/discover/${type}`, {
              page,
              sort_by: typeof sortValue === "string" ? sortValue : sortValue[type],
              "vote_count.gte": 50,
            });
            refreshed += await upsertPage(type, sort, page, response);
            completedPages += 1;
            consecutiveFailures = 0;
            await renewLease();
          } catch (error) {
            failures.push({ type, source: sort, page, error: errorMessage(error) });
            await recordFailure(type, sort, page, error);
            consecutiveFailures += 1;
            if (error?.fatal || consecutiveFailures >= maxConsecutiveFailures) throw error;
          }
        }
      }
    }

    console.log(
      JSON.stringify({
        level: failures.length ? "warn" : "info",
        event: "catalog_refresh_complete",
        refreshed,
        completedPages,
        expectedPages: pageCount * mediaTypes.length * Object.keys(sorts).length,
        failures,
      }),
    );

    if (failures.length) {
      throw new Error(`Catalog refresh completed with ${failures.length} failed operations.`);
    }
  } finally {
    try {
      await releaseLease();
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "catalog_refresh_lease_release_failed",
          error: errorMessage(error),
        }),
      );
    }
  }
}

await main();
