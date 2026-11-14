/**
 * Pacing and numbering for Telegram "thinking trace" frames.
 *
 * A busy turn emits dozens of 💭/🔧 messages, so the owner can pace them to at
 * most one frame per N seconds and prefix each frame with its number in the
 * turn. Both values live in the bot config and are clamped here, once, so a
 * half-typed form entry can never reach the runtime.
 *
 * Kept free of Node imports so the Web client can share the same rules.
 */

export const SET_THINKING_CADENCE_ENDPOINT = 'bot.thinking-cadence.set';
/** 0 means "no pacing": every frame goes out as it arrives. */
export const DEFAULT_THINKING_INTERVAL_SECONDS = 0;
/** A longer window stops being a trace: the answer would overtake it. */
export const THINKING_INTERVAL_MAX_SECONDS = 60;

/**
 * A usable interval in whole seconds, 0..60.
 *
 * Numeric strings from the form are accepted; anything else — missing, NaN,
 * booleans, objects, fractional or garbage text — becomes 0, because a wrong
 * number must not silently slow the trace down.
 */
export function normalizeThinkingIntervalSeconds(value) {
  const numeric = typeof value === 'string' && value.trim() ? Number(value.trim()) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    return DEFAULT_THINKING_INTERVAL_SECONDS;
  }
  return Math.min(THINKING_INTERVAL_MAX_SECONDS, Math.max(0, numeric));
}

/** Numbering is off unless the config says otherwise. */
export function normalizeThinkingNumbering(value) {
  return value === true;
}
