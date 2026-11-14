-- PostgreSQL business schema. Better Auth owns its authentication tables.

CREATE TABLE enterprises(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES "user"(id),created_at BIGINT NOT NULL);

CREATE TABLE departments(id TEXT PRIMARY KEY,enterprise_id TEXT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,name TEXT NOT NULL,UNIQUE(enterprise_id,name));

CREATE TABLE members(enterprise_id TEXT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES "user"(id),role TEXT NOT NULL CHECK(role IN('owner','admin','member')),department_id TEXT REFERENCES departments(id),created_at BIGINT NOT NULL,PRIMARY KEY(enterprise_id,user_id));

CREATE INDEX members_user ON members(user_id);

CREATE TABLE invitations(id TEXT PRIMARY KEY,enterprise_id TEXT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,email TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('admin','member')),department_id TEXT REFERENCES departments(id),expires_at BIGINT NOT NULL,accepted_by TEXT REFERENCES "user"(id),revoked_at BIGINT,created_at BIGINT NOT NULL);

CREATE TABLE projects(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES "user"(id),enterprise_id TEXT REFERENCES enterprises(id),title TEXT NOT NULL,native_id TEXT,created_at BIGINT NOT NULL, access_mode TEXT NOT NULL DEFAULT 'enterprise' CHECK(access_mode IN('enterprise','selected')), memory TEXT NOT NULL DEFAULT '', memory_version BIGINT NOT NULL DEFAULT 0, files TEXT NOT NULL DEFAULT '[]', file_version BIGINT NOT NULL DEFAULT 0);

CREATE INDEX projects_owner ON projects(owner_id,created_at);

CREATE INDEX projects_enterprise ON projects(enterprise_id,created_at);

CREATE TABLE resources(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES "user"(id),enterprise_id TEXT REFERENCES enterprises(id),kind TEXT NOT NULL CHECK(kind IN('skill','plugin','attachment')),visibility TEXT NOT NULL CHECK(visibility IN('private','enterprise','public')),title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',version TEXT NOT NULL DEFAULT '1.0.0',storage_key TEXT NOT NULL,mime TEXT NOT NULL,bytes BIGINT NOT NULL,sha256 TEXT NOT NULL,created_at BIGINT NOT NULL);

CREATE INDEX resources_scope ON resources(enterprise_id,kind,created_at);

CREATE TABLE shares(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES "user"(id),project_id TEXT NOT NULL REFERENCES projects(id),title TEXT NOT NULL,transcript TEXT NOT NULL,visibility TEXT NOT NULL CHECK(visibility IN('selected','enterprise')),revoked_at BIGINT,created_at BIGINT NOT NULL);

CREATE TABLE share_members(share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES "user"(id),role TEXT NOT NULL CHECK(role IN('view','comment')),PRIMARY KEY(share_id,user_id));

CREATE TABLE comments(id TEXT PRIMARY KEY,share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES "user"(id),content TEXT NOT NULL,created_at BIGINT NOT NULL);

CREATE INDEX comments_share ON comments(share_id,created_at);

CREATE TABLE plans(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL CHECK(kind IN('points','membership')),amount BIGINT NOT NULL CHECK(amount>=0),currency TEXT NOT NULL,points BIGINT NOT NULL CHECK(points>=0),days BIGINT NOT NULL CHECK(days>=0),enabled BIGINT NOT NULL DEFAULT 1,apple_product_id TEXT UNIQUE,created_at BIGINT NOT NULL,points_cost BIGINT CHECK(points_cost>0));

CREATE TABLE orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES "user"(id),plan_id TEXT NOT NULL REFERENCES plans(id),provider TEXT NOT NULL,provider_id TEXT UNIQUE,status TEXT NOT NULL CHECK(status IN('pending','paid','refunded','failed')),amount BIGINT NOT NULL,currency TEXT NOT NULL,points BIGINT NOT NULL,days BIGINT NOT NULL,created_at BIGINT NOT NULL,paid_at BIGINT);

CREATE INDEX orders_user ON orders(user_id,created_at);

CREATE TABLE ledger(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES "user"(id),amount BIGINT NOT NULL,balance_after BIGINT NOT NULL,reference TEXT NOT NULL UNIQUE,reason TEXT NOT NULL,actor_id TEXT REFERENCES "user"(id),created_at BIGINT NOT NULL, sequence BIGSERIAL UNIQUE);

CREATE INDEX ledger_user ON ledger(user_id,created_at);

CREATE TABLE entitlements(order_id TEXT PRIMARY KEY REFERENCES orders(id),user_id TEXT NOT NULL REFERENCES "user"(id),plan_id TEXT NOT NULL REFERENCES plans(id),starts_at BIGINT NOT NULL,expires_at BIGINT NOT NULL,revoked_at BIGINT, sequence BIGSERIAL UNIQUE);

CREATE INDEX entitlements_user ON entitlements(user_id,expires_at);

CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);

CREATE TABLE audit(id BIGSERIAL PRIMARY KEY,actor_id TEXT REFERENCES "user"(id),action TEXT NOT NULL,target TEXT NOT NULL,created_at BIGINT NOT NULL);

CREATE UNIQUE INDEX projects_native_owner ON projects(owner_id,native_id) WHERE native_id IS NOT NULL;

