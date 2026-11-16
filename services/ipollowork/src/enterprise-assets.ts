/** Department management and the enterprise file packages and skills that departments and members are granted. */
import { createHash } from "node:crypto";
import { z } from "zod";
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
  audienceSchema,
  canUse,
  dropAudience,
  grantedTo,
  replaceAudience,
  requireUse,
  type AssetKind,
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

async function packageOf(
  store: Store,
  enterpriseId: string,
  packageId: string,
): Promise<PackageRow> {
  const row = await store.one<PackageRow>(
    "SELECT * FROM file_packages WHERE id=? AND enterprise_id=?",
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
    "SELECT * FROM resources WHERE id=? AND enterprise_id=? AND kind='skill'",
    skillId,
    enterpriseId,
  );
  if (!row) throw new ServiceError("SKILL_NOT_FOUND", 404, "Skill 不存在");
  return row;
}
/** Assets of one kind in an enterprise that the actor may see: managers see all, members only granted ones. */
async function visible<T extends { id: string }>(
  store: Store,
  actor: Actor,
  enterpriseId: string,
  kind: AssetKind,
  rows: T[],
): Promise<T[]> {
  if (await isEnterpriseManager(store, actor, enterpriseId)) return rows;
  const result: T[] = [];
  for (const row of rows)
    if (await canUse(store, actor, enterpriseId, kind, row.id))
      result.push(row);
  return result;
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
) {
  app.patch("/api/v1/enterprises/:id/departments/:departmentId", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    await requireEnterpriseManager(store, actor, id);
    const input = z.object({ name: title }).parse(await c.req.json());
    await store.transaction(async () => {
      if (
        !(
          await store.run(
            "UPDATE departments SET name=? WHERE id=? AND enterprise_id=?",
            input.name,
            c.req.param("departmentId"),
            id,
          )
        ).changes
      )
        throw new ServiceError("DEPARTMENT_NOT_FOUND", 404, "部门不存在");
      await audit(
        store,
        actor,
        "department.update",
        c.req.param("departmentId"),
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
      await audit(store, actor, "department.remove", departmentId);
    });
    return c.json({ ok: true });
  });

  /** One read for the enterprise page: packages, skills and their audiences. Models come from the service gateway. */
  app.get("/api/v1/enterprises/:id/assets", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    await enterpriseAccess(store, actor, id);
    const packages = await visible(
      store,
      actor,
      id,
      "package",
      await store.all<PackageRow & { file_count: number; bytes: number }>(
        "SELECT p.*,COUNT(f.resource_id) AS file_count,COALESCE(SUM(r.bytes),0) AS bytes FROM file_packages p LEFT JOIN package_files f ON f.package_id=p.id LEFT JOIN resources r ON r.id=f.resource_id WHERE p.enterprise_id=? GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 200",
        id,
      ),
    );
    const skills = await visible(
      store,
      actor,
      id,
      "skill",
      await store.all<SkillRow>(
        "SELECT id,enterprise_id,title,description,version,bytes,storage_key,created_at FROM resources WHERE enterprise_id=? AND kind='skill' ORDER BY created_at DESC LIMIT 200",
        id,
      ),
    );
    return c.json({
      canManage: await isEnterpriseManager(store, actor, id),
      packages: await Promise.all(
        packages.map(async (p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          fileCount: Number(p.file_count),
          bytes: Number(p.bytes),
          updatedAt: p.updated_at,
          audience: await audienceOf(store, "package", p.id),
        })),
      ),
      skills: await Promise.all(
        skills.map(async (s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          name: skillName(s.title, s.id),
          bytes: s.bytes,
          updatedAt: s.created_at,
          audience: await audienceOf(store, "skill", s.id),
        })),
      ),
    });
  });
  app.put("/api/v1/enterprises/:id/grants", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    await requireEnterpriseManager(store, actor, id);
    const input = z
      .object({
        kind: z.enum(["package", "skill", "service"]),
        assetId: z.string().min(1).max(100),
        audience: audienceSchema,
      })
      .parse(await c.req.json());
    const owned =
      input.kind === "package"
        ? await store.one(
            "SELECT 1 FROM file_packages WHERE id=? AND enterprise_id=?",
            input.assetId,
            id,
          )
        : input.kind === "skill"
          ? await store.one(
              "SELECT 1 FROM resources WHERE id=? AND enterprise_id=? AND kind='skill'",
              input.assetId,
              id,
            )
          : await store.one(
              "SELECT 1 FROM enterprise_services WHERE service_id=? AND enterprise_id=?",
              input.assetId,
              id,
            );
    if (!owned) throw new ServiceError("ASSET_NOT_FOUND", 404, "资源不存在");
    await store.transaction(async () => {
      await replaceAudience(
        store,
        id,
        input.kind,
        input.assetId,
        input.audience,
      );
      await audit(store, actor, "grant.update", input.assetId);
    });
    return c.json({
      ok: true,
      audience: await audienceOf(store, input.kind, input.assetId),
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
      await audit(store, actor, "package.create", packageId);
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
    await store.run(
      "UPDATE file_packages SET title=?,description=?,updated_at=? WHERE id=?",
      input.title ?? row.title,
      input.description ?? row.description,
      now(),
      row.id,
    );
    return c.json({ ok: true });
  });
  app.delete("/api/v1/enterprises/:id/packages/:packageId", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    await requireEnterpriseManager(store, actor, id);
    const row = await packageOf(store, id, c.req.param("packageId"));
    await store.transaction(async () => {
      await store.run(
        "DELETE FROM enterprise_grants WHERE asset_kind='package' AND asset_id=?",
        row.id,
      );
      await store.run("DELETE FROM file_packages WHERE id=?", row.id);
      await audit(store, actor, "package.remove", row.id);
    });
    return c.json({ ok: true });
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
        audience: await audienceOf(store, "package", row.id),
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
      await audit(store, actor, "package.file.add", resourceId);
    });
    return c.json({ id: resourceId, name }, 201);
  });
  app.delete(
    "/api/v1/enterprises/:id/packages/:packageId/files/:fileId",
    async (c) => {
      const id = c.req.param("id"),
        actor = c.get("actor");
      await requireEnterpriseManager(store, actor, id);
      const row = await packageOf(store, id, c.req.param("packageId"));
      await store.transaction(async () => {
        if (
          !(
            await store.run(
              "DELETE FROM package_files WHERE package_id=? AND resource_id=?",
              row.id,
              c.req.param("fileId"),
            )
          ).changes
        )
          throw new ServiceError("FILE_NOT_FOUND", 404, "文件不存在");
        await store.run(
          "UPDATE file_packages SET updated_at=? WHERE id=?",
          now(),
          row.id,
        );
        await audit(store, actor, "package.file.remove", c.req.param("fileId"));
      });
      return c.json({ ok: true });
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
      return await storage.download(file.storage_key, file.name);
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
      await audit(store, actor, "skill.create", skillId);
    });
    return c.json({ id: skillId, name: skillName(input.title, skillId) }, 201);
  });
  app.delete("/api/v1/enterprises/:id/skills/:skillId", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    await requireEnterpriseManager(store, actor, id);
    const row = await skillOf(store, id, c.req.param("skillId"));
    await store.transaction(async () => {
      await store.run(
        "DELETE FROM enterprise_grants WHERE asset_kind='skill' AND asset_id=?",
        row.id,
      );
      // The stored body stays referenced by the resource row; detaching it from the enterprise removes it from every listing.
      await store.run(
        "UPDATE resources SET enterprise_id=NULL,visibility='private' WHERE id=?",
        row.id,
      );
      await audit(store, actor, "skill.remove", row.id);
    });
    return c.json({ ok: true });
  });

  /** Skills the signed-in member may use across all enterprises, with bodies, for registration in the member's DSH. */
  app.get("/api/v1/me/enterprise-skills", async (c) => {
    const actor = c.get("actor");
    const rows = await store.all<SkillRow & { enterprise_name: string }>(
      `SELECT r.id,r.enterprise_id,r.title,r.description,r.storage_key,e.name AS enterprise_name FROM resources r JOIN enterprises e ON e.id=r.enterprise_id JOIN members m ON m.enterprise_id=r.enterprise_id AND m.user_id=?
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
    return c.json({ items });
  });
}
