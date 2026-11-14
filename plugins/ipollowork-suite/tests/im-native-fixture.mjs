/** Local-only replay of IM media through the shipped DSH Host APIs. Never connects a bot. */
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HarnessClient } from '../vendor/dsh-im/src/channels/shared/harness-client.mjs';
import { harnessConnection } from '../vendor/dsh-im/plugin-src/host/harness-connection.mjs';
import { createHarnessSessionExecutors } from '../vendor/dsh-im/plugin-src/host/harness-session-coordinator.mjs';
import { dingtalkInboundMessage } from '../vendor/dsh-im/src/channels/dingtalk/dingtalk-bridge.mjs';
import { extractInboundMessage } from '../vendor/dsh-im/src/channels/feishu/message-utils.mjs';
import { wecomInboundMessage } from '../vendor/dsh-im/src/channels/wecom/wecom-bridge.mjs';
import { wecomAppInboundMessage } from '../vendor/dsh-im/src/channels/wecom-app/wecom-app-bridge.mjs';
import { wrapCanonicalWav } from '../vendor/dsh-im/src/channels/telegram/voice.mjs';
import { Readable } from 'node:stream';
import { WecomAppBridge } from '../vendor/dsh-im/src/channels/wecom-app/wecom-app-bridge.mjs';
import { WecomAppStateStore } from '../vendor/dsh-im/src/channels/wecom-app/state-store.mjs';
import { BotWorkspaceStore, createBotWorkspaceScope } from '../vendor/dsh-im/src/channels/shared/bot-workspace-store.mjs';

