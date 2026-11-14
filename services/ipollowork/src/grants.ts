/** Enterprise asset grants: who in an enterprise may use a file package, skill or model service. */
import { z } from "zod";
import type { Store } from "./database.js";
import type { Actor } from "./auth.js";
import { ServiceError } from "./errors.js";

export type AssetKind = "package" | "skill" | "service";
/** `all` covers every member; otherwise the listed departments and members are allowed. */
export interface Audience { all: boolean; departments: string[]; members: string[] }
export const audienceSchema = z.object({
  all: z.boolean(),
  departments: z.array(z.string().min(1).max(100)).max(200).default([]),
  members: z.array(z.string().min(1).max(100)).max(500).default([]),
}).strict();

/** SQL predicate for "membership row `m` may use asset `kind`/`idColumn`"; takes one bound `kind` parameter. */
export const grantedTo = (idColumn: string) => `EXISTS(SELECT 1 FROM enterprise_grants g WHERE g.asset_kind=? AND g.asset_id=${idColumn} AND (g.audience_kind='all' OR (g.audience_kind='department' AND g.audience_id=m.department_id) OR (g.audience_kind='member' AND g.audience_id=m.user_id)))`;

export function audienceOf(store: Store, kind: AssetKind, assetId: string): Audience {
  const rows = store.all<{ audience_kind: string; audience_id: string }>("SELECT audience_kind,audience_id FROM enterprise_grants WHERE asset_kind=? AND asset_id=?", kind, assetId);
  return {
    all: rows.some(r => r.audience_kind === "all"),
    departments: rows.filter(r => r.audience_kind === "department").map(r => r.audience_id),
    members: rows.filter(r => r.audience_kind === "member").map(r => r.audience_id),
  };
}

/** Replace an asset's audience inside the caller's transaction after checking every referent belongs to the enterprise. */
export function replaceAudience(store: Store, enterpriseId: string, kind: AssetKind, assetId: string, audience: Audience) {
  for (const id of audience.departments)
    if (!store.one("SELECT id FROM departments WHERE id=? AND enterprise_id=?", id, enterpriseId)) throw new ServiceError("DEPARTMENT_MISMATCH", 400, "部门不属于该企业");
  for (const id of audience.members)
    if (!store.one("SELECT user_id FROM members WHERE user_id=? AND enterprise_id=?", id, enterpriseId)) throw new ServiceError("MEMBER_NOT_FOUND", 400, "成员不属于该企业");
  store.run("DELETE FROM enterprise_grants WHERE asset_kind=? AND asset_id=?", kind, assetId);
  const insert = (audienceKind: string, audienceId: string) => store.run("INSERT INTO enterprise_grants VALUES(?,?,?,?,?)", enterpriseId, kind, assetId, audienceKind, audienceId);
  if (audience.all) insert("all", "");
  for (const id of new Set(audience.departments)) insert("department", id);
  for (const id of new Set(audience.members)) insert("member", id);
}

/** Enterprise owners and administrators manage every asset; other members use only granted ones. */
export function canUse(store: Store, actor: Actor, enterpriseId: string, kind: AssetKind, assetId: string): boolean {
  if (actor.role === "admin") return true;
  const member = store.one<{ role: string }>("SELECT role FROM members WHERE enterprise_id=? AND user_id=?", enterpriseId, actor.id);
  if (!member) return false;
  if (member.role === "owner" || member.role === "admin") return true;
  return Boolean(store.one(`SELECT 1 FROM members m WHERE m.enterprise_id=? AND m.user_id=? AND ${grantedTo("?")}`, enterpriseId, actor.id, kind, assetId));
}

export function requireUse(store: Store, actor: Actor, enterpriseId: string, kind: AssetKind, assetId: string) {
  if (!canUse(store, actor, enterpriseId, kind, assetId)) throw new ServiceError("ASSET_FORBIDDEN", 403, "没有使用权限");
}

/** Remove grants that point at a department or member that no longer exists. */
export function dropAudience(store: Store, enterpriseId: string, audienceKind: "department" | "member", audienceId: string) {
  store.run("DELETE FROM enterprise_grants WHERE enterprise_id=? AND audience_kind=? AND audience_id=?", enterpriseId, audienceKind, audienceId);
}
