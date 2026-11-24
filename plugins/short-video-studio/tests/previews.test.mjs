import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreviews } from '../business/src/previews.mjs';

test('serializes and reuses a preview, then revokes it on release', async () => {
  let reads = 0;
  const evicted = [];
  const previews = createPreviews(async () => {
    reads++;
    return { data: 'YQ==', size: 1, nextOffset: 1, mime: 'image/png' };
  }, id => evicted.push(id));
  const [first, second] = await Promise.all([previews.load('p', 'image', true), previews.load('p', 'image')]);
  assert.ok(first);
  assert.equal(first, second);
  assert.equal(reads, 1);
  assert.equal((await fetch(first)).ok, true);
  previews.clear();
  assert.deepEqual(evicted, ['image']);
  await assert.rejects(fetch(first));
});

test('stops after the first chunk for a large automatic preview', async () => {
  let reads = 0;
  const previews = createPreviews(async () => {
    reads++;
    return { data: 'YQ==', size: 9 * 1024 * 1024, nextOffset: 1, mime: 'image/png' };
  }, () => {});
  assert.equal(await previews.load('p', 'huge-image', true), undefined);
  assert.equal(await previews.load('p', 'huge-image', true), undefined);
  assert.equal(reads, 1);
});

test('evicts by bytes even when far below the count limit', async () => {
  const size = 8 * 1024 * 1024;
  const chunk = Buffer.alloc(1024 * 1024).toString('base64');
  const evicted = [];
  const previews = createPreviews(async ({ offset }) => ({
    data: chunk, size, nextOffset: offset + 1024 * 1024, mime: 'image/png',
  }), id => evicted.push(id));
  try {
    for (let i = 0; i < 7; i++) assert.ok(await previews.load('p', String(i), true));
    assert.deepEqual(evicted, ['0']);
    assert.ok(previews.get('6'));
  } finally { previews.clear(); }
});

test('cancels an old read and skips its queue when the view changes', async () => {
  const started = Promise.withResolvers();
  const calls = [];
  const previews = createPreviews(({ projectId, assetId }, signal) => {
    calls.push(assetId);
    if (projectId === 'new') return Promise.resolve({ data: 'YQ==', size: 1, nextOffset: 1, mime: 'image/png' });
    started.resolve();
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, () => {});
  const previous = previews.load('old', 'viewed');
  const queued = previews.load('old', 'queued');
  await started.promise;
  previews.clear();
  assert.equal(await previous, undefined);
  assert.equal(await queued, undefined);
  assert.ok(await previews.load('new', 'current'));
  assert.deepEqual(calls, ['viewed', 'current']);
  previews.clear();
});
