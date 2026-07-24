import type { ApiErrorBody } from "./types.js";

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
  return {
    code: err.code,
    message: err.message,
    details: err.details,
  };
}
