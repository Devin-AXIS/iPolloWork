import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMenuIntroductionSupport, menuIntroductionText } from '../vendor/dsh-im/src/channels/shared/menu-introduction.mjs';
import { wecomAppMenu, wecomAppMenuCommand, syncWecomAppMenu } from '../vendor/dsh-im/src/channels/wecom-app/menu.mjs';
import { WecomAppApi } from '../vendor/dsh-im/src/channels/wecom-app/wecom-app-api.mjs';
import { WecomAppRuntime } from '../vendor/dsh-im/src/channels/wecom-app/wecom-app-runtime.mjs';
import { WecomAppBridge } from '../vendor/dsh-im/src/channels/wecom-app/wecom-app-bridge.mjs';
import { WecomHarnessBridge } from '../vendor/dsh-im/src/channels/wecom/wecom-bridge.mjs';
import { wecomIntroductionMenu } from '../vendor/dsh-im/src/channels/wecom/wecom-cards.mjs';
import { DingtalkHarnessBridge } from '../vendor/dsh-im/src/channels/dingtalk/dingtalk-bridge.mjs';
import { WeixinHarnessBridge } from '../vendor/dsh-im/src/channels/weixin/weixin-bridge.mjs';
import { QqHarnessBridge } from '../vendor/dsh-im/src/channels/qq/qq-bridge.mjs';
import { FeishuHarnessBridge } from '../vendor/dsh-im/src/channels/feishu/bridge.mjs';
import { WecomAppStateStore } from '../vendor/dsh-im/src/channels/wecom-app/state-store.mjs';
import { WecomStateStore } from '../vendor/dsh-im/src/channels/wecom/state-store.mjs';
import { DingtalkStateStore } from '../vendor/dsh-im/src/channels/dingtalk/state-store.mjs';
import { WeixinStateStore } from '../vendor/dsh-im/src/channels/weixin/state-store.mjs';
import { QqStateStore } from '../vendor/dsh-im/src/channels/qq/state-store.mjs';
import { StateStore as FeishuStateStore } from '../vendor/dsh-im/src/channels/feishu/state-store.mjs';
import { ConversationStateStore } from '../vendor/dsh-im/src/channels/shared/conversation-state-store.mjs';
import { setImHostLanguage } from '../vendor/dsh-im/src/channels/shared/i18n.mjs';

const logger = { warn() {}, error() {}, info() {} };
setImHostLanguage('zh');
async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'ipollo-menu-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function access(canExecuteCommands) {
  return { isPrivileged: () => false, getSettings: () => ({
    direct: { mode: 'allowlist', allowlist: { users: [{ id: 'owner', canExecuteCommands }] }, open: { defaultCanExecuteCommands: false, commandPermissionOverrides: [] } },
    group: { mode: 'allowlist', allowlist: { users: [] }, open: { defaultCanExecuteCommands: false, commandPermissionOverrides: [] } },
  }) };
}
const harness = () => ({
  ensureRunning: async () => true,
  currentWorkspace: () => '/workspace',
  listWorkspacePaths: async () => ({ paths: ['/workspace'], current: '/workspace' }),
  listWorkspaceSessions: async () => ({ sessions: [] }),
  listModels: async () => ({ groups: [] }),
  agentPresetSettings: async () => ({ agentPresetCatalog: { items: [] } }),
});

test('menu attempts persist per chat across every channel store and reconnect', async t => {
  const root = await workspace(t);
  for (const [name, Store] of Object.entries({ app: WecomAppStateStore, wecom: WecomStateStore, dingtalk: DingtalkStateStore, weixin: WeixinStateStore, qq: QqStateStore, feishu: FeishuStateStore, shared: ConversationStateStore })) {
    const path = join(root, name + '.json');
    const state = await new Store(path).load();
    let sent = 0;
    await Promise.all([state.introduceMenu('chat-a', async () => { sent++; }), state.introduceMenu('chat-a', async () => { sent++; })]);
    assert.equal(sent, 1, name);
    const restored = await new Store(path).load();
    assert.equal(restored.needsMenuIntroduction('chat-a'), false, name);
    assert.equal(restored.needsMenuIntroduction('chat-b'), true, name);
    await restored.introduceMenu('chat-a', async () => assert.fail('a reconnect must not repeat the guide'));
  }
});

