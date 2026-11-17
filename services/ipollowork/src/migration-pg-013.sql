CREATE TABLE enterprise_mcp(
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX enterprise_mcp_enterprise ON enterprise_mcp(enterprise_id, created_at DESC);

ALTER TABLE enterprise_grants DROP CONSTRAINT enterprise_grants_asset_kind_check;
ALTER TABLE enterprise_grants ADD CHECK(asset_kind IN('package','skill','service','mcp'));

ALTER TABLE projects ADD COLUMN deleted_at BIGINT;
