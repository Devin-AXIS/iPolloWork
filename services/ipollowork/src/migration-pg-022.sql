ALTER TABLE project_board_tasks ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE project_board_tasks ADD COLUMN IF NOT EXISTS deleted_at BIGINT;
DROP INDEX IF EXISTS project_board_session;
CREATE UNIQUE INDEX project_board_session ON project_board_tasks(project_id,session_id) WHERE session_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS project_board_active_due ON project_board_tasks(due_at) WHERE deleted_at IS NULL AND NOT archived AND status<>'done';
ALTER TABLE project_board_notices DROP CONSTRAINT IF EXISTS project_board_notices_kind_check;
ALTER TABLE project_board_notices ADD CONSTRAINT project_board_notices_kind_check CHECK(kind IN ('assigned','participating','ready','due'));
ALTER TABLE project_board_notices ADD COLUMN IF NOT EXISTS due_at BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS project_board_due_notice ON project_board_notices(project_id,task_id,recipient_id,due_at) WHERE kind='due';
