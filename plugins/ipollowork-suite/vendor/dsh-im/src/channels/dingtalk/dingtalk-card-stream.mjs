import { t } from '../shared/i18n.mjs';

const DEFAULT_UPDATE_INTERVAL_MS = 500;
const CLOSED_TEXT = '卡片已结束，请查看后续消息。';

function requiredText(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  return value;
}

function requiredCredential(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} is required`);
  }
  return value.trim();
}

/**
 * Creates one throttled DingTalk AI Card update stream.
 *
 * The stream owns a single card instance. Progress updates use latest-wins
 * buffering, while finish waits for an active update before sending the final
 * card content.
 *
 * @param {object} options Stream dependencies and DingTalk request data.
 * @param {object} options.api DingTalk AI Card API implementation.
 * @param {string} options.clientId DingTalk application client id.
 * @param {string} options.clientSecret DingTalk application client secret.
 * @param {unknown} options.target DingTalk card delivery target.
 * @param {AbortSignal} [options.signal] Stream cancellation signal.
 * @param {object} [options.logger] Safe diagnostic sink.
 * @param {number} [options.updateIntervalMs=500] Minimum delay between updates.
 * @param {()=>number} [options.clock] Monotonic millisecond clock.
 * @param {{setTimeout: Function, clearTimeout: Function}} [options.timer] Timer implementation.
 * @returns {{start(initialText: string): Promise<boolean>, push(progressText: string): void, finish(finalText: string): Promise<boolean>, readonly providerMessageIds: string[]}}
 * Card stream controller.
 */
export function createDingTalkCardStream({
  api,
  clientId,
  clientSecret,
  target,
  signal,
  logger = console,
  updateIntervalMs = DEFAULT_UPDATE_INTERVAL_MS,
  clock = () => Date.now(),
  timer = {
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
  },
} = {}) {
  if (!api
    || typeof api.createAiCard !== 'function'
    || typeof api.updateAiCard !== 'function'
    || typeof api.finishAiCard !== 'function') {
    throw new TypeError('DingTalk AI Card API is required');
  }
  const normalizedClientId = requiredCredential(clientId, 'clientId');
  const normalizedClientSecret = requiredCredential(clientSecret, 'clientSecret');
  if (target === undefined || target === null) throw new TypeError('target is required');
  if (!Number.isFinite(updateIntervalMs) || updateIntervalMs < 0) {
    throw new TypeError('updateIntervalMs must be a non-negative number');
  }
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (typeof timer?.setTimeout !== 'function' || typeof timer?.clearTimeout !== 'function') {
    throw new TypeError('timer must provide setTimeout and clearTimeout');
  }

  const readClock = () => {
    const value = clock();
    if (!Number.isFinite(value)) throw new TypeError('clock must return a finite timestamp');
    return value;
  };
  readClock();

  let phase = signal?.aborted ? 'aborted' : 'idle';
  let cardRequest = null;
  let pendingText = null;
  let scheduledUpdate = null;
  let updateWorker = null;
  let finishPromise = null;
  let cleanupPromise = null;
  let lastUpdateAt = 0;

  const clearScheduledUpdate = () => {
    if (scheduledUpdate === null) return;
    timer.clearTimeout(scheduledUpdate);
    scheduledUpdate = null;
  };

  const removeAbortListener = () => signal?.removeEventListener('abort', onAbort);

  const close = (nextPhase) => {
    phase = nextPhase;
    pendingText = null;
    clearScheduledUpdate();
    removeAbortListener();
  };

  const cleanupCard = () => {
    if (!cardRequest || typeof api.failAiCard !== 'function') return Promise.resolve(false);
    if (!cleanupPromise) {
      cleanupPromise = api.failAiCard({
        ...cardRequest,
        text: t(CLOSED_TEXT),
        signal: AbortSignal.timeout(5_000),
      }).then(
        () => true,
        () => false,
      );
    }
    return cleanupPromise;
  };

  const fail = (operation) => {
    if (phase === 'failed' || phase === 'finished' || phase === 'aborted') return;
    void cleanupCard();
    close('failed');
    logger?.error?.(`[dsh-dingtalk] AI Card ${operation} failed`);
  };

  function onAbort() {
    if (phase === 'finished' || phase === 'failed' || phase === 'aborted') return;
    void cleanupCard();
    close('aborted');
  }

  if (phase !== 'aborted') signal?.addEventListener('abort', onAbort, { once: true });

  const launchUpdate = () => {
    if (phase !== 'active' || updateWorker || pendingText === null) return;
    const delay = Math.max(0, lastUpdateAt + updateIntervalMs - readClock());
    if (delay > 0) {
      scheduledUpdate = timer.setTimeout(() => {
        scheduledUpdate = null;
        launchUpdate();
      }, delay);
      return;
    }

    const text = pendingText;
    pendingText = null;
    updateWorker = (async () => {
      try {
        await api.updateAiCard({ ...cardRequest, text, finished: false });
        lastUpdateAt = readClock();
      } catch {
        if (signal?.aborted || phase === 'aborted') return;
        fail('update');
      }
    })().finally(() => {
      updateWorker = null;
      if (phase === 'active' && pendingText !== null) launchUpdate();
    });
  };

  const start = async (initialText) => {
    requiredText(initialText, 'initialText');
    if (phase !== 'idle') return false;
    phase = 'starting';
    try {
      const created = await api.createAiCard({
        clientId: normalizedClientId,
        clientSecret: normalizedClientSecret,
        target,
        initialText,
        signal,
      });
      const cardInstanceId = typeof created?.cardInstanceId === 'string'
        ? created.cardInstanceId.trim()
        : '';
      if (!cardInstanceId) throw new TypeError('DingTalk did not return a card instance id');
      cardRequest = Object.freeze({
        clientId: normalizedClientId,
        clientSecret: normalizedClientSecret,
        target,
        cardInstanceId,
        signal,
      });
      if (phase !== 'starting') {
        void cleanupCard();
        return false;
      }
      lastUpdateAt = readClock();
      phase = 'active';
      return true;
    } catch {
      if (signal?.aborted || phase === 'aborted') {
        close('aborted');
        return false;
      }
      fail('creation');
      return false;
    }
  };

  const push = (progressText) => {
    requiredText(progressText, 'progressText');
    if (phase !== 'active') return;
    pendingText = progressText;
    if (!scheduledUpdate && !updateWorker) launchUpdate();
  };

  const finish = (finalText) => {
    requiredText(finalText, 'finalText');
    if (phase === 'finished') return Promise.resolve(true);
    if (phase === 'finishing') return finishPromise;
    if (phase !== 'active') return Promise.resolve(false);

    phase = 'finishing';
    pendingText = null;
    clearScheduledUpdate();
    const activeUpdate = updateWorker;
    finishPromise = (async () => {
      if (activeUpdate) await activeUpdate;
      if (phase !== 'finishing') return false;
      try {
        await api.finishAiCard({ ...cardRequest, text: finalText });
        if (phase !== 'finishing') return false;
        close('finished');
        return true;
      } catch {
        if (signal?.aborted || phase === 'aborted') {
          close('aborted');
          return false;
        }
        fail('finish');
        return false;
      }
    })();
    return finishPromise;
  };

  return Object.freeze({
    start,
    push,
    finish,
    get providerMessageIds() {
      return cardRequest?.cardInstanceId ? [cardRequest.cardInstanceId] : [];
    },
  });
}
