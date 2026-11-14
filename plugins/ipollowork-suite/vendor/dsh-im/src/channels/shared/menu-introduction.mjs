import { t } from './i18n.mjs';

/**
 * Optional persisted introduction attempts; old state files remain valid.
 * @param {object} value Parsed channel state.
 * @returns {object} The optional normalized field.
 */
export function menuIntroductionFields(value) {
  const entries = Array.isArray(value?.menuIntroductions)
    ? [...new Set(value.menuIntroductions.filter(key => typeof key === 'string' && key))] : [];
  return entries.length ? { menuIntroductions: entries } : {};
}

/**
 * Record before delivery so concurrent callbacks and restarts cannot repeat a guide.
 * A failed delivery remains recorded; explicit /menu and /help requests still work.
 * @param {object} options Accessors for the owning channel state and its writer.
 * @returns {object} State methods for one-time introductions.
 */
export function createMenuIntroductionSupport({ state, persist }) {
  const pending = new Map();
  const mark = async key => {
    if (!key || (state().menuIntroductions ?? []).includes(key)) return;
    const document = state();
    document.menuIntroductions = [...(document.menuIntroductions ?? []), key];
    await persist();
  };
  return {
    needsMenuIntroduction(key) {
      return Boolean(key) && !(state().menuIntroductions ?? []).includes(key);
    },
    markMenuIntroduction: mark,
    introduceMenu(key, show, { signal, logger = console } = {}) {
      if (pending.has(key)) return pending.get(key);
      if (!key || (state().menuIntroductions ?? []).includes(key)) return Promise.resolve(false);
      const task = Promise.resolve().then(async () => {
        signal?.throwIfAborted();
        await mark(key);
        signal?.throwIfAborted();
        await show();
        return true;
      }).catch(error => {
        if (!signal?.aborted) logger.warn?.('[ipollo-im] Initial menu unavailable; use /menu or /help to open it.');
        return false;
      }).finally(() => pending.delete(key));
      pending.set(key, task);
      return task;
    },
  };
}

/**
 * Text fallback for channels without a native menu or interactive buttons.
 * @returns {string} Localized instructions for the existing commands.
 */
export function menuIntroductionText() {
  return [
    t('欢迎使用 iPolloWork'),
    t('直接发送问题、图片或语音即可开始。常用操作：'),
    `${t('新会话')}  /new`,
    `${t('切换模型')}  /models`,
    `${t('切换智能体')}  /presets`,
    `${t('查看状态')}  /status`,
    `${t('停止任务')}  /stop`,
    `${t('更多操作')}  /help`,
  ].join('\n');
}
