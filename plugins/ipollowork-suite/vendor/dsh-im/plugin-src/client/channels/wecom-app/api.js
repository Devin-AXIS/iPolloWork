import { normalizeBusyMessageMode } from '../../../../src/channels/shared/message-mode.mjs';
import { normalizeConnectionError as normalizeTestError } from '../../connection-error.js';
import { diagnosticFields } from '../../../../src/channels/shared/diagnostic-details.mjs';
import { normalizeBotAlias } from '../../../../src/channels/shared/bot-alias.mjs';
import { normalizeAgentPresetCatalog, normalizeAgentPresetId, SET_AGENT_PRESET_ENDPOINT } from '../../agent-preset.js';
import { normalizeModelCatalog, normalizeModelSelection, SET_MODEL_ENDPOINT } from '../../model-setting.js';
import { normalizeLastMessageError } from '../../last-message-error.js';
import { normalizeAccessPolicy } from '../../../../src/channels/shared/access-policy.mjs';
import { normalizeContextEnhancementConfig } from '../../../../src/channels/shared/context-enhancement.mjs';

export const WECOM_APP_RPC_CHANNEL = '/wecom-app';

export const WECOM_APP_ENDPOINTS = Object.freeze({
  status: 'connection.status',
  bindApp: 'bot.bind',
  updateSettings: 'bot.settings.update',
  resetCallbackSecret: 'bot.callback-secret.reset',
  reconnectBot: 'bot.reconnect',
  deleteBot: 'bot.delete',
  setWorkspace: 'bot.workspace.set',
  setModel: SET_MODEL_ENDPOINT,
  setAgentPreset: SET_AGENT_PRESET_ENDPOINT,
  setContextEnhancement: 'bot.context-enhancement.set',
  setBusyMessageMode: 'bot.message-mode.set',
  setAccessPolicy: 'bot.access-policy.set',
  setAlias: 'bot.alias.set',
});

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

function optionalUrl(value) {
  const raw = text(value, '', 512);
  return /^https?:\/\//iu.test(raw) ? raw : null;
}

function timestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? undefined : parsed;
}

function normalizeTestMessage(value) {
  if (!isRecord(value)) return null;
  if (value.sent === true) return { sent: true };
  if (value.sent !== false) return null;
  const code = value.code === 'test-target-unavailable'
    ? 'test-target-unavailable'
    : 'test-message-failed';
  return { sent: false, code, ...(value.error ? { error: normalizeTestError(value.error) } : {}) };
}

export function unwrapRpcResult(result) {
  if (!isRecord(result) || typeof result.ok !== 'boolean') throw new Error('企业微信应用服务返回了无法识别的响应');
  if (!result.ok) {
    const error = new Error(text(result.error?.message, '企业微信应用操作失败'));
    error.code = text(result.error?.code, 'WECOM_APP_RPC_ERROR', 80);
    Object.assign(error, diagnosticFields(result.error));
    throw error;
  }
  return result.value;
}

function normalizeBot(value) {
  if (!isRecord(value) || !id(value.botId)) return undefined;
  const connected = value.connected === true;
  const state = ACCOUNT_STATES.has(value.state) ? value.state : 'offline';
  return {
    botId: id(value.botId),
    connected,
    state: connected ? 'connected' : state,
    workspace: text(value.workspace, '', 4_096),
    model: normalizeModelSelection(value.model),
    agentPreset: normalizeAgentPresetId(value.agentPreset),
    busyMessageMode: normalizeBusyMessageMode(value.busyMessageMode),    contextEnhancement: normalizeContextEnhancementConfig(value.contextEnhancement),
    ...(Object.hasOwn(value, 'accessPolicy')
      ? { accessPolicy: normalizeAccessPolicy(value.accessPolicy) }
      : {}),
    bot: {
      ...normalizeBotAlias(value.bot),
      name: text(value.bot?.name, '企业微信应用', 100),
      corpIdMasked: text(value.bot?.corpIdMasked, '企业 ID 已保存', 140),
      agentId: text(value.bot?.agentId, '', 32),
      apiBaseUrl: optionalUrl(value.bot?.apiBaseUrl) ?? '',
      callbackBaseUrl: optionalUrl(value.bot?.callbackBaseUrl) ?? '',
      streamEnabled: value.bot?.streamEnabled !== false,
      callbackUrl: optionalUrl(value.bot?.callbackUrl) ?? '',
    },
    health: {
      summary: text(value.health?.summary, connected ? '企业微信应用回调通道就绪' : '企业微信应用连接尚未就绪'),
      lastCheckedAt: timestamp(value.health?.lastCheckedAt),
    },
    lastMessageError: normalizeLastMessageError(value.lastMessageError),
    error: isRecord(value.error) ? {
      ...diagnosticFields(value.error),
      code: text(value.error.code, 'WECOM_APP_ACCOUNT_ERROR', 80),
      message: text(value.error.message, '企业微信应用连接尚未就绪'),
    } : null,
  };
}

export function normalizeSnapshot(value) {
  const source = isRecord(value?.snapshot) ? value.snapshot : value;
  if (!isRecord(source) || !Array.isArray(source.bots)) throw new Error('企业微信应用服务没有返回有效的机器人列表');
  const bots = source.bots.map(normalizeBot).filter(Boolean);
  return {
    revision: Number.isSafeInteger(source.revision) ? source.revision : 0,
    bots,
    totals: { configured: bots.length, connected: bots.filter((bot) => bot.connected).length },
    testMessage: normalizeTestMessage(source.testMessage),
    agentPresetCatalog: normalizeAgentPresetCatalog(source.agentPresetCatalog),
    modelCatalog: normalizeModelCatalog(source.modelCatalog),
  };
}

export function presentError(error) {
  return {
    ...diagnosticFields(error),
    code: text(error?.code, 'WECOM_APP_ERROR', 80),
    message: text(error?.message, '企业微信应用操作失败，请稍后重试'),
  };
}
