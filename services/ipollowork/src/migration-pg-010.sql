ALTER TABLE projects ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'local' CHECK(execution_mode IN('local','cloud'));
ALTER TABLE projects ADD COLUMN creation_key TEXT;
ALTER TABLE projects ADD CONSTRAINT projects_cloud_has_no_local_id CHECK(execution_mode='local' OR native_id IS NULL);
CREATE UNIQUE INDEX projects_creation_key ON projects(owner_id,creation_key) WHERE creation_key IS NOT NULL;
-- Lease expiry never precedes the provider TTL, even when the manager disconnects.
CREATE TABLE cloud_runtime_leases (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  instance_id TEXT NOT NULL UNIQUE,
  last_active_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
