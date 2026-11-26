import { z } from "zod";
import type { Store } from "./database.js";
import type { App } from "./http.js";
import { audit, now } from "./domain.js";
import { ServiceError } from "./errors.js";
import { organizationNotice } from "./organization-notice.js";
import { audienceSchema } from "./grants.js";

const id = z.string().min(1).max(200);
const transcript = z.array(z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(500_000),
}).strict()).min(1).max(200).refine(messages => messages.some(message => message.role === "user") &&
  Buffer.byteLength(JSON.stringify(messages)) <= 500_000);
const fields = {
  requestId: z.uuid(), title: z.string().trim().min(1).max(120),
  transcript,
};
const input = z.union([
  z.strictObject({ ...fields, recipients: z.array(id).min(1).max(100).refine(ids => new Set(ids).size === ids.length) }),
  z.strictObject({ ...fields, audience: audienceSchema }),
]);

/** No global-admin bypass: reading shared text requires active membership and an explicit recipient grant. */
export function mountOrganizationConversations(app: App, store: Store) {
  const base = "/api/v1/enterprises/:id/conversation-shares";
  const item = `${base}/:shareId` as const;
  const assertMember = async (db: Store, enterprise: string, user: string) => {
    const member = await db.one<{role: string}>("SELECT role FROM members WHERE enterprise_id=? AND user_id=? AND status='active'", enterprise, user);
    if (!member)
      throw new ServiceError("ENTERPRISE_FORBIDDEN", 403);
    return member;
  };
  app.get(base, async c => {
    const enterprise = c.req.param("id"), actor = c.get("actor");
    await assertMember(store, enterprise, actor.id);
    const items = await store.all(`
      SELECT s.id,s.title,s.owner_id,s.created_at,COALESCE(m.display_name,u.name) AS owner_name
      FROM organization_conversation_shares s
      JOIN members m ON m.enterprise_id=s.enterprise_id AND m.user_id=s.owner_id AND m.status='active'
      JOIN "user" u ON u.id=s.owner_id
      WHERE s.enterprise_id=? AND (s.owner_id=? OR EXISTS (
        SELECT 1 FROM organization_conversation_recipients r WHERE r.share_id=s.id AND r.user_id=?
      )) ORDER BY s.created_at DESC,s.id LIMIT 200`, enterprise, actor.id, actor.id);
    return c.json({ items });
  });
  app.post(base, async c => {
    const enterprise = c.req.param("id"), actor = c.get("actor");
    const data = input.parse(await c.req.json());
    await store.transaction(async () => {
      const member = await assertMember(store, enterprise, actor.id);
      const audience = "audience" in data ? data.audience : undefined;
      const employees = [...new Set("recipients" in data ? data.recipients : data.audience.members)];
      const departments = [...new Set(audience?.departments ?? [])];
      const adminsOnly = audience !== undefined && !audience.all && !employees.length && !departments.length;
      if ((audience?.all || departments.length || adminsOnly) && member.role !== "owner" && member.role !== "admin")
        throw new ServiceError("ENTERPRISE_FORBIDDEN", 403);
      if (employees.includes(actor.id)) throw new ServiceError("SHARE_RECIPIENT_INVALID", 400);
      const direct = await store.all<{user_id: string}>(
        "SELECT user_id FROM members WHERE enterprise_id=? AND status='active' AND user_id=ANY(?::text[])",
        enterprise, employees,
      );
      if (direct.length !== employees.length) throw new ServiceError("SHARE_RECIPIENT_INVALID", 400);
      if (departments.length && (await store.all(
        "SELECT id FROM departments WHERE enterprise_id=? AND id=ANY(?::text[])", enterprise, departments,
      )).length !== departments.length) throw new ServiceError("DEPARTMENT_MISMATCH", 400);
      const scoped = audience && (audience.all || adminsOnly || departments.length) ? await store.all<{user_id: string}>(
        `WITH RECURSIVE selected_departments(id) AS (
          SELECT id FROM departments WHERE enterprise_id=? AND id=ANY(?::text[])
          UNION SELECT d.id FROM departments d JOIN selected_departments p ON d.parent_id=p.id
            WHERE d.enterprise_id=? AND ?
        ) SELECT m.user_id FROM members m WHERE m.enterprise_id=? AND m.status='active' AND m.user_id<>?
          AND (? OR (? AND m.role IN ('owner','admin')) OR m.department_id IN (SELECT id FROM selected_departments))`,
        enterprise, departments, enterprise, audience.includeSubdepartments === true,
        enterprise, actor.id, audience.all, adminsOnly,
      ) : [];
      const recipients = [...new Set([...employees, ...scoped.map(row => row.user_id)])];
      const created = await store.one(
        `INSERT INTO organization_conversation_shares(id,enterprise_id,owner_id,title,transcript,created_at)
         VALUES(?,?,?,?,?::jsonb,?) ON CONFLICT(id) DO NOTHING RETURNING id`,
        data.requestId, enterprise, actor.id, data.title, JSON.stringify(data.transcript), now(),
      );
      if (!created) {
        if (await store.one("SELECT id FROM organization_conversation_shares WHERE id=? AND enterprise_id=? AND owner_id=?", data.requestId, enterprise, actor.id)) return;
        throw new ServiceError("SHARE_NOT_FOUND", 404);
      }
      await store.run(
        "INSERT INTO organization_conversation_recipients(share_id,user_id) SELECT ?, jsonb_array_elements_text(?::jsonb)",
        data.requestId, JSON.stringify(recipients),
      );
      await organizationNotice(store, enterprise, recipients, "conversation.shared", data.title, "messages", data.requestId);
      await audit(store, actor, "conversation.share", data.requestId, enterprise);
    });
    return c.json({ id: data.requestId }, 201);
  });
  app.get(item, async c => {
    const enterprise = c.req.param("id"), share = c.req.param("shareId"), actor = c.get("actor");
    await assertMember(store, enterprise, actor.id);
    const row = await store.one(`
      SELECT s.id,s.title,s.transcript::text AS transcript FROM organization_conversation_shares s
      JOIN members m ON m.enterprise_id=s.enterprise_id AND m.user_id=s.owner_id AND m.status='active'
      WHERE s.enterprise_id=? AND s.id=? AND (s.owner_id=? OR EXISTS (
        SELECT 1 FROM organization_conversation_recipients r WHERE r.share_id=s.id AND r.user_id=?
      ))`, enterprise, share, actor.id, actor.id);
    if (!row) throw new ServiceError("SHARE_NOT_FOUND", 404);
    return c.json({ ...row, transcript: JSON.parse(String(row.transcript)) });
  });
  app.delete(item, async c => {
    const enterprise = c.req.param("id"), share = c.req.param("shareId"), actor = c.get("actor");
    await store.transaction(async () => {
      await assertMember(store, enterprise, actor.id);
      if (!await store.one("DELETE FROM organization_conversation_shares WHERE id=? AND enterprise_id=? AND owner_id=? RETURNING id", share, enterprise, actor.id))
        throw new ServiceError("SHARE_NOT_FOUND", 404);
      await audit(store, actor, "conversation.revoke", share, enterprise);
    });
    return c.json({ ok: true });
  });
}
