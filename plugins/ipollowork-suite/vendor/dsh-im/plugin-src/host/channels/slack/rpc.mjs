import { SET_MESSAGE_MODE_ENDPOINT, validMessageModePayload } from '../../../../src/channels/shared/message-mode.mjs';
import { createConnectionDiagnostics, diagnosticRpcResult } from '../../../../src/channels/shared/connection-error.mjs';
import { SET_ALIAS_ENDPOINT, validAliasPayload } from '../shared/bot-alias-rpc.mjs';
import { registerManagementRpc } from '../../../management-rpc.mjs';
import { SET_CONTEXT_ENHANCEMENT_ENDPOINT, validContextEnhancementPayload } from '../shared/context-enhancement-rpc.mjs';
import { SET_ACCESS_POLICY_ENDPOINT, validAccessPolicyPayload } from '../shared/access-policy-rpc.mjs';
import { resolveRpcAuthority } from '../../rpc-authority.mjs';
import { publicConnectionTestResult } from '../../../../src/channels/shared/connection-test.mjs';
import {
  publicWorkspaceError,
  SET_WORKSPACE_ENDPOINT,
  validWorkspacePayload,
} from '../shared/workspace-rpc.mjs';
import {
  SET_AGENT_PRESET_ENDPOINT,
  validAgentPresetPayload,
} from '../shared/agent-preset-rpc.mjs';
import { SET_MODEL_ENDPOINT, validModelPayload } from '../shared/model-setting-rpc.mjs';

export const SLACK_RPC_CHANNEL = '/slack';
export const SLACK_ENDPOINTS = Object.freeze({
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
});
export const SLACK_RPC_ENDPOINTS = Object.freeze(Object.values(SLACK_ENDPOINTS));

