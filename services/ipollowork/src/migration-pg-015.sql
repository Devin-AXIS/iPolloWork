CREATE TABLE project_board_tasks (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  title TEXT NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
  description TEXT NOT NULL CHECK(length(description) <= 8000),
  status TEXT NOT NULL CHECK(status IN ('todo','doing','review','done')),
  priority TEXT NOT NULL CHECK(priority IN ('normal','high','urgent')),
  start_at BIGINT,
  due_at BIGINT,
  people_org_id TEXT REFERENCES enterprises(id) ON DELETE SET NULL,
  assignee_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  assignee_agent JSONB CHECK(assignee_agent IS NULL OR jsonb_typeof(assignee_agent) = 'object'),
  participant_agents JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(participant_agents) = 'array' AND jsonb_array_length(participant_agents)<=20),
  participants TEXT[] NOT NULL DEFAULT '{}',
  predecessors TEXT[] NOT NULL DEFAULT '{}',
  session_id TEXT,
  PRIMARY KEY (project_id,id),
  CHECK(assignee_id IS NULL OR assignee_agent IS NULL),
  CHECK(start_at IS NULL OR due_at IS NULL OR start_at<=due_at),
  CHECK(cardinality(participants)<=100 AND cardinality(predecessors)<=50),
  CHECK(NOT id = ANY(predecessors))
);
CREATE UNIQUE INDEX project_board_session ON project_board_tasks(project_id,session_id) WHERE session_id IS NOT NULL;
CREATE INDEX project_board_predecessors ON project_board_tasks USING GIN(predecessors);

CREATE TABLE project_board_notices (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  enterprise_id TEXT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('assigned','participating','ready')),
  created_at BIGINT NOT NULL,
  read_at BIGINT,
  FOREIGN KEY(project_id,task_id) REFERENCES project_board_tasks(project_id,id) ON DELETE CASCADE
);
CREATE INDEX project_board_inbox ON project_board_notices(recipient_id,created_at DESC,id DESC);
