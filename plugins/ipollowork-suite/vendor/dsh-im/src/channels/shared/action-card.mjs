import { randomBytes } from 'node:crypto';

import { t } from './i18n.mjs';

/**
 * Shared foundation for interactive cards that carry a one-shot button press.
 *
 * Every carded channel needs the same four things, and four independent
 * implementations already existed (Feishu card keys, QQ opaque tokens, DingTalk
 * revisions, Telegram question nonces). This module provides them once:
 *
 * - a versioned, bounded callback namespace (`<prefix>|<nonce>|<action>`) so a
 *   keyboard press is attributable to exactly one presentation;
 * - a nonce registry with TTL and capacity limits, so a dead card cannot grow
 *   memory forever;
 * - a synchronous first-press claim, so two taps (or two clients) execute once;
 * - one set of Chinese notices for pressed/expired/superseded cards.
 *
 * Cards that also need to re-check live data (a list shrank, a session was
 * deleted) should `claim()` first and then `settle(nonce, 'stale')` when the
 * re-check fails.
 */

/** Telegram rejects callback_data longer than 64 bytes. */
export const ACTION_CARD_CALLBACK_MAX_BYTES = 64;

const CALLBACK_PREFIX_PATTERN = /^[a-z][a-z0-9]{0,7}$/u;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/u;
const ACTION_PATTERN = /^[A-Za-z0-9_-]{1,16}$/u;
const DEFAULT_NONCE_BYTES = 9;

export const ACTION_CARD_STATUS = Object.freeze({
  /** Rendered, waiting for its first press. */
  ACTIVE: 'active',
  /** Pressed; the handler owns the outcome now. */
  CLAIMED: 'claimed',
  /** Handled successfully. */
  RESOLVED: 'resolved',
  /** TTL elapsed (approval timeout, dead keyboard). */
  EXPIRED: 'expired',
  /** A newer card replaced this one in the same conversation. */
  SUPERSEDED: 'superseded',
  /** The live re-check after a press found the underlying state changed. */
  STALE: 'stale',
  /** The owner revoked the card (route closed, approval withdrawn). */
  REVOKED: 'revoked',
  /** No such nonce (process restarted, foreign payload). */
  UNKNOWN: 'unknown',
});

const LIVE_STATUSES = new Set([ACTION_CARD_STATUS.ACTIVE, ACTION_CARD_STATUS.CLAIMED]);
const TERMINAL_STATUSES = new Set([
  ACTION_CARD_STATUS.RESOLVED,
  ACTION_CARD_STATUS.EXPIRED,
  ACTION_CARD_STATUS.SUPERSEDED,
  ACTION_CARD_STATUS.STALE,
  ACTION_CARD_STATUS.REVOKED,
]);

/** One notice per card state; channels override the wording per surface. */
export const ACTION_CARD_STATE_TEXTS = Object.freeze({
  [ACTION_CARD_STATUS.ACTIVE]: '正在处理，请稍候。',
  [ACTION_CARD_STATUS.CLAIMED]: '正在提交，请稍候。',
  [ACTION_CARD_STATUS.RESOLVED]: '该操作已处理，无需重复操作。',
  [ACTION_CARD_STATUS.EXPIRED]: '该操作已过期，请重新打开。',
  [ACTION_CARD_STATUS.SUPERSEDED]: '该操作已被新操作取代，请使用最新一条。',
  [ACTION_CARD_STATUS.STALE]: '该内容已变化，请重新打开后再操作。',
  [ACTION_CARD_STATUS.REVOKED]: '该操作已失效，请重新打开。',
  [ACTION_CARD_STATUS.UNKNOWN]: '该操作已失效或不存在。',
});

/**
 * A random, URL-safe presentation identity.
 * 9 bytes → 12 base64url characters: collision-safe per conversation and small
 * enough that the whole callback payload stays far under 64 bytes.
 */
