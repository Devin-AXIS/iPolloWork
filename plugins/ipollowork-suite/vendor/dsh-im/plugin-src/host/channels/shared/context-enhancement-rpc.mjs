import { validateContextEnhancementConfig } from '../../../../src/channels/shared/context-enhancement.mjs';

export const SET_CONTEXT_ENHANCEMENT_ENDPOINT = 'bot.context-enhancement.set';

export function validContextEnhancementPayload(payload) {
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Reflect.ownKeys(payload).length !== 2
      || !Object.hasOwn(payload, 'botId') || !Object.hasOwn(payload, 'config')
      || typeof payload.botId !== 'string'
      || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.botId)) return false;
    validateContextEnhancementConfig(payload.config);
    return true;
  } catch {
    return false;
  }
}
