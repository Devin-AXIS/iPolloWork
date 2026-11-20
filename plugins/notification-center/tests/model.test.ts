import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationCenter } from '../src/model.ts';
import type { NoticeItem, NotificationSource } from '../src/contract.ts';

function feed(label: string, createdAt: number) {
  const listeners = new Set<() => void>();
  let rows: NoticeItem[] = [{ id: 'one', title: label, createdAt, read: false }];
  const actions: string[] = [];
  const source: NotificationSource = {
    label: () => label,
    getSnapshot: () => rows,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    markRead(id) {
      actions.push('read:' + id);
      rows = rows.map(item => item.id === id ? { ...item, read: true } : item);
      for (const listener of listeners) listener();
    },
    open(id) { actions.push('open:' + id); },
  };
  return { source, actions, listeners };
}

test('merges source feeds, preserves identical ids from different sources and routes read state to the owner', async () => {
  const center = notificationCenter();
  const board = feed('Board', 10);
  const conversation = feed('Conversation', 15);
  const detach = center.service.registerSource('ipollo.board', board.source);
  center.service.registerSource('dsh.conversations', conversation.source);
  const [latest, first] = center.getSnapshot();
  assert(latest && first);
  assert.equal(latest.sourceLabel, 'Conversation');
  assert.equal(first.sourceLabel, 'Board');
  assert.notEqual(first.key, latest.key);

  await center.act(first, 'markRead');
  await center.act(latest, 'open');
  assert.deepEqual(board.actions, ['read:one']);
  assert.deepEqual(conversation.actions, ['open:one']);
  assert.equal(center.getSnapshot().find(row => row.key === first.key)?.read, true);
  detach();
  assert.equal(board.listeners.size, 0);
  assert.deepEqual(center.getSnapshot().map(row => row.sourceId), ['dsh.conversations']);
  await center.act(first, 'open');
  assert.deepEqual(board.actions, ['read:one']);
});

test('rejects duplicate source registrations and ignores duplicate or invalid feed rows', () => {
  const center = notificationCenter();
  const { source } = feed('Board', 10);
  center.service.registerSource('ipollo.board', {
    ...source,
    getSnapshot: () => [...source.getSnapshot(), ...source.getSnapshot(), {
      id: 'bad-time', title: 'Invalid', createdAt: Number.MAX_VALUE, read: true,
    }],
  });
  assert.throws(() => center.service.registerSource('ipollo.board', source), /duplicate/);
  assert.deepEqual(center.getSnapshot().map(row => row.id), ['one']);
});

test('disabled sources remain configurable while their notifications and actions are excluded', async () => {
  const center = notificationCenter();
  const board = feed('Board', 10);
  const conversation = feed('Conversation', 15);
  center.service.registerSource('ipollo.board', board.source);
  center.service.registerSource('dsh.conversations', conversation.source);
  const boardRow = center.getSnapshot().find(row => row.sourceId === 'ipollo.board');
  assert(boardRow);

  center.setPreferences(null);
  assert.equal(center.getSnapshot().length, 0);
  center.setPreferences({ 'ipollo.board': false });
  assert.deepEqual(center.getSources().map(({ label, enabled }) => [label, enabled]), [
    ['Board', false], ['Conversation', true],
  ]);
  assert.deepEqual(center.getSnapshot().map(row => row.sourceId), ['dsh.conversations']);
  await center.act(boardRow, 'markRead');
  assert.deepEqual(board.actions, []);

  center.setPreferences({ 'ipollo.board': true });
  assert.equal(center.getSnapshot().find(row => row.sourceId === 'ipollo.board')?.read, false);
});
