import { randomUUID } from "node:crypto";
import type { Actor } from "./auth.js";
import type { Store, Row } from "./database.js";
import { ServiceError } from "./errors.js";

export type Enterprise = Row & { id: string; name: string; owner_id: string };
export type Project = Row & { id: string; owner_id: string; enterprise_id: string | null };
export type Resource = Row & { id: string; owner_id: string; enterprise_id: string | null; visibility: string; storage_key: string; mime: string };
export type Share = Row & { id: string; owner_id: string; project_id: string; visibility: string; revoked_at: number | null };
export const uid = () => randomUUID();
export const now = () => Date.now();
export function requireAdmin(actor: Actor) { if (actor.role !== "admin") throw new ServiceError("ADMIN_REQUIRED", 403, "需要管理员权限"); }
export function audit(store: Store, actor: Actor, action: string, target: string) {
  store.run("INSERT INTO audit(actor_id,action,target,created_at) VALUES(?,?,?,?)", actor.id, action, target, now());
}
export function enterpriseAccess(store: Store, actor: Actor, id: string, manage = false) {
  const enterprise = store.one<Enterprise>("SELECT * FROM enterprises WHERE id=?", id);
  if (!enterprise) throw new ServiceError("ENTERPRISE_NOT_FOUND", 404, "企业不存在");
  const membership = store.one("SELECT role FROM members WHERE enterprise_id=? AND user_id=?", id, actor.id);
  if (actor.role !== "admin" && (!membership || manage && membership.role !== "owner" && membership.role !== "admin")) {
    throw new ServiceError("ENTERPRISE_FORBIDDEN", 403, "没有企业访问权限");
  }
  return enterprise;
}
export function departmentAccess(store: Store, enterpriseId: string, departmentId?: string | null) {
  if (departmentId && !store.one("SELECT id FROM departments WHERE id=? AND enterprise_id=?", departmentId, enterpriseId)) {
    throw new ServiceError("DEPARTMENT_MISMATCH", 400, "部门不属于该企业");
  }
}
export type ProjectRole = 'view' | 'participate' | 'maintain';
/** Department grants are evaluated against current membership on every operation. */
export function projectRole(store: Store, actor: Actor, project: Project): ProjectRole | undefined {
  if (actor.role === 'admin') return 'maintain';
  if (project.enterprise_id) {
    const member = store.one('SELECT role,department_id FROM members WHERE enterprise_id=? AND user_id=?', project.enterprise_id, actor.id);
    if (!member) return undefined;
    if (project.owner_id === actor.id || member.role === 'owner' || member.role === 'admin') return 'maintain';
    const roles = store.all("SELECT role FROM project_grants WHERE project_id=? AND ((kind='member' AND subject_id=?) OR (kind='department' AND subject_id=?))", project.id, actor.id, member.department_id);
    if (roles.some(r => r.role === 'maintain')) return 'maintain';
    if (roles.some(r => r.role === 'participate')) return 'participate';
    if (roles.length || project.access_mode === 'enterprise') return 'view';
    return undefined;
  }
  return project.owner_id === actor.id ? 'maintain' : undefined;
}
export function projectAccess(store: Store, actor: Actor, id: string, manage = false) {
  const project = store.one<Project>("SELECT * FROM projects WHERE id=?", id);
  if (!project) throw new ServiceError("PROJECT_NOT_FOUND", 404, "项目不存在");
  const role = projectRole(store, actor, project);
  if (!role || manage && role !== 'maintain') throw new ServiceError("PROJECT_FORBIDDEN", 403, "没有项目访问权限");
  return project;
}
export function resourceAccess(store: Store, actor: Actor, id: string) {
  const resource = store.one<Resource>("SELECT * FROM resources WHERE id=?", id);
  if (!resource) throw new ServiceError("RESOURCE_NOT_FOUND", 404, "资源不存在");
  if (resource.enterprise_id && resource.visibility !== "public") enterpriseAccess(store, actor, resource.enterprise_id);
  if (actor.role === "admin" || resource.owner_id === actor.id || resource.visibility === "public") return resource;
  if (resource.visibility === "enterprise" && resource.enterprise_id) { enterpriseAccess(store, actor, resource.enterprise_id); return resource; }
  if (resource.kind === 'attachment') {
    const candidates=store.all<Project>(`SELECT DISTINCT p.* FROM projects p
      LEFT JOIN project_changes c ON c.project_id=p.id AND c.kind='files' AND c.status!='withdrawn'
      WHERE EXISTS(SELECT 1 FROM json_each(p.files) f WHERE json_extract(f.value,'$.resourceId')=?)
      OR EXISTS(SELECT 1 FROM json_each(c.content,'$.files') f WHERE json_extract(f.value,'$.resourceId')=?)`,id,id);
    if(candidates.some(p=>projectRole(store,actor,p)!==undefined))return resource;
  }
  throw new ServiceError("RESOURCE_FORBIDDEN", 403, "没有资源访问权限");
}
export function shareAccess(store: Store, actor: Actor, id: string, comment = false) {
  const share = store.one<Share>("SELECT * FROM shares WHERE id=?", id);
  if (!share || share.revoked_at) throw new ServiceError("SHARE_NOT_FOUND", 404, "会话分享已失效");
  const project = store.one<Project>("SELECT * FROM projects WHERE id=?", share.project_id);
  if (!project) throw new ServiceError("SHARE_NOT_FOUND", 404);
  if (project.enterprise_id) enterpriseAccess(store, actor, project.enterprise_id);
  if (share.owner_id === actor.id || actor.role === "admin") return share;
  const grant = store.one("SELECT role FROM share_members WHERE share_id=? AND user_id=?", id, actor.id);
  if (share.visibility === "enterprise" && project.enterprise_id && !comment) return share;
  if (!grant || comment && grant.role !== "comment") throw new ServiceError("SHARE_FORBIDDEN", 403, "没有会话访问权限");
  return share;
}
export function wallet(store: Store, userId: string) {
  return store.one("SELECT COALESCE(SUM(amount),0) AS balance,COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),0) AS totalEarned,COALESCE(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END),0) AS totalSpent FROM ledger WHERE user_id=?", userId)!;
}
/** Must run within the caller's transaction; the reference prevents duplicate credit. */
export function ledgerEntry(store: Store, userId: string, amount: number, reference: string, reason: string, actorId: string | null = null, allowDebt = false) {
  const previous = store.one("SELECT user_id,amount FROM ledger WHERE reference=?", reference);
  if (previous) {
    if (previous.user_id !== userId || previous.amount !== amount) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409);
    return false;
  }
  const balance = Number(wallet(store, userId).balance) + amount;
  if (!Number.isSafeInteger(balance)) throw new ServiceError("BALANCE_OVERFLOW", 409);
  if (balance < 0 && !allowDebt) throw new ServiceError("INSUFFICIENT_POINTS", 409, "积分不足");
  store.run("INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?)", uid(), userId, amount, balance, reference, reason, actorId, now());
  return true;
}
export type Order = Row & { id: string; user_id: string; plan_id: string; status: string; provider: string; provider_id: string | null; amount: number; currency: string; points: number; days: number };