export const name = 'ipollo-im-replay';
export const inject = ['webServer', 'connection', 'llm', 'agents', 'sessionController', 'workspaceRegistry', 'fileUploads', 'typertGateway'];
const requests = [];
const delegationRequests = [];
class MediaAdapter extends LlmAdapter {
  async listModels(provider) { return [{ provider, id: 'vision', name: 'IM vision fixture' }, { provider, id: 'text', name: 'IM text fixture' }]; }
  async resolveModel(provider, model) { return { provider, id: model, name: model, inputModalities: model === 'vision' ? ['text', 'image'] : ['text'] }; }
  async *stream(options) {
    requests.push(structuredClone(options.messages));
    delegationRequests.push({ messages: structuredClone(options.messages), tools: (options.tools ?? []).map(tool => tool.name), model: options.model });
    const body = JSON.stringify(options.messages);
    const main = options.tools?.some(tool => tool.name === 'ipollo_dispatch');
    if (main && body.includes('COORDINATE_FIXED_AND_TEMP') && !options.messages.some(message => message.role === 'tool')) {
      const tool = options.tools.find(tool => tool.name === 'ipollo_delegate');
      const preset = tool?.parameters?.properties?.agent_preset?.enum?.[0];
      const tasks = [
        ...(preset ? [{ tool: 'ipollo_delegate', args: { name: 'saved-worker', description: 'Use saved specialist', agent_preset: preset, prompt: 'SAVED_WORK_TASK' } }] : []),
        { tool: 'ipollo_dispatch', args: { name: 'temporary-worker', description: 'Use temporary worker', prompt: 'TEMP_WORK_TASK. Act as a task-specific analyst.' } },
      ];
      for (const [index, task] of tasks.entries()) {
        const id = ToolCallId(`coordinator-${index}`);
        const args = JSON.stringify(task.args);
        yield { type: 'block-start', index, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index, id, name: task.tool, argumentsDelta: args };
        yield { type: 'block-end', index, block: { type: 'tool-call', id, name: task.tool, arguments: args } };
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
      return;
    }
    if (!main && body.includes('TEMP_WORK_TASK')) await delay(300);
    const text = main && body.includes('COORDINATE_FIXED_AND_TEMP')
      ? (body.includes('TEMP_DONE') && (!options.tools.some(tool => tool.name === 'ipollo_delegate') || body.includes('SAVED_DONE')) ? 'COORDINATOR_COMBINED_RESULT' : 'WAITING_FOR_WORKERS')
      : !main && body.includes('TEMP_WORK_TASK') ? 'TEMP_DONE'
      : !main && body.includes('SAVED_WORK_TASK') ? 'SAVED_DONE' : 'IM_MEDIA_VERIFIED';
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

export function apply(ctx) {
  ctx.llm.registerAdapter(['ipollo-im-fixture'], new MediaAdapter());
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/ipollo-im-replay', handler: async (req, res) => {
    const denied = ctx.connection.requestRejection({ headers: req.headers });
    if (denied !== undefined) { res.writeHead(denied); res.end(); return; }
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      requests.length = 0;
      delegationRequests.length = 0;
      const path = await mkdtemp(join(tmpdir(), 'ipollo-im-replay-'));
      const project = await ctx.workspaceRegistry.create(path, 'IM media replay');
      const created = await ctx.sessionController.create({ workspaceId: project.id, agentPreset: 'standard' });
      const agent = ctx.agents.get(created.sessionId);
      agent.model.select({ provider: 'ipollo-im-fixture', model: input.textOnly ? 'text' : 'vision' });
      const image = await readFile(new URL('./fixtures/avatar.png', import.meta.url));
      const audio = Buffer.from(wrapCanonicalWav(Buffer.alloc(3200)));
      let speechCalls = 0;
      const speech = input.speech ? { resolve: request => request, transcribe: async () => { speechCalls++; return { text: 'NATIVE_TRANSCRIPT' }; } } : undefined;
      const executors = createHarnessSessionExecutors({ get: name => name === 'speechToText' ? speech : ctx.get(name) });
      const harness = new HarnessClient({ ...harnessConnection(ctx), ...executors, workspace: path });
      if (input.mode === 'coordinator') {
        const state = await new WecomAppStateStore(join(path, 'channel.json')).load();
        const workspaces = await new BotWorkspaceStore(join(path, 'bot-workspaces.json'), { defaultWorkspace: path, entryAgentPreset: 'ipollo-coordinator' }).load();
        await workspaces.ensure('scanned-bot');
        const scope = createBotWorkspaceScope(harness, { botId: 'scanned-bot', workspaces, state });
        const sessionId = await scope.harness.createSession({ conversationKey: 'group-a' });
        const root = ctx.agents.get(sessionId);
        root.model.select({ provider: 'ipollo-im-fixture', model: 'vision' });
        const answer = await scope.harness.ask(sessionId, 'COORDINATE_FIXED_AND_TEMP', { timeoutMs: 15000 });
        const sibling = await scope.harness.createSession({ conversationKey: 'group-b' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ answer, requests: delegationRequests, separateGroupSessions: sibling !== sessionId, preset: root.session.header.agentPreset, events: root.session.snapshotEvents() }));
        return;
      }
      if (input.mode === 'menus') {
        const state = await new WecomAppStateStore(join(path, 'channel.json')).load();
        const workspaces = await new BotWorkspaceStore(join(path, 'bot-workspaces.json'), { defaultWorkspace: await realpath(path), ungroupedWorkspace: await realpath(path) }).load();
        await workspaces.ensure('menu-bot');
        const scope = createBotWorkspaceScope(harness, { botId: 'menu-bot', workspaces, state });
        const sent = [];
        const bridge = new WecomAppBridge({ api: { sendText: async message => { sent.push(message.content); return {}; } }, harness: scope.harness, state: scope.state, status: {}, nativeMenuReady: () => true });
        const event = { event: 'click', from: { userid: 'owner' }, createTime: 1, eventKey: 'ipollo_im_v1_new' };
        await bridge.acceptEvent(event);
        const sessionId = scope.state.sessionFor('p2p:owner');
        const afterCreate = sent.length;
        await bridge.acceptEvent(event);
        await bridge.acceptEvent({ ...event, createTime: 2, eventKey: 'ipollo_im_v1_models' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ createdNativeSession: Boolean(ctx.agents.get(sessionId)), sameWorkspace: ctx.agents.get(sessionId)?.session.header.cwd === await realpath(path),
          replayIgnored: afterCreate + 1 === sent.length, modelMenuUsesNativeCatalog: sent.at(-1)?.includes('ipollo-im-fixture/vision'), noModelRequest: requests.length === 0 }));
        return;
      }
      let message;
      if (input.channel === 'dingtalk') message = dingtalkInboundMessage({ msgtype: 'audio', content: { downloadCode: 'audio', ...(input.recognition ? { recognition: 'PLATFORM_TRANSCRIPT' } : {}) } }, { api: { downloadFile: async () => audio } });
      else if (input.channel === 'feishu') message = extractInboundMessage({ message: { message_type: 'audio', message_id: 'msg', content: JSON.stringify({ file_key: 'audio' }) } }, { im: { v1: { messageResource: { get: async () => ({ getReadableStream: () => Readable.from(audio) }) } } } });
      else if (input.channel === 'wecom-app') message = wecomAppInboundMessage({ msgtype: 'voice', mediaId: 'audio' }, { downloadMedia: async () => ({ data: audio }) });
      else if (input.channel === 'wecom-voice') message = wecomInboundMessage({ body: { msgtype: 'voice', voice: { content: 'WECOM_TRANSCRIPT' } } }, {});
      else message = wecomInboundMessage({ body: { msgtype: 'mixed', mixed: { msg_item: [{ msgtype: 'text', text: { content: 'Describe this image' } }, { msgtype: 'image', image: { url: 'https://fixture.invalid/image' } }] } } }, { downloadFile: async () => ({ buffer: image, filename: 'image.png' }) });
      const answer = await harness.ask(created.sessionId, message.content, { images: message.images, files: message.files, timeoutMs: 15000 });
      const events = agent.session.snapshotEvents().filter(event => event.type === 'user/message');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ answer, requests, events, speechCalls }));
    } catch (error) {
      console.error('[IM replay]', error);
      res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(error), details: error.details }));
    }
  } }));
}
