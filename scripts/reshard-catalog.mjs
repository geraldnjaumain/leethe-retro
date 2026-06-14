import { neon } from "@neondatabase/serverless";
import { catalogShardAppUrls, groupRecordsByCatalogShard } from "./lib/catalog-shards.mjs";

const sourceUrl = process.env.CATALOG_RESHARD_SOURCE_URL || process.env.DATABASE_URL;
if (!sourceUrl)
  throw new Error("Set CATALOG_RESHARD_SOURCE_URL or DATABASE_URL before resharding.");

const shardUrls = catalogShardAppUrls();
if (shardUrls.length < 2) {
  throw new Error("Configure at least two CATALOG_DATABASE_SHARD_URLS before resharding.");
}

const source = neon(sourceUrl);
const shards = shardUrls.map((url) => neon(url));
const batchSize = Math.min(
  1000,
  Math.max(20, Number(process.env.CATALOG_RESHARD_BATCH_SIZE) || 200),
);

async function replicateGenres() {
  const genres = await source.query(
    `SELECT media_type, tmdb_id, name, synced_at
     FROM genres
     ORDER BY media_type, tmdb_id`,
  );
  await Promise.all(
    shards.map((shard) =>
      shard.query(
        `WITH input AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb)
            AS x(media_type text, tmdb_id integer, name text, synced_at timestamptz)
        )
        INSERT INTO genres (media_type, tmdb_id, name, synced_at)
        SELECT media_type, tmdb_id, name, synced_at FROM input
        ON CONFLICT (media_type, tmdb_id) DO UPDATE
          SET name = EXCLUDED.name,
              synced_at = EXCLUDED.synced_at`,
        [JSON.stringify(genres)],
      ),
    ),
  );
  return genres.length;
}

async function writeBatchToShard(shard, records, relations) {
  const titleQuery = shard.query(
    `WITH input AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        media_type text,
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
        raw jsonb,
        detail_raw jsonb,
        synced_at timestamptz,
        detail_synced_at timestamptz,
        created_at timestamptz,
        updated_at timestamptz
      )
    )
    INSERT INTO media_titles (
      media_type, tmdb_id, title, original_title, overview, poster_path, backdrop_path,
      release_date, first_air_date, vote_average, vote_count, popularity, adult,
      original_language, raw, detail_raw, synced_at, detail_synced_at, created_at, updated_at
    )
    SELECT
      media_type, tmdb_id, title, original_title, overview, poster_path, backdrop_path,
      NULLIF(release_date, '')::date, NULLIF(first_air_date, '')::date, vote_average, vote_count,
      popularity, adult, original_language, raw, detail_raw, synced_at, detail_synced_at,
      created_at, updated_at
    FROM input
    ON CONFLICT (media_type, tmdb_id) DO UPDATE SET
      title = EXCLUDED.title,
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
      detail_raw = EXCLUDED.detail_raw,
      synced_at = EXCLUDED.synced_at,
      detail_synced_at = EXCLUDED.detail_synced_at,
      updated_at = EXCLUDED.updated_at`,
    [JSON.stringify(records)],
  );
  const relationQuery = relations.length
    ? shard.query(
        `WITH input AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb)
            AS x(media_type text, title_tmdb_id integer, genre_tmdb_id integer, created_at timestamptz)
        )
        INSERT INTO media_title_genres (media_type, title_tmdb_id, genre_tmdb_id, created_at)
        SELECT media_type, title_tmdb_id, genre_tmdb_id, created_at FROM input
        ON CONFLICT DO NOTHING`,
        [JSON.stringify(relations)],
      )
    : null;
  await shard.transaction([titleQuery, relationQuery].filter(Boolean));
}

async function main() {
  const genreCount = await replicateGenres();
  let cursorType = "";
  let cursorId = 0;
  let titleCount = 0;
  let relationCount = 0;

  while (true) {
    const records = await source.query(
      `SELECT
        media_type, tmdb_id, title, original_title, overview, poster_path, backdrop_path,
        release_date, first_air_date, vote_average, vote_count, popularity, adult,
        original_language, raw, detail_raw, synced_at, detail_synced_at, created_at, updated_at
      FROM media_titles
      WHERE (media_type, tmdb_id) > ($1::text, $2::integer)
      ORDER BY media_type, tmdb_id
      LIMIT $3`,
      [cursorType, cursorId, batchSize],
    );
    if (!records.length) break;

    const keys = records.map((record) => ({
      media_type: record.media_type,
      tmdb_id: record.tmdb_id,
    }));
    const relations = await source.query(
      `WITH input AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(media_type text, tmdb_id integer)
      )
      SELECT mtg.media_type, mtg.title_tmdb_id, mtg.genre_tmdb_id, mtg.created_at
      FROM input
      JOIN media_title_genres mtg
        ON mtg.media_type = input.media_type AND mtg.title_tmdb_id = input.tmdb_id`,
      [JSON.stringify(keys)],
    );
    const recordGroups = groupRecordsByCatalogShard(records, shards.length);
    const relationGroups = groupRecordsByCatalogShard(
      relations.map((relation) => ({ ...relation, tmdb_id: relation.title_tmdb_id })),
      shards.length,
    );
    await Promise.all(
      shards.map((shard, index) =>
        writeBatchToShard(shard, recordGroups[index], relationGroups[index]),
      ),
    );

    titleCount += records.length;
    relationCount += relations.length;
    const last = records.at(-1);
    cursorType = last.media_type;
    cursorId = last.tmdb_id;
  }

  console.log(
    JSON.stringify({
      level: "info",
      event: "catalog_reshard_complete",
      shards: shards.length,
      genres: genreCount,
      titles: titleCount,
      relations: relationCount,
    }),
  );
}

await main();
