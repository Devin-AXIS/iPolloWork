export class ServiceError extends Error {
  constructor(public code: string, public status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 429 | 503 = 400, message = code, options?: ErrorOptions) { super(message, options); }
}
