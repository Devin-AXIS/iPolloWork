import { normalizeBusyMessageMode } from '../../../../src/channels/shared/message-mode.mjs';
import { normalizeConnectionError as normalizeTestError } from '../../connection-error.js';
import { normalizeWeixinDiagnosticDetails } from '../../../../src/channels/weixin/diagnostic-details.mjs';
import { normalizeBotAlias } from '../../../../src/channels/shared/bot-alias.mjs';
import { normalizeAgentPresetCatalog, normalizeAgentPresetId, SET_AGENT_PRESET_ENDPOINT } from '../../agent-preset.js';
import { normalizeModelCatalog, normalizeModelSelection, SET_MODEL_ENDPOINT } from '../../model-setting.js';
import { normalizeLastMessageError } from '../../last-message-error.js';
import { normalizeAccessPolicy } from '../../../../src/channels/shared/access-policy.mjs';
import { normalizeContextEnhancementConfig } from '../../../../src/channels/shared/context-enhancement.mjs';

export const WEIXIN_RPC_CHANNEL = '/weixin';
export const WEIXIN_ENDPOINTS = Object.freeze({
  status: 'connection.status',
  beginProvisioning: 'provision.begin',
  pollProvisioning: 'provision.poll',
  submitVerification: 'provision.verify',
  cancelProvisioning: 'provision.cancel',
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
const PROVISION_STATES = new Set([
  'starting',
  'pending',
  'scanned',
  'needs_verification',
  'connecting',
  'connected',
  'expired',
  'failed',
  'cancelled',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function string(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function timestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

export function normalizeConnectionError(value, fallbackCode = 'WEIXIN_ERROR', fallbackMessage = '微信操作失败，请稍后重试') {
  const details = normalizeWeixinDiagnosticDetails(value?.details);
  return {
    code: string(value?.code, fallbackCode).slice(0, 100),
    message: string(value?.message, fallbackMessage).slice(0, 500),
    ...(Object.keys(details).length ? { details } : {}),
  };
}

export function managementRequestError(cause, operation) {
  if (cause?.name === 'AbortError') return cause;
  const error = new Error('无法完成微信管理请求，请检查 DSH 连接后重新读取状态。');
  error.code = 'weixin-management-unreachable';
  error.details = normalizeWeixinDiagnosticDetails({ operation, stage: 'management.request', occurredAt: new Date().toISOString() });
  return error;
}

function invalidResponse() {
  const error = new Error('DSH 微信管理接口返回了无法识别的响应，请重新读取状态。');
  error.code = 'weixin-management-invalid-response';
  error.details = { stage: 'management.request', occurredAt: new Date().toISOString() };
  return error;
}

export function unwrapRpcResult(result) {
  if (!isRecord(result) || typeof result.ok !== 'boolean') {
    throw invalidResponse();
  }
  if (!result.ok) {
    if (!isRecord(result.error)) throw invalidResponse();
    const visible = normalizeConnectionError(result.error, 'WEIXIN_RPC_ERROR', '微信操作失败');
    const error = Object.assign(new Error(visible.message), visible);
    throw error;
  }
  return result.value;
}

export function safeQrSource(value) {
  return typeof value === 'string'
    && /^data:image\/(?:png|webp|svg\+xml)(?:;charset=[^;,]+)?;base64,/i.test(value)
    ? value
    : undefined;
}

export function safeVerificationUrl(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && (host === 'weixin.qq.com' || host.endsWith('.weixin.qq.com')
        || host === 'wechat.com' || host.endsWith('.wechat.com'))
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeProvisioning(value) {
  if (!isRecord(value) || !string(value.attemptId)) {
    throw invalidResponse();
  }
  const status = PROVISION_STATES.has(value.status) ? value.status : 'failed';
  const result = {
    attemptId: string(value.attemptId),
    status,
    expiresAt: timestamp(value.expiresAt) ?? Date.now(),
    pollIntervalMs: Math.min(5_000, Math.max(500, Number(value.pollIntervalMs) || 1_000)),
    verificationRequired: value.verificationRequired === true || status === 'needs_verification',
  };
  const verificationUrl = safeVerificationUrl(value.verificationUrl);
  const qrCodeDataUrl = safeQrSource(value.qrCodeDataUrl);
  if (verificationUrl) result.verificationUrl = verificationUrl;
  if (qrCodeDataUrl) result.qrCodeDataUrl = qrCodeDataUrl;
  if (string(value.botId)) result.botId = string(value.botId);
  if (value.alreadyConnected === true) result.alreadyConnected = true;
  if (isRecord(value.error)) {
    result.error = normalizeConnectionError(value.error, 'WEIXIN_PROVISION_FAILED', '微信绑定没有完成');
  }
  return result;
}

function normalizeBot(value) {
  if (!isRecord(value) || !string(value.botId) || !isRecord(value.bot)) return null;
  const state = ACCOUNT_STATES.has(value.state) ? value.state : 'error';
  const connected = value.connected === true;
  return {
    botId: string(value.botId),
    state: connected ? 'connected' : state,
    connected,
    configured: value.configured === true,
    workspace: string(value.workspace).slice(0, 4_096),
    model: normalizeModelSelection(value.model),
    agentPreset: normalizeAgentPresetId(value.agentPreset),
    busyMessageMode: normalizeBusyMessageMode(value.busyMessageMode),    contextEnhancement: normalizeContextEnhancementConfig(value.contextEnhancement),
    ...(Object.hasOwn(value, 'accessPolicy')
      ? { accessPolicy: normalizeAccessPolicy(value.accessPolicy) }
      : {}),
    bot: {
      ...normalizeBotAlias(value.bot),
      name: string(value.bot.name, '微信机器人'),
      accountIdMasked: string(value.bot.accountIdMasked, '已安全保存'),
    },
    health: {
      status: string(value.health?.status, connected ? 'healthy' : 'offline'),
      summary: string(value.health?.summary, connected ? '微信连接正常' : '微信连接未就绪'),
      lastCheckedAt: timestamp(value.health?.lastCheckedAt),
    },
    stats: {
      messagesReceived: Math.max(0, Number(value.stats?.messagesReceived) || 0),
      messagesReplied: Math.max(0, Number(value.stats?.messagesReplied) || 0),
    },
    lastMessageError: normalizeLastMessageError(value.lastMessageError),
    error: isRecord(value.error)
      ? normalizeConnectionError(value.error, 'WEIXIN_ACCOUNT_ERROR', '微信连接未就绪')
      : null,
  };
}

export function normalizeSnapshot(value) {
  if (!isRecord(value) || !Array.isArray(value.bots)) {
    throw invalidResponse();
  }
  const bots = value.bots.map(normalizeBot).filter(Boolean);
  return {
    schemaVersion: Number(value.schemaVersion) || 1,
    revision: Number(value.revision) || 0,
    state: string(value.state, 'offline'),
    bots,
    totals: {
      configured: bots.length,
      connected: bots.filter((bot) => bot.connected).length,
    },
    provisioning: value.provisioning ? normalizeProvisioning(value.provisioning) : null,
    testMessage: normalizeTestMessage(value.testMessage),
    warnings: Array.isArray(value.warnings) ? value.warnings.filter(isRecord).slice(0, 8).map(error => normalizeConnectionError(error)) : [],
    agentPresetCatalog: normalizeAgentPresetCatalog(value.agentPresetCatalog),
    modelCatalog: normalizeModelCatalog(value.modelCatalog),
  };
}

export function presentError(error) {
  return normalizeConnectionError(error);
}

export function formatRemaining(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
