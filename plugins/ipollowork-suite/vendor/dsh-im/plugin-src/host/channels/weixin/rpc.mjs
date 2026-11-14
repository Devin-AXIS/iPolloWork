import { SET_MESSAGE_MODE_ENDPOINT, validMessageModePayload } from '../../../../src/channels/shared/message-mode.mjs';
import { SET_ALIAS_ENDPOINT, validAliasPayload } from '../shared/bot-alias-rpc.mjs';
import { registerManagementRpc } from '../../../management-rpc.mjs';
import QRCode from '../../../../src/channels/shared/qrcode.mjs';
import { qrEncodingError } from '../../../../src/channels/shared/qr-encoding-error.mjs';
import { createWeixinDiagnostics, weixinStageError } from '../../../../src/channels/weixin/connection-error.mjs';
import { SET_CONTEXT_ENHANCEMENT_ENDPOINT, validContextEnhancementPayload } from '../shared/context-enhancement-rpc.mjs';
import { SET_ACCESS_POLICY_ENDPOINT, validAccessPolicyPayload } from '../shared/access-policy-rpc.mjs';
import { resolveRpcAuthority } from '../../rpc-authority.mjs';
import {
  SET_WORKSPACE_ENDPOINT,
  validWorkspacePayload,
} from '../shared/workspace-rpc.mjs';
import {
  SET_AGENT_PRESET_ENDPOINT,
  validAgentPresetPayload,
} from '../shared/agent-preset-rpc.mjs';
import { SET_MODEL_ENDPOINT, validModelPayload } from '../shared/model-setting-rpc.mjs';
import {
  connectionTestTargetUnavailable,
  publicConnectionTestResult,
} from '../../../../src/channels/shared/connection-test.mjs';

export const WEIXIN_RPC_CHANNEL = '/weixin';
export const WEIXIN_ENDPOINTS = Object.freeze({
  status: 'connection.status',
  beginProvisioning: 'provision.begin',
  pollProvisioning: 'provision.poll',
  submitVerification: 'provision.verify',
  cancelProvisioning: 'provision.cancel',
  reconnectBot: 'bot.reconnect',
  deleteBot: 'bot.delete',
  setWorkspace: SET_WORKSPACE_ENDPOINT,
  setModel: SET_MODEL_ENDPOINT,
  setAgentPreset: SET_AGENT_PRESET_ENDPOINT,
  setContextEnhancement: SET_CONTEXT_ENHANCEMENT_ENDPOINT,
  setBusyMessageMode: SET_MESSAGE_MODE_ENDPOINT,
  setAccessPolicy: SET_ACCESS_POLICY_ENDPOINT,
  setAlias: SET_ALIAS_ENDPOINT,
});
export const WEIXIN_RPC_ENDPOINTS = Object.freeze(Object.values(WEIXIN_ENDPOINTS));

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function payloadFailure(endpoint, payload) {
  if (!isRecord(payload)) return 'Payload must be an object.';
  if (endpoint === WEIXIN_ENDPOINTS.status) {
    return exactKeys(payload, []) ? null : 'connection.status does not accept fields.';
  }
  if (endpoint === WEIXIN_ENDPOINTS.beginProvisioning) {
    return exactKeys(payload, ['locale']) && (payload.locale === undefined || payload.locale === 'zh-CN')
      ? null
      : 'provision.begin received unsupported fields.';
  }
  if ([WEIXIN_ENDPOINTS.pollProvisioning, WEIXIN_ENDPOINTS.cancelProvisioning].includes(endpoint)) {
    return exactKeys(payload, ['attemptId']) && validId(payload.attemptId)
      ? null
      : `${endpoint} requires an attemptId.`;
  }
  if (endpoint === WEIXIN_ENDPOINTS.submitVerification) {
    return exactKeys(payload, ['attemptId', 'verifyCode'])
      && validId(payload.attemptId)
      && typeof payload.verifyCode === 'string'
      && /^\d{4,8}$/.test(payload.verifyCode)
      ? null
      : 'provision.verify requires an attemptId and a 4-to-8-digit code.';
  }
  if (endpoint === WEIXIN_ENDPOINTS.reconnectBot) {
    return exactKeys(payload, ['botId', 'sendTest'])
      && validId(payload.botId)
      && (payload.sendTest === undefined || payload.sendTest === true)
      ? null
      : 'bot.reconnect requires a botId and optional sendTest=true.';
  }
  if (endpoint === WEIXIN_ENDPOINTS.deleteBot) {
    return exactKeys(payload, ['botId', 'confirm']) && validId(payload.botId) && payload.confirm === true
      ? null
      : 'bot.delete requires a botId and confirm=true.';
  }
  if (endpoint === WEIXIN_ENDPOINTS.setWorkspace) {
    return validWorkspacePayload(payload)
      ? null : '请输入工作区绝对路径。';
  }
  if (endpoint === WEIXIN_ENDPOINTS.setModel) {
    return validModelPayload(payload) ? null : '请选择有效模型。';
  }
  if (endpoint === WEIXIN_ENDPOINTS.setAgentPreset) {
    return validAgentPresetPayload(payload)
      ? null : '请选择 Agent Preset。';
  }
  if (endpoint === WEIXIN_ENDPOINTS.setBusyMessageMode) {
    return validMessageModePayload(payload)
      ? null : '请提交有效的消息处理方式。';
  }
  if (endpoint === WEIXIN_ENDPOINTS.setContextEnhancement) {
    return validContextEnhancementPayload(payload)
      ? null : '请提交有效的上下文增强设置。';
  }
  if (endpoint === WEIXIN_ENDPOINTS.setAccessPolicy) {
    return validAccessPolicyPayload(payload)
      ? null : '请提交有效的访问设置。';
  }
  if (endpoint === WEIXIN_ENDPOINTS.setAlias) {
    return validAliasPayload(payload)
      ? null : '请输入有效的别名（最多 80 个字符）。';
  }
  return 'Unknown Weixin endpoint.';
}

