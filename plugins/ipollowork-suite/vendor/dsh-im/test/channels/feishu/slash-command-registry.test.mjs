import assert from 'node:assert/strict';
import test from 'node:test';
import { SHARED_COMMAND_CATALOG } from '../../../src/channels/shared/command-catalog.mjs';
import {
  listSlashCommands,
  registerSlashCommands,
  syncSlashCommands,
  SLASH_COMMAND_TENANT_SCOPES,
  SLASH_COMMAND_MANIFEST,
  SLASH_PANEL_CREATE_INTERVAL_MS,
} from '../../../src/channels/feishu/slash-command-registry.mjs';

function fakeHttpInstance(handlers) {
  const requests = [];
  return {
    requests,
    http: {
      async request(options) {
        requests.push(options);
        const { method, url } = options;
        const key = method + ' ' + url.split('/open-apis/')[1];
        const handler = handlers[key];
        if (typeof handler !== 'function') {
          throw new Error(`no fake handler for ${key}`);
        }
        return handler(options);
      },
    },
  };
}

const AUTH_KEY = 'POST auth/v3/tenant_access_token/internal';
const LIST_KEY = 'GET application/v7/app_slash_commands';

test('SLASH_COMMAND_MANIFEST has unique plain command names and bilingual descriptions', () => {
  assert.deepEqual(SLASH_COMMAND_TENANT_SCOPES, [
    'application:app_slash_command:read',
    'application:app_slash_command:write',
  ]);
  assert.ok(Array.isArray(SLASH_COMMAND_MANIFEST));
  assert.ok(SLASH_COMMAND_MANIFEST.length > 0);
  assert.equal(new Set(SLASH_COMMAND_MANIFEST.map((entry) => entry.command)).size, SLASH_COMMAND_MANIFEST.length);
  for (const entry of SLASH_COMMAND_MANIFEST) {
    assert.match(entry.command, /^[a-z][a-z0-9_]*$/);
    assert.ok(entry.default.trim(), `/${entry.command} needs a Chinese description`);
    assert.ok(entry.en_us.trim(), `/${entry.command} needs an English description`);
    assert.doesNotMatch(entry.en_us, /\p{Script=Han}/u);
  }
});

test('Feishu panel covers supported shared primary commands and its repair command', () => {
  const byName = new Map(SLASH_COMMAND_MANIFEST.map((entry) => [entry.command, entry]));
  // Feishu uses the shared history, workspace, model, preset, control and batch handlers.
  for (const entry of SHARED_COMMAND_CATALOG.filter((item) => item.enabled !== false && item.menuVisible !== false)) {
    assert.ok(byName.has(entry.name), `Supported /${entry.name} is missing from the Feishu panel`);
  }
  for (const name of ['permission', 'permissionlist']) assert.ok(byName.has(name));
  for (const name of ['history', 'batch', 'send', 'cancel', 'repair']) {
    assert.match(byName.get(name)?.default ?? '', /仅私聊/);
    assert.match(byName.get(name)?.en_us ?? '', /private chats only/);
  }
});