CREATE INDEX shares_project_created ON shares(project_id,created_at);

CREATE TABLE project_work(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_share_id TEXT NOT NULL REFERENCES shares(id),
  owner_id TEXT NOT NULL REFERENCES "user"(id),
  source_work_id TEXT REFERENCES project_work(id),
  source_version BIGINT NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  native_workspace_id TEXT NOT NULL,
  native_session_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(owner_id,native_session_id)
);

CREATE INDEX project_work_project ON project_work(project_id,updated_at DESC);

CREATE INDEX project_work_owner ON project_work(owner_id,updated_at DESC);

CREATE TABLE work_revisions(
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES project_work(id),
  version BIGINT NOT NULL CHECK(version>0),
  author_id TEXT NOT NULL REFERENCES "user"(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(work_id,version)
);

CREATE INDEX work_revisions_created ON work_revisions(created_at DESC);

CREATE TABLE project_grants(
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN('member','department')),
  subject_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN('view','participate','maintain')),
  PRIMARY KEY(project_id,kind,subject_id)
);

CREATE TABLE project_changes(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  author_id TEXT NOT NULL REFERENCES "user"(id),
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('files','memory')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  base_version BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','accepted','withdrawn')),
  created_at BIGINT NOT NULL,
  accepted_at BIGINT,
  accepted_by TEXT REFERENCES "user"(id),
  UNIQUE(author_id,request_id)
);

CREATE INDEX project_changes_project ON project_changes(project_id,created_at DESC);

CREATE TABLE live_codes (
  hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE execution_services(id TEXT PRIMARY KEY,title TEXT NOT NULL,provider TEXT NOT NULL,base_url TEXT NOT NULL,key_id TEXT NOT NULL,header_name TEXT NOT NULL,header_prefix TEXT NOT NULL,capabilities TEXT NOT NULL,routes TEXT NOT NULL,plan_ids TEXT NOT NULL,enabled BIGINT NOT NULL CHECK(enabled IN(0,1)),created_at BIGINT NOT NULL);

CREATE TABLE service_calls(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES "user"(id),service_id TEXT NOT NULL REFERENCES execution_services(id),request_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('running','succeeded','failed','unknown')),points BIGINT NOT NULL CHECK(points>=0),response_type TEXT,response_body TEXT,job_id TEXT,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);

CREATE INDEX service_calls_user_time ON service_calls(user_id,created_at DESC);

CREATE INDEX service_calls_job ON service_calls(service_id,job_id,user_id);

CREATE TABLE live_shares (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES "user"(id),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  source_session TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('view','write')),
  native_id TEXT UNIQUE,
  gateway_hash TEXT,
  instance_key TEXT,
  title TEXT NOT NULL,
  access_json TEXT NOT NULL DEFAULT '{}',
  access_version BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  revoked_at BIGINT,
  allows_fork BIGINT NOT NULL DEFAULT 0,
  expires_at BIGINT,
  audience_json TEXT NOT NULL DEFAULT '{"kind":"project"}'
);

CREATE TABLE enterprise_services(service_id TEXT PRIMARY KEY REFERENCES execution_services(id) ON DELETE CASCADE,enterprise_id TEXT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE);

CREATE INDEX enterprise_services_enterprise ON enterprise_services(enterprise_id);

CREATE TABLE file_packages(id TEXT PRIMARY KEY,enterprise_id TEXT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL REFERENCES "user"(id),created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);

CREATE INDEX file_packages_enterprise ON file_packages(enterprise_id,updated_at DESC);

CREATE TABLE package_files(package_id TEXT NOT NULL REFERENCES file_packages(id) ON DELETE CASCADE,resource_id TEXT NOT NULL REFERENCES resources(id),name TEXT NOT NULL,added_by TEXT NOT NULL REFERENCES "user"(id),added_at BIGINT NOT NULL,PRIMARY KEY(package_id,resource_id));

CREATE TABLE enterprise_grants(enterprise_id TEXT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,asset_kind TEXT NOT NULL CHECK(asset_kind IN('package','skill','service')),asset_id TEXT NOT NULL,audience_kind TEXT NOT NULL CHECK(audience_kind IN('all','department','member')),audience_id TEXT NOT NULL DEFAULT '',PRIMARY KEY(asset_kind,asset_id,audience_kind,audience_id));

CREATE INDEX enterprise_grants_enterprise ON enterprise_grants(enterprise_id,asset_kind);

CREATE TABLE wallets(user_id TEXT PRIMARY KEY REFERENCES "user"(id), balance BIGINT NOT NULL DEFAULT 0, total_earned BIGINT NOT NULL DEFAULT 0, total_spent BIGINT NOT NULL DEFAULT 0);

CREATE INDEX service_calls_running ON service_calls(user_id) WHERE state='running';

CREATE INDEX service_calls_created ON service_calls(created_at DESC);

CREATE INDEX ledger_latest ON ledger(user_id,created_at DESC,sequence DESC);

CREATE INDEX members_department ON members(enterprise_id,department_id);

CREATE INDEX live_shares_owner ON live_shares(owner_id,created_at DESC);

CREATE INDEX live_shares_project ON live_shares(project_id) WHERE revoked_at IS NULL;
