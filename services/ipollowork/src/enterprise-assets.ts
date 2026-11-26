/** Department management and the enterprise file packages and skills that departments and members are granted. */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { DeletionJobs } from "./deletion-jobs.js";
import { checkDepartmentParent } from "./enterprise.js";
import type { App } from "./http.js";
import type { Store } from "./database.js";
import type { Config } from "./config.js";
import type { Actor } from "./auth.js";
import type { Storage } from "./storage.js";
import {
  audit,
  enterpriseAccess,
  isEnterpriseManager,
  now,
  requireEnterpriseManager,
  uid,
} from "./domain.js";
import { ServiceError } from "./errors.js";
import {
  audienceOf,
  audiencesOf,
  audienceSchema,
  dropAudience,
  grantedTo,
  replaceAudience,
  requireUse,
} from "./grants.js";

const title = z.string().trim().min(1).max(120);
const description = z.string().trim().max(2000).default("");
const MAX_FILE = 24 * 1024 * 1024;
const everyone = { all: true, departments: [], members: [] };

type PackageRow = {
  id: string;
  enterprise_id: string;
  title: string;
  description: string;
  created_at: number;
  updated_at: number;
};
type FileRow = {
  resource_id: string;
  name: string;
  bytes: number;
  mime: string;
  storage_key: string;
  added_at: number;
  added_by_name: string;
};
type SkillRow = {
  id: string;
  enterprise_id: string;
  title: string;
  description: string;
  version: string;
  bytes: number;
  storage_key: string;
  created_at: number;
};
type ResourceBody = { id: string; storage_key: string };

async function packageOf(
  store: Store,
  enterpriseId: string,
  packageId: string,
  lock = false,
): Promise<PackageRow> {
  const row = await store.one<PackageRow>(
    "SELECT * FROM file_packages WHERE id=? AND enterprise_id=?" + (lock ? " FOR UPDATE" : ""),
    packageId,
    enterpriseId,
  );
  if (!row) throw new ServiceError("PACKAGE_NOT_FOUND", 404, "文件包不存在");
  return row;
}
async function skillOf(
  store: Store,
  enterpriseId: string,
  skillId: string,
): Promise<SkillRow> {
  const row = await store.one<SkillRow>(
    "SELECT * FROM resources WHERE id=? AND enterprise_id=? AND kind='skill' FOR UPDATE",
    skillId,
    enterpriseId,
  );
  if (!row) throw new ServiceError("SKILL_NOT_FOUND", 404, "Skill 不存在");
  return row;
}

async function lockPackageFiles(store: Store, enterpriseId: string, packageId: string, fileId: string | null) {
  return store.all<ResourceBody>(
    `SELECT r.id,r.storage_key FROM package_files f JOIN resources r ON r.id=f.resource_id
     WHERE f.package_id=? AND (?::text IS NULL OR r.id=?) AND r.enterprise_id=? AND r.kind='attachment'
     ORDER BY r.id FOR UPDATE OF r`,
    packageId, fileId, fileId, enterpriseId,
  );
}

async function referencedFiles(store: Store, packageId: string, files: ResourceBody[]) {
  const ids = files.map(file => file.id);
  if (!ids.length) return new Set<string>();
  const rows = await store.all<{ id: string }>(
    `WITH candidates AS (SELECT unnest(?::text[]) AS id)
     SELECT c.id FROM candidates c JOIN package_files f ON f.resource_id=c.id WHERE f.package_id<>?
     UNION SELECT c.id FROM candidates c JOIN project_artifacts a ON a.resource_id=c.id
     UNION SELECT c.id FROM projects p CROSS JOIN LATERAL jsonb_array_elements(p.files::jsonb) AS f
       JOIN candidates c ON c.id=f->>'resourceId'
     UNION SELECT c.id FROM project_changes p CROSS JOIN LATERAL jsonb_array_elements(p.content::jsonb->'files') AS f
       JOIN candidates c ON c.id=f->>'resourceId' WHERE p.kind='files' AND p.status<>'withdrawn'`,
    ids, packageId,
  );
  return new Set(rows.map(row => row.id));
}

