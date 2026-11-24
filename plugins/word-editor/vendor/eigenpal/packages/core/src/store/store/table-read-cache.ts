import type { TableTopologyLimits } from './table-constraints.ts';

/** One validated answer per immutable owner, with explicit resource-limit identity. */
export function createTableReadCache<Key extends object, Value>() {
  const entries = new WeakMap<Key, { source: object; limits: TableTopologyLimits; value: Value }>();
  return (owner: Key, source: object, limits: TableTopologyLimits, read: () => Value): Value => {
    const entry = entries.get(owner);
    if (
      entry?.source === source &&
      entry.limits.maxRows === limits.maxRows &&
      entry.limits.maxColumns === limits.maxColumns &&
      entry.limits.maxTraversalNodes === limits.maxTraversalNodes
    )
      return entry.value;
    const value = read();
    entries.set(owner, { source, limits: { ...limits }, value });
    return value;
  };
}
