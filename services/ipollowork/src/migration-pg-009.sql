-- Usage attribution is captured at dispatch; legacy rows remain unattributed.
ALTER TABLE service_calls ADD COLUMN enterprise_id TEXT REFERENCES enterprises(id);
ALTER TABLE service_calls ADD COLUMN department_id TEXT;
ALTER TABLE service_calls ADD COLUMN model_id TEXT;
ALTER TABLE service_calls ADD COLUMN is_job_poll BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE service_calls ADD COLUMN input_tokens BIGINT CHECK(input_tokens>=0);
ALTER TABLE service_calls ADD COLUMN output_tokens BIGINT CHECK(output_tokens>=0);
CREATE INDEX service_calls_enterprise_time ON service_calls(enterprise_id,created_at) WHERE enterprise_id IS NOT NULL;
CREATE TABLE enterprise_activity (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL REFERENCES enterprises(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  department_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN('skill','tool')),
  name TEXT NOT NULL,
  succeeded BOOLEAN NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX enterprise_activity_time ON enterprise_activity(enterprise_id,created_at);
