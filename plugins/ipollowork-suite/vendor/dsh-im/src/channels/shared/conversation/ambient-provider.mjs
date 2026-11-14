/**
 * Ambient context: the inferred-relation half of the context engine.
 *
 * Explicit relations (reply, thread root, bot-event binding) never need this
 * module; it exists for the case where nobody replied, nobody opened a thread,
 * yet a human reading the room obviously groups the messages anyway — a sender
 * firing a burst of short messages right before addressing the bot. The
 * provider reads the channel's bounded room history record (no second store),
 * and a burst is a trailing same-sender run whose consecutive entries stay
 * within `burstGapMs`; anything older or broken by the gap falls back to the
 * bounded recent window. Entries the record already marked as injected are
 * never re-offered, so ambient context is consumed at most once per entry.
 */

function boundedInt(value, min, max, fallback) {
  if (!Number.isSafeInteger(value) || value <= 0) return fallback;
  return Math.min(Math.max(value, min), max);
}

export const DEFAULT_AMBIENT_BURST_GAP_MS = 90_000;
export const DEFAULT_AMBIENT_WINDOW_MS = 180_000;
export const DEFAULT_AMBIENT_RECENT_COUNT = 20;
export const DEFAULT_AMBIENT_MAX_CONTEXT_CHARS = 8_000;

export class WindowAmbientProvider {
  #store;
  #burstGapMs;
  #windowMs;
  #recentCount;
  #maxContextChars;

  constructor({
    store,
    burstGapMs = DEFAULT_AMBIENT_BURST_GAP_MS,
    recentWindowMs = DEFAULT_AMBIENT_WINDOW_MS,
    recentCount = DEFAULT_AMBIENT_RECENT_COUNT,
    maxContextChars = DEFAULT_AMBIENT_MAX_CONTEXT_CHARS,
  } = {}) {
    this.#store = store && typeof store.search === 'function' ? store : null;
    this.#burstGapMs = boundedInt(burstGapMs, 5_000, 3_600_000, DEFAULT_AMBIENT_BURST_GAP_MS);
    this.#windowMs = boundedInt(recentWindowMs, 10_000, 86_400_000, DEFAULT_AMBIENT_WINDOW_MS);
    this.#recentCount = boundedInt(recentCount, 1, 200, DEFAULT_AMBIENT_RECENT_COUNT);
    this.#maxContextChars = boundedInt(maxContextChars, 200, 200_000, DEFAULT_AMBIENT_MAX_CONTEXT_CHARS);
  }

  /**
   * Collect the ambient entries that may accompany one triggered message.
   * @param {{roomId: string, senderId: string, threadId?: string|null, now?: number}} query
   *   — the optional `threadId` keeps the window inside one message list: the
   *   room's mainline (`null`) or the named thread, matching what members read
   *   in the current conversation.
   * @returns {{burst: object[], recent: object[]}} both chronological; already-consumed and
   *   non-human entries are excluded, and the recent list never repeats a burst entry.
   */
  query({ roomId, senderId, threadId = null, now = Date.now() } = {}) {
    if (!this.#store || !roomId || typeof senderId !== 'string' || !senderId) {
      return { burst: [], recent: [] };
    }
    const wantedThread = typeof threadId === 'string' && threadId ? threadId : null;
    const span = Math.max(this.#windowMs, this.#burstGapMs);
    // The record answers newest-first; one extra slice covers the burst run on
    // top of the recent budget before anything is filtered out.
    const fetched = this.#store.search({
      roomId,
      from: now - span,
      to: now,
      limit: Math.min(500, Math.max(this.#recentCount * 4, 60)),
    });
    // The record keeps arrival order, which a replayed or seeded batch can leave
    // out of timestamp order; the gap walk and the recency budgets need true time order.
    const chronological = [...(Array.isArray(fetched) ? fetched : [])].sort((left, right) => left.ts - right.ts);
    // The record's own notion of un-consumed human speech is the pending list;
    // `search` answers over all retained entries, so intersect with it instead of
    // trusting the per-entry flag, which is only the record's rendering of it.
    const pendingIds = typeof this.#store.pending === 'function'
      ? new Set(this.#store.pending({ roomId, limit: 5_000 }).map((entry) => entry.eventId))
      : null;
    const candidates = chronological.filter((entry) => entry.kind === 'human'
      && entry.injected !== true
      && (entry.threadId ?? null) === wantedThread
      && (pendingIds === null || pendingIds.has(entry.eventId)));
    const burst = [];
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const entry = candidates[index];
      if (entry.sender !== senderId) break;
      const later = burst[burst.length - 1];
      if (later && later.ts - entry.ts > this.#burstGapMs) break;
      burst.push(entry);
    }
    burst.reverse();
    const burstIds = new Set(burst.map((entry) => entry.eventId));
    const recent = [];
    let used = 0;
    for (let index = candidates.length - 1; index >= 0 && recent.length < this.#recentCount; index -= 1) {
      const entry = candidates[index];
      if (burstIds.has(entry.eventId)) continue;
      const cost = entry.text.length + (entry.name ? entry.name.length + 2 : 1);
      if (used + cost > this.#maxContextChars) break;
      used += cost;
      recent.unshift(entry);
    }
    return { burst, recent };
  }

  /**
   * Mark the offered entries as consumed so they are not offered again.
   * @param {{roomId: string, entries: object[]}} consumed
   * @returns {Promise<number>} the number newly marked; 0 when the record cannot mark.
   */
  async markConsumed({ roomId, entries } = {}) {
    if (!this.#store || typeof this.#store.markInjected !== 'function') return 0;
    if (!roomId || !Array.isArray(entries) || entries.length === 0) return 0;
    return await this.#store.markInjected(roomId, entries.map((entry) => entry.eventId));
  }
}
