import { dirname } from "node:path";
import {
  DEFAULT_WORK_BOARD_CONFIG,
  projectSessionExecutionSchema,
  workBoardConfigValueSchema,
  workItemAutomationSchema,
  workItemCreateSchema,
  workItemPrioritySchema,
  type WorkBoardConfig,
  type WorkBoardConfigValue,
  type WorkItem,
  type WorkItemAutomation,
  type WorkItemCreateInput,
  type WorkItemListResponse,
  type WorkItemUpdateInput,
  type ProjectSessionExecution,
  type ProjectSessionExecutionFinishInput,
  type ProjectSessionExecutionRuntime,
  type ProjectSessionExecutionStartInput,
} from "@ipollowork/types/work-items";
import {
  createDefaultProjectWorkspaceConfig,
  projectWorkspaceConfigSchema,
  type ProjectAgent,
} from "@ipollowork/types/project-workspace";
import { DEFAULT_ENGINE_ID, isHarnessWorkspaceEngineId } from "@ipollowork/types/workspace";

import { ApiError } from "./errors.js";
import { readiPolloWorkWorkspaceConfig } from "./ipollowork-workspace-config-store.js";
import { importNodeSqlite } from "./node-sqlite.js";
import { runtimeDbPath } from "./runtime-storage.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { ensureDir, shortId } from "./utils.js";

type SqlValue = string | number | null;

type SqlExecutor = {
  exec: (sql: string) => void;
  all: (sql: string, values: SqlValue[]) => unknown[];
  get: (sql: string, values: SqlValue[]) => unknown;
  run: (sql: string, values: SqlValue[]) => number;
  close: () => void;
};

type WorkItemRow = {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  status: string;
  assignee: string | null;
  priority: string;
  start_at: number | null;
  due_at: number | null;
  automation_json: string | null;
  automation_enabled: number;
  automation_lease_until: number | null;
  automation_last_run_at: number | null;
  automation_last_session_id: string | null;
  automation_last_error: string | null;
  position: number;
  custom_fields_json: string;
  session_id: string | null;
  execution_json: string | null;
  last_error: string | null;
  run_started_at: number | null;
  run_completed_at: number | null;
  version: number;
  created_at: number;
  updated_at: number;
};

type WorkBoardConfigRow = {
  workspace_id: string;
  columns_json: string;
  fields_json: string;
  version: number;
  updated_at: number;
};

export type WorkItemListInput = {
  workspaceIds: string[];
  from?: number;
  to?: number;
  status?: string;
  cursor?: string;
  limit?: number;
};

export class WorkItemConflictError extends Error {
  constructor(message = "The work item changed before this update was saved") {
    super(message);
    this.name = "WorkItemConflictError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  return typeof field === "string" ? field : "";
}

function readNullableString(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" ? field : null;
}

function readNumber(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  return typeof field === "number" ? field : Number(field);
}

function readNullableNumber(value: Record<string, unknown>, key: string): number | null {
  const field = value[key];
  if (field === null || field === undefined) return null;
  const parsed = typeof field === "number" ? field : Number(field);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeWorkItemRow(value: unknown): WorkItemRow | null {
  if (!isRecord(value)) return null;
  const id = readString(value, "id");
  const workspaceId = readString(value, "workspace_id");
  const title = readString(value, "title");
  if (!id || !workspaceId || !title) return null;
  return {
    id,
    workspace_id: workspaceId,
    title,
    description: readNullableString(value, "description"),
    status: readString(value, "status"),
    assignee: readNullableString(value, "assignee"),
    priority: readString(value, "priority"),
    start_at: readNullableNumber(value, "start_at"),
    due_at: readNullableNumber(value, "due_at"),
    automation_json: readNullableString(value, "automation_json"),
    automation_enabled: readNumber(value, "automation_enabled"),
    automation_lease_until: readNullableNumber(value, "automation_lease_until"),
    automation_last_run_at: readNullableNumber(value, "automation_last_run_at"),
    automation_last_session_id: readNullableString(value, "automation_last_session_id"),
    automation_last_error: readNullableString(value, "automation_last_error"),
    position: readNumber(value, "position"),
    custom_fields_json: readString(value, "custom_fields_json"),
    session_id: readNullableString(value, "session_id"),
    execution_json: readNullableString(value, "execution_json"),
    last_error: readNullableString(value, "last_error"),
    run_started_at: readNullableNumber(value, "run_started_at"),
    run_completed_at: readNullableNumber(value, "run_completed_at"),
    version: readNumber(value, "version"),
    created_at: readNumber(value, "created_at"),
    updated_at: readNumber(value, "updated_at"),
  };
}

function normalizeBoardConfigRow(value: unknown): WorkBoardConfigRow | null {
  if (!isRecord(value)) return null;
  const workspaceId = readString(value, "workspace_id");
  if (!workspaceId) return null;
  return {
    workspace_id: workspaceId,
    columns_json: readString(value, "columns_json"),
    fields_json: readString(value, "fields_json"),
    version: readNumber(value, "version"),
    updated_at: readNumber(value, "updated_at"),
  };
}

function parseCustomFields(json: string): WorkItem["customFields"] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed)) return {};
    const fields: WorkItem["customFields"] = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        fields[key] = value;
      }
    }
    return fields;
  } catch {
    return {};
  }
}

