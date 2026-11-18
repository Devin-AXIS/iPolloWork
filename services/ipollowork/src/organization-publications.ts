import semver from "semver";
import { z } from "zod";
import type { App } from "./http.js";
import type { Store, Row } from "./database.js";
import { audit, enterpriseAccess, isEnterpriseManager, now, uid } from "./domain.js";
import { audienceOf, grantedTo, replaceAudience, requireUse } from "./grants.js";
import { ServiceError } from "./errors.js";
import { isSharedMcpEndpoint, publishEnterpriseMcp } from "./enterprise-mcp.js";
import { organizationNotice } from "./organization-notice.js";

const kindSchema = z.enum(["plugin", "template", "skill", "mcp"]);
const title = z.string().trim().min(1).max(120);
const description = z.string().trim().max(2000).default("");
const version = z.string().max(64).refine(value => !value.includes("+") && semver.valid(value) === value);
const publicationId = z.uuid().optional();
const plugin = z.object({
  id: publicationId, title, description, version,
  packageName: z.string().max(214).regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/),
}).strict();
const template = z.object({
  id: publicationId, title, description, version,
  html: z.string().min(1).refine(value => !value.includes("\u0000") && Buffer.byteLength(JSON.stringify({html:value})) <= 768 * 1024 && Buffer.byteLength(value) <= 512 * 1024 && value.trim().length > 0),
}).strict();
const skill = z.object({
  id: publicationId, title, description: z.string().trim().min(1).max(1000), version,
  markdown: z.string().trim().min(1).max(32_000).refine(value => !value.includes("\u0000")),
}).strict();
const mcp = z.object({
  id: publicationId, title, description, version,
  endpoint: z.string().trim().max(2048).refine(isSharedMcpEndpoint, "需要公开的 HTTPS MCP 地址"),
}).strict();
const review = z.object({
  decision: z.enum(["approve", "reject", "publish"]),
  note: z.string().trim().max(1000).default(""),
}).strict();
type Publication = Row & { id: string; submitted_by: string; resource_key: string; published_version: string | null };
const resourceTab = { template:"templates", plugin:"plugins", skill:"skills", mcp:"mcp" } as const;
const versionFields = "version,status,note,created_at";

