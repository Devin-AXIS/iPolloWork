export class ServiceError extends Error {
  constructor(public code: string, public status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 429 | 503 = 400, message = code, options?: ErrorOptions) { super(message, options); }
}

/** Only relay facts about the call, never the upstream response body. */
export class ServiceInvocationError extends ServiceError {
  constructor(code: string, status: ServiceError["status"], readonly requestId: string,
    readonly upstreamStatus?: number, options?: ErrorOptions) {
    super(code, status, code, options);
  }
}