function parseExecution(json: string | null): ProjectSessionExecution | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    const execution = projectSessionExecutionSchema.safeParse(parsed);
    return execution.success ? execution.data : null;
  } catch {
    return null;
  }
}

function parseAutomation(json: string | null): WorkItemAutomation | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    const automation = workItemAutomationSchema.safeParse(parsed);
    return automation.success ? automation.data : null;
  } catch {
    return null;
  }
}

function publicWorkItem(row: WorkItemRow): WorkItem {
  const priority = workItemPrioritySchema.safeParse(row.priority);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    status: row.status,
    assignee: row.assignee,
    priority: priority.success ? priority.data : "normal",
    startAt: row.start_at,
    dueAt: row.due_at,
    automation: parseAutomation(row.automation_json),
    automationLastRunAt: row.automation_last_run_at,
    automationLastSessionId: row.automation_last_session_id,
    automationLastError: row.automation_last_error,
    position: row.position,
    customFields: parseCustomFields(row.custom_fields_json),
    execution: parseExecution(row.execution_json),
    lastError: row.last_error,
    runStartedAt: row.run_started_at,
    runCompletedAt: row.run_completed_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function encodeCursor(item: WorkItem): string {
  return Buffer.from(`${item.updatedAt}:${item.id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): { updatedAt: number; id: string } | null {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = decoded.indexOf(":");
    const updatedAt = Number(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    return Number.isFinite(updatedAt) && id ? { updatedAt, id } : null;
  } catch {
    return null;
  }
}

function createSchema(db: SqlExecutor): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_items (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      assignee TEXT,
      priority TEXT NOT NULL,
      start_at INTEGER,
      due_at INTEGER,
      automation_json TEXT,
      automation_enabled INTEGER NOT NULL DEFAULT 0,
      automation_lease_until INTEGER,
      automation_last_run_at INTEGER,
      automation_last_session_id TEXT,
      automation_last_error TEXT,
      position REAL NOT NULL,
      custom_fields_json TEXT NOT NULL,
      session_id TEXT,
      execution_json TEXT,
      last_error TEXT,
      run_started_at INTEGER,
      run_completed_at INTEGER,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK(length(title) BETWEEN 1 AND 160),
      CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
      CHECK(due_at IS NULL OR start_at IS NULL OR due_at >= start_at)
    );
    CREATE INDEX IF NOT EXISTS work_items_workspace_status_position_idx
      ON work_items(workspace_id, status, position, id);
    CREATE INDEX IF NOT EXISTS work_items_workspace_schedule_idx
      ON work_items(workspace_id, start_at, due_at, id);
    CREATE INDEX IF NOT EXISTS work_items_updated_idx
      ON work_items(updated_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS work_board_configs (
      workspace_id TEXT PRIMARY KEY NOT NULL,
      columns_json TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
  `);

  const columns = new Set(db.all("PRAGMA table_info(work_items)", []).flatMap((value) => {
    if (!isRecord(value)) return [];
    const name = readString(value, "name");
    return name ? [name] : [];
  }));
  const addColumn = (name: string, declaration: string) => {
    if (!columns.has(name)) db.exec(`ALTER TABLE work_items ADD COLUMN ${name} ${declaration}`);
  };
  addColumn("session_id", "TEXT");
  addColumn("execution_json", "TEXT");
  addColumn("last_error", "TEXT");
  addColumn("run_started_at", "INTEGER");
  addColumn("run_completed_at", "INTEGER");
  addColumn("automation_json", "TEXT");
  addColumn("automation_enabled", "INTEGER NOT NULL DEFAULT 0");
  addColumn("automation_lease_until", "INTEGER");
  addColumn("automation_last_run_at", "INTEGER");
  addColumn("automation_last_session_id", "TEXT");
  addColumn("automation_last_error", "TEXT");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS work_items_workspace_session_idx
      ON work_items(workspace_id, session_id)
      WHERE session_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS work_items_automation_due_idx
      ON work_items(automation_enabled, start_at, automation_lease_until, id);
    UPDATE work_items
       SET status = 'ready', version = version + 1,
           updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
     WHERE automation_enabled = 1
       AND automation_json IS NOT NULL
       AND execution_json IS NULL
       AND status = 'planned';
  `);
}

async function openSqlExecutor(path: string): Promise<SqlExecutor> {
  await ensureDir(dirname(path));
  if (typeof process.versions.bun === "string") {
    const { Database } = await import("bun:sqlite");
    const sqlite = new Database(path, { create: true });
    const executor: SqlExecutor = {
      exec: (sql) => sqlite.exec(sql),
      all: (sql, values) => sqlite.query(sql).all(...values),
      get: (sql, values) => sqlite.query(sql).get(...values),
      run: (sql, values) => Number(sqlite.query(sql).run(...values).changes),
      close: () => sqlite.close(),
    };
    createSchema(executor);
    return executor;
  }

  const { DatabaseSync } = await importNodeSqlite();
  const sqlite = new DatabaseSync(path);
  const executor: SqlExecutor = {
    exec: (sql) => sqlite.exec(sql),
    all: (sql, values) => sqlite.prepare(sql).all(...values),
    get: (sql, values) => sqlite.prepare(sql).get(...values),
    run: (sql, values) => Number(sqlite.prepare(sql).run(...values).changes),
    close: () => sqlite.close(),
  };
  createSchema(executor);
  return executor;
}

const dbByPath = new Map<string, Promise<SqlExecutor>>();

async function workItemDb(config: ServerConfig): Promise<SqlExecutor> {
  const path = runtimeDbPath(config);
  const existing = dbByPath.get(path);
  if (existing) return existing;
  const pending = openSqlExecutor(path);
  dbByPath.set(path, pending);
  return pending;
}

export async function disposeWorkItemStore(config: ServerConfig): Promise<void> {
  const path = runtimeDbPath(config);
  const pending = dbByPath.get(path);
  if (!pending) return;
  dbByPath.delete(path);
  const db = await pending;
  db.close();
}

export async function listWorkItems(config: ServerConfig, input: WorkItemListInput): Promise<WorkItemListResponse> {
  const workspaceIds = Array.from(new Set(input.workspaceIds.map((id) => id.trim()).filter(Boolean))).slice(0, 50);
  if (!workspaceIds.length) return { items: [], nextCursor: null };
  const db = await workItemDb(config);
  const conditions = [`workspace_id IN (${workspaceIds.map(() => "?").join(", ")})`];
  const values: SqlValue[] = [...workspaceIds];
  if (input.status) {
    conditions.push("status = ?");
    values.push(input.status);
  }
  if (input.from !== undefined) {
    conditions.push("COALESCE(due_at, start_at) IS NOT NULL AND COALESCE(due_at, start_at) >= ?");
    values.push(input.from);
  }
  if (input.to !== undefined) {
    conditions.push("COALESCE(start_at, due_at) IS NOT NULL AND COALESCE(start_at, due_at) <= ?");
    values.push(input.to);
  }
  const cursor = decodeCursor(input.cursor);
  if (cursor) {
    conditions.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
    values.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  values.push(limit);
  const rows = db.all(
    `SELECT * FROM work_items WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT ?`,
    values,
  ).flatMap((value) => {
    const row = normalizeWorkItemRow(value);
    return row ? [publicWorkItem(row)] : [];
  });
  return {
    items: rows,
    nextCursor: rows.length === limit ? encodeCursor(rows[rows.length - 1]) : null,
  };
}

export async function readWorkItem(config: ServerConfig, workspaceId: string, id: string): Promise<WorkItem | null> {
  const db = await workItemDb(config);
  const row = normalizeWorkItemRow(db.get(
    "SELECT * FROM work_items WHERE workspace_id = ? AND id = ?",
    [workspaceId, id],
  ));
  return row ? publicWorkItem(row) : null;
}

export async function readProjectSessionWorkItem(
  config: ServerConfig,
  workspaceId: string,
  sessionId: string,
): Promise<WorkItem | null> {
  const db = await workItemDb(config);
  const row = normalizeWorkItemRow(db.get(
    "SELECT * FROM work_items WHERE workspace_id = ? AND session_id = ?",
    [workspaceId, sessionId],
  ));
  return row ? publicWorkItem(row) : null;
}

export async function createWorkItem(
  config: ServerConfig,
  workspaceId: string,
  input: WorkItemCreateInput,
): Promise<WorkItem> {
  const parsed = workItemCreateSchema.parse(input);
  const db = await workItemDb(config);
  const now = Date.now();
  const id = `work_${shortId()}`;
  const status = parsed.automation?.enabled ? "ready" : parsed.status;
  const nextPositionRow = db.get(
    "SELECT COALESCE(MAX(position), 0) + 1024 AS position FROM work_items WHERE workspace_id = ? AND status = ?",
    [workspaceId, status],
  );
  const nextPosition = isRecord(nextPositionRow) ? readNumber(nextPositionRow, "position") : 1024;
  const position = parsed.position ?? nextPosition;
  db.run(
    `INSERT INTO work_items (
      id, workspace_id, title, description, status, assignee, priority,
      start_at, due_at, automation_json, automation_enabled,
      position, custom_fields_json, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      workspaceId,
      parsed.title,
      parsed.description ?? null,
      status,
      parsed.assignee ?? null,
      parsed.priority,
      parsed.startAt ?? null,
      parsed.dueAt ?? null,
      parsed.automation ? JSON.stringify(parsed.automation) : null,
      parsed.automation?.enabled ? 1 : 0,
      Number.isFinite(position) ? position : 1024,
      JSON.stringify(parsed.customFields),
      now,
      now,
    ],
  );
  const created = await readWorkItem(config, workspaceId, id);
  if (!created) throw new Error("Created work item could not be read");
  return created;
}

