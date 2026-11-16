/** Archive native DSH deliveries for explicitly linked projects. Agent execution stays local. */
import { createHash } from "node:crypto";
import { relative, isAbsolute } from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { FileSystem } from "@deepseek-ai/dsh-fs";
import type { AccountService } from "./account.ts";
import { SuiteError } from "./errors.ts";

export interface ArchiveSession {
  id: string;
  header: { cwd?: string };
  snapshotEvents(): readonly { type: string; data: unknown }[];
}
export interface ArchiveContext {
  fs: Pick<
    FileSystem,
    "resolve" | "contains" | "stat" | "readByteRange" | "processPath"
  >;
  on(
    event: "session/event",
    listener: (
      session: ArchiveSession,
      event: { type: string; data: unknown },
    ) => void,
  ): unknown;
  on(
    event: "agent/created",
    listener: (event: { agent: { session: ArchiveSession } }) => void,
  ): unknown;
  effect(setup: () => () => Promise<void>): unknown;
  logger: { warn(message: string, ...args: unknown[]): void };
}
const delivery = z.object({
  turn: z.number().int(),
  callId: z.string().optional(),
  files: z.array(z.object({ path: z.string() })),
});
const linkSchema = z.object({ origin: z.string(), projectId: z.string() });
type Job = {
  session: Pick<ArchiveSession, "id" | "header">;
  generation: number;
  turn: number;
  path: string;
  projectId: string;
  state: "pending" | "saved" | "failed";
  error?: string;
};

