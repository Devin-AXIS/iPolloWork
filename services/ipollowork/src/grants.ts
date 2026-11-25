/** Enterprise asset grants: who in an enterprise may use a file package, skill or model service. */
import { z } from "zod";
import type { Store } from "./database.js";
import type { Actor } from "./auth.js";
import { ServiceError } from "./errors.js";

export type AssetKind = "package" | "skill" | "service" | "mcp" | "plugin" | "template";
/** `all` covers every member; otherwise the listed departments and members are allowed. */
export interface Audience {
  all: boolean;
  departments: string[];
  members: string[];
  includeSubdepartments?: boolean;
}
export const audienceSchema = z
  .object({
    all: z.boolean(),
    departments: z.array(z.string().min(1).max(100)).max(200).default([]),
    members: z.array(z.string().min(1).max(100)).max(500).default([]),
    includeSubdepartments: z.boolean().optional(),
  })
  .strict();

/** SQL predicate for "membership row `m` may use asset `kind`/`idColumn`"; takes one bound `kind` parameter. */
export const grantedTo = (idColumn: string) =>
  `EXISTS(SELECT 1 FROM enterprise_grants g WHERE g.asset_kind=? AND g.asset_id=${idColumn} AND g.enterprise_id=m.enterprise_id AND (
    g.audience_kind='all' OR (g.audience_kind='department' AND g.audience_id=m.department_id) OR
    (g.audience_kind='member' AND g.audience_id=m.user_id) OR (g.audience_kind='department_tree' AND EXISTS(
      WITH RECURSIVE branch(id,parent_id) AS (
        SELECT id,parent_id FROM departments WHERE id=m.department_id AND enterprise_id=m.enterprise_id
        UNION SELECT d.id,d.parent_id FROM departments d JOIN branch b ON d.id=b.parent_id WHERE d.enterprise_id=m.enterprise_id
      ) SELECT 1 FROM branch WHERE id=g.audience_id
    ))))`;

/** Read grants for a bounded page of assets already authorized by its caller. */
export async function audiencesOf(
  store: Store,
  enterpriseId: string,
  kind: AssetKind,
  assetIds: readonly string[],
): Promise<Map<string, Audience>> {
  const audiences = new Map<string, Audience>(assetIds.map(id => [id, { all: false, departments: [], members: [] }]));
  if (!assetIds.length) return audiences;
  const rows = await store.all<{ asset_id: string; audience_kind: string; audience_id: string }>(
    "SELECT asset_id,audience_kind,audience_id FROM enterprise_grants WHERE enterprise_id=? AND asset_kind=? AND asset_id=ANY(?::text[]) ORDER BY audience_id",
    enterpriseId,
    kind,
    assetIds,
  );
  for (const row of rows) {
    const audience = audiences.get(row.asset_id)!;
    switch (row.audience_kind) {
      case "all": audience.all = true; break;
      case "member": audience.members.push(row.audience_id); break;
      case "department": audience.departments.push(row.audience_id); break;
      case "department_tree":
        audience.departments.push(row.audience_id);
        audience.includeSubdepartments = true;
        break;
    }
  }
  return audiences;
}

export async function audienceOf(store: Store, enterpriseId: string, kind: AssetKind, assetId: string): Promise<Audience> {
  return (await audiencesOf(store, enterpriseId, kind, [assetId])).get(assetId)!;
}

/** Replace an asset's audience inside the caller's transaction after checking every referent belongs to the enterprise. */
export async function replaceAudience(
  store: Store,
  enterpriseId: string,
  kind: AssetKind,
  assetId: string,
  audience: Audience,
) {
  for (const id of audience.departments)
    if (
      !(await store.one(
        "SELECT id FROM departments WHERE id=? AND enterprise_id=?",
        id,
        enterpriseId,
      ))
    )
      throw new ServiceError("DEPARTMENT_MISMATCH", 400, "部门不属于该组织");
  for (const id of audience.members)
    if (
      !(await store.one(
        "SELECT user_id FROM members WHERE user_id=? AND enterprise_id=?",
        id,
        enterpriseId,
      ))
    )
      throw new ServiceError("MEMBER_NOT_FOUND", 400, "成员不属于该组织");
  await store.run(
    "DELETE FROM enterprise_grants WHERE asset_kind=? AND asset_id=?",
    kind,
    assetId,
  );
  const insert = async (audienceKind: string, audienceId: string) =>
    await store.run(
      "INSERT INTO enterprise_grants VALUES(?,?,?,?,?)",
      enterpriseId,
      kind,
      assetId,
      audienceKind,
      audienceId,
    );
  if (audience.all) await insert("all", "");
  for (const id of new Set(audience.departments))
    await insert(audience.includeSubdepartments ? "department_tree" : "department", id);
  for (const id of new Set(audience.members)) await insert("member", id);
}

/** Enterprise owners and administrators manage every asset; other members use only granted ones. */
export async function canUse(
  store: Store,
  actor: Actor,
  enterpriseId: string,
  kind: AssetKind,
  assetId: string,
): Promise<boolean> {
  if (actor.role === "admin") return true;
  const member = await store.one<{ role: string }>(
    "SELECT role FROM members WHERE enterprise_id=? AND user_id=? AND status='active'",
    enterpriseId,
    actor.id,
  );
  if (!member) return false;
  if (member.role === "owner" || member.role === "admin") return true;
  return Boolean(
    await store.one(
      `SELECT 1 FROM members m WHERE m.enterprise_id=? AND m.user_id=? AND m.status='active' AND ${grantedTo("?")}`,
      enterpriseId,
      actor.id,
      kind,
      assetId,
    ),
  );
}

export async function requireUse(
  store: Store,
  actor: Actor,
  enterpriseId: string,
  kind: AssetKind,
  assetId: string,
) {
  if (!(await canUse(store, actor, enterpriseId, kind, assetId)))
    throw new ServiceError("ASSET_FORBIDDEN", 403, "没有使用权限");
}

/** Remove grants that point at a department or member that no longer exists. */
export async function dropAudience(
  store: Store,
  enterpriseId: string,
  audienceKind: "department" | "member",
  audienceId: string,
) {
  await store.run(
    "DELETE FROM enterprise_grants WHERE enterprise_id=? AND (audience_kind=? OR (?='department' AND audience_kind='department_tree')) AND audience_id=?",
    enterpriseId,
    audienceKind,
    audienceKind,
    audienceId,
  );
}
