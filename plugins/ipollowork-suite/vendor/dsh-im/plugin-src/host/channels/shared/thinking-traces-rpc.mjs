export const SET_THINKING_TRACES_ENDPOINT = 'bot.thinking-traces.set';

export function validThinkingTracesPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Reflect.ownKeys(payload).length !== 2
    || !Object.hasOwn(payload, 'botId') || !Object.hasOwn(payload, 'thinkingTraces')
    || typeof payload.botId !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.botId)
    || typeof payload.thinkingTraces !== 'boolean') return false;
  return true;
}
