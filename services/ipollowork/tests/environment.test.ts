import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('server and operator configuration can use an explicit private dotenv while process variables stay authoritative', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ipw-config-'));
  const file = join(root, 'private-service.env');
  const loader = new URL('../src/environment.ts', import.meta.url).href;
  try {
    await writeFile(file, 'DATABASE_URL=postgresql://file.example.test/accounts\nAPP_DATA_DATABASE_URL=postgresql://file.example.test/apps\nSERVICE_ORIGIN=https://accounts.example.test\n');
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      const {loadEnvironment}=await import(${JSON.stringify(loader)});loadEnvironment();
      assert.equal(process.env.DATABASE_URL,'postgresql://process.example.test/accounts');
      assert.equal(process.env.APP_DATA_DATABASE_URL,'postgresql://file.example.test/apps');
      assert.equal(process.env.SERVICE_ORIGIN,'https://accounts.example.test');console.log('configuration-ok');
    `], { cwd: root, env: { ...process.env, IPOLLO_CONFIG_FILE: file, DATABASE_URL: 'postgresql://process.example.test/accounts', APP_DATA_DATABASE_URL: undefined, SERVICE_ORIGIN: undefined } });
    assert.match(stdout, /configuration-ok/);
    await assert.rejects(promisify(execFile)(process.execPath, ['--input-type=module', '-e', `const {loadEnvironment}=await import(${JSON.stringify(loader)});loadEnvironment();`],
      { cwd: root, env: { ...process.env, IPOLLO_CONFIG_FILE: join(root, 'missing.env') } }), /Cannot read the service configuration file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
