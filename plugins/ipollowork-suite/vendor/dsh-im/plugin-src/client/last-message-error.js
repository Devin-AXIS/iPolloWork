import { diagnosticFields } from '../../src/channels/shared/diagnostic-details.mjs';
function text(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export function normalizeLastMessageError(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const code = text(value.code, 64);
  const reason = text(value.reason, 64);
  const message = text(value.message, 500);
  const referenceId = text(value.referenceId, 40);
  const at = Number.isFinite(value.at) ? value.at : null;
  return code && reason && message && referenceId && at !== null
    ? { code, reason, message, referenceId, at, ...(value.details ? diagnosticFields(value) : {}) }
    : null;
}
