/** Recipient rules for one native share, independent of project-wide grants. */
import { z } from "zod";
import type { Actor } from "./auth.js";
import type { Store } from "./database.js";
import { enterpriseAccess, projectAccess, projectRole } from "./domain.js";
import { ServiceError } from "./errors.js";

const id = z.string().min(1).max(200);
const ids = z.array(id).min(1).max(500).transform(values => [...new Set(values)].sort());
export const shareAudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link") }).strict(),
  z.object({ kind: z.literal("team"), enterpriseId: id }).strict(),
  z.object({ kind: z.literal("departments"), enterpriseId: id, departmentIds: ids }).strict(),
  z.object({ kind: z.literal("members"), enterpriseId: id, userIds: ids }).strict(),
]);
export type ShareAudience = z.infer<typeof shareAudienceSchema> | { kind: "project" };
export interface AudienceShare { owner_id: string; project_id: string | null; audience_json: string; mode: string }

/** Validate the sharer's authority and every selected recipient before persisting an intent. */
export function resolveShareAudience(store: Store, actor: Actor, input: unknown, projectId?: string): ShareAudience {
  if (projectId) {
    const project = projectAccess(store, actor, projectId);
    if (projectRole(store, actor, project) === "view") throw new ServiceError("LIVESHARE_FORBIDDEN", 403);
  }
  if (input === undefined) {
    if (!projectId) throw new ServiceError("LIVESHARE_AUDIENCE_REQUIRED", 400);
    return { kind: "project" };
  }
  const audience = shareAudienceSchema.parse(input);
  if (audience.kind === "link") return audience;
  enterpriseAccess(store, actor, audience.enterpriseId);
  if (audience.kind === "departments") {
    const placeholders = audience.departmentIds.map(() => "?").join(",");
    const count = store.one(`SELECT COUNT(*) AS n FROM departments WHERE enterprise_id=? AND id IN (${placeholders})`, audience.enterpriseId, ...audience.departmentIds);
    if (count?.n !== audience.departmentIds.length) throw new ServiceError("LIVESHARE_RECIPIENT_INVALID", 400);
  }
  if (audience.kind === "members") {
    const placeholders = audience.userIds.map(() => "?").join(",");
    const count = store.one(`SELECT COUNT(*) AS n FROM members m JOIN "user" u ON u.id=m.user_id WHERE m.enterprise_id=? AND m.user_id IN (${placeholders}) AND COALESCE(u.banned,0)=0`, audience.enterpriseId, ...audience.userIds);
    if (count?.n !== audience.userIds.length) throw new ServiceError("LIVESHARE_RECIPIENT_INVALID", 400);
  }
  return audience;
}

/** Read a persisted policy; existing shares retain their original project-based admission. */
export function readShareAudience(share: AudienceShare): ShareAudience {
  let value: unknown;
  try { value = JSON.parse(share.audience_json); }
  catch (error) {
    // Persisted policy corruption must stop admission without exposing the stored value.
    throw new ServiceError("LIVESHARE_POLICY_INVALID", 503);
  }
  if (typeof value === "object" && value !== null && "kind" in value && value.kind === "project") return { kind: "project" };
  const parsed = shareAudienceSchema.safeParse(value);
  if (!parsed.success) throw new ServiceError("LIVESHARE_POLICY_INVALID", 503);
  return parsed.data;
}

/** Check current team membership on every request, including after department changes. */
export function audienceAllows(store: Store, share: AudienceShare, actor: Actor): boolean {
  if (actor.id === share.owner_id) return true;
  const audience = readShareAudience(share);
  if (audience.kind === "link") return true;
  if (audience.kind === "project") {
    if (!share.project_id) return false;
    const project = store.one<Parameters<typeof projectRole>[2]>("SELECT * FROM projects WHERE id=?", share.project_id);
    if (!project) return false;
    const role = projectRole(store, actor, project);
    return !!role && (share.mode !== "write" || role !== "view");
  }
  const member = store.one("SELECT department_id FROM members WHERE enterprise_id=? AND user_id=?", audience.enterpriseId, actor.id);
  if (!member) return false;
  if (audience.kind === "team") return true;
  if (audience.kind === "members") return audience.userIds.includes(actor.id);
  return typeof member.department_id === "string" && audience.departmentIds.includes(member.department_id);
}
