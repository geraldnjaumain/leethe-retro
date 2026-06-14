CREATE TABLE IF NOT EXISTS admin_audit_events (
  id bigserial PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('ticket_status_update', 'ticket_bulk_status_update')),
  target_type text NOT NULL CHECK (target_type IN ('support_ticket', 'support_ticket_batch')),
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_events_occurred_idx
  ON admin_audit_events (occurred_at DESC);
