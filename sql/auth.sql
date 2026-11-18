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

-- Links a verified Supabase Auth identity to exactly one PMS user and tenant.
-- New customer provisioning uses this mapping instead of storing another
-- application password. Existing friday_credentials rows remain supported for
-- the controlled legacy-login migration.
CREATE TABLE IF NOT EXISTS friday_auth_identity (
  auth_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT friday_auth_identity_user_property_key UNIQUE (user_id, property_id)
);
CREATE INDEX IF NOT EXISTS friday_auth_identity_property_id ON friday_auth_identity(property_id);

ALTER TABLE friday_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE friday_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE friday_auth_identity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON friday_credentials, friday_sessions, friday_auth_identity FROM anon, authenticated;
