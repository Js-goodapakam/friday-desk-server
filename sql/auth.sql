-- Apply using a reviewed database migration before provisioning staff accounts.
CREATE TABLE IF NOT EXISTS friday_credentials (
  user_id INTEGER PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS friday_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS friday_sessions_expiry ON friday_sessions(expires_at);
