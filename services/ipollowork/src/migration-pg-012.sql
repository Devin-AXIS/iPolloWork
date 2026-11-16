-- Space invitations share the organization invitation lifecycle and token ownership.
ALTER TABLE invitations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE invitations ADD COLUMN project_role TEXT CHECK(project_role IN ('view','participate','maintain'));
ALTER TABLE invitations ADD CONSTRAINT invitation_project_role CHECK ((project_id IS NULL) = (project_role IS NULL));