/** One bounded file transfer at a time; failed deliveries remain available for explicit retry. */
export class ProjectArchive {
  private readonly lifetime = new AbortController();
  private tail: Promise<void> = Promise.resolve();
  private readonly jobs = new Map<string, Job>();
  constructor(
    private ctx: ArchiveContext,
    private account: AccountService,
    private origin: string,
    private maxBytes: number,
    private historyLimit: number,
  ) {
    ctx.on("session/event", (session, event) => {
      if (event.type === "deliverables/presented")
        this.observe(session, event.data);
    });
    ctx.on("agent/created", ({ agent }) => {
      for (const event of agent.session.snapshotEvents())
        if (event.type === "deliverables/presented")
          this.observe(agent.session, event.data);
    });
    ctx.effect(() => async () => {
      this.lifetime.abort();
      await this.tail;
    });
  }
  status(projectId: string) {
    return [...this.jobs.values()]
      .filter(
        (job) =>
          job.generation === this.account.generation &&
          job.projectId === projectId,
      )
      .map(({ path, state, error }) => ({ path, state, error }));
  }
  /** Resolve after currently queued archive attempts settle. */
  settled(): Promise<void> {
    return this.tail;
  }
  retry(projectId: string): void {
    for (const [key, job] of this.jobs)
      if (
        job.generation === this.account.generation &&
        job.projectId === projectId &&
        job.state === "failed"
      )
        this.enqueue(key, job);
  }
  private observe(session: ArchiveSession, data: unknown): void {
    const parsed = delivery.safeParse(data);
    if (!parsed.success || !session.header.cwd) return;
    for (const file of parsed.data.files) {
      const key = JSON.stringify([
        session.id,
        parsed.data.callId ?? parsed.data.turn,
        file.path,
      ]);
      if (this.jobs.has(key)) continue;
      if (this.jobs.size >= this.historyLimit) {
        const completed = [...this.jobs].find(
          ([, job]) => job.state !== "pending",
        );
        if (completed) this.jobs.delete(completed[0]);
        else {
          this.ctx.logger.warn(
            "Project output queue is full. The local file is unchanged; upload it from the project files page.",
          );
          continue;
        }
      }
      const job: Job = {
        session: { id: session.id, header: { cwd: session.header.cwd } },
        generation: this.account.generation,
        turn: parsed.data.turn,
        path: file.path,
        projectId: "",
        state: "pending",
      };
      this.jobs.set(key, job);
      this.enqueue(key, job);
    }
  }
  private enqueue(key: string, job: Job): void {
    job.state = "pending";
    delete job.error;
    this.tail = this.tail.then(async () => {
      try {
        await this.save(key, job);
      } catch (error) {
        if (this.lifetime.signal.aborted) return;
        job.state = "failed";
        job.error =
          error instanceof SuiteError ? error.code : "IPW_FILE_TRANSFER_FAILED";
        this.ctx.logger.warn(
          "Project output was not archived; the local file is unchanged. Retry from the project files page.",
          job.error,
        );
      }
    });
  }
  private async save(key: string, job: Job): Promise<void> {
    const signal = this.lifetime.signal,
      cwd = job.session.header.cwd!;
    signal.throwIfAborted();
    if (job.generation !== this.account.generation)
      throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
    let link: z.infer<typeof linkSchema>;
    try {
      link = linkSchema.parse(
        JSON.parse(await readFile(cwd + "/.ipollo/project.json", "utf8")),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        this.jobs.delete(key);
        return;
      }
      throw error;
    }
    if (link.origin !== this.origin)
      throw new SuiteError("IPW_PROJECT_ACCOUNT_MISMATCH", 403);
    job.projectId = link.projectId;
    const listing = z
      .object({ policy: z.object({ outputs: z.boolean() }) })
      .parse(
        await this.account.request(
          "/api/v1/projects/" + link.projectId + "/artifacts",
        ),
      );
    if (!listing.policy.outputs) {
      this.jobs.delete(key);
      return;
    }
    const root = await this.ctx.fs.resolve(cwd, { signal }),
      target = await this.ctx.fs.resolve(job.path, { cwd, signal });
    if (!this.ctx.fs.contains(root, target))
      throw new SuiteError("IPW_ARCHIVE_OUTSIDE_PROJECT", 403);
    const name = relative(
      this.ctx.fs.processPath(root),
      this.ctx.fs.processPath(target),
    ).replaceAll("\\", "/");
    if (
      !name ||
      isAbsolute(name) ||
      name.startsWith("../") ||
      name.startsWith(".ipollo/") ||
      name.split("/").some((part) => part === ".git" || part === ".env")
    )
      throw new SuiteError("IPW_ARCHIVE_OUTSIDE_PROJECT", 403);
    const before = await this.ctx.fs.stat(target, signal);
    if (before?.type !== "file" || before.size === undefined)
      throw new SuiteError("IPW_ARCHIVE_NOT_FILE", 400);
    if (before.size > this.maxBytes)
      throw new SuiteError("IPW_FILE_TOO_LARGE", 413);
    const requestId = createHash("sha256")
      .update(JSON.stringify([key, before.version]))
      .digest("hex");
    let offset = 0;
    const fs = this.ctx.fs;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          signal.throwIfAborted();
          if (offset === before.size) {
            const after = await fs.stat(target, signal);
            if (
              JSON.stringify(after?.version) !== JSON.stringify(before.version)
            )
              throw new SuiteError("IPW_ARCHIVE_FILE_CHANGED", 409);
            controller.close();
            return;
          }
          const bytes = await fs.readByteRange(
            target,
            { offset, length: Math.min(1024 * 1024, before.size! - offset) },
            signal,
          );
          if (!bytes.length)
            throw new SuiteError("IPW_ARCHIVE_FILE_CHANGED", 409);
          offset += bytes.length;
          controller.enqueue(bytes);
        } catch (error) {
          controller.error(error);
        }
      },
    });
    const metadata = Buffer.from(
      JSON.stringify({
        requestId,
        kind: "output",
        path: name,
        bytes: before.size,
        sessionId: job.session.id,
        turn: job.turn,
      }),
    ).toString("base64url");
    if (job.generation !== this.account.generation)
      throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
    await this.account.uploadProject(link.projectId, metadata, stream, signal);
    job.state = "saved";
  }
}
