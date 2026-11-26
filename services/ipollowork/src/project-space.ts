/** Project permissions, immutable submissions and the accepted project memory. */
import { z } from "zod";
import type { App } from "./http.js";
import type { Store, Row } from "./database.js";
import type { Actor } from "./auth.js";
import {
  audit,
  canDeleteProject,
  now,
  projectAccess,
  projectRole,
  uid,
} from "./domain.js";
import { ServiceError } from "./errors.js";
import { createHash } from "node:crypto";
import type { Config } from "./config.js";
import type { Storage } from "./storage.js";
import { organizationNotice } from "./organization-notice.js";

const title = z.string().trim().min(1).max(120);
/** Shared memory is a compact summary with at most two heading levels. Originals remain separate. */
const acceptedMemory = z
  .string()
  .trim()
  .min(1)
  .max(8000)
  .refine(
    (text) => !/^\s*#{3,}\s/m.test(text),
    "Project memory supports only two heading levels",
  );
const role = z.enum(["view", "participate", "maintain"]);
export const projectAccessInput = z.object({
  mode: z.enum(["enterprise", "selected"]),
  grants: z.array(z.object({
    kind: z.enum(["member", "department"]),
    subjectId: z.string().min(1).max(200),
    role,
  })).max(500),
}).strict();

export async function replaceProjectAccess(store: Store, projectId: string, enterpriseId: string | null, input: z.infer<typeof projectAccessInput>) {
  if (!enterpriseId) throw new ServiceError("ENTERPRISE_REQUIRED", 400);
  const keys = new Set(input.grants.map(grant => grant.kind + ":" + grant.subjectId));
  if (keys.size !== input.grants.length) throw new ServiceError("DUPLICATE_GRANT", 400);
  const grants = JSON.stringify(input.grants);
  const invalid = await store.one(
    `SELECT g.kind FROM jsonb_to_recordset(?::jsonb) AS g(kind text,"subjectId" text)
       WHERE (g.kind='member' AND NOT EXISTS (SELECT 1 FROM members m WHERE m.enterprise_id=? AND m.user_id=g."subjectId"))
          OR (g.kind='department' AND NOT EXISTS (SELECT 1 FROM departments d WHERE d.enterprise_id=? AND d.id=g."subjectId")) LIMIT 1`,
    grants, enterpriseId, enterpriseId,
  );
  if (invalid) throw new ServiceError(invalid.kind === "department" ? "DEPARTMENT_MISMATCH" : "RECIPIENT_NOT_FOUND", 400);
  await store.run("DELETE FROM project_grants WHERE project_id=?", projectId);
  await store.run(
    `INSERT INTO project_grants(project_id,kind,subject_id,role)
       SELECT ?,g.kind,g."subjectId",g.role FROM jsonb_to_recordset(?::jsonb) AS g(kind text,"subjectId" text,role text)`,
    projectId, grants,
  );
  await store.run("UPDATE projects SET access_mode=? WHERE id=?", input.mode, projectId);
}

async function recordProjectAccessChange(store: Store, actor: Actor, id: string, enterpriseId: string | null) {
  await store.run("UPDATE shares SET revoked_at=? WHERE project_id=? AND revoked_at IS NULL", now(), id);
  await audit(store, actor, "project.access", id, enterpriseId);
}

const filePath = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !p.includes("\\") &&
      !p.includes("\0") &&
      !p.split("/").some((s) => s === ".." || s === "." || !s),
    "Use a relative file path",
  );
const fileChange = z.object({
  path: filePath,
  resourceId: z.string().nullable(),
  baseResourceId: z.string().nullable(),
});
type ProjectFile = { path: string; resourceId: string };
type Change = Row & {
  id: string;
  project_id: string;
  author_id: string;
  kind: "files" | "memory";
  content: string;
  base_version: number;
  status: string;
};

