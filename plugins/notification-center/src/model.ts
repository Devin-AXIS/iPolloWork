import type { NoticeItem, NotificationCenter, NotificationSource } from './contract.ts';

export const feedLimit = 200;
export interface FeedRow extends NoticeItem {
  key: string;
  sourceId: string;
  sourceLabel: string;
  canOpen: boolean;
}
interface FeedSource {
  id: string;
  label: string;
  enabled: boolean;
}
export interface NotificationPreferences {
  sourceEnabled: Readonly<Record<string, boolean>>;
}

export function notificationCenter() {
  const sources = new Map<string, NotificationSource>();
  const listeners = new Set<() => void>();
  let preferences: NotificationPreferences['sourceEnabled'] | null = {};
  let snapshot: { rows: readonly FeedRow[]; sources: readonly FeedSource[] } = { rows: [], sources: [] };
  function update() {
    const rows: FeedRow[] = [];
    const choices: FeedSource[] = [];
    for (const [sourceId, source] of sources) {
      const sourceLabel = source.label();
      const enabled = preferences?.[sourceId] !== false;
      choices.push({ id: sourceId, label: sourceLabel, enabled });
      if (!enabled || preferences === null) continue;
      const ids = new Set<string>();
      for (const item of source.getSnapshot().slice(0, feedLimit)) {
        if (!item.id || !item.title.trim() || !Number.isFinite(new Date(item.createdAt).getTime()) || ids.has(item.id)) continue;
        ids.add(item.id);
        rows.push({ ...item, key: sourceId + ':' + item.id, sourceId, sourceLabel, canOpen: Boolean(source.open) });
      }
    }
    snapshot = {
      rows: rows.sort((left, right) => right.createdAt - left.createdAt || left.key.localeCompare(right.key)),
      sources: choices.sort((left, right) => left.label.localeCompare(right.label)),
    };
    for (const listener of listeners) listener();
  }
  const service: NotificationCenter = {
    registerSource(id, source) {
      if (!/^[a-z][a-z0-9.-]{0,79}$/.test(id) || sources.has(id)) throw new Error('Invalid or duplicate notification source: ' + id);
      sources.set(id, source);
      let unsubscribe = () => {};
      try {
        unsubscribe = source.subscribe(update);
        update();
      } catch (error) {
        sources.delete(id);
        unsubscribe();
        throw error;
      }
      return () => {
        if (sources.get(id) !== source) return;
        sources.delete(id);
        unsubscribe();
        update();
      };
    },
  };
  async function act(row: FeedRow, action: 'open' | 'markRead') {
    const source = sources.get(row.sourceId);
    if (!source || preferences === null || preferences[row.sourceId] === false ||
        !source.getSnapshot().some(item => item.id === row.id)) return;
    await source[action]?.(row.id);
  }
  return {
    service, act,
    getSnapshot: () => snapshot.rows,
    getSources: () => snapshot.sources,
    setPreferences(next: NotificationPreferences['sourceEnabled'] | null) {
      preferences = next;
      update();
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
