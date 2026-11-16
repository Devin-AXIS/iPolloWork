export { SET_SEND_LIMIT_ENDPOINT } from '../../../../src/channels/shared/send-limit.mjs';

export function validSendLimitPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Reflect.ownKeys(payload).length !== 2
    || !Object.hasOwn(payload, 'botId') || !Object.hasOwn(payload, 'sendLimitPerMinute')
    || typeof payload.botId !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.botId)) return false;
  // The value is only checked for shape: the controller clamps it, so a bad
  // form entry can never leave a bot unusable.
  const value = payload.sendLimitPerMinute;
  return typeof value === 'number' || typeof value === 'string';
}