/** One bounded query resolves direct and current department access without per-project queries. */
export async function projectListings(
  store: Store,
  actor: Actor,
  enterpriseId?: string,
) {
  return await store.all(
    `SELECT * FROM (SELECT p.*,e.name AS enterprise_name,
    CASE WHEN ?='admin' THEN 'maintain'
      WHEN p.enterprise_id IS NULL THEN CASE WHEN p.owner_id=? THEN 'maintain' END
      WHEN m.user_id IS NULL THEN NULL
      WHEN p.owner_id=? OR m.role IN('owner','admin') THEN 'maintain'
      WHEN EXISTS(SELECT 1 FROM project_grants g WHERE g.project_id=p.id AND ((g.kind='member' AND g.subject_id=m.user_id) OR (g.kind='department' AND g.subject_id=m.department_id)) AND g.role='maintain') THEN 'maintain'
      WHEN EXISTS(SELECT 1 FROM project_grants g WHERE g.project_id=p.id AND ((g.kind='member' AND g.subject_id=m.user_id) OR (g.kind='department' AND g.subject_id=m.department_id)) AND g.role='participate') THEN 'participate'
      WHEN p.access_mode='enterprise' OR EXISTS(SELECT 1 FROM project_grants g WHERE g.project_id=p.id AND ((g.kind='member' AND g.subject_id=m.user_id) OR (g.kind='department' AND g.subject_id=m.department_id))) THEN 'view' END AS project_role
    FROM projects p LEFT JOIN enterprises e ON e.id=p.enterprise_id
    LEFT JOIN members m ON m.enterprise_id=p.enterprise_id AND m.user_id=? AND m.status='active'
    WHERE p.deleted_at IS NULL AND (?::text IS NULL OR p.enterprise_id=?)) AS permitted WHERE project_role IS NOT NULL ORDER BY created_at DESC LIMIT 200`,
    actor.role,
    actor.id,
    actor.id,
    actor.id,
    enterpriseId ?? null,
    enterpriseId ?? null,
  );
}
async function changes(store: Store, id: string) {
  return await store.all(
    `SELECT c.id,c.project_id,c.author_id,c.kind,c.title,c.base_version,c.status,c.created_at,c.accepted_at,u.name AS author_name
    FROM project_changes c JOIN "user" u ON u.id=c.author_id WHERE c.project_id=? ORDER BY c.created_at DESC,c.id LIMIT 100`,
    id,
  );
}