test('default registration adds missing commands to an old panel and preserves existing items on restart', async () => {
  const originalCommands = [
    'menu', 'new', 'help', 'status', 'compact', 'sessionlist', 'workspacelist',
    'workspaces', 'wsl', 'ws', 'watch', 'unwatch', 'watchlist', 'archived',
  ];
  const initialItems = [...originalCommands, 'external_command'].map((command) => ({
    command, command_id: `existing-${command}`, description: { default_value: `Original ${command}` },
  }));
  const remoteItems = new Map(initialItems.map((entry) => [entry.command, structuredClone(entry)]));
  const { http, requests } = fakeHttpInstance({
    [AUTH_KEY]: () => ({ code: 0, tenant_access_token: 'tenant-token' }),
    [LIST_KEY]: () => ({ code: 0, data: { items: [...remoteItems.values()] } }),
    'POST application/v7/app_slash_commands': ({ data }) => {
      assert.equal(remoteItems.has(data.command), false, `Duplicate creation of /${data.command}`);
      const entry = { ...structuredClone(data), command_id: `created-${data.command}` };
      remoteItems.set(data.command, entry);
      return { code: 0, data: { command_id: entry.command_id } };
    },
  });
  const options = { appId: 'a', appSecret: 's', httpInstance: http };
  const first = await registerSlashCommands(options);
  assert.deepEqual(first.failed, []);
  assert.equal(first.created.length, 30);
  assert.equal(SLASH_COMMAND_MANIFEST.length, 41);
  assert.equal(remoteItems.size, 45);
  assert.deepEqual(SLASH_COMMAND_MANIFEST.slice(0, 12).map((entry) => entry.command), [
    'menu', 'new', 'fork', 'reset', 'help', 'status', 'compact', 'clear', 'sessionlist', 'ws',
    'watch', 'unwatch',
  ]);
  for (const { command } of SLASH_COMMAND_MANIFEST) assert.ok(remoteItems.has(command));
  for (const entry of initialItems) assert.deepEqual(remoteItems.get(entry.command), entry);

  const creationCount = () => requests.filter((request) => request.method === 'POST'
    && request.url.endsWith('/app_slash_commands')).length;
  assert.equal(creationCount(), 30);
  const second = await registerSlashCommands(options);
  assert.deepEqual(second.failed, []);
  assert.deepEqual(second.created, []);
  assert.equal(creationCount(), 30);
  assert.equal(second.existing.length, 45);
  for (const entry of initialItems) assert.deepEqual(remoteItems.get(entry.command), entry);
  assert.ok(requests.every((request) => ['GET', 'POST'].includes(request.method)));
});

test('listSlashCommands returns the registered command items', async () => {
  const { http, requests } = fakeHttpInstance({
    [AUTH_KEY]: () => ({ code: 0, tenant_access_token: 'tenant-token' }),
    [LIST_KEY]: () => ({ code: 0, data: { items: [{ command: 'menu', command_id: '1' }] } }),
  });
  const items = await listSlashCommands({ appId: 'a', appSecret: 's', httpInstance: http });
  assert.deepEqual(items, [{ command: 'menu', command_id: '1' }]);
  assert.equal(requests[1].headers.authorization, 'Bearer tenant-token');
});

test('registerSlashCommands creates missing and skips existing commands', async () => {
  const createdBodies = [];
  const { http, requests } = fakeHttpInstance({
    [AUTH_KEY]: () => ({ code: 0, tenant_access_token: 'tenant-token' }),
    [LIST_KEY]: () => ({ code: 0, data: { items: [{ command: 'menu' }, { command: 'help' }] } }),
    'POST application/v7/app_slash_commands': (options) => {
      createdBodies.push(options.data);
      return { code: 0, data: { command_id: `id-${options.data.command}` } };
    },
  });

  const manifest = [
    { command: 'menu', default: '打开菜单', en_us: 'Open menu' },
    { command: 'status', icon: 'ai-functions_outlined', default: '状态', en_us: 'Status' },
    { command: 'watch', icon: 'flag_outlined', default: '关注', en_us: 'Watch' },
  ];
  const result = await registerSlashCommands({
    appId: 'a', appSecret: 's', httpInstance: http, manifest,
  });

  // menu exists -> skipped; status & watch created
  assert.equal(result.created.length, 2);
  assert.ok(result.created.some((c) => c.command === 'status'));
  assert.ok(result.created.some((c) => c.command === 'watch'));
  assert.ok(result.existing.includes('menu'));
  assert.ok(result.existing.includes('help'));
  assert.equal(result.failed.length, 0);
  assert.equal(createdBodies.length, 2);
  assert.equal(requests.filter((request) => request.url.includes('/tenant_access_token/')).length, 1);
  assert.deepEqual(createdBodies.map((body) => body.description.icon.icon_key), [
    'ai-functions_outlined',
    'flag_outlined',
  ]);
  for (const body of createdBodies) {
    assert.equal(body.command.startsWith('/'), false);
    assert.ok(body.description.default_value);
    assert.ok(body.description.i18n.zh_cn);
    assert.ok(body.description.icon.icon_key);
  }
});

