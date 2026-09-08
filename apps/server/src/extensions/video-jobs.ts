import { dirname } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { importNodeSqlite } from "../node-sqlite.js";
import { runtimeDbPath } from "../runtime-storage.js";
import type { ServerConfig } from "../types.js";
import { ensureDir } from "../utils.js";

const jobSchema = z.object({
  id: z.string(), workspaceId: z.string(), sessionId: z.string(), model: z.string(),
  operation: z.string(), prompt: z.string(), fingerprint: z.string(), upstreamId: z.string(),
  // Absent on existing standard-API jobs; preserve their query endpoint on upgrades.
  workflowId: z.string().optional(),
  status: z.enum(["submitting", "running", "saving", "succeeded", "failed", "uncertain", "save_failed"]),
  path: z.string(), message: z.string(), createdAt: z.number(), updatedAt: z.number(), nextPoll: z.number(),
});
export type VideoJob = z.infer<typeof jobSchema>;

// Durable upstream identifiers, never credentials, media bytes or expiring signed URLs.
async function openDb(config: ServerConfig) {
  const path = runtimeDbPath(config);
  await ensureDir(dirname(path));
  const db = typeof process.versions.bun === "string"
    ? new (await import("bun:sqlite")).Database(path, { create: true })
    : new (await importNodeSqlite()).DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS video_jobs (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, session_id TEXT NOT NULL,
        status TEXT NOT NULL, next_poll INTEGER NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS video_jobs_owner ON video_jobs(workspace_id, session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS video_jobs_pending ON video_jobs(status, next_poll);`);
    return db;
  } catch (error) { db.close(); throw error; }
}

type Db = Awaited<ReturnType<typeof openDb>>;
function rows(db: Db, sql: string, ...params: Array<string | number>) {
  const statement = db.prepare(sql);
  try {
    return z.array(z.object({ data: z.string() })).parse(statement.all(...params))
      .map(row => jobSchema.parse(JSON.parse(row.data)));
  } finally { if ("finalize" in statement) statement.finalize(); }
}
function execute(db: Db, sql: string, ...params: Array<string | number>) {
  const statement = db.prepare(sql);
  try { return statement.run(...params); }
  finally { if ("finalize" in statement) statement.finalize(); }
}
function put(db: Db, job: VideoJob) {
  execute(db, "UPDATE video_jobs SET status = ?, next_poll = ?, data = ? WHERE id = ?",
    job.status, job.nextPoll, JSON.stringify(job), job.id);
}

export async function createVideoJob(config: ServerConfig, job: VideoJob): Promise<{ job: VideoJob; created: boolean }> {
  const db = await openDb(config);
  try {
    db.exec("BEGIN IMMEDIATE");
    const existing = rows(db, "SELECT data FROM video_jobs WHERE id = ?", job.id)[0];
    if (existing) {
      if (existing.workspaceId !== job.workspaceId || existing.sessionId !== job.sessionId || existing.fingerprint !== job.fingerprint) {
        throw new ApiError(409, "video_request_conflict", "请求编号已被使用，请刷新任务列表后重新操作。");
      }
      db.exec("COMMIT");
      return { job: existing, created: false };
    }
    if (rows(db, "SELECT data FROM video_jobs WHERE status IN ('submitting','running','saving') LIMIT 12").length >= 12) {
      throw new ApiError(429, "video_queue_full", "已有 12 个视频任务处理中，请等待任务完成。");
    }
    execute(db, "INSERT INTO video_jobs VALUES (?, ?, ?, ?, ?, ?, ?)", job.id, job.workspaceId,
      job.sessionId, job.status, job.nextPoll, job.createdAt, JSON.stringify(job));
    db.exec("COMMIT");
    return { job, created: true };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}

export async function listVideoJobs(config: ServerConfig, workspaceId: string, sessionId: string, before = Number.MAX_SAFE_INTEGER) {
  const db = await openDb(config);
  try { return rows(db, "SELECT data FROM video_jobs WHERE workspace_id = ? AND session_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT 50", workspaceId, sessionId, before); }
  finally { db.close(); }
}

export async function getVideoJob(config: ServerConfig, id: string, workspaceId: string, sessionId: string) {
  const db = await openDb(config);
  try {
    const job = rows(db, "SELECT data FROM video_jobs WHERE id = ? AND workspace_id = ? AND session_id = ?", id, workspaceId, sessionId)[0];
    if (!job) throw new ApiError(404, "video_job_not_found", "当前会话中没有这个视频任务。");
    return job;
  } finally { db.close(); }
}

export async function updateVideoJob(config: ServerConfig, job: VideoJob, patch: Partial<VideoJob>) {
  const next = { ...job, ...patch, updatedAt: Date.now() };
  const db = await openDb(config);
  try { put(db, next); return next; } finally { db.close(); }
}

export async function claimVideoJobs(config: ServerConfig, now = Date.now()) {
  const db = await openDb(config);
  try {
    db.exec("BEGIN IMMEDIATE");
    // A lost POST response must never result in an automatic, billable resubmission.
    for (const job of rows(db, "SELECT data FROM video_jobs WHERE status = 'submitting' AND next_poll < ? LIMIT 12", now)) {
      put(db, { ...job, status: "uncertain", updatedAt: now, message: "提交结果未确认。请先在服务商控制台检查是否已有任务；不要直接重复生成。可填写已有任务 ID 恢复查询。" });
    }
    const jobs = rows(db, "SELECT data FROM video_jobs WHERE status IN ('running','saving') AND next_poll <= ? ORDER BY next_poll LIMIT 2", now);
    for (const job of jobs) put(db, { ...job, nextPoll: now + 300_000 });
    db.exec("COMMIT");
    return jobs;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}
