export const GROUP_HISTORY_ENDPOINTS = Object.freeze({
  get: 'settings.group-history.get', set: 'settings.group-history.set',
});

export function createGroupHistoryRpcHandler(store) {
  return async (endpoint, payload, signal) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || signal?.aborted) {
      return { ok: false, error: { code: 'bad-request', message: '群记录设置请求无效。' } };
    }
    const keys = Object.keys(payload).sort().join(',');
    try {
      let value;
      if (endpoint === GROUP_HISTORY_ENDPOINTS.get && keys === '') value = await store.settings();
      else if (endpoint === GROUP_HISTORY_ENDPOINTS.set && keys === 'groupHistoryRetentionDays') value = await store.setRetentionDays(payload.groupHistoryRetentionDays);
      else throw new Error('群记录设置请求无效。');
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: { code: error.code ?? 'group-history-unavailable',
        message: error.code === 'group-history-invalid' ? error.message : '无法读取或保存群记录设置，请稍后重试。' } };
    }
  };
}
