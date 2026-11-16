import { SET_MESSAGE_MODE_ENDPOINT, validMessageModePayload } from '../../../../src/channels/shared/message-mode.mjs';
import { createConnectionDiagnostics, diagnosticRpcResult } from '../../../../src/channels/shared/connection-error.mjs';
import { SET_ALIAS_ENDPOINT, validAliasPayload } from './bot-alias-rpc.mjs';
import { registerManagementRpc } from '../../../management-rpc.mjs';
import { SET_CONTEXT_ENHANCEMENT_ENDPOINT, validContextEnhancementPayload } from './context-enhancement-rpc.mjs';
import { SET_ACCESS_POLICY_ENDPOINT, validAccessPolicyPayload } from './access-policy-rpc.mjs';
import { resolveRpcAuthority } from '../../rpc-authority.mjs';
import { publicConnectionTestResult } from '../../../../src/channels/shared/connection-test.mjs';
import {
  publicWorkspaceError,
  SET_WORKSPACE_ENDPOINT,
  validWorkspacePayload,
} from './workspace-rpc.mjs';
import {
  SET_AGENT_PRESET_ENDPOINT,
  validAgentPresetPayload,
} from './agent-preset-rpc.mjs';
import { SET_MODEL_ENDPOINT, validModelPayload } from './model-setting-rpc.mjs';
import { SET_THINKING_TRACES_ENDPOINT, validThinkingTracesPayload } from './thinking-traces-rpc.mjs';
import { SET_THINKING_CADENCE_ENDPOINT, validThinkingCadencePayload } from './thinking-cadence-rpc.mjs';
import { SET_SEND_LIMIT_ENDPOINT, validSendLimitPayload } from './send-limit-rpc.mjs';

export const TOKEN_BOT_ENDPOINTS = Object.freeze({
  status: 'connection.status',
  bindCredentials: 'bot.bind-credentials',
  reconnectBot: 'bot.reconnect',
  deleteBot: 'bot.delete',
  setWorkspace: SET_WORKSPACE_ENDPOINT,
  setModel: SET_MODEL_ENDPOINT,
  setAgentPreset: SET_AGENT_PRESET_ENDPOINT,
  setContextEnhancement: SET_CONTEXT_ENHANCEMENT_ENDPOINT,
  setBusyMessageMode: SET_MESSAGE_MODE_ENDPOINT,
  setAccessPolicy: SET_ACCESS_POLICY_ENDPOINT,
  setAlias: SET_ALIAS_ENDPOINT,
  setThinkingTraces: SET_THINKING_TRACES_ENDPOINT,
  setThinkingCadence: SET_THINKING_CADENCE_ENDPOINT,
  setSendLimit: SET_SEND_LIMIT_ENDPOINT,
});

