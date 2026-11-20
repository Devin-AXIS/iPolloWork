import test from 'node:test';
import assert from 'node:assert/strict';
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings';
import { createMcpConnections, type McpManagementScope } from '../src/host/mcp-connections.ts';
import { McpPreferences } from '../src/host/mcp-preferences.ts';
import type { CredentialStore } from '../src/shared/types.ts';
import { SuiteError } from '../src/host/errors.ts';

test('connection controls use native path edits and revision fencing, preserving source ownership and secrets', async () => {
  let revision = 5;
  const writes: unknown[] = [], restarts: string[] = [];
  const scope: McpManagementScope = {
    settings: { writable: true, describe: () => [{ ns: 'mcp-manager', revision,
      value: { servers: { mine: { headers: { Authorization: 'private-token' } }, builtIn: {} } },
      base: { servers: { builtIn: {} } }, user: { servers: { mine: {} } },
    } as SettingsDescriptor], mutate: async (...args) => { writes.push(args); revision++; } },
    mcpManager: { list: () => ['mine', 'builtIn', 'plugin'].map(name => ({ name, configured: true, status: { state: 'connected', toolCount: 2 } })),
      restart: async name => { restarts.push(name); } },
  };
  const controls = createMcpConnections(scope, () => undefined);
  const list = await controls.list();
  assert.equal(JSON.stringify(list).includes('private-token'), false);
  assert.deepEqual(list.items.map(item => [item.source, item.canDisconnect, item.canDelete]), [
    ['configuration', true, true], ['configuration', true, false], ['plugin', false, false],
  ]);
  await assert.rejects(controls.action('native-mine', 'delete', 4), { code: 'IPW_MCP_SETTINGS_CONFLICT' });
  await controls.action('native-mine', 'disconnect', 5);
  assert.deepEqual(writes[0], ['mcp-manager', [{ op: 'set', path: ['servers', 'mine', 'enabled'], value: false }], 5]);
  await assert.rejects(controls.action('native-builtIn', 'delete', 6), { code: 'IPW_MCP_SOURCE_MANAGED' });
  await assert.rejects(controls.action('native-plugin', 'disconnect', 6), { code: 'IPW_MCP_SOURCE_MANAGED' });
  await controls.action('native-plugin', 'restart');
  assert.deepEqual(restarts, ['plugin']);
  await controls.action('native-mine', 'delete', 6);
  assert.deepEqual(writes[1], ['mcp-manager', [{ op: 'unset', path: ['servers', 'mine'] }], 6]);
  assert.equal(writes.length, 2);
  const unavailable = Object.assign(async () => { throw new SuiteError('IPW_ACCOUNT_UNAVAILABLE', 502); }, {
    connections: () => [], restart: async () => {}, disconnect: async () => {},
  });
  const partial = await createMcpConnections(scope, () => unavailable).list();
  assert.equal(partial.items.length, 3, 'organization outages must not hide native connection controls');
  assert.equal(partial.organizationError, 'IPW_ACCOUNT_UNAVAILABLE');
});

test('local disconnect choices survive reconstruction and remain separate across accounts and service origins', async () => {
  const records = new Map<string, { kind: string; payload?: unknown }>();
  let fail = false, reads = 0;
  const credentials: CredentialStore = {
    readRecord: async key => records.get(key), deleteRecord: async key => { records.delete(key); },
    modifyRecord: async (key, update) => { const next = await update(records.get(key)); if (fail) throw Error('disk failed'); records.set(key, next); },
  };
  const account = { generation: 0, user: async () => { reads++; return { id: 'a', name: 'A', email: 'a@example.test' }; } };
  const id = '00000000-0000-4000-8000-000000000001';
  const first = new McpPreferences(credentials, account, 'https://one.example.test');
  assert.deepEqual([...await first.disabled()], []);
  assert.equal(reads, 0, 'normal MCP discovery must not add session or balance calls');
  await first.setDisabled(id, true);
  assert.deepEqual([...await new McpPreferences(credentials, account, 'https://one.example.test').disabled()], [id]);
  const other = { generation: 0, user: async () => ({ id: 'b', name: 'B', email: 'b@example.test' }) };
  assert.equal((await new McpPreferences(credentials, other, 'https://one.example.test').disabled()).size, 0);
  assert.equal((await new McpPreferences(credentials, account, 'https://two.example.test').disabled()).size, 0);
  fail = true;
  await assert.rejects(first.setDisabled(id, false), /disk failed/);
  assert.equal((await first.disabled()).has(id), true);
  fail = false;
  await first.setDisabled(id, false);
  assert.equal((await first.disabled()).size, 0);
});

test('retained native cleanup failures stay visible without offering a replacement or delete action', async () => {
  const controls = createMcpConnections({
    settings: { writable: true, describe: () => [], mutate: async () => { throw Error('must not write'); } },
    mcpManager: { list: () => [{ name: 'removed', configured: false, status: { state: 'failed', result: { closeConfirmed: false, cleanupError: 'Closure not confirmed' } } }],
      restart: async () => { throw Error('must not replace'); } },
  }, () => undefined);
  const item = (await controls.list()).items[0];
  assert.equal(item?.source, 'cleanup');
  assert.equal(item?.error, 'Closure not confirmed');
  assert.equal(item?.canReconnect, false);
  await assert.rejects(controls.action('native-removed', 'restart'), { code: 'IPW_MCP_SOURCE_MANAGED' });
  await assert.rejects(controls.action('native-removed', 'delete'), { code: 'IPW_MCP_SOURCE_MANAGED' });
});

test('a saved account grant changing during identity verification cannot persist choices for the wrong account', async () => {
  let grant = { kind: 'grant', payload: { token: 'synthetic-a' } }, writes = 0;
  const credentials: CredentialStore = { readRecord: async key => key.endsWith('/account') ? grant : undefined,
    deleteRecord: async () => {}, modifyRecord: async () => { writes++; } };
  const account = { generation: 0, user: async () => { grant = { kind: 'grant', payload: { token: 'synthetic-b' } }; return { id:'a',name:'A',email:'a@example.test' }; } };
  await assert.rejects(new McpPreferences(credentials, account, 'https://account.test').setDisabled('00000000-0000-4000-8000-000000000001', true), { code:'IPW_ACCOUNT_CHANGED' });
  assert.equal(writes, 0);
});
