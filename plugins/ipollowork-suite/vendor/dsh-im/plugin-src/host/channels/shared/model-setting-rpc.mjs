import { normalizeModelSelection } from '../../../../src/channels/shared/model-setting.mjs';

export const SET_MODEL_ENDPOINT = 'bot.model.set';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validModelPayload(payload) {
  if (!isRecord(payload)
    || !Object.keys(payload).every((key) => ['botId', 'model'].includes(key))
    || typeof payload.botId !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.botId)) return false;
  if (payload.model === null) return true;
  return isRecord(payload.model)
    && Object.keys(payload.model).every((key) => ['provider', 'model', 'reasoningEffort'].includes(key))
    && normalizeModelSelection(payload.model) !== null;
}
