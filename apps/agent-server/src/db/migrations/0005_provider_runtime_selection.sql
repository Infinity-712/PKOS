ALTER TABLE generations ADD COLUMN provider_id TEXT;
ALTER TABLE generations ADD COLUMN profile_id TEXT;
ALTER TABLE generations ADD COLUMN protocol TEXT;
ALTER TABLE generations ADD COLUMN model_id TEXT;
ALTER TABLE generations ADD COLUMN reasoning_preset TEXT;
ALTER TABLE generations ADD COLUMN endpoint_origin TEXT;
ALTER TABLE generations ADD COLUMN external INTEGER;

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
