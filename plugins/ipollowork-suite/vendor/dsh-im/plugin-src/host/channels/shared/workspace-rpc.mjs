import { isAbsolute } from 'node:path';

export const SET_WORKSPACE_ENDPOINT = 'bot.workspace.set';

export function validWorkspacePayload(payload) {
  return payload !== null
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && Object.keys(payload).every((key) => ['botId', 'workspace'].includes(key))
    && typeof payload.botId === 'string'
    && /^[A-Za-z0-9_-]{1,128}$/.test(payload.botId)
    && typeof payload.workspace === 'string'
    && payload.workspace.length <= 4_096
    && isAbsolute(payload.workspace.trim());
}

export function publicWorkspaceError(error) {
  if (![
    'workspace-manual-edit-disabled',
    'conversation-directory-invalid',
    'workspace-not-absolute',
    'workspace-not-found',
    'workspace-not-directory',
    'workspace-bot-not-found',
    'agent-preset-invalid',
    'agent-preset-unavailable',
    'model-selection-invalid',
    'model-selection-unavailable',
    'model-catalog-unavailable',
    'model-reasoning-unavailable',
    'context-enhancement-invalid',
    'access-policy-invalid',
  ].includes(error?.code)) return null;
  return { code: error.code, message: error.message };
}
