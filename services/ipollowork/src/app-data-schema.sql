CREATE TABLE data_apps(
  id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK(owner_kind IN('user','enterprise')),
  owner_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  workspace TEXT NOT NULL DEFAULT '',
  public_key TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  seq BIGINT NOT NULL DEFAULT 0,
  records BIGINT NOT NULL DEFAULT 0,
  bytes BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT
);
CREATE UNIQUE INDEX data_apps_slug ON data_apps(owner_kind,owner_id,slug) WHERE deleted_at IS NULL;
CREATE INDEX data_apps_owner ON data_apps(owner_kind,owner_id,updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX data_apps_deleted ON data_apps(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE data_collections(
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES data_apps(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '[]',
  public_read BOOLEAN NOT NULL DEFAULT false,
  public_create BOOLEAN NOT NULL DEFAULT false,
  unique_fields TEXT,
  records BIGINT NOT NULL DEFAULT 0,
  bytes BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  dropped_at BIGINT
);
CREATE UNIQUE INDEX data_collections_name ON data_collections(app_id,name) WHERE dropped_at IS NULL;
CREATE INDEX data_collections_dropped ON data_collections(dropped_at) WHERE dropped_at IS NOT NULL;

CREATE TABLE data_records(
  collection_id TEXT NOT NULL REFERENCES data_collections(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  id TEXT NOT NULL,
  data JSONB NOT NULL,
  version INTEGER NOT NULL,
  seq BIGINT NOT NULL,
  bytes INTEGER NOT NULL,
  unique_key TEXT,
  created_by TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT,
  PRIMARY KEY(collection_id,id)
);
CREATE INDEX data_records_created ON data_records(collection_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX data_records_changes ON data_records(app_id,seq);
CREATE INDEX data_records_data ON data_records USING GIN(data jsonb_path_ops);
CREATE UNIQUE INDEX data_records_unique ON data_records(collection_id,unique_key) WHERE unique_key IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE data_rate(
  app_id TEXT NOT NULL REFERENCES data_apps(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  minute BIGINT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(app_id,ip,minute)
);
