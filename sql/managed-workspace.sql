CREATE TABLE IF NOT EXISTS engagestay_managed_workspace (
  property_id integer PRIMARY KEY REFERENCES "property"(id),
  customer_id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('active', 'suspended')),
  plan text NOT NULL,
  modules text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE engagestay_managed_workspace ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS engagestay_workspace_state (
  property_id integer PRIMARY KEY REFERENCES engagestay_managed_workspace(property_id),
  state jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
ALTER TABLE engagestay_workspace_state ENABLE ROW LEVEL SECURITY;
