CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  partial_content TEXT NOT NULL DEFAULT '',
  error_json TEXT,
  provider_name TEXT,
  model_name TEXT,
  provider_id TEXT,
  profile_id TEXT,
  protocol TEXT,
  model_id TEXT,
  reasoning_preset TEXT,
  endpoint_origin TEXT,
  external INTEGER,
  finish_reason TEXT,
  input_chars INTEGER,
  output_chars INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  session_id TEXT,
  generation_id TEXT,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  generation_id TEXT,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
  ON chat_messages (session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_generations_session_created
  ON generations (session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_events_generation_ts
  ON agent_events (generation_id, ts);

CREATE TABLE IF NOT EXISTS provider_runtime_selection (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  reasoning_preset TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_connection_status (
  profile_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  reasoning_preset TEXT NOT NULL,
  status TEXT NOT NULL,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error_code TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, model_id, reasoning_preset)
);
