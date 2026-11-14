import { validateAccessPolicy } from '../../../../src/channels/shared/access-policy.mjs';

export const SET_ACCESS_POLICY_ENDPOINT = 'bot.access-policy.set';

export function validAccessPolicyPayload(payload) {
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Reflect.ownKeys(payload).length !== 2
      || !Object.hasOwn(payload, 'botId') || !Object.hasOwn(payload, 'policy')
      || typeof payload.botId !== 'string'
      || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.botId)) return false;
    validateAccessPolicy(payload.policy);
    return true;
  } catch {
    return false;
  }
}
