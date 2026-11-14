// Global (not per-bot) settings that decide whether dsh-im delivers turns the
// IM user did not start themselves: a turn initiated in the DSH Web GUI and a
// turn initiated by a service notice (a schedule reminder, a subagent settling,
// an answered question). The same document also carries the two text prefixes
// that mark a mirrored user message and a delivered model answer.

export const DELIVERY_SYNC_SETTINGS_VERSION = 1;

/** Longest accepted icon prefix, in characters. */
export const DELIVERY_SYNC_ICON_MAX_LENGTH = 32;

export const DEFAULT_DELIVERY_SYNC_SETTINGS = Object.freeze({
  // Mirror the user's own Web input into the chat. Off by default: a chat that
  // receives every desktop keystroke is noisy until the reader asks for it.
  mirrorUserInput: false,
  // Deliver the model answer of a turn that did not start in this chat. Off by
  // default like the input mirror: mirroring is something the reader asks for,
  // never something a fresh or unreadable document starts on its own.
  deliverModelAnswers: false,
  inputIcon: '',
  modelIcon: '',
});

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalize one message prefix. The empty string is a valid prefix (no prefix
 * at all), so a malformed icon degrades to "no icon" instead of failing the
 * whole save — a reader who pastes 40 emoji should lose the icon, not the
 * checkbox they just set.
 */
export function normalizeDeliverySyncIcon(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > DELIVERY_SYNC_ICON_MAX_LENGTH) return '';
  // Line breaks would split the prefix from the text it introduces, and other
  // control characters are invisible in the settings field.
  if (CONTROL_CHARACTER.test(trimmed)) return '';
  return trimmed;
}

function booleanOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Normalize one complete settings document body. Missing fields fall back to
 * the defaults so a document written by an older build still loads; a value
 * that is not an object at all returns null, which the store treats as damage.
 */
export function normalizeDeliverySyncSettings(value) {
  if (!isRecord(value)) return null;
  return Object.freeze({
    mirrorUserInput: booleanOr(value.mirrorUserInput, DEFAULT_DELIVERY_SYNC_SETTINGS.mirrorUserInput),
    deliverModelAnswers: booleanOr(
      value.deliverModelAnswers,
      DEFAULT_DELIVERY_SYNC_SETTINGS.deliverModelAnswers,
    ),
    inputIcon: normalizeDeliverySyncIcon(value.inputIcon),
    modelIcon: normalizeDeliverySyncIcon(value.modelIcon),
  });
}

/**
 * Whether both delivery switches are off. This is the one predicate for
 * silencing a Session's targets: the coordinator's target path and a channel's
 * own mirror (the Feishu process card) both consult it, so "both off means this
 * chat receives nothing" holds for every path that follows a Session.
 *
 * A value that cannot be normalized counts as off, so a damaged document fails
 * closed here as it does in the coordinator.
 */
export function deliverySwitchesOff(value) {
  const settings = normalizeDeliverySyncSettings(value) ?? DEFAULT_DELIVERY_SYNC_SETTINGS;
  return settings.mirrorUserInput === false && settings.deliverModelAnswers === false;
}

/**
 * Apply a partial update (one RPC `set` payload) to the stored settings.
 * Only the fields actually present are applied, so the settings page can save
 * one row at a time without echoing back a stale snapshot of the others.
 */
export function applyDeliverySyncPatch(current, patch) {
  const base = normalizeDeliverySyncSettings(current) ?? DEFAULT_DELIVERY_SYNC_SETTINGS;
  if (!isRecord(patch)) return base;
  const next = { ...base };
  if (Object.hasOwn(patch, 'mirrorUserInput') && typeof patch.mirrorUserInput === 'boolean') {
    next.mirrorUserInput = patch.mirrorUserInput;
  }
  if (Object.hasOwn(patch, 'deliverModelAnswers') && typeof patch.deliverModelAnswers === 'boolean') {
    next.deliverModelAnswers = patch.deliverModelAnswers;
  }
  for (const field of ['inputIcon', 'modelIcon']) {
    if (Object.hasOwn(patch, field) && typeof patch[field] === 'string') {
      next[field] = normalizeDeliverySyncIcon(patch[field]);
    }
  }
  return Object.freeze(next);
}

/** Whether a payload carries only fields this document understands. */
export function deliverySyncPatchKeys(patch) {
  if (!isRecord(patch)) return null;
  const keys = Object.keys(patch);
  const known = Object.keys(DEFAULT_DELIVERY_SYNC_SETTINGS);
  return keys.every((key) => known.includes(key)) ? keys : null;
}

/**
 * Render one delivered message body. A non-empty icon is separated from the
 * text by a blank line so the prefix reads as a label rather than as part of
 * the sentence.
 */
export function withDeliverySyncIcon(icon, text) {
  const normalized = normalizeDeliverySyncIcon(icon);
  return normalized ? `${normalized}\n\n${text}` : text;
}
