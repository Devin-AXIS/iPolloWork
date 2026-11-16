/**
 * Per-conversation session navigation ring.
 *
 * One chat keeps an ordered list ("ring") of the Harness Sessions it has bound
 * plus a small visit stack for /go, /prev and /next. The ring is owned by the
 * conversation (not the user), so group chats share one ring.
 *
 * Shape (stored per conversationKey in ConversationStateStore):
 *
 *   {
 *     next: <int>,                        // next unused entry number; only grows
 *     entries: [{ n, sessionId, title?, lastSeenAt? }],
 *     visits: [n, ...],                   // entry numbers in visit order
 *     visitIndex: <int>,                  // current position in visits, -1 when none
 *   }
 *
 * Entry numbers start at 1 per conversation, only grow, and are never reused:
 * /drop leaves a hole. The entries array stays ordered by number.
 *
 * These functions are pure and mutate the ring object they are handed; the
 * store owns persistence and passes its live ring. Reads through the store are
 * cloned, so a caller can never mutate persisted state without the store.
 */

export function createEmptySessionRing() {
  return { next: 1, entries: [], visits: [], visitIndex: -1 };
}

function finiteTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Defensive loader: a ring read from disk is rebuilt field by field so a
 * malformed or foreign document can never break navigation.
 */
export function normalizeSessionRing(value) {
  const ring = createEmptySessionRing();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ring;
  if (Number.isSafeInteger(value.next) && value.next >= 1) ring.next = value.next;
  if (Array.isArray(value.entries)) {
    for (const item of value.entries) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      if (!Number.isSafeInteger(item.n) || item.n < 1) continue;
      if (typeof item.sessionId !== 'string' || !item.sessionId) continue;
      const entry = { n: item.n, sessionId: item.sessionId };
      if (typeof item.title === 'string' && item.title) entry.title = item.title;
      if (item.userTitled === true) entry.userTitled = true;
      const lastSeenAt = finiteTimestamp(item.lastSeenAt);
      if (lastSeenAt !== null) entry.lastSeenAt = lastSeenAt;
      ring.entries.push(entry);
    }
  }
  ring.entries.sort((left, right) => left.n - right.n);
  if (Array.isArray(value.visits)) {
    ring.visits = value.visits.filter((n) => Number.isSafeInteger(n) && n >= 1);
  }
  if (Number.isSafeInteger(value.visitIndex)) {
    ring.visitIndex = value.visitIndex;
  }
  if (ring.visitIndex < -1 || ring.visitIndex >= ring.visits.length) ring.visitIndex = -1;
  return ring;
}

export function sessionRingEntryByNumber(ring, n) {
  if (!ring || !Number.isSafeInteger(n)) return null;
  return ring.entries.find((entry) => entry.n === n) ?? null;
}

export function sessionRingEntryBySessionId(ring, sessionId) {
  if (!ring || typeof sessionId !== 'string' || !sessionId) return null;
  return ring.entries.find((entry) => entry.sessionId === sessionId) ?? null;
}

/**
 * Record that a Session became bound to this conversation. A Session already
 * in the ring is refreshed (lastSeenAt advanced, title updated when given);
 * a new one is appended with the next number. Returns { entry, created }.
 */
export function ensureSessionRingEntry(ring, sessionId, { title, now = Date.now() } = {}) {
  const at = finiteTimestamp(now) ?? Date.now();
  const existing = sessionRingEntryBySessionId(ring, sessionId);
  if (existing) {
    existing.lastSeenAt = at;
    // A user-set title must never be silently overwritten by a Host or first-
    // prompt title; only lastSeenAt is refreshed for a user-titled entry.
    if (typeof title === 'string' && title && existing.userTitled !== true) {
      existing.title = title;
    }
    return { entry: existing, created: false };
  }
  const entry = { n: ring.next, sessionId, lastSeenAt: at };
  ring.next += 1;
  if (typeof title === 'string' && title) entry.title = title;
  ring.entries.push(entry);
  return { entry, created: true };
}