const FORBIDDEN_PUBLIC_KEYS = new Set([
  'token', 'botToken', 'appToken', 'botTokenRef', 'appTokenRef',
  'tokenRef', 'platformId', 'secret', 'secretRef',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function validId(value) {
  return typeof value === 'string' && /^slack_[a-f0-9]{24}$/.test(value);
}

function validBotToken(value) {
  return typeof value === 'string' && /^xoxb-[A-Za-z0-9-]{16,}$/.test(value.trim())
    && value.length <= 4_096;
}

function validAppToken(value) {
  return typeof value === 'string' && /^xapp-[A-Za-z0-9-]{16,}$/.test(value.trim())
    && value.length <= 4_096;
}

function payloadFailure(endpoint, payload) {
  if (!isRecord(payload)) return 'Payload must be an object.';
  if (endpoint === SLACK_ENDPOINTS.status) {
    return exactKeys(payload, []) ? null : 'connection.status does not accept fields.';
  }
  if (endpoint === SLACK_ENDPOINTS.bindCredentials) {
    return exactKeys(payload, ['botToken', 'appToken'])
      && validBotToken(payload.botToken) && validAppToken(payload.appToken)
      ? null : 'bot.bind-credentials requires xoxb Bot Token and xapp App Token.';
  }
  if (endpoint === SLACK_ENDPOINTS.reconnectBot) {
    return exactKeys(payload, ['botId', 'sendTest']) && validId(payload.botId)
      && (payload.sendTest === undefined || typeof payload.sendTest === 'boolean')
      ? null : 'bot.reconnect requires a botId.';
  }
  if (endpoint === SLACK_ENDPOINTS.deleteBot) {
    return exactKeys(payload, ['botId', 'confirm']) && validId(payload.botId) && payload.confirm === true
      ? null : 'bot.delete requires a botId and confirm=true.';
  }
  if (endpoint === SLACK_ENDPOINTS.setWorkspace) {
    return validWorkspacePayload(payload)
      ? null : '请输入工作区绝对路径。';
  }
  if (endpoint === SLACK_ENDPOINTS.setModel) {
    return validModelPayload(payload) ? null : '请选择有效模型。';
  }
  if (endpoint === SLACK_ENDPOINTS.setAgentPreset) {
    return validAgentPresetPayload(payload)
      ? null : '请选择 Agent Preset。';
  }
  if (endpoint === SLACK_ENDPOINTS.setBusyMessageMode) {
    return validMessageModePayload(payload)
      ? null : '请提交有效的消息处理方式。';
  }
  if (endpoint === SLACK_ENDPOINTS.setContextEnhancement) {
    return validContextEnhancementPayload(payload)
      ? null : '请提交有效的上下文增强设置。';
  }
  if (endpoint === SLACK_ENDPOINTS.setAccessPolicy) {
    return validAccessPolicyPayload(payload)
      ? null : '请提交有效的访问设置。';
  }
  if (endpoint === SLACK_ENDPOINTS.setAlias) {
    return validAliasPayload(payload)
      ? null : '请输入有效的别名（最多 80 个字符）。';
  }
  return 'Unknown Slack endpoint.';
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

function operationError(error) {
  const workspaceError = publicWorkspaceError(error);
  if (workspaceError) return workspaceError;
  if (error?.code === 'slack-invalid-bot-token') {
    return { code: 'invalid-bot-token', message: 'Slack Bot Token 无效，请确认使用以 xoxb- 开头的令牌。' };
  }
  if (error?.code === 'slack-invalid-app-token') {
    return { code: 'invalid-app-token', message: 'Slack App Token 无效，请确认使用以 xapp- 开头的令牌。' };
  }
  if (error?.code === 'slack-missing-scope') {
    return { code: 'missing-scope', message: 'Slack 应用权限不完整，请重新导入 Manifest 并安装到工作区。' };
  }
  if (error?.code === 'slack-socket-mode') {
    return { code: 'socket-mode-unavailable', message: error.message };
  }
  return { code: 'slack-operation-failed', message: 'Slack 操作失败，请稍后重试。' };
}

export function createSlackRpcHandler(controller) {
  const diagnostics = controller.diagnostics ?? createConnectionDiagnostics({ channel: 'slack' });
  for (const method of ['status', 'bindCredentials', 'reconnectBot', 'deleteBot']) {
    if (typeof controller?.[method] !== 'function') {
      throw new TypeError(`A complete Slack controller is required (${method})`);
    }
  }
  return async (endpoint, payload, signal) => {
    if (signal?.aborted) {
      return { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } };
    }
    if (!SLACK_RPC_ENDPOINTS.includes(endpoint)) {
      return { ok: false, error: { code: 'bad-request', message: 'Unknown Slack endpoint.' } };
    }
    const invalid = payloadFailure(endpoint, payload);
    if (invalid) return { ok: false, error: { code: 'bad-request', message: invalid } };
    try {
      let value;
      if (endpoint === SLACK_ENDPOINTS.status) value = await controller.status();
      else if (endpoint === SLACK_ENDPOINTS.bindCredentials) value = await controller.bindCredentials(payload);
      else if (endpoint === SLACK_ENDPOINTS.reconnectBot) {
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
      }
      else if (endpoint === SLACK_ENDPOINTS.setWorkspace) {
        if (typeof controller.updateWorkspace !== 'function') throw new Error('Workspace update is unavailable');
        value = await controller.updateWorkspace(payload.botId, payload.workspace);
      }
      else if (endpoint === SLACK_ENDPOINTS.setModel) {
        if (typeof controller.updateModel !== 'function') throw new Error('Model update is unavailable');
        value = await controller.updateModel(payload.botId, payload.model);
      }
      else if (endpoint === SLACK_ENDPOINTS.setBusyMessageMode) {
        if (typeof controller.updateBusyMessageMode !== 'function') throw new Error('Message mode update is unavailable');
        value = await controller.updateBusyMessageMode(payload.botId, payload.busyMessageMode);
      }
      else if (endpoint === SLACK_ENDPOINTS.setContextEnhancement) {
        if (typeof controller.updateContextEnhancement !== 'function') throw new Error('Context enhancement update is unavailable');
        value = await controller.updateContextEnhancement(payload.botId, payload.config);
      }
      else if (endpoint === SLACK_ENDPOINTS.setAlias) {
        if (typeof controller.updateAlias !== 'function') throw new Error('Alias update is unavailable');
        value = await controller.updateAlias(payload.botId, payload.alias);
      }
      else if (endpoint === SLACK_ENDPOINTS.setAccessPolicy) {
        if (typeof controller.updateAccessPolicy !== 'function') throw new Error('Access policy update is unavailable');
        value = await controller.updateAccessPolicy(payload.botId, payload.policy);
      }
      else if (endpoint === SLACK_ENDPOINTS.setAgentPreset) {
        if (typeof controller.updateAgentPreset !== 'function') throw new Error('Agent preset update is unavailable');
        value = await controller.updateAgentPreset(payload.botId, payload.agentPreset);
      }
      else value = await controller.deleteBot(payload.botId);
      return signal?.aborted
        ? { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } }
        : { ok: true, value: sanitizePublic(value) };
    } catch (error) {
      return diagnosticRpcResult(diagnostics, error, signal?.aborted
        ? { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } }
        : { ok: false, error: operationError(error) }, { operation: endpoint, botId: payload?.botId });
    }
  };
}

export function installSlackRpc(ctx, controller, authority) {
  return registerManagementRpc(ctx,
    SLACK_RPC_CHANNEL,
    createSlackRpcHandler(controller),
    { authority: resolveRpcAuthority(authority) },
  );
}
