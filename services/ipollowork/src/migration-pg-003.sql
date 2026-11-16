CREATE TABLE storage_quotas (
  scope TEXT NOT NULL CHECK(scope IN ('personal','organization')),
  owner_id TEXT NOT NULL,
  limit_bytes BIGINT NOT NULL CHECK(limit_bytes>=0),
  used_bytes BIGINT NOT NULL DEFAULT 0 CHECK(used_bytes>=0),
  reserved_bytes BIGINT NOT NULL DEFAULT 0 CHECK(reserved_bytes>=0),
  PRIMARY KEY(scope,owner_id)
);
CREATE TABLE storage_objects (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  bytes BIGINT NOT NULL CHECK(bytes>=0),
  state TEXT NOT NULL CHECK(state IN ('reserved','ready','deleting','deleted')),
  charged BOOLEAN NOT NULL DEFAULT false,
  created_at BIGINT NOT NULL,
  expires_at BIGINT,
  published_at BIGINT,
  project_id TEXT REFERENCES projects(id),
  retention_expires_at BIGINT,
  attached BOOLEAN NOT NULL DEFAULT false,
  FOREIGN KEY(scope,owner_id) REFERENCES storage_quotas(scope,owner_id)
);
CREATE INDEX storage_objects_expiry ON storage_objects(expires_at) WHERE state<>'deleted';
CREATE INDEX storage_objects_owner ON storage_objects(scope,owner_id,state);
CREATE INDEX storage_objects_project ON storage_objects(project_id);
ALTER TABLE projects ADD COLUMN published_at BIGINT;