export async function startProjectSessionExecution(
  config: ServerConfig,
  workspaceId: string,
  title: string,
  value: ProjectSessionExecution,
): Promise<WorkItem> {
  const execution = projectSessionExecutionSchema.parse(value);
  const db = await workItemDb(config);
  const now = Date.now();
  const resume = async (): Promise<WorkItem> => {
    db.run(
      `UPDATE work_items SET
        title = ?, status = 'running', assignee = ?, execution_json = ?, last_error = NULL,
        run_started_at = ?, run_completed_at = NULL,
        version = version + 1, updated_at = ?
       WHERE workspace_id = ? AND session_id = ?`,
      [
        title,
        execution.agent.id,
        JSON.stringify(execution),
        now,
        now,
        workspaceId,
        execution.sessionId,
      ],
    );
    const updated = await readProjectSessionWorkItem(config, workspaceId, execution.sessionId);
    if (!updated) throw new Error("Project session work item could not be read");
    return updated;
  };
  const existing = await readProjectSessionWorkItem(config, workspaceId, execution.sessionId);
  if (existing) return resume();

  const id = `work_${shortId()}`;
  const nextPositionRow = db.get(
    "SELECT COALESCE(MAX(position), 0) + 1024 AS position FROM work_items WHERE workspace_id = ? AND status = 'running'",
    [workspaceId],
  );
  const position = isRecord(nextPositionRow) ? readNumber(nextPositionRow, "position") : 1024;
  const changes = db.run(
    `INSERT OR IGNORE INTO work_items (
      id, workspace_id, title, description, status, assignee, priority,
      start_at, due_at, position, custom_fields_json,
      session_id, execution_json, last_error, run_started_at, run_completed_at,
      version, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, 'running', ?, 'normal', NULL, NULL, ?, '{}', ?, ?, NULL, ?, NULL, 1, ?, ?)`,
    [
      id,
      workspaceId,
      title,
      execution.agent.id,
      Number.isFinite(position) ? position : 1024,
      execution.sessionId,
      JSON.stringify(execution),
      now,
      now,
      now,
    ],
  );
  if (changes === 0) {
    const concurrent = await readProjectSessionWorkItem(config, workspaceId, execution.sessionId);
    if (!concurrent) throw new Error("Project session work item could not be read after insert conflict");
    return resume();
  }
  const created = await readWorkItem(config, workspaceId, id);
  if (!created) throw new Error("Project session work item could not be read");
  return created;
}

