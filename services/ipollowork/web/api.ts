export interface User { id: string; name: string; email: string; role: string; emailVerified: boolean }
export type Row = Record<string, string | number | boolean | null>;
export async function api<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
    method, credentials: "same-origin",
    headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(error instanceof DOMException && error.name === 'TimeoutError' ? '请求超时，请刷新查询当前结果，避免重复提交' : '无法连接服务，请检查网络后重试');
  }
  if (response.status === 204) return undefined as T;
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new Error(response.ok ? '服务返回的数据格式异常，请刷新后重试' : `服务暂时不可用（HTTP ${response.status}），请稍后重试`); }
  if (!response.ok) {
    const record = result && typeof result === 'object' ? result : {};
    const error = Reflect.get(record, 'error');
    const message = typeof error === 'string' ? error : error && typeof error === 'object' ? Reflect.get(error, 'message') : Reflect.get(record, 'message');
    throw new Error(typeof message === 'string' ? message : '请求失败，请稍后重试');
  }
  return result as T;
}
export const date = (v: unknown) => v ? new Date(Number(v)).toLocaleString("zh-CN", { hour12: false }) : "—";
export const count = (v: unknown) => Number(v ?? 0).toLocaleString("zh-CN");
export const text = (v: unknown) => String(v ?? "");
export const operation = (v: unknown) => ({
  "enterprise.create": "创建企业", "department.create": "添加部门", "member.update": "调整成员", "member.remove": "移除成员",
  "invitation.create": "邀请成员", "invitation.accept": "加入企业", "invitation.revoke": "撤销邀请",
  "enterprise.update": "更新组织设置", "department.update": "更新部门", "department.remove": "移除部门",
  "publication.submit": "提交资源版本", "publication.approve": "通过审核", "publication.reject": "驳回审核",
  "publication.publish": "发布资源", "publication.archive": "下架资源", "grant.update": "更新访问范围",
  "skill.create": "发布技能", "skill.remove": "移除技能", "mcp.create": "添加 MCP", "mcp.update": "更新 MCP", "mcp.remove": "移除 MCP",
  "project.create":"创建项目", "project.update":"调整项目归属", "project.move-out":"移出项目",
  "project.access":"调整项目权限", "project.delete":"移除项目", "project.publish":"发布项目",
  "project.submit":"提交项目改动", "project.accept":"接纳项目改动", "project.withdraw":"撤回项目改动",
  "project.archive":"上传项目成果", "project.archive-policy":"更新项目上传设置",
  "package.create":"创建文件包", "package.update":"编辑文件包", "package.remove":"移除文件包",
  "package.file.add":"上传文件包文件", "package.file.remove":"移除文件包文件",
  "organization.notification.configure": "更新成员变更通知",
  "market.add": "上架插件", "market.update": "编辑插件",
  "plan.create": "添加套餐", "plan.update": "更新套餐", "points.adjust": "调整积分", "user.update": "更新账号", "user.bootstrap-admin": "运维设置管理员", "settings.update": "更新配置", "share.create": "分享会话",
} as Record<string, string>)[text(v)] ?? "更新记录";
