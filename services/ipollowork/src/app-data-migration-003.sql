ALTER TABLE data_apps ADD COLUMN pruned_seq BIGINT NOT NULL DEFAULT 0;
CREATE INDEX data_records_tombstones ON data_records(deleted_at,app_id) WHERE deleted_at IS NOT NULL;
ALTER TABLE data_rate RENAME COLUMN ip TO bucket;
