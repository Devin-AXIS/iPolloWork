/**
 * Explicit-relation context: the reply ancestor chain.
 *
 * A reply is a fact the platform states, not a guess, so it never consults the
 * ambient record: the channel injects a `fetch` that resolves one event id to
 * its text (Matrix: CS API single-event lookup, Feishu: OpenAPI message get).
 * The walk is depth-bounded and loop-guarded because reply relations are
 * user-authored data; a cyclic chain terminates on the first repeat instead of
 * spinning. The result is oldest-first so the prompt reads cause before effect.
 */

/**
 * @typedef {Object} ReplyChainNode
 * @property {string} eventId
 * @property {string} sender
 * @property {string} name           Display name when the channel knows one.
 * @property {string} text
 * @property {?number} ts
 */

/**
 * A tiny most-recent-used cache for single-event lookups so a burst of replies
 * into one chain does not refetch shared ancestors. Insertion order is the LRU
 * order; reading refreshes recency.
 * @param {number} [capacity=256]
 */
export function createEventLru(capacity = 256) {
  const cap = Number.isSafeInteger(capacity) && capacity > 0 ? capacity : 256;
  const entries = new Map();
  return {
    get size() {
      return entries.size;
    },
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, value);
      while (entries.size > cap) {
        const oldest = entries.keys().next().value;
        entries.delete(oldest);
      }
      return value;
    },
    delete(key) {
      return entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
}

/**
 * Walk `startReplyTo` upward through the reply relations the platform reports.
 * @param {Object} input
 * @param {(eventId: string) => Promise<{sender?: string, name?: string, text: string, replyTo?: ?string, ts?: ?number}|null>} input.fetch
 *   Resolves one event, or null when it is gone, undecryptable, or not a message.
 * @param {?string} input.startReplyTo The reply target of the triggering message.
 * @param {number} [input.maxDepth=5]
 * @returns {Promise<ReplyChainNode[]>} oldest ancestor first; empty when there is no chain.
 */
export async function resolveReplyChain({ fetch, startReplyTo, maxDepth = 5 } = {}) {
  const chain = [];
  if (typeof fetch !== 'function') return chain;
  const depth = Number.isSafeInteger(maxDepth) && maxDepth > 0 ? Math.min(maxDepth, 10) : 5;
  const visited = new Set();
  let cursor = typeof startReplyTo === 'string' && startReplyTo ? startReplyTo : null;
  while (cursor && !visited.has(cursor) && chain.length < depth) {
    visited.add(cursor);
    let event = null;
    try {
      event = await fetch(cursor);
    } catch {
      // A channel lookup failure leaves the chain exactly as far as it reached;
      // a partial explicit context still beats dropping the whole turn's context.
      event = null;
    }
    if (!event || typeof event.text !== 'string' || !event.text) break;
    chain.push({
      eventId: cursor,
      sender: typeof event.sender === 'string' ? event.sender : '',
      name: typeof event.name === 'string' ? event.name : '',
      text: event.text,
      ts: Number.isSafeInteger(event.ts) && event.ts > 0 ? event.ts : null,
    });
    cursor = typeof event.replyTo === 'string' && event.replyTo ? event.replyTo : null;
  }
  return chain.reverse();
}
