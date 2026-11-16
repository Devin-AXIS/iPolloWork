ALTER TABLE projects ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'enterprise' CHECK(access_mode IN('enterprise','selected'));
ALTER TABLE projects ADD COLUMN memory TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN memory_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN files TEXT NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN file_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE project_grants(
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN('member','department')),
  subject_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN('view','participate','maintain')),
  PRIMARY KEY(project_id,kind,subject_id)
);
CREATE TABLE project_changes(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  author_id TEXT NOT NULL REFERENCES user(id),
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('files','memory')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','accepted','withdrawn')),
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  accepted_by TEXT REFERENCES user(id),
  UNIQUE(author_id,request_id)
);
CREATE INDEX project_changes_project ON project_changes(project_id,created_at DESC);