export function createActionNonce(byteLength = DEFAULT_NONCE_BYTES) {
  if (!Number.isInteger(byteLength) || byteLength < 1 || byteLength > 24) {
    throw new TypeError('An action card nonce needs 1..24 random bytes');
  }
  return randomBytes(byteLength).toString('base64url');
}

/**
 * Build one versioned callback namespace, e.g. `ap1|<nonce>|<action>`.
 * Encoding validates every token before emitting it, so a button can always be
 * attributed and can never exceed Telegram's callback budget.
 */
export function createCallbackNamespace(prefix) {
  if (typeof prefix !== 'string' || !CALLBACK_PREFIX_PATTERN.test(prefix)) {
    throw new TypeError('An action card callback prefix is invalid');
  }
  const maxBytes = ACTION_CARD_CALLBACK_MAX_BYTES;
  return Object.freeze({
    prefix,
    maxBytes,
    encode({ nonce, action } = {}) {
      if (typeof nonce !== 'string' || !NONCE_PATTERN.test(nonce)) {
        throw new TypeError('An action card nonce is invalid');
      }
      if (typeof action !== 'string' || !ACTION_PATTERN.test(action)) {
        throw new TypeError('An action card action is invalid');
      }
      const data = `${prefix}|${nonce}|${action}`;
      if (Buffer.byteLength(data, 'utf8') > maxBytes) {
        throw new TypeError(`An action card callback must be at most ${maxBytes} bytes`);
      }
      return data;
    },
    parse(data) {
      if (typeof data !== 'string') return null;
      const parts = data.split('|');
      if (parts.length !== 3 || parts[0] !== prefix) return null;
      const [, nonce, action] = parts;
      if (!NONCE_PATTERN.test(nonce) || !ACTION_PATTERN.test(action)) return null;
      return { nonce, action };
    },
  });
}

/** The notice shown for a dead or already-handled card. */
export function actionCardStateText(status, texts = {}) {
  const override = texts && typeof texts === 'object' ? texts[status] : undefined;
  const fallback = ACTION_CARD_STATE_TEXTS[status]
    ?? (texts && typeof texts === 'object' ? texts[ACTION_CARD_STATUS.UNKNOWN] : undefined)
    ?? ACTION_CARD_STATE_TEXTS[ACTION_CARD_STATUS.UNKNOWN];
  return t(typeof override === 'string' && override ? override : fallback);
}

/**
 * In-memory presentation registry for one channel.
 *
 * Entries live for `ttlMs`; a terminal entry is kept until then so a late press
 * still gets "已处理/已过期" instead of a generic "不存在". At most
 * `maxEntries` cards are remembered (oldest is evicted first) and a new card in
 * a conversation supersedes the previous live one.
 */
/** Telegram truncates button labels itself; we never want to rely on that. */
export const ACTION_CARD_BUTTON_TEXT_MAX = 60;

const UNSAFE_BUTTON_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;

/**
 * Make arbitrary text safe to put on a button.
 *
 * Workspace paths, session titles and preset labels all reach buttons, and any
 * of them can carry control characters or newlines that would break the layout
 * (or, for a bidirectional override, reorder what the user reads). Every card did
 * this slightly differently — one of them skipped the control-character pass —
 * so it lives here now and all of them call it.
 */
export function safeButtonText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(UNSAFE_BUTTON_TEXT, ' ').replace(/\s+/gu, ' ').trim();
}

/** `safeButtonText` plus the ellipsis every button label needs. */
export function truncateButtonText(value) {
  const text = safeButtonText(value) || '•';
  return text.length > ACTION_CARD_BUTTON_TEXT_MAX
    ? `${text.slice(0, ACTION_CARD_BUTTON_TEXT_MAX - 1)}…`
    : text;
}

/**
 * Longest we will wait for a rate-limited card operation.
 *
 * Telegram answers a throttled call with `retry_after` and expects the bot to
 * come back then. A card edit is cheap and user-initiated (they just pressed a
 * button), so waiting a few seconds and trying once more is much better than
 * telling them "could not update, send the command again". Anything longer than
 * this is not worth holding the turn open: the caller falls back.
 */
