ALTER TABLE projects ADD COLUMN archive_outputs BIGINT NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX service_calls_one_running ON service_calls(user_id) WHERE state='running';

CREATE TABLE project_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  resource_id TEXT NOT NULL REFERENCES resources(id),
  author_id TEXT NOT NULL REFERENCES "user"(id),
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind='output'),
  path TEXT NOT NULL,
  version BIGINT NOT NULL,
  source_session TEXT,
  source_turn BIGINT,
  created_at BIGINT NOT NULL,
  UNIQUE(author_id,request_id),
  UNIQUE(project_id,kind,path,version)
);
CREATE INDEX project_artifacts_latest ON project_artifacts(project_id,kind,path,version DESC);

CREATE TABLE project_memory_versions (
  project_id TEXT NOT NULL REFERENCES projects(id),
  version BIGINT NOT NULL,
  change_id TEXT NOT NULL REFERENCES project_changes(id),
  author_id TEXT NOT NULL REFERENCES "user"(id),
  storage_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY(project_id,version)
);
