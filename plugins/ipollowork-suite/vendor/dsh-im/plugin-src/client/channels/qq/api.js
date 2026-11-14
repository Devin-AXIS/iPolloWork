import { normalizeBusyMessageMode } from '../../../../src/channels/shared/message-mode.mjs';
import { normalizeConnectionError as normalizeTestError } from '../../connection-error.js';
import { diagnosticFields } from '../../../../src/channels/shared/diagnostic-details.mjs';
import { normalizeBotAlias } from '../../../../src/channels/shared/bot-alias.mjs';
import { normalizeAgentPresetCatalog, normalizeAgentPresetId, SET_AGENT_PRESET_ENDPOINT } from '../../agent-preset.js';
import { normalizeModelCatalog, normalizeModelSelection, SET_MODEL_ENDPOINT } from '../../model-setting.js';
import { normalizeLastMessageError } from '../../last-message-error.js';
import { normalizeAccessPolicy } from '../../../../src/channels/shared/access-policy.mjs';
import { normalizeContextEnhancementConfig } from '../../../../src/channels/shared/context-enhancement.mjs';

export const QQ_RPC_CHANNEL = '/qq';

export const QQ_ENDPOINTS = Object.freeze({
  status: 'connection.status',
  beginProvisioning: 'provision.begin',
  pollProvisioning: 'provision.poll',
  cancelProvisioning: 'provision.cancel',
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
});

const PROVISION_STATES = new Set(['starting', 'pending', 'refreshing', 'connecting', 'connected', 'failed', 'cancelled']);
const ACCOUNT_STATES = new Set(['connected', 'connecting', 'offline', 'error']);
const TEST_MESSAGE_CODES = new Set(['test-target-unavailable', 'test-message-failed']);
const QR_DATA_URL = /^data:image\/(?:png|webp);base64,[a-z\d+/]+={0,2}$/i;

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

export function unwrapRpcResult(result) {
  if (!isRecord(result) || typeof result.ok !== 'boolean') throw new Error('QQ 服务返回了无法识别的响应');
  if (!result.ok) {
    const error = new Error(text(result.error?.message, 'QQ 操作失败'));
    error.code = text(result.error?.code, 'QQ_RPC_ERROR', 80);
    Object.assign(error, diagnosticFields(result.error));
    throw error;
  }
  return result.value;
}

export function safeQrSource(value) {
  return typeof value === 'string' && value.length <= 2 * 1024 * 1024 && QR_DATA_URL.test(value)
    ? value : undefined;
}

export function normalizeProvisioning(value, now = Date.now()) {
  const source = isRecord(value?.provisioning) ? value.provisioning : value;
  if (!isRecord(source)) throw new Error('QQ 服务没有返回扫码绑定进度');
  const attemptId = id(source.attemptId);
  if (!attemptId) throw new Error('QQ 扫码服务没有返回有效的绑定任务');
  const reported = text(source.status, 'failed', 32);
  const result = {
    attemptId,
    status: PROVISION_STATES.has(reported) ? reported : 'failed',
    expiresAt: timestamp(source.expiresAt) ?? now + 5 * 60_000,
    pollIntervalMs: Math.min(10_000, Math.max(500, Number(source.pollIntervalMs) || 1_000)),
    qrRevision: Number.isSafeInteger(source.qrRevision) ? source.qrRevision : 0,
  };
  const qrCodeDataUrl = safeQrSource(source.qrCodeDataUrl);
  if (qrCodeDataUrl) result.qrCodeDataUrl = qrCodeDataUrl;
  if (id(source.botId)) result.botId = id(source.botId);
  if (isRecord(source.error)) result.error = {
    ...diagnosticFields(source.error),
    code: text(source.error.code, 'QQ_PROVISION_FAILED', 80),
    message: text(source.error.message, 'QQ 机器人没有接入完成'),
  };
  return result;
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
      name: text(value.bot?.name, 'QQ机器人', 100),
      appIdMasked: text(value.bot?.appIdMasked, '应用标识已安全保存', 140),
    },
    health: {
      summary: text(value.health?.summary, connected ? 'QQ WebSocket 长连接运行正常' : 'QQ 连接尚未就绪'),
      lastCheckedAt: timestamp(value.health?.lastCheckedAt),
    },
    lastMessageError: normalizeLastMessageError(value.lastMessageError),
    error: isRecord(value.error) ? {
      ...diagnosticFields(value.error),
      code: text(value.error.code, 'QQ_ACCOUNT_ERROR', 80),
      message: text(value.error.message, 'QQ 连接尚未就绪'),
    } : null,
  };
}

function normalizeTestMessage(value) {
  if (!isRecord(value) || typeof value.sent !== 'boolean') return undefined;
  if (value.sent) return { sent: true };
  const code = text(value.code, 'test-message-failed', 80);
  return {
    sent: false,
    ...(value.error ? { error: normalizeTestError(value.error) } : {}),
    code: TEST_MESSAGE_CODES.has(code) ? code : 'test-message-failed',
  };
}

export function normalizeSnapshot(value) {
  const source = isRecord(value?.snapshot) ? value.snapshot : value;
  if (!isRecord(source) || !Array.isArray(source.bots)) throw new Error('QQ 服务没有返回有效的机器人列表');
  const bots = source.bots.map(normalizeBot).filter(Boolean);
  const testMessage = normalizeTestMessage(source.testMessage);
  return {
    revision: Number.isSafeInteger(source.revision) ? source.revision : 0,
    bots,
    totals: { configured: bots.length, connected: bots.filter((bot) => bot.connected).length },
    provisioning: source.provisioning ? normalizeProvisioning(source.provisioning) : null,
    agentPresetCatalog: normalizeAgentPresetCatalog(source.agentPresetCatalog),
    modelCatalog: normalizeModelCatalog(source.modelCatalog),
    ...(testMessage ? { testMessage } : {}),
  };
}

export function connectionTestFeedback(result) {
  if (result?.sent === true) return '测试消息已发送，请到对应机器人会话中确认。';
  if (result?.code === 'test-target-unavailable') {
    return '连接检查完成。机器人尚未收到可用于测试的私聊消息。';
  }
  return result ? '连接检查完成，但测试消息发送失败。' : null;
}

export function presentError(error) {
  return {
    ...diagnosticFields(error),
    code: text(error?.code, 'QQ_ERROR', 80),
    message: text(error?.message, 'QQ 操作失败，请稍后重试'),
  };
}

export function formatRemaining(milliseconds) {
  const seconds = Math.max(0, Math.ceil(Number(milliseconds) / 1_000) || 0);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
