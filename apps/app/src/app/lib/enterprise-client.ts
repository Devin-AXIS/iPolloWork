import { skillDetailSchema } from "@ipollowork/types/skills";
import type { EnterpriseResourceType } from "@ipollowork/types/enterprise";
import type { EnterpriseSkillContext } from "@ipollowork/types/skills";
import {
  enterpriseAccessSchema, enterpriseDepartmentSchema, enterpriseMemberSchema,
  enterpriseMessageSchema, enterprisePageSchema, enterpriseShareInputSchema,
  enterpriseSubmissionSchema,
  enterpriseNavigationSchema, type EnterpriseNavigation,
  enterpriseManagedResourceSchema,
  canManageEnterpriseResource,
  enterpriseOkSchema, enterpriseCreatedSchema, enterpriseSubmissionsResponseSchema, enterprisePendingImportSchema,
  type EnterpriseAccess, type EnterpriseShareInput,
} from "@ipollowork/types/enterprise";
import { desktopFetchViaMain, desktopFetchBinaryViaMain } from "./desktop";
import { isDesktopRuntime } from "./runtime-env";
import { refreshEnterpriseMembership, type EnterpriseConnection } from "./enterprise-connections";
import { serviceErrorMessage } from "@ipollowork/types/provider-errors";

export class EnterpriseRequestError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}

export function enterpriseErrorMessage(error: unknown): string {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : error instanceof Error ? error.message : "";
  if (code.startsWith("provider_")) return serviceErrorMessage(error);
  if (code === "internal_error") return "操作未完成，请稍后重试。";
  if (code === "enterprise_summary_model_required") return "请先为当前项目选择一个已连接的模型。";
  if (code === "enterprise_summary_model_unavailable") return "当前模型未连接或不可用，请重新选择模型后生成总结。";
  if (code === "enterprise_share_empty") return "会话中暂无可用于总结的已完成消息。";
  if (code === "enterprise_summary_failed") return "当前模型未能生成总结，请稍后重试或手动填写总结。";
  if (code === "enterprise_summary_invalid") return "模型未返回有效的总结，请重试或手动填写总结。";
  if (code === "enterprise_context_required" || code === "enterprise_context_mismatch") return "请在当前企业中选择一个项目后再分享会话。";
  if (code === "enterprise_session_expired" || code === "unauthorized") return "企业登录已过期，请重新连接企业。";
  if (code === "enterprise_member_inactive" || code === "MEMBER_SUSPENDED") return "当前企业成员已停用，请联系企业管理员。";
  if (code === "forbidden") return "当前企业账号没有执行此操作的权限。";
  if (code === "enterprise_account_changed") return "企业账号已切换，请重新打开操作。";
  if (code === "revision_conflict") return "权限已被其他管理员修改，请刷新后重新分配。";
  if (code === "navigation_revision_conflict") return "导航快捷入口已被其他管理员修改，已刷新，请重新选择。";
  if (code === "enterprise_feature_unavailable" || (error instanceof EnterpriseRequestError && [404, 405, 501].includes(error.status))) return "企业服务暂不支持此功能，请联系管理员升级。";
  if (code === "enterprise_invalid_response") return "企业服务返回的数据不完整，请重试或联系管理员。";
  if (code === "enterprise_selection_limit") return "单次最多选择 500 人，请缩小部门或搜索范围。";
  if (["invalid_skill_manifest", "invalid_skill_content", "skill_entry_missing"].includes(code)) return "技能包缺少有效清单或 SKILL.md，请检查名称、描述和配套文件后重新导出。";
  if (code === "invalid_skill_markdown") return "技能 MD 开头需包含有效的 name、description；版本号可选，默认 1.0.0。";
  if (code === "skill_markdown_too_large") return "单个技能 MD 不能超过 1 MB。";
  if (code === "skill_package_type_mismatch") return "插件和独立技能使用不同的包格式，请选择 .ipollowork-skill 技能包。";
  if (code === "unsafe_skill_file") return "技能包包含不安全路径、私有配置或不支持的文件。";
  if (code === "invalid_extension_manifest") return "插件清单格式或版本不受支持，请在插件工坊检查后重新导出，或联系管理员升级企业服务。";
  if (code === "extension_manifest_missing") return "插件包根目录缺少 ipollowork.plugin.json，请从插件工坊重新导出。";
  if (code === "extension_file_missing") return "插件包缺少清单中声明的文件，请在插件工坊检查后重新导出。";
  if (code === "invalid_template_manifest" || code === "template_manifest_missing" || code === "template_file_missing") return "模板包的清单或资源文件不完整，请检查后重新导出。";
  if (code === "invalid_template_package" || code === "duplicate_template_file" || code === "unsupported_zip_compression") return "资源包压缩格式无效或文件路径异常，请重新导出后提交。";
  if (code === "unsafe_template_file" || code === "unsupported_template_file") return "资源包包含不支持或不安全的文件，请检查包内容后重新导出。";
  if (code === "template_package_too_large" || code === "invalid_artifact_size" || code === "payload_too_large") return "资源包为空或超过大小、文件数量限制，请精简后重新提交。";
  if (code === "invalid_artifact_type") return "资源包类型不正确，请选择模板包、.ipollowork-plugin 插件包或 .ipollowork-skill 技能包。";
  if (code === "resource_version_already_exists" || code === "resource_version_not_newer") return "该版本已存在或版本号未递增，请修改版本号后重新导出。";
  if (code === "reserved_resource_id") return "资源 ID 使用了内置保留名称，请修改后重新导出。";
  return "企业服务请求失败，请检查连接后重试。";
}

