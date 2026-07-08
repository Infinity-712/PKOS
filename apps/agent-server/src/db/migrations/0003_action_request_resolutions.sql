CREATE TABLE IF NOT EXISTS action_request_resolutions (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  resolution TEXT NOT NULL,
  reason TEXT NOT NULL,
  resolved_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (request_id)
);

CREATE INDEX IF NOT EXISTS idx_action_request_resolutions_request
  ON action_request_resolutions (request_id);
