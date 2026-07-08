CREATE TABLE IF NOT EXISTS action_requests (
  request_id TEXT PRIMARY KEY,
  action_name TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  tool_call_id TEXT,
  result_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_action_requests_action_status
  ON action_requests (action_name, status);
