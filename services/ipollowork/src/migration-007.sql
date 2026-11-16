ALTER TABLE live_shares RENAME TO live_shares_v6;
CREATE TABLE live_shares (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES "user"(id),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  source_session TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('view','write')),
  native_id TEXT UNIQUE,
  gateway_hash TEXT,
  instance_key TEXT,
  title TEXT NOT NULL,
  access_json TEXT NOT NULL DEFAULT '{}',
  access_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  allows_fork INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  audience_json TEXT NOT NULL DEFAULT '{"kind":"project"}'
);
INSERT INTO live_shares SELECT *, CASE WHEN mode='write' THEN 1 ELSE 0 END, NULL, '{"kind":"project"}' FROM live_shares_v6;
DROP TABLE live_shares_v6;
