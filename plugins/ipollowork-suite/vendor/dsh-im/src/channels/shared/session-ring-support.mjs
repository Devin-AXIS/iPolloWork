/**
 * Ring support for the channels that assemble their own state store.
 *
 * The per-conversation navigation ring (`/ls`, `/go`, `/prev`, `/next`, `/drop`,
 * `/title`) lives in `ConversationStateStore`, which the token channels inherit.
 * A channel with its own store has no ring at all, and `workspace-session.mjs`
 * calls `state.ensureSessionRing?.()` optionally - so the binding is written, the
 * ring stays empty, and the chat answers "no sessions in this chat yet".
 *
 * This module is the missing half: the same methods over any live state object,
 * with the same signatures and results as `ConversationStateStore`, plus the
 * normalisation both sides share so the on-disk shape cannot drift.
 */
import {
  appendSessionRing,
  createEmptySessionRing,
  dropSessionRingAllExcept,
  dropSessionRingEntry,
  ensureSessionRingEntry,
  markSessionRingEntryUserTitled,
  navigateSessionRing,
  normalizeSessionRing,
  renameSessionRingEntry,
  replaceSessionRingEntry,
  stepSessionRingTo,
} from './session-ring.mjs';

/**
 * Rebuild `state.rings` field by field: a conversation key without a usable ring
 * is dropped entirely, so a foreign or corrupt document never becomes a ring the
 * navigation commands would act on.
 */
export function normalizeSessionRings(value) {
  const rings = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return rings;
  for (const [key, ring] of Object.entries(value)) {
    if (typeof key !== 'string' || !key) continue;
    const normalized = normalizeSessionRing(ring);
    if (normalized.entries.length > 0 || normalized.visits.length > 0) rings[key] = normalized;
  }
  return rings;
}

/** Titles the user set before any Session was bound; empty titles are dropped. */
export function normalizePendingTitles(value) {
  const titles = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return titles;
  for (const [key, title] of Object.entries(value)) {
    if (typeof key !== 'string' || !key || typeof title !== 'string' || !title.trim()) continue;
    titles[key] = title;
  }
  return titles;
}

/**
 * The ring half of a conversation state store.
 *
 * `state` is a getter returning the channel's live state object (the ring is
 * mutated in place), and `persist` is the channel's own writer: every committed
 * change goes through it, and a read (`ringFor`) never writes.
 *
 * @param {{ state: () => object, persist: () => Promise<void> }} options
 */
export function createSessionRingSupport({ state, persist } = {}) {
  if (typeof state !== 'function') throw new TypeError('state getter is required');
  if (typeof persist !== 'function') throw new TypeError('persist is required');

  const ringOf = (key) => state().rings?.[key];

  return {
    /** Read one conversation's ring (a clone; never the live object). */
    ringFor(key) {
      const ring = state().rings?.[key];
      return ring ? structuredClone(ring) : null;
    },

    /**
     * Record that a Session became bound to this conversation. A Session already
     * in the ring is refreshed; a new one gets the next number. `lastSeenAt` is
     * the Host's last-activity timestamp when known, otherwise the current time.
     * Returns { entry, created }.
     */
    async ensureSessionRing(key, sessionId, { title, lastSeenAt } = {}) {
      if (typeof key !== 'string' || !key || typeof sessionId !== 'string' || !sessionId) return null;
      const rings = state().rings ??= {};
      const ring = rings[key] ??= createEmptySessionRing();
      const result = ensureSessionRingEntry(ring, sessionId, { title, now: lastSeenAt });
      await persist();
      return result;
    },

    /** Remove one ring entry by number, leaving a hole. Returns true when dropped. */
    async dropSessionRing(key, n) {
      const ring = ringOf(key);
      if (!ring) return false;
      const removed = dropSessionRingEntry(ring, n);
      if (removed) await persist();
      return removed;
    },

    /** Remove every ring entry except the one at n. Returns the removed count. */
    async dropSessionRingAllExcept(key, n) {
      const ring = ringOf(key);
      if (!ring) return 0;
      const removed = dropSessionRingAllExcept(ring, n);
      if (removed > 0) await persist();
      return removed;
    },

    /** Rename one ring entry in place. Returns the updated entry or null. */
    async renameSessionRing(key, n, title) {
      const ring = ringOf(key);
      if (!ring) return null;
      const entry = renameSessionRingEntry(ring, n, title);
      if (entry) await persist();
      return entry ? structuredClone(entry) : null;
    },

    /** /go navigation: push/jump the visit stack onto entry n. */
    async navigateRing(key, n) {
      const ring = ringOf(key);
      if (!ring) return null;
      navigateSessionRing(ring, n);
      await persist();
      return n;
    },

    /** Commit a /prev or /next step: point the visit cursor at entry n. */
    async stepRingTo(key, n) {
      const ring = ringOf(key);
      if (!ring) return -1;
      const index = stepSessionRingTo(ring, n);
      await persist();
      return index;
    },

    /** Append a fallback jump to the visit history without truncating forward. */
    async appendRing(key, n) {
      const ring = ringOf(key);
      if (!ring) return null;
      appendSessionRing(ring, n);
      await persist();
      return n;
    },

    /** Mark an entry as user-titled so the auto title never overwrites it. */
    async markSessionRingUserTitled(key, n) {
      const ring = ringOf(key);
      if (!ring) return null;
      const entry = markSessionRingEntryUserTitled(ring, n);
      if (entry) await persist();
      return entry ? structuredClone(entry) : null;
    },

    /** Replace one entry's Session id in place (same number, /reset). */
    async replaceSessionRing(key, n, sessionId, { now } = {}) {
      const ring = ringOf(key);
      if (!ring) return null;
      const entry = replaceSessionRingEntry(ring, n, sessionId, { now });
      if (entry) await persist();
      return entry ? structuredClone(entry) : null;
    },

    /** Remember a title the user set before a Session was bound yet. */
    async setPendingTitle(key, title) {
      if (typeof key !== 'string' || !key || typeof title !== 'string' || !title.trim()) return null;
      const titles = state().pendingTitles ??= {};
      titles[key] = title;
      await persist();
      return title;
    },

    /** Read and clear the pending title for one conversation, if any. */
    async takePendingTitle(key) {
      const titles = state().pendingTitles;
      if (!titles || !Object.hasOwn(titles, key)) return null;
      const title = titles[key];
      delete titles[key];
      if (Object.keys(titles).length === 0) delete state().pendingTitles;
      await persist();
      return title;
    },
  };
}
