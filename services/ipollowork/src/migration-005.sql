CREATE TABLE live_shares (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES "user"(id),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_session TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('view','write')),
  native_id TEXT UNIQUE,
  gateway_hash TEXT,
  instance_key TEXT,
  title TEXT NOT NULL,
  access_json TEXT NOT NULL DEFAULT '{}',
  access_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE TABLE live_codes (
  hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
