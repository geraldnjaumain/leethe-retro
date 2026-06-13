CREATE TABLE IF NOT EXISTS job_leases (
  name text PRIMARY KEY,
  lease_owner text NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_leases_expires_at_idx
  ON job_leases (expires_at);