function resolveProjectExecutionRuntime(input: {
  engineId: string;
  agent: ProjectAgent;
  requested: ProjectSessionExecutionRuntime;
}): ProjectSessionExecutionRuntime {
  const selectedModel = input.requested.model ?? input.agent.runtime.model;
  const mode = input.agent.runtime.mode === "auto" || isHarnessWorkspaceEngineId(input.engineId)
    ? input.requested.mode
    : input.agent.runtime.mode === "plan"
      ? "plan"
      : "build";
  return {
    engineId: input.engineId,
    model: selectedModel,
    mode,
    modelVariant: input.requested.model
      ? input.requested.modelVariant
      : input.agent.runtime.model
        ? input.agent.runtime.modelVariant
        : input.requested.modelVariant,
  };
}

export async function resolveProjectExecutionPlan(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  input: Pick<ProjectSessionExecutionStartInput, "agentId" | "runtime">,
): Promise<Omit<ProjectSessionExecution, "sessionId" | "boundAt">> {
  const projectEngineId = workspace.engineId?.trim() || DEFAULT_ENGINE_ID;
  const stored = await readiPolloWorkWorkspaceConfig(config, workspace.id);
  const configured = projectWorkspaceConfigSchema.safeParse(stored.project);
  const project = configured.success
    ? configured.data
    : createDefaultProjectWorkspaceConfig({ engineId: workspace.engineId });
  const agentId = input.agentId ?? project.orchestration.entryAgentId;
  const agent = project.agents.find((candidate) => candidate.id === agentId);
  if (!agent) throw new ApiError(409, "project_agent_missing", "The selected project Agent no longer exists");

  const agentEngineId = agent.runtime.engineId?.trim() || projectEngineId;
  if (agentEngineId !== projectEngineId || input.runtime.engineId !== projectEngineId) {
    throw new ApiError(
      409,
      "project_agent_engine_mismatch",
      "Project tasks must use the project's engine. Change the project engine before starting a new task.",
    );
  }
  return {
    projectRevision: project.revision,
    projectGoal: project.goal,
    agent,
    runtime: resolveProjectExecutionRuntime({
      engineId: projectEngineId,
      agent,
      requested: input.runtime,
    }),
  };
}

