import { normalizeBusyMessageMode } from '../../../../src/channels/shared/message-mode.mjs';
import { diagnosticFields } from '../../../../src/channels/shared/diagnostic-details.mjs';
import { normalizeBotAlias } from '../../../../src/channels/shared/bot-alias.mjs';
import { normalizeAgentPresetCatalog, normalizeAgentPresetId, SET_AGENT_PRESET_ENDPOINT } from '../../agent-preset.js';
import { normalizeModelCatalog, normalizeModelSelection, SET_MODEL_ENDPOINT } from '../../model-setting.js';
import { normalizeLastMessageError } from '../../last-message-error.js';
import { normalizeAccessPolicy } from '../../../../src/channels/shared/access-policy.mjs';
import { normalizeContextEnhancementConfig } from '../../../../src/channels/shared/context-enhancement.mjs';
import {
  normalizeThinkingIntervalSeconds,
  normalizeThinkingNumbering,
  SET_THINKING_CADENCE_ENDPOINT,
} from '../../../../src/channels/shared/thinking-cadence.mjs';
import { normalizeSendLimitPerMinute, SET_SEND_LIMIT_ENDPOINT } from '../../../../src/channels/shared/send-limit.mjs';
import { channelName, localizeTemplate, localizeText } from '../../i18n.js';

const ACCOUNT_STATES = new Set(['connected', 'connecting', 'offline', 'error']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback, max = 240) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
}

function id(value) {
  const result = text(value, '', 128);
  return /^[a-z\d_-]+$/i.test(result) ? result : undefined;
}

function timestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? undefined : parsed;
}

export const TOKEN_BOT_ENDPOINTS = Object.freeze({
  status: 'connection.status',
  bindCredentials: 'bot.bind-credentials',
  reconnectBot: 'bot.reconnect',
  deleteBot: 'bot.delete',
  setWorkspace: 'bot.workspace.set',
  setModel: SET_MODEL_ENDPOINT,
  setAgentPreset: SET_AGENT_PRESET_ENDPOINT,
  setContextEnhancement: 'bot.context-enhancement.set',
  setBusyMessageMode: 'bot.message-mode.set',
  setAccessPolicy: 'bot.access-policy.set',
  setAlias: 'bot.alias.set',
  setThinkingTraces: 'bot.thinking-traces.set',
  setThinkingCadence: SET_THINKING_CADENCE_ENDPOINT,
  setSendLimit: SET_SEND_LIMIT_ENDPOINT,
});

export function createTokenChannelApi(channel, connectionSummary, {
  normalizeBotExtension = () => ({}),
} = {}) {
  const unwrapRpcResult = (result) => {
    if (!isRecord(result) || typeof result.ok !== 'boolean') {
      throw new Error(localizeTemplate('{channel} 服务返回了无法识别的响应', { channel: channelName(channel) }));
    }
    if (!result.ok) {
      const error = new Error(text(result.error?.message, localizeTemplate('{channel} 操作失败', { channel: channelName(channel) })));
      error.code = text(result.error?.code, `${channel.toUpperCase()}_RPC_ERROR`, 80);
      Object.assign(error, diagnosticFields(result.error));
    throw error;
    }
    return result.value;
  };

  const normalizeBot = (value) => {
    if (!isRecord(value) || !id(value.botId)) return undefined;
    const connected = value.connected === true;
    const state = ACCOUNT_STATES.has(value.state) ? value.state : 'offline';
    const extension = normalizeBotExtension(value);
    return {
      botId: id(value.botId),
      connected,
      state: connected ? 'connected' : state,
      workspace: text(value.workspace, '', 4_096),
      model: normalizeModelSelection(value.model),
      agentPreset: normalizeAgentPresetId(value.agentPreset),
      busyMessageMode: normalizeBusyMessageMode(value.busyMessageMode),      contextEnhancement: normalizeContextEnhancementConfig(value.contextEnhancement),
      // Absent from the backend means ON; only an explicit false opts out.
      thinkingTraces: value.thinkingTraces !== false,
      // Absent or unusable falls back to the same defaults the backend applies.
      thinkingNumbering: normalizeThinkingNumbering(value.thinkingNumbering),
      thinkingIntervalSeconds: normalizeThinkingIntervalSeconds(value.thinkingIntervalSeconds),
      // Absent or unusable falls back to the same default the backend applies.
      sendLimitPerMinute: normalizeSendLimitPerMinute(value.sendLimitPerMinute),
      ...(Object.hasOwn(value, 'accessPolicy')
        ? { accessPolicy: normalizeAccessPolicy(value.accessPolicy) }
        : {}),
      bot: {
      ...normalizeBotAlias(value.bot),
        name: text(value.bot?.name, localizeTemplate('{channel}机器人', { channel: channelName(channel) }), 100),
        username: text(value.bot?.username, '', 100),
        idMasked: text(value.bot?.idMasked, '机器人标识已安全保存', 140),
      },
      health: {
        summary: text(
          value.health?.summary,
          connected
            ? localizeTemplate('{subject}运行正常', {
              subject: `${channelName(channel)}${localizeText(connectionSummary)}`,
            })
            : localizeTemplate('{channel}连接尚未就绪', { channel: channelName(channel) }),
        ),
        lastCheckedAt: timestamp(value.health?.lastCheckedAt),
      },
      lastMessageError: normalizeLastMessageError(value.lastMessageError),
      error: isRecord(value.error) ? {
        ...diagnosticFields(value.error),
        code: text(value.error.code, `${channel.toUpperCase()}_ACCOUNT_ERROR`, 80),
        message: text(value.error.message, localizeTemplate('{channel}连接尚未就绪', { channel: channelName(channel) })),
      } : null,
      ...(isRecord(extension) ? extension : {}),
    };
  };

  const normalizeSnapshot = (value) => {
    const source = isRecord(value?.snapshot) ? value.snapshot : value;
    if (!isRecord(source) || !Array.isArray(source.bots)) {
      throw new Error(localizeTemplate('{channel} 服务没有返回有效的机器人列表', { channel: channelName(channel) }));
    }
    const bots = source.bots.map(normalizeBot).filter(Boolean);
    return {
      revision: Number.isSafeInteger(source.revision) ? source.revision : 0,
      bots,
      totals: { configured: bots.length, connected: bots.filter((bot) => bot.connected).length },
      agentPresetCatalog: normalizeAgentPresetCatalog(source.agentPresetCatalog),
      modelCatalog: normalizeModelCatalog(source.modelCatalog),
      ...(isRecord(source.permissions) ? { permissions: source.permissions } : {}),
    };
  };

  const presentError = (error) => ({
    ...diagnosticFields(error),
    code: text(error?.code, `${channel.toUpperCase()}_ERROR`, 80),
    message: text(error?.message, localizeTemplate('{channel}操作失败，请稍后重试', { channel: channelName(channel) })),
  });

  return Object.freeze({ unwrapRpcResult, normalizeSnapshot, presentError });
}
