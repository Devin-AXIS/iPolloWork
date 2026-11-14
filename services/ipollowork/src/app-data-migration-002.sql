ALTER TABLE data_apps ADD COLUMN kind TEXT NOT NULL DEFAULT 'plugin' CHECK(kind IN('plugin','site'));
UPDATE data_apps a SET kind='site' WHERE EXISTS(SELECT 1 FROM data_collections c WHERE c.app_id=a.id AND c.dropped_at IS NULL AND (c.public_read OR c.public_create));
ALTER TABLE data_apps ALTER COLUMN kind DROP DEFAULT;
