export const COMMAND_LIST_TTL_MS = 15 * 60_000;
export const COMMAND_LIST_MAX_ENTRIES = 256;

/** Short-lived lists scoped to a bot's state and conversation, never persisted. */
export function createCommandListSnapshots() {
  const states = new WeakMap();
  return {
    save(state, key, value) {
      if ((!state || typeof state !== 'object') && typeof state !== 'function') return;
      let entries = states.get(state);
      if (!entries) states.set(state, entries = new Map());
      const now = Date.now();
      for (const [entryKey, entry] of entries) {
        if (entry.expiresAt <= now) entries.delete(entryKey);
      }
      entries.delete(key);
      entries.set(key, { value, expiresAt: now + COMMAND_LIST_TTL_MS });
      while (entries.size > COMMAND_LIST_MAX_ENTRIES) entries.delete(entries.keys().next().value);
    },
    load(state, key) {
      const entries = states.get(state);
      const entry = entries?.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return null;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
  };
}