export async function bindProjectSessionExecution(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  input: ProjectSessionExecutionStartInput,
): Promise<WorkItem> {
  const projectEngineId = workspace.engineId?.trim() || DEFAULT_ENGINE_ID;
  const existing = await readProjectSessionWorkItem(config, workspace.id, sessionId);
  if (existing?.execution) {
    if (
      existing.execution.runtime.engineId !== projectEngineId
      || input.runtime.engineId !== existing.execution.runtime.engineId
    ) {
      throw new ApiError(
        409,
        "project_session_engine_changed",
        "This task is bound to its original engine. Start a new conversation to use the project's current engine.",
      );
    }
    return startProjectSessionExecution(config, workspace.id, input.title, {
      ...existing.execution,
      runtime: resolveProjectExecutionRuntime({
        engineId: projectEngineId,
        agent: existing.execution.agent,
        requested: input.runtime,
      }),
      boundAt: Date.now(),
    });
  }

  const plan = await resolveProjectExecutionPlan(config, workspace, input);
  const now = Date.now();
  return startProjectSessionExecution(config, workspace.id, input.title, {
    sessionId,
    ...plan,
    boundAt: now,
  });
}

export async function finishProjectSessionExecution(
  config: ServerConfig,
  workspaceId: string,
  sessionId: string,
  input: ProjectSessionExecutionFinishInput,
): Promise<WorkItem | null> {
  const current = await readProjectSessionWorkItem(config, workspaceId, sessionId);
  if (!current) return null;
  const db = await workItemDb(config);
  const now = Date.now();
  let transactionOpen = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    if (current.status === "running") {
      db.run(
        `UPDATE work_items SET
          title = ?, status = ?, last_error = ?, run_completed_at = ?,
          version = version + 1, updated_at = ?
         WHERE workspace_id = ? AND session_id = ? AND status = 'running'`,
        [
          input.title ?? current.title,
          input.status,
          input.status === "failed" ? input.error ?? "Task failed" : null,
          now,
          now,
          workspaceId,
          sessionId,
        ],
      );
    }
    finishAutomationWorkItemForSession(db, workspaceId, sessionId, input, now);
    db.exec("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) db.exec("ROLLBACK");
    throw error;
  }
  return readProjectSessionWorkItem(config, workspaceId, sessionId);
}