test('failed or uncertain delivery is not retried and persistence failure sends nothing', async () => {
  const value = {};
  const warnings = [];
  const support = createMenuIntroductionSupport({ state: () => value, persist: async () => {} });
  await support.introduceMenu('chat', async () => { throw new Error('secret-token'); }, { logger: { warn: text => warnings.push(text) } });
  assert.equal(support.needsMenuIntroduction('chat'), false);
  assert.ok(!warnings.join().includes('secret-token'));
  const broken = createMenuIntroductionSupport({ state: () => ({}), persist: async () => { throw new Error('disk full'); } });
  await broken.introduceMenu('chat', async () => assert.fail('must persist before sending'), { logger });
});

test('native menu creation is idempotent, preserves external menus and rejects invalid responses', async () => {
  let written;
  assert.equal(await syncWecomAppMenu({ getMenu: async () => ({ menu: { button: [] } }), setMenu: async menu => { written = menu; } }), 'registered');
  assert.deepEqual(written, wecomAppMenu());
  assert.equal(await syncWecomAppMenu({ getMenu: async () => ({ menu: written }), setMenu: async () => assert.fail('same menu') }), 'registered');
  assert.equal(await syncWecomAppMenu({ getMenu: async () => ({ menu: { button: [{ type: 'view', name: 'Existing', url: 'https://example.com' }] } }), setMenu: async () => assert.fail('administrator menu') }), 'preserved');
  await assert.rejects(syncWecomAppMenu({ getMenu: async () => ({ errcode: 0 }), setMenu: async () => assert.fail('invalid menu') }), /invalid menu/);
  assert.equal(wecomAppMenuCommand('ipollo_im_v1___proto__'), null);
  assert.equal(wecomAppMenuCommand('/delete-all'), null);
});

test('native menu API calls use the configured application and include an authenticated POST', async () => {
  const calls = [];
  const api = new WecomAppApi({ corpId: 'corp', corpSecret: 'fixture-secret', agentId: '123',
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return new Response(JSON.stringify(String(url).includes('gettoken') ? { access_token: 'test-token', expires_in: 7200 } : String(url).includes('menu/get') ? { menu: { button: [] } } : { errcode: 0 }), { status: 200 });
    },
  });
  await syncWecomAppMenu(api);
  const sent = calls.find(call => call.url.pathname === '/cgi-bin/menu/create');
  assert.equal(sent.options.method, 'POST');
  assert.equal(sent.url.searchParams.get('agentid'), '123');
  assert.equal(sent.url.searchParams.get('access_token'), 'test-token');
  assert.deepEqual(JSON.parse(sent.options.body), wecomAppMenu());
});

test('native application startup registers menus and button events execute existing commands once', async t => {
  const root = await workspace(t);
  const state = await new WecomAppStateStore(join(root, 'state.json')).load();
  const sent = [];
  let registered;
  let route;
  t.mock.method(WecomAppApi.prototype, 'getMenu', async () => ({ menu: { button: [] } }));
  t.mock.method(WecomAppApi.prototype, 'setMenu', async menu => { registered = menu; });
  t.mock.method(WecomAppApi.prototype, 'sendText', async request => { sent.push(request.content); });
  const runtime = new WecomAppRuntime({ config: { botId: 'app', corpId: 'corp', agentId: '123', callbackSecret: 'callback' }, secrets: { corpSecret: 'test', token: 'test', encodingAESKey: 'test' },
    harness: harness(), state, logger, accessPolicy: access(true),
    callbackServer: { registerRoute: async value => { route = value; }, unregisterRoute() {} },
  });
  t.after(() => runtime.stop());
  assert.equal((await runtime.start()).menuRegistration, 'registered');
  assert.deepEqual(registered, wecomAppMenu());
  await route.onInbound({ kind: 'event', message: { event: 'enter_chat', from: { userid: 'owner' } } });
  assert.equal(sent.length, 0, 'native menus need no duplicate chat guide');
  const message = { event: 'click', createTime: 123, eventKey: 'ipollo_im_v1_status', from: { userid: 'owner' } };
  await route.onInbound({ kind: 'event', message });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /连接正常/);
  await route.onInbound({ kind: 'event', message });
  await route.onInbound({ kind: 'event', message: { ...message, eventKey: 'arbitrary-command' } });
  assert.equal(sent.length, 1);
});

