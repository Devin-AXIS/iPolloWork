import type { OrganizationMembers } from "./organization-members.js";
import type { CloudProjects } from './cloud-projects.js';
import { projectListings } from "./project-space.js";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { App } from "./http.js";
import type { Store } from "./database.js";
import type { Config } from "./config.js";
import {
  audit,
  canDeleteProject,
  departmentAccess,
  enterpriseAccess,
  isEnterpriseManager,
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
const tabs = z.enum(["analytics", "projects", "members", "departments", "templates", "plugins", "skills", "mcp", "models", "messages", "activity", "settings"]);
const tabOrder = z.array(tabs).max(12).refine(items => new Set(items).size === items.length);
const logo = z.string().max(48_000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/);

export async function checkDepartmentParent(store: Store, enterpriseId: string, parentId?: string | null, departmentId?: string) {
  await store.one("SELECT id FROM enterprises WHERE id=? FOR UPDATE", enterpriseId);
  await departmentAccess(store, enterpriseId, parentId);
  if (!parentId || !departmentId) return;
  if (await store.one(
    `WITH RECURSIVE ancestors(id,parent_id) AS (
       SELECT id,parent_id FROM departments WHERE id=? AND enterprise_id=?
       UNION SELECT d.id,d.parent_id FROM departments d JOIN ancestors a ON d.id=a.parent_id WHERE d.enterprise_id=?
     ) SELECT id FROM ancestors WHERE id=?`,
    parentId, enterpriseId, enterpriseId, departmentId,
  )) throw new ServiceError("DEPARTMENT_CYCLE", 409, "上级部门不能是自身或下属部门");
}

/** Enterprise identity is an association on projects, not another workspace runtime. */
export function mountEnterprise(app: App, store: Store, config: Config, cloud?: CloudProjects, organizationMembers?: OrganizationMembers) {
  app.get("/api/v1/enterprises", async (c) => {
    const actor = c.get("actor");
    const items =
      actor.role === "admin"
        ? await store.all(
            "SELECT e.id,e.name,e.logo,e.owner_id,e.created_at, (SELECT COUNT(*) FROM members m WHERE m.enterprise_id=e.id) AS member_count FROM enterprises e ORDER BY created_at DESC LIMIT 200",
          )
        : await store.all(
            "SELECT e.id,e.name,e.logo,e.owner_id,e.created_at,m.role,(SELECT COUNT(*) FROM members x WHERE x.enterprise_id=e.id) AS member_count FROM enterprises e JOIN members m ON m.enterprise_id=e.id WHERE m.user_id=? AND m.status='active' ORDER BY e.created_at DESC LIMIT 200",
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
      await audit(store, actor, "enterprise.create", id, id);
    });
    return c.json({ id, ...input }, 201);
  });
  app.get("/api/v1/enterprises/:id", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    const enterprise = await enterpriseAccess(store, actor, id);
    const canManage = await isEnterpriseManager(store, actor, id);
    return c.json({
      enterprise,
      canManage,
      members: await store.all(
        'SELECT m.*,COALESCE(m.display_name,u.name) AS name,u.email FROM members m JOIN "user" u ON u.id=m.user_id WHERE m.enterprise_id=? ORDER BY m.created_at LIMIT 500',
        id,
      ),
      departments: await store.all(
        "SELECT * FROM departments WHERE enterprise_id=? ORDER BY name LIMIT 200",
        id,
      ),
      invitations: canManage ? await store.all(
        "SELECT id,email,invitee_name,employee_number,role,department_id,expires_at,accepted_by,revoked_at,project_id,project_role FROM invitations WHERE enterprise_id=? AND accepted_by IS NULL AND revoked_at IS NULL ORDER BY created_at DESC",
        id,
      ) : [],
    });
  });
  app.patch("/api/v1/enterprises/:id", async (c) => {
    const id = c.req.param("id"), actor = c.get("actor");
    const input = z.object({
      name: name.optional(),
      description: z.string().trim().max(1000).optional(),
      tabOrder: tabOrder.optional(),
      logo: logo.nullable().optional(),
    }).strict().refine(value => Object.keys(value).length > 0).parse(await c.req.json());
    const saved = await store.transaction(async () => {
      await store.one("SELECT id FROM enterprises WHERE id=? FOR UPDATE", id);
      const enterprise = await enterpriseAccess(store, actor, id, true);
      const data = {
        id, name: input.name ?? enterprise.name,
        description: input.description ?? String(enterprise.description),
        tabOrder: input.tabOrder ?? tabOrder.parse(JSON.parse(String(enterprise.tab_order))),
        logo: input.logo === undefined ? enterprise.logo : input.logo,
      };
      const order = JSON.stringify(data.tabOrder);
      if (data.name !== enterprise.name || data.description !== enterprise.description || order !== enterprise.tab_order || data.logo !== enterprise.logo) {
        await store.run("UPDATE enterprises SET name=?,description=?,tab_order=?,logo=? WHERE id=?", data.name, data.description, order, data.logo, id);
        await audit(store, actor, "enterprise.update", id, id);
      }
      return data;
    });
    return c.json(input.description === undefined && input.tabOrder === undefined && input.logo === undefined
      ? { id:saved.id, name:saved.name } : saved);
  });
  app.get("/api/v1/enterprises/:id/activity", async (c) => {
    const id = c.req.param("id"), actor = c.get("actor");
    const search = z.string().trim().max(120).optional().parse(c.req.query("actor")) ?? "";
    await enterpriseAccess(store, actor, id, true);
    return c.json({ items: await store.all(
      `SELECT a.id,a.action,a.created_at,COALESCE(m.display_name,u.name) AS actor
       FROM audit a LEFT JOIN "user" u ON u.id=a.actor_id LEFT JOIN members m ON m.enterprise_id=? AND m.user_id=a.actor_id
       WHERE (a.enterprise_id=? OR (a.enterprise_id IS NULL AND a.target=? AND a.action IN('enterprise.create','enterprise.update')))
       AND (?='' OR strpos(lower(COALESCE(m.display_name,u.name,'')),lower(?))>0 OR strpos(lower(COALESCE(m.employee_number,'')),lower(?))>0)
       ORDER BY a.id DESC LIMIT 100`,
      id, id, id, search, search, search,
    ) });
  });
  app.post("/api/v1/enterprises/:id/departments", async (c) => {
    const id = c.req.param("id"),
      actor = c.get("actor");
    await enterpriseAccess(store, actor, id, true);
    const input = z.object({ name, parentId: z.string().nullable().optional() }).parse(await c.req.json()),
      departmentId = uid();
    await store.transaction(async () => {
      await checkDepartmentParent(store, id, input.parentId);
      await store.run(
        "INSERT INTO departments(id,enterprise_id,name,parent_id) VALUES(?,?,?,?)",
        departmentId,
        id,
        input.name,
        input.parentId ?? null,
      );
      await audit(store, actor, "department.create", departmentId, id);
    });
    return c.json({ id: departmentId, name: input.name }, 201);
  });
  app.patch("/api/v1/enterprises/:id/members/:userId", async (c) => {
    const id = c.req.param("id"),
      target = c.req.param("userId"),
      actor = c.get("actor");
    const input = z
      .object({
        role: z.enum(["member", "admin"]),
        status: z.enum(["active", "suspended"]).optional(),
        departmentId: z.string().nullable().default(null),
        employeeNumber: z.string().trim().min(1).max(64).nullable().optional(),
        displayName: name.nullable().optional(),
      })
      .parse(await c.req.json());
    await store.transaction(async () => {
      await store.one("SELECT id FROM enterprises WHERE id=? FOR NO KEY UPDATE", id);
      const enterprise = await enterpriseAccess(store, actor, id, true);
      if (target === enterprise.owner_id)
        throw new ServiceError("OWNER_IMMUTABLE", 409, "组织所有者不能在成员列表中修改");
      if (target === actor.id && input.status === "suspended")
        throw new ServiceError("SELF_SUSPENSION", 409, "不能停用自己的组织成员资格");
      await departmentAccess(store, id, input.departmentId);
      const previous = await store.one("SELECT role,department_id,status FROM members WHERE enterprise_id=? AND user_id=? FOR UPDATE", id, target);
      if (!previous) throw new ServiceError("MEMBER_NOT_FOUND", 404);
      await store.run(
        "UPDATE members SET role=?,department_id=?,status=COALESCE(?,status),employee_number=CASE WHEN ? THEN ? ELSE employee_number END,display_name=CASE WHEN ? THEN ? ELSE display_name END WHERE enterprise_id=? AND user_id=?",
        input.role,
        input.departmentId,
        input.status ?? null,
        input.employeeNumber !== undefined,
        input.employeeNumber ?? null,
        input.displayName !== undefined,
        input.displayName ?? null,
        id,
        target,
      );
      await organizationMembers?.event(id,target,"member.updated",previous);
      await audit(store, actor, "member.update", target, id);
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
      const removed = await store.run(
        "DELETE FROM members WHERE enterprise_id=? AND user_id=?",
        id,
        target,
      );
      if (!removed.changes) return;
      await store.run("DELETE FROM organization_conversation_recipients WHERE user_id=? AND share_id IN (SELECT id FROM organization_conversation_shares WHERE enterprise_id=?)", target, id);
      await store.run("DELETE FROM organization_conversation_shares WHERE enterprise_id=? AND owner_id=?", id, target);
      await store.run("DELETE FROM settings WHERE split_part(key,'/',1)='member-service-key' AND split_part(key,'/',3)=? AND split_part(key,'/',2) IN (SELECT service_id FROM enterprise_services WHERE enterprise_id=?)", target, id);
      await store.run("DELETE FROM settings WHERE split_part(key,'/',1)='enterprise-mcp-member' AND split_part(key,'/',3)=? AND split_part(key,'/',2) IN (SELECT id FROM enterprise_mcp WHERE enterprise_id=?)",target,id);
      await store.run("DELETE FROM enterprise_mcp_oauth_pending WHERE user_id=? AND mcp_id IN (SELECT id FROM enterprise_mcp WHERE enterprise_id=?)",target,id);
      await dropAudience(store, id, "member", target);
      await organizationMembers?.event(id,target,"member.removed");
      await audit(store, actor, "member.remove", target, id);
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
        projectId: z.string().optional(),
        projectRole: z.enum(["view", "participate", "maintain"]).default("view"),
      })
      .parse(await c.req.json());
    await departmentAccess(store, id, input.departmentId);
    if (input.projectId) {
      const project = await projectAccess(store, actor, input.projectId, true);
      if (project.enterprise_id !== id) throw new ServiceError("PROJECT_ORGANIZATION_MISMATCH", 400, "空间不属于该组织");
      if (input.role !== "member" || input.departmentId)
        throw new ServiceError("INVITATION_SCOPE_INVALID", 400, "空间邀请仅授予普通成员身份，不附加部门权限");
    }
    const token = randomBytes(32).toString("base64url"),
      invitationId = uid();
    await store.transaction(async () => {
      await store.run(
        "INSERT INTO invitations(id,enterprise_id,token_hash,email,role,department_id,expires_at,accepted_by,revoked_at,created_at,project_id,project_role) VALUES(?,?,?,?,?,?,?,NULL,NULL,?,?,?)",
        invitationId,
        id,
        hash(token),
        input.email,
        input.role,
        input.departmentId,
        now() + input.days * 86400000,
        now(),
        input.projectId ?? null,
        input.projectId ? input.projectRole : null,
      );
      await audit(store, actor, "invitation.create", invitationId, id);
    });
    const url = config.origin + "/invite/" + token;
    return c.json({ id: invitationId, url, code: token, serviceAddress: config.origin, delivery: "link" }, 201);
  });
  app.post("/api/v1/enterprises/:id/join-codes", async (c) => {
    const enterpriseId = c.req.param("id");
    const actor = c.get("actor");
    const input = z.object({
      departmentId: z.string().min(1).max(200).nullable().optional(),
      days: z.number().int().min(1).max(30).nullable().optional(),
      displayName: name.optional(),
      projectId: z.string().min(1).max(200).optional(),
      projectRole: z.enum(["view", "participate", "maintain"]).optional(),
    }).strict().refine(value => value.projectId ? !value.departmentId && !value.displayName : !value.projectRole).parse(await c.req.json());
    const code = "ipw_" + randomBytes(32).toString("base64url");
    const invitationId = uid();
    const createdAt = now();
    const days = input.projectId ? (input.days ?? 7) : input.days;
    const expiresAt = days == null ? null : createdAt + days * 86400000;
    await store.transaction(async () => {
      await enterpriseAccess(store, actor, enterpriseId, true);
      await departmentAccess(store, enterpriseId, input.departmentId);
      if (input.projectId) {
        const project = await projectAccess(store, actor, input.projectId, true);
        if (project.enterprise_id !== enterpriseId)
          throw new ServiceError("PROJECT_ORGANIZATION_MISMATCH", 400, "空间不属于该组织");
      }
      await store.run(
        "INSERT INTO invitations(id,enterprise_id,token_hash,role,department_id,expires_at,created_at,project_id,project_role,invitee_name) VALUES(?,?,?,'member',?,?,?,?,?,?)",
        invitationId, enterpriseId, hash(code), input.departmentId ?? null, expiresAt, createdAt,
        input.projectId ?? null, input.projectId ? (input.projectRole ?? "view") : null, input.displayName ?? null,
      );
      await audit(store, actor, "invitation.create", invitationId, enterpriseId);
    });
    return c.json({ id: invitationId, code, expiresAt, serviceAddress: config.origin }, 201);
  });
  app.patch("/api/v1/enterprises/:id/join-codes/:codeId", async (c) => {
    const enterpriseId = c.req.param("id"), codeId = c.req.param("codeId"), actor = c.get("actor");
    const { days } = z.object({ days: z.number().int().min(1).max(30).nullable() }).strict().parse(await c.req.json());
    const expiresAt = days === null ? null : now() + days * 86400000;
    await store.transaction(async () => {
      await store.one("SELECT id FROM enterprises WHERE id=? FOR NO KEY UPDATE", enterpriseId);
      await enterpriseAccess(store, actor, enterpriseId, true);
      const pending = await store.one(
        "SELECT employee_number FROM invitations WHERE id=? AND enterprise_id=? AND email IS NULL AND project_id IS NULL AND revoked_at IS NULL AND accepted_by IS NULL FOR UPDATE",
        codeId, enterpriseId,
      );
      if (!pending) throw new ServiceError("INVITATION_NOT_EDITABLE", 409, "仅可修改未使用、未撤销的员工邀请码");
      if (pending.employee_number && await store.one(
        `SELECT 1 FROM members WHERE enterprise_id=? AND lower(employee_number)=lower(?)
         UNION ALL SELECT 1 FROM invitations WHERE enterprise_id=? AND lower(employee_number)=lower(?)
           AND id<>? AND accepted_by IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)`,
        enterpriseId, pending.employee_number, enterpriseId, pending.employee_number, codeId, now(),
      )) throw new ServiceError("INVITATION_EMPLOYEE_NUMBER_IN_USE", 409, "该工号已分配或已有有效邀请码");
      await store.run("UPDATE invitations SET expires_at=? WHERE id=?", expiresAt, codeId);
      await audit(store, actor, "invitation.expiry.update", codeId, enterpriseId);
    });
    return c.json({ expiresAt });
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
      await audit(store, actor, "invitation.revoke", c.req.param("inviteId"), id);
    });
    return c.json({ ok: true });
  });
  app.post("/api/v1/invitations/:token/accept", async (c) => {
    const actor = c.get("actor");
    return c.json(
      await store.transaction(async () => {
        const invitation = await store.one(
          "SELECT * FROM invitations WHERE token_hash=? FOR UPDATE",
          hash(c.req.param("token")),
        );
        if (
          !invitation ||
          invitation.revoked_at ||
          (invitation.expires_at !== null && Number(invitation.expires_at) <= now())
        )
          throw new ServiceError(
            "INVITATION_EXPIRED",
            404,
            "邀请不存在或已失效",
          );
        if (
          invitation.email && String(invitation.email).toLowerCase() !== actor.email.toLowerCase()
        )
          throw new ServiceError(
            "INVITATION_EMAIL_MISMATCH",
            403,
            "请使用被邀请的邮箱登录",
          );
        const existing = await store.one("SELECT status FROM members WHERE enterprise_id=? AND user_id=? FOR NO KEY UPDATE", invitation.enterprise_id, actor.id);
        if (existing?.status === "suspended")
          throw new ServiceError("MEMBER_SUSPENDED", 403, "组织成员资格已停用，请联系管理员");
        if (invitation.accepted_by) {
          if (invitation.accepted_by !== actor.id)
            throw new ServiceError("INVITATION_USED", 409);
          if (!existing) throw new ServiceError("INVITATION_USED", 409, "邀请已使用，请联系管理员重新邀请");
          return { enterpriseId: invitation.enterprise_id, duplicate: true };
        }
        if (invitation.project_id) {
          const project = await store.one("SELECT enterprise_id FROM projects WHERE id=?", invitation.project_id);
          if (project?.enterprise_id !== invitation.enterprise_id)
            throw new ServiceError("INVITATION_EXPIRED", 404, "空间归属已变更，请重新获取邀请");
        }
        await departmentAccess(
          store,
          String(invitation.enterprise_id),
          invitation.department_id as string | null,
        );
        await store.run(
          "INSERT INTO members(enterprise_id,user_id,role,department_id,created_at,employee_number,display_name) VALUES(?,?,?,?,?,?,?) ON CONFLICT(enterprise_id,user_id) DO NOTHING",
          invitation.enterprise_id,
          actor.id,
          invitation.role,
          invitation.department_id,
          now(),
          invitation.employee_number,
          invitation.invitee_name,
        );
        if (invitation.project_id) {
          await store.run(
            "INSERT INTO project_grants(project_id,kind,subject_id,role) VALUES(?,'member',?,?) ON CONFLICT(project_id,kind,subject_id) DO NOTHING",
            invitation.project_id, actor.id, invitation.project_role,
          );
        }
        await store.run(
          "UPDATE invitations SET accepted_by=? WHERE id=?",
          actor.id,
          invitation.id,
        );
        await organizationMembers?.event(String(invitation.enterprise_id),actor.id,"member.joined");
        await audit(store, actor, "invitation.accept", String(invitation.id), String(invitation.enterprise_id));
        return { enterpriseId: invitation.enterprise_id };
      }),
    );
  });
  app.get("/api/v1/projects", async (c) => {
    const actor = c.get("actor"),
      enterprise = c.req.query("enterpriseId");
    if (enterprise) await enterpriseAccess(store, actor, enterprise);
    const items = await projectListings(store, actor, enterprise);
    const grant=c.get("cloudGrant");
    return c.json({ items:grant?items.filter(item=>item.id===grant.projectId):items });
  });
  app.post("/api/v1/projects", async (c) => {
    const input = z
      .object({
        title: name,
        enterpriseId: z.string().nullable().default(null),
        nativeId: z.string().max(200).nullable().default(null),
        executionMode: z.enum(["local","cloud"]).default("local"),
        creationKey: z.uuid().optional(),
      })
      .parse(await c.req.json());
    const actor = c.get("actor"),
      id = uid();
    if(input.executionMode==='cloud') {
      if(!cloud)throw new ServiceError('CLOUD_DISABLED',503);
      await cloud.requireAvailable();
      if(input.nativeId)throw new ServiceError('CLOUD_NATIVE_ID_FORBIDDEN',400);
    }
    return await store.transaction(async () => {
      if (input.enterpriseId)
        await enterpriseAccess(store, actor, input.enterpriseId);
      if(input.creationKey) {
        await store.run('SELECT pg_advisory_xact_lock(hashtextextended(?,0))',actor.id+input.creationKey);
        const existing=await store.one('SELECT * FROM projects WHERE owner_id=? AND creation_key=?',actor.id,input.creationKey);
        if(existing){
          if(existing.deleted_at != null)throw new ServiceError('PROJECT_NOT_FOUND',404,'项目已删除');
          if(existing.title!==input.title || existing.enterprise_id!==input.enterpriseId || existing.execution_mode!==input.executionMode || existing.native_id!==input.nativeId)throw new ServiceError('PROJECT_CREATION_CONFLICT',409);
          return c.json({id:existing.id,...input});
        }
      }
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
        "INSERT INTO projects(id,owner_id,enterprise_id,title,native_id,created_at,execution_mode,creation_key) VALUES(?,?,?,?,?,?,?,?)",
        id,
        actor.id,
        input.enterpriseId,
        input.title,
        input.nativeId,
        now(),
        input.executionMode,
        input.creationKey ?? null,
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
  app.delete("/api/v1/projects/:id", async (c) => {
    const actor = c.get("actor"), id = c.req.param("id");
    await store.transaction(async () => {
      const project = await projectAccess(store, actor, id, true);
      if (!await canDeleteProject(store, actor, project))
        throw new ServiceError("PROJECT_FORBIDDEN", 403, "没有删除项目的权限");
      const deleted = now();
      await store.run("UPDATE projects SET deleted_at=?,native_id=NULL WHERE id=?", deleted, id);
      await store.run("UPDATE shares SET revoked_at=? WHERE project_id=? AND revoked_at IS NULL", deleted, id);
      await store.run("UPDATE live_shares SET revoked_at=? WHERE project_id=? AND revoked_at IS NULL", deleted, id);
      await store.run("UPDATE invitations SET revoked_at=? WHERE project_id=? AND revoked_at IS NULL AND accepted_by IS NULL", deleted, id);
      await audit(store, actor, "project.delete", id);
    });
    return c.json({ ok: true });
  });
  app.get("/api/v1/shares", async (c) => {
    const actor = c.get("actor");
    return c.json({
      items: await store.all(
        "SELECT s.id,s.title,s.project_id,s.owner_id,s.visibility,s.created_at,p.enterprise_id,p.title AS project_title,e.name AS enterprise_name FROM shares s JOIN projects p ON p.id=s.project_id LEFT JOIN enterprises e ON e.id=p.enterprise_id WHERE s.revoked_at IS NULL AND (p.enterprise_id IS NULL OR EXISTS(SELECT 1 FROM members m WHERE m.enterprise_id=p.enterprise_id AND m.user_id=? AND m.status='active') OR ?='admin') AND (s.owner_id=? OR ?='admin' OR EXISTS(SELECT 1 FROM share_members sm WHERE sm.share_id=s.id AND sm.user_id=?) OR (s.visibility='enterprise' AND EXISTS(SELECT 1 FROM members m WHERE m.enterprise_id=p.enterprise_id AND m.user_id=? AND m.status='active'))) ORDER BY s.created_at DESC LIMIT 200",
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
