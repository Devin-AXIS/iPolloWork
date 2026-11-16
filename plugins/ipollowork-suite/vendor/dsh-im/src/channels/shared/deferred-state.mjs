/** Shared durable outbox surface, stored alongside each bot's conversation state. */
export function validDeferredEntry(value) {
  return value && typeof value === 'object'
    && ['id', 'key', 'sessionId'].every((key) => typeof value[key] === 'string' && value[key])
    && ['pending', 'failed'].includes(value.status);
}

export function normalizeDeferredState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, rows]) => {
    const entries = Array.isArray(rows)
      ? rows.filter((entry) => validDeferredEntry(entry) && entry.key === key) : [];
    return entries.length ? [[key, entries]] : [];
  }));
}

export function deferredStateAccess(read, persist) {
  const rows = () => Object.values(read().deferred ?? {}).flat().filter(validDeferredEntry);
  return {
    entries: () => structuredClone(rows()),
    async put(entry) {
      if (!validDeferredEntry(entry)) throw new TypeError('Invalid deferred delivery entry');
      const state = read();
      const groups = state.deferred ??= {};
      const list = Object.hasOwn(groups, entry.key) ? groups[entry.key] : [];
      const next = [...list];
      const index = next.findIndex((candidate) => candidate.id === entry.id);
      if (index < 0) next.push(structuredClone(entry));
      else next[index] = structuredClone(entry);
      Object.defineProperty(groups, entry.key, { value: next, enumerable: true, writable: true, configurable: true });
      await persist();
    },
    async patch(id, patch) {
      const current = rows().find((entry) => entry.id === id);
      if (!current) return null;
      const next = { ...current, ...patch, id: current.id, key: current.key };
      await this.put(next);
      return structuredClone(next);
    },
    async remove(id) {
      const groups = read().deferred ?? {};
      for (const [key, list] of Object.entries(groups)) {
        if (!Array.isArray(list)) continue;
        const next = list.filter((entry) => entry.id !== id);
        if (next.length === list.length) continue;
        if (next.length) groups[key] = next;
        else delete groups[key];
        await persist();
        return;
      }
    },
  };
}
