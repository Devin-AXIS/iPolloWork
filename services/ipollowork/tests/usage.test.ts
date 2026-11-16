/** Membership budgets retain calendar semantics, payment honesty and atomic reservations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createService } from '../src/app.js';
import { accountUsage, usagePeriods } from '../src/usage.js';
import { ledgerEntry, wallet } from '../src/domain.js';
import { ExecutionService } from '../src/execution.js';
import { testConfig } from './database.js';

test('usage resets at midnight and Monday in the configured calendar', () => {
  const sunday = usagePeriods(Date.UTC(2026, 10, 15, 15, 59), 480);
  assert.equal(sunday.dayReset, Date.UTC(2026, 10, 15, 16));
  assert.equal(sunday.weekReset, sunday.dayReset);
  const monday = usagePeriods(sunday.dayReset, 480);
  assert.equal(monday.day, sunday.dayReset);
  assert.equal(monday.week, monday.day);
  assert.equal(monday.weekReset, monday.week + 7 * 86400000);
  assert.equal(usagePeriods(Date.UTC(2026, 10, 16, 0), 0).day, Date.UTC(2026, 10, 16, 0));
});

test('daily and weekly caps reject before calling a provider and replay never spends twice', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-usage-'));
  const app = await createService(await testConfig({ DATA_DIR: dir }));
  try {
    const { user } = await app.auth.api.signUpEmail({ body: { email: 'usage@example.test', name: 'Usage', password: 'Membership-test-password' } });
    const actor = { ...user, role: 'admin' };
    const order = randomUUID();
    await app.store.run("INSERT INTO plans VALUES('limits','Limited','','membership',9900,'CNY',0,30,1,NULL,?,NULL,10,12)", Date.now());
    await app.store.run("INSERT INTO orders(id,user_id,plan_id,provider,status,amount,currency,points,days,created_at,paid_at) VALUES(?,?,'limits','stripe','paid',9900,'CNY',0,30,?,?)", order, user.id, Date.now(), Date.now());
    await app.store.run('INSERT INTO entitlements(order_id,user_id,plan_id,starts_at,expires_at) VALUES(?,?,?, ?,?)', order, user.id, 'limits', Date.now()-1000, Date.now()+86400000);
    await app.store.transaction(() => ledgerEntry(app.store, user.id, 100, 'usage-fixture', 'Fixture'));
    let calls = 0;
    const executor = new ExecutionService(app.store, app.settings, async () => { calls++; return Response.json({ ok: true }); });
    await executor.save(actor, { id: 'budget', title: 'Budget', provider: 'fixture', keyId: 'budget', key: 'fixture-key', baseUrl: 'https://example.test', enabled: true, capabilities: ['chat'], routes: [{ method: 'POST', path: '/call', points: 4 }] });
    const request = () => ({ requestId: randomUUID(), method: 'POST', path: '/call', contentType: 'application/json', body: Buffer.from('{}').toString('base64') });
    const first = request();
    await (await executor.invoke(actor, 'budget', first)).text();
    await (await executor.invoke(actor, 'budget', request())).text();
    await assert.rejects(executor.invoke(actor, 'budget', request()), { code: 'DAILY_USAGE_LIMIT_REACHED' });
    assert.equal(calls, 2);
    assert.equal((await accountUsage(app.store, user.id, 480)).daily.used, 8);
    await app.store.run("UPDATE plans SET daily_points=NULL WHERE id='limits'");
    await (await executor.invoke(actor, 'budget', request())).text();
    await assert.rejects(executor.invoke(actor, 'budget', request()), { code: 'WEEKLY_USAGE_LIMIT_REACHED' });
    await (await executor.invoke(actor, 'budget', first)).text();
    assert.equal(calls, 3);
    assert.equal((await wallet(app.store, user.id)).balance, 88);
    assert.equal((await accountUsage(app.store, user.id, 480)).weekly.remaining, 0);
    await app.store.run('UPDATE entitlements SET revoked_at=? WHERE order_id=?', Date.now(), order);
    assert.equal((await accountUsage(app.store, user.id, 480)).daily.limit, null);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

test('running reservations count toward usage, failed calls release it, and duplicate concurrent requests stay bounded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-usage-pending-'));
  const app = await createService(await testConfig({ DATA_DIR: dir }));
  try {
    const { user } = await app.auth.api.signUpEmail({ body: { email: 'pending@example.test', name: 'Pending', password: 'Membership-test-password' } });
    const actor = { ...user, role: 'admin' };
    await app.store.transaction(() => ledgerEntry(app.store, user.id, 100, 'pending-fixture', 'Fixture'));
    let entered!: () => void, secondEntered!: () => void, release!: () => void, count = 0;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const secondReady = new Promise<void>(resolve => { secondEntered = resolve; });
    const response = new Promise<void>(resolve => { release = resolve; });
    const executor = new ExecutionService(app.store, app.settings, async () => { count++; if (count === 1) entered(); else secondEntered(); await response; return Response.json({}, { status: 400 }); });
    await executor.save(actor, { id: 'pending', title: 'Pending', provider: 'fixture', keyId: 'pending', key: 'fixture-key', baseUrl: 'https://example.test', enabled: true, capabilities: ['chat'], routes: [{ method: 'POST', path: '/call', points: 4 }] });
    const input = { requestId: randomUUID(), method: 'POST', path: '/call', contentType: 'application/json', body: Buffer.from('{}').toString('base64') };
    const running = executor.invoke(actor, 'pending', input);
    const outcome = running.then(() => null, error => error);
    let secondOutcome: Promise<unknown> | undefined;
    try {
      await Promise.race([ready, outcome.then(error => { throw error ?? new Error('Request finished before the reservation could be observed'); })]);
      const used = await accountUsage(app.store, user.id, 480);
      assert.equal(used.daily.used, 4);
      assert.equal(used.daily.reserved, 4);
      await assert.rejects(executor.invoke(actor, 'pending', input), { code: 'SERVICE_CALL_RUNNING' });
      secondOutcome = executor.invoke(actor, 'pending', { ...input, requestId: randomUUID() }).then(() => null, error => error);
      await Promise.race([secondReady, secondOutcome.then(error => { throw error ?? new Error('Second request finished before its reservation'); })]);
      assert.equal((await accountUsage(app.store, user.id, 480)).daily.reserved, 8);
      assert.equal((await wallet(app.store, user.id)).balance, 92);
    } finally { release(); await Promise.all([outcome, secondOutcome]); }
    assert(await outcome);
    assert.equal((await accountUsage(app.store, user.id, 480)).daily.used, 0);
    assert.equal((await wallet(app.store, user.id)).balance, 100);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

test('membership API exposes only the signed-in account and refuses unconfigured checkout without an order', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-membership-api-'));
  const config = await testConfig({ DATA_DIR: dir });
  const app = await createService(config);
  try {
    const login = await app.auth.api.signUpEmail({ body: { email: 'membership@example.test', name: 'Member', password: 'Membership-test-password' } });
    const headers = { Authorization: 'Bearer '+login.token, Origin: config.origin, 'Content-Type': 'application/json' };
    await app.store.run('UPDATE "user" SET role=? WHERE id=?', 'admin', login.user.id);
    const base = { name: 'Membership', kind: 'membership', amount: 9900, points: 1000, days: 30, enabled: true, dailyPoints: 100, weeklyPoints: 500 };
    const created = await app.app.request(config.origin+'/api/v1/admin/plans', { method: 'POST', headers, body: JSON.stringify(base) });
    assert.equal(created.status, 201);
    const plan = await created.json() as { id: string };
    const invalid = await app.app.request(config.origin+'/api/v1/admin/plans', { method: 'POST', headers, body: JSON.stringify({ ...base, dailyPoints: 600 }) });
    assert.equal(invalid.status, 400);
    const { dailyPoints: _daily, weeklyPoints: _weekly, ...legacy } = base;
    const edited = await app.app.request(config.origin+'/api/v1/admin/plans/'+plan.id, { method: 'PUT', headers, body: JSON.stringify(legacy) });
    assert.equal(edited.status, 200);
    const dashboard = await app.app.request(config.origin+'/api/v1/me/membership', { headers });
    assert.equal(dashboard.status, 200);
    const data = await dashboard.json() as { plans: { id: string; dailyPoints: number }[]; checkoutAvailable: boolean; memberships: unknown[] };
    assert.equal(data.plans.find(p => p.id === plan.id)?.dailyPoints, 100);
    assert.equal(data.checkoutAvailable, false);
    assert.deepEqual(data.memberships, []);
    assert.equal((await app.app.request(config.origin+'/api/v1/me/membership')).status, 401);
    const checkout = await app.app.request(config.origin+'/api/v1/orders', { method: 'POST', headers, body: JSON.stringify({ planId: plan.id, provider: 'stripe', requestId: randomUUID() }) });
    assert.equal(checkout.status, 503);
    assert.equal((await app.store.one('SELECT COUNT(*) AS total FROM orders'))?.total, 0);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
