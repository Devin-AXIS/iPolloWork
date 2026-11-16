ALTER TABLE publications ADD COLUMN IF NOT EXISTS site_key TEXT;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES publications(id);
ALTER TABLE publications ADD COLUMN IF NOT EXISTS live_revision TEXT REFERENCES publications(id);
CREATE UNIQUE INDEX IF NOT EXISTS publications_owner_site ON publications(owner_id,site_key) WHERE site_key IS NOT NULL;
