import { randomUUID } from 'node:crypto';

/**
 * One structured log line per failed or unconfirmed delivery.
 *
 * The reference id in the notice a user sees (`MF-…`) used to live only on
 * screen: when a real `CHANNEL_DELIVERY_UNCERTAIN` notice appeared, nothing in
 * the log explained it, so the id the user quoted back could not be traced.
 * This module writes the same id, the attempt history and the full text of the
 * part that failed into the local log, so the next occurrence is diagnosable.
 *
 * The line is a single string on purpose: a logger that pretty-prints an object
 * would break it across many lines and make it impossible to grep by id.
 */

/** `MF-` plus eight characters of a UUID: the id a user can quote back. */
export function createFailureReferenceId() {
  return `MF-${randomUUID().slice(0, 8).toUpperCase()}`;
}

// A bot token looks like `1234:AA…` and must never reach a log line. Only
// platform descriptions pass through the scrubber; message text is logged
// verbatim because "what could not be sent" is the whole point of the record.
const TOKEN_SHAPE = /bot\d+:[A-Za-z0-9_-]{20,}/gu;

function safeText(value) {
  return typeof value === 'string' && value ? value.replace(TOKEN_SHAPE, 'bot<redacted>') : null;
}

function attemptRecord(value) {
  if (!value || typeof value !== 'object') return null;
  const status = Number(value.status);
  const retryAfter = Number(value.retry_after ?? value.retryAfter);
  const attempt = Number(value.attempt);
  return {
    attempt: Number.isInteger(attempt) ? attempt : null,
    method: typeof value.method === 'string' && value.method ? value.method : null,
    status: Number.isInteger(status) ? status : null,
    description: safeText(value.description ?? value.message),
    retry_after: Number.isFinite(retryAfter) ? retryAfter : null,
  };
}

function partRecord(value) {
  if (!value || typeof value !== 'object') return null;
  const index = Number(value.index);
  const text = typeof value.text === 'string' ? value.text : null;
  const length = Number(value.length);
  const messageId = value.message_id ?? value.messageId ?? null;
  return {
    index: Number.isInteger(index) ? index : null,
    length: Number.isInteger(length) ? length : (text?.length ?? 0),
    message_id: messageId === null || messageId === undefined ? null : String(messageId),
    // The text is kept for parts the platform never confirmed: those are the
    // ones nobody can find in the chat afterwards.
    ...(text ? { text } : {}),
  };
}

/**
 * Build the log line for one failure object that carries a `referenceId`.
 *
 * `evidence` is what the channel could observe about the send itself (attempt
 * history, per-part message ids, chat topic, markup mode). Channels without it
 * still get a line, just a shorter one.
 */
export function deliveryFailureLogLine(channelKey, failure, evidence = null) {
  const detail = evidence && typeof evidence === 'object' ? evidence : {};
  const attempts = (Array.isArray(detail.attempts) ? detail.attempts : [])
    .map(attemptRecord)
    .filter(Boolean);
  const parts = (Array.isArray(detail.parts) ? detail.parts : [])
    .map(partRecord)
    .filter(Boolean);
  const failedPart = Number(detail.failed_part ?? detail.failedPart);
  const record = {
    referenceId: failure?.referenceId ?? null,
    code: failure?.code ?? null,
    reason: failure?.reason ?? null,
    provider_reason: safeText(detail.provider_reason ?? detail.reason),
    deliveryOutcome: detail.deliveryOutcome ?? failure?.deliveryOutcome ?? null,
    attempt_count: attempts.length,
    attempts,
    chat_id: detail.chat_id === undefined || detail.chat_id === null ? null : String(detail.chat_id),
    message_thread_id: Number.isInteger(detail.message_thread_id) ? detail.message_thread_id : null,
    parse_mode: detail.parse_mode ?? null,
    failed_part: Number.isInteger(failedPart) ? failedPart : null,
    parts,
  };
  return `[dsh-im:${channelKey}] delivery failed [${failure?.referenceId ?? 'unknown'}]: `
    + JSON.stringify(record);
}

/** Failure codes that describe a send, not something that happened before it. */
const DELIVERY_FAILURE_CODES = new Set([
  'CHANNEL_DELIVERY',
  'CHANNEL_DELIVERY_UNCERTAIN',
  'CHANNEL_PERMISSION',
  'CHANNEL_RATE_LIMIT',
]);

/** Emit the line through whatever logger the channel was given. */
export function logDeliveryFailure(logger, channelKey, failure, evidence = null) {
  if (!failure?.referenceId) return null;
  // Other failures already log their own diagnostics; this line exists for the
  // notices whose reference id would otherwise never reach the log.
  if (!evidence && !DELIVERY_FAILURE_CODES.has(failure.code)) return null;
  const line = deliveryFailureLogLine(channelKey, failure, evidence);
  (logger?.error ?? logger?.warn)?.call(logger, line);
  return line;
}