export const ACTION_CARD_RETRY_MAX_WAIT_MS = 5_000;

/** `retry_after` in milliseconds, read from either spelling Telegram uses. */
function rateLimitDelayMs(error) {
  const value = error?.retry_after ?? error?.retryAfter;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.ceil(seconds * 1_000);
}

function isRateLimited(error) {
  const code = Number(error?.providerCode ?? error?.status);
  return code === 429 || error?.code === 'telegram-429';
}

/**
 * Run one Telegram card operation, honouring a 429 exactly once.
 *
 * Every card paid for this separately before: a throttled edit surfaced as
 * "无法更新卡片，请重新发送命令" even though Telegram had just said when to retry.
 * This helper makes that recovery the default for all cards.
 *
 * Returns the operation's result, or rethrows the last error.
 */
export async function withActionCardRetry(operation, {
  maxWaitMs = ACTION_CARD_RETRY_MAX_WAIT_MS,
} = {}) {
  try {
    return await operation();
  } catch (error) {
    const delay = isRateLimited(error) ? rateLimitDelayMs(error) : null;
    // Only a short, explicit, known wait is worth taking; anything else is the
    // caller's failure to report.
    if (delay === null || delay > maxWaitMs) throw error;
    // Deliberately NOT unref'd: a throttled retry is the only thing this call is
    // waiting for, so the timer must keep the loop alive until it fires.
    await new Promise((resolve) => { setTimeout(resolve, delay); });
    return operation();
  }
}

export class ActionCardRegistry {
  #ttlMs;
  #maxEntries;
  #now;
  #createNonce;
  #entries = new Map();