/** Payment callers provide only server-verified amounts and provider identities. */
export function settleOrder(store: Store, id: string, providerId: string, amount: number, currency: string) {
  return store.transaction(() => {
    const order = store.one<Order>("SELECT * FROM orders WHERE id=?", id);
    if (!order) throw new ServiceError("ORDER_NOT_FOUND", 404);
    if (order.amount !== amount || order.currency !== currency.toUpperCase()) throw new ServiceError("PAYMENT_MISMATCH", 409);
    if (order.provider_id && order.provider_id !== providerId) throw new ServiceError("PAYMENT_ID_CONFLICT", 409);
    if (order.status === "paid" || order.status === "refunded") return { duplicate: true };
    if (order.status !== "pending") throw new ServiceError("ORDER_NOT_PENDING", 409);
    store.run("UPDATE orders SET status='paid',provider_id=?,paid_at=? WHERE id=?", providerId, now(), id);
    if (order.points) ledgerEntry(store, order.user_id, order.points, "order/" + id, "套餐积分");
    if (order.days) {
      const previous = Number(store.one("SELECT MAX(expires_at) AS value FROM entitlements WHERE user_id=? AND revoked_at IS NULL", order.user_id)?.value ?? 0);
      const start = Math.max(now(), previous);
      store.run("INSERT INTO entitlements VALUES(?,?,?,?,?,NULL)", id, order.user_id, order.plan_id, now(), start + order.days * 86400000);
    }
    return { duplicate: false };
  });
}
export function refundOrder(store: Store, providerId: string) {
  return store.transaction(() => {
    const order = store.one<Order>("SELECT * FROM orders WHERE provider_id=?", providerId);
    if (!order) throw new ServiceError("ORDER_NOT_FOUND", 404);
    if (order.status === "refunded") return { duplicate: true };
    if (order.status !== "paid") throw new ServiceError("ORDER_NOT_PAID", 409);
    if (order.points) ledgerEntry(store, order.user_id, -order.points, "refund/" + order.id, "订单退款", null, true);
    store.run("UPDATE entitlements SET revoked_at=? WHERE order_id=?", now(), order.id);
    store.run("UPDATE orders SET status='refunded' WHERE id=?", order.id);
    let end = 0;
    for (const entitlement of store.all("SELECT e.order_id,e.starts_at,o.days FROM entitlements e JOIN orders o ON o.id=e.order_id WHERE e.user_id=? AND e.revoked_at IS NULL ORDER BY e.starts_at,e.rowid", order.user_id)) {
      end = Math.max(Number(entitlement.starts_at), end) + Number(entitlement.days) * 86400000;
      store.run("UPDATE entitlements SET expires_at=? WHERE order_id=?", end, entitlement.order_id);
    }
    return { duplicate: false };
  });
}
