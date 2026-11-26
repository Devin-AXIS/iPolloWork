CREATE TABLE IF NOT EXISTS deletion_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  parent_project_id TEXT,
  storage_keys TEXT[] NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL,
  retry_at BIGINT NOT NULL DEFAULT 0,
  completed_at BIGINT,
  UNIQUE(kind,target_id)
);
CREATE INDEX IF NOT EXISTS deletion_jobs_pending ON deletion_jobs(retry_at,created_at)
  WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS deletion_jobs_project_pending ON deletion_jobs(parent_project_id) WHERE completed_at IS NULL AND parent_project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS deletion_jobs_actor ON deletion_jobs(requested_by,created_at DESC);
ALTER TABLE storage_objects ADD COLUMN IF NOT EXISTS physical_deleted BOOLEAN NOT NULL DEFAULT false;