  constructor({
    ttlMs = 3_600_000,
    maxEntries = 256,
    now = Date.now,
    createNonce = createActionNonce,
  } = {}) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new TypeError('An action card TTL must be a positive number');
    }
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new TypeError('An action card capacity must be a positive integer');
    }
    if (typeof now !== 'function') throw new TypeError('An action card clock must be a function');
    if (typeof createNonce !== 'function') {
      throw new TypeError('An action card nonce factory must be a function');
    }
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
    this.#now = now;
    this.#createNonce = createNonce;
  }

  get size() {
    return this.#entries.size;
  }

  /**
   * Register one presentation. Issuing a new card in the same conversation
   * retires the previous live one — one conversation shows one working card.
   */
  issue({ conversationKey, kind = '', payload = {}, ttlMs } = {}) {
    const key = typeof conversationKey === 'string' ? conversationKey.trim() : '';
    if (!key) throw new TypeError('An action card requires a conversation key');
    const now = this.#now();
    const lifetime = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : this.#ttlMs;
    // Drop long-dead cards so TTL memory is reclaimed even when presses stop.
    this.purge();
    this.revokeConversation(key, { status: ACTION_CARD_STATUS.SUPERSEDED });

    let nonce = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = this.#createNonce();
      if (typeof candidate !== 'string' || !NONCE_PATTERN.test(candidate)) {
        throw new TypeError('An action card nonce must be 1..32 URL-safe characters');
      }
      if (!this.#entries.has(candidate)) {
        nonce = candidate;
        break;
      }
    }
    if (nonce === null) throw new Error('Could not allocate a unique action card nonce');

    const entry = {
      nonce,
      conversationKey: key,
      kind: typeof kind === 'string' ? kind : '',
      payload: payload && typeof payload === 'object' ? payload : {},
      status: ACTION_CARD_STATUS.ACTIVE,
      createdAt: now,
      expiresAt: now + lifetime,
      claimedAt: null,
      settledAt: null,
    };
    this.#entries.set(nonce, entry);
    this.#enforceCapacity();
    return entry;
  }

  /** Read an entry (and lazily mark it expired when its TTL elapsed). */
  get(nonce) {
    const entry = this.#lookup(nonce);
    if (!entry) return null;
    this.#expireIfNeeded(entry);
    return entry;
  }

  /**
   * Claim the first press synchronously. The caller must call this before its
   * first `await`, so a second tap cannot also see the card as active.
   */
  claim(nonce) {
    const entry = this.#lookup(nonce);
    if (!entry) return { status: ACTION_CARD_STATUS.UNKNOWN, entry: null };
    this.#expireIfNeeded(entry);
    const liveStatus = entry.status;
    if (liveStatus === ACTION_CARD_STATUS.ACTIVE) {
      entry.status = ACTION_CARD_STATUS.CLAIMED;
      entry.claimedAt = this.#now();
    }
    // `active` means this caller won the claim; any other value is a refusal.
    return { status: liveStatus, entry };
  }

  /**
   * Give a claimed card its keyboard back after an operation that failed but is
   * still retryable (a transient RPC error, a refused write).
   *
   * `settle()` only accepts terminal statuses, so a caller that wants the press
   * to be available again has no other way back. Only a live claim can be
   * released: a card already resolved, expired or superseded must stay dead, or
   * a stale press could act on newer state. Returns the released entry, or null.
   */
  releaseClaim(nonce) {
    const entry = this.#lookup(nonce);
    if (!entry) return null;
    this.#expireIfNeeded(entry);
    if (entry.status !== ACTION_CARD_STATUS.CLAIMED) return null;
    entry.status = ACTION_CARD_STATUS.ACTIVE;
    entry.claimedAt = null;
    return entry;
  }

  /**
   * Move a live card to a terminal state. Returns false when there is nothing
   * left to settle (unknown, expired, or already settled).
   */
  settle(nonce, status = ACTION_CARD_STATUS.RESOLVED) {
    if (!TERMINAL_STATUSES.has(status)) {
      throw new TypeError('An action card can only settle to a terminal status');
    }
    const entry = this.#lookup(nonce);
    if (!entry) return false;
    this.#expireIfNeeded(entry);
    if (!LIVE_STATUSES.has(entry.status)) return false;
    entry.status = status;
    entry.settledAt = this.#now();
    return true;
  }

  /** The one live card of a conversation, if any. */
  activeFor(conversationKey) {
    for (const entry of this.#entries.values()) {
      if (entry.conversationKey !== conversationKey) continue;
      this.#expireIfNeeded(entry);
      if (LIVE_STATUSES.has(entry.status)) return entry;
    }
    return null;
  }

  /** Retire every live card of one conversation (route closed, list changed). */
  revokeConversation(conversationKey, { status = ACTION_CARD_STATUS.SUPERSEDED } = {}) {
    if (!TERMINAL_STATUSES.has(status)) {
      throw new TypeError('An action card can only be revoked to a terminal status');
    }
    let revoked = 0;
    for (const entry of this.#entries.values()) {
      if (entry.conversationKey !== conversationKey) continue;
      this.#expireIfNeeded(entry);
      if (!LIVE_STATUSES.has(entry.status)) continue;
      entry.status = status;
      entry.settledAt = this.#now();
      revoked += 1;
    }
    return revoked;
  }

  /** Drop every entry whose TTL elapsed; returns how many were removed. */
  purge() {
    const now = this.#now();
    let removed = 0;
    for (const [nonce, entry] of this.#entries) {
      if (now >= entry.expiresAt) {
        this.#entries.delete(nonce);
        removed += 1;
      }
    }
    return removed;
  }

  #lookup(nonce) {
    return typeof nonce === 'string' ? this.#entries.get(nonce) ?? null : null;
  }

  #expireIfNeeded(entry) {
    if (!LIVE_STATUSES.has(entry.status)) return;
    if (this.#now() < entry.expiresAt) return;
    entry.status = ACTION_CARD_STATUS.EXPIRED;
    entry.settledAt = entry.expiresAt;
  }

  #enforceCapacity() {
    while (this.#entries.size > this.#maxEntries) {
      this.#entries.delete(this.#entries.keys().next().value);
    }
  }
}