test('application fallback introduces once and denied users receive no menu contents', async t => {
  const root = await workspace(t);
  const state = await new WecomAppStateStore(join(root, 'app.json')).load();
  const sent = [];
  const bridge = new WecomAppBridge({ api: { sendText: async ({ content }) => sent.push(content) }, state, harness: harness(), status: {}, logger, accessPolicy: access(true) });
  const event = { event: 'enter_chat', from: { userid: 'owner' } };
  await bridge.acceptEvent(event); await bridge.acceptEvent(event);
  assert.deepEqual(sent, [menuIntroductionText()]);
  const deniedState = await new WecomAppStateStore(join(root, 'denied.json')).load();
  const denied = new WecomAppBridge({ api: { sendText: async ({ content }) => sent.push(content) }, state: deniedState, harness: harness(), status: {}, logger, accessPolicy: access(false) });
  await denied.acceptEvent(event);
  assert.equal(sent.length, 1);
  assert.equal(deniedState.needsMenuIntroduction('p2p:owner'), true);
});

test('DingTalk shows its existing interactive card once and still handles the first message', async t => {
  const root = await workspace(t);
  const state = await new DingtalkStateStore(join(root, 'ding.json')).load();
  const sent = [];
  let cards = 0;
  const bridge = new DingtalkHarnessBridge({ api: { createMenuCard: async () => { cards++; return { cardInstanceId: 'card' }; }, sendText: async request => { sent.push(request); return {}; } }, clientId: 'client', clientSecret: 'secret', state, harness: harness(), logger, accessPolicy: access(true) });
  const message = { msgId: 'first', msgtype: 'text', text: { content: '/status' }, conversationType: '1', senderStaffId: 'owner', sessionWebhook: 'https://oapi.dingtalk.com/robot/reply?ticket=fixture' };
  await bridge.accept(message);
  await bridge.accept({ ...message, msgId: 'second' });
  assert.equal(cards, 1);
  assert.equal(sent.length, 2);
});

test('WeCom enter-chat callbacks show actionable cards once', async t => {
  const root = await workspace(t);
  const state = await new WecomStateStore(join(root, 'wecom.json')).load();
  const sent = [];
  const bridge = new WecomHarnessBridge({ client: { replyStream: async () => {}, sendMessage: async (chat, message) => { sent.push(message); return {}; }, replyWelcome: async (_frame, message) => { sent.push(message); return {}; } }, harness: harness(), state, logger, accessPolicy: access(true) });
  const frame = { body: { msgid: 'entry', from: { userid: 'owner' }, event: { eventtype: 'enter_chat' } } };
  await bridge.acceptEvent(frame); await bridge.acceptEvent({ body: { ...frame.body, msgid: 'entry-two' } });
  assert.equal(sent.length, 1, 'one compact action card');
  assert.ok(sent.every(message => message.msgtype === 'template_card'));
});

test('a definite WeCom card rejection falls back to a text guide without replaying on entry', async t => {
  const root = await workspace(t);
  const state = await new WecomStateStore(join(root, 'fallback.json')).load();
  const sent = [];
  const client = { replyStream: async () => {}, sendMessage: async () => {}, replyWelcome: async (_frame, body) => {
    sent.push(body);
    if (body.msgtype === 'template_card') throw Object.assign(new Error('invalid card'), { errcode: 40058 });
  } };
  const bridge = new WecomHarnessBridge({ client, state, harness: harness(), accessPolicy: access(true), logger });
  const frame = { body: { msgid: 'entry', from: { userid: 'owner' }, event: { eventtype: 'enter_chat' } } };
  await bridge.acceptEvent(frame);
  await bridge.acceptEvent({ body: { ...frame.body, msgid: 'entry-again' } });
  assert.deepEqual(sent.map(message => message.msgtype), ['template_card', 'text']);
});

