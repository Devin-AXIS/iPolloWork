import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BotWorkspaceStore, createBotWorkspaceScope } from '../vendor/dsh-im/src/channels/shared/bot-workspace-store.mjs';
import { listAgentPresetCatalog } from '../vendor/dsh-im/src/channels/shared/agent-preset.mjs';
import { ConversationStateStore } from '../vendor/dsh-im/src/channels/shared/conversation-state-store.mjs';
import { createHarnessSessionExecutors } from '../vendor/dsh-im/plugin-src/host/harness-session-coordinator.mjs';

test('QR and automatic bot entries use the coordinator without replacing saved settings or joining chats', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ipollo-coordinator-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'workspaces.json');
  const previous = await new BotWorkspaceStore(path, { defaultWorkspace: root }).load();
  await previous.ensure('existing', { defaultAgentPreset: 'old-specialist' });
  const workspaces = await new BotWorkspaceStore(path, { defaultWorkspace: root, entryAgentPreset: 'ipollo-coordinator' }).load();
  await workspaces.ensure('qr');
  await workspaces.ensure('auto', { defaultAgentPreset: 'another-specialist' });
  for (const id of ['existing', 'qr', 'auto']) assert.equal(workspaces.agentPresetFor(id), 'ipollo-coordinator');
  await assert.rejects(workspaces.setAgentPreset('qr', 'old-specialist'), { code: 'agent-preset-unavailable' });
  assert.equal(await workspaces.setAgentPreset('qr', null), 'ipollo-coordinator');
  const state = await new ConversationStateStore(join(root, 'state.json')).load();
  const created = [];
  const scope = createBotWorkspaceScope({ createSession: async input => { created.push(input); return `session-${created.length}`; } }, { botId: 'qr', workspaces, state });
  const one = await scope.harness.createSession({ conversationKey: 'chat-a' });
  const two = await scope.harness.createSession({ conversationKey: 'chat-b' });
  assert.notEqual(one, two);
  assert.deepEqual(created.map(item => item.agentPreset), ['ipollo-coordinator', 'ipollo-coordinator']);
  const restored = await new BotWorkspaceStore(path, { defaultWorkspace: root }).load();
  assert.equal(restored.agentPresetFor('existing'), 'old-specialist');
});

test('IM entry catalog only offers the coordinator while the native catalog retains every preset', async () => {
  const items = [{ id: 'standard', name: 'Standard' }, { id: 'ipollo-coordinator', name: 'Main assistant' }, { id: 'ipollo-agent-research', name: 'Research' }];
  const services = { agentPresets: { list: async () => items, defaultId: 'standard' }, ipolloAgents: { coordinatorPreset: 'ipollo-coordinator' } };
  const result = await listAgentPresetCatalog({ get: name => services[name] });
  assert.equal(result.defaultId, 'ipollo-coordinator');
  assert.deepEqual(result.items.map(item => item.id), ['ipollo-coordinator']);
  assert.equal(items.length, 3);
});

test('coordinator completion preserves later failures and cancellation, leaving ordinary sessions unchanged', async () => {
  const failure = { kind: 'error', error: { code: 'MODEL_UNAVAILABLE' } };
  const agent = { session: { header: { agentPreset: 'ipollo-coordinator' }, snapshotEvents: () => [{ seq: 9, type: 'turn/end', data: { turn: 2, reason: failure } }] }, whenIdle: async () => {} };
  let pending = false;
  const services = { agents: { get: () => agent }, subagents: { waitForTreeWork: async () => pending ? new Promise(() => {}) : false } };
  const { completionExecutor } = createHarnessSessionExecutors({ get: name => services[name] });
  assert.deepEqual(await completionExecutor({ sessionId: 'one', afterSeq: 3 }), { answer: '', reason: failure });
  const controller = new AbortController();
  pending = true;
  const running = completionExecutor({ sessionId: 'one', afterSeq: 3, signal: controller.signal });
  controller.abort(new Error('cancelled by caller'));
  await assert.rejects(running, /cancelled by caller/);
  agent.session.header.agentPreset = 'standard';
  assert.equal(await completionExecutor({ sessionId: 'one', afterSeq: 3 }), undefined);
});
