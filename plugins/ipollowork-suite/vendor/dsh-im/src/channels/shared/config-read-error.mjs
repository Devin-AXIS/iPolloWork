// Metadata belongs to the validation/read boundary, never to parser excerpts or
// arbitrary error properties. Keep the original exception type/message so other
// channels retain their existing startup classification.
const details = new WeakMap();

export function configValidationError(message, field, issue) {
  const error = new Error(message);
  details.set(error, { reason: 'invalid-config', field, issue });
  return error;
}

export function withConfigResource(error, resource) {
  if (error && typeof error === 'object') {
    details.set(error, {
      ...details.get(error), resource,
      ...(error instanceof SyntaxError ? { reason: 'invalid-json' } : {}),
    });
  }
  return error;
}

export function configReadErrorDetails(error) {
  return details.get(error);
}
