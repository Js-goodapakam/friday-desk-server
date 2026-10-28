-- Friday sample-workspace persistence for PostgreSQL/Supabase.
-- This migration creates empty tables only; it does not alter existing property or user rows.
CREATE TABLE IF NOT EXISTS friday_property_access (
  user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES "property"(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, property_id)
);

CREATE TABLE IF NOT EXISTS friday_demo_workspace (
  property_id INTEGER PRIMARY KEY REFERENCES "property"(id) ON DELETE CASCADE,
  seed TEXT NOT NULL,
  state_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS friday_demo_room_type (
  property_id INTEGER NOT NULL REFERENCES "property"(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (property_id, id)
);

CREATE TABLE IF NOT EXISTS friday_demo_room (
  property_id INTEGER NOT NULL,
  number TEXT NOT NULL,
  room_type_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (property_id, number),
  FOREIGN KEY (property_id, room_type_id) REFERENCES friday_demo_room_type(property_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS friday_demo_guest (
  property_id INTEGER NOT NULL REFERENCES "property"(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (property_id, id)
);

CREATE TABLE IF NOT EXISTS friday_demo_reservation (
  property_id INTEGER NOT NULL,
  id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  room_number TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (property_id, id),
  FOREIGN KEY (property_id, guest_id) REFERENCES friday_demo_guest(property_id, id) ON DELETE CASCADE,
  FOREIGN KEY (property_id, room_number) REFERENCES friday_demo_room(property_id, number) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS friday_demo_record (
  property_id INTEGER NOT NULL REFERENCES "property"(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  reservation_id TEXT,
  payload TEXT NOT NULL,
  PRIMARY KEY (property_id, kind, id),
  FOREIGN KEY (property_id, reservation_id) REFERENCES friday_demo_reservation(property_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS friday_demo_user (
  user_id INTEGER PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  seed TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS friday_demo_audit (
  id BIGSERIAL PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES "property"(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS friday_demo_record_property_kind ON friday_demo_record(property_id, kind);
CREATE INDEX IF NOT EXISTS friday_demo_audit_property_time ON friday_demo_audit(property_id, at DESC);

CREATE TABLE IF NOT EXISTS friday_owner_settings (
  user_id INTEGER PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
