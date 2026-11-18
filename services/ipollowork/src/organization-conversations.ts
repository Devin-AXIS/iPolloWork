import { z } from "zod";
import type { Store } from "./database.js";
import type { App } from "./http.js";
import { audit, now } from "./domain.js";
import { ServiceError } from "./errors.js";
import { organizationNotice } from "./organization-notice.js";

const id = z.string().min(1).max(200);
const transcript = z.array(z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(500_000),
}).strict()).min(1).max(200).refine(messages => messages.some(message => message.role === "user") &&
  Buffer.byteLength(JSON.stringify(messages)) <= 500_000);
const input = z.object({
  requestId: z.uuid(), title: z.string().trim().min(1).max(120),
  recipients: z.array(id).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
  transcript,
}).strict();

/** No global-admin bypass: reading shared text requires active membership and an explicit recipient grant. */
export function mountOrganizationConversations(app: App, store: Store) {
  const base = "/api/v1/enterprises/:id/conversation-shares";
  const item = `${base}/:shareId` as const;
  const assertMember = async (db: Store, enterprise: string, user: string) => {
    if (!await db.one("SELECT 1 FROM members WHERE enterprise_id=? AND user_id=? AND status='active'", enterprise, user))
      throw new ServiceError("ENTERPRISE_FORBIDDEN", 403);
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
      await assertMember(store, enterprise, actor.id);
      if (data.recipients.includes(actor.id)) throw new ServiceError("SHARE_RECIPIENT_INVALID", 400);
      const recipients = await store.all(
        "SELECT user_id FROM members WHERE enterprise_id=? AND status='active' AND user_id IN (SELECT jsonb_array_elements_text(?::jsonb))",
        enterprise, JSON.stringify(data.recipients),
      );
      if (recipients.length !== data.recipients.length) throw new ServiceError("SHARE_RECIPIENT_INVALID", 400);
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
        data.requestId, JSON.stringify(data.recipients),
      );
      await organizationNotice(store, enterprise, data.recipients, "conversation.shared", data.title, "messages");
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
