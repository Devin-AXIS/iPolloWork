import { SET_MESSAGE_MODE_ENDPOINT, validMessageModePayload, normalizeBusyMessageMode } from '../../../../src/channels/shared/message-mode.mjs';
import { diagnosticFields } from '../../../../src/channels/shared/diagnostic-details.mjs';
import { createConnectionDiagnostics, diagnosticRpcResult } from '../../../../src/channels/shared/connection-error.mjs';
import { normalizeBotAlias } from '../../../../src/channels/shared/bot-alias.mjs';
import { SET_ALIAS_ENDPOINT, validAliasPayload } from '../shared/bot-alias-rpc.mjs';
import { registerManagementRpc } from '../../../management-rpc.mjs';
import QRCode from '../../../../src/channels/shared/qrcode.mjs';
import { qrEncodingError } from '../../../../src/channels/shared/qr-encoding-error.mjs';
import {
  normalizeAgentPresetCatalog,
  normalizeAgentPresetId,
} from '../../../../src/channels/shared/agent-preset.mjs';
import { publicConnectionTestResult } from '../../../../src/channels/shared/connection-test.mjs';
import { publicMessageFailure } from '../../../../src/channels/shared/message-failure.mjs';
import {
  normalizeModelCatalog,
  normalizeModelSelection,
} from '../../../../src/channels/shared/model-setting.mjs';
import { normalizeAccessPolicy } from '../../../../src/channels/shared/access-policy.mjs';
import { normalizeConversationDirectory, validateConversationDirectory } from '../../../../src/channels/shared/conversation-directory.mjs';
import { resolveRpcAuthority } from '../../rpc-authority.mjs';
import { publicWorkspaceError, validWorkspacePayload } from '../shared/workspace-rpc.mjs';
import { validAgentPresetPayload } from '../shared/agent-preset-rpc.mjs';
import { validModelPayload } from '../shared/model-setting-rpc.mjs';
import { validContextEnhancementPayload } from '../shared/context-enhancement-rpc.mjs';
import { SET_ACCESS_POLICY_ENDPOINT, validAccessPolicyPayload } from '../shared/access-policy-rpc.mjs';
import { normalizeContextEnhancementConfig } from '../../../../src/channels/shared/context-enhancement.mjs';
import {
  isFeishuGroupResponseMode,
  normalizeFeishuGroupResponseMode,
} from '../../../../src/channels/feishu/group-response-mode.mjs';
import {
  isFeishuStepPushMode,
  normalizeFeishuStepPushMode,
  isFeishuStepCardPanels,
  normalizeFeishuStepCardPanels,
} from '../../../../src/channels/feishu/step-push-mode.mjs';
import { normalizeFeishuVoiceConfig } from '../../../../src/channels/feishu/voice-config.mjs';
import {
  isSlashPanelConfig,
  normalizeSlashPanelConfig,
} from '../../../../src/channels/feishu/slash-command-panel.mjs';
import {
  FEISHU_ENDPOINTS as FEISHU_CLIENT_ENDPOINTS,
  FEISHU_RPC_CHANNEL,
} from '../../../client/channels/feishu/api.js';

export const FEISHU_ENDPOINTS = Object.freeze({
  ...FEISHU_CLIENT_ENDPOINTS,
  setBusyMessageMode: SET_MESSAGE_MODE_ENDPOINT,
  setAccessPolicy: SET_ACCESS_POLICY_ENDPOINT,
  setAlias: SET_ALIAS_ENDPOINT,
  setConversationDirectory: FEISHU_CLIENT_ENDPOINTS.setConversationDirectory,
  setConversationDirectoryDefault: FEISHU_CLIENT_ENDPOINTS.setConversationDirectoryDefault,
});
export { FEISHU_RPC_CHANNEL };
export const FEISHU_MULTI_ENDPOINTS = Object.freeze({
  reconnectBot: 'bot.reconnect',
  disconnectBot: 'bot.disconnect',
  deleteBot: 'bot.delete',
});
export const FEISHU_RPC_ENDPOINTS = Object.freeze([
  ...new Set([...Object.values(FEISHU_ENDPOINTS), ...Object.values(FEISHU_MULTI_ENDPOINTS)]),
]);

