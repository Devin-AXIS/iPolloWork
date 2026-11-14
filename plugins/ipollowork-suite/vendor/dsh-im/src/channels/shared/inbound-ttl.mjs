export const DEFAULT_INBOUND_TTL_HOURS = 168;
export const INBOUND_TTL_MAX_HOURS = 8760;

const INTEGER_STRING = /^[+-]?\d+$/;

/**
 * Normalize a global inbound attachment TTL. Valid values are -1 (keep
 * forever), 0 (delete once the owning turn ends), and whole hours 1..8760.
 * Integer strings are tolerated; every other input returns null.
 */
export function normalizeInboundTtlHours(value) {
  let candidate = value;
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!INTEGER_STRING.test(trimmed)) return null;
    candidate = Number(trimmed);
  }
  if (typeof candidate !== 'number' || !Number.isInteger(candidate)) return null;
  if (candidate === -1) return -1;
  if (candidate >= 0 && candidate <= INBOUND_TTL_MAX_HOURS) return candidate;
  return null;
}
