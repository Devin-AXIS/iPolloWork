ALTER TABLE members ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','suspended') AND (role <> 'owner' OR status = 'active'));

ALTER TABLE organization_member_notices DROP CONSTRAINT organization_member_notices_kind_check;
ALTER TABLE organization_member_notices ADD CONSTRAINT organization_member_notices_kind_check
  CHECK (kind IN ('role','department','removed','status'));
