CREATE TABLE IF NOT EXISTS reminder_delivery_attempts (
  id TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL,
  remind_at TEXT NOT NULL,
  runtime_fingerprint TEXT NOT NULL,
  delivery_channel TEXT NOT NULL,
  delivery_state TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_attempt_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  acknowledged_in_runtime_at TEXT,
  error_code TEXT,
  UNIQUE (reminder_id, runtime_fingerprint, delivery_channel)
);

CREATE INDEX IF NOT EXISTS idx_reminder_delivery_attempts_state
  ON reminder_delivery_attempts (delivery_state, remind_at);
