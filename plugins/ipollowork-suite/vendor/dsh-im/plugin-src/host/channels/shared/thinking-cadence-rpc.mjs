export { SET_THINKING_CADENCE_ENDPOINT } from '../../../../src/channels/shared/thinking-cadence.mjs';

export function validThinkingCadencePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Reflect.ownKeys(payload).length !== 3
    || !Object.hasOwn(payload, 'botId')
    || !Object.hasOwn(payload, 'thinkingNumbering')
    || !Object.hasOwn(payload, 'thinkingIntervalSeconds')
    || typeof payload.botId !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.botId)
    || typeof payload.thinkingNumbering !== 'boolean') return false;
  // The interval is only checked for shape: the controller clamps it, so a bad
  // form entry can never leave a bot stuck at an unusable pace.
  const value = payload.thinkingIntervalSeconds;
  return typeof value === 'number' || typeof value === 'string';
}