export function enterpriseSkillContext(connection: EnterpriseConnection): EnterpriseSkillContext {
  return { enterpriseId: connection.id, origin: connection.origin, memberId: connection.membership.id, token: connection.session.token };
}

export function enterpriseIdentity(connection: EnterpriseConnection): string {
  return `${connection.id}:${connection.membership.id}`;
}

export const enterpriseShareSessionEvent = "ipollowork:enterprise-share-session";
export const enterpriseImportMessageEvent = "ipollowork:enterprise-import-message";
const PENDING_IMPORT_KEY = "ipollowork:enterprise-pending-import";
export function requestEnterpriseSessionShare(workspaceId: string, sessionId: string) {
  window.dispatchEvent(new CustomEvent(enterpriseShareSessionEvent, { detail: { workspaceId, sessionId } }));
}
export function requestEnterpriseMessageImport(connection: EnterpriseConnection, messageId: string) {
  window.sessionStorage.setItem(PENDING_IMPORT_KEY, JSON.stringify({ identity: enterpriseIdentity(connection), messageId }));
  window.dispatchEvent(new CustomEvent(enterpriseImportMessageEvent));
}
export function takeEnterpriseMessageImport(connection: EnterpriseConnection): string | null {
  const raw = window.sessionStorage.getItem(PENDING_IMPORT_KEY);
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { window.sessionStorage.removeItem(PENDING_IMPORT_KEY); return null; }
  const request = enterprisePendingImportSchema.safeParse(parsed);
  if (!request.success || request.data.identity !== enterpriseIdentity(connection)) return null;
  window.sessionStorage.removeItem(PENDING_IMPORT_KEY);
  return request.data.messageId;
}

export function isEnterpriseConnectionActive(connection: EnterpriseConnection): boolean {
  return (!connection.membership.status || connection.membership.status === "active")
    && Date.parse(connection.session.expiresAt) > Date.now()
    && Boolean(connection.session.token.trim());
}

export function canManageEnterprise(connection: EnterpriseConnection, resourceType?: EnterpriseResourceType): boolean {
  return isEnterpriseConnectionActive(connection)
    && canManageEnterpriseResource(connection.membership.role, resourceType);
}

