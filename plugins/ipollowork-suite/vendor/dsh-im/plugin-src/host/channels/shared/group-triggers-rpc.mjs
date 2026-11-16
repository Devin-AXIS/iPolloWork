/**
 * Management RPC for Telegram's per-group reply rules.
 *
 * Kept out of `TOKEN_BOT_ENDPOINTS`: those are shared by every token channel,
 * and per-group triggers only exist for Telegram.
 */
import { normalizeGroupTriggers } from '../../../../src/channels/telegram/group-triggers.mjs';

export const GROUP_TRIGGERS_ENDPOINTS = Object.freeze({
  get: 'bot.group-triggers.get',
  set: 'bot.group-triggers.set',
  resolve: 'bot.group-triggers.resolve',
});

const ENDPOINTS = Object.freeze(Object.values(GROUP_TRIGGERS_ENDPOINTS));
const BOT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_REFERENCE_LENGTH = 2_048;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function validBotId(value) {
  return typeof value === 'string' && BOT_ID.test(value);
}

function validRemoved(value) {
  return value === undefined || (Array.isArray(value)
    && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0 && entry.length <= 64));
}

/** Normalized rules, or null when the payload cannot be saved. */
export function validGroupTriggersConfig(value) {
  try {
    return normalizeGroupTriggers(value);
  } catch {
    return null;
  }
}

export function validGroupTriggersPayload(endpoint, payload) {
  if (!isRecord(payload)) return false;
  if (endpoint === GROUP_TRIGGERS_ENDPOINTS.get) {
    return exactKeys(payload, ['botId']) && validBotId(payload.botId);
  }
  if (endpoint === GROUP_TRIGGERS_ENDPOINTS.set) {
    return exactKeys(payload, ['botId', 'config', 'removed'])
      && validBotId(payload.botId)
      && validGroupTriggersConfig(payload.config) !== null
      && validRemoved(payload.removed);
  }
  return exactKeys(payload, ['botId', 'input'])
    && validBotId(payload.botId)
    && typeof payload.input === 'string'
    && payload.input.trim().length > 0
    && payload.input.length <= MAX_REFERENCE_LENGTH;
}

function operationError(error) {
  if (error?.code === 'group-triggers-invalid') {
    return { code: 'group-triggers-invalid', message: error.message };
  }
  return {
    code: 'group-triggers-failed',
    message: typeof error?.message === 'string' && error.message
      ? error.message : 'Group trigger settings are unavailable.',
  };
}

/**
 * Handle one of the group-trigger endpoints.
 *
 * Returns null for any other endpoint so the caller can fall through to the
 * regular token-bot handler.
 */
export function createGroupTriggersRpcHandler(controller) {
  return async (endpoint, payload, signal) => {
    if (!ENDPOINTS.includes(endpoint)) return null;
    if (signal?.aborted) {
      return { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } };
    }
    if (!validGroupTriggersPayload(endpoint, payload)) {
      return { ok: false, error: { code: 'bad-request', message: 'Invalid group trigger request.' } };
    }
    try {
      if (endpoint === GROUP_TRIGGERS_ENDPOINTS.get) {
        if (typeof controller.groupTriggersPanel !== 'function') throw new Error('Group trigger settings are unavailable.');
        return { ok: true, value: await controller.groupTriggersPanel(payload.botId) };
      }
      if (endpoint === GROUP_TRIGGERS_ENDPOINTS.set) {
        if (typeof controller.updateGroupTriggers !== 'function') throw new Error('Group trigger settings are unavailable.');
        return {
          ok: true,
          value: await controller.updateGroupTriggers(payload.botId, {
            config: payload.config,
            removed: payload.removed ?? [],
          }),
        };
      }
      if (typeof controller.resolveGroupTrigger !== 'function') throw new Error('Group lookup is unavailable.');
      return { ok: true, value: await controller.resolveGroupTrigger(payload.botId, payload.input) };
    } catch (error) {
      return { ok: false, error: operationError(error) };
    }
  };
}