function finishAutomationWorkItemForSession(
  db: SqlExecutor,
  workspaceId: string,
  sessionId: string,
  input: ProjectSessionExecutionFinishInput,
  now: number,
): void {
  const error = input.status === "failed" ? input.error ?? "Task failed" : null;
  db.run(
    `UPDATE work_items SET
      status = ?, automation_last_error = ?,
      version = version + 1, updated_at = ?
     WHERE workspace_id = ?
       AND automation_last_session_id = ?
       AND automation_json IS NOT NULL
       AND execution_json IS NULL
       AND status = 'running'`,
    [input.status === "done" ? "review" : "failed", error, now, workspaceId, sessionId],
  );
}

export async function updateWorkItem(
  config: ServerConfig,
  workspaceId: string,
  id: string,
  input: WorkItemUpdateInput,
): Promise<WorkItem | null> {
  const current = await readWorkItem(config, workspaceId, id);
  if (!current) return null;
  if (current.version !== input.expectedVersion) throw new WorkItemConflictError();
  if (current.execution && (
    (input.status !== undefined && input.status !== current.status)
    || (input.assignee !== undefined && input.assignee !== current.assignee)
    || input.automation !== undefined
  )) {
    throw new WorkItemConflictError("Execution-bound task status, Agent, and automation are controlled by the runtime");
  }
  const next = workItemCreateSchema.parse({
    title: input.title ?? current.title,
    description: input.description === undefined ? current.description : input.description,
    status: input.status ?? current.status,
    assignee: input.assignee === undefined ? current.assignee : input.assignee,
    priority: input.priority ?? current.priority,
    startAt: input.startAt === undefined ? current.startAt : input.startAt,
    dueAt: input.dueAt === undefined ? current.dueAt : input.dueAt,
    automation: input.automation === undefined ? current.automation : input.automation,
    position: input.position ?? current.position,
    customFields: input.customFields ?? current.customFields,
  });
  const wasAutomationEnabled = current.automation?.enabled === true;
  const willAutomationBeEnabled = next.automation?.enabled === true;
  const status = !wasAutomationEnabled && willAutomationBeEnabled
    ? "ready"
    : wasAutomationEnabled
        && !willAutomationBeEnabled
        && current.status === "ready"
        && input.status === undefined
      ? "planned"
      : next.status;
  const db = await workItemDb(config);
  const changes = db.run(
    `UPDATE work_items SET
      title = ?, description = ?, status = ?, assignee = ?, priority = ?,
      start_at = ?, due_at = ?, automation_json = ?, automation_enabled = ?,
      position = ?, custom_fields_json = ?,
      version = version + 1, updated_at = ?
    WHERE workspace_id = ? AND id = ? AND version = ?`,
    [
      next.title,
      next.description ?? null,
      status,
      next.assignee ?? null,
      next.priority,
      next.startAt ?? null,
      next.dueAt ?? null,
      next.automation ? JSON.stringify(next.automation) : null,
      next.automation?.enabled ? 1 : 0,
      next.position ?? current.position,
      JSON.stringify(next.customFields),
      Date.now(),
      workspaceId,
      id,
      input.expectedVersion,
    ],
  );
  if (changes !== 1) throw new WorkItemConflictError();
  return readWorkItem(config, workspaceId, id);
}

export async function deleteWorkItem(
  config: ServerConfig,
  workspaceId: string,
  id: string,
  expectedVersion: number,
): Promise<boolean> {
  const db = await workItemDb(config);
  const changes = db.run(
    "DELETE FROM work_items WHERE workspace_id = ? AND id = ? AND version = ?",
    [workspaceId, id, expectedVersion],
  );
  if (changes === 1) return true;
  if (await readWorkItem(config, workspaceId, id)) throw new WorkItemConflictError();
  return false;
}

type ClaimedWorkItemAutomation = {
  item: WorkItem;
  scheduledAt: number;
  leaseUntil: number;
};

export type WorkItemAutomationDispatcher = (item: WorkItem) => Promise<string>;

