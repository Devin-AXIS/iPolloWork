CREATE UNIQUE INDEX projects_native_owner ON projects(owner_id,native_id) WHERE native_id IS NOT NULL;
CREATE INDEX shares_project_created ON shares(project_id,created_at);