test('a definite DingTalk card rejection falls back to a guide while preserving the first request', async t => {
  const root = await workspace(t);
  const state = await new DingtalkStateStore(join(root, 'fallback-ding.json')).load();
  const sent = [];
  const bridge = new DingtalkHarnessBridge({ api: { createMenuCard: async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); }, sendText: async request => { sent.push(request); return {}; } }, clientId: 'client', clientSecret: 'secret', state, harness: harness(), logger, accessPolicy: access(true) });
  await bridge.accept({ msgId: 'first', msgtype: 'text', text: { content: '/status' }, conversationType: '1', senderStaffId: 'owner', sessionWebhook: 'https://oapi.dingtalk.com/robot/reply?ticket=fixture' });
  assert.equal(sent.length, 2);
  assert.ok(JSON.stringify(sent[0]).includes('/new'));
});

test('WeChat first message gets a text guide and its normal answer without a second guide', async t => {
  const root = await workspace(t);
  const state = await new WeixinStateStore(join(root, 'wechat.json')).load();
  const sent = [];
  const bridge = new WeixinHarnessBridge({ api: { sendText: async request => { sent.push(request); return {}; } }, baseUrl: 'https://ilinkai.weixin.qq.com/', token: 'fixture', ownerUserId: 'owner', state, harness: harness(), logger });
  const message = { message_id: 'first', from_user_id: 'owner', context_token: 'context', item_list: [{ type: 1, text_item: { text: '/status' } }] };
  await bridge.accept(message); await bridge.accept({ ...message, message_id: 'second' });
  assert.equal(sent.length, 3);
});

test('Feishu uses its native panel when registered and introduces a card when registration is unavailable', async t => {
  const root = await workspace(t);
  for (const ready of [true, false]) {
    const state = await new FeishuStateStore(join(root, `feishu-${ready}.json`)).load();
    const sent = [];
    const deliver = async request => {
      sent.push(request.data);
      return { code: 0, data: { message_id: `reply-${sent.length}` } };
    };
    const bridge = new FeishuHarnessBridge({ client: { im: { v1: { message: { create: deliver, reply: deliver } } } }, channel: {}, harness: harness(), state,
      status: { messagesReceived: 0, messagesReplied: 0, messagesRejected: 0 }, logger, accessPolicy: access(true), nativeMenuReady: () => ready,
    });
    const message = { sender: { sender_type: 'user', sender_id: { open_id: 'owner' } }, message: { message_id: 'first', message_type: 'text', chat_type: 'p2p', chat_id: 'chat', content: JSON.stringify({ text: '/version' }) } };
    await bridge.accept(message);
    await bridge.accept({ ...message, message: { ...message.message, message_id: 'second' } });
    assert.equal(sent.filter(item => item.msg_type === 'interactive').length, ready ? 0 : 1);
  }
});

test('QQ first-chat buttons remain usable for a subsequent numeric menu selection', async t => {
  const root = await workspace(t);
  const state = await new QqStateStore(join(root, 'qq.json')).load();
  const cards = [];
  const text = [];
  const bridge = new QqHarnessBridge({ bot: { appId: 'bot', sendText: async (_target, value) => text.push(value), send: async value => cards.push(value) }, ownerUserOpenid: 'owner', harness: harness(), state, logger, accessPolicy: access(true) });
  const message = { kind: 'c2c', senderId: 'owner', senderIsBot: false, content: '/status', messageId: 'first', replyTarget: { scope: 'c2c', targetId: 'owner', msgId: 'first' } };
  await bridge.accept(message);
  assert.equal(cards.length, 1);
  assert.ok(cards[0].keyboard.content.rows.length > 0);
  await bridge.accept({ ...message, messageId: 'second', content: '1', replyTarget: { ...message.replyTarget, msgId: 'second' } });
  assert.equal(cards.length, 2, 'numeric choice opens the existing menu section');
});

test('visible native menu labels and plain-text fallback match the reviewed snapshot', async () => {
  const expected = JSON.parse(await readFile(new URL('./im-menu.expected.json', import.meta.url), 'utf8'));
  assert.deepEqual({ nativeMenu: wecomAppMenu(), welcomeCard: wecomIntroductionMenu(), fallback: menuIntroductionText() }, expected);
});
