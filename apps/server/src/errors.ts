import type { ApiErrorBody } from "./types.js";
import { classifyProviderFailure, serviceErrorMessage } from "@ipollowork/types/provider-errors";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Keep API errors recognizable when a route and its dependency are loaded by
 * different Bun module contexts. This can otherwise turn an intended 4xx
 * response into a misleading 500.
 */
export function isApiError(err: unknown): err is ApiError {
  if (err instanceof ApiError) return true;
  if (!err || typeof err !== "object") return false;
  const candidate = err as Record<string, unknown>;
  return Number.isInteger(candidate.status)
    && typeof candidate.code === "string"
    && typeof candidate.message === "string";
}

export function formatError(err: ApiError): ApiErrorBody {
  const providerOwned = /^(?:provider|openai|ark|image|bailian|storage|video|codex_image|ipollowork_models_voice)_/.test(err.code);
  return {
    code: err.code,
    message: serviceErrorMessage({ code: err.code, message: err.message, ...(providerOwned && err.status >= 500 ? { status: err.status } : {}) }),
    details: err.details,
  };
}

export function providerApiError(error: unknown, status = 502): ApiError {
  const failure = classifyProviderFailure(error) ?? classifyProviderFailure({ status });
  return new ApiError(status, failure?.code ?? "provider_request_failed", failure?.message ?? "第三方请求未完成，请检查参数后重试。");
}

/** Only recognized transport/provider failures are reclassified; local bugs stay local. */
export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  const failure = classifyProviderFailure(error);
  const statuses = { provider_unavailable: 503, provider_timeout: 504, provider_network_error: 502, provider_auth_failed: 401, provider_access_denied: 403, provider_quota_exhausted: 402, provider_rate_limited: 429 };
  return failure ? new ApiError(statuses[failure.code], failure.code, failure.message)
    : new ApiError(500, "internal_error", "操作未完成，请稍后重试。");
}
