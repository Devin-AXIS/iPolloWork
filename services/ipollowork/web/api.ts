export interface User { id: string; name: string; email: string; role: string; emailVerified: boolean }
export type Row = Record<string, string | number | boolean | null>;
export async function api<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const response = await fetch(path, {
    method, credentials: "same-origin",
    headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? result.error ?? result.message ?? "请求失败");
  return result;
}
export const date = (v: unknown) => v ? new Date(Number(v)).toLocaleString("zh-CN", { hour12: false }) : "—";
export const count = (v: unknown) => Number(v ?? 0).toLocaleString("zh-CN");
export const text = (v: unknown) => String(v ?? "");
export const operation = (v: unknown) => ({
  "enterprise.create": "创建企业", "department.create": "添加部门", "member.update": "调整成员", "member.remove": "移除成员",
  "invitation.create": "邀请成员", "invitation.accept": "加入企业", "invitation.revoke": "撤销邀请",
  "plan.create": "添加套餐", "plan.update": "更新套餐", "points.adjust": "调整积分", "user.update": "更新账号", "settings.update": "更新配置", "share.create": "分享会话",
} as Record<string, string>)[text(v)] ?? "更新记录";
