export const DEFAULT_CONVERSATION_DIRECTORY = Object.freeze({
  enabled: false,
  strategy: 'per-conversation',
  prefix: 'conv-',
});

export function validateConversationDirectory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !['enabled', 'strategy', 'prefix'].includes(key))
    || typeof value.enabled !== 'boolean'
    || (value.strategy !== undefined && !['per-conversation', 'per-session'].includes(value.strategy))
    || (value.prefix !== undefined && (typeof value.prefix !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(value.prefix)))) {
    const error = new Error('会话目录设置无效：前缀须为 1–32 位字母、数字、下划线或连字符。');
    error.code = 'conversation-directory-invalid';
    throw error;
  }
  return { ...DEFAULT_CONVERSATION_DIRECTORY, ...value };
}

export function normalizeConversationDirectory(value) {
  if (value === null || value === undefined) return null;
  try { return validateConversationDirectory(value); } catch { return null; }
}

export function workspaceManualEditDisabled() {
  const error = new Error('会话目录隔离已开启，无法手动修改工作区。');
  error.code = 'workspace-manual-edit-disabled';
  return error;
}