function badRequest(message) {
  return { ok: false, error: { code: 'bad-request', message } };
}

function cancelled() {
  return { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } };
}

async function qrDataUrl(value) {
  return QRCode.toDataURL(value, {
    type: 'image/png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  });
}

async function withEncodedQr(value, encodeQr) {
  if (!value || !value.verificationUrl) return value;
  return {
    ...value,
    qrCodeDataUrl: await encodeQr(value.verificationUrl),
  };
}

async function publicStatus(status, encodeQr) {
  let safe;
  try { safe = structuredClone(status); }
  catch (error) { throw weixinStageError('status-read-failed', error); }
  if (safe.provisioning) safe.provisioning = await withEncodedQr(safe.provisioning, encodeQr);
  return safe;
}

function assertController(controller) {
  if (!controller
    || typeof controller.status !== 'function'
    || typeof controller.startProvisioning !== 'function'
    || typeof controller.registrationStatus !== 'function'
    || typeof controller.submitVerification !== 'function'
    || typeof controller.cancelProvisioning !== 'function'
    || typeof controller.reconnectBot !== 'function'
    || typeof controller.deleteBot !== 'function') {
    throw new TypeError('A complete Weixin controller is required');
  }
}

export function createWeixinRpcHandler(controller, { encodeQr = qrDataUrl, logger = console, diagnostics = createWeixinDiagnostics({ logger }) } = {}) {
  assertController(controller);
  const qrCache = new Map();
  const cachedEncode = (url) => {
    let encoded = qrCache.get(url);
    if (!encoded) {
      if (qrCache.size >= 16) qrCache.delete(qrCache.keys().next().value);
      encoded = Promise.resolve().then(() => encodeQr(url)).catch(error => {
        if (qrCache.get(url) === encoded) qrCache.delete(url);
        throw weixinStageError('qr-encode-failed', qrEncodingError(error));
      });
      qrCache.set(url, encoded);
    }
    return encoded;
  };

  return async (endpoint, payload, signal) => {
    if (signal?.aborted) return cancelled();
    if (!WEIXIN_RPC_ENDPOINTS.includes(endpoint)) return badRequest('Unknown Weixin endpoint.');
    const invalid = payloadFailure(endpoint, payload);
    if (invalid) return badRequest(invalid);

    try {
      let value;
      if (endpoint === WEIXIN_ENDPOINTS.status) {
        value = await publicStatus(await controller.status(), cachedEncode);
      } else if (endpoint === WEIXIN_ENDPOINTS.beginProvisioning) {
        const started = await controller.startProvisioning();
        if (signal?.aborted) {
          await controller.cancelProvisioning(started.attemptId);
          return cancelled();
        }
        value = await withEncodedQr(started, cachedEncode);
      } else if (endpoint === WEIXIN_ENDPOINTS.pollProvisioning) {
        const current = await controller.registrationStatus(payload.attemptId);
        if (!current) throw weixinStageError('provision-attempt-not-found', undefined, 'qr.poll');
        value = await withEncodedQr(current, cachedEncode);
      } else if (endpoint === WEIXIN_ENDPOINTS.submitVerification) {
        value = await withEncodedQr(
          await controller.submitVerification(payload.attemptId, payload.verifyCode),
          cachedEncode,
        );
      } else if (endpoint === WEIXIN_ENDPOINTS.cancelProvisioning) {
        value = await controller.cancelProvisioning(payload.attemptId);
        if (!value) throw weixinStageError('provision-attempt-not-found', undefined, 'qr.cancel');
      } else if (endpoint === WEIXIN_ENDPOINTS.reconnectBot) {
        const snapshot = await controller.reconnectBot(payload.botId);
        if (signal?.aborted) return cancelled();
        let testMessage;
        if (payload.sendTest === true) {
          const connected = snapshot?.bots?.some(
            (bot) => bot?.botId === payload.botId && bot?.connected === true,
          );
          if (!connected || typeof controller.sendConnectionTest !== 'function') {
            testMessage = publicConnectionTestResult(
              connectionTestTargetUnavailable('微信机器人'),
            );
          } else {
            try {
              await controller.sendConnectionTest(payload.botId);
              testMessage = publicConnectionTestResult();
            } catch (error) {
              testMessage = publicConnectionTestResult(error);
            }
          }
        }
        value = await publicStatus({ ...snapshot, ...(testMessage ? { testMessage } : {}) }, cachedEncode);
      } else if (endpoint === WEIXIN_ENDPOINTS.setWorkspace) {
        if (typeof controller.updateWorkspace !== 'function') throw new Error('Workspace update is unavailable');
        value = await publicStatus(
          await controller.updateWorkspace(payload.botId, payload.workspace),
          cachedEncode,
        );
      } else if (endpoint === WEIXIN_ENDPOINTS.setModel) {
        if (typeof controller.updateModel !== 'function') throw new Error('Model update is unavailable');
        value = await publicStatus(
          await controller.updateModel(payload.botId, payload.model),
          cachedEncode,
        );
      } else if (endpoint === WEIXIN_ENDPOINTS.setBusyMessageMode) {
        if (typeof controller.updateBusyMessageMode !== 'function') throw new Error('Message mode update is unavailable');
        value = await controller.updateBusyMessageMode(
          payload.botId, payload.busyMessageMode, (status) => publicStatus(status, cachedEncode),
        );
      } else if (endpoint === WEIXIN_ENDPOINTS.setContextEnhancement) {
        if (typeof controller.updateContextEnhancement !== 'function') throw new Error('Context enhancement update is unavailable');
        value = await controller.updateContextEnhancement(
          payload.botId, payload.config, (status) => publicStatus(status, cachedEncode),
        );
      } else if (endpoint === WEIXIN_ENDPOINTS.setAlias) {
        if (typeof controller.updateAlias !== 'function') throw new Error('Alias update is unavailable');
        value = await controller.updateAlias(
          payload.botId, payload.alias, (status) => publicStatus(status, cachedEncode),
        );
      } else if (endpoint === WEIXIN_ENDPOINTS.setAccessPolicy) {
        if (typeof controller.updateAccessPolicy !== 'function') throw new Error('Access policy update is unavailable');
        value = await controller.updateAccessPolicy(
          payload.botId, payload.policy, (status) => publicStatus(status, cachedEncode),
        );
      } else if (endpoint === WEIXIN_ENDPOINTS.setAgentPreset) {
        if (typeof controller.updateAgentPreset !== 'function') throw new Error('Agent preset update is unavailable');
        value = await publicStatus(
          await controller.updateAgentPreset(payload.botId, payload.agentPreset),
          cachedEncode,
        );
      } else {
        value = await publicStatus(await controller.deleteBot(payload.botId), cachedEncode);
      }
      return signal?.aborted ? cancelled() : { ok: true, value };
    } catch (error) {
      if (signal?.aborted) return cancelled();
      const context = {
        'connection.status': ['status.read', 'status-read-failed'],
        'provision.begin': ['qr.begin', 'qr-start-failed'],
        'provision.poll': ['qr.poll'], 'provision.verify': ['qr.verify'], 'provision.cancel': ['qr.cancel'],
        'bot.reconnect': ['connection.start', 'connection-start-failed'],
        'bot.delete': ['account.remove'], 'bot.workspace.set': ['workspace.write', 'workspace-save-failed'],
      }[endpoint] ?? ['workspace.write', 'workspace-save-failed'];
      return { ok: false, error: diagnostics.report(error, {
        operation: endpoint, stage: context[0], code: context[1], botId: payload.botId,
      }).publicError };
    }
  };
}

export function installWeixinRpc(ctx, controller, options, authority) {
  return registerManagementRpc(ctx,
    WEIXIN_RPC_CHANNEL,
    createWeixinRpcHandler(controller, options),
    { authority: resolveRpcAuthority(authority) },
  );
}
