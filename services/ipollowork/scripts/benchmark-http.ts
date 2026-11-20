/** Synthetic HTTP trial. Requires a dedicated test database; never targets a running deployment. */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { createService } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ExecutionService } from '../src/execution.js';
import { ledgerEntry } from '../src/domain.js';
import { startHttpService } from '../src/http-server.js';

const count = Number(process.env.BENCH_USERS ?? 120);
assert(Number.isInteger(count) && count >= 1 && count <= 140, 'Use 1–140 synthetic users');
const password = 'Synthetic-capacity-password-2026!';
if (process.argv.includes('--server')) {
  const config = loadConfig(); config.port = 0;
  const service = await createService(config);
  for (let i = 0; i < count; i++) {
    const user = await service.auth.api.signUpEmail({ body: { name: 'Capacity ' + i, email: `capacity-${i}@example.test`, password } });
    await service.store.transaction(() => ledgerEntry(service.store, user.user.id, 100, 'capacity-seed/' + i, 'Synthetic load test'));
    if (i === 0) {
      await service.store.run('UPDATE "user" SET role=\'admin\' WHERE id=?', user.user.id);
      await new ExecutionService(service.store, service.settings).save({ ...user.user, role: 'admin' }, {
        id: 'capacity-model', title: 'Synthetic capacity model', provider: 'fixture', keyId: 'fixture', key: 'synthetic-key',
        baseUrl: process.env.CAPACITY_UPSTREAM!, capabilities: ['chat'], enabled: true,
        routes: [{ method: 'POST', path: '/chat/completions', points: 1 }], timeoutMs: 10000,
      });
    }
  }
  const http = startHttpService(config, service);
  await once(http.server, 'listening');
  const address = http.server.address(); assert(address && typeof address !== 'string');
  let peakRss = process.memoryUsage().rss, peakQueued = 0;
  const sample = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    peakQueued = Math.max(peakQueued, Number(service.admission.snapshot().execution.queued));
  }, 25);
  process.on('message', message => {
    if (message === 'metrics') process.send?.({ type: 'metrics', peakRssMiB: Math.round(peakRss / 1048576), peakExecutionQueued: peakQueued, admission: service.admission.snapshot() });
    if (message === 'stop') {
      clearInterval(sample);
      void http.stop().then(() => process.exit(0), () => process.exit(1));
    }
  });
  process.send?.({ type: 'ready', origin: 'http://127.0.0.1:' + address.port });
} else {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  assert(databaseUrl, 'Set TEST_DATABASE_URL to a dedicated test database');
  const schema = 'capacity_' + randomUUID().replaceAll('-', '');
  const data = await mkdtemp(join(tmpdir(), 'ipw-capacity-'));
  const database = new Pool({ connectionString: databaseUrl });
  let upstreamCalls = 0, upstreamActive = 0, upstreamPeak = 0;
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) { /* Drain the synthetic request. */ }
    upstreamCalls++; upstreamActive++; upstreamPeak = Math.max(upstreamPeak, upstreamActive);
    res.on('close', () => { upstreamActive--; });
    res.writeHead(200, { 'content-type': 'application/json' });
    await delay(350);
    res.end(JSON.stringify({ choices: [{ message: { content: 'capacity-fixture' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const upstreamAddress = upstream.address(); assert(upstreamAddress && typeof upstreamAddress !== 'string');
  await database.query(`CREATE SCHEMA ${schema}`);
  const child = fork(fileURLToPath(import.meta.url), ['--server'], { execArgv: ['--max-old-space-size=768', '--import', 'tsx'],
    env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema, DATABASE_POOL_SIZE: '8', APP_DATA_DATABASE_URL: '',
      SERVICE_ORIGIN: 'http://127.0.0.1:4785', DATA_DIR: data, AUTH_SECRET: 'synthetic-capacity-secret-at-least-thirty-two-characters',
      CAPACITY_UPSTREAM: 'http://127.0.0.1:' + upstreamAddress.port, BENCH_USERS: String(count) },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const message = (type: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(Error('Capacity child timed out: ' + type)); }, 180000);
    const receive = (value: unknown) => { if (value && typeof value === 'object' && Reflect.get(value, 'type') === type) { cleanup(); resolve(value as Record<string, unknown>); } };
    const exited = () => { cleanup(); reject(Error('Capacity child exited before ' + type)); };
    const cleanup = () => { clearTimeout(timeout); child.off('message', receive); child.off('exit', exited); };
    child.on('message', receive); child.on('exit', exited);
  });
  try {
    const ready = await message('ready'), origin = String(ready.origin);
    const metrics: Record<string, unknown> = { users: count, environment: platform(), nodeHeapLimitMiB: 768, databasePool: 8, mockUpstreamDelayMs: 350 };
    const measure = async <T>(name: string, work: () => Promise<T>) => { const start = performance.now(); const result = await work(); metrics[name + 'Ms'] = Math.round(performance.now() - start); return result; };
    const tokens = await measure('concurrentLogin', () => Promise.all(Array.from({ length: count }, async (_, i) => {
      const response = await fetch(origin + '/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `capacity-${i}@example.test`, password }) });
      assert.equal(response.status, 200, 'Shared-IP login must succeed');
      const value = await response.json() as { token: string }; assert(value.token); return value.token;
    })));
    await measure('concurrentBrowsing', () => Promise.all(tokens.map(async token => {
      for (const path of ['me/summary', 'services', 'me/organization-templates']) {
        const response = await fetch(origin + '/api/v1/' + path, { headers: { authorization: 'Bearer ' + token } });
        assert.equal(response.status, 200, path); await response.arrayBuffer();
      }
    })));
    const requestIds = tokens.map(() => randomUUID());
    const invoke = async (index: number) => {
      const response = await fetch(origin + '/api/v1/services/capacity-model/invoke', { method: 'POST',
        headers: { authorization: 'Bearer ' + tokens[index], 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: requestIds[index], method: 'POST', path: '/chat/completions', contentType: 'application/json', body: Buffer.from('{"model":"fixture","messages":[]}').toString('base64') }) });
      assert.equal(response.status, 200, await response.clone().text()); await response.arrayBuffer();
    };
    const healthLatencies: number[] = [];
    let running = true;
    const probe = (async () => { while (running) { const start = performance.now(); const r = await fetch(origin + '/api/health'); assert.equal(r.status, 200); await r.arrayBuffer(); healthLatencies.push(performance.now() - start); await delay(40); } })();
    try { await measure('concurrentModels', () => Promise.all(tokens.map((_, i) => invoke(i)))); }
    finally { running = false; await probe; }
    await invoke(0);
    assert.equal(upstreamCalls, count, 'An identical retry must replay rather than invoke and bill again');
    assert(upstreamPeak <= 8);
    const balances = await database.query(`SELECT balance FROM ${schema}.wallets`);
    assert.equal(balances.rowCount, count); assert(balances.rows.every(row => Number(row.balance) === 99));
    const calls = await database.query(`SELECT state,count(*)::int AS count FROM ${schema}.service_calls GROUP BY state`);
    assert.deepEqual(calls.rows, [{ state: 'succeeded', count }]);
    const result = message('metrics'); child.send('metrics'); Object.assign(metrics, await result);
    healthLatencies.sort((a, b) => a - b);
    Object.assign(metrics, { upstreamCalls, upstreamPeak, healthP95Ms: Math.round(healthLatencies[Math.floor(healthLatencies.length * 0.95)] ?? 0), duplicateBilling: false, calls: calls.rows, passed: true });
    console.log(JSON.stringify(metrics, null, 2));
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.send('stop'); const guard = setTimeout(() => child.kill('SIGKILL'), 10000); await exited; clearTimeout(guard); }
    upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve()));
    await database.query(`DROP SCHEMA ${schema} CASCADE`); await database.end(); await rm(data, { recursive: true, force: true });
  }
}
