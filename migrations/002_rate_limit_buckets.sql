CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_expires_at_idx
  ON rate_limit_buckets (expires_at);
