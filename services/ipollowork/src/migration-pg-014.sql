-- Production used version 13 for MCP and project deletion before main used
-- that same number for organization notifications. Converge both schemas.
CREATE TABLE IF NOT EXISTS organization_notifications (
 enterprise_id TEXT PRIMARY KEY REFERENCES enterprises(id) ON DELETE CASCADE,
 endpoint TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT false, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS organization_notification_deliveries (
 id TEXT PRIMARY KEY, enterprise_id TEXT NOT NULL REFERENCES organization_notifications(enterprise_id) ON DELETE CASCADE,
 payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at BIGINT NOT NULL,
 delivered_at BIGINT, lease_until BIGINT, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS organization_notification_due ON organization_notification_deliveries(next_at) WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS enterprise_mcp(
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS enterprise_mcp_enterprise ON enterprise_mcp(enterprise_id, created_at DESC);

ALTER TABLE enterprise_grants DROP CONSTRAINT IF EXISTS enterprise_grants_asset_kind_check;
ALTER TABLE enterprise_grants ADD CONSTRAINT enterprise_grants_asset_kind_check CHECK(asset_kind IN('package','skill','service','mcp'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at BIGINT;
