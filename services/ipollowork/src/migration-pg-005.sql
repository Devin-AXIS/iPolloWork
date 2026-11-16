CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES "user"(id),
  project_id TEXT REFERENCES projects(id),
  enterprise_id TEXT REFERENCES enterprises(id),
  request_id TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('draft','published','revoked')),
  created_at BIGINT NOT NULL,
  published_at BIGINT,
  UNIQUE(owner_id,request_id)
);
CREATE TABLE publication_files (
  publication_id TEXT NOT NULL REFERENCES publications(id),
  path TEXT NOT NULL,
  bytes BIGINT NOT NULL CHECK(bytes>=0),
  storage_key TEXT,
  sha256 TEXT,
  PRIMARY KEY(publication_id,path)
);
