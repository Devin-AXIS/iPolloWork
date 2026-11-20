import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../web/api.js';

test('web API handles proxy HTML, empty success, network failure and cancellation without replaying writes', async t => {
  let calls = 0;
  const mock = t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('<html>bad gateway</html>', { status: 502 }); });
  await assert.rejects(api('/api/test', { mutation: true }), /HTTP 502/);
  assert.equal(calls, 1);
  mock.mock.mockImplementation(async () => new Response(null, { status: 204 }));
  assert.equal(await api('/api/test'), undefined);
  mock.mock.mockImplementation(async () => Response.json({ error: { message: 'explicit failure' } }, { status: 400 }));
  await assert.rejects(api('/api/test'), /explicit failure/);
  mock.mock.mockImplementation(async () => { throw new TypeError('private network detail'); });
  await assert.rejects(api('/api/test'), /无法连接服务/);
  const controller = new AbortController(); controller.abort();
  mock.mock.mockImplementation(async (_input: unknown, init?: RequestInit) => { init?.signal?.throwIfAborted(); return Response.json({}); });
  await assert.rejects(api('/api/test', undefined, 'GET', controller.signal), { name: 'AbortError' });
});
