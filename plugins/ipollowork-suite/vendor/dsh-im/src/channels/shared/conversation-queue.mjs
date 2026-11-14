// conversation-queue.mjs — serialise work per conversation without blocking others.
//
// A channel may need to do expensive prep work (audio download and
// transcription, for example) before a message reaches the Harness. Awaiting it
// inside the transport loop stalls every other conversation and the update
// cursor alike, so the work is queued per conversation instead: ordering inside
// one chat is preserved, other chats and callbacks proceed immediately.

/**
 * Create a per-key promise chain.
 *
 * @param {{ onError?: (error: unknown, key: string) => void }} options
 * @returns {{ run: (key: string, task: () => Promise<unknown>) => Promise<unknown>,
 *   idle: (key?: string) => Promise<void>, size: () => number }}
 */
export function createConversationQueue({ onError = null } = {}) {
  /** @type {Map<string, Promise<unknown>>} */
  const chains = new Map();

  const run = (key, task) => {
    const previous = chains.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => task())
      .catch((error) => {
        onError?.(error, key);
      })
      .finally(() => {
        // The tail of the chain is dropped once it settles, so a quiet
        // conversation holds no state.
        if (chains.get(key) === next) chains.delete(key);
      });
    chains.set(key, next);
    return next;
  };

  return {
    run,
    async idle(key) {
      if (key === undefined) {
        while (chains.size > 0) await Promise.all([...chains.values()]);
        return;
      }
      const chain = chains.get(key);
      if (chain) await chain;
    },
    size: () => chains.size,
  };
}