const REGISTRATION_STATES = new Set([
  'idle', 'starting', 'qr_ready', 'polling', 'slow_down',
  'domain_switched', 'saving', 'succeeded', 'expired', 'cancelled', 'error',
]);
const REGISTRATION_OPERATIONS = new Set([
  'provision',
  'callback_repair',
  'group_message_permission',
]);
const CALLBACK_REPAIR_OPERATION = 'callback_repair';
const GROUP_MESSAGE_PERMISSION_OPERATION = 'group_message_permission';
const TARGETED_APP_UPDATE_OPERATIONS = new Set([
  CALLBACK_REPAIR_OPERATION,
  GROUP_MESSAGE_PERMISSION_OPERATION,
]);
const OFFICIAL_REGISTRATION_HOSTS = new Set([
  'accounts.feishu.cn',
  'accounts.larksuite.com',
  'open.feishu.cn',
  'open.larksuite.com',
]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_FEISHU_APP_ID = /^cli_[A-Za-z0-9_-]+$/;

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  abort: 'Registration was cancelled.',
  access_denied: 'Registration was denied.',
  expired_token: 'The registration QR code expired.',
  invalid_credentials: 'Feishu returned invalid app credentials.',
  credentials_callback_failed: 'Unable to activate the Feishu connection.',
  registration_failed: 'Unable to register the Feishu app.',
  connection_failed: 'The bot was created, but its connection could not be started.',
  credential_removal_failed: 'Unable to remove the Feishu credentials.',
  state_cleanup_failed: 'Unable to remove the bot session data. Please retry.',
  deletion_pending: 'Bot deletion is incomplete. Retry removal to finish cleanup.',
  missing_credentials: 'The bot credentials are missing. Delete it and scan again.',
  repair_app_mismatch: 'The authorized Feishu app does not match the selected bot.',
  repair_owner_missing: 'Feishu did not return the authorizing account identity.',
  repair_domain_mismatch: 'The authorized Feishu tenant does not match the selected bot.',
  repair_owner_mismatch: 'The authorizing Feishu account is not an owner of the selected bot.',
  repair_credentials_invalid: 'Feishu returned credentials that could not be verified for the selected bot.',
  repair_bot_mismatch: 'The verified Feishu bot does not match the selected bot.',
  repair_target_changed: 'The selected bot changed while repair was in progress. Start the repair again.',
  credential_update_failed: 'Unable to store the repaired Feishu credentials.',
  credential_state_unknown: 'The repaired Feishu credentials could not be confirmed after saving.',
  repair_connection_failed: 'The callback update was accepted, but the selected bot could not reconnect.',
  repair_permissions_save_failed: 'Feishu granted the permissions, but their local state could not be saved. Please retry.',
  group_message_permission_required: 'Authorize access to all group messages before enabling this mode.',
  group_message_permission_save_failed: 'Feishu granted the permission, but all-message mode could not be saved.',
  group_message_permission_connection_failed: 'Feishu granted the permission, but the selected bot could not reconnect.',
  card_action_probe_unavailable: 'The selected bot is not connected, so its card button cannot be verified.',
  card_action_probe_send_failed: 'The callback update was accepted, but the verification card could not be sent.',
  card_action_probe_timeout: 'Feishu accepted the update, but the card button was not verified in time. Start the repair again and click the test button within two minutes.',
  card_action_probe_failed: 'Feishu accepted the update, but the card button verification failed.',
});

