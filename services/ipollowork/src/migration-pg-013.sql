-- Optional organization-owned notification delivery. No subscriptions are created by migration.
CREATE TABLE organization_notifications (
 enterprise_id TEXT PRIMARY KEY REFERENCES enterprises(id) ON DELETE CASCADE,
 endpoint TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT false, updated_at BIGINT NOT NULL
);
CREATE TABLE organization_notification_deliveries (
 id TEXT PRIMARY KEY, enterprise_id TEXT NOT NULL REFERENCES organization_notifications(enterprise_id) ON DELETE CASCADE,
 payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at BIGINT NOT NULL,
 delivered_at BIGINT, lease_until BIGINT, created_at BIGINT NOT NULL
);
CREATE INDEX organization_notification_due ON organization_notification_deliveries(next_at) WHERE delivered_at IS NULL;