test('registerSlashCommands aborts batch on missing permission', async () => {
  const { http, requests } = fakeHttpInstance({
    [AUTH_KEY]: () => ({ code: 0, tenant_access_token: 'tenant-token' }),
    [LIST_KEY]: () => ({ code: 0, data: { items: [] } }),
    'POST application/v7/app_slash_commands': () => {
      const error = new Error('Request failed with status code 400');
      error.response = {
        data: {
          code: 99991672,
          msg: 'Access denied. One of the following scopes is required: [application:app_slash_command:write]',
        },
      };
      throw error;
    },
  });
  const manifest = [
    { command: 'menu', default: 'x', en_us: 'x' },
    { command: 'status', default: 'x', en_us: 'x' },
  ];
  const result = await registerSlashCommands({
    appId: 'a', appSecret: 's', httpInstance: http, manifest,
  });
  assert.equal(result.created.length, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].error.code, '99991672');
  assert.equal(
    requests.filter((request) => request.url.endsWith('/app_slash_commands')
      && request.method === 'POST').length,
    1,
  );
});

test('registerSlashCommands treats duplicate-create as already-existing', async () => {
  const { http } = fakeHttpInstance({
    [AUTH_KEY]: () => ({ code: 0, tenant_access_token: 'tenant-token' }),
    [LIST_KEY]: () => ({ code: 0, data: { items: [] } }),
    'POST application/v7/app_slash_commands': () => ({ code: 40000000, msg: 'command already exists' }),
  });
  const result = await registerSlashCommands({
    appId: 'a', appSecret: 's', httpInstance: http,
    manifest: [{ command: 'menu', default: 'x', en_us: 'x' }],
  });
  assert.equal(result.created.length, 0);
  assert.equal(result.failed.length, 0);
});

/**
 * Emulates the app's command registry: Feishu assigns the command_id, stamps
 * create_time to the second and returns the list newest-first.
 */
function slashPanelRemote({ items = [], onDelete = null } = {}) {
  const registered = new Map(items.map((item) => [item.command, { ...item }]));
  let sequence = 0;
  const created = [];
  const deleted = [];
  const requests = [];
  const http = {
    async request(options) {
      requests.push(options);
      const key = `${options.method} ${options.url.split('/open-apis/')[1]}`;
      if (key === AUTH_KEY) return { code: 0, tenant_access_token: 'tenant-token' };
      if (key === LIST_KEY) {
        const list = [...registered.values()]
          .sort((a, b) => Number(b.create_time) - Number(a.create_time));
        return { code: 0, data: { items: list.map((item) => ({ ...item })) } };
      }
      if (key === 'POST application/v7/app_slash_commands') {
        sequence += 1;
        const command = options.data.command;
        const entry = { command, command_id: `created-${sequence}`, create_time: String(10_000 + sequence) };
        registered.set(command, entry);
        created.push(command);
        return { code: 0, data: { command_id: entry.command_id } };
      }
      const match = /^DELETE application\/v7\/app_slash_commands\/(.+)$/.exec(key);
      if (match) {
        if (typeof onDelete === 'function') onDelete(match[1]);
        const entry = [...registered.values()].find((item) => item.command_id === match[1]);
        if (!entry) throw new Error(`no fake handler for ${key}`);
        registered.delete(entry.command);
        deleted.push(entry.command);
        return { code: 0, data: {} };
      }
      throw new Error(`no fake handler for ${key}`);
    },
  };
  return { http, registered, created, deleted, requests };
}

function authenticationCalls(requests) {
  return requests.filter((request) => request.url.includes('/tenant_access_token/')).length;
}

function panelOrder(remote) {
  return [...remote.registered.values()]
    .sort((a, b) => Number(b.create_time) - Number(a.create_time))
    .map((item) => item.command);
}

