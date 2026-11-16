const DEFAULT_TIMEOUT_MS = 2_000;

const NOOP_REACTION = Object.freeze({
  success() {},
  error() {},
  clear() {},
  settled: () => Promise.resolve(),
});

function increment(status, key) {
  if (!status || typeof status !== 'object') return;
  status[key] = (status[key] ?? 0) + 1;
}

async function runWithTimeout(operation, timeoutMs) {
  const signal = AbortSignal.timeout(timeoutMs);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException('Timed out', 'TimeoutError'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([operation(signal), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Starts a best-effort status reaction lifecycle which is deliberately not
 * part of the caller's message queue. Calls are serialized only for this one
 * source message; every provider operation is bounded and absorbs failures.
 */
export function beginStatusReaction({
  adapter,
  target,
  reactions,
  status,
  logger = console,
  label = 'channel',
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!target
    || typeof adapter?.addReaction !== 'function'
    || typeof adapter?.removeReaction !== 'function'
    || typeof reactions?.processing !== 'string'
    || !reactions.processing
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0) return NOOP_REACTION;

  let currentReaction = null;
  let terminal = false;

  const safely = async (kind, operation) => {
    try {
      const value = await runWithTimeout(operation, timeoutMs);
      increment(status, kind === 'add' ? 'reactionsAdded' : 'reactionsRemoved');
      return { ok: true, value };
    } catch (cause) {
      increment(status, 'reactionErrors');
      logger.warn?.(
        `[dsh-im:${label}] status reaction ${kind} failed:`,
        cause?.message ?? cause?.name ?? String(cause),
      );
      return { ok: false, value: null };
    }
  };

  // `emoji` may be null: the transition then only removes the previous
  // reaction, which is how a channel asks for a clean message at the end.
  const transition = async (emoji) => {
    if (currentReaction !== null) {
      const previous = currentReaction;
      currentReaction = null;
      await safely('remove', (signal) => adapter.removeReaction(
        target,
        previous,
        { signal },
      ));
    }
    if (typeof emoji !== 'string' || !emoji) return;
    const added = await safely('add', (signal) => adapter.addReaction(
      target,
      emoji,
      { signal },
    ));
    if (added.ok && added.value !== undefined && added.value !== null) {
      currentReaction = added.value;
    }
  };

  // Calling an async function starts the provider request synchronously up to
  // its first await, while the returned tail remains completely detached from
  // normal message processing.
  let tail = transition(reactions.processing);
  const finish = (emoji) => {
    if (terminal) return;
    terminal = true;
    tail = tail.then(() => transition(emoji), () => transition(emoji));
    void tail.catch(() => undefined);
  };

  return Object.freeze({
    success: () => finish(reactions.success),
    error: () => finish(reactions.error),
    clear: () => finish(null),
    settled: () => tail,
  });
}
