ALTER TABLE enterprises ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE enterprises ADD COLUMN logo TEXT;
ALTER TABLE enterprises ADD COLUMN tab_order TEXT NOT NULL DEFAULT '[]';
ALTER TABLE members ADD COLUMN employee_number TEXT;
ALTER TABLE members ADD COLUMN display_name TEXT;
CREATE UNIQUE INDEX members_employee_number ON members (enterprise_id, lower(employee_number))
  WHERE employee_number IS NOT NULL;
ALTER TABLE invitations ALTER COLUMN email DROP NOT NULL;
ALTER TABLE invitations ADD COLUMN invitee_name TEXT;
ALTER TABLE invitations ADD COLUMN employee_number TEXT;
ALTER TABLE departments ADD COLUMN parent_id TEXT REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE enterprise_mcp ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE enterprise_mcp ADD COLUMN oauth_config TEXT;
CREATE TABLE enterprise_mcp_oauth_pending (
  mcp_id TEXT NOT NULL REFERENCES enterprise_mcp(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL UNIQUE,
  verifier TEXT NOT NULL,
  configuration TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY(mcp_id,user_id)
);
ALTER TABLE audit ADD COLUMN enterprise_id TEXT REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX audit_enterprise ON audit(enterprise_id, id DESC) WHERE enterprise_id IS NOT NULL;
CREATE TABLE organization_member_notices (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('role','department','removed')),
  value TEXT,
  created_at BIGINT NOT NULL,
  read_at BIGINT
);
CREATE INDEX organization_member_notices_user ON organization_member_notices(user_id, created_at DESC);

CREATE TABLE organization_publications (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  submitted_by TEXT NOT NULL REFERENCES "user"(id),
  kind TEXT NOT NULL CHECK(kind IN ('plugin', 'template', 'skill')),
  resource_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  published_version TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE(enterprise_id, kind, resource_key)
);
CREATE TABLE organization_publication_versions (
  publication_id TEXT NOT NULL REFERENCES organization_publications(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  content TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
  note TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  PRIMARY KEY(publication_id, version)
);
ALTER TABLE enterprise_grants DROP CONSTRAINT enterprise_grants_asset_kind_check;
ALTER TABLE enterprise_grants ADD CONSTRAINT enterprise_grants_asset_kind_check
  CHECK(asset_kind IN ('package', 'skill', 'service', 'mcp', 'plugin', 'template'));
ALTER TABLE enterprise_grants DROP CONSTRAINT enterprise_grants_audience_kind_check;
ALTER TABLE enterprise_grants ADD CONSTRAINT enterprise_grants_audience_kind_check
  CHECK(audience_kind IN ('all', 'department', 'department_tree', 'member'));