const ENDPOINTS = Object.freeze(Object.values(TOKEN_BOT_ENDPOINTS));
const FORBIDDEN_PUBLIC_KEYS = new Set([
  'token', 'botToken', 'tokenRef', 'platformId', 'secret', 'secretRef',
]);
const TELEGRAM_NETWORK_ERRORS = new Set([
  'telegram-transport-error',
  'telegram-timeout',
  'telegram-response-invalid',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validToken(value) {
  return typeof value === 'string' && value.trim().length >= 20 && value.length <= 4_096;
}

function payloadFailure(endpoint, payload) {
  if (!isRecord(payload)) return 'Payload must be an object.';
  if (endpoint === TOKEN_BOT_ENDPOINTS.status) {
    return exactKeys(payload, []) ? null : 'connection.status does not accept fields.';
  }
  if (endpoint === TOKEN_BOT_ENDPOINTS.bindCredentials) {
    return exactKeys(payload, ['token']) && validToken(payload.token)
      ? null : 'bot.bind-credentials requires a Bot Token.';
  }
  if (endpoint === TOKEN_BOT_ENDPOINTS.reconnectBot) {
    return exactKeys(payload, ['botId', 'sendTest']) && validId(payload.botId)
      && (payload.sendTest === undefined || typeof payload.sendTest === 'boolean')
      ? null : 'bot.reconnect requires a botId.';
  }
  if (endpoint === TOKEN_BOT_ENDPOINTS.deleteBot) {
    return exactKeys(payload, ['botId', 'confirm']) && validId(payload.botId) && payload.confirm === true
      ? null : 'bot.delete requires a botId and confirm=true.';
  }
  if (endpoint === TOKEN_BOT_ENDPOINTS.setWorkspace) {
    return validWorkspacePayload(payload)
      ? null : '请输入工作区绝对路径。';
  }
  if (endpoint === TOKEN_BOT_ENDPOINTS.setModel) {
    return validModelPayload(payload)
      ? null : '请选择有效模型。';
  }
  if (endpoint === TOKEN_BOT_ENDPOINTS.setAgentPreset) {
    return validAgentPresetPayload(payload)
      ? null : '请选择 Agent Preset。';
  }
  if (endpoint === TOKEN_BOT_ENDPOINTS.setBusyMessageMode) {
    return validMessageModePayload(payload)
      ? null : '请提交有效的消息处理方式。';
  }
  if (endpoint === TOKEN_BOT_ENDPOINTS.setContextEnhancement) {
    return validContextEnhancementPayload(payload)
      ? null : '请提交有效的上下文增强设置。';
  }
  if (endpoint === TOKEN_BOT_ENDPOINTS.setAccessPolicy) {
    return validAccessPolicyPayload(payload)
      ? null : '请提交有效的访问设置。';
  }
  if (endpoint === TOKEN_BOT_ENDPOINTS.setAlias) {
    return validAliasPayload(payload)
      ? null : '请输入有效的别名（最多 80 个字符）。';
  }
  if (endpoint === TOKEN_BOT_ENDPOINTS.setThinkingTraces) {
    return validThinkingTracesPayload(payload)
      ? null : '请提交有效的思考过程留痕设置。';
  }
  if (endpoint === TOKEN_BOT_ENDPOINTS.setThinkingCadence) {
    return validThinkingCadencePayload(payload)
      ? null : '请提交有效的思考帧节奏设置。';
  }
  if (endpoint === TOKEN_BOT_ENDPOINTS.setSendLimit) {
    return validSendLimitPayload(payload)
      ? null : '请提交有效的消息发送上限。';
  }
  return 'Unknown bot endpoint.';
}

function sanitizePublic(value) {
  if (Array.isArray(value)) return value.map(sanitizePublic);
  if (!isRecord(value)) return value;
  const safe = {};
  for (const [key, child] of Object.entries(value)) {
    if (!FORBIDDEN_PUBLIC_KEYS.has(key)) safe[key] = sanitizePublic(child);
  }
  return safe;
}

function operationError(channel, error) {
  const workspaceError = publicWorkspaceError(error);
  if (workspaceError) return workspaceError;
  if (error?.code === 'webhook-configured') {
    return { code: 'webhook-configured', message: error.message };
  }
  if (error?.code === 'telegram-401' || error?.code === 'discord-401') {
    return { code: 'invalid-token', message: `${channel} Bot Token 无效，请重新填写。` };
  }
  if (channel === 'Telegram' && TELEGRAM_NETWORK_ERRORS.has(error?.code)) {
    return {
      code: 'telegram-network-error',
      message: '无法访问 Telegram Bot API。请检查网络或代理设置；Node.js 22.21+ 可设置 NODE_USE_ENV_PROXY=1，并配置 HTTPS_PROXY、HTTP_PROXY 和 NO_PROXY，然后重启 dsh web。',
    };
  }
  if (error?.code === 'discord-intents') {
    return { code: 'discord-intents', message: error.message };
  }
  return { code: `${channel.toLowerCase()}-operation-failed`, message: `${channel} 操作失败，请稍后重试。` };
}

export function createTokenBotRpcHandler(controller, { channel }) {
  const diagnostics = controller.diagnostics ?? createConnectionDiagnostics({ channel: channel.toLowerCase() });
  for (const method of ['status', 'bindCredentials', 'reconnectBot', 'deleteBot']) {
    if (typeof controller?.[method] !== 'function') {
      throw new TypeError(`A complete ${channel} controller is required (${method})`);
    }
  }
  return async (endpoint, payload, signal) => {
    if (signal?.aborted) {
      return { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } };
    }
    if (!ENDPOINTS.includes(endpoint)) {
      return { ok: false, error: { code: 'bad-request', message: `Unknown ${channel} endpoint.` } };
    }
    const invalid = payloadFailure(endpoint, payload);
    if (invalid) return { ok: false, error: { code: 'bad-request', message: invalid } };
    try {
      let value;
      if (endpoint === TOKEN_BOT_ENDPOINTS.status) value = await controller.status();
      else if (endpoint === TOKEN_BOT_ENDPOINTS.bindCredentials) {
        value = await controller.bindCredentials(payload);
      } else if (endpoint === TOKEN_BOT_ENDPOINTS.reconnectBot) {
        value = await controller.reconnectBot(payload.botId);
        if (signal?.aborted) {
          return { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } };
        }
        if (payload.sendTest === true) {
          let testError = null;
          try {
            if (value?.bots?.find((bot) => bot?.botId === payload.botId)?.connected !== true) {
              const unavailable = new Error('Bot is not connected');
              unavailable.code = 'test-target-unavailable';
              throw unavailable;
            }
            if (typeof controller.sendConnectionTest !== 'function') {
              const unavailable = new Error('Connection test is unavailable');
              unavailable.code = 'test-target-unavailable';
              throw unavailable;
            }
            await controller.sendConnectionTest(payload.botId);
          } catch (error) {
            testError = error;
          }
          value = { ...value, testMessage: publicConnectionTestResult(testError, { diagnostics, botId: payload.botId }) };
        }
      } else if (endpoint === TOKEN_BOT_ENDPOINTS.setWorkspace) {
        if (typeof controller.updateWorkspace !== 'function') throw new Error('Workspace update is unavailable');
        value = await controller.updateWorkspace(payload.botId, payload.workspace);
      } else if (endpoint === TOKEN_BOT_ENDPOINTS.setModel) {
        if (typeof controller.updateModel !== 'function') throw new Error('Model update is unavailable');
        value = await controller.updateModel(payload.botId, payload.model);
      } else if (endpoint === TOKEN_BOT_ENDPOINTS.setBusyMessageMode) {
        if (typeof controller.updateBusyMessageMode !== 'function') throw new Error('Message mode update is unavailable');
        value = await controller.updateBusyMessageMode(payload.botId, payload.busyMessageMode);
      } else if (endpoint === TOKEN_BOT_ENDPOINTS.setContextEnhancement) {
        if (typeof controller.updateContextEnhancement !== 'function') throw new Error('Context enhancement update is unavailable');
        value = await controller.updateContextEnhancement(payload.botId, payload.config);
      } else if (endpoint === TOKEN_BOT_ENDPOINTS.setAlias) {
        if (typeof controller.updateAlias !== 'function') throw new Error('Alias update is unavailable');
        value = await controller.updateAlias(payload.botId, payload.alias);
      } else if (endpoint === TOKEN_BOT_ENDPOINTS.setAccessPolicy) {
        if (typeof controller.updateAccessPolicy !== 'function') throw new Error('Access policy update is unavailable');
        value = await controller.updateAccessPolicy(payload.botId, payload.policy);
      } else if (endpoint === TOKEN_BOT_ENDPOINTS.setAgentPreset) {
        if (typeof controller.updateAgentPreset !== 'function') throw new Error('Agent preset update is unavailable');
        value = await controller.updateAgentPreset(payload.botId, payload.agentPreset);
      } else if (endpoint === TOKEN_BOT_ENDPOINTS.setThinkingTraces) {
        if (typeof controller.setThinkingTraces !== 'function') throw new Error('Thinking traces update is unavailable');
        value = await controller.setThinkingTraces(payload.botId, payload.thinkingTraces);
      } else if (endpoint === TOKEN_BOT_ENDPOINTS.setThinkingCadence) {
        if (typeof controller.setThinkingCadence !== 'function') throw new Error('Thinking trace cadence update is unavailable');
        value = await controller.setThinkingCadence(payload.botId, {
          thinkingNumbering: payload.thinkingNumbering,
          thinkingIntervalSeconds: payload.thinkingIntervalSeconds,
        });
      } else if (endpoint === TOKEN_BOT_ENDPOINTS.setSendLimit) {
        if (typeof controller.setSendLimitPerMinute !== 'function') throw new Error('Send limit update is unavailable');
        value = await controller.setSendLimitPerMinute(payload.botId, payload.sendLimitPerMinute);
      } else {
        value = await controller.deleteBot(payload.botId);
      }
      return signal?.aborted
        ? { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } }
        : { ok: true, value: sanitizePublic(value) };
    } catch (error) {
      return diagnosticRpcResult(diagnostics, error, signal?.aborted
        ? { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } }
        : { ok: false, error: operationError(channel, error) }, { operation: endpoint, botId: payload?.botId });
    }
  };
}

export function installTokenBotRpc(ctx, controller, { channel, rpcChannel, authority }) {
  return registerManagementRpc(ctx,
    rpcChannel,
    createTokenBotRpcHandler(controller, { channel }),
    { authority: resolveRpcAuthority(authority) },
  );
}