/**
 * Replace the Session id of one entry in place: the number, title, and
 * user-titled flag stay untouched, only lastSeenAt is refreshed. Used by /reset
 * to keep the same slot while pointing at a fresh Session.
 */
export function replaceSessionRingEntry(ring, n, sessionId, { now = Date.now() } = {}) {
  const entry = sessionRingEntryByNumber(ring, n);
  if (!entry) return null;
  entry.sessionId = sessionId;
  entry.lastSeenAt = finiteTimestamp(now) ?? Date.now();
  return entry;
}

/** Remove one entry by number, leaving a hole. Also retires it from visits. */
export function dropSessionRingEntry(ring, n) {
  const index = ring.entries.findIndex((entry) => entry.n === n);
  if (index < 0) return false;
  ring.entries.splice(index, 1);
  const visitIndex = ring.visits.indexOf(n);
  if (visitIndex >= 0) {
    ring.visits.splice(visitIndex, 1);
    if (visitIndex < ring.visitIndex) ring.visitIndex -= 1;
    else if (visitIndex === ring.visitIndex) ring.visitIndex = Math.min(ring.visitIndex, ring.visits.length - 1);
  }
  if (ring.visitIndex < -1) ring.visitIndex = -1;
  if (ring.visitIndex >= ring.visits.length) ring.visitIndex = ring.visits.length - 1;
  return true;
}

/**
 * Remove every entry except the one at `keepN`, so its number stays and the
 * others disappear (and are never reused, as with a single /drop). The visit
 * trail is rebuilt to end on the kept entry. Returns the removed count.
 */
export function dropSessionRingAllExcept(ring, keepN) {
  const keepEntry = sessionRingEntryByNumber(ring, keepN);
  if (!keepEntry) return 0;
  const before = ring.entries.length;
  ring.entries = ring.entries.filter((entry) => entry.n === keepN);
  ring.visits = [keepN];
  ring.visitIndex = 0;
  return before - ring.entries.length;
}

export function renameSessionRingEntry(ring, n, title) {
  const entry = sessionRingEntryByNumber(ring, n);
  if (!entry) return null;
  entry.title = title;
  return entry;
}

/** /go: navigate to entry n. Truncates forward entries, then pushes/jumps. */
export function navigateSessionRing(ring, n) {
  const index = ring.visits.indexOf(n);
  if (index >= 0) {
    ring.visits.splice(index + 1);
    ring.visitIndex = index;
  } else {
    if (ring.visitIndex >= 0) ring.visits.splice(ring.visitIndex + 1);
    ring.visits.push(n);
    ring.visitIndex = ring.visits.length - 1;
  }
  return n;
}

/**
 * Append entry n to the visit history like following a link: never truncate
 * the forward entries, so the way back stays reachable. A duplicate occurrence
 * is moved to the end rather than pushed twice.
 */
export function appendSessionRing(ring, n) {
  const index = ring.visits.indexOf(n);
  if (index >= 0) ring.visits.splice(index, 1);
  ring.visits.push(n);
  ring.visitIndex = ring.visits.length - 1;
  return n;
}

/** Mark that the user set this entry's title deliberately via /title. */
export function markSessionRingEntryUserTitled(ring, n) {
  const entry = sessionRingEntryByNumber(ring, n);
  if (!entry) return null;
  entry.userTitled = true;
  return entry;
}

/** The entry /prev would walk to, or null at the beginning. */
export function sessionRingBackTarget(ring) {
  return ring.visitIndex > 0 ? ring.visits[ring.visitIndex - 1] : null;
}

/** The entry /next would walk to, or null at the end. */
export function sessionRingForwardTarget(ring) {
  return ring.visitIndex >= 0 && ring.visitIndex < ring.visits.length - 1
    ? ring.visits[ring.visitIndex + 1]
    : null;
}

/** Commit a /prev or /next step: point visitIndex at n without truncating. */
export function stepSessionRingTo(ring, n) {
  const index = ring.visits.indexOf(n);
  if (index >= 0) ring.visitIndex = index;
  return index;
}
