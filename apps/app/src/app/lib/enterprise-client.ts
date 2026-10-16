import {
  enterpriseAccessSchema, enterpriseDepartmentSchema, enterpriseMemberSchema,
  enterpriseMessageSchema, enterprisePageSchema, enterpriseShareInputSchema,
  enterpriseSubmissionSchema,
  enterpriseManagedResourceSchema,
  enterpriseOkSchema, enterpriseCreatedSchema, enterpriseSubmissionsResponseSchema, enterprisePendingImportSchema,
  type EnterpriseAccess, type EnterpriseShareInput,
} from "@ipollowork/types/enterprise";
import { desktopFetchViaMain, desktopFetchBinaryViaMain } from "./desktop";
import { isDesktopRuntime } from "./runtime-env";
import type { EnterpriseConnection } from "./enterprise-connections";

export class EnterpriseRequestError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}

export function enterpriseErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "enterprise_session_expired" || code === "unauthorized") return "企业登录已过期，请重新连接企业。";
  if (code === "enterprise_member_inactive" || code === "MEMBER_SUSPENDED") return "当前企业成员已停用，请联系企业管理员。";
  if (code === "forbidden") return "当前企业账号没有执行此操作的权限。";
  if (code === "revision_conflict") return "权限已被其他管理员修改，请刷新后重新分配。";
  if (code === "enterprise_feature_unavailable" || (error instanceof EnterpriseRequestError && [404, 405, 501].includes(error.status))) return "企业服务暂不支持此功能，请联系管理员升级。";
  if (code === "enterprise_invalid_response") return "企业服务返回的数据不完整，请重试或联系管理员。";
  if (code === "enterprise_selection_limit") return "单次最多选择 500 人，请缩小部门或搜索范围。";
  return "企业服务请求失败，请检查连接后重试。";
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

export function canManageEnterprise(connection: EnterpriseConnection): boolean {
  return (!connection.membership.status || connection.membership.status === "active")
    && Date.parse(connection.session.expiresAt) > Date.now()
    && (connection.membership.role === "owner" || connection.membership.role === "admin");
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
export const enterpriseApi = {
  resources: (connection: EnterpriseConnection, type: "template" | "extension", cursor?: string | null, search?: string) =>
    enterpriseRequest(connection, `/api/v1/resources?type=${type}&view=manage&${query({ cursor, search })}`, enterprisePageSchema(enterpriseManagedResourceSchema)),
  review: (connection: EnterpriseConnection, resourceId: string, version: string, decision: "approved" | "rejected", note: string) =>
    enterpriseRequest(connection, `/api/v1/resources/${encodeURIComponent(resourceId)}/versions/${encodeURIComponent(version)}/review`, ok, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, note }),
    }),
  archive: (connection: EnterpriseConnection, resourceId: string) =>
    enterpriseRequest(connection, `/api/v1/resources/${encodeURIComponent(resourceId)}`, ok, {
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
  access: (connection: EnterpriseConnection, resourceId: string) =>
    enterpriseRequest(connection, `/api/v1/resources/${encodeURIComponent(resourceId)}/access`, enterpriseAccessSchema),
  setAccess: (connection: EnterpriseConnection, resourceId: string, input: EnterpriseAccess) =>
    enterpriseRequest(connection, `/api/v1/resources/${encodeURIComponent(resourceId)}/access`, enterpriseAccessSchema, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(enterpriseAccessSchema.parse(input)),
    }),
  submissions: (connection: EnterpriseConnection, type: "template" | "extension") =>
    enterpriseRequest(connection, `/api/v1/${type === "template" ? "template" : "extension"}-submissions`, enterpriseSubmissionsResponseSchema),
  submit: (connection: EnterpriseConnection, type: "template" | "extension", file: File) =>
    enterpriseRequest(connection, `/api/v1/${type === "template" ? "template" : "extension"}-submissions`, enterpriseSubmissionSchema, {
      method: "POST", headers: { "Content-Type": "application/zip" }, body: file,
    }),
};
