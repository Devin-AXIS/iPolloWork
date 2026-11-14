CREATE TABLE project_work(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_share_id TEXT NOT NULL REFERENCES shares(id),
  owner_id TEXT NOT NULL REFERENCES user(id),
  source_work_id TEXT REFERENCES project_work(id),
  source_version INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  native_workspace_id TEXT NOT NULL,
  native_session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_id,native_session_id)
);
CREATE INDEX project_work_project ON project_work(project_id,updated_at DESC);
CREATE INDEX project_work_owner ON project_work(owner_id,updated_at DESC);
CREATE TABLE work_revisions(
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES project_work(id),
  version INTEGER NOT NULL CHECK(version>0),
  author_id TEXT NOT NULL REFERENCES user(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(work_id,version)
);
CREATE INDEX work_revisions_created ON work_revisions(created_at DESC);
