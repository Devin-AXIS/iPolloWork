// Read-only management RPC for the channel directory and bound-session transcripts.
// Transcript reads use official sessionQuery; no archive parsing or sqlite access.
// The directory covers standard bot/account state plus configured Feishu legacy state.
// Custom dataDir/botsDir overrides are not inferred.
import { join, resolve } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

import { registerManagementRpc } from '../management-rpc.mjs';
import { LEGACY_FEISHU_SECRET_REF } from '../../src/channels/feishu/plugin-config-store.mjs';

export const CHANNEL_LIST_RPC_CHANNEL = '/dsh-im-channels';
const MAX_STATE_BYTES = 8 * 1024 * 1024;

function dshHome(config = {}) {
  return resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
}

function sessionRows(raw) {
  const sessions = raw?.sessions;
  if (!sessions || typeof sessions !== 'object' || Array.isArray(sessions)) return [];
  return Object.entries(sessions)
    .filter(([, sessionId]) => typeof sessionId === 'string' && sessionId.length > 0)
    .map(([key, sessionId]) => ({ key, sessionId }));
}

async function directoryEntries(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return [];
    throw error;
  }
}

async function readJson(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_STATE_BYTES) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readState(path, botId) {
  const raw = await readJson(path);
  return sessionRows(raw).map(row => ({ ...row, botId }));
}

async function feishuLegacyBotIds(integrationRoot, warnings) {
  let config;
  try {
    config = await readJson(join(integrationRoot, 'config.json'));
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
      warnings.push(`dsh-feishu/config.json: ${error?.message ?? error}`);
    }
    return [];
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
  const version2 = config.version === 2 && Array.isArray(config.bots);
  const bots = version2 ? config.bots : [config];
  const ids = [];
  for (const bot of bots) {
    if (!bot || typeof bot !== 'object' || Array.isArray(bot)) continue;
    // PluginConfigStore normalizes these fields with trim before selecting state.
    const id = typeof bot.id === 'string' ? bot.id.trim() : '';
    const secretRef = typeof bot.secretRef === 'string' ? bot.secretRef.trim() : '';
    const legacy = version2
      ? secretRef === LEGACY_FEISHU_SECRET_REF
      : !secretRef || secretRef === LEGACY_FEISHU_SECRET_REF;
    if (!legacy) continue;
    if (/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      ids.push(id);
    } else if (!version2 && typeof bot.appId === 'string' && bot.appId.trim()) {
      // Match the v1 migration identity without loading the write-capable config store.
      ids.push(`bot_${createHash('sha256').update(bot.appId.trim()).digest('hex').slice(0, 24)}`);
    } else {
      warnings.push('dsh-feishu/config.json: legacy bot has no usable id');
    }
  }
  return [...new Set(ids)];
}

export async function buildList(config = {}) {
  const root = dshHome(config);
  const integrationsRoot = join(root, 'integrations');
  const byChannel = new Map();
  const warnings = [];
  let scannedFiles = 0;

  const integrations = await directoryEntries(integrationsRoot);
  for (const integration of integrations) {
    if (!integration.isDirectory() || !/^dsh-[A-Za-z0-9-]+$/.test(integration.name)) continue;
    const channel = integration.name.slice('dsh-'.length);
    const integrationRoot = join(integrationsRoot, integration.name);
    const legacyBotIds = new Set(channel === 'feishu'
      ? await feishuLegacyBotIds(integrationRoot, warnings)
      : []);

    const collectState = async (statePath, botId, warningKey) => {
      let rows;
      try {
        rows = await readState(statePath, botId);
        scannedFiles += 1;
      } catch (error) {
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
          warnings.push(`${warningKey}: ${error?.message ?? error}`);
        }
        return;
      }
      if (rows.length === 0) return;
      const group = byChannel.get(channel) ?? { channel, sessions: [] };
      group.sessions.push(...rows);
      byChannel.set(channel, group);
    };

    const container = channel === 'weixin' ? 'accounts' : 'bots';
    const bots = await directoryEntries(join(integrationRoot, container));
    for (const bot of bots) {
      if (!bot.isDirectory() || legacyBotIds.has(bot.name)) continue;
      await collectState(
        join(integrationRoot, container, bot.name, 'state.json'),
        bot.name,
        `${integration.name}/${bot.name}`,
      );
    }
    for (const botId of legacyBotIds) {
      await collectState(
        join(integrationRoot, 'state.json'),
        botId,
        `${integration.name}/${botId}/legacy-state`,
      );
    }
  }

  const channels = [...byChannel.values()]
    .map(group => ({
      ...group,
      sessions: group.sessions.sort((a, b) =>
        a.key.localeCompare(b.key) || a.sessionId.localeCompare(b.sessionId) || a.botId.localeCompare(b.botId)),
    }))
    .sort((a, b) => a.channel.localeCompare(b.channel));
  return { channels, scannedFiles, warnings };
}

