CREATE TABLE app_data_files (
  id TEXT PRIMARY KEY REFERENCES storage_objects(id),
  app_id TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES "user"(id),
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes BIGINT NOT NULL CHECK(bytes>0),
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at BIGINT NOT NULL
);
CREATE INDEX app_data_files_app ON app_data_files(app_id,created_at);