const PANEL_TEST_MANIFEST = Object.freeze([
  { command: 'menu', default: '打开菜单', en_us: 'Open menu' },
  { command: 'status', default: '状态', en_us: 'Status' },
  { command: 'stop', default: '停止', en_us: 'Stop' },
  { command: 'new', default: '新会话', en_us: 'New session' },
]);

test('syncSlashCommands keeps adding missing commands when no panel is configured', async () => {
  const remote = slashPanelRemote({
    items: [
      { command: 'menu', command_id: 'm1', create_time: '5' },
      { command: 'external_command', command_id: 'x1', create_time: '4' },
    ],
  });
  const result = await syncSlashCommands({
    appId: 'a', appSecret: 's', httpInstance: remote.http, manifest: PANEL_TEST_MANIFEST,
  });

  assert.deepEqual(remote.created, ['status', 'stop', 'new']);
  assert.deepEqual(remote.deleted, []);
  assert.deepEqual(result.external, ['external_command']);
  assert.equal(result.changed, true);
  assert.equal(authenticationCalls(remote.requests), 1);
});

test('syncSlashCommands removes the commands a custom panel does not list', async () => {
  const remote = slashPanelRemote({
    items: [
      { command: 'menu', command_id: 'm1', create_time: '3' },
      { command: 'status', command_id: 's1', create_time: '2' },
      { command: 'stop', command_id: 't1', create_time: '1' },
      { command: 'external_command', command_id: 'x1', create_time: '0' },
    ],
  });
  const result = await syncSlashCommands({
    appId: 'a', appSecret: 's', httpInstance: remote.http, manifest: PANEL_TEST_MANIFEST,
    config: { mode: 'custom', order: ['status'] },
  });

  // Everything of ours is recreated so the order is ours to choose; the command
  // registered outside the manifest is left where it is.
  assert.deepEqual(remote.deleted, ['menu', 'status', 'stop']);
  assert.deepEqual(remote.created, ['status']);
  assert.deepEqual(panelOrder(remote), ['status', 'external_command']);
  assert.ok(result.external.includes('external_command'));
  assert.equal(authenticationCalls(remote.requests), 1);
});

test('syncSlashCommands rebuilds a custom panel newest-first with a pause between creates', async () => {
  const remote = slashPanelRemote({
    items: [
      { command: 'new', command_id: 'n1', create_time: '3' },
      { command: 'stop', command_id: 't1', create_time: '2' },
      { command: 'menu', command_id: 'm1', create_time: '1' },
    ],
  });
  const waits = [];
  const result = await syncSlashCommands({
    appId: 'a', appSecret: 's', httpInstance: remote.http, manifest: PANEL_TEST_MANIFEST,
    config: { mode: 'custom', order: ['menu', 'stop', 'new'] },
    wait: async (milliseconds) => { waits.push(milliseconds); },
  });

  // Feishu reports the panel in creation order, so the wanted order is created
  // back to front and each create needs its own second.
  assert.deepEqual(remote.created, ['new', 'stop', 'menu']);
  assert.deepEqual(waits, [SLASH_PANEL_CREATE_INTERVAL_MS, SLASH_PANEL_CREATE_INTERVAL_MS]);
  assert.deepEqual(panelOrder(remote), ['menu', 'stop', 'new']);
  assert.deepEqual(remote.deleted, ['new', 'stop', 'menu']);
  assert.equal(result.changed, true);
});