async function claimDueWorkItemAutomation(
  config: ServerConfig,
  now: number,
  leaseMs: number,
): Promise<ClaimedWorkItemAutomation | null> {
  const db = await workItemDb(config);
  let transactionOpen = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    const row = normalizeWorkItemRow(db.get(
      `SELECT * FROM work_items
       WHERE automation_enabled = 1
         AND automation_json IS NOT NULL
         AND execution_json IS NULL
         AND start_at IS NOT NULL
         AND start_at <= ?
         AND (automation_lease_until IS NULL OR automation_lease_until <= ?)
       ORDER BY start_at ASC, id ASC
       LIMIT 1`,
      [now, now],
    ));
    if (!row) {
      db.exec("COMMIT");
      transactionOpen = false;
      return null;
    }
    const leaseUntil = now + leaseMs;
    const changes = db.run(
      `UPDATE work_items SET
        status = 'running', automation_lease_until = ?, automation_last_error = NULL,
        version = version + 1, updated_at = ?
       WHERE id = ?
         AND automation_enabled = 1
         AND (automation_lease_until IS NULL OR automation_lease_until <= ?)`,
      [leaseUntil, now, row.id, now],
    );
    if (changes !== 1) {
      db.exec("ROLLBACK");
      transactionOpen = false;
      return null;
    }
    const claimedRow = normalizeWorkItemRow(db.get("SELECT * FROM work_items WHERE id = ?", [row.id]));
    db.exec("COMMIT");
    transactionOpen = false;
    if (!claimedRow || claimedRow.start_at === null) return null;
    return { item: publicWorkItem(claimedRow), scheduledAt: claimedRow.start_at, leaseUntil };
  } catch (error) {
    if (transactionOpen) db.exec("ROLLBACK");
    throw error;
  }
}

function nextAutomationStartAt(
  automation: WorkItemAutomation,
  scheduledAt: number,
  now: number,
): number | null {
  if (automation.recurrence === "once") return null;
  const interval = automation.recurrence === "daily" ? 86_400_000 : 604_800_000;
  const occurrences = Math.max(1, Math.floor((now - scheduledAt) / interval) + 1);
  return scheduledAt + occurrences * interval;
}

async function completeWorkItemAutomation(
  config: ServerConfig,
  claimed: ClaimedWorkItemAutomation,
  sessionId: string,
  now: number,
): Promise<void> {
  const automation = claimed.item.automation;
  if (!automation) return;
  const nextStartAt = nextAutomationStartAt(automation, claimed.scheduledAt, now);
  const nextEnabled = nextStartAt !== null;
  const duration = claimed.item.dueAt === null
    ? null
    : Math.max(0, claimed.item.dueAt - claimed.scheduledAt);
  const nextDueAt = nextStartAt === null || duration === null ? claimed.item.dueAt : nextStartAt + duration;
  const db = await workItemDb(config);
  const changes = db.run(
    `UPDATE work_items SET
      automation_json = ?, automation_enabled = ?, automation_lease_until = NULL,
      automation_last_run_at = ?, automation_last_session_id = ?, automation_last_error = NULL,
      start_at = ?, due_at = ?, version = version + 1, updated_at = ?
     WHERE id = ? AND automation_lease_until = ?
       AND automation_json = ? AND start_at = ?`,
    [
      JSON.stringify({ ...automation, enabled: nextEnabled }),
      nextEnabled ? 1 : 0,
      now,
      sessionId,
      nextStartAt ?? claimed.item.startAt,
      nextDueAt,
      now,
      claimed.item.id,
      claimed.leaseUntil,
      JSON.stringify(automation),
      claimed.scheduledAt,
    ],
  );
  if (changes === 0) {
    db.run(
      `UPDATE work_items SET
        automation_lease_until = NULL, automation_last_run_at = ?,
        automation_last_session_id = ?, automation_last_error = NULL,
        version = version + 1, updated_at = ?
       WHERE id = ? AND automation_lease_until = ?`,
      [now, sessionId, now, claimed.item.id, claimed.leaseUntil],
    );
  }
  const executionRow = normalizeWorkItemRow(db.get(
    "SELECT * FROM work_items WHERE workspace_id = ? AND session_id = ?",
    [claimed.item.workspaceId, sessionId],
  ));
  if (executionRow?.status === "done" || executionRow?.status === "failed") {
    finishAutomationWorkItemForSession(db, claimed.item.workspaceId, sessionId, {
      status: executionRow.status,
      ...(executionRow.last_error ? { error: executionRow.last_error } : {}),
    }, now);
  }
}

async function failWorkItemAutomation(
  config: ServerConfig,
  claimed: ClaimedWorkItemAutomation,
  error: unknown,
  now: number,
  retryMs: number,
): Promise<void> {
  const message = error instanceof Error ? error.message : "Automatic execution failed";
  const db = await workItemDb(config);
  db.run(
    `UPDATE work_items SET
      status = 'failed', automation_lease_until = ?, automation_last_error = ?,
      version = version + 1, updated_at = ?
     WHERE id = ? AND automation_lease_until = ?`,
    [now + retryMs, message.slice(0, 2_000), now, claimed.item.id, claimed.leaseUntil],
  );
}

