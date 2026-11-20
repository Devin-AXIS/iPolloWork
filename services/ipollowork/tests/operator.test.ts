import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { testConfig } from './database.js';
import { createService } from '../src/app.js';
import { backupTarget, createBackup } from '../src/operator-backup.js';

const exec = promisify(execFile);

test('backup rejects nested destinations, includes both schemas and the effective key, and restores into an empty database', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ipw-operator-'));
  const data = join(root, 'data');
  const config = await testConfig({ DATA_DIR: data, AUTH_SECRET: 'handoff-effective-authentication-secret-123456' });
  const appData = config.appData;
  assert.ok(appData);
  const service = await createService(config);
  const pg = new Pool({ connectionString: config.databaseUrl });
  try {
    await service.auth.api.signUpEmail({ body: { email: 'operator@example.test', name: 'Operator', password: 'Testing-operator-password-2026' } });
    await service.settings.set('oss', { accessKeySecret: 'test-private-setting' });
    await service.store.run('INSERT INTO audit(actor_id,action,target,created_at) VALUES(NULL,?,?,?)', 'handoff.fixture', 'backup', Date.now());
    await mkdir(join(data, 'files'));
    await writeFile(join(data, 'files', 'private.txt'), 'private fixture');
    await writeFile(join(data, 'auth.secret'), 'a-stale-file-must-not-win');
    await service.close();
    await assert.rejects(backupTarget(data, data), /outside DATA_DIR/);
    await assert.rejects(backupTarget(data, join(data, 'nested', 'backup')), /outside DATA_DIR/);
    const target = await createBackup(config, join(root, 'backup'));
    const manifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'));
    assert.equal(manifest.account.schema, config.databaseSchema);
    assert.equal(manifest.appData.schema, config.appData?.databaseSchema);
    assert.equal(manifest.ossIncluded, false);
    assert.equal(await readFile(join(target, 'data', 'auth.secret'), 'utf8'), config.secret);
    assert.equal(await readFile(join(target, 'data', 'files', 'private.txt'), 'utf8'), 'private fixture');
    await assert.rejects(createBackup(config, target), /already exists/);
    await assert.rejects(createBackup({ ...config, databaseUrl: 'postgresql://nobody@127.0.0.1:1/missing' }, join(root, 'failed')), /backup failed/);
    assert(!(await readdir(root)).some(name => name.startsWith('.ipw-backup-') || name === 'failed'));
    // Only remove the two fixture-owned schemas; ordinary test roles need no CREATEDB privilege.
    for (const schema of [config.databaseSchema, appData.databaseSchema]) await pg.query(`DROP SCHEMA ${schema} CASCADE`);
    const url = new URL(config.databaseUrl);
    const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)) };
    for (const file of ['work.dump', 'app-data.dump']) await exec('pg_restore', ['--exit-on-error', '--no-owner', '--no-acl', '--dbname=' + env.PGDATABASE, join(target, file)], { env });
    const restoredService = await createService({ ...config, dataDir: join(target, 'data') });
    try {
      assert.equal((await restoredService.settings.get('oss')).accessKeySecret, 'test-private-setting');
      assert.equal((await restoredService.store.one('SELECT count(*) AS n FROM "user"'))?.n, 1);
      assert.equal((await restoredService.app.request('/api/ready')).status, 200);
      const login = await restoredService.auth.api.signInEmail({ body: { email: 'operator@example.test', password: 'Testing-operator-password-2026' } });
      assert.equal(login.user.email, 'operator@example.test');
    } finally { await restoredService.close(); }
  } finally {
    await service.close();
    await pg.end();
    await rm(root, { recursive: true, force: true });
  }
});

test('operator admin is repeatable and explicit promotion preserves an existing password', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-admin-'));
  const config = await testConfig({ DATA_DIR: dir });
  const env = { ...process.env, DATA_DIR: dir, DATABASE_URL: config.databaseUrl, DATABASE_SCHEMA: config.databaseSchema,
    SERVICE_ORIGIN: config.origin, AUTH_SECRET: config.secret, APP_DATA_DATABASE_URL: '', ADMIN_PASSWORD: 'Testing-operator-password-2026' };
  const run = (...args: string[]) => exec(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/admin.ts', ...args], { env });
  try {
    await run('new-admin@example.test');
    await run('new-admin@example.test');
    const service = await createService(config);
    try {
      const existing = await service.auth.api.signUpEmail({ body: { email: 'existing@example.test', name: 'Existing', password: 'Retained-password-2026' } });
      await assert.rejects(run('existing@example.test'), /Account already exists/);
      await run('existing@example.test', '--promote-existing');
      const session = await service.auth.api.signInEmail({ body: { email: existing.user.email, password: 'Retained-password-2026' } });
      assert.equal(session.user.role, 'admin');
      assert.equal((await service.store.one('SELECT count(*) AS n FROM audit WHERE action=?', 'user.bootstrap-admin'))?.n, 2);
    } finally { await service.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('readiness includes the configured app-data database and request IDs contain no client input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-ready-'));
  const config = await testConfig({ DATA_DIR: dir });
  const service = await createService(config);
  try {
    const healthy = await service.app.request('/api/ready', { headers: { 'X-Request-Id': 'untrusted-client-value' } });
    assert.equal(healthy.status, 200);
    assert.match(healthy.headers.get('X-Request-Id') ?? '', /^[a-f0-9-]{36}$/);
    await service.appData?.close();
    assert.equal((await service.app.request('/api/ready')).status, 503);
    assert.equal((await service.app.request('/api/health')).status, 200);
  } finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
});
