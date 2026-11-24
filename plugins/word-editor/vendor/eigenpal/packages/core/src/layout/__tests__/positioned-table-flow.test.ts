import { expect, test } from 'bun:test';
import { positionedTableFlow, type PositionedTableAnchor } from '../table-float-position.ts';

test('pending table checkpoints share prefixes and restore source order', () => {
  const anchors = Array.from({ length: 2000 }, (_, index) => ({
    table: { id: `table-${index}` },
    sourceIndex: index,
    anchorId: 'anchor',
  })) as PositionedTableAnchor[];
  const keys = anchors.map((anchor) => anchor.table.id);
  const flow = positionedTableFlow(anchors, keys);
  const ids = new Set<string>();
  const snapshots = anchors.map((anchor) => {
    const previous = flow.checkpoint(ids, []).pendingPositionedTableTokens;
    flow.add(ids, anchor.table.id);
    const snapshot = flow.checkpoint(ids, []);
    expect(snapshot.pendingPositionedTableTokens!.previous).toBe(previous);
    expect(snapshot.pendingPositionedTableTokens!.length).toBe(ids.size);
    return snapshot;
  });
  flow.restore(snapshots[999]!, ids, []);
  expect([...ids]).toEqual(keys.slice(0, 1000));
  expect(flow.same(snapshots[999]!.pendingPositionedTableTokens, [], ids, [])).toBe(true);
  ids.clear();
  expect(flow.checkpoint(ids, []).pendingPositionedTableTokens).toBeUndefined();
  flow.add(ids, keys[1500]!);
  expect(flow.checkpoint(ids, []).pendingPositionedTableTokens!.previous).toBeUndefined();
  const revised = positionedTableFlow(
    anchors,
    keys.map((key, index) => (index === 3 ? 'edited' : key))
  );
  revised.restore(snapshots[999]!, ids, []);
  expect(ids.has(keys[3]!)).toBe(false);
  expect(ids.size).toBe(999);
  expect(revised.same(snapshots[999]!.pendingPositionedTableTokens, [], ids, [])).toBe(false);
});