/** The resource rows are locked first. Serialize last-reference checks for legacy shared objects. */
async function removeResourceRecords(store: Store, storage: Storage, files: ResourceBody[]) {
  if (!files.length) return [];
  const keys = [...new Set(files.map(file => file.storage_key))];
  await store.all("SELECT storage_key FROM storage_objects WHERE storage_key=ANY(?::text[]) ORDER BY storage_key FOR UPDATE", keys);
  await store.run("DELETE FROM resources WHERE id=ANY(?::text[])", files.map(file => file.id));
  const shared = await store.all<{ storage_key: string }>(
    "SELECT DISTINCT storage_key FROM resources WHERE storage_key=ANY(?::text[])",
    keys,
  );
  const retained = new Set(shared.map(row => row.storage_key));
  const removed = keys.filter(key => !retained.has(key));
  await storage.markForRemoval(removed);
  return removed;
}

/** Kebab-case skill name for the native skill registry; non-ASCII titles fall back to a stable id-derived name. */
export function skillName(titleText: string, id: string): string {
  const slug = titleText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return /^[a-z][a-z0-9-]*[a-z0-9]$/.test(slug)
    ? slug
    : "team-skill-" + id.replace(/-/g, "").slice(0, 8);
}

export function mountEnterpriseAssets(
  app: App,
  store: Store,
  storage: Storage,
  config: Config,
  jobs: DeletionJobs,
) {
  app.patch("/api/v1/enterprises/:id/departments/:departmentId", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    await requireEnterpriseManager(store, actor, id);
    const input = z.object({ name: title, parentId: z.string().nullable().optional() }).parse(await c.req.json());
    const departmentId = c.req.param("departmentId");
    await store.transaction(async () => {
      await checkDepartmentParent(store, id, input.parentId, departmentId);
      if (
        !(
          await store.run(
            "UPDATE departments SET name=?,parent_id=CASE WHEN ? THEN ? ELSE parent_id END WHERE id=? AND enterprise_id=?",
            input.name,
            input.parentId !== undefined,
            input.parentId ?? null,
            departmentId,
            id,
          )
        ).changes
      )
        throw new ServiceError("DEPARTMENT_NOT_FOUND", 404, "部门不存在");
      await audit(
        store,
        actor,
        "department.update",
        departmentId,
        id,
      );
    });
    return c.json({ ok: true });
  });
  app.delete("/api/v1/enterprises/:id/departments/:departmentId", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor"),
      departmentId = c.req.param("departmentId");
    await requireEnterpriseManager(store, actor, id);
    await store.transaction(async () => {
      await checkDepartmentParent(store, id);
      if (
        !(await store.one(
          "SELECT id FROM departments WHERE id=? AND enterprise_id=?",
          departmentId,
          id,
        ))
      )
        throw new ServiceError("DEPARTMENT_NOT_FOUND", 404, "部门不存在");
      await store.run(
        "UPDATE members SET department_id=NULL WHERE enterprise_id=? AND department_id=?",
        id,
        departmentId,
      );
      await store.run(
        "UPDATE invitations SET department_id=NULL WHERE enterprise_id=? AND department_id=?",
        id,
        departmentId,
      );
      await dropAudience(store, id, "department", departmentId);
      await store.run("DELETE FROM departments WHERE id=?", departmentId);
      await audit(store, actor, "department.remove", departmentId, id);
    });
    return c.json({ ok: true });
  });

  /** One read for the enterprise page: packages, skills and their audiences. Models come from the service gateway. */
  app.get("/api/v1/enterprises/:id/assets", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    await enterpriseAccess(store, actor, id);
    const canManage = await isEnterpriseManager(store, actor, id);
    // Apply recipient visibility before the limit so newer private assets cannot hide granted ones.
    const visibility = (alias: "p" | "s") => canManage ? "" : ` AND EXISTS(SELECT 1 FROM members m
      WHERE m.enterprise_id=${alias}.enterprise_id AND m.user_id=? AND m.status='active' AND ${grantedTo(alias + ".id")})`;
    const [packages, skills] = await Promise.all([
      store.all<PackageRow & { file_count: number; bytes: number }>(
        `SELECT p.*,COUNT(f.resource_id) AS file_count,COALESCE(SUM(r.bytes),0) AS bytes FROM file_packages p
          LEFT JOIN package_files f ON f.package_id=p.id LEFT JOIN resources r ON r.id=f.resource_id
          WHERE p.enterprise_id=?${visibility("p")} GROUP BY p.id ORDER BY p.updated_at DESC,p.id LIMIT 200`,
        id, ...(canManage ? [] : [actor.id, "package"]),
      ),
      store.all<SkillRow>(
        `SELECT s.id,s.enterprise_id,s.title,s.description,s.version,s.bytes,s.storage_key,s.created_at FROM resources s
          WHERE s.enterprise_id=? AND s.kind='skill'${visibility("s")} ORDER BY s.created_at DESC,s.id LIMIT 200`,
        id, ...(canManage ? [] : [actor.id, "skill"]),
      ),
    ]);
    const [packageAudiences, skillAudiences] = await Promise.all([
      audiencesOf(store, id, "package", packages.map(p => p.id)),
      audiencesOf(store, id, "skill", skills.map(s => s.id)),
    ]);
    return c.json({
      canManage,
      packages: packages.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        fileCount: Number(p.file_count),
        bytes: Number(p.bytes),
        updatedAt: p.updated_at,
        audience: packageAudiences.get(p.id)!,
      })),
      skills: skills.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        name: skillName(s.title, s.id),
        bytes: s.bytes,
        updatedAt: s.created_at,
        audience: skillAudiences.get(s.id)!,
      })),
    });
  });
  app.put("/api/v1/enterprises/:id/grants", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    await requireEnterpriseManager(store, actor, id);
    const input = z
      .object({
        kind: z.enum(["package", "skill", "service", "mcp", "plugin", "template"]),
        assetId: z.string().min(1).max(100),
        audience: audienceSchema,
      })
      .parse(await c.req.json());
    await store.transaction(async () => {
      const direct = {
        package: "SELECT 1 FROM file_packages WHERE id=? AND enterprise_id=? FOR UPDATE",
        skill: "SELECT 1 FROM resources WHERE id=? AND enterprise_id=? AND kind='skill' FOR UPDATE",
        mcp: "SELECT 1 FROM enterprise_mcp WHERE id=? AND enterprise_id=? FOR UPDATE",
        service: "SELECT 1 FROM enterprise_services WHERE service_id=? AND enterprise_id=? FOR UPDATE",
        plugin: null,
        template: null,
      }[input.kind];
      // Serialize grant edits with publication, which also locks its publication row first.
      const publication = input.kind !== "package" && input.kind !== "service" && await store.one(
        "SELECT 1 FROM organization_publications WHERE id=? AND enterprise_id=? AND kind=? FOR UPDATE",
        input.assetId, id, input.kind,
      );
      if (!publication && !(direct && await store.one(direct, input.assetId, id)))
        throw new ServiceError("ASSET_NOT_FOUND", 404, "资源不存在");
      await replaceAudience(
        store,
        id,
        input.kind,
        input.assetId,
        input.audience,
      );
      await audit(store, actor, "grant.update", input.assetId, id);
    });
    return c.json({
      ok: true,
      audience: await audienceOf(store, id, input.kind, input.assetId),
    });
  });

  app.post("/api/v1/enterprises/:id/packages", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    await requireEnterpriseManager(store, actor, id);
    const input = z
        .object({ title, description, audience: audienceSchema.optional() })
        .parse(await c.req.json()),
      packageId = uid();
    await store.transaction(async () => {
      await store.run(
        "INSERT INTO file_packages VALUES(?,?,?,?,?,?,?)",
        packageId,
        id,
        input.title,
        input.description,
        actor.id,
        now(),
        now(),
      );
      await replaceAudience(
        store,
        id,
        "package",
        packageId,
        input.audience ?? everyone,
      );
      await audit(store, actor, "package.create", packageId, id);
    });
    return c.json({ id: packageId }, 201);
  });
  app.patch("/api/v1/enterprises/:id/packages/:packageId", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    await requireEnterpriseManager(store, actor, id);
    const row = await packageOf(store, id, c.req.param("packageId"));
    const input = z
      .object({
        title: title.optional(),
        description: z.string().trim().max(2000).optional(),
      })
      .parse(await c.req.json());
    await store.transaction(async () => {
      await store.run(
        "UPDATE file_packages SET title=?,description=?,updated_at=? WHERE id=?",
        input.title ?? row.title, input.description ?? row.description, now(), row.id,
      );
      await audit(store, actor, "package.update", row.id, id);
    });
    return c.json({ ok: true });
  });
  app.delete("/api/v1/enterprises/:id/packages/:packageId", async (c) => {
    const id = c.req.param("id"),
      packageId = c.req.param("packageId"),
      actor = c.get("actor");
    await requireEnterpriseManager(store, actor, id);
    const target = id + "/" + packageId;
    const job = await store.transaction(async () => {
      await jobs.lock("package", target);
      const existing = await jobs.existing("package", target, actor);
      if (existing) return existing;
      const row = await packageOf(store, id, packageId, true);
      const files = await lockPackageFiles(store, id, row.id, null);
      const retained = await referencedFiles(store, row.id, files);
      await store.run(
        "DELETE FROM enterprise_grants WHERE asset_kind='package' AND asset_id=?",
        row.id,
      );
      await store.run("DELETE FROM file_packages WHERE id=?", row.id);
      const cleanup = await removeResourceRecords(store, storage, files.filter(file => !retained.has(file.id)));
      await audit(store, actor, "package.remove", row.id, id);
      return jobs.enqueue("package", target, actor, cleanup);
    });
    const result = await jobs.receipt(job);
    return c.json({ ok: result.status === "completed", ...result }, result.status === "completed" ? 200 : 202);
  });
  app.get("/api/v1/enterprises/:id/packages/:packageId", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    await enterpriseAccess(store, actor, id);
    const row = await packageOf(store, id, c.req.param("packageId"));
    await requireUse(store, actor, id, "package", row.id);
    const files = await store.all<FileRow>(
      `SELECT f.resource_id,f.name,f.added_at,r.bytes,r.mime,u.name AS added_by_name FROM package_files f JOIN resources r ON r.id=f.resource_id JOIN "user" u ON u.id=f.added_by WHERE f.package_id=? ORDER BY f.added_at DESC LIMIT 500`,
      row.id,
    );
    return c.json({
      package: {
        id: row.id,
        title: row.title,
        description: row.description,
        audience: await audienceOf(store, id, "package", row.id),
      },
      files: files.map((f) => ({
        id: f.resource_id,
        name: f.name,
        bytes: Number(f.bytes),
        mime: f.mime,
        addedAt: f.added_at,
        addedBy: f.added_by_name,
      })),
    });
  });
  app.post("/api/v1/enterprises/:id/packages/:packageId/files", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    await requireEnterpriseManager(store, actor, id);
    const row = await packageOf(store, id, c.req.param("packageId"));
    const form = await c.req.formData(),
      file = form.get("file");
    if (!(file instanceof File))
      throw new ServiceError("INVALID_UPLOAD", 400, "请选择文件");
    if (file.size > MAX_FILE)
      throw new ServiceError("UPLOAD_TOO_LARGE", 413, "单个文件不能超过 24MB");
    const name =
      file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200) || "file";
    const body = Buffer.from(await file.arrayBuffer()),
      resourceId = uid(),
      mime = (file.type || "application/octet-stream").slice(0, 100);
    const storageKey = await storage.put(
      resourceId,
      { userId: actor.id, organizationId: id },
      mime,
      body,
      { permanent: true },
    );
    await storage.persist(storageKey, async () => {
      await packageOf(store, id, row.id);
      await store.run(
        "INSERT INTO resources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        resourceId,
        actor.id,
        id,
        "attachment",
        "private",
        name,
        "",
        "1.0.0",
        storageKey,
        mime,
        body.length,
        createHash("sha256").update(body).digest("hex"),
        now(),
      );
      await store.run(
        "INSERT INTO package_files VALUES(?,?,?,?,?)",
        row.id,
        resourceId,
        name,
        actor.id,
        now(),
      );
      await store.run(
        "UPDATE file_packages SET updated_at=? WHERE id=?",
        now(),
        row.id,
      );
      await audit(store, actor, "package.file.add", resourceId, id);
    });
    return c.json({ id: resourceId, name }, 201);
  });
  app.delete(
    "/api/v1/enterprises/:id/packages/:packageId/files/:fileId",
    async (c) => {
      const id = c.req.param("id"),
        fileId = c.req.param("fileId"),
        actor = c.get("actor");
      await requireEnterpriseManager(store, actor, id);
      const target = id + "/" + c.req.param("packageId") + "/" + fileId;
      const job = await store.transaction(async () => {
        await jobs.lock("package-file", target);
        const existing = await jobs.existing("package-file", target, actor);
        if (existing) return existing;
        const row = await packageOf(store, id, c.req.param("packageId"), true);
        const files = await lockPackageFiles(store, id, row.id, fileId);
        if (!files.length) throw new ServiceError("FILE_NOT_FOUND", 404, "文件不存在");
        if ((await referencedFiles(store, row.id, files)).has(fileId))
          throw new ServiceError("PACKAGE_FILE_IN_USE", 409, "此文件仍被其他文件包或项目使用");
        await store.run("DELETE FROM package_files WHERE package_id=? AND resource_id=?", row.id, fileId);
        const cleanup = await removeResourceRecords(store, storage, files);
        await store.run(
          "UPDATE file_packages SET updated_at=? WHERE id=?",
          now(),
          row.id,
        );
        await audit(store, actor, "package.file.remove", fileId, id);
        return jobs.enqueue("package-file", target, actor, cleanup);
      });
      const result = await jobs.receipt(job);
      return c.json({ ok: result.status === "completed", ...result }, result.status === "completed" ? 200 : 202);
    },
  );
  app.get(
    "/api/v1/enterprises/:id/packages/:packageId/files/:fileId/download",
    async (c) => {
      const id = c.req.param("id"),
        actor = c.get("actor");
      await enterpriseAccess(store, actor, id);
      const row = await packageOf(store, id, c.req.param("packageId"));
      await requireUse(store, actor, id, "package", row.id);
      const file = await store.one<FileRow>(
        "SELECT f.name,r.storage_key FROM package_files f JOIN resources r ON r.id=f.resource_id WHERE f.package_id=? AND f.resource_id=?",
        row.id,
        c.req.param("fileId"),
      );
      if (!file) throw new ServiceError("FILE_NOT_FOUND", 404, "文件不存在");
      return await storage.download(file.storage_key, file.name, c.req.query("redirect") === "1");
    },
  );

  app.post("/api/v1/enterprises/:id/skills", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    await requireEnterpriseManager(store, actor, id);
    const input = z
      .object({
        title,
        description: z.string().trim().min(1).max(1000),
        content: z.string().trim().min(1).max(200_000),
        audience: audienceSchema.optional(),
      })
      .parse(await c.req.json());
    const skillId = uid(),
      body = Buffer.from(input.content, "utf8");
    const storageKey = await storage.put(
      skillId,
      { userId: actor.id, organizationId: id },
      "text/markdown",
      body,
      { permanent: true },
    );
    await storage.persist(storageKey, async () => {
      await store.run(
        "INSERT INTO resources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        skillId,
        actor.id,
        id,
        "skill",
        "private",
        input.title,
        input.description,
        "1.0.0",
        storageKey,
        "text/markdown",
        body.length,
        createHash("sha256").update(body).digest("hex"),
        now(),
      );
      await replaceAudience(
        store,
        id,
        "skill",
        skillId,
        input.audience ?? everyone,
      );
      await audit(store, actor, "skill.create", skillId, id);
    });
    return c.json({ id: skillId, name: skillName(input.title, skillId) }, 201);
  });
  app.delete("/api/v1/enterprises/:id/skills/:skillId", async (c) => {
    const id = c.req.param("id"),
      skillId = c.req.param("skillId"),
      actor = c.get("actor");
    await requireEnterpriseManager(store, actor, id);
    const target = id + "/" + skillId;
    const job = await store.transaction(async () => {
      await jobs.lock("skill", target);
      const existing = await jobs.existing("skill", target, actor);
      if (existing) return existing;
      const row = await skillOf(store, id, skillId);
      await store.run(
        "DELETE FROM enterprise_grants WHERE asset_kind='skill' AND asset_id=?",
        row.id,
      );
      const cleanup = await removeResourceRecords(store, storage, [row]);
      await audit(store, actor, "skill.remove", row.id, id);
      return jobs.enqueue("skill", target, actor, cleanup);
    });
    const result = await jobs.receipt(job);
    return c.json({ ok: result.status === "completed", ...result }, result.status === "completed" ? 200 : 202);
  });

  /** Skills the signed-in member may use across all enterprises, with bodies, for registration in the member's DSH. */
  app.get("/api/v1/me/enterprise-skills", async (c) => {
    const actor = c.get("actor");
    const rows = await store.all<SkillRow & { enterprise_name: string }>(
      `SELECT r.id,r.enterprise_id,r.title,r.description,r.storage_key,e.name AS enterprise_name FROM resources r JOIN enterprises e ON e.id=r.enterprise_id JOIN members m ON m.enterprise_id=r.enterprise_id AND m.user_id=? AND m.status='active'
       WHERE r.kind='skill' AND (m.role IN('owner','admin') OR ${grantedTo("r.id")}) ORDER BY r.created_at LIMIT 100`,
      actor.id,
      "skill",
    );
    const items = [];
    for (const row of rows)
      items.push({
        id: row.id,
        enterpriseId: row.enterprise_id,
        enterpriseName: row.enterprise_name,
        name: skillName(row.title, row.id),
        title: row.title,
        description: row.description,
        content: (await storage.read(row.storage_key)).toString("utf8"),
      });
    const published = await store.all<SkillRow & { enterprise_name:string; content:string }>(
      `SELECT p.id,p.title,p.description,p.enterprise_id,e.name AS enterprise_name,v.content
         FROM organization_publications p JOIN organization_publication_versions v ON v.publication_id=p.id AND v.version=p.published_version
         JOIN enterprises e ON e.id=p.enterprise_id JOIN members m ON m.enterprise_id=p.enterprise_id AND m.user_id=? AND m.status='active'
         WHERE p.kind='skill' AND v.status='approved' AND (m.role IN('owner','admin') OR ${grantedTo("p.id")})
         ORDER BY p.created_at,p.id LIMIT ?`,
      actor.id,"skill",100-items.length,
    );
    for (const row of published) {
      items.push({ id:row.id, enterpriseId:row.enterprise_id, enterpriseName:row.enterprise_name,
        name:skillName(row.title,row.id), title:row.title, description:row.description, content:row.content });
    }
    return c.json({ items });
  });
}