export async function runDueWorkItemAutomationsOnce(input: {
  config: ServerConfig;
  dispatch: WorkItemAutomationDispatcher;
  now?: number;
  limit?: number;
  leaseMs?: number;
  retryMs?: number;
}): Promise<number> {
  const now = input.now ?? Date.now();
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
  const leaseMs = Math.max(input.leaseMs ?? 60_000, 5_000);
  const retryMs = Math.max(input.retryMs ?? 300_000, 5_000);
  let attempted = 0;
  while (attempted < limit) {
    const claimed = await claimDueWorkItemAutomation(input.config, now, leaseMs);
    if (!claimed) break;
    attempted += 1;
    try {
      const sessionId = await input.dispatch(claimed.item);
      await completeWorkItemAutomation(input.config, claimed, sessionId, now);
    } catch (error) {
      await failWorkItemAutomation(input.config, claimed, error, now, retryMs);
    }
  }
  return attempted;
}

export function startWorkItemAutomationScheduler(input: {
  config: ServerConfig;
  dispatch: WorkItemAutomationDispatcher;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}): { close: () => Promise<void> } {
  const intervalMs = Math.max(input.intervalMs ?? 15_000, 1_000);
  let active: Promise<void> | null = null;
  let closed = false;
  const tick = () => {
    if (closed || active) return;
    active = runDueWorkItemAutomationsOnce({ config: input.config, dispatch: input.dispatch })
      .then(() => undefined)
      .catch((error) => input.onError?.(error))
      .finally(() => {
        active = null;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return {
    close: async () => {
      closed = true;
      clearInterval(timer);
      await active;
    },
  };
}

export async function readWorkBoardConfig(config: ServerConfig, workspaceId: string): Promise<WorkBoardConfig> {
  const db = await workItemDb(config);
  const row = normalizeBoardConfigRow(db.get(
    "SELECT * FROM work_board_configs WHERE workspace_id = ?",
    [workspaceId],
  ));
  if (!row) {
    return {
      workspaceId,
      columns: DEFAULT_WORK_BOARD_CONFIG.columns,
      fields: DEFAULT_WORK_BOARD_CONFIG.fields,
      version: 0,
      updatedAt: null,
    };
  }
  try {
    const value = workBoardConfigValueSchema.parse({
      columns: JSON.parse(row.columns_json),
      fields: JSON.parse(row.fields_json),
    });
    return { workspaceId, ...value, version: row.version, updatedAt: row.updated_at };
  } catch {
    return {
      workspaceId,
      columns: DEFAULT_WORK_BOARD_CONFIG.columns,
      fields: DEFAULT_WORK_BOARD_CONFIG.fields,
      version: row.version,
      updatedAt: row.updated_at,
    };
  }
}

export async function writeWorkBoardConfig(
  config: ServerConfig,
  workspaceId: string,
  value: WorkBoardConfigValue,
  expectedVersion: number,
): Promise<WorkBoardConfig> {
  const parsed = workBoardConfigValueSchema.parse(value);
  const current = await readWorkBoardConfig(config, workspaceId);
  if (current.version !== expectedVersion) throw new WorkItemConflictError("The board configuration changed before this update was saved");
  const db = await workItemDb(config);
  const now = Date.now();
  if (current.version === 0) {
    const changes = db.run(
      `INSERT OR IGNORE INTO work_board_configs (
        workspace_id, columns_json, fields_json, version, updated_at
      ) VALUES (?, ?, ?, 1, ?)`,
      [workspaceId, JSON.stringify(parsed.columns), JSON.stringify(parsed.fields), now],
    );
    if (changes !== 1) throw new WorkItemConflictError("The board configuration changed before this update was saved");
  } else {
    const changes = db.run(
      `UPDATE work_board_configs SET columns_json = ?, fields_json = ?, version = version + 1, updated_at = ?
       WHERE workspace_id = ? AND version = ?`,
      [JSON.stringify(parsed.columns), JSON.stringify(parsed.fields), now, workspaceId, expectedVersion],
    );
    if (changes !== 1) throw new WorkItemConflictError("The board configuration changed before this update was saved");
  }
  return readWorkBoardConfig(config, workspaceId);
}

export async function deleteWorkspaceWorkState(config: ServerConfig, workspaceId: string): Promise<void> {
  const db = await workItemDb(config);
  db.run("DELETE FROM work_items WHERE workspace_id = ?", [workspaceId]);
  db.run("DELETE FROM work_board_configs WHERE workspace_id = ?", [workspaceId]);
}
