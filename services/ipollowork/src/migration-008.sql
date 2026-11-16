CREATE TABLE enterprise_services(service_id TEXT PRIMARY KEY REFERENCES execution_services(id) ON DELETE CASCADE,enterprise_id TEXT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE);
CREATE INDEX enterprise_services_enterprise ON enterprise_services(enterprise_id);
CREATE TABLE file_packages(id TEXT PRIMARY KEY,enterprise_id TEXT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL REFERENCES user(id),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX file_packages_enterprise ON file_packages(enterprise_id,updated_at DESC);
CREATE TABLE package_files(package_id TEXT NOT NULL REFERENCES file_packages(id) ON DELETE CASCADE,resource_id TEXT NOT NULL REFERENCES resources(id),name TEXT NOT NULL,added_by TEXT NOT NULL REFERENCES user(id),added_at INTEGER NOT NULL,PRIMARY KEY(package_id,resource_id));
CREATE TABLE enterprise_grants(enterprise_id TEXT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,asset_kind TEXT NOT NULL CHECK(asset_kind IN('package','skill','service')),asset_id TEXT NOT NULL,audience_kind TEXT NOT NULL CHECK(audience_kind IN('all','department','member')),audience_id TEXT NOT NULL DEFAULT '',PRIMARY KEY(asset_kind,asset_id,audience_kind,audience_id));
CREATE INDEX enterprise_grants_enterprise ON enterprise_grants(enterprise_id,asset_kind);