test('syncSlashCommands stops a superseded run before it deletes or creates again', async () => {
  // 运行时在保存新配置时会 abort 上一轮的 signal。被取代的那一轮必须停在下一个
  // 检查点：否则它会按旧计划继续删/建，把面板留在旧配置上（review 反馈）。
  const remote = slashPanelRemote({
    items: [
      { command: 'new', command_id: 'n1', create_time: '3' },
      { command: 'stop', command_id: 't1', create_time: '2' },
      { command: 'menu', command_id: 'm1', create_time: '1' },
    ],
  });
  const controller = new AbortController();
  let requestsAtAbort = 0;
  const result = await syncSlashCommands({
    appId: 'a', appSecret: 's', httpInstance: remote.http, manifest: PANEL_TEST_MANIFEST,
    config: { mode: 'custom', order: ['menu', 'stop', 'new'] },
    signal: controller.signal,
    wait: async () => {
      // 第一轮正按“逆序重建”的节奏创建时，用户保存了新的面板配置。
      requestsAtAbort = remote.requests.length;
      controller.abort();
    },
  });

  assert.equal(result.superseded, true);
  assert.deepEqual(remote.created, ['new'], '被取代后不得再创建下一个指令');
  assert.deepEqual(remote.deleted, ['new', 'stop', 'menu']);
  assert.equal(remote.requests.length, requestsAtAbort, '被取代后不得再发出任何请求');
});

test('syncSlashCommands touches nothing when the run is already superseded', async () => {
  const remote = slashPanelRemote({
    items: [{ command: 'menu', command_id: 'm1', create_time: '1' }],
  });
  const controller = new AbortController();
  controller.abort();
  const result = await syncSlashCommands({
    appId: 'a', appSecret: 's', httpInstance: remote.http, manifest: PANEL_TEST_MANIFEST,
    config: { mode: 'custom', order: ['new'] },
    signal: controller.signal,
  });

  assert.equal(result.superseded, true);
  assert.deepEqual(remote.deleted, []);
  assert.deepEqual(remote.created, []);
});

test('syncSlashCommands leaves a panel that already matches the configuration', async () => {
  const remote = slashPanelRemote({
    items: [
      { command: 'new', command_id: 'n1', create_time: '3' },
      { command: 'stop', command_id: 't1', create_time: '2' },
      { command: 'menu', command_id: 'm1', create_time: '1' },
    ],
  });
  const waits = [];
  const result = await syncSlashCommands({
    appId: 'a', appSecret: 's', httpInstance: remote.http, manifest: PANEL_TEST_MANIFEST,
    config: { mode: 'custom', order: ['new', 'stop', 'menu'] },
    wait: async (milliseconds) => { waits.push(milliseconds); },
  });

  // Restarting a bot must never rebuild a panel that is already correct.
  assert.deepEqual(remote.created, []);
  assert.deepEqual(remote.deleted, []);
  assert.deepEqual(waits, []);
  assert.equal(result.changed, false);
  assert.deepEqual(result.existing, ['new', 'stop', 'menu']);
});

test('syncSlashCommands stops before recreating when a delete fails', async () => {
  const remote = slashPanelRemote({
    items: [
      { command: 'menu', command_id: 'm1', create_time: '2' },
      { command: 'status', command_id: 's1', create_time: '1' },
    ],
    onDelete: (commandId) => {
      if (commandId !== 's1') return;
      const error = new Error('Access denied');
      error.response = { data: { code: 99991672, msg: 'Access denied' } };
      throw error;
    },
  });
  const result = await syncSlashCommands({
    appId: 'a', appSecret: 's', httpInstance: remote.http, manifest: PANEL_TEST_MANIFEST,
    config: { mode: 'custom', order: ['stop'] },
  });

  // A half-emptied panel is recoverable; a duplicate create is not. The next
  // sync converges instead.
  assert.deepEqual(remote.created, []);
  assert.equal(result.created.length, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].command, 'status');
  assert.deepEqual(remote.deleted, ['menu']);
  assert.ok(remote.registered.has('status'), 'the command that failed to delete is still registered');
});

test('syncSlashCommands reports a registered command without an id instead of deleting it', async () => {
  const remote = slashPanelRemote({
    items: [{ command: 'menu', create_time: '1' }],
  });
  const result = await syncSlashCommands({
    appId: 'a', appSecret: 's', httpInstance: remote.http, manifest: PANEL_TEST_MANIFEST,
    config: { mode: 'custom', order: ['stop'] },
  });

  assert.deepEqual(remote.deleted, []);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /command_id/);
  assert.deepEqual(remote.created, []);
});
