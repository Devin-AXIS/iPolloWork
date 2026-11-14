import { validateBotAlias } from '../../../../src/channels/shared/bot-alias.mjs';
export { SET_ALIAS_ENDPOINT } from '../../../../src/channels/shared/bot-alias.mjs';

export function validAliasPayload(payload) {
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).length !== 2
      || typeof payload.botId !== 'string'
      || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.botId)) return false;
    validateBotAlias(payload.alias);
    return true;
  } catch {
    return false;
  }
}
