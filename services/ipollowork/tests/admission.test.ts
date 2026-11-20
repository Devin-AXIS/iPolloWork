import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Hono } from 'hono';
import { Admission, AdmissionQueue, requestLane, type AdmissionConfig } from '../src/admission.js';
import { AuthAttempts } from '../src/auth-attempts.js';
import { ServiceError } from '../src/errors.js';
import type { App } from '../src/http.js';

test('FIFO queues bound concurrency, reject overload, cancel waiters and drain without leaking leases', async () => {
  const queue = new AdmissionQueue({ concurrency: 1, queue: 2, waitMs: 1000 });
  const first = await queue.acquire();
  const cancelled = new AbortController();
  const second = queue.acquire(cancelled.signal);
  const secondRejected = assert.rejects(second, { code: 'REQUEST_CANCELLED' });
  const third = queue.acquire();
  await assert.rejects(queue.acquire(), { code: 'SERVICE_BUSY' });
  cancelled.abort(); await secondRejected;
  first(); first();
  const last = await third;
  assert.equal(queue.snapshot().active, 1);
  const stopped = assert.rejects(queue.acquire(), { code: 'SERVICE_DRAINING' });
  queue.close(); await stopped; last();
  assert.equal(queue.snapshot().active, 0);
  assert.equal(queue.snapshot().queued, 0);
  await assert.rejects(queue.acquire(), { code: 'SERVICE_DRAINING' });
});

test('queue deadlines remove abandoned work before it can run', async () => {
  const queue = new AdmissionQueue({ concurrency: 1, queue: 1, waitMs: 10 });
  const release = await queue.acquire();
  await Promise.all([assert.rejects(queue.acquire(), { code: 'SERVICE_QUEUE_TIMEOUT' }), delay(25)]);
  release();
  assert.equal(queue.snapshot().admitted, 1);
  assert.equal(queue.snapshot().queued, 0);
});

test('SSE holds its work lease until cancellation while control APIs stay responsive', async () => {
  const lane = { concurrency: 1, queue: 1, waitMs: 1000 };
  const capacity = new Admission(Object.fromEntries(['api', 'auth', 'execution', 'transfer', 'mcp'].map(key => [key, lane])) as AdmissionConfig);
  const app: App = new Hono();
  capacity.mount(app);
  app.onError((error, c) => c.json({ code: error instanceof ServiceError ? error.code : 'INTERNAL' }, 503));
  let started = 0, cancelled = 0;
  app.post('/api/v1/services/test/invoke', () => {
    started++;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { cancelled++; } }), { headers: { 'content-type': 'text/event-stream' } });
  });
  app.get('/api/v1/me/summary', c => c.json({ ok: true }));
  const first = await app.request('/api/v1/services/test/invoke', { method: 'POST' });
  const second = app.request('/api/v1/services/test/invoke', { method: 'POST' });
  await delay(5);
  assert.equal(started, 1);
  assert.equal((await app.request('/api/v1/me/summary')).status, 200);
  await first.body!.cancel();
  const next = await second;
  assert.equal(started, 2);
  await next.body!.cancel();
  assert.equal(cancelled, 2);
  assert.equal(capacity.snapshot().execution.active, 0);
  capacity.close();
});

test('shared-office authentication retains per-account throttling and bounded memory', () => {
  const attempts = new AuthAttempts(2);
  for (let i = 0; i < 8; i++) assert.equal(attempts.consume(' User@Example.test ', 100), 0);
  assert.equal(attempts.consume('user@example.test', 101), 60);
  assert.equal(attempts.consume('other@example.test', 101), 0);
  assert.equal(attempts.consume('third@example.test', 102), 60);
  assert.equal(attempts.consume('third@example.test', 60101), 0);
});

test('models, MCP long connections, uploads and authentication have separate budgets', () => {
  const headers = new Headers();
  assert.equal(requestLane('/api/v1/services/official/invoke', 'POST', headers), 'execution');
  assert.equal(requestLane('/api/v1/capabilities/video/invoke', 'POST', headers), 'execution');
  assert.equal(requestLane('/api/v1/me/enterprise-mcp/id/connect', 'GET', headers), 'mcp');
  assert.equal(requestLane('/api/v1/me/summary', 'GET', headers), 'api');
  assert.equal(requestLane('/api/auth/sign-in/email', 'POST', headers), 'auth');
  assert.equal(requestLane('/api/v1/projects/id/artifacts/upload', 'POST', headers), 'transfer');
  assert.equal(requestLane('/api/v1/anything', 'POST', new Headers({ 'content-length': '2000000' })), 'transfer');
});
