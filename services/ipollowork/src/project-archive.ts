/** Immutable project outputs; content stays in private object storage. */
import { z } from "zod";
import type { App } from "./http.js";
import type { Config } from "./config.js";
import type { Store } from "./database.js";
import type { Storage } from "./storage.js";
import { projectAccess, projectRole, uid, now, audit } from "./domain.js";
import { ServiceError } from "./errors.js";

const metadataSchema = z
  .object({
    requestId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    kind: z.literal("output").default("output"),
    path: z
      .string()
      .min(1)
      .max(500)
      .refine(
        (value) =>
          !value.startsWith("/") &&
          !value.includes("\\") &&
          !/[\x00-\x1f]/.test(value) &&
          !value
            .split("/")
            .some((part) => !part || part === "." || part === ".."),
      ),
    bytes: z.number().int().nonnegative(),
    mime: z.string().max(100).default("application/octet-stream"),
    sessionId: z.string().min(1).max(200).optional(),
    turn: z.number().int().nonnegative().optional(),
  })
  .strict();

export function mountProjectArchive(
  app: App,
  store: Store,
  storage: Storage,
  config: Config,
): void {
  app.get("/api/v1/projects/:id/overview", async (c) => {
    const project = await projectAccess(
      store,
      c.get("actor"),
      c.req.param("id"),
    );
    const people = await store.all(
      `SELECT u.id,u.name,COALESCE(a.outputs,0) AS outputs,COALESCE(n.contributions,0) AS contributions,
      GREATEST(COALESCE(a.updated_at,0),COALESCE(n.updated_at,0)) AS updated_at
      FROM "user" u
      LEFT JOIN (SELECT author_id,COUNT(*) AS outputs,MAX(created_at) AS updated_at FROM project_artifacts WHERE project_id=? AND kind='output' GROUP BY author_id) a ON a.author_id=u.id
      LEFT JOIN (SELECT author_id,COUNT(*) AS contributions,MAX(created_at) AS updated_at FROM project_changes WHERE project_id=? GROUP BY author_id) n ON n.author_id=u.id
      WHERE u.id=? OR a.author_id IS NOT NULL OR n.author_id IS NOT NULL ORDER BY updated_at DESC,u.id LIMIT 100`,
      project.id,
      project.id,
      project.owner_id,
    );
    return c.json({
      people,
      memoryVersion: project.memory_version,
      outputs: await store.one(
        "SELECT COUNT(*) AS count FROM project_artifacts WHERE project_id=? AND kind='output'",
        project.id,
      ),
    });
  });
  app.get("/api/v1/projects/:id/artifacts", async (c) => {
    const project = await projectAccess(
      store,
      c.get("actor"),
      c.req.param("id"),
    );
    const items = await store.all(
      `SELECT DISTINCT ON (a.kind,a.path) a.*,r.bytes,r.mime,u.name AS author_name,o.expires_at,o.published_at
      FROM project_artifacts a JOIN resources r ON r.id=a.resource_id JOIN "user" u ON u.id=a.author_id JOIN storage_objects o ON o.storage_key=r.storage_key
      WHERE o.state='ready' AND (o.expires_at IS NULL OR o.expires_at>extract(epoch from now())*1000) AND a.project_id=? ORDER BY a.kind,a.path,a.version DESC LIMIT 500`,
      project.id,
    );
    return c.json({
      items,
      policy: { outputs: project.archive_outputs === 1 },
    });
  });
  app.put("/api/v1/projects/:id/archive-policy", async (c) => {
    const actor = c.get("actor"),
      project = await projectAccess(store, actor, c.req.param("id"), true);
    const input = z
      .object({ outputs: z.boolean() })
      .strict()
      .parse(await c.req.json());
    await store.transaction(async () => {
      await store.run(
        "UPDATE projects SET archive_outputs=? WHERE id=?",
        Number(input.outputs),
        project.id,
      );
      await audit(store, actor, "project.archive-policy", project.id);
    });
    return c.json({ ok: true });
  });
  app.get("/api/v1/projects/:id/artifacts/:artifactId/versions", async (c) => {
    const project = await projectAccess(
      store,
      c.get("actor"),
      c.req.param("id"),
    );
    const current = await store.one(
      "SELECT path,kind FROM project_artifacts WHERE id=? AND project_id=?",
      c.req.param("artifactId"),
      project.id,
    );
    if (!current) throw new ServiceError("ARTIFACT_NOT_FOUND", 404);
    return c.json({
      items: await store.all(
        'SELECT a.*,r.bytes,u.name AS author_name FROM project_artifacts a JOIN resources r ON r.id=a.resource_id JOIN "user" u ON u.id=a.author_id WHERE a.project_id=? AND a.path=? AND a.kind=? ORDER BY a.version DESC LIMIT 100',
        project.id,
        current.path,
        current.kind,
      ),
    });
  });
  app.get("/api/v1/projects/:id/memory-versions", async (c) => {
    const project = await projectAccess(
      store,
      c.get("actor"),
      c.req.param("id"),
    );
    return c.json({
      items: await store.all(
        'SELECT v.version,v.created_at,u.name AS author_name FROM project_memory_versions v JOIN "user" u ON u.id=v.author_id WHERE v.project_id=? ORDER BY v.version DESC LIMIT 100',
        project.id,
      ),
    });
  });
  app.get("/api/v1/projects/:id/memory-versions/:version", async (c) => {
    const project = await projectAccess(
      store,
      c.get("actor"),
      c.req.param("id"),
    );
    const version = z.coerce
      .number()
      .int()
      .positive()
      .parse(c.req.param("version"));
    const row = await store.one(
      "SELECT storage_key FROM project_memory_versions WHERE project_id=? AND version=?",
      project.id,
      version,
    );
    if (!row) throw new ServiceError("MEMORY_VERSION_NOT_FOUND", 404);
    return storage.download(
      String(row.storage_key),
      "project-memory-" + version + ".md",
    );
  });
  app.post("/api/v1/projects/:id/artifacts/upload", async (c) => {
    const actor = c.get("actor"),
      project = await projectAccess(store, actor, c.req.param("id"));
    if ((await projectRole(store, actor, project)) === "view")
      throw new ServiceError("PROJECT_PARTICIPATION_REQUIRED", 403);
    let raw: unknown;
    try {
      raw = JSON.parse(
        Buffer.from(c.req.header("x-ipw-artifact") ?? "", "base64url").toString(
          "utf8",
        ),
      );
    } catch (error) {
      throw new ServiceError("INVALID_UPLOAD_METADATA", 400);
    }
    const input = metadataSchema.parse(raw);
    if (!project.archive_outputs)
      throw new ServiceError("PROJECT_ARCHIVE_DISABLED", 409);
    if (input.bytes > config.maxArtifactBytes)
      throw new ServiceError("UPLOAD_TOO_LARGE", 413);
    if (!c.req.raw.body) throw new ServiceError("INVALID_UPLOAD", 400);
    const resourceId = uid();
    const blob = await storage.putStream(
      resourceId,
      { userId: actor.id, organizationId: project.enterprise_id },
      input.mime,
      c.req.raw.body,
      input.bytes,
      { projectId: project.id, permanent: Boolean(project.published_at) },
    );
    let retained = false;
    try {
      const result = await store.transaction(async () => {
        await store.one(
          "SELECT id FROM projects WHERE id=? FOR UPDATE",
          project.id,
        );
        const current = await projectAccess(store, actor, project.id);
        if ((await projectRole(store, actor, current)) === "view")
          throw new ServiceError("PROJECT_PARTICIPATION_REQUIRED", 403);
        if (!current.archive_outputs)
          throw new ServiceError("PROJECT_ARCHIVE_DISABLED", 409);
        const previous = await store.one(
          `SELECT a.*,r.sha256 FROM project_artifacts a JOIN resources r ON r.id=a.resource_id WHERE a.author_id=? AND a.request_id=?`,
          actor.id,
          input.requestId,
        );
        if (previous) {
          if (
            previous.project_id !== project.id ||
            previous.path !== input.path ||
            previous.kind !== input.kind ||
            previous.sha256 !== blob.sha256 ||
            previous.source_session !== (input.sessionId ?? null) ||
            previous.source_turn !== (input.turn ?? null)
          )
            throw new ServiceError("IDEMPOTENCY_CONFLICT", 409);
          return {
            id: previous.id,
            resourceId: previous.resource_id,
            version: previous.version,
          };
        }
        const version = Number(
          (await store.one(
            "SELECT COALESCE(MAX(version),0)+1 AS version FROM project_artifacts WHERE project_id=? AND kind=? AND path=?",
            project.id,
            input.kind,
            input.path,
          ))!.version,
        );
        const id = uid();
        await store.run(
          "INSERT INTO resources(id,owner_id,enterprise_id,kind,visibility,title,description,version,storage_key,mime,bytes,sha256,created_at) VALUES(?,?,?,'attachment','private',?,'',?,?,?,?,?,?)",
          resourceId,
          actor.id,
          project.enterprise_id,
          input.path,
          String(version),
          blob.storageKey,
          input.mime,
          blob.bytes,
          blob.sha256,
          now(),
        );
        await store.run(
          "INSERT INTO project_artifacts VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          id,
          project.id,
          resourceId,
          actor.id,
          input.requestId,
          input.kind,
          input.path,
          version,
          input.sessionId ?? null,
          input.turn ?? null,
          now(),
        );
        await storage.retain(blob.storageKey);
        await audit(store, actor, "project.archive", id);
        return { id, resourceId, version };
      });
      retained = result.resourceId === resourceId;
      return c.json(result, 201);
    } catch (error) {
      if (
        error instanceof ServiceError &&
        error.code === "DATABASE_COMMIT_UNKNOWN"
      )
        retained = true;
      throw error;
    } finally {
      if (!retained) await storage.remove(blob.storageKey);
    }
  });
}
