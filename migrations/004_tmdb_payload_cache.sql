CREATE TABLE IF NOT EXISTS tmdb_payload_cache (
  cache_key text PRIMARY KEY,
  path text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  body jsonb NOT NULL,
  stored_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tmdb_payload_cache_expires_at_idx
  ON tmdb_payload_cache (expires_at);
