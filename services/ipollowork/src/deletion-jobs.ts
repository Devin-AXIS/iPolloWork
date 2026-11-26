import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Actor } from "./auth.js";
import type { Store } from "./database.js";
import type { Storage } from "./storage.js";
import type { App } from "./http.js";
import { ServiceError } from "./errors.js";

type Kind = "project" | "data-app" | "app-file" | "package" | "package-file" | "skill";
type Job = { id: string; kind: Kind; target_id: string; requested_by: string; completed_at: number | null };

export function deletionResult(job: Job) {
  return { deletionId: job.id, status: job.completed_at === null ? "pending" as const : "completed" as const };
}

/** Durable receipts survive loss of the original record, a network retry, and service restart. */
export class DeletionJobs {
  private timer?: ReturnType<typeof setInterval>;
  private working?: Promise<void>;
  private readonly running = new Map<string, Promise<Job>>();

  constructor(private store: Store, private storage: Storage, private purge?: (kind: Kind, id: string) => Promise<boolean>) {}

  async lock(kind: Kind, target: string): Promise<void> {
    if (!this.store.inTransaction) throw new Error("Deletion lock requires a transaction");
    await this.store.run("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", `deletion/${kind}/${target}`);
  }

  async requested(kind: Kind, target: string): Promise<boolean> {
    return !!await this.store.one("SELECT 1 FROM deletion_jobs WHERE kind=? AND target_id=?", kind, target);
  }

  start(interval: number): void {
    const tick = () => {
      this.working ??= this.cleanup().catch(() => console.error("Permanent deletion worker failed"))
        .finally(() => { this.working = undefined; });
    };
    tick();
    this.timer = setInterval(tick, interval);
    this.timer.unref();
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    await this.working;
    await Promise.allSettled(this.running.values());
  }

  async existing(kind: Kind, target: string, actor: Actor): Promise<Job | undefined> {
    const job = await this.store.one<Job>("SELECT id,kind,target_id,requested_by,completed_at FROM deletion_jobs WHERE kind=? AND target_id=?", kind, target);
    if (job && job.requested_by !== actor.id && actor.role !== "admin")
      throw new ServiceError("DELETION_NOT_FOUND", 404);
    return job;
  }

  async enqueue(kind: Kind, target: string, actor: Actor, keys: string[] = [], parentProjectId?: string | null): Promise<Job> {
    if (!this.store.inTransaction) throw new Error("Deletion requires the metadata transaction");
    const id = randomUUID();
    return (await this.store.one<Job>(
      "INSERT INTO deletion_jobs(id,kind,target_id,requested_by,storage_keys,created_at,parent_project_id) VALUES(?,?,?,?,?,?,?) RETURNING id,kind,target_id,requested_by,completed_at",
      id, kind, target, actor.id, keys, Date.now(), parentProjectId ?? null,
    ))!;
  }

  async attachProjectApps(projectId: string, appIds: string[], actor: Actor): Promise<void> {
    for (const appId of appIds) {
      await this.lock("data-app", appId);
      if (!await this.requested("data-app", appId)) await this.enqueue("data-app", appId, actor);
      await this.store.run("UPDATE deletion_jobs SET parent_project_id=? WHERE kind='data-app' AND target_id=?", projectId, appId);
    }
  }

  async run(job: Job): Promise<Job> {
    if (job.completed_at !== null) return job;
    const running = this.running.get(job.id);
    if (running) return running;
    const task = this.advance(job).finally(() => this.running.delete(job.id));
    this.running.set(job.id, task);
    return task;
  }

  async receipt(job: Job): Promise<ReturnType<typeof deletionResult>> {
    if (job.completed_at !== null) return deletionResult(job);
    const timer = new AbortController();
    try {
      return deletionResult(await Promise.race([
        this.run(job),
        delay(2500, job, { ref: false, signal: timer.signal }),
      ]));
    } finally {
      timer.abort();
    }
  }