/** Organization publications use the existing membership and asset authorization. */
export function mountOrganizationPublications(app: App, store: Store) {
  const list = "/api/v1/enterprises/:id/publications/:kind";
  const item = `${list}/:publicationId` as const;
  const release = `${item}/versions/:version` as const;
  const read = async (id: string, kind: string, publicationId: string, lock = false) => {
    const publication = await store.one<Publication>(
      "SELECT * FROM organization_publications WHERE enterprise_id=? AND kind=? AND id=?" + (lock ? " FOR UPDATE" : ""),
      id, kind, publicationId,
    );
    if (!publication) throw new ServiceError("PUBLICATION_NOT_FOUND", 404, "资源不存在");
    return publication;
  };
  app.get(list, async c => {
    const actor = c.get("actor"), id = c.req.param("id"), kind = kindSchema.parse(c.req.param("kind"));
    await enterpriseAccess(store, actor, id);
    const canManage = await isEnterpriseManager(store, actor, id);
    const records = await store.all<Publication>(
      `SELECT p.id,p.title,p.description,p.resource_key,p.published_version,p.submitted_by
         FROM organization_publications p WHERE p.enterprise_id=? AND p.kind=? AND
         (? OR p.submitted_by=? OR (p.published_version IS NOT NULL AND EXISTS(
           SELECT 1 FROM members m WHERE m.enterprise_id=p.enterprise_id AND m.user_id=? AND m.status='active' AND ${grantedTo("p.id")}
         ))) ORDER BY p.created_at DESC,p.id LIMIT 200`,
      id, kind, canManage, actor.id, actor.id, kind,
    );
    const items = await Promise.all(records.map(async ({ resource_key, published_version, submitted_by, ...row }) => ({
      ...row,
      ...(kind === "plugin" ? { packageName: resource_key } : {}),
      publishedVersion: published_version,
      canSubmit: canManage || submitted_by === actor.id,
      ...(canManage ? { audience: await audienceOf(store, kind, row.id) } : {}),
    })));
    return c.json({ canManage, items });
  });
  app.post(list, async c => {
    const actor = c.get("actor"), id = c.req.param("id"), kind = kindSchema.parse(c.req.param("kind"));
    const raw: unknown = await c.req.json();
    const input = { plugin, template, skill, mcp }[kind].parse(raw);
    const publication = await store.transaction(async () => {
      await enterpriseAccess(store, actor, id);
      const key = "packageName" in input ? input.packageName : input.id ?? uid();
      const publicationId = input.id ?? uid();
      if (input.id) {
        const current = await read(id, kind, input.id, true);
        if (current.submitted_by !== actor.id && !await isEnterpriseManager(store, actor, id))
          throw new ServiceError("PUBLICATION_FORBIDDEN", 403, "没有提交权限");
        if ("packageName" in input && current.resource_key !== key)
          throw new ServiceError("PUBLICATION_PACKAGE_MISMATCH", 400, "新版本必须使用同一个插件包名");
      } else {
        const result = await store.run(
          "INSERT INTO organization_publications(id,enterprise_id,submitted_by,kind,resource_key,title,description,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(enterprise_id,kind,resource_key) DO NOTHING",
          publicationId, id, actor.id, kind, key, input.title, input.description, now(),
        );
        if (!result.changes) throw new ServiceError("PUBLICATION_EXISTS", 409, "该插件已存在，请提交新版本");
        await replaceAudience(store, id, kind, publicationId, { all: false, departments: [], members: [] });
      }
      const result = await store.run(
        "INSERT INTO organization_publication_versions(publication_id,version,content,status,created_at) VALUES(?,?,?,'pending',?) ON CONFLICT DO NOTHING",
        publicationId, input.version, "html" in input ? input.html : "markdown" in input ? input.markdown :
          "endpoint" in input ? new URL(input.endpoint).href : null, now(),
      );
      if (!result.changes) throw new ServiceError("PUBLICATION_VERSION_EXISTS", 409, "该版本已存在");
      await audit(store, actor, "publication.submit", publicationId, id);
      return publicationId;
    });
    return c.json({ id: publication, version: input.version }, 201);
  });
  app.get(`${item}/versions` as const, async c => {
    const actor = c.get("actor"), id = c.req.param("id"), kind = kindSchema.parse(c.req.param("kind"));
    await enterpriseAccess(store, actor, id);
    const canManage = await isEnterpriseManager(store, actor, id);
    const publication = await read(id, kind, c.req.param("publicationId"));
    if (!canManage && publication.submitted_by !== actor.id) {
      await requireUse(store, actor, id, kind, publication.id);
      if (!publication.published_version) throw new ServiceError("PUBLICATION_NOT_FOUND", 404);
      return c.json({ items: await store.all(
        `SELECT ${versionFields} FROM organization_publication_versions WHERE publication_id=? AND version=?`,
        publication.id, publication.published_version,
      ) });
    }
    return c.json({ items: await store.all(
      `SELECT ${versionFields} FROM organization_publication_versions WHERE publication_id=? ORDER BY created_at DESC,version LIMIT 200`,
      publication.id,
    ) });
  });
  app.get(release, async c => {
    const actor = c.get("actor"), id = c.req.param("id"), kind = kindSchema.parse(c.req.param("kind"));
    const requested = version.parse(c.req.param("version"));
    const data = await store.transaction(async () => {
      await enterpriseAccess(store, actor, id);
      const publication = await read(id, kind, c.req.param("publicationId"));
      if (kind === "plugin" || (publication.submitted_by !== actor.id && !await isEnterpriseManager(store, actor, id))) {
        await requireUse(store, actor, id, kind, publication.id);
        if (publication.published_version !== requested) throw new ServiceError("PUBLICATION_NOT_FOUND", 404, "该版本未发布");
      }
      const record = await store.one("SELECT content FROM organization_publication_versions WHERE publication_id=? AND version=?", publication.id, requested);
      if (!record) throw new ServiceError("PUBLICATION_NOT_FOUND", 404);
      if (kind === "plugin") return { spec: publication.resource_key + "@" + requested };
      if (kind === "mcp") return { endpoint: record.content };
      return kind === "skill" ? { markdown:record.content } : { html:record.content };
    });
    return c.json(data);
  });
  app.put(release, async c => {
    const actor = c.get("actor"), id = c.req.param("id"), kind = kindSchema.parse(c.req.param("kind"));
    const input = review.parse(await c.req.json()), requested = version.parse(c.req.param("version"));
    await store.transaction(async () => {
      await enterpriseAccess(store, actor, id, true);
      const publication = await read(id, kind, c.req.param("publicationId"), true);
      const previous = await store.one("SELECT status,content FROM organization_publication_versions WHERE publication_id=? AND version=?", publication.id, requested);
      if (!previous) throw new ServiceError("PUBLICATION_NOT_FOUND", 404);
      if (input.decision === "publish") {
        if (previous.status !== "approved") throw new ServiceError("PUBLICATION_REVIEW_REQUIRED", 409, "先审核通过该版本");
        if (kind === "mcp")
          await publishEnterpriseMcp(store, publication.id, id, String(publication.title), String(publication.description), String(previous.content));
        await store.run("UPDATE organization_publications SET published_version=? WHERE id=?", requested, publication.id);
        if (publication.published_version !== requested) {
          const recipients = await store.all<{user_id:string}>(
            `SELECT m.user_id FROM members m WHERE m.enterprise_id=? AND m.status='active' AND m.user_id<>? AND
             (m.role IN ('owner','admin') OR ${grantedTo("?")})`, id, actor.id, kind, publication.id,
          );
          await organizationNotice(store, id, recipients.map(row => row.user_id), "resource.published", String(publication.title), resourceTab[kind], publication.id);
        }
      } else {
        if (publication.published_version === requested) throw new ServiceError("PUBLICATION_ALREADY_PUBLISHED", 409, "请先下架该版本");
        const status = input.decision === "approve" ? "approved" : "rejected";
        await store.run("UPDATE organization_publication_versions SET status=?,note=? WHERE publication_id=? AND version=?", status, input.note, publication.id, requested);
        if (previous.status !== status && publication.submitted_by !== actor.id)
          await organizationNotice(store, id, [publication.submitted_by], status === "approved" ? "resource.approved" : "resource.rejected",
            String(publication.title), resourceTab[kind], publication.id);
      }
      await audit(store, actor, "publication." + input.decision, publication.id, id);
    });
    return c.json({ ok: true });
  });
  app.delete(item, async c => {
    const actor = c.get("actor"), id = c.req.param("id"), kind = kindSchema.parse(c.req.param("kind"));
    await store.transaction(async () => {
      await enterpriseAccess(store, actor, id, true);
      const publication = await read(id, kind, c.req.param("publicationId"), true);
      if (!publication.published_version) return;
      await store.run("UPDATE organization_publications SET published_version=NULL WHERE id=?", publication.id);
      if (kind === "mcp") await store.run("UPDATE enterprise_mcp SET enabled=FALSE WHERE id=? AND enterprise_id=?", publication.id, id);
      await audit(store, actor, "publication.archive", publication.id, id);
    });
    return c.json({ ok: true });
  });
}
