import { projectListings } from "./project-space.js";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { App } from "./http.js";
import type { Store } from "./database.js";
import type { Config } from "./config.js";
import {
  audit,
  departmentAccess,
  enterpriseAccess,
  now,
  projectAccess,
  shareAccess,
  uid,
} from "./domain.js";
import { ServiceError } from "./errors.js";
import { dropAudience } from "./grants.js";

const name = z.string().trim().min(1).max(120);
const email = z.email().transform((v) => v.toLowerCase());
const hash = (v: string) => createHash("sha256").update(v).digest("hex");

/** Enterprise identity is an association on projects, not another workspace runtime. */
export function mountEnterprise(app: App, store: Store, config: Config) {
  app.get("/api/v1/enterprises", async (c) => {
    const actor = c.get("actor");
    const items =
      actor.role === "admin"
        ? await store.all(
            "SELECT e.*, (SELECT COUNT(*) FROM members m WHERE m.enterprise_id=e.id) AS member_count FROM enterprises e ORDER BY created_at DESC LIMIT 200",
          )
        : await store.all(
            "SELECT e.*,m.role,(SELECT COUNT(*) FROM members x WHERE x.enterprise_id=e.id) AS member_count FROM enterprises e JOIN members m ON m.enterprise_id=e.id WHERE m.user_id=? ORDER BY e.created_at DESC LIMIT 200",
            actor.id,
          );
    return c.json({ items });
  });
  app.post("/api/v1/enterprises", async (c) => {
    const input = z.object({ name }).parse(await c.req.json());
    const actor = c.get("actor"),
      id = uid();
    await store.transaction(async () => {
      await store.run(
        "INSERT INTO enterprises VALUES(?,?,?,?)",
        id,
        input.name,
        actor.id,
        now(),
      );
      await store.run(
        "INSERT INTO members VALUES(?,?,?,NULL,?)",
        id,
        actor.id,
        "owner",
        now(),
      );
      await audit(store, actor, "enterprise.create", id);
    });
    return c.json({ id, ...input }, 201);
  });
  app.get("/api/v1/enterprises/:id", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    const enterprise = await enterpriseAccess(store, actor, id);
    return c.json({
      enterprise,
      canManage:
        actor.role === "admin" ||
        ["owner", "admin"].includes(
          String(
            (
              await store.one(
                "SELECT role FROM members WHERE enterprise_id=? AND user_id=?",
                id,
                actor.id,
              )
            )?.role,
          ),
        ),
      members: await store.all(
        'SELECT m.*,u.name,u.email FROM members m JOIN "user" u ON u.id=m.user_id WHERE m.enterprise_id=? ORDER BY m.created_at LIMIT 500',
        id,
      ),
      departments: await store.all(
        "SELECT * FROM departments WHERE enterprise_id=? ORDER BY name LIMIT 200",
        id,
      ),
      invitations: await store.all(
        "SELECT id,email,role,department_id,expires_at,accepted_by,revoked_at FROM invitations WHERE enterprise_id=? ORDER BY created_at DESC LIMIT 100",
        id,
      ),
    });
  });
  app.post("/api/v1/enterprises/:id/departments", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    await enterpriseAccess(store, actor, id, true);
    const input = z.object({ name }).parse(await c.req.json()),
      departmentId = uid();
    await store.transaction(async () => {
      await store.run(
        "INSERT INTO departments VALUES(?,?,?)",
        departmentId,
        id,
        input.name,
      );
      await audit(store, actor, "department.create", departmentId);
    });
    return c.json({ id: departmentId, name: input.name }, 201);
  });
  app.patch("/api/v1/enterprises/:id/members/:userId", async (c) => {
    const id = c.req.param("id"),
      target = c.req.param("userId"),
      actor = c.get("actor");
    const enterprise = await enterpriseAccess(store, actor, id, true);
    if (target === enterprise.owner_id)
      throw new ServiceError(
        "OWNER_IMMUTABLE",
        409,
        "组织所有者不能在成员列表中修改",
      );
    const input = z
      .object({
        role: z.enum(["member", "admin"]),
        departmentId: z.string().nullable().default(null),
      })
      .parse(await c.req.json());
    await departmentAccess(store, id, input.departmentId);
    await store.transaction(async () => {
      const result = await store.run(
        "UPDATE members SET role=?,department_id=? WHERE enterprise_id=? AND user_id=?",
        input.role,
        input.departmentId,
        id,
        target,
      );
      if (!result.changes) throw new ServiceError("MEMBER_NOT_FOUND", 404);
      await audit(store, actor, "member.update", target);
    });
    return c.json({ ok: true });
  });
  app.delete("/api/v1/enterprises/:id/members/:userId", async (c) => {
    const id = c.req.param("id"),
      target = c.req.param("userId"),
      actor = c.get("actor");
    const enterprise = await enterpriseAccess(store, actor, id, true);
    if (target === enterprise.owner_id)
      throw new ServiceError("OWNER_IMMUTABLE", 409);
    await store.transaction(async () => {
      await store.run(
        "DELETE FROM members WHERE enterprise_id=? AND user_id=?",
        id,
        target,
      );
      await dropAudience(store, id, "member", target);
      await audit(store, actor, "member.remove", target);
    });
    return c.json({ ok: true });
  });
  app.post("/api/v1/enterprises/:id/invitations", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    await enterpriseAccess(store, actor, id, true);
    const input = z
      .object({
        email,
        role: z.enum(["admin", "member"]).default("member"),
        departmentId: z.string().nullable().default(null),
        days: z.number().int().min(1).max(30).default(7),
      })
      .parse(await c.req.json());
    await departmentAccess(store, id, input.departmentId);
    const token = randomBytes(32).toString("base64url"),
      invitationId = uid();
    await store.transaction(async () => {
      await store.run(
        "INSERT INTO invitations VALUES(?,?,?,?,?,?,?,NULL,NULL,?)",
        invitationId,
        id,
        hash(token),
        input.email,
        input.role,
        input.departmentId,
        now() + input.days * 86400000,
        now(),
      );
      await audit(store, actor, "invitation.create", invitationId);
    });
    return c.json(
      { id: invitationId, url: config.origin + "/invite/" + token },
      201,
    );
  });
  app.delete("/api/v1/enterprises/:id/invitations/:inviteId", async (c) => {
    const actor = c.get("actor"),
      id = c.req.param("id");
    await enterpriseAccess(store, actor, id, true);
    await store.transaction(async () => {
      await store.run(
        "UPDATE invitations SET revoked_at=? WHERE id=? AND enterprise_id=?",
        now(),
        c.req.param("inviteId"),
        id,
      );
      await audit(store, actor, "invitation.revoke", c.req.param("inviteId"));
    });
    return c.json({ ok: true });
  });
  app.post("/api/v1/invitations/:token/accept", async (c) => {
    const actor = c.get("actor");
    if (!actor.emailVerified)
      throw new ServiceError(
        "EMAIL_NOT_VERIFIED",
        403,
        "请先验证被邀请的邮箱，再接受邀请",
      );
    return c.json(
      await store.transaction(async () => {
        const invitation = await store.one(
          "SELECT * FROM invitations WHERE token_hash=?",
          hash(c.req.param("token")),
        );
        if (
          !invitation ||
          invitation.revoked_at ||
          Number(invitation.expires_at) <= now()
        )
          throw new ServiceError(
            "INVITATION_EXPIRED",
            404,
            "邀请不存在或已失效",
          );
        if (
          String(invitation.email).toLowerCase() !== actor.email.toLowerCase()
        )
          throw new ServiceError(
            "INVITATION_EMAIL_MISMATCH",
            403,
            "请使用被邀请的邮箱登录",
          );
        if (invitation.accepted_by) {
          if (invitation.accepted_by !== actor.id)
            throw new ServiceError("INVITATION_USED", 409);
          return { enterpriseId: invitation.enterprise_id, duplicate: true };
        }
        await departmentAccess(
          store,
          String(invitation.enterprise_id),
          invitation.department_id as string | null,
        );
        await store.run(
          "INSERT INTO members VALUES(?,?,?,?,?) ON CONFLICT(enterprise_id,user_id) DO NOTHING",
          invitation.enterprise_id,
          actor.id,
          invitation.role,
          invitation.department_id,
          now(),
        );
        await store.run(
          "UPDATE invitations SET accepted_by=? WHERE id=?",
          actor.id,
          invitation.id,
        );
        await audit(store, actor, "invitation.accept", String(invitation.id));
        return { enterpriseId: invitation.enterprise_id };
      }),
    );
  });
  app.get("/api/v1/projects", async (c) => {
    const actor = c.get("actor"),
      enterprise = c.req.query("enterpriseId");
    if (enterprise) await enterpriseAccess(store, actor, enterprise);
    const items = await projectListings(store, actor, enterprise);
    return c.json({ items });
  });
  app.post("/api/v1/projects", async (c) => {
    const input = z
      .object({
        title: name,
        enterpriseId: z.string().nullable().default(null),
        nativeId: z.string().max(200).nullable().default(null),
      })
      .parse(await c.req.json());
    const actor = c.get("actor"),
      id = uid();
    return await store.transaction(async () => {
      if (input.enterpriseId)
        await enterpriseAccess(store, actor, input.enterpriseId);
      const previous = input.nativeId
        ? await store.one(
            "SELECT * FROM projects WHERE owner_id=? AND native_id=?",
            actor.id,
            input.nativeId,
          )
        : undefined;
      if (previous) {
        if (previous.enterprise_id !== input.enterpriseId)
          throw new ServiceError(
            "PROJECT_ALREADY_LINKED",
            409,
            "项目已有归属，请编辑现有项目",
          );
        return c.json({ id: previous.id, ...input });
      }
      await store.run(
        "INSERT INTO projects(id,owner_id,enterprise_id,title,native_id,created_at) VALUES(?,?,?,?,?,?)",
        id,
        actor.id,
        input.enterpriseId,
        input.title,
        input.nativeId,
        now(),
      );
      return c.json({ id, ...input }, 201);
    });
  });
  app.patch("/api/v1/projects/:id", async (c) => {
    const input = z
      .object({ enterpriseId: z.string().nullable(), title: name.optional() })
      .parse(await c.req.json());
    const actor = c.get("actor"),
      id = c.req.param("id");
    await store.transaction(async () => {
      const project = await projectAccess(store, actor, id, true);
      if (input.enterpriseId)
        await enterpriseAccess(store, actor, input.enterpriseId);
      if (project.enterprise_id !== input.enterpriseId)
        await store.run(
          "UPDATE shares SET revoked_at=? WHERE project_id=? AND revoked_at IS NULL",
          now(),
          id,
        );
      if (project.enterprise_id !== input.enterpriseId)
        await store.run("DELETE FROM project_grants WHERE project_id=?", id);
      await store.run(
        "UPDATE projects SET enterprise_id=?,title=? WHERE id=?",
        input.enterpriseId,
        input.title ?? project.title,
        id,
      );
      await audit(store, actor, "project.update", id);
    });
    return c.json({ ok: true });
  });
  app.get("/api/v1/shares", async (c) => {
    const actor = c.get("actor");
    return c.json({
      items: await store.all(
        "SELECT s.id,s.title,s.project_id,s.owner_id,s.visibility,s.created_at,p.enterprise_id,p.title AS project_title,e.name AS enterprise_name FROM shares s JOIN projects p ON p.id=s.project_id LEFT JOIN enterprises e ON e.id=p.enterprise_id WHERE s.revoked_at IS NULL AND (p.enterprise_id IS NULL OR EXISTS(SELECT 1 FROM members m WHERE m.enterprise_id=p.enterprise_id AND m.user_id=?) OR ?='admin') AND (s.owner_id=? OR ?='admin' OR EXISTS(SELECT 1 FROM share_members sm WHERE sm.share_id=s.id AND sm.user_id=?) OR (s.visibility='enterprise' AND EXISTS(SELECT 1 FROM members m WHERE m.enterprise_id=p.enterprise_id AND m.user_id=?))) ORDER BY s.created_at DESC LIMIT 200",
        actor.id,
        actor.role,
        actor.id,
        actor.role,
        actor.id,
        actor.id,
      ),
    });
  });
  app.post("/api/v1/shares", () => {
    throw new ServiceError(
      "NATIVE_SHARING_REQUIRED",
      410,
      "请使用 DSH 原生会话分享",
    );
  });
  app.get("/api/v1/shares/:id", async (c) => {
    const actor = c.get("actor"),
      share = await shareAccess(store, actor, c.req.param("id"));
    return c.json({
      ...share,
      transcript: JSON.parse(String(share.transcript)),
    });
  });
  app.post("/api/v1/shares/:id/comments", () => {
    throw new ServiceError("COMMENTS_REMOVED", 410);
  });
  app.delete("/api/v1/shares/:id", async (c) => {
    const actor = c.get("actor"),
      share = await shareAccess(store, actor, c.req.param("id"));
    if (share.owner_id !== actor.id && actor.role !== "admin")
      throw new ServiceError("SHARE_FORBIDDEN", 403);
    await store.run(
      "UPDATE shares SET revoked_at=? WHERE id=?",
      now(),
      share.id,
    );
    return c.json({ ok: true });
  });
}
