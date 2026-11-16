import { AGENT_PRESET_ID } from '../../../../src/channels/shared/agent-preset.mjs';

export const SET_AGENT_PRESET_ENDPOINT = 'bot.preset.set';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validAgentPresetPayload(payload) {
  return isRecord(payload)
    && Object.keys(payload).every((key) => ['botId', 'agentPreset'].includes(key))
    && typeof payload.botId === 'string'
    && /^[A-Za-z0-9_-]{1,128}$/.test(payload.botId)
    && (payload.agentPreset === null
      || (typeof payload.agentPreset === 'string' && AGENT_PRESET_ID.test(payload.agentPreset)));
}

export function publicAgentPresetError(error) {
  if (![
    'agent-preset-invalid',
    'agent-preset-unavailable',
    'workspace-bot-not-found',
  ].includes(error?.code)) return null;
  return { code: error.code, message: error.message };
}
