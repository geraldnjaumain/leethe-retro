CREATE TABLE IF NOT EXISTS support_tickets (
  id text PRIMARY KEY,
  category text NOT NULL CHECK (
    category IN ('playback', 'subtitles', 'audio', 'downloads', 'catalog', 'legal', 'other')
  ),
  email text,
  message text NOT NULL,
  path text,
  media_type text CHECK (media_type IN ('movie', 'tv')),
  tmdb_id integer,
  season integer,
  episode integer,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_tickets_status_updated_idx
  ON support_tickets (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS analytics_events (
  id bigserial PRIMARY KEY,
  event_name text NOT NULL CHECK (
    event_name IN ('page_view', 'playback_start', 'playback_error', 'download', 'support_submitted')
  ),
  session_id text,
  path text,
  media_type text CHECK (media_type IN ('movie', 'tv')),
  tmdb_id integer,
  season integer,
  episode integer,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_events_name_occurred_idx
  ON analytics_events (event_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS analytics_events_occurred_idx
  ON analytics_events (occurred_at DESC);
