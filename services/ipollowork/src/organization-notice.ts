import type { Store } from "./database.js";
import { now } from "./domain.js";

/** Record a product event for exact active recipients; never write snippets or credentials into notices. */
export async function organizationNotice(
  store: Store,
  enterpriseId: string,
  recipientIds: readonly string[],
  kind: "resource.approved" | "resource.rejected" | "resource.published" | "project.submitted" | "project.accepted" | "conversation.shared",
  title: string,
  tab: "templates" | "plugins" | "skills" | "mcp" | "projects" | "messages",
  targetId?: string,
) {
  if (!recipientIds.length) return;
  await store.run(
    `INSERT INTO organization_member_notices(id,enterprise_id,user_id,kind,value,created_at,target_tab,target_id)
     SELECT gen_random_uuid()::text,enterprise_id,user_id,?,?,?,?,?
     FROM members WHERE enterprise_id=? AND status='active' AND user_id IN (SELECT jsonb_array_elements_text(?::jsonb))`,
    kind, title, now(), tab, targetId ?? null, enterpriseId, JSON.stringify(recipientIds),
  );
}
