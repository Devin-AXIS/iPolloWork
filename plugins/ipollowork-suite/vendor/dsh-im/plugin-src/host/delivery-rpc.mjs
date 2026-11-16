import { registerManagementRpc } from '../management-rpc.mjs';
import { resolveRpcAuthority } from './rpc-authority.mjs';

export const DELIVERY_RPC_CHANNEL = '/dsh-im-delivery';
export const DELIVERY_TEST_MESSAGE = 'DSH-IM 主动投递测试成功。';
export const DELIVERY_ENDPOINTS = Object.freeze({
  listDsBotSessions: 'ds-bot.sessions.list',
  dsBotStatus: 'ds-bot.status',
  bindDsBot: 'ds-bot.bind',
  unbindDsBot: 'ds-bot.unbind',
  send: 'message.send',
  listTargets: 'target.list',
  listSuggestions: 'target.suggestion.list',
  createTarget: 'target.create',
  updateTarget: 'target.update',
  deleteTarget: 'target.delete',
  setSessionSync: 'target.session-sync.set',
  testTarget: 'target.test',
});

const ENDPOINTS = new Set(Object.values(DELIVERY_ENDPOINTS));
const PUBLIC_ERRORS = new Set([
  'ds-bot-unavailable',
  'ds-bot-not-found',
  'ds-bot-bound',
  'ds-bot-private-required',
  'ds-bot-binding-conflict',
  'bad-request',
  'unknown-bot',
  'unknown-target',
  'target-conflict',
  'invalid-target',
  'bot-not-connected',
  'target-rejected',
  'delivery-failed',
  'session-sync-unavailable',
  'cancelled',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isRecord(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function validBotId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validTargetId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:@-]{1,128}$/.test(value);
}

function validConversationKey(value) {
  return typeof value === 'string' && Boolean(value) && value.length <= 1_024
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validTarget(value, { targetId }) {
  const keys = targetId ? ['targetId', 'name', 'kind', 'route'] : ['name', 'kind', 'route'];
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) return false;
  if (targetId && !validTargetId(value.targetId)) return false;
  if (value.name !== undefined
    && (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 80)) return false;
  return typeof value.kind === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(value.kind)
    && isRecord(value.route);
}

function validDraftTarget(value) {
  return exactKeys(value, ['kind', 'route'])
    && typeof value.kind === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(value.kind)
    && isRecord(value.route);
}

function validPayload(endpoint, payload) {
  if (!ENDPOINTS.has(endpoint) || !isRecord(payload)) return false;
  if (endpoint === DELIVERY_ENDPOINTS.listDsBotSessions) return exactKeys(payload, []);
  if (endpoint === DELIVERY_ENDPOINTS.send) {
    return (exactKeys(payload, ['botId', 'targetId', 'text'])
        || (exactKeys(payload, ['botId', 'targetId', 'text', 'format'])
          && ['plain', 'markdown'].includes(payload.format)))
      && validBotId(payload.botId) && validTargetId(payload.targetId)
      && typeof payload.text === 'string' && Boolean(payload.text.trim());
  }
  if (endpoint === DELIVERY_ENDPOINTS.listTargets
    || endpoint === DELIVERY_ENDPOINTS.dsBotStatus
    || endpoint === DELIVERY_ENDPOINTS.listSuggestions) {
    return exactKeys(payload, ['botId']) && validBotId(payload.botId);
  }
  if (endpoint === DELIVERY_ENDPOINTS.bindDsBot) {
    return exactKeys(payload, ['botId', 'conversationKey', 'dsBotId'])
      && validBotId(payload.botId) && validConversationKey(payload.conversationKey) && validBotId(payload.dsBotId);
  }
  if (endpoint === DELIVERY_ENDPOINTS.unbindDsBot) {
    return exactKeys(payload, ['botId', 'conversationKey'])
      && validBotId(payload.botId) && validConversationKey(payload.conversationKey);
  }
  if (endpoint === DELIVERY_ENDPOINTS.createTarget) {
    return exactKeys(payload, ['botId', 'target'])
      && validBotId(payload.botId) && validTarget(payload.target, { targetId: true });
  }
  if (endpoint === DELIVERY_ENDPOINTS.updateTarget) {
    return exactKeys(payload, ['botId', 'targetId', 'target'])
      && validBotId(payload.botId) && validTargetId(payload.targetId)
      && validTarget(payload.target, { targetId: false });
  }
  if (endpoint === DELIVERY_ENDPOINTS.testTarget) {
    return (exactKeys(payload, ['botId', 'targetId'])
        && validBotId(payload.botId) && validTargetId(payload.targetId))
      || (exactKeys(payload, ['botId', 'target'])
        && validBotId(payload.botId) && validDraftTarget(payload.target));
  }
  if (endpoint === DELIVERY_ENDPOINTS.setSessionSync) {
    return exactKeys(payload, ['botId', 'targetId', 'enabled'])
      && validBotId(payload.botId) && validTargetId(payload.targetId)
      && typeof payload.enabled === 'boolean';
  }
  return exactKeys(payload, ['botId', 'targetId'])
    && validBotId(payload.botId) && validTargetId(payload.targetId);
}

function publicError(error) {
  const code = PUBLIC_ERRORS.has(error?.code) ? error.code : 'delivery-failed';
  return { code, message: code, details: {} };
}

export function createDeliveryRpcHandler(service) {
  for (const method of [
    'send',
    'listTargets',
    'listSuggestions',
    'createTarget',
    'updateTarget',
    'deleteTarget',
  ]) {
    if (typeof service?.[method] !== 'function') {
      throw new TypeError(`A complete delivery service is required (${method})`);
    }
  }
  return async (endpoint, payload, signal) => {
    if (!validPayload(endpoint, payload)) {
      return {
        ok: false,
        error: { code: 'bad-request', message: 'Invalid delivery request.', details: {} },
      };
    }
    if (signal?.aborted) {
      return { ok: false, error: { code: 'cancelled', message: 'cancelled', details: {} } };
    }
    try {
      let value;
      if (endpoint === DELIVERY_ENDPOINTS.listDsBotSessions) {
        value = await service.listDsBotSessions();
      } else if (endpoint === DELIVERY_ENDPOINTS.dsBotStatus) {
        value = await service.dsBotStatus(payload.botId);
      } else if (endpoint === DELIVERY_ENDPOINTS.bindDsBot) {
        value = await service.bindDsBot(payload.botId, payload.conversationKey, payload.dsBotId);
      } else if (endpoint === DELIVERY_ENDPOINTS.unbindDsBot) {
        value = await service.unbindDsBot(payload.botId, payload.conversationKey);
      } else if (endpoint === DELIVERY_ENDPOINTS.send) {
        value = await service.send(payload.botId, payload.targetId, payload.text, {
          signal,
          ...(payload.format === undefined ? {} : { format: payload.format }),
        });
      } else if (endpoint === DELIVERY_ENDPOINTS.listTargets) {
        value = await service.listTargets(payload.botId);
      } else if (endpoint === DELIVERY_ENDPOINTS.listSuggestions) {
        value = await service.listSuggestions(payload.botId);
      } else if (endpoint === DELIVERY_ENDPOINTS.createTarget) {
        value = await service.createTarget(payload.botId, payload.target);
      } else if (endpoint === DELIVERY_ENDPOINTS.updateTarget) {
        value = await service.updateTarget(payload.botId, payload.targetId, payload.target);
      } else if (endpoint === DELIVERY_ENDPOINTS.deleteTarget) {
        value = await service.deleteTarget(payload.botId, payload.targetId);
      } else if (endpoint === DELIVERY_ENDPOINTS.setSessionSync) {
        if (typeof service.setSessionSync !== 'function') {
          throw new TypeError('Session sync is unavailable');
        }
        value = await service.setSessionSync(payload.botId, payload.targetId, payload.enabled);
      } else {
        value = await service.send(
          payload.botId,
          Object.hasOwn(payload, 'target') ? payload.target : payload.targetId,
          DELIVERY_TEST_MESSAGE,
          { signal },
        );
      }
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
  };
}

export function installDeliveryRpc(ctx, service, { authority } = {}) {
  return registerManagementRpc(ctx,
    DELIVERY_RPC_CHANNEL,
    createDeliveryRpcHandler(service),
    { authority: resolveRpcAuthority(authority) },
  );
}
