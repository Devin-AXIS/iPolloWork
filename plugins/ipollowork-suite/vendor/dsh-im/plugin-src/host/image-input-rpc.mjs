import { normalizeImageInputSettings } from '../../src/channels/shared/image-input-policy.mjs';

export const IMAGE_INPUT_ENDPOINTS = Object.freeze({
  get: 'settings.image-input.get',
  set: 'settings.image-input.set',
});

export function createImageInputRpcHandler(store) {
  return async (endpoint, payload, signal) => {
    const object = payload && typeof payload === 'object' && !Array.isArray(payload);
    const valid = object && (endpoint === IMAGE_INPUT_ENDPOINTS.get
      ? Object.keys(payload).length === 0
      : endpoint === IMAGE_INPUT_ENDPOINTS.set && Object.keys(payload).length === 4
        && normalizeImageInputSettings(payload));
    if (!valid) return { ok: false, error: { code: 'bad-request', message: '图片限制无效：请输入正整数，原图接收上限和总量上限不能小于单图上限。' } };
    if (signal?.aborted) return { ok: false, error: { code: 'cancelled', message: 'Request cancelled.' } };
    try {
      const value = endpoint === IMAGE_INPUT_ENDPOINTS.get ? await store.get() : await store.set(payload);
      return { ok: true, value };
    } catch {
      return { ok: false, error: { code: 'image-input-settings-unavailable', message: '无法读取或保存图片设置，请稍后重试。' } };
    }
  };
}
