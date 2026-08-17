import type { ApiErrorBody } from "./types.js";

/**
 * A non-2xx response from the API.
 *
 * The server always answers with `{code, message, details}`, so the code is the thing to
 * branch on — it is stable, while the message is not.
 */
export class IPolloWorkApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestPath: string;

  constructor(input: { status: number; code: string; message: string; details?: unknown; requestPath: string }) {
    super(input.message);
    this.name = "IPolloWorkApiError";
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
    this.requestPath = input.requestPath;
  }

  /** The request can be retried as-is: a transient upstream or rate-limit condition. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status === 502 || this.status === 503 || this.status === 504;
  }

  /** The token is missing, expired, or lacks the required scope. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export async function errorFromResponse(response: Response, requestPath: string): Promise<IPolloWorkApiError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object") body = parsed as Partial<ApiErrorBody>;
  } catch {
    // A non-JSON error body (a proxy error page, say) leaves the defaults below in place.
  }
  return new IPolloWorkApiError({
    status: response.status,
    code: typeof body.code === "string" ? body.code : `http_${response.status}`,
    message: typeof body.message === "string" ? body.message : response.statusText || "Request failed",
    details: body.details,
    requestPath,
  });
}