const DEFAULT_DETAIL_LIMIT = 100;
const MAX_DETAIL_LIMIT = 200;
const MAX_MESSAGE_TEXT_CHARS = 30000;
const SESSION_ID_PATTERN = /^session-[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;

function messageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n\n');
}

// A human transcript must use append-origin events, not the model-visible
// surface: replacement copies can shadow conversation the user already saw.
export function transcriptMessages(events) {
  const messages = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.surfaceOp !== 'append') continue;
    let role;
    let content;
    if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
      role = 'user';
      content = event.data?.content;
    } else if (event.type === 'assistant/message' && event.data?.message?.role === 'assistant') {
      role = 'assistant';
      content = event.data.message.content;
    } else {
      continue;
    }
    const fullText = messageText(content);
    if (!fullText) continue;
    messages.push({
      id: `${event.seq}:${role}`,
      seq: event.seq,
      time: Number.isFinite(event.time) ? event.time : null,
      role,
      text: fullText.slice(0, MAX_MESSAGE_TEXT_CHARS),
      ...(fullText.length > MAX_MESSAGE_TEXT_CHARS ? { truncated: true } : {}),
    });
  }
  return messages;
}

function findBinding(directory, payload) {
  if (typeof payload?.channel !== 'string' || typeof payload?.key !== 'string'
      || typeof payload?.botId !== 'string'
      || typeof payload?.sessionId !== 'string' || !SESSION_ID_PATTERN.test(payload.sessionId)) return null;
  for (const group of directory.channels) {
    if (group.channel !== payload.channel) continue;
    const row = group.sessions.find(candidate => candidate.key === payload.key
      && candidate.botId === payload.botId && candidate.sessionId === payload.sessionId);
    if (row) return row;
  }
  return null;
}

function detailError(code, message) {
  return { ok: false, error: { code, message, details: {} } };
}

async function readSessionDetail(sessionQuery, config, payload) {
  const limit = payload.limit === undefined ? DEFAULT_DETAIL_LIMIT : payload.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DETAIL_LIMIT
      || (payload.offset !== undefined && (!Number.isInteger(payload.offset) || payload.offset < 0))) {
    return detailError('channel-session/invalid-request', 'limit 或 offset 参数无效');
  }
  // Re-scan and require the exact channel/key/sessionId binding. The RPC must
  // not become an arbitrary session reader merely because a caller knows an id.
  const directory = await buildList(config);
  const binding = findBinding(directory, payload);
  if (!binding) return detailError('channel-session/not-bound', '该会话不属于指定通道绑定，可能已解绑');
  if (typeof sessionQuery?.readSession !== 'function') {
    return detailError('channel-session/read-unavailable', '宿主 sessionQuery 服务尚未就绪');
  }
  const snapshot = await sessionQuery.readSession(payload.sessionId);
  const allMessages = transcriptMessages(snapshot.events);
  const total = allMessages.length;
  const offset = payload.offset === undefined
    ? Math.max(0, total - limit)
    : Math.min(payload.offset, total);
  return {
    ok: true,
    value: {
      channel: payload.channel,
      key: payload.key,
      botId: binding.botId,
      sessionId: payload.sessionId,
      createdAt: snapshot.session?.createdAt ?? null,
      capturedThroughSeq: snapshot.events?.at(-1)?.seq ?? null,
      total,
      offset,
      limit,
      hasMore: offset > 0,
      nextOffset: Math.max(0, offset - limit),
      messages: allMessages.slice(offset, offset + limit),
    },
  };
}

export function installChannelListRpc(ctx, authority = undefined, config = {}) {
  // Cordis throws on ctx.sessionQuery unless this fiber declared the injection.
  // Resolve it only in the inject callback below, after the directory route exists.
  let sessionQuery;
  const handler = async (method, payload = {}, signal) => {
    try {
      if (method === 'list.channels') {
        // connection.rpc preserves only { ok, value } on success; extra fields are dropped.
        return { ok: true, value: await buildList(config) };
      }
      if (method === 'session.read') return await readSessionDetail(sessionQuery, config, payload);
      return { ok: false, error: { code: 'channel-list/unknown-method', message: `Unknown method: ${method}` } };
    } catch (error) {
      return detailError(
        method === 'session.read' ? 'channel-session/unavailable' : 'channel-list/unavailable',
        String(error?.message ?? error),
      );
    }
  };
  const stopRpc = registerManagementRpc(ctx, CHANNEL_LIST_RPC_CHANNEL, handler, { authority });
  // Keep the directory available even if the optional query service is late;
  // session.read then reports an explicit not-ready error instead of breaking list.channels.
  const stopQuery = typeof ctx.inject === 'function'
    ? ctx.inject(['sessionQuery'], queryCtx => {
      sessionQuery = queryCtx.sessionQuery;
      return () => { sessionQuery = undefined; };
    })
    : null;
  return () => {
    if (typeof stopQuery === 'function') stopQuery();
    else stopQuery?.dispose?.();
    if (typeof stopRpc === 'function') stopRpc();
    else stopRpc?.dispose?.();
  };
}