const POLL_STATUS_BY_REGISTRATION = Object.freeze({
  idle: 'pending', starting: 'pending', qr_ready: 'pending', polling: 'pending',
  slow_down: 'pending', domain_switched: 'pending', saving: 'connecting',
  succeeded: 'connected', expired: 'expired', cancelled: 'failed', error: 'failed',
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value, allowed) {
  return isPlainObject(value)
    && Reflect.ownKeys(value).every((key) => typeof key === 'string' && allowed.has(key));
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : undefined;
}

function safeOpaqueId(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function validCredential(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function publicError(error) {
  if (!error || typeof error !== 'object') return null;
  const code = typeof error.code === 'string' && Object.hasOwn(PUBLIC_ERROR_MESSAGES, error.code)
    ? error.code
    : 'registration_failed';
  return { code, message: PUBLIC_ERROR_MESSAGES[code], ...diagnosticFields(error) };
}

function publicRegistration(registration) {
  if (!registration || typeof registration !== 'object') return { state: 'idle', attempt: 0 };
  const state = REGISTRATION_STATES.has(registration.state) ? registration.state : 'error';
  const attempt = safeOpaqueId(registration.attempt)
    ? registration.attempt
    : (finiteNumber(registration.attempt) ?? 0);
  const result = { state, attempt };
  result.operation = REGISTRATION_OPERATIONS.has(registration.operation)
    ? registration.operation
    : 'provision';
  const updatedAt = finiteNumber(registration.updatedAt);
  const expiresAt = finiteNumber(registration.expiresAt);
  const remainingSeconds = finiteNumber(registration.remainingSeconds);
  const pollIntervalSeconds = finiteNumber(registration.pollIntervalSeconds);
  if (updatedAt !== undefined) result.updatedAt = updatedAt;
  if (typeof registration.qrCodeUrl === 'string' && registration.qrCodeUrl.length > 0) {
    result.qrCodeUrl = registration.qrCodeUrl;
  }
  if (expiresAt !== undefined) result.expiresAt = expiresAt;
  if (remainingSeconds !== undefined) result.remainingSeconds = remainingSeconds;
  if (pollIntervalSeconds !== undefined) result.pollIntervalSeconds = pollIntervalSeconds;
  if (safeOpaqueId(registration.botId)) result.botId = registration.botId;
  const error = publicError(registration.error);
  if (error) result.error = error;
  return result;
}

function safeRegistrationUrl(value, operation, expectedHost) {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:'
      || !OFFICIAL_REGISTRATION_HOSTS.has(url.hostname)
      || url.port
      || url.username
      || url.password) return undefined;
    if (TARGETED_APP_UPDATE_OPERATIONS.has(operation)) {
      const clientIds = url.searchParams.getAll('clientID');
      const transportKinds = url.searchParams.getAll('tp');
      const addons = url.searchParams.getAll('addons');
      const hasPlaceholder = [...url.searchParams.values()].some((item) => (
        item.includes('{{') || item.includes('}}')
      ));
      if (clientIds.length !== 1
        || transportKinds.length !== 1
        || transportKinds[0] !== 'sdk'
        || !SAFE_FEISHU_APP_ID.test(clientIds[0] ?? '')
        || url.hostname !== expectedHost
        || url.searchParams.has('createOnly')
        || addons.length !== 1
        || !addons[0]?.trim()
        || hasPlaceholder) {
        return undefined;
      }
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function connectionFacts(connection) {
  const source = connection && typeof connection === 'object' ? connection : {};
  const connected = source.connected === true
    || (source.ready === true
      && source.feishuLongConnectionState === 'connected'
      && source.harnessReachable === true);
  return {
    connected,
    ready: source.ready === true,
    harnessReachable: source.harnessReachable === true,
  };
}

function publicBot(bot) {
  const source = bot && typeof bot === 'object' ? bot : {};
  const result = {
    ...normalizeBotAlias(source),
    name: typeof source.name === 'string' && source.name.length > 0 ? source.name : '飞书机器人',
  };
  if (typeof source.avatarUrl === 'string') result.avatarUrl = source.avatarUrl;
  if (typeof source.appIdMasked === 'string') result.appIdMasked = source.appIdMasked;
  if (typeof source.tenantName === 'string') result.tenantName = source.tenantName;
  if (source.domain === 'feishu' || source.domain === 'lark') result.domain = source.domain;
  if (typeof source.activated === 'boolean' || typeof source.activated === 'number') {
    result.activated = source.activated;
  }
  return result;
}

function publicHealth(status, connected) {
  if (connected) return { status: 'healthy', summary: '长连接运行正常', lastCheckedAt: Date.now() };
  if (status?.configured === true) {
    return { status: 'offline', summary: '机器人尚未连接', lastCheckedAt: Date.now() };
  }
  return { status: 'offline', summary: '尚未接入飞书机器人', lastCheckedAt: Date.now() };
}

function connectionState(status, registration, connected) {
  if (connected) return 'connected';
  if (status?.phase === 'error' || registration.state === 'error') return 'error';
  if (status?.phase === 'connecting' || registration.state === 'saving') return 'connecting';
  if (status?.phase === 'registering'
    || ['starting', 'qr_ready', 'polling', 'slow_down', 'domain_switched'].includes(registration.state)) {
    return 'provisioning';
  }
  return 'disconnected';
}

async function qrCodeDataUrl(verificationUrl) {
  return QRCode.toDataURL(verificationUrl, {
    errorCorrectionLevel: 'M', margin: 1, width: 320, type: 'image/png',
  });
}

async function publicProvisioning(registration, encodeQr, expectedHost) {
  const verificationUrl = safeRegistrationUrl(
    registration.qrCodeUrl,
    registration.operation,
    expectedHost,
  );
  const projection = {
    attemptId: String(registration.attempt),
    operation: registration.operation,
    ...(registration.botId ? { botId: registration.botId } : {}),
    expiresAt: registration.expiresAt ?? Date.now() + (5 * 60_000),
    pollIntervalMs: Math.max(800, Math.min(10_000, (registration.pollIntervalSeconds ?? 1.8) * 1000)),
  };
  if (verificationUrl) {
    return {
      ...projection,
      verificationUrl,
      qrCodeDataUrl: await encodeQr(verificationUrl),
    };
  }
  // RegistrationManager deliberately removes the device URL as soon as the
  // remote update is committed. Keep only the opaque attempt identity so a
  // browser reload can resume polling the non-cancellable verification phase.
  if (registration.state === 'saving'
    && TARGETED_APP_UPDATE_OPERATIONS.has(registration.operation)
    && registration.botId) {
    return { ...projection, submitted: true };
  }
  return undefined;
}

function publicBotEntry(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  if (!safeOpaqueId(source.botId)) return null;
  const facts = connectionFacts(source.connection);
  const connected = source.connected === true || facts.connected;
  const registration = { state: 'idle' };
  const result = {
    botId: source.botId,
    state: connectionState(source, registration, connected),
    connected,
    configured: source.configured === true,
    model: normalizeModelSelection(source.model),
    agentPreset: normalizeAgentPresetId(source.agentPreset),
    contextEnhancement: normalizeContextEnhancementConfig(source.contextEnhancement),
    busyMessageMode: normalizeBusyMessageMode(source.busyMessageMode),
    accessPolicy: normalizeAccessPolicy(source.accessPolicy),
    conversationDirectory: normalizeConversationDirectory(source.conversationDirectory),
    conversationDirectoryOverride: normalizeConversationDirectory(source.conversationDirectoryOverride),
    groupResponseMode: normalizeFeishuGroupResponseMode(source.groupResponseMode),
    mentionTopicReply: source.mentionTopicReply !== false,
    stepPush: source.stepPush === true,
    stepPushMode: normalizeFeishuStepPushMode(source.stepPushMode),
    stepCardPanels: normalizeFeishuStepCardPanels(source.stepCardPanels),
    voice: normalizeFeishuVoiceConfig(source.voice),
    slashPanel: normalizeSlashPanelConfig(source.slashPanel),
    groupMessagePermissionGranted: source.groupMessagePermissionGranted === true,
    bot: publicBot(source.bot),
    health: publicHealth(source, connected),
  };
  if (typeof source.workspace === 'string' && source.workspace) result.workspace = source.workspace;
  const lastMessageError = publicMessageFailure(source.lastMessageError);
  if (lastMessageError) result.lastMessageError = lastMessageError;
  const error = publicError(source.error);
  if (error) result.error = error;
  return result;
}

/** Exact redacted browser contract consumed by the Feishu settings client. */
export async function toPublicFeishuStatus(status, { encodeQr = qrCodeDataUrl } = {}) {
  const source = status && typeof status === 'object' ? status : {};
  const registration = publicRegistration(source.registration);
  const facts = connectionFacts(source.connection);
  const connected = source.connected === true || facts.connected;
  const appUpdateTarget = TARGETED_APP_UPDATE_OPERATIONS.has(registration.operation)
    && registration.botId
    && Array.isArray(source.bots)
    ? source.bots.find((entry) => entry?.botId === registration.botId)
    : undefined;
  const expectedRegistrationHost = appUpdateTarget?.bot?.domain === 'lark'
    ? 'open.larksuite.com'
    : 'open.feishu.cn';
  const provisioning = await publicProvisioning(
    registration,
    encodeQr,
    expectedRegistrationHost,
  );
  const error = publicError(source.error) ?? registration.error ?? null;
  const bots = Array.isArray(source.bots)
    ? source.bots.map(publicBotEntry).filter(Boolean)
    : [];
  const snapshot = {
    schemaVersion: source.schemaVersion === 2 ? 2 : 1,
    revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    state: connectionState(source, registration, connected),
    connected,
    configured: source.configured === true,
    bot: publicBot(source.bot),
    health: publicHealth(source, connected),
    bots,
    conversationDirectory: normalizeConversationDirectory(source.conversationDirectory),
    agentPresetCatalog: normalizeAgentPresetCatalog(source.agentPresetCatalog),
    modelCatalog: normalizeModelCatalog(source.modelCatalog),
    totals: {
      configured: bots.length || (source.configured === true ? 1 : 0),
      connected: bots.length ? bots.filter((bot) => bot.connected).length : (connected ? 1 : 0),
    },
  };
  if (provisioning) snapshot.provisioning = provisioning;
  if (error) snapshot.error = error;
  return snapshot;
}

function badRequest(message) {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } };
}

function cancelled() {
  return { ok: false, error: { code: 'cancelled', message: 'The Feishu request was cancelled.', details: {} } };
}

function internalFailure() {
  return { ok: false, error: { code: 'internal', message: 'The Feishu integration operation failed.', details: {} } };
}

function validPayload(endpoint, payload) {
  if (endpoint === FEISHU_ENDPOINTS.status) {
    return hasOnlyKeys(payload, new Set()) ? null : 'This endpoint accepts an empty payload only.';
  }
  if (endpoint === FEISHU_ENDPOINTS.testConnection) {
    return hasOnlyKeys(payload, new Set()) ? null : 'This endpoint accepts an empty payload only.';
  }
  if (endpoint === FEISHU_ENDPOINTS.beginProvisioning) {
    if (!hasOnlyKeys(payload, new Set(['locale', 'replaceAttemptId']))) {
      return 'Provisioning accepts locale and replaceAttemptId only.';
    }
    if (payload.locale !== undefined && payload.locale !== 'zh-CN') return 'The provisioning locale must be zh-CN.';
    if (payload.replaceAttemptId !== undefined && !safeOpaqueId(payload.replaceAttemptId)) {
      return 'replaceAttemptId must be a valid opaque id.';
    }
    return null;
  }
  if (endpoint === FEISHU_ENDPOINTS.beginCallbackRepair) {
    return hasOnlyKeys(payload, new Set(['botId'])) && safeOpaqueId(payload.botId)
      ? null
      : 'Callback repair requires a single valid botId.';
  }
  if (endpoint === FEISHU_ENDPOINTS.beginGroupMessagePermission) {
    return hasOnlyKeys(payload, new Set(['botId', 'preserveResponseMode'])) && safeOpaqueId(payload.botId)
      && (payload.preserveResponseMode === undefined || typeof payload.preserveResponseMode === 'boolean')
      ? null : 'Group message permission update requires a valid botId and optional preserveResponseMode.';
  }
  if (endpoint === FEISHU_ENDPOINTS.bindCredentials) {
    return hasOnlyKeys(payload, new Set(['appId', 'appSecret', 'domain']))
      && validCredential(payload.appId, 256)
      && validCredential(payload.appSecret, 1024)
      && (payload.domain === undefined || payload.domain === 'feishu' || payload.domain === 'lark')
      ? null
      : 'Credential binding requires App ID and App Secret.';
  }
  if (endpoint === FEISHU_ENDPOINTS.pollProvisioning
    || endpoint === FEISHU_ENDPOINTS.cancelProvisioning) {
    return hasOnlyKeys(payload, new Set(['attemptId'])) && safeOpaqueId(payload.attemptId)
      ? null
      : 'A single valid attemptId is required.';
  }
  if (endpoint === FEISHU_ENDPOINTS.disconnect) {
    return hasOnlyKeys(payload, new Set(['removeCredentials'])) && payload.removeCredentials === true
      ? null
      : 'Disconnect requires removeCredentials=true.';
  }
  if (endpoint === FEISHU_MULTI_ENDPOINTS.reconnectBot) {
    return hasOnlyKeys(payload, new Set(['botId', 'sendTest']))
      && safeOpaqueId(payload.botId)
      && (payload.sendTest === undefined || typeof payload.sendTest === 'boolean')
      ? null
      : 'A valid botId and optional sendTest flag are required.';
  }
  if (endpoint === FEISHU_MULTI_ENDPOINTS.disconnectBot) {
    return hasOnlyKeys(payload, new Set(['botId'])) && safeOpaqueId(payload.botId)
      ? null
      : 'A single valid botId is required.';
  }
  if (endpoint === FEISHU_MULTI_ENDPOINTS.deleteBot) {
    return hasOnlyKeys(payload, new Set(['botId', 'confirm']))
      && safeOpaqueId(payload.botId) && payload.confirm === true
      ? null
      : 'Deleting a bot requires a valid botId and confirm=true.';
  }
  if (endpoint === FEISHU_ENDPOINTS.setWorkspace) {
    return validWorkspacePayload(payload)
      ? null : '请输入工作区绝对路径。';
  }
  if (endpoint === FEISHU_ENDPOINTS.setConversationDirectory
    || endpoint === FEISHU_ENDPOINTS.setConversationDirectoryDefault) {
    const isDefault = endpoint === FEISHU_ENDPOINTS.setConversationDirectoryDefault;
    const allowed = isDefault ? new Set(['config']) : new Set(['botId', 'config']);
    if (!hasOnlyKeys(payload, allowed) || (!isDefault && !safeOpaqueId(payload.botId))) {
      return '请提交有效的会话目录设置。';
    }
    if (payload.config !== null) {
      try { validateConversationDirectory(payload.config); } catch (error) { return error.message; }
    }
    return null;
  }
  if (endpoint === FEISHU_ENDPOINTS.setModel) {
    return validModelPayload(payload) ? null : '请选择有效模型。';
  }
  if (endpoint === FEISHU_ENDPOINTS.setAgentPreset) {
    return validAgentPresetPayload(payload)
      ? null : '请选择 Agent Preset。';
  }
  if (endpoint === FEISHU_ENDPOINTS.setBusyMessageMode) {
    return validMessageModePayload(payload)
      ? null : '请提交有效的消息处理方式。';
  }
  if (endpoint === FEISHU_ENDPOINTS.setContextEnhancement) {
    return validContextEnhancementPayload(payload)
      ? null : '请提交有效的上下文增强设置。';
  }
  if (endpoint === FEISHU_ENDPOINTS.setAccessPolicy) {
    return validAccessPolicyPayload(payload)
      ? null : '请提交有效的访问设置。';
  }
  if (endpoint === FEISHU_ENDPOINTS.setAlias) {
    return validAliasPayload(payload)
      ? null : '请输入有效的别名（最多 80 个字符）。';
  }
  if (endpoint === FEISHU_ENDPOINTS.setGroupResponseMode) {
    return hasOnlyKeys(payload, new Set(['botId', 'groupResponseMode']))
      && safeOpaqueId(payload.botId)
      && isFeishuGroupResponseMode(payload.groupResponseMode)
      ? null
      : '请选择群聊响应方式。';
  }
  if (endpoint === FEISHU_ENDPOINTS.setMentionTopicReply) {
    return hasOnlyKeys(payload, new Set(['botId', 'mentionTopicReply']))
      && safeOpaqueId(payload.botId)
      && typeof payload.mentionTopicReply === 'boolean'
      ? null
      : '请选择是否以话题方式回复。';
  }
  if (endpoint === FEISHU_ENDPOINTS.setStepPush) {
    return hasOnlyKeys(payload, new Set(['botId', 'stepPush']))
      && safeOpaqueId(payload.botId)
      && typeof payload.stepPush === 'boolean'
      ? null
      : '请选择是否分步直推。';
  }
  if (endpoint === FEISHU_ENDPOINTS.setStepPushMode) {
    return hasOnlyKeys(payload, new Set(['botId', 'stepPushMode']))
      && safeOpaqueId(payload.botId)
      && isFeishuStepPushMode(payload.stepPushMode)
      ? null
      : '请选择分步直推的呈现方式。';
  }
  if (endpoint === FEISHU_ENDPOINTS.setStepCardPanels) {
    return hasOnlyKeys(payload, new Set(['botId', 'stepCardPanels']))
      && safeOpaqueId(payload.botId)
      && isFeishuStepCardPanels(payload.stepCardPanels)
      ? null
      : '请选择实时过程卡面板的展开状态。';
  }
  if (endpoint === FEISHU_ENDPOINTS.setVoice) {
    const voice = payload?.voice;
    const validVoice = voice === null
      || (typeof voice === 'object' && !Array.isArray(voice)
        && (voice.enabled === false || normalizeFeishuVoiceConfig(voice) !== null));
    return hasOnlyKeys(payload, new Set(['botId', 'voice']))
      && safeOpaqueId(payload.botId)
      && validVoice
      ? null
      : '语音配置无效。';
  }
  if (endpoint === FEISHU_ENDPOINTS.setSlashPanel) {
    return hasOnlyKeys(payload, new Set(['botId', 'slashPanel']))
      && safeOpaqueId(payload.botId)
      && isSlashPanelConfig(payload.slashPanel)
      ? null
      : '请选择面板要显示的指令与顺序。';
  }
  return 'Unknown Feishu endpoint.';
}

function abortableDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const timer = setTimeout(done, milliseconds);
    timer.unref?.();
    function done() {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('aborted'));
    }
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

async function statusForRegistration(controller, attemptId) {
  if (typeof controller.registrationStatus === 'function') {
    return controller.registrationStatus(attemptId);
  }
  return controller.status();
}

async function waitForQr(controller, initial, attemptId, signal) {
  let current = initial;
  const deadline = Date.now() + 15_000;
  for (;;) {
    const registration = publicRegistration(current?.registration);
    if (registration.qrCodeUrl) return current;
    if (['error', 'expired', 'cancelled'].includes(registration.state)) {
      throw new Error('Provisioning stopped before the QR code was ready.');
    }
    if (Date.now() >= deadline) throw new Error('Provisioning QR code timed out.');
    await abortableDelay(50, signal);
    current = await statusForRegistration(controller, attemptId);
    if (!current) throw new Error('The provisioning attempt is no longer active.');
  }
}

function sameAttempt(status, attemptId) {
  return String(publicRegistration(status?.registration).attempt) === attemptId;
}

function pollStatus(status) {
  const registration = publicRegistration(status?.registration);
  if (registration.state === 'succeeded') {
    const connected = registration.botId
      && (status?.connected === true || connectionFacts(status?.connection).connected);
    return connected ? 'connected' : 'connecting';
  }
  return POLL_STATUS_BY_REGISTRATION[registration.state] ?? 'failed';
}

function assertController(controller) {
  if (!controller
    || typeof controller.status !== 'function'
    || typeof controller.startRegistration !== 'function'
    || typeof controller.cancelRegistration !== 'function'
    || typeof controller.disconnect !== 'function') {
    throw new TypeError('A Feishu controller with status/start/cancel/disconnect is required');
  }
}

/** DSH rc.6 handler: (endpoint, payload, signal) => Promise<RpcResult>. */
export function createFeishuRpcHandler(controller, { encodeQr = qrCodeDataUrl } = {}) {
  const diagnostics = controller.diagnostics ?? createConnectionDiagnostics({ channel: 'feishu' });
  assertController(controller);
  const qrCache = new Map();
  const attemptQr = new Map();
  const cachedEncodeQr = (url) => {
    let encoded = qrCache.get(url);
    if (!encoded) {
      if (qrCache.size >= 32) qrCache.delete(qrCache.keys().next().value);
      encoded = Promise.resolve().then(() => encodeQr(url)).catch(error => {
        if (qrCache.get(url) === encoded) qrCache.delete(url);
        throw qrEncodingError(error);
      });
      qrCache.set(url, encoded);
    }
    return encoded;
  };

  return async (endpoint, payload, signal) => {
    if (signal?.aborted) return cancelled();
    if (!FEISHU_RPC_ENDPOINTS.includes(endpoint)) return badRequest('Unknown Feishu endpoint.');
    const payloadFailure = validPayload(endpoint, payload);
    if (payloadFailure) return badRequest(payloadFailure);

    try {
      let value;
      if (endpoint === FEISHU_ENDPOINTS.status) {
        value = await toPublicFeishuStatus(await controller.status(), { encodeQr: cachedEncodeQr });
      } else if (endpoint === FEISHU_ENDPOINTS.beginProvisioning) {
        if (payload.replaceAttemptId) {
          await controller.cancelRegistration(payload.replaceAttemptId);
        }
        const started = await controller.startRegistration({ locale: payload.locale });
        const attemptId = String(publicRegistration(started?.registration).attempt);
        const ready = await waitForQr(controller, started, attemptId, signal);
        value = (await toPublicFeishuStatus(ready, { encodeQr: cachedEncodeQr })).provisioning;
        if (!value) throw new Error('Provisioning did not produce a QR code.');
        attemptQr.set(attemptId, value.verificationUrl);
      } else if (endpoint === FEISHU_ENDPOINTS.beginCallbackRepair) {
        if (typeof controller.startCallbackRepair !== 'function') {
          throw new Error('Feishu callback repair is unavailable.');
        }
        const started = await controller.startCallbackRepair(payload.botId);
        const attemptId = String(publicRegistration(started?.registration).attempt);
        const ready = await waitForQr(controller, started, attemptId, signal);
        value = (await toPublicFeishuStatus(ready, { encodeQr: cachedEncodeQr })).provisioning;
        if (!value
          || value.operation !== CALLBACK_REPAIR_OPERATION
          || value.botId !== payload.botId) {
          throw new Error('Callback repair did not produce a safe QR code.');
        }
        attemptQr.set(attemptId, value.verificationUrl);
      } else if (endpoint === FEISHU_ENDPOINTS.beginGroupMessagePermission) {
        if (typeof controller.startGroupMessagePermission !== 'function') {
          throw new Error('Feishu group message permission update is unavailable.');
        }
        const started = await controller.startGroupMessagePermission(payload.botId, { preserveResponseMode: payload.preserveResponseMode === true });
        const attemptId = String(publicRegistration(started?.registration).attempt);
        const ready = await waitForQr(controller, started, attemptId, signal);
        value = (await toPublicFeishuStatus(ready, { encodeQr: cachedEncodeQr })).provisioning;
        if (!value
          || value.operation !== GROUP_MESSAGE_PERMISSION_OPERATION
          || value.botId !== payload.botId) {
          throw new Error('Group message permission update did not produce a safe QR code.');
        }
        attemptQr.set(attemptId, value.verificationUrl);
      } else if (endpoint === FEISHU_ENDPOINTS.pollProvisioning) {
        const current = await statusForRegistration(controller, payload.attemptId);
        if (!current || !sameAttempt(current, payload.attemptId)) {
          return badRequest('The provisioning attempt is no longer active.');
        }
        const registration = publicRegistration(current.registration);
        const connection = await toPublicFeishuStatus(current, { encodeQr: cachedEncodeQr });
        value = {
          status: pollStatus(current),
          operation: registration.operation,
          ...(registration.botId ? { botId: registration.botId } : {}),
          ...(connection.provisioning ? { provisioning: connection.provisioning } : {}),
          ...(registration.botId && connection.connected ? { connection } : {}),
          ...(connection.error ? { message: connection.error.message } : {}),
        };
        if (['connected', 'expired', 'failed'].includes(value.status)) {
          const url = attemptQr.get(payload.attemptId);
          if (url) qrCache.delete(url);
          attemptQr.delete(payload.attemptId);
        }
      } else if (endpoint === FEISHU_ENDPOINTS.cancelProvisioning) {
        const current = await statusForRegistration(controller, payload.attemptId);
        if (!current || !sameAttempt(current, payload.attemptId)) {
          return badRequest('The provisioning attempt is no longer active.');
        }
        const multi = typeof controller.registrationStatus === 'function';
        const registration = publicRegistration(current.registration);
        let after;
        if (!multi && registration.state === 'saving') {
          after = await controller.disconnect();
        } else {
          after = await controller.cancelRegistration(payload.attemptId);
        }
        const afterRegistration = publicRegistration(after?.registration);
        if (TARGETED_APP_UPDATE_OPERATIONS.has(registration.operation)
          && registration.state === 'saving'
          && ['saving', 'succeeded'].includes(afterRegistration.state)) {
          value = {
            status: pollStatus(after),
            operation: afterRegistration.operation,
            ...(afterRegistration.botId ? { botId: afterRegistration.botId } : {}),
            message: registration.operation === GROUP_MESSAGE_PERMISSION_OPERATION
              ? 'The permission update was already submitted and is still being applied.'
              : 'Callback repair was already submitted and is still being verified.',
          };
        }
        if (value?.status !== 'connecting') {
          const url = attemptQr.get(payload.attemptId);
          if (url) qrCache.delete(url);
          attemptQr.delete(payload.attemptId);
          value ??= {
            status: 'failed',
            operation: registration.operation,
            ...(registration.botId ? { botId: registration.botId } : {}),
            message: 'Registration was cancelled.',
          };
        }
      } else if (endpoint === FEISHU_ENDPOINTS.bindCredentials) {
        if (typeof controller.bindCredentials !== 'function') {
          throw new Error('Credential binding is unavailable');
        }
        value = await toPublicFeishuStatus(
          await controller.bindCredentials(payload),
          { encodeQr: cachedEncodeQr },
        );
      } else if (endpoint === FEISHU_ENDPOINTS.testConnection) {
        const current = await controller.status();
        const alreadyConnected = current?.connected === true
          || connectionFacts(current?.connection).connected;
        const checked = alreadyConnected || typeof controller.reconnect !== 'function'
          ? current
          : await controller.reconnect();
        value = await toPublicFeishuStatus(checked, { encodeQr: cachedEncodeQr });
      } else if (endpoint === FEISHU_ENDPOINTS.disconnect) {
        value = await toPublicFeishuStatus(await controller.disconnect(), { encodeQr: cachedEncodeQr });
      } else if (endpoint === FEISHU_MULTI_ENDPOINTS.reconnectBot) {
        if (typeof controller.reconnectBot !== 'function') throw new Error('Multi-bot reconnect is unavailable');
        const checked = await controller.reconnectBot(payload.botId);
        if (signal?.aborted) return cancelled();
        value = await toPublicFeishuStatus(checked, { encodeQr: cachedEncodeQr });
        if (payload.sendTest === true) {
          let testError = null;
          const connected = checked?.bots?.some(
            (bot) => bot?.botId === payload.botId && bot.connected === true,
          ) === true;
          if (!connected) {
            testError = new Error('Feishu bot is not connected');
            testError.code = 'test-target-unavailable';
          } else {
            try {
              if (typeof controller.sendConnectionTest !== 'function') {
                const unavailable = new Error('Connection test is unavailable');
                unavailable.code = 'test-target-unavailable';
                throw unavailable;
              }
              await controller.sendConnectionTest(payload.botId);
            } catch (error) {
              testError = error;
            }
          }
          value = { ...value, testMessage: publicConnectionTestResult(testError, { diagnostics, botId: payload.botId }) };
        }
      } else if (endpoint === FEISHU_MULTI_ENDPOINTS.disconnectBot) {
        if (typeof controller.disconnectBot !== 'function') throw new Error('Multi-bot disconnect is unavailable');
        value = await toPublicFeishuStatus(await controller.disconnectBot(payload.botId), { encodeQr: cachedEncodeQr });
      } else if (endpoint === FEISHU_ENDPOINTS.setConversationDirectory
        || endpoint === FEISHU_ENDPOINTS.setConversationDirectoryDefault) {
        if (typeof controller.updateConversationDirectory !== 'function') throw new Error('Conversation directory update is unavailable');
        value = await toPublicFeishuStatus(await controller.updateConversationDirectory(
          endpoint === FEISHU_ENDPOINTS.setConversationDirectoryDefault ? null : payload.botId,
          payload.config,
        ), { encodeQr: cachedEncodeQr });
      } else if (endpoint === FEISHU_ENDPOINTS.setWorkspace) {
        if (typeof controller.updateWorkspace !== 'function') throw new Error('Workspace update is unavailable');
        value = await toPublicFeishuStatus(
          await controller.updateWorkspace(payload.botId, payload.workspace),
          { encodeQr: cachedEncodeQr },
        );
      } else if (endpoint === FEISHU_ENDPOINTS.setModel) {
        if (typeof controller.updateModel !== 'function') throw new Error('Model update is unavailable');
        value = await toPublicFeishuStatus(
          await controller.updateModel(payload.botId, payload.model),
          { encodeQr: cachedEncodeQr },
        );
      } else if (endpoint === FEISHU_ENDPOINTS.setBusyMessageMode) {
        if (typeof controller.updateBusyMessageMode !== 'function') throw new Error('Message mode update is unavailable');
        value = await controller.updateBusyMessageMode(
          payload.botId, payload.busyMessageMode,
          (status) => toPublicFeishuStatus(status, { encodeQr: cachedEncodeQr }),
        );
      } else if (endpoint === FEISHU_ENDPOINTS.setContextEnhancement) {
        if (typeof controller.updateContextEnhancement !== 'function') throw new Error('Context enhancement update is unavailable');
        value = await controller.updateContextEnhancement(
          payload.botId, payload.config,
          (status) => toPublicFeishuStatus(status, { encodeQr: cachedEncodeQr }),
        );
      } else if (endpoint === FEISHU_ENDPOINTS.setAlias) {
        if (typeof controller.updateAlias !== 'function') throw new Error('Alias update is unavailable');
        value = await controller.updateAlias(
          payload.botId, payload.alias,
          (status) => toPublicFeishuStatus(status, { encodeQr: cachedEncodeQr }),
        );
      } else if (endpoint === FEISHU_ENDPOINTS.setAccessPolicy) {
        if (typeof controller.updateAccessPolicy !== 'function') throw new Error('Access policy update is unavailable');
        value = await controller.updateAccessPolicy(
          payload.botId, payload.policy,
          (status) => toPublicFeishuStatus(status, { encodeQr: cachedEncodeQr }),
        );
      } else if (endpoint === FEISHU_ENDPOINTS.setAgentPreset) {
        if (typeof controller.updateAgentPreset !== 'function') throw new Error('Agent preset update is unavailable');
        value = await toPublicFeishuStatus(
          await controller.updateAgentPreset(payload.botId, payload.agentPreset),
          { encodeQr: cachedEncodeQr },
        );
      } else if (endpoint === FEISHU_ENDPOINTS.setGroupResponseMode) {
        if (typeof controller.updateGroupResponseMode !== 'function') {
          throw new Error('Group response mode update is unavailable');
        }
        value = await toPublicFeishuStatus(
          await controller.updateGroupResponseMode(payload.botId, payload.groupResponseMode),
          { encodeQr: cachedEncodeQr },
        );
      } else if (endpoint === FEISHU_ENDPOINTS.setMentionTopicReply) {
        if (typeof controller.updateMentionTopicReply !== 'function') {
          throw new Error('Mention topic reply update is unavailable');
        }
        value = await toPublicFeishuStatus(
          await controller.updateMentionTopicReply(payload.botId, payload.mentionTopicReply),
          { encodeQr: cachedEncodeQr },
        );
      } else if (endpoint === FEISHU_ENDPOINTS.setStepPush) {
        if (typeof controller.updateStepPush !== 'function') {
          throw new Error('Step push update is unavailable');
        }
        value = await toPublicFeishuStatus(
          await controller.updateStepPush(payload.botId, payload.stepPush),
          { encodeQr: cachedEncodeQr },
        );
      } else if (endpoint === FEISHU_ENDPOINTS.setStepPushMode) {
        if (typeof controller.updateStepPushMode !== 'function') {
          throw new Error('Step push mode update is unavailable');
        }
        value = await toPublicFeishuStatus(
          await controller.updateStepPushMode(payload.botId, payload.stepPushMode),
          { encodeQr: cachedEncodeQr },
        );
      } else if (endpoint === FEISHU_ENDPOINTS.setStepCardPanels) {
        if (typeof controller.updateStepCardPanels !== 'function') {
          throw new Error('Step card panel update is unavailable');
        }
        value = await toPublicFeishuStatus(
          await controller.updateStepCardPanels(payload.botId, payload.stepCardPanels),
          { encodeQr: cachedEncodeQr },
        );
      } else if (endpoint === FEISHU_ENDPOINTS.setVoice) {
        if (typeof controller.updateVoice !== 'function') {
          throw new Error('Voice update is unavailable');
        }
        value = await toPublicFeishuStatus(
          await controller.updateVoice(payload.botId, payload.voice),
          { encodeQr: cachedEncodeQr },
        );
      } else if (endpoint === FEISHU_ENDPOINTS.setSlashPanel) {
        if (typeof controller.updateSlashPanel !== 'function') {
          throw new Error('Slash panel update is unavailable');
        }
        value = await toPublicFeishuStatus(
          await controller.updateSlashPanel(payload.botId, payload.slashPanel),
          { encodeQr: cachedEncodeQr },
        );
      } else {
        if (typeof controller.deleteBot !== 'function') throw new Error('Multi-bot delete is unavailable');
        value = await toPublicFeishuStatus(await controller.deleteBot(payload.botId), { encodeQr: cachedEncodeQr });
      }
      if (signal?.aborted) return cancelled();
      return { ok: true, value };
    } catch (error) {
      const workspaceError = publicWorkspaceError(error);
      return diagnosticRpcResult(diagnostics, error, signal?.aborted ? cancelled() : workspaceError
        ? { ok: false, error: { ...workspaceError, details: {} } }
        : internalFailure(), { operation: endpoint, botId: payload?.botId });
    }
  };
}

/** Register the `/feishu` logical channel with its configured browser authority. */
export function installFeishuRpc(ctx, controller, options, authority) {
  return registerManagementRpc(ctx,
    FEISHU_RPC_CHANNEL,
    createFeishuRpcHandler(controller, options),
    { authority: resolveRpcAuthority(authority) },
  );
}