/** Preserve revisions when permissions are removed, but check current grants before every read/write. */
export function mountProjectSpace(
  app: App,
  store: Store,
  storage: Storage,
  config: Config,
) {
  app.get("/api/v1/projects/:id/memory", async (c) => {
    const p = await projectAccess(store, c.get("actor"), c.req.param("id"));
    return c.json({
      title: p.title,
      text: p.memory,
      version: p.memory_version,
    });
  });
  app.get("/api/v1/projects/:id/changes/:changeId", async (c) => {
    const p = await projectAccess(store, c.get("actor"), c.req.param("id"));
    const change = await store.one(
      `SELECT c.*,u.name AS author_name FROM project_changes c JOIN "user" u ON u.id=c.author_id WHERE c.id=? AND c.project_id=?`,
      c.req.param("changeId"),
      p.id,
    );
    if (!change) throw new ServiceError("CHANGE_NOT_FOUND", 404);
    const content = JSON.parse(String(change.content));
    if (change.kind === "memory" && content.storageKey)
      content.text = (await storage.read(content.storageKey)).toString("utf8");
    return c.json({ ...change, content: JSON.stringify(content) });
  });
  app.get("/api/v1/projects/:id/space", async (c) => {
    const actor = c.get("actor"),
      p = await projectAccess(store, actor, c.req.param("id"));
    return c.json({
      project: {
        id: p.id,
        title: p.title,
        enterpriseId: p.enterprise_id,
        role: await projectRole(store, actor, p),
        accessMode: p.access_mode,
        publishedAt: p.published_at,
        canDelete: await canDeleteProject(store, actor, p),
      },
      memory: { text: p.memory, version: p.memory_version },
      files: JSON.parse(String(p.files)),
      fileVersion: p.file_version,
      changes: await changes(store, String(p.id)),
    });
  });
  app.get("/api/v1/projects/:id/access", async (c) => {
    const p = await projectAccess(
      store,
      c.get("actor"),
      c.req.param("id"),
      true,
    );
    return c.json({
      mode: p.access_mode,
      grants: await store.all(
        'SELECT kind,subject_id AS "subjectId",role FROM project_grants WHERE project_id=?',
        p.id,
      ),
    });
  });
  app.put("/api/v1/projects/:id/access", async (c) => {
    const input = projectAccessInput.parse(await c.req.json());
    const actor = c.get("actor"), id = c.req.param("id");
    await store.transaction(async () => {
      await store.one("SELECT id FROM projects WHERE id=? FOR UPDATE", id);
      const project = await projectAccess(store, actor, id, true);
      await replaceProjectAccess(store, id, project.enterprise_id, input);
      await recordProjectAccessChange(store, actor, id, project.enterprise_id);
    });
    return c.json({ ok: true });
  });
  app.patch("/api/v1/projects/:id/access", async (c) => {
    const edits = z.array(z.object({ subjectId: z.string().min(1).max(200), role: role.nullable() }).strict()).min(1).max(500)
      .refine(rows => new Set(rows.map(row => row.subjectId)).size === rows.length).parse(await c.req.json());
    const actor = c.get("actor"), id = c.req.param("id");
    await store.transaction(async () => {
      await store.one("SELECT id FROM projects WHERE id=? FOR UPDATE", id);
      const project = await projectAccess(store, actor, id, true);
      const enterpriseId = project.enterprise_id;
      if (!enterpriseId) throw new ServiceError("ENTERPRISE_REQUIRED", 400);
      const input = JSON.stringify(edits);
      if (await store.one(
        `SELECT 1 FROM jsonb_to_recordset(?::jsonb) AS item("subjectId" text)
           WHERE NOT EXISTS (SELECT 1 FROM members WHERE enterprise_id=? AND user_id=item."subjectId") LIMIT 1`,
        input, enterpriseId,
      )) throw new ServiceError("RECIPIENT_NOT_FOUND", 400);

      // Preserve the effective access of every untouched member when retiring legacy audiences.
      await store.run(
        `WITH effective AS (
           SELECT m.user_id,MAX(CASE g.role WHEN 'maintain' THEN 3 WHEN 'participate' THEN 2 WHEN 'view' THEN 1
             ELSE CASE WHEN ?='enterprise' THEN 1 ELSE 0 END END) AS rank
           FROM members m LEFT JOIN project_grants g ON g.project_id=? AND
             ((g.kind='member' AND g.subject_id=m.user_id) OR (g.kind='department' AND g.subject_id=m.department_id))
           WHERE m.enterprise_id=? GROUP BY m.user_id
         )
         INSERT INTO project_grants(project_id,kind,subject_id,role)
           SELECT ?,'member',user_id,CASE rank WHEN 3 THEN 'maintain' WHEN 2 THEN 'participate' ELSE 'view' END
           FROM effective WHERE rank>0
         ON CONFLICT(project_id,kind,subject_id) DO UPDATE SET role=EXCLUDED.role`,
        project.access_mode, id, enterpriseId, id,
      );
      await store.run("DELETE FROM project_grants WHERE project_id=? AND kind='department'", id);
      await store.run(
        `DELETE FROM project_grants WHERE project_id=? AND kind='member' AND subject_id IN
           (SELECT item."subjectId" FROM jsonb_to_recordset(?::jsonb) AS item("subjectId" text))`, id, input,
      );
      await store.run(
        `INSERT INTO project_grants(project_id,kind,subject_id,role) SELECT ?,'member',item."subjectId",item.role
           FROM jsonb_to_recordset(?::jsonb) AS item("subjectId" text,role text) WHERE item.role IS NOT NULL`, id, input,
      );
      await store.run("UPDATE projects SET access_mode='selected' WHERE id=?", id);
      await recordProjectAccessChange(store, actor, id, enterpriseId);
    });
    return c.json({ ok: true });
  });

  app.post("/api/v1/projects/:id/changes", async (c) => {
    const input = z
      .object({
        requestId: z.string().uuid(),
        kind: z.enum(["files", "memory"]),
        title,
        baseVersion: z.number().int().nonnegative(),
        text: z.string().trim().min(1).max(100000).optional(),
        files: z.array(fileChange).min(1).max(100).optional(),
      })
      .parse(await c.req.json());
    if (
      input.kind === "memory"
        ? !input.text || !!input.files
        : !input.files || !!input.text
    )
      throw new ServiceError("INVALID_SUBMISSION", 400);
    const actor = c.get("actor");
    const project = await projectAccess(store, actor, c.req.param("id"));
    if ((await projectRole(store, actor, project)) === "view")
      throw new ServiceError("PROJECT_PARTICIPATION_REQUIRED", 403);
    const bodyKey =
      input.kind === "memory"
        ? await storage.put(
            uid(),
            { userId: actor.id, organizationId: project.enterprise_id },
            "text/markdown",
            Buffer.from(input.text!),
            { permanent: Boolean(project.published_at), projectId: project.id },
          )
        : undefined;
    let retained = false;
    try {
      const result = await store.transaction(async () => {
        const p = await projectAccess(store, actor, c.req.param("id"));
        if ((await projectRole(store, actor, p)) === "view")
          throw new ServiceError("PROJECT_PARTICIPATION_REQUIRED", 403);
        const memoryHash = input.text
          ? createHash("sha256").update(input.text).digest("hex")
          : undefined;
        const content = JSON.stringify(
          input.kind === "memory"
            ? { storageKey: bodyKey, sha256: memoryHash }
            : { files: input.files },
        );
        const previous = await store.one<Change>(
          "SELECT * FROM project_changes WHERE author_id=? AND request_id=?",
          actor.id,
          input.requestId,
        );
        if (previous) {
          const stored = JSON.parse(previous.content);
          const same =
            previous.kind === "memory"
              ? (stored.sha256 ??
                  createHash("sha256").update(stored.text).digest("hex")) ===
                memoryHash
              : JSON.stringify(stored.files) === JSON.stringify(input.files);
          if (
            previous.project_id !== p.id ||
            previous.kind !== input.kind ||
            previous.title !== input.title ||
            !same ||
            previous.base_version !== input.baseVersion
          )
            throw new ServiceError("IDEMPOTENCY_CONFLICT", 409);
          return { id: previous.id, retained: false };
        }
        const version = Number(
          input.kind === "memory" ? p.memory_version : p.file_version,
        );
        if (input.baseVersion > version)
          throw new ServiceError("PROJECT_VERSION_CONFLICT", 409);
        if (input.files) {
          const paths = new Set<string>();
          for (const file of input.files) {
            if (paths.has(file.path))
              throw new ServiceError("DUPLICATE_PATH", 400);
            paths.add(file.path);
            if (file.resourceId) {
              const resource = await store.one(
                "SELECT * FROM resources WHERE id=? AND owner_id=? AND kind='attachment' FOR SHARE",
                file.resourceId,
                actor.id,
              );
              if (
                !resource ||
                (resource.enterprise_id &&
                  resource.enterprise_id !== p.enterprise_id)
              )
                throw new ServiceError("RESOURCE_FORBIDDEN", 403);
            }
          }
        }
        const id = uid();
        await store.run(
          "INSERT INTO project_changes VALUES(?,?,?,?,?,?,?,?,'pending',?,NULL,NULL)",
          id,
          p.id,
          actor.id,
          input.requestId,
          input.kind,
          input.title,
          content,
          input.baseVersion,
          now(),
        );
        if (bodyKey) await storage.retain(bodyKey);
        await audit(store, actor, "project.submit", id, p.enterprise_id ?? undefined);
        if (p.enterprise_id) {
          const maintainers = await store.all<{user_id:string}>(
            `SELECT m.user_id FROM members m WHERE m.enterprise_id=? AND m.status='active' AND m.user_id<>?
             AND (m.user_id=? OR m.role IN ('owner','admin') OR EXISTS (
               SELECT 1 FROM project_grants g WHERE g.project_id=? AND g.role='maintain' AND
                ((g.kind='member' AND g.subject_id=m.user_id) OR (g.kind='department' AND g.subject_id=m.department_id))
             ))`, p.enterprise_id, actor.id, p.owner_id, p.id,
          );
          await organizationNotice(store, p.enterprise_id, maintainers.map(row => row.user_id), "project.submitted", String(p.title), "projects", p.id);
        }
        return { id, retained: true };
      });
      retained = result.retained;
      return c.json({ id: result.id }, 201);
    } catch (error) {
      if (
        error instanceof ServiceError &&
        error.code === "DATABASE_COMMIT_UNKNOWN"
      )
        retained = true;
      throw error;
    } finally {
      if (bodyKey && !retained) await storage.remove(bodyKey);
    }
  });
  app.post("/api/v1/projects/:id/changes/:changeId/accept", async (c) => {
    const input = z
      .object({
        expectedVersion: z.number().int().nonnegative(),
        text: acceptedMemory.optional(),
      })
      .parse(await c.req.json());
    const actor = c.get("actor");
    const project = await projectAccess(store, actor, c.req.param("id"), true);
    const proposal = await store.one<Change>(
      "SELECT * FROM project_changes WHERE id=? AND project_id=?",
      c.req.param("changeId"),
      project.id,
    );
    if (!proposal) throw new ServiceError("CHANGE_NOT_FOUND", 404);
    const bodyKey =
      proposal.kind === "memory" && input.text
        ? await storage.put(
            uid(),
            { userId: actor.id, organizationId: project.enterprise_id },
            "text/markdown",
            Buffer.from(input.text),
            { permanent: Boolean(project.published_at), projectId: project.id },
          )
        : undefined;
    let retained = false;
    try {
      const result = await store.transaction(async () => {
        const p = await projectAccess(store, actor, c.req.param("id"), true);
        const change = await store.one<Change>(
          "SELECT * FROM project_changes WHERE id=? AND project_id=?",
          c.req.param("changeId"),
          p.id,
        );
        if (!change) throw new ServiceError("CHANGE_NOT_FOUND", 404);
        if (change.status === "accepted") return { ok: true, duplicate: true };
        if (change.status !== "pending")
          throw new ServiceError("CHANGE_CLOSED", 409);
        const version = Number(
          change.kind === "memory" ? p.memory_version : p.file_version,
        );
        if (input.expectedVersion !== version)
          throw new ServiceError("PROJECT_VERSION_CONFLICT", 409);
        if (change.kind === "memory") {
          if (!input.text)
            throw new ServiceError("MEMORY_REVIEW_REQUIRED", 400);
          await store.run(
            "UPDATE projects SET memory=?,memory_version=memory_version+1 WHERE id=?",
            input.text,
            p.id,
          );
          await store.run(
            "INSERT INTO project_memory_versions VALUES(?,?,?,?,?,?,?)",
            p.id,
            version + 1,
            change.id,
            actor.id,
            bodyKey!,
            createHash("sha256").update(input.text).digest("hex"),
            now(),
          );
          await storage.retain(bodyKey!);
        } else {
          const files = JSON.parse(String(p.files)) as ProjectFile[];
          const submitted = z
            .object({ files: z.array(fileChange) })
            .parse(JSON.parse(change.content));
          for (const file of submitted.files) {
            const index = files.findIndex((f) => f.path === file.path),
              current = index < 0 ? null : files[index]!.resourceId;
            if (current !== file.baseResourceId)
              throw new ServiceError(
                "FILE_VERSION_CONFLICT",
                409,
                "此文件已被更新，请重新选择修改",
              );
            if (index >= 0) files.splice(index, 1);
            if (file.resourceId)
              files.push({ path: file.path, resourceId: file.resourceId });
          }
          await store.run(
            "UPDATE projects SET files=?,file_version=file_version+1 WHERE id=?",
            JSON.stringify(files),
            p.id,
          );
        }
        const acceptedContent = JSON.stringify({
          ...JSON.parse(change.content),
          acceptedVersion: version + 1,
          ...(change.kind === "memory" ? { acceptedText: input.text } : {}),
        });
        await store.run(
          "UPDATE project_changes SET status='accepted',accepted_at=?,accepted_by=?,content=? WHERE id=?",
          now(),
          actor.id,
          acceptedContent,
          change.id,
        );
        await audit(store, actor, "project.accept", change.id, p.enterprise_id ?? undefined);
        if (p.enterprise_id && change.author_id !== actor.id)
          await organizationNotice(store, p.enterprise_id, [change.author_id], "project.accepted", String(p.title), "projects", p.id);
        return { ok: true };
      });
      retained = Boolean(bodyKey && !("duplicate" in result));
      return c.json(result);
    } catch (error) {
      if (
        error instanceof ServiceError &&
        error.code === "DATABASE_COMMIT_UNKNOWN"
      )
        retained = true;
      throw error;
    } finally {
      if (bodyKey && !retained) await storage.remove(bodyKey);
    }
  });
  app.delete("/api/v1/projects/:id/changes/:changeId", async (c) => {
    const actor = c.get("actor"),
      p = await projectAccess(store, actor, c.req.param("id"));
    const change = await store.one<Change>(
      "SELECT * FROM project_changes WHERE id=? AND project_id=?",
      c.req.param("changeId"),
      p.id,
    );
    if (!change) throw new ServiceError("CHANGE_NOT_FOUND", 404);
    if (
      change.author_id !== actor.id &&
      (await projectRole(store, actor, p)) !== "maintain"
    )
      throw new ServiceError("PROJECT_FORBIDDEN", 403);
    if (change.status !== "pending")
      throw new ServiceError("CHANGE_CLOSED", 409);
    await store.transaction(async () => {
      await store.run(
        "UPDATE project_changes SET status='withdrawn' WHERE id=?",
        change.id,
      );
      await audit(store, actor, "project.withdraw", change.id, p.enterprise_id);
    });
    return c.json({ ok: true });
  });
}
