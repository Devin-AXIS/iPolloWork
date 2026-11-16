/**
 * Per-chat send limit for Telegram.
 *
 * Telegram counts the messages a bot creates per chat and answers 429 once the
 * budget for a chat is gone. The bot therefore paces its own new messages and
 * waits for the next free slot instead of dropping them. The value lives in the
 * bot config, is editable from the settings page, and is clamped on both sides:
 * an unparseable form entry must never leave a bot unable to send.
 *
 * Kept free of Node imports so the Web client can share the same rules.
 */

export const SET_SEND_LIMIT_ENDPOINT = 'bot.send-limit.set';
export const DEFAULT_SEND_LIMIT_PER_MINUTE = 15;
export const SEND_LIMIT_MIN_PER_MINUTE = 1;
/** Above this the bot would only wait for a budget Telegram never grants. */
export const SEND_LIMIT_MAX_PER_MINUTE = 30;

function clampSendLimit(value) {
  return Math.min(
    SEND_LIMIT_MAX_PER_MINUTE,
    Math.max(SEND_LIMIT_MIN_PER_MINUTE, Math.round(value)),
  );
}

/**
 * A usable limit per minute: 1..30, default 15.
 *
 * Numeric strings from the form are accepted; anything else — missing, NaN,
 * booleans, objects, garbage text — falls back to the default.
 */
export function normalizeSendLimitPerMinute(value) {
  const numeric = typeof value === 'string' && value.trim() ? Number(value.trim()) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
    return DEFAULT_SEND_LIMIT_PER_MINUTE;
  }
  return clampSendLimit(numeric);
}
