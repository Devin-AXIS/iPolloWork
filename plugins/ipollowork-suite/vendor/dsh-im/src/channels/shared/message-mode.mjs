export const SET_MESSAGE_MODE_ENDPOINT = 'bot.message-mode.set';

export function normalizeBusyMessageMode(value) {
  return value === 'steer' ? 'steer' : 'queue';
}

export function validateBusyMessageMode(value) {
  if (value !== 'queue' && value !== 'steer') {
    throw new TypeError('Message mode must be queue or steer');
  }
  return value;
}

export function validMessageModePayload(payload) {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    && Object.keys(payload).length === 2
    && typeof payload.botId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(payload.botId)
    && (payload.busyMessageMode === 'queue' || payload.busyMessageMode === 'steer');
}
