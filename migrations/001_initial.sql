CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS media_titles (
  media_type text NOT NULL CHECK (media_type IN ('movie', 'tv')),
  tmdb_id integer NOT NULL,
  title text NOT NULL,
  original_title text,
  overview text NOT NULL DEFAULT '',
  poster_path text,
  backdrop_path text,
  release_date date,
  first_air_date date,
  vote_average numeric(4,2) NOT NULL DEFAULT 0,
  vote_count integer NOT NULL DEFAULT 0,
  popularity numeric(12,4) NOT NULL DEFAULT 0,
  adult boolean NOT NULL DEFAULT false,
  original_language text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  detail_raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  detail_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (media_type, tmdb_id)
);

CREATE TABLE IF NOT EXISTS genres (
  media_type text NOT NULL CHECK (media_type IN ('movie', 'tv')),
  tmdb_id integer NOT NULL,
  name text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (media_type, tmdb_id)
);

CREATE TABLE IF NOT EXISTS media_title_genres (
  media_type text NOT NULL CHECK (media_type IN ('movie', 'tv')),
  title_tmdb_id integer NOT NULL,
  genre_tmdb_id integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (media_type, title_tmdb_id, genre_tmdb_id),
  FOREIGN KEY (media_type, title_tmdb_id)
    REFERENCES media_titles (media_type, tmdb_id) ON DELETE CASCADE,
  FOREIGN KEY (media_type, genre_tmdb_id)
    REFERENCES genres (media_type, tmdb_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS catalog_pages (
  cache_key text NOT NULL,
  page integer NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('movie', 'tv')),
  mode text NOT NULL CHECK (mode IN ('discover', 'search', 'similar')),
  sort text,
  genre_tmdb_id integer,
  query text,
  total_pages integer NOT NULL DEFAULT 1,
  title_tmdb_ids integer[] NOT NULL DEFAULT '{}',
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cache_key, page)
);

CREATE TABLE IF NOT EXISTS catalog_sync_events (
  id bigserial PRIMARY KEY,
  media_type text CHECK (media_type IN ('movie', 'tv')),
  source text NOT NULL,
  query text,
  page integer,
  item_count integer NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_titles_title_trgm_idx
  ON media_titles USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS media_titles_type_popularity_idx
  ON media_titles (media_type, popularity DESC, vote_count DESC);
CREATE INDEX IF NOT EXISTS media_titles_type_rating_idx
  ON media_titles (media_type, vote_average DESC, vote_count DESC);
CREATE INDEX IF NOT EXISTS media_titles_type_movie_release_idx
  ON media_titles (media_type, release_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS media_titles_type_tv_air_idx
  ON media_titles (media_type, first_air_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS media_title_genres_genre_idx
  ON media_title_genres (media_type, genre_tmdb_id, title_tmdb_id);
CREATE INDEX IF NOT EXISTS catalog_pages_mode_idx
  ON catalog_pages (media_type, mode, synced_at DESC);
CREATE INDEX IF NOT EXISTS catalog_sync_events_synced_at_idx
  ON catalog_sync_events (synced_at);
