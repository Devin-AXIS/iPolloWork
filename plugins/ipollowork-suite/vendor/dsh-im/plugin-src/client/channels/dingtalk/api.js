import { normalizeBusyMessageMode } from '../../../../src/channels/shared/message-mode.mjs';
import { normalizeConnectionError as normalizeTestError } from '../../connection-error.js';
import { diagnosticFields } from '../../../../src/channels/shared/diagnostic-details.mjs';
import { normalizeBotAlias } from '../../../../src/channels/shared/bot-alias.mjs';
import { normalizeAgentPresetCatalog, normalizeAgentPresetId, SET_AGENT_PRESET_ENDPOINT } from '../../agent-preset.js';
import { normalizeModelCatalog, normalizeModelSelection, SET_MODEL_ENDPOINT } from '../../model-setting.js';
import { normalizeLastMessageError } from '../../last-message-error.js';
import { normalizeAccessPolicy } from '../../../../src/channels/shared/access-policy.mjs';
import { normalizeContextEnhancementConfig } from '../../../../src/channels/shared/context-enhancement.mjs';

export const DINGTALK_RPC_CHANNEL = '/dingtalk';

export const DINGTALK_ENDPOINTS = Object.freeze({
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

const ACCOUNT_STATES = new Set(['connected', 'connecting', 'offline', 'error']);
const SNAPSHOT_STATES = new Set(['disconnected', 'offline', 'provisioning', 'connected', 'degraded']);
const PROVISION_STATES = new Set([
  'starting',
  'pending',
  'scanned',
  'authorizing',
  'creating',
  'connecting',
  'connected',
  'expired',
  'failed',
  'cancelled',
]);
const HEALTH_STATES = new Set(['healthy', 'checking', 'degraded', 'offline']);
const FORBIDDEN_ERROR_FIELDS = /(client[_-]?secret|secret[_-]?ref|device[_-]?code|app[_-]?secret|access[_-]?token|token)/i;
const QR_DATA_URL = /^data:image\/(?:png|webp);base64,[a-z\d+/]+={0,2}$/i;
const MAX_QR_SOURCE_LENGTH = 2 * 1024 * 1024;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value, maxLength = 240) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function opaqueId(value) {
  const id = optionalString(value, 128);
  return id && /^[a-z\d_-]+$/i.test(id) ? id : undefined;
}

function timestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function safeErrorCode(value, fallback) {
  const code = optionalString(value, 80);
  return code && /^[a-z][a-z\d_.:-]*$/i.test(code) && !FORBIDDEN_ERROR_FIELDS.test(code)
    ? code
    : fallback;
}

function sanitizeMessage(value, fallback) {
  const message = optionalString(value, 480) ?? fallback;
  if (FORBIDDEN_ERROR_FIELDS.test(message)) return fallback;
  return message.replace(/([=:]\s*)[^\s,;，。]+/g, '$1••••••').slice(0, 240);
}

function safeReferenceId(value) {
  const referenceId = optionalString(value, 40);
  return referenceId && /^DT-CONN-[A-F0-9]{8}$/.test(referenceId) ? referenceId : undefined;
}

function normalizeError(value, fallbackCode, fallbackMessage) {
  if (!isRecord(value)) return undefined;
  const hint = sanitizeMessage(value.hint, '');
  const referenceId = safeReferenceId(value.referenceId);
  return {
    ...diagnosticFields(value),
    code: safeErrorCode(value.code, fallbackCode),
    message: sanitizeMessage(value.message, fallbackMessage),
    ...(hint ? { hint } : {}),
    ...(referenceId ? { referenceId } : {}),
  };
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
  if (!isRecord(result) || typeof result.ok !== 'boolean') {
    throw new Error('钉钉服务返回了无法识别的响应');
  }
  if (!result.ok) {
    const visible = normalizeError(
      result.error,
      'DINGTALK_RPC_ERROR',
      '钉钉操作失败',
    ) ?? { code: 'DINGTALK_RPC_ERROR', message: '钉钉操作失败' };
    const error = new Error(visible.message);
    error.code = visible.code;
    if (visible.hint) error.hint = visible.hint;
    if (visible.referenceId) error.referenceId = visible.referenceId;
    Object.assign(error, diagnosticFields(result.error));
    throw error;
  }
  return result.value;
}

export function safeQrSource(value) {
  if (typeof value !== 'string' || value.length > MAX_QR_SOURCE_LENGTH) return undefined;
  return QR_DATA_URL.test(value) ? value : undefined;
}

export function normalizeProvisioning(value, now = Date.now()) {
  const source = isRecord(value?.provisioning) ? value.provisioning : value;
  if (!isRecord(source)) throw new Error('钉钉服务没有返回扫码绑定进度');
  const attemptId = opaqueId(source.attemptId);
  if (!attemptId) throw new Error('钉钉扫码服务没有返回有效的绑定任务');

  const reportedStatus = optionalString(source.status, 32) ?? optionalString(source.state, 32);
  const status = PROVISION_STATES.has(reportedStatus) ? reportedStatus : 'failed';
  const expiresAt = timestamp(source.expiresAt)
    ?? now + clamp(source.expiresIn, 1, 2 * 60 * 60, 10 * 60) * 1_000;
  const result = {
    attemptId,
    status,
    expiresAt,
    pollIntervalMs: clamp(source.pollIntervalMs, 1_000, 10_000, 3_000),
  };
  const qrCodeDataUrl = safeQrSource(source.qrCodeDataUrl);
  if (qrCodeDataUrl) result.qrCodeDataUrl = qrCodeDataUrl;
  if (opaqueId(source.botId)) result.botId = opaqueId(source.botId);
  if (source.alreadyConnected === true) result.alreadyConnected = true;
  const error = normalizeError(
    source.error,
    'DINGTALK_PROVISION_FAILED',
    '钉钉机器人没有接入完成',
  );
  if (error) result.error = error;
  return result;
}

function normalizeBot(value) {
  if (!isRecord(value)) return undefined;
  const botId = opaqueId(value.botId);
  if (!botId) return undefined;
  const bot = isRecord(value.bot) ? value.bot : {};
  const connected = value.connected === true;
  const reportedState = ACCOUNT_STATES.has(value.state) ? value.state : 'offline';
  const state = connected ? 'connected' : reportedState === 'connected' ? 'connecting' : reportedState;
  const health = isRecord(value.health) ? value.health : {};
  const stats = isRecord(value.stats) ? value.stats : {};
  return {
    botId,
    state,
    connected,
    configured: value.configured !== false,
    workspace: optionalString(value.workspace, 4_096) ?? '',
    model: normalizeModelSelection(value.model),
    agentPreset: normalizeAgentPresetId(value.agentPreset),
    busyMessageMode: normalizeBusyMessageMode(value.busyMessageMode),    contextEnhancement: normalizeContextEnhancementConfig(value.contextEnhancement),
    ...(Object.hasOwn(value, 'accessPolicy')
      ? { accessPolicy: normalizeAccessPolicy(value.accessPolicy) }
      : {}),
    bot: {
      ...normalizeBotAlias(bot),
      name: optionalString(bot.name, 100) ?? '钉钉机器人',
      clientIdMasked: optionalString(bot.clientIdMasked, 140) ?? '已安全保存',
    },
    health: {
      status: HEALTH_STATES.has(health.status)
        ? health.status
        : connected ? 'healthy' : 'offline',
      summary: optionalString(health.summary, 200)
        ?? (connected ? '钉钉 Stream 长连接运行正常' : '钉钉连接尚未就绪'),
      lastCheckedAt: timestamp(health.lastCheckedAt),
      lastConnectedAt: timestamp(health.lastConnectedAt),
    },
    stats: {
      messagesReceived: nonNegativeInteger(stats.messagesReceived),
      messagesReplied: nonNegativeInteger(stats.messagesReplied),
    },
    lastMessageError: normalizeLastMessageError(value.lastMessageError),
    error: normalizeError(value.error, 'DINGTALK_ACCOUNT_ERROR', '钉钉连接尚未就绪') ?? null,
  };
}

export function normalizeSnapshot(value) {
  const source = isRecord(value?.snapshot) ? value.snapshot : value;
  if (!isRecord(source) || !Array.isArray(source.bots)) {
    throw new Error('钉钉服务没有返回有效的机器人列表');
  }
  const seen = new Set();
  const bots = source.bots.map(normalizeBot).filter((bot) => {
    if (!bot || seen.has(bot.botId)) return false;
    seen.add(bot.botId);
    return true;
  });
  return {
    schemaVersion: Number.isSafeInteger(source.schemaVersion) ? source.schemaVersion : 1,
    revision: nonNegativeInteger(source.revision),
    state: SNAPSHOT_STATES.has(source.state) ? source.state : 'offline',
    bots,
    totals: {
      configured: bots.length,
      connected: bots.filter((bot) => bot.connected).length,
    },
    provisioning: source.provisioning ? normalizeProvisioning(source.provisioning) : null,
    testMessage: normalizeTestMessage(source.testMessage),
    agentPresetCatalog: normalizeAgentPresetCatalog(source.agentPresetCatalog),
    modelCatalog: normalizeModelCatalog(source.modelCatalog),
  };
}

export function connectionTestFeedback(result) {
  if (result?.sent === true) return '钉钉连接检查完成，测试消息已发送。';
  if (result?.code === 'test-target-unavailable') {
    return '连接检查完成。机器人尚未收到可用于测试的私聊消息。';
  }
  return result ? '钉钉连接检查完成，但测试消息发送失败。' : null;
}

export function presentError(error) {
  return normalizeError(
    error,
    'DINGTALK_ERROR',
    '钉钉操作失败，请稍后重试',
  ) ?? { code: 'DINGTALK_ERROR', message: '钉钉操作失败，请稍后重试' };
}

export function formatRemaining(milliseconds) {
  const seconds = Math.max(0, Math.ceil(Number(milliseconds) / 1_000) || 0);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
