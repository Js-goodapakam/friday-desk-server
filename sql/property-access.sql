CREATE TABLE IF NOT EXISTS friday_property_access (
 user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 property_id INTEGER NOT NULL REFERENCES "property"(id) ON DELETE CASCADE,
 PRIMARY KEY (user_id,property_id)
);