  private async advance(job: Job): Promise<Job> {
    // Compare-and-set gives a running worker time to finish a bounded batch.
    const time = Date.now();
    const claimed = await this.store.run(
      "UPDATE deletion_jobs SET retry_at=? WHERE id=? AND completed_at IS NULL AND retry_at<=?",
      time + 5 * 60_000, job.id, time,
    );
    if (!claimed.changes) return (await this.store.one<Job>(
      "SELECT id,kind,target_id,requested_by,completed_at FROM deletion_jobs WHERE id=?", job.id,
    )) ?? job;
    try {
      const dataDone = await this.purge?.(job.kind, job.target_id) ?? true;
      const pending = await this.store.all<{ storage_key: string }>(
        "SELECT o.storage_key FROM storage_objects o JOIN deletion_jobs j ON o.storage_key=ANY(j.storage_keys) WHERE j.id=? AND NOT o.physical_deleted ORDER BY o.storage_key LIMIT 20",
        job.id,
      );
      await this.storage.removeMany(pending.map(row => row.storage_key));
      const completed = dataDone && await this.store.one<Job>(
        `UPDATE deletion_jobs SET completed_at=?,storage_keys='{}' WHERE id=? AND NOT EXISTS
         (SELECT 1 FROM storage_objects o WHERE o.storage_key=ANY(deletion_jobs.storage_keys) AND NOT o.physical_deleted)
         AND NOT EXISTS (SELECT 1 FROM deletion_jobs child WHERE deletion_jobs.kind='project'
                         AND child.parent_project_id=deletion_jobs.target_id AND child.completed_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM deletion_jobs child WHERE deletion_jobs.kind='package' AND child.kind='package-file'
                         AND starts_with(child.target_id, deletion_jobs.target_id || '/') AND child.completed_at IS NULL)
         RETURNING id,kind,target_id,requested_by,completed_at`, Date.now(), job.id,
      );
      if (completed) return completed;
    } catch (error) {
      const reason = error && typeof error === "object" && "code" in error && typeof error.code === "string" &&
        /^[a-zA-Z0-9_]{1,80}$/.test(error.code) ? error.code : undefined;
      console.warn(JSON.stringify({ event: "permanent_deletion_retry", deletionId: job.id, kind: job.kind, reason }));
    }
    await this.store.run("UPDATE deletion_jobs SET retry_at=? WHERE id=? AND completed_at IS NULL", Date.now() + 5_000, job.id);
    return job;
  }

  async cleanup(): Promise<void> {
    const jobs = await this.store.all<Job>(
      "SELECT id,kind,target_id,requested_by,completed_at FROM deletion_jobs WHERE completed_at IS NULL AND retry_at<=? ORDER BY retry_at,created_at LIMIT 20",
      Date.now(),
    );
    for (const job of jobs) await this.run(job);
  }

  mount(app: App): void {
    app.get("/api/v1/deletions", async c => {
      const actor = c.get("actor");
      const jobs = await this.store.all<Job>(
        `SELECT id,kind,target_id,requested_by,completed_at FROM deletion_jobs
         WHERE requested_by=? ORDER BY (completed_at IS NULL) DESC,created_at DESC LIMIT 50`, actor.id,
      );
      return c.json({ items: jobs.map(job => ({ ...deletionResult(job), kind: job.kind, targetId: job.target_id })) });
    });
    app.get("/api/v1/deletions/:id", async c => {
      const actor = c.get("actor");
      const job = await this.store.one<Job>(
        "SELECT id,kind,target_id,requested_by,completed_at FROM deletion_jobs WHERE id=? AND (requested_by=? OR ?='admin')",
        c.req.param("id"), actor.id, actor.role,
      );
      if (!job) throw new ServiceError("DELETION_NOT_FOUND", 404);
      return c.json(deletionResult(job));
    });
  }
}
