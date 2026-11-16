import { isSessionNotFound } from './session-error.mjs';
import { createDeferredDeliveryRegistry, extractCompletedTurnAnswer } from './deferred-delivery.mjs';
import { t } from './i18n.mjs';
import { channelDeliveryFailure } from './message-failure.mjs';
import { PromptFailureTracker } from './prompt-failure-tracker.mjs';

export function deferredOutcomeText(outcome) {
  if (outcome.found && outcome.text) return outcome.text;
  const reason = outcome.reason === 'stopped' ? t('已停止')
    : ['aborted', 'cancelled'].includes(outcome.reason) ? t('已中止')
      : ['failed', 'error'].includes(outcome.reason) ? t('任务失败') : t('已结束');
  return t('后台任务已结束（{reason}），没有可推送的最终结果。', { reason });
}

function orderedEvents(history) {
  return (Array.isArray(history?.events) ? history.events : [])
    .map((row) => row?.event ?? row)
    .filter((event) => Number.isSafeInteger(event?.seq) && event.seq >= 0)
    .sort((a, b) => a.seq - b.seq);
}

/** One coordinator per bot. All history reads, sends, removal and stops for a
 * Session use the same queue. Queued work stores ids, never stale entry objects.
 * Durable pending rows survive crashes; there is no persisted pre-send claim.
 */