export async function enterpriseRequest<T>(
  connection: EnterpriseConnection, path: string, schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  init: RequestInit = {}, fetcher?: typeof fetch,
): Promise<T> {
  if (!path.startsWith("/api/v1/") || path.includes("..") || path.includes("\\") || path.includes("#")) throw new Error("enterprise_invalid_path");
  const readingMembership = path === "/api/v1/membership" && (!init.method || init.method === "GET");
  if (connection.membership.status && connection.membership.status !== "active" && !readingMembership) throw new EnterpriseRequestError("enterprise_member_inactive", 403);
  if (!Number.isFinite(Date.parse(connection.session.expiresAt)) || Date.parse(connection.session.expiresAt) <= Date.now()) throw new EnterpriseRequestError("enterprise_session_expired", 401);
  const timeout = AbortSignal.timeout(init.body instanceof File ? 120_000 : 15_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${connection.session.token}`);
  const requestFetcher = fetcher ?? (isDesktopRuntime()
    ? (input: RequestInfo | URL, options?: RequestInit) => init.body instanceof File
      ? desktopFetchBinaryViaMain(input, options, 120_000)
      : desktopFetchViaMain(input, options, 15_000)
    : globalThis.fetch);
  signal.throwIfAborted();
  const response = await requestFetcher(`${connection.origin}${path}`, { ...init, headers, signal, redirect: "error" });
  signal.throwIfAborted();
  const value: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) {
    const code = typeof value === "object" && value !== null && "error" in value && typeof value.error === "string" ? value.error : `enterprise_server_${response.status}`;
    throw new EnterpriseRequestError(code, response.status);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("enterprise_invalid_response");
  return parsed.data;
}

function query(input: { search?: string; departmentId?: string | null; includeDescendants?: boolean; cursor?: string | null }) {
  const value = new URLSearchParams({ limit: "50" });
  if (input.search?.trim()) value.set("search", input.search.trim().slice(0, 160));
  if (input.departmentId) value.set("departmentId", input.departmentId);
  if (input.includeDescendants) value.set("includeDescendants", "true");
  if (input.cursor) value.set("cursor", input.cursor);
  return value.toString();
}
const ok = enterpriseOkSchema;
async function enterpriseManagementRequest<T>(connection: EnterpriseConnection, type: EnterpriseResourceType, path: string,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }, init: RequestInit = {}) {
  const verified = await refreshEnterpriseMembership(connection);
  if (!canManageEnterprise(verified, type)) throw new EnterpriseRequestError("forbidden", 403);
  return enterpriseRequest(verified, path, schema, init);
}
export const enterpriseApi = {
  navigation: (connection: EnterpriseConnection, signal?: AbortSignal) =>
    enterpriseRequest(connection, "/api/v1/navigation-shortcuts", enterpriseNavigationSchema, { signal, cache: "no-store" }),
  setNavigation: async (connection: EnterpriseConnection, input: EnterpriseNavigation) => {
    const verified = await refreshEnterpriseMembership(connection);
    if (!canManageEnterprise(verified)) throw new EnterpriseRequestError("forbidden", 403);
    return enterpriseRequest(verified, "/api/v1/navigation-shortcuts", enterpriseNavigationSchema, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(enterpriseNavigationSchema.parse(input)),
    });
  },
  skill: (connection: EnterpriseConnection, resourceId: string, version: string) => enterpriseRequest(connection, `/api/v1/resources/${encodeURIComponent(resourceId)}?version=${encodeURIComponent(version)}`, skillDetailSchema),
  resources: (connection: EnterpriseConnection, type: EnterpriseResourceType, cursor?: string | null, search?: string) =>
    enterpriseManagementRequest(connection, type, `/api/v1/resources?type=${type}&view=manage&${query({ cursor, search })}`, enterprisePageSchema(enterpriseManagedResourceSchema)),
  review: (connection: EnterpriseConnection, resourceId: string, version: string, decision: "approved" | "rejected", note: string, type: EnterpriseResourceType) =>
    enterpriseManagementRequest(connection, type, `/api/v1/resources/${encodeURIComponent(resourceId)}/versions/${encodeURIComponent(version)}/review`, ok, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, note }),
    }),
  archive: (connection: EnterpriseConnection, resourceId: string, type: EnterpriseResourceType) =>
    enterpriseManagementRequest(connection, type, `/api/v1/resources/${encodeURIComponent(resourceId)}`, ok, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "archived" }),
    }),
  departments: (connection: EnterpriseConnection, cursor?: string | null, signal?: AbortSignal) =>
    enterpriseRequest(connection, `/api/v1/departments?${query({ cursor })}`, enterprisePageSchema(enterpriseDepartmentSchema), { signal }),
  members: (connection: EnterpriseConnection, input: { search?: string; departmentId?: string | null; includeDescendants?: boolean; cursor?: string | null }, signal?: AbortSignal) =>
    enterpriseRequest(connection, `/api/v1/members?${query(input)}`, enterprisePageSchema(enterpriseMemberSchema), { signal }),
  messages: (connection: EnterpriseConnection, cursor?: string | null, signal?: AbortSignal) =>
    enterpriseRequest(connection, `/api/v1/messages?${query({ cursor })}`, enterprisePageSchema(enterpriseMessageSchema), { signal }),
  message: (connection: EnterpriseConnection, id: string, signal?: AbortSignal) =>
    enterpriseRequest(connection, `/api/v1/messages/${encodeURIComponent(id)}`, enterpriseMessageSchema, { signal }),
  messageAction: (connection: EnterpriseConnection, id: string, action: "read" | "accept" | "ignore") =>
    enterpriseRequest(connection, `/api/v1/messages/${encodeURIComponent(id)}/${action}`, ok, { method: "POST" }),
  share: (connection: EnterpriseConnection, input: EnterpriseShareInput) =>
    enterpriseRequest(connection, "/api/v1/session-shares", enterpriseCreatedSchema, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(enterpriseShareInputSchema.parse(input)),
    }),
  access: (connection: EnterpriseConnection, resourceId: string, type: EnterpriseResourceType) =>
    enterpriseManagementRequest(connection, type, `/api/v1/resources/${encodeURIComponent(resourceId)}/access`, enterpriseAccessSchema),
  setAccess: (connection: EnterpriseConnection, resourceId: string, input: EnterpriseAccess, type: EnterpriseResourceType) =>
    enterpriseManagementRequest(connection, type, `/api/v1/resources/${encodeURIComponent(resourceId)}/access`, enterpriseAccessSchema, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(enterpriseAccessSchema.parse(input)),
    }),
  submissions: (connection: EnterpriseConnection, type: EnterpriseResourceType) =>
    enterpriseRequest(connection, `/api/v1/${type}-submissions`, enterpriseSubmissionsResponseSchema),
  submit: (connection: EnterpriseConnection, type: EnterpriseResourceType, file: File) =>
    enterpriseRequest(connection, `/api/v1/${type}-submissions`, enterpriseSubmissionSchema, {
      method: "POST", headers: { "Content-Type": type === "skill" && file.name.toLowerCase().endsWith(".md") ? "text/markdown; charset=utf-8" : "application/zip" }, body: file,
    }),
};
