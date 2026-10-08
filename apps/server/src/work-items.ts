import { dirname } from "node:path";
import {
  DEFAULT_WORK_BOARD_CONFIG,
  WORK_ITEM_TITLE_MAX_LENGTH,
  nativeWorkAgentType,
  conversationWorkflowSchema,
  conversationWorkflowUpdateSchema,
  workTemplateSaveSchema,
  workTemplateSchema,
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
  type ConversationWorkflow,
  type ConversationWorkflowUpdateInput,
  type WorkTemplate,
  type WorkTemplateListResponse,
  type WorkTemplateSaveInput,
} from "@ipollowork/types/work-items";
import {
  createDefaultProjectWorkspaceConfig,
  projectWorkspaceConfigSchema,
  type ProjectAgent,
} from "@ipollowork/types/project-workspace";
import { isHarnessWorkspaceEngineId } from "@ipollowork/types/workspace";

import { ApiError } from "./errors.js";
import { readiPolloWorkWorkspaceConfig, writeiPolloWorkWorkspaceConfig } from "./ipollowork-workspace-config-store.js";
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
  sessionId?: string;
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
  if (input.sessionId) {
    conditions.push("(session_id = ? OR automation_last_session_id = ? OR json_extract(custom_fields_json, '$.conversationId') = ?)");
    values.push(input.sessionId, input.sessionId, input.sessionId);
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

const builtinWorkTemplates: WorkTemplate[] = [
  { id: "general", name: "自由对话", description: "直接开始，随需求形成工作方式", workKind: "general", stages: [], acceptance: ["回答或交付物解决用户明确提出的问题"] },
  { id: "video", name: "视频制作", description: "从创意、素材到可播放的成片", workKind: "video", stages: [
    { id: "plan", title: "策划与分镜", instructions: "在当前已准备的视频项目中读取需求与已有素材，使用 ipollowork-video-storyboard 保存原生 STORYBOARD.md；交接准确路径、场景、暂定时长、素材与声音需求。仅分镜或要求先审稿时在这里停止。", acceptance: ["保存的原生分镜覆盖需求、素材与声音决策，暂定时长不冒充实测时长"] },
    { id: "produce", title: "素材与制作", instructions: "参考已批准分镜制作素材、画面与动效；需要声音时加载相应 Skill，使用真实音频和时长完成时间线。", acceptance: ["实际素材与所需音频接入同一可编辑项目", "保留设计变量、编辑钩子与实测时间绑定"] },
    { id: "verify", title: "播放与检查", instructions: "参考 video-acceptance.md，用现有工具检查真实文件和播放；发现问题由原生 Agent 返修，按用户要求交付成片或源文件。", acceptance: ["问题关联具体场景、时间与证据", "没有观测到的画面、声音、导出和独立检查不标记通过"] },
  ], acceptance: ["交付可播放成片及需要的可编辑源文件", "验证实际画面和音频"] },
  { id: "design", name: "设计", description: "探索方向，制作并检查设计成果", workKind: "design", stages: [
    { id: "brief", title: "明确方向", instructions: "理解受众、应用场景、视觉约束和现有品牌资料。", acceptance: ["方向与交付范围明确"] },
    { id: "create", title: "设计制作", instructions: "复用现有设计系统，制作用户需要的设计成果。", acceptance: ["产出可查看的实际设计"] },
    { id: "verify", title: "检查与交付", instructions: "检查视觉、内容、尺寸及可用性并交付。", acceptance: ["成果满足实际使用场景"] },
  ], acceptance: ["交付实际设计及所需导出文件", "检查实际展示效果"] },
  { id: "development", name: "开发", description: "理解问题，实施并验证运行行为", workKind: "development", stages: [
    { id: "inspect", title: "理解问题", instructions: "读取实际代码与约定，定位现有实现并确定最小改动。", acceptance: ["实现基于真实代码与需求"] },
    { id: "build", title: "实现", instructions: "复用已有模块，完成范围内的实现。", acceptance: ["改动连通实际运行路径"] },
    { id: "verify", title: "验证", instructions: "执行相关检查并验证真实使用流程。", acceptance: ["相关检查及用户流程得到验证"] },
  ], acceptance: ["实现解决目标问题", "记录验证结果与未验证边界"] },
  { id: "research", name: "研究分析", description: "收集证据，形成有依据的判断", workKind: "research", stages: [
    { id: "scope", title: "明确问题", instructions: "确定待回答的问题、范围和需要的证据。", acceptance: ["研究范围明确"] },
    { id: "evidence", title: "研究与分析", instructions: "查阅可信来源，区分事实、推断及不确定性。", acceptance: ["结论有可追溯来源"] },
    { id: "deliver", title: "形成结论", instructions: "回答原问题，说明决策依据与关键局限。", acceptance: ["结论对用户决策有用"] },
  ], acceptance: ["结论可追溯到证据", "区分已验证事实与推断"] },
  { id: "document", name: "文档创作", description: "整理材料，撰写可复用的成稿", workKind: "document", stages: [
    { id: "outline", title: "材料与结构", instructions: "确定读者、用途和材料，组织清晰结构。", acceptance: ["结构覆盖交付要求"] },
    { id: "write", title: "撰写", instructions: "撰写完整、可复用的文档，保留必要来源。", acceptance: ["文档内容完整"] },
    { id: "review", title: "审阅与交付", instructions: "检查事实、表达和格式，交付可使用的成稿。", acceptance: ["成稿符合读者与使用场景"] },
  ], acceptance: ["交付完整成稿", "事实、内容与格式得到检查"] },
].map((definition) => {
  const config = createDefaultProjectWorkspaceConfig({ agentName: definition.name === "自由对话" ? "工作助手" : definition.name, agentRole: "负责本次对话的目标、协作、产出与检查" });
  const coordinator = config.agents[0];
  coordinator.prompt = "明确本次目标与交付范围，按任务需要使用原生工具、计划和子 Agent。预设角色按需调用，也可使用临时分工或自行完成。收集子 Agent 的真实结果，整合、检查后向用户交付。";
  // Specialists are reusable jobs, not a worker for every workflow step.
  const specialists: Record<string, Array<{ id: string; name: string; role: string; prompt: string; skills?: string[] }>> = {
    video: [
      { id: "plan", name: "脚本与分镜", role: "需要新建或修改脚本、内容顺序、场景与素材声音计划时调用", skills: ["ipollowork-video-storyboard"],
        prompt: "使用 ipollowork-video-storyboard。读取已批准需求、资料及当前分镜，保存同一视频项目的原生 STORYBOARD.md。保留必需事实、用户修改与明确约束；按内容安排场景，不强设场景数量。时长标明暂定或实测。仅脚本任务不生成素材、不修改合成、不渲染。交回准确路径、修改的场景及待确认输入。" },
      { id: "produce", name: "画面与合成", role: "需要制作或修改视觉素材、组件动效及可编辑时间线时调用", skills: ["ipollowork-video-compose", "ipollowork-video-voiceover", "ipollowork-video-soundtrack"],
        prompt: "使用 ipollowork-video-compose，延续已批准分镜和当前项目。读取所选组件的真实实现，保留设计变量、编辑钩子与统一时间线；现有音频不要求重新合成，仅新需求加载旁白或配乐 Skill，并以实测时长绑定画面。遵守本次分派的文件范围，使用现有工具检查和修复。交回可编辑源文件、素材和检查证据；由原生主 Agent 整合、渲染和交付。" },
      { id: "verify", name: "成片审查", role: "需要独立核对当前产物的内容、动效、音画与导出结果时调用", skills: ["ipollowork-video-studio"],
        prompt: "只审查主 Agent 指定的当前视频产物，按适用范围读取 video-acceptance.md。使用现有工具获取证据，检查真实文件、时间线、场景采样和普通速度播放；需要声音或导出时核对真实混音及导出文件。技术检查与实际表达分别报告；未观看、未听到或无证据的项目保持未验证。交回具体场景、时间、问题与证据，不以制作者结论代替独立判断。" },
    ],
    design: [
      { id: "create", name: "设计制作", role: "需要把已明确的方向制作成实际设计或局部修改时调用",
        prompt: "读取用户目标、品牌资料、现有设计系统及指定文件，制作任务范围内的实际设计。复用可编辑组件、样式与资源；视觉取舍服务受众和使用场景。交回成果路径、预览及必要决策，不擅自扩大交付范围。" },
      { id: "verify", name: "设计审查", role: "需要独立检查实际展示、可读性及使用体验时调用",
        prompt: "查看实际设计和目标使用场景，审查信息层级、内容、排版、尺寸、交互与可访问性。只读审查，不直接修改制作者文件。每个问题附具体位置和可观察证据，区分必须修复、建议及尚未验证。" },
    ],
    development: [
      { id: "inspect", name: "代码调查", role: "需要定位陌生代码、运行链路或故障原因时调用",
        prompt: "读取仓库约定、实际入口和相关代码，沿调用链定位问题。以只读调查为主，不实施无关修改。交回准确文件位置、证据、根因或待验证假设，以及最小实现建议。原生 explorer 足够时无需额外调用此角色。" },
      { id: "verify", name: "代码审查", role: "需要独立审查实现、回归风险及测试覆盖时调用",
        prompt: "审查指定改动及真实调用路径，优先发现行为错误、边界条件、数据或安全风险。必要时运行相关检查；不改写作者实现。交回可复现问题、准确代码位置及检查结果，区分确认缺陷与待验证风险。" },
    ],
    research: [
      { id: "evidence", name: "来源研究", role: "需要围绕明确问题收集和整理可信来源时调用",
        prompt: "围绕主 Agent 指定的问题和范围查阅原始或权威来源。核对时间、对象和证据适用范围；保留可追溯链接及必要数据。交回有依据的发现、来源和缺口，不用缺失证据填补结论。" },
      { id: "deliver", name: "证据审查", role: "需要核对研究结论、来源支持及推理漏洞时调用",
        prompt: "独立核对指定结论及其来源，区分事实、推断与不确定性。检查反例、遗漏前提、过期资料和不支持结论的引用。交回需要修正的具体论点、证据与局限，避免重新扩展整个研究范围。" },
    ],
    document: [
      { id: "write", name: "文稿撰写", role: "需要基于明确读者、材料和结构完成指定文稿时调用",
        prompt: "读取已确认的读者、用途、材料及结构，完成分派范围内的可使用文稿。保留必要来源与限定，表达清楚、信息完整。交回实际稿件或文件及待确认内容；多人撰写时遵守指定章节和文件边界。" },
      { id: "review", name: "文稿审阅", role: "需要独立检查文稿事实、逻辑、表达和格式时调用",
        prompt: "基于实际稿件和用途审查事实、来源、论证、术语与格式。默认提出具体修改建议，不同时改写作者文件。交回关键问题、对应段落与修改建议，区分事实修正和表达偏好。" },
    ],
  };
  config.agents.push(...(specialists[definition.id] ?? []).map((role) => ({
    ...coordinator, id: role.id, name: role.name, avatarSeed: `${definition.id}-${role.id}`,
    role: role.role, prompt: role.prompt,
    skillIds: (role.skills ?? []).map((skill) => `video-agent:${skill}`),
    pluginIds: role.skills ? ["video-agent"] : [],
  })));
  if (definition.id === "video") {
    coordinator.role = "统筹视频目标、原生分工与当前项目的实际交付";
    coordinator.skillIds = ["video-agent:ipollowork-video-studio"];
    coordinator.pluginIds = ["video-agent"];
    coordinator.prompt += " 按需加载 ipollowork-video-studio，沿用现有视频制作工具和项目。仅讨论、脚本或局部修改时遵守该范围；负责收回实际文件，完成所需检查、渲染与交付。";
    config.orchestration.relations = [
      { sourceAgentId: "plan", targetAgentId: "produce", type: "dependency", label: "分镜输入" },
      { sourceAgentId: "produce", targetAgentId: "verify", type: "dependency", label: "当前产物" },
    ];
  }
  return workTemplateSchema.parse({
    ...definition, version: definition.id === "video" ? 6 : 2, origin: "builtin", config,
    stages: definition.stages.map((stage) => ({ ...stage, agentId: config.agents.some((agent) => agent.id === stage.id) ? stage.id : coordinator.id })),
  });
});

function savedWorkTemplates(stored: Record<string, unknown>): WorkTemplate[] {
  if (!Array.isArray(stored.workTemplates)) return [];
  return stored.workTemplates.slice(0, 100).flatMap((value) => {
    const parsed = workTemplateSchema.safeParse(value);
    return parsed.success && parsed.data.origin === "saved" ? [parsed.data] : [];
  });
}

// Templates are a reusable library; projects only own the shared execution background.
const WORK_TEMPLATE_LIBRARY_SCOPE = "__work_template_library__";

/** Built-in native roles are stable; saved/edited roles travel with their conversation's task. */
export function nativeWorkTemplateAgents(): Array<{ name: string; description: string; prompt: string }> {
  return builtinWorkTemplates.flatMap((template) =>
    template.config.agents.filter((agent) => agent.id !== template.config.orchestration.entryAgentId).map((agent) => ({
      name: nativeWorkAgentType(template.id, agent.id),
      description: `${template.name}: ${agent.name}. ${agent.role}`,
      prompt: [
        `You are ${agent.name}. [project-agent:${agent.id}]`,
        agent.prompt,
        agent.skillIds.length ? `Available Skills: ${agent.skillIds.map((id) => id.split(":").at(-1)).join(", ")}. Load only the Skills needed for the assigned task using the native Skill loader.` : null,
        "Follow the parent's task scope and exact project paths. Return actual deliverables, evidence and unfinished work to the native parent Agent.",
      ].filter(Boolean).join("\n\n"),
    })),
  );
}

async function projectWorkContext(config: ServerConfig, workspace: WorkspaceInfo) {
  const [stored, library] = await Promise.all([
    readiPolloWorkWorkspaceConfig(config, workspace.id),
    readiPolloWorkWorkspaceConfig(config, WORK_TEMPLATE_LIBRARY_SCOPE),
  ]);
  const parsed = projectWorkspaceConfigSchema.safeParse(stored.project);
  const project = parsed.success ? parsed.data : createDefaultProjectWorkspaceConfig();
  return { project, templates: [...builtinWorkTemplates, ...savedWorkTemplates(library)] };
}

export async function listWorkTemplates(config: ServerConfig, workspace: WorkspaceInfo): Promise<WorkTemplateListResponse> {
  const { templates } = await projectWorkContext(config, workspace);
  const db = await workItemDb(config);
  const groupedStats = (field: "templateId" | "workKind", limit: number) => db.all(`SELECT
    COALESCE(json_extract(execution_json, '$.workflow.${field}'), 'general') AS group_id,
    COUNT(*) AS runs,
    SUM(CASE WHEN status = 'done' AND json_extract(custom_fields_json, '$.reviewedAt') IS NOT NULL THEN 1 ELSE 0 END) AS completions
    FROM work_items WHERE execution_json IS NOT NULL AND run_started_at IS NOT NULL
    GROUP BY group_id LIMIT ?`, [limit]).flatMap((row) => isRecord(row) ? [{
      id: readString(row, "group_id"), runs: readNumber(row, "runs"), reviewedCompletions: readNumber(row, "completions"),
    }] : []);
  return { templates, stats: {
    byTemplate: groupedStats("templateId", 200).map(({ id, ...stats }) => ({ templateId: id, ...stats })),
    byWorkKind: groupedStats("workKind", 6).flatMap(({ id, ...stats }) => {
      const kind = conversationWorkflowSchema.shape.workKind.safeParse(id);
      return kind.success ? [{ workKind: kind.data, ...stats }] : [];
    }),
  } };
}

function workflowFromTemplate(template: WorkTemplate, input: { source: ConversationWorkflow["source"]; goal?: string }): ConversationWorkflow {
  return conversationWorkflowSchema.parse({
    templateId: template.id, templateVersion: template.version, templateName: template.name,
    source: input.source, workKind: template.workKind, goal: input.goal ?? "",
    config: template.config, stages: template.stages, acceptance: template.acceptance, updatedAt: Date.now(),
  });
}

export async function writeConversationWorkflow(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  value: ConversationWorkflowUpdateInput,
  options: { allowRunning?: boolean } = {},
): Promise<WorkItem> {
  const input = conversationWorkflowUpdateSchema.parse(value);
  const current = await readProjectSessionWorkItem(config, workspace.id, sessionId);
  if (current?.status === "running" && !options.allowRunning) throw new WorkItemConflictError("Finish the current run before changing its work settings");
  if (options.allowRunning && input.expectedVersion === undefined) throw new WorkItemConflictError("A runtime workflow update requires the current work item version");
  if (input.expectedVersion !== undefined && input.expectedVersion !== (current?.version ?? 0)) throw new WorkItemConflictError();
  if (current?.execution && current.execution.runtime.engineId !== input.runtime.engineId) {
    throw new ApiError(409, "project_session_engine_changed", "This conversation keeps its original execution engine");
  }
  if (options.allowRunning && current?.execution && JSON.stringify(current.execution.runtime) !== JSON.stringify(input.runtime)) {
    throw new WorkItemConflictError("Runtime refinement cannot change the conversation's execution settings");
  }
  const currentWorkflow = current?.execution?.workflow;
  if (options.allowRunning && currentWorkflow && currentWorkflow.source !== "auto" && input.source === "auto"
    && input.templateId && input.templateId !== currentWorkflow.templateId) {
    throw new WorkItemConflictError("Keep the selected work template when automatically refining this conversation");
  }
  const { project, templates } = await projectWorkContext(config, workspace);
  const selected = templates.find((template) => template.id === (input.templateId ?? "general"));
  if (!selected) throw new ApiError(404, "work_template_not_found", "The selected work template was not found");
  const base = !input.templateId && current?.execution?.workflow
    ? current.execution.workflow
    : workflowFromTemplate(selected, { source: input.source });
  const selectedSource = input.config !== undefined || (!input.templateId && base.source === "custom")
    || (input.templateId && selected.origin === "saved") ? "custom" : input.source;
  const source = options.allowRunning && currentWorkflow && (
    (input.source === "auto" && currentWorkflow.source !== "auto")
    || (currentWorkflow.source === "manual" && (!input.templateId || input.templateId === currentWorkflow.templateId))
  ) && input.config === undefined ? currentWorkflow.source : selectedSource;
  const previousProgress = currentWorkflow?.progress ?? base.progress;
  const progress = input.progress === undefined ? previousProgress : {
    summary: input.progress.summary ?? previousProgress?.summary ?? "",
    decisions: input.progress.decisions ?? previousProgress?.decisions ?? [],
    outputs: input.progress.outputs ?? previousProgress?.outputs ?? [],
    blockers: input.progress.blockers ?? previousProgress?.blockers ?? [],
  };
  const workflow = conversationWorkflowSchema.parse({
    ...base, source,
    goal: input.goal ?? currentWorkflow?.goal ?? base.goal,
    workKind: input.workKind ?? base.workKind, config: input.config ? {
      ...input.config, agents: input.config.agents.map((agent) => ({
        ...agent, runtime: { engineId: null, model: null, mode: "auto", modelVariant: null },
      })),
    } : base.config,
    stages: input.stages ?? base.stages, acceptance: input.acceptance ?? base.acceptance, updatedAt: Date.now(),
    progress,
  });
  const agent = workflow.config.agents.find((candidate) => candidate.id === workflow.config.orchestration.entryAgentId);
  if (!agent) throw new ApiError(409, "conversation_agent_missing", "The conversation entry Agent is missing");
  return writeSessionExecution(config, workspace.id, input.title ?? current?.title ?? "新工作", {
    sessionId, projectRevision: current?.execution?.projectRevision ?? project.revision,
    projectGoal: current?.execution?.projectGoal ?? project.goal,
    agent, runtime: input.runtime, boundAt: current?.execution?.boundAt ?? Date.now(), workflow,
  }, current?.status ?? "ready", current?.version ?? 0);
}

export async function saveWorkTemplate(config: ServerConfig, workspace: WorkspaceInfo, value: WorkTemplateSaveInput): Promise<WorkTemplate> {
  const input = workTemplateSaveSchema.parse(value);
  const item = await readProjectSessionWorkItem(config, workspace.id, input.sessionId);
  const workflow = item?.execution?.workflow;
  if (!workflow) throw new ApiError(404, "conversation_workflow_not_found", "Set up conversation work before saving a template");
  let saved: WorkTemplate | undefined;
  await writeiPolloWorkWorkspaceConfig(config, WORK_TEMPLATE_LIBRARY_SCOPE, (stored) => {
    const templates = savedWorkTemplates(stored);
    const current = input.templateId ? templates.find((template) => template.id === input.templateId) : undefined;
    if (input.templateId && !current) throw new ApiError(404, "work_template_not_found", "The saved template was not found");
    if (input.expectedVersion !== undefined && input.expectedVersion !== (current?.version ?? 0)) throw new WorkItemConflictError("The work template changed before this update was saved");
    if (!current && templates.length >= 100) throw new ApiError(409, "work_template_limit", "At most 100 saved work templates are allowed in the library");
    saved = workTemplateSchema.parse({
      id: current?.id ?? `template_${shortId()}`, version: (current?.version ?? 0) + 1,
      name: input.name, description: input.description ?? current?.description ?? "",
      origin: "saved", workKind: workflow.workKind, config: workflow.config,
      stages: workflow.stages, acceptance: workflow.acceptance,
    });
    return { ...stored, workTemplates: [...templates.filter((template) => template.id !== saved?.id), saved] };
  });
  if (!saved) throw new Error("Saved work template could not be read");
  return saved;
}

export async function resolveSessionWorkspace(config: ServerConfig, workspace: WorkspaceInfo, sessionId: string): Promise<WorkspaceInfo> {
  const item = await readProjectSessionWorkItem(config, workspace.id, sessionId);
  return item?.execution ? { ...workspace, engineId: item.execution.runtime.engineId } : workspace;
}

export async function listConversationSessionBindings(config: ServerConfig, workspaceId: string): Promise<Array<{ sessionId: string; title: string; status: string; engineId: string; createdAt: number; updatedAt: number }>> {
  const db = await workItemDb(config);
  return db.all("SELECT session_id, title, status, execution_json, created_at, updated_at FROM work_items WHERE workspace_id = ? AND session_id IS NOT NULL AND execution_json IS NOT NULL ORDER BY updated_at DESC, id DESC LIMIT 500", [workspaceId]).flatMap((row) => {
    if (!isRecord(row)) return [];
    const execution = parseExecution(readNullableString(row, "execution_json"));
    return execution ? [{ sessionId: execution.sessionId, title: readString(row, "title"), status: readString(row, "status"), engineId: execution.runtime.engineId, createdAt: readNumber(row, "created_at"), updatedAt: readNumber(row, "updated_at") }] : [];
  });
}

export async function listBoundSessionEngines(config: ServerConfig, workspaceId: string): Promise<string[]> {
  const db = await workItemDb(config);
  return db.all("SELECT DISTINCT json_extract(execution_json, '$.runtime.engineId') AS engine_id FROM work_items WHERE workspace_id = ? AND execution_json IS NOT NULL ORDER BY engine_id LIMIT 32", [workspaceId])
    .flatMap((row) => isRecord(row) && typeof row.engine_id === "string" && row.engine_id ? [row.engine_id] : []);
}

export async function bindConversationSession(config: ServerConfig, workspace: WorkspaceInfo, sessionId: string, input: { title: string; engineId: string; parentSessionId?: string }): Promise<WorkItem> {
  const current = await readProjectSessionWorkItem(config, workspace.id, sessionId);
  if (current) return current;
  const title = input.title.trim().slice(0, WORK_ITEM_TITLE_MAX_LENGTH) || "新对话";
  if (input.parentSessionId) {
    const parent = await readProjectSessionWorkItem(config, workspace.id, input.parentSessionId);
    if (parent?.execution) {
      return writeSessionExecution(config, workspace.id, title, {
        ...parent.execution, sessionId, boundAt: Date.now(),
        runtime: parent.execution.runtime.engineId === input.engineId ? parent.execution.runtime : {
          engineId: input.engineId, model: null, mode: null, modelVariant: null,
        },
      }, "ready");
    }
  }
  return writeConversationWorkflow(config, workspace, sessionId, {
    title, source: "auto", runtime: { engineId: input.engineId, model: null, mode: null, modelVariant: null },
  });
}

export async function createWorkItem(
  config: ServerConfig,
  workspaceId: string,
  input: WorkItemCreateInput,
): Promise<WorkItem> {
  const [created] = await createWorkItems(config, workspaceId, [input]);
  if (!created) throw new Error("Created work item could not be read");
  return created;
}

export async function createWorkItems(
  config: ServerConfig,
  workspaceId: string,
  inputs: readonly WorkItemCreateInput[],
): Promise<WorkItem[]> {
  const parsedItems = inputs.map((input) => workItemCreateSchema.parse(input));
  if (!parsedItems.length) return [];
  const db = await workItemDb(config);
  const now = Date.now();
  const nextPositions = new Map<string, number>();
  const created: WorkItem[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const parsed of parsedItems) {
      const id = `work_${shortId()}`;
      const status = parsed.automation?.enabled ? "ready" : parsed.status;
      let nextPosition = nextPositions.get(status);
      if (nextPosition === undefined) {
        const nextPositionRow = db.get(
          "SELECT COALESCE(MAX(position), 0) + 1024 AS position FROM work_items WHERE workspace_id = ? AND status = ?",
          [workspaceId, status],
        );
        nextPosition = isRecord(nextPositionRow) ? readNumber(nextPositionRow, "position") : 1024;
      }
      const position = parsed.position ?? nextPosition;
      nextPositions.set(status, Math.max(nextPosition, position) + 1024);
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
      const row = normalizeWorkItemRow(db.get(
        "SELECT * FROM work_items WHERE workspace_id = ? AND id = ?",
        [workspaceId, id],
      ));
      if (!row) throw new Error("Created work item could not be read");
      created.push(publicWorkItem(row));
    }
    db.exec("COMMIT");
    return created;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function writeSessionExecution(
  config: ServerConfig,
  workspaceId: string,
  title: string,
  value: ProjectSessionExecution,
  status: string,
  expectedVersion?: number,
  beginRun = false,
): Promise<WorkItem> {
  title = title.trim().slice(0, WORK_ITEM_TITLE_MAX_LENGTH) || "新对话";
  const execution = projectSessionExecutionSchema.parse(value);
  const db = await workItemDb(config);
  const now = Date.now();
  const resume = async (): Promise<WorkItem> => {
    const changes = db.run(
      `UPDATE work_items SET
        title = ?, status = ?, assignee = ?, execution_json = ?,
        last_error = CASE WHEN ? = 1 THEN NULL ELSE last_error END,
        run_started_at = CASE WHEN ? = 1 THEN ? ELSE run_started_at END,
        run_completed_at = CASE WHEN ? = 1 THEN NULL ELSE run_completed_at END,
        version = version + 1, updated_at = ?
       WHERE workspace_id = ? AND session_id = ? AND (? IS NULL OR version = ?)`,
      [
        title,
        status,
        execution.agent.id,
        JSON.stringify(execution),
        beginRun ? 1 : 0,
        beginRun ? 1 : 0,
        now,
        beginRun ? 1 : 0,
        now,
        workspaceId,
        execution.sessionId,
        expectedVersion ?? null,
        expectedVersion ?? null,
      ],
    );
    if (!changes) throw new WorkItemConflictError();
    const updated = await readProjectSessionWorkItem(config, workspaceId, execution.sessionId);
    if (!updated) throw new Error("Project session work item could not be read");
    return updated;
  };
  const existing = await readProjectSessionWorkItem(config, workspaceId, execution.sessionId);
  if (existing) {
    if (expectedVersion !== undefined && existing.version !== expectedVersion) throw new WorkItemConflictError();
    if (existing.execution && existing.execution.runtime.engineId !== execution.runtime.engineId) {
      throw new ApiError(409, "project_session_engine_changed", "This conversation keeps its original execution engine");
    }
    return resume();
  }

  const id = `work_${shortId()}`;
  const nextPositionRow = db.get(
    "SELECT COALESCE(MAX(position), 0) + 1024 AS position FROM work_items WHERE workspace_id = ? AND status = ?",
    [workspaceId, status],
  );
  const position = isRecord(nextPositionRow) ? readNumber(nextPositionRow, "position") : 1024;
  const changes = db.run(
    `INSERT OR IGNORE INTO work_items (
      id, workspace_id, title, description, status, assignee, priority,
      start_at, due_at, position, custom_fields_json,
      session_id, execution_json, last_error, run_started_at, run_completed_at,
      version, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, ?, ?, 'normal', NULL, NULL, ?, '{}', ?, ?, NULL, ?, NULL, 1, ?, ?)`,
    [
      id,
      workspaceId,
      title,
      status,
      execution.agent.id,
      Number.isFinite(position) ? position : 1024,
      execution.sessionId,
      JSON.stringify(execution),
      beginRun ? now : null,
      now,
      now,
    ],
  );
  if (changes === 0) {
    const concurrent = await readProjectSessionWorkItem(config, workspaceId, execution.sessionId);
    if (!concurrent) throw new Error("Project session work item could not be read after insert conflict");
    if (expectedVersion === 0) throw new WorkItemConflictError();
    if (concurrent.execution?.runtime.engineId !== execution.runtime.engineId) throw new ApiError(409, "project_session_engine_changed", "This conversation keeps its original execution engine");
    return resume();
  }
  const created = await readWorkItem(config, workspaceId, id);
  if (!created) throw new Error("Project session work item could not be read");
  return created;
}

export async function startProjectSessionExecution(config: ServerConfig, workspaceId: string, title: string, value: ProjectSessionExecution): Promise<WorkItem> {
  return writeSessionExecution(config, workspaceId, title, value, "running", undefined, true);
}

function resolveProjectExecutionRuntime(input: {
  engineId: string;
  agent: ProjectAgent;
  requested: ProjectSessionExecutionRuntime;
}): ProjectSessionExecutionRuntime {
  const compatibleDefault = !input.agent.runtime.engineId || input.agent.runtime.engineId === input.engineId;
  const defaultModel = compatibleDefault ? input.agent.runtime.model : null;
  const defaultMode = compatibleDefault && !isHarnessWorkspaceEngineId(input.engineId) && input.agent.runtime.mode !== "auto"
    ? input.agent.runtime.mode === "plan" ? "plan" : "build"
    : null;
  return {
    engineId: input.engineId,
    model: input.requested.model ?? defaultModel,
    mode: input.requested.mode ?? defaultMode,
    modelVariant: input.requested.model || !defaultModel ? input.requested.modelVariant : input.agent.runtime.modelVariant,
  };
}

export async function resolveProjectExecutionPlan(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  input: Pick<ProjectSessionExecutionStartInput, "agentId" | "runtime">,
): Promise<Omit<ProjectSessionExecution, "sessionId" | "boundAt">> {
  const { project, templates } = await projectWorkContext(config, workspace);
  const template = templates.find((candidate) => candidate.id === "general");
  if (!template) throw new Error("Default conversation template is missing");
  const workflow = workflowFromTemplate(template, { source: "auto" });
  const agentId = workflow.config.orchestration.entryAgentId;
  const agent = workflow.config.agents.find((candidate) => candidate.id === agentId);
  if (!agent) throw new ApiError(409, "project_agent_missing", "The selected conversation Agent no longer exists");
  return {
    projectRevision: project.revision,
    projectGoal: project.goal,
    agent,
    workflow,
    runtime: resolveProjectExecutionRuntime({ engineId: input.runtime.engineId, agent, requested: input.runtime }),
  };
}

export async function bindProjectSessionExecution(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  input: ProjectSessionExecutionStartInput,
): Promise<WorkItem> {
  const existing = await readProjectSessionWorkItem(config, workspace.id, sessionId);
  if (existing?.execution && input.runtime.engineId !== existing.execution.runtime.engineId) {
    throw new ApiError(
      409,
      "project_session_engine_changed",
      "This conversation is bound to its original engine. Start a new conversation to use another engine.",
    );
  }
  const execution = existing?.execution ?? {
    sessionId,
    ...await resolveProjectExecutionPlan(config, workspace, input),
    boundAt: Date.now(),
  };
  let workflow = execution.workflow;
  if (workflow && (!existing || (existing.status === "ready" && existing.runStartedAt === null))) {
    const goal = workflow.goal || input.goal?.trim().slice(0, 2_000) || "";
    if (workflow.source === "auto" && workflow.templateId === "general" && input.workKind && input.workKind !== "general") {
      const { templates } = await projectWorkContext(config, workspace);
      const template = templates.find((candidate) => candidate.id === input.workKind);
      if (!template) throw new ApiError(404, "work_template_not_found", "The initial work template was not found");
      workflow = { ...workflowFromTemplate(template, { source: "auto", goal }), progress: workflow.progress };
    } else if (goal !== workflow.goal) {
      workflow = { ...workflow, goal, updatedAt: Date.now() };
    }
  }
  const agent = workflow?.config.agents.find((candidate) => candidate.id === workflow.config.orchestration.entryAgentId) ?? execution.agent;
  return startProjectSessionExecution(config, workspace.id, input.title, {
    ...execution, workflow, agent,
    runtime: resolveProjectExecutionRuntime({ engineId: execution.runtime.engineId, agent, requested: input.runtime }),
    boundAt: Date.now(),
  });
}

export async function finishProjectSessionExecution(
  config: ServerConfig,
  workspaceId: string,
  sessionId: string,
  input: ProjectSessionExecutionFinishInput,
  options: { expectedRunStartedAt?: number } = {},
): Promise<WorkItem | null> {
  const current = await readProjectSessionWorkItem(config, workspaceId, sessionId);
  if (!current) return null;
  if (options.expectedRunStartedAt !== undefined && current.runStartedAt !== options.expectedRunStartedAt) return current;
  const db = await workItemDb(config);
  const now = Date.now();
  let transactionOpen = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    if (options.expectedRunStartedAt !== undefined) {
      const locked = normalizeWorkItemRow(db.get(
        "SELECT * FROM work_items WHERE workspace_id = ? AND session_id = ?",
        [workspaceId, sessionId],
      ));
      if (locked?.run_started_at !== options.expectedRunStartedAt) {
        db.exec("COMMIT");
        transactionOpen = false;
        return readProjectSessionWorkItem(config, workspaceId, sessionId);
      }
    }
    if (current.status === "running") {
      db.run(
        `UPDATE work_items SET
          title = ?, status = ?, last_error = ?, run_completed_at = ?,
          version = version + 1, updated_at = ?
         WHERE workspace_id = ? AND session_id = ? AND status = 'running' AND run_started_at = ?`,
        [
          input.title?.trim().slice(0, WORK_ITEM_TITLE_MAX_LENGTH) || current.title,
          input.status === "done" ? "review" : "failed",
          input.status === "failed" ? input.error ?? "Task failed" : null,
          now,
          now,
          workspaceId,
          sessionId,
          current.runStartedAt,
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
    (input.status !== undefined && input.status !== current.status && !(input.status === "done" && current.status === "review"))
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
    customFields: input.status === "done" && current.execution
      ? { ...(input.customFields ?? current.customFields), reviewedAt: Date.now() }
      : input.customFields ?? current.customFields,
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

export function workItemAutomationPrompt(item: WorkItem): string {
  return [
    item.description?.trim() || item.title,
    "",
    "[iPolloWork scheduled execution]",
    `runKey: ${item.workspaceId}:${item.id}:${item.startAt}`,
    "This is one occurrence of the user's scheduled task. Use the installed workspace plugins requested in the task.",
    "For plugin operations that accept runKey, use the value above unchanged. Use a stable operationKey for each requested action (for example post-1 or reply-<target-id>). Reuse these keys on retries; never change keys to bypass an existing, failed, or uncertain operation.",
    "Report verified results or the concrete blocker. A drafted post or a clicked submit button is not proof of publication.",
  ].join("\n");
}

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