export function createDeferredDeliveryCoordinator({
  harness, state, deliver, signal, logger = console,
  retryDelayMs = 1_000, pollDelayMs = 30_000, watch = true,
  finalAnswerOnly = false,
} = {}) {
  const enabled = ['deferredEntries', 'putDeferred', 'patchDeferred', 'removeDeferred']
    .every((name) => typeof state?.[name] === 'function');
  const controller = new AbortController();
  const activeSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const tails = new Map();
  const timers = new Map();
  const registry = createDeferredDeliveryRegistry({
    listDeferred: async () => state.deferredEntries(),
    putDeferred: (entry) => state.putDeferred(entry),
    patchDeferred: (id, patch) => state.patchDeferred(id, patch),
    removeDeferred: (id) => state.removeDeferred(id),
  }, { logger });
  const warn = (error) => { if (!activeSignal.aborted) logger.warn?.('[dsh-im] deferred delivery:', error?.message ?? String(error)); };
  const pending = async (id) => (await registry.allPending()).find((entry) => entry.id === id);
  const bound = (entry) => !activeSignal.aborted && state.sessionFor(entry.key) === entry.sessionId;
  function enqueue(sessionId, operation) {
    const previous = tails.get(sessionId) ?? Promise.resolve();
    const task = previous.then(() => activeSignal.aborted ? undefined : operation());
    const tail = task.catch(warn).finally(() => { if (tails.get(sessionId) === tail) tails.delete(sessionId); });
    tails.set(sessionId, tail);
    return task;
  }
  function schedule(entry, delay = pollDelayMs) {
    if (activeSignal.aborted || timers.has(entry.id)) return;
    const timer = setTimeout(() => {
      timers.delete(entry.id);
      void enqueue(entry.sessionId, () => process(entry.id)).catch(warn);
    }, delay);
    timer.unref?.();
    timers.set(entry.id, timer);
  }
  function clearTimer(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
  }
  async function remove(entry) {
    clearTimer(entry.id);
    await registry.remove(entry);
  }
  async function readOutcome(entry) {
    // A result may be older than the latest history page after a restart.
    // Recover the whole target turn instead of treating a missing page as empty.
    const events = new Map();
    const historySignal = AbortSignal.any([activeSignal, AbortSignal.timeout(30_000)]);
    let beforeSeq;
    let targetTurn = Number.isSafeInteger(entry.turn) ? entry.turn : null;
    for (let page = 0; page < 20; page += 1) {
      historySignal.throwIfAborted();
      const history = await harness.rpc('session.history', {
        sessionId: entry.sessionId, maxMessages: 100,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
      }, 30_000, { signal: historySignal });
      const batch = orderedEvents(history);
      for (const event of batch) events.set(event.seq, event);
      const ordered = [...events.values()].sort((a, b) => a.seq - b.seq);
      if (targetTurn === null && entry.promptRpcId) {
        let openTurn = null;
        const earlyFailure = new PromptFailureTracker(entry.promptRpcId, entry.afterSeq);
        for (const event of ordered) {
          const failedTurn = earlyFailure.consume(event);
          if (failedTurn !== null) { targetTurn = failedTurn; break; }
          if (event.type === 'turn/start') openTurn = event.data?.turn ?? null;
          if (event.type === 'user/message' && event.data?.source?.rpcId === entry.promptRpcId) {
            targetTurn = Number.isSafeInteger(event.data?.turn) ? event.data.turn : openTurn;
            break;
          }
          if (event.type === 'turn/end') openTurn = null;
        }
      }
      const reachedCursor = !history.hasMore || ordered[0]?.seq <= entry.afterSeq;
      if (targetTurn === null && !entry.promptRpcId && reachedCursor) {
        // Legacy #153 rows had no prompt identity. Never select a completion
        // preceding the saved cursor, or a newer arbitrary completed turn.
        targetTurn = ordered.find((event) => event.type === 'turn/end'
          && event.seq > entry.afterSeq)?.data?.turn ?? null;
      }
      const outcome = targetTurn === null
        ? { found: false, endSeq: -1, turn: null }
        : extractCompletedTurnAnswer(ordered, { turn: targetTurn, finalAnswerOnly });
      const hasStart = ordered.some((event) => event.type === 'turn/start' && event.data?.turn === targetTurn);
      if (!history.hasMore || hasStart) return { ...outcome, turn: targetTurn };
      const oldest = batch[0]?.seq;
      if (!Number.isSafeInteger(oldest) || oldest === beforeSeq) break;
      beforeSeq = oldest;
    }
    // Bounded reads cannot prove that a truncated answer is complete.
    return { found: false, endSeq: -1, turn: targetTurn };
  }
  async function process(id, { stopping = false, urgent = false } = {}) {
    let entry = await pending(id);
    if (!entry || activeSignal.aborted) return 'none';
    clearTimer(id);
    if (!bound(entry)) { await remove(entry); return 'none'; }
    let sending = false;
    try {
      const outcome = await readOutcome(entry);
      // Binding, status and cancellation can change while the RPC is in flight.
      entry = await pending(id);
      if (!entry || activeSignal.aborted) return 'none';
      if (!bound(entry)) { await remove(entry); return 'none'; }
      if (outcome.endSeq === -1) {
        if (Number.isSafeInteger(outcome.turn) && entry.turn !== outcome.turn) {
          await state.patchDeferred(id, { turn: outcome.turn });
          entry = { ...entry, turn: outcome.turn };
        }
        if (stopping) {
          const session = harness.workspaceSession?.(entry.sessionId, entry.key);
          const stopped = typeof session?.stopDeferredTurn === 'function'
            ? await session.stopDeferredTurn({ turn: entry.turn, promptRpcId: entry.promptRpcId }, {
                signal: activeSignal, isCurrent: () => bound(entry),
              })
            : typeof harness.stopDeferredTurn === 'function'
              ? await harness.stopDeferredTurn(entry.sessionId, { turn: entry.turn, promptRpcId: entry.promptRpcId }, {
                  signal: activeSignal, isCurrent: () => bound(entry),
                }) : false;
          schedule(entry, retryDelayMs);
          return stopped ? 'stopped' : 'unavailable';
        }
        schedule(entry, urgent ? retryDelayMs : pollDelayMs);
        return 'waiting';
      }
      sending = true;
      const result = await deliver(entry, outcome);
      if (result === false || result?.deliveryOutcome === 'failed' || result?.deliveryOutcome === 'unknown') {
        throw Object.assign(new Error('Deferred delivery was not confirmed'), {
          deliveryOutcome: result?.deliveryOutcome ?? 'failed',
        });
      }
      await remove(entry);
      return 'delivered';
    } catch (error) {
      if (activeSignal.aborted) return 'none';
      if (isSessionNotFound(error?.code)) { await remove(entry); return 'none'; }
      const current = await pending(id);
      if (!current) return 'none';
      if (!sending) {
        warn(error);
        schedule(current);
        return stopping ? 'unavailable' : 'waiting';
      }
      const uncertain = error?.deliveryOutcome === 'unknown'
        || (error?.deliveryOutcome !== 'failed'
          && channelDeliveryFailure(error).code === 'channel-delivery-uncertain');
      if (uncertain) {
        // The provider may already have accepted the message. Preserve the
        // existing delivery-uncertain rule instead of retrying a possible copy.
        await state.patchDeferred(id, { status: 'failed', deliveryOutcome: 'unknown', attempts: (current.attempts ?? 0) + 1 });
        warn(error);
        return stopping ? 'unavailable' : 'unknown';
      }
      const attempts = await registry.markFailedAttempt(current);
      warn(error);
      if (attempts < 3) schedule(current, retryDelayMs * 2 ** (attempts - 1));
      return stopping ? 'unavailable' : 'retry';
    }
  }
  async function resume() {
    if (!enabled || activeSignal.aborted) return;
    const entries = await registry.allPending();
    await Promise.allSettled(entries.map((entry) => enqueue(entry.sessionId, () => process(entry.id))));
  }
  const startup = Promise.resolve().then(async () => {
    if (!enabled || activeSignal.aborted) return;
    if (watch && typeof harness.watchHarnessEvents === 'function') {
      try {
        Promise.resolve(harness.watchHarnessEvents({ signal: activeSignal,
          onSessionEvent: (payload) => { void api.onEvent(payload).catch(warn); },
          onReconnect: () => { void resume().catch(warn); },
        })).catch(warn);
      } catch (error) { warn(error); }
    }
    await resume();
  }).catch(warn);
  activeSignal.addEventListener('abort', () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }, { once: true });
  const api = {
    async trackTimeout(error, { key, sessionId, ...delivery }) {
      if (!enabled || error?.code !== 'harness-reply-timeout' || activeSignal.aborted) return;
      const details = error.details ?? {};
      const target = details.sessionId ?? sessionId ?? state.sessionFor(key);
      if (!target || state.sessionFor(key) !== target) return;
      const entry = await registry.register({ key, sessionId: target,
        turn: details.turn, promptRpcId: details.promptRpcId,
        afterSeq: details.baselineSeq ?? details.lastSeq ?? -1,
        ...delivery,
      });
      void enqueue(target, () => process(entry.id)).catch(warn);
    },
    async onEvent({ sessionId, event } = {}) {
      if (!enabled || activeSignal.aborted || event?.type !== 'turn/end') return;
      const entries = await registry.pendingForSession(sessionId);
      await Promise.allSettled(entries
        .filter((entry) => !Number.isSafeInteger(entry.turn) || entry.turn === event.data?.turn)
        .map((entry) => enqueue(sessionId, () => process(entry.id, { urgent: true }))));
    },
    resume,
    async stop(key) {
      if (!enabled || activeSignal.aborted) return 'none';
      const entries = await registry.pendingForKey(key);
      let outcome = 'none';
      for (const entry of entries) {
        const result = await enqueue(entry.sessionId, () => process(entry.id, { stopping: true }));
        if (result === 'stopped') outcome = 'stopped';
        else if (result === 'unavailable' && outcome !== 'stopped') outcome = 'unavailable';
      }
      return outcome;
    },
    async whenIdle() {
      await startup;
      while (tails.size) await Promise.allSettled([...tails.values()]);
    },
    close() { controller.abort(); },
  };
  return api;
}
