import { parseConversationKey } from '../../../../src/channels/shared/conversation/describe.mjs';

/**
 * Identity events for conversation bindings.
 *
 * `dsh-im/session-pre-bind` is announced the moment a conversation points at a
 * session. It runs synchronously and before the Session exists, so a subscriber
 * holds the identity while the first system prompt is assembled.
 *
 * `dsh-im/session-unbind` is announced when a conversation stops pointing at a
 * session: it was switched to another one, or the binding was cleared. Without
 * it a subscriber can only notice that *some* session was bound later, and its
 * own session->identity state keeps claiming a conversation it no longer owns.
 *
 * Both events carry the same conversation fields, so a subscriber handles them
 * symmetrically.
 */
export function createBindingAnnouncer({
  channel,
  emit,
  authorsOf = () => null,
  parse = parseConversationKey,
} = {}) {
  if (typeof emit !== 'function') throw new TypeError('emit is required');

  const conversationFields = (conversationKey) => {
    const parsed = parse(conversationKey, { channel });
    return {
      channel,
      conversationKey,
      chatType: parsed?.chatType ?? null,
      chatId: parsed?.chatId ?? null,
      threadId: parsed?.threadId ?? null,
      senderId: parsed?.senderId ?? null,
    };
  };

  // A subscriber that throws must not break the message being handled, so every
  // announce swallows its own failure.
  const announce = (event, payload) => {
    try {
      emit(event, Object.freeze(payload));
    } catch {
      // ignore a subscriber's failure
    }
  };

  const bind = (botId, conversationKey, sessionId) => {
    try {
      const authors = authorsOf(botId);
      const author = authors?.[conversationKey] ?? null;
      const fields = conversationFields(conversationKey);
      announce('dsh-im/session-pre-bind', {
        ...fields,
        botId,
        sessionId,
        senderId: author?.senderId ?? fields.senderId,
        senderName: author?.senderName ?? null,
      });
    } catch {
      // ignore a malformed conversation key or author snapshot
    }
  };

  const unbind = (botId, conversationKey, sessionId) => {
    if (typeof sessionId !== 'string' || sessionId === '') return;
    try {
      announce('dsh-im/session-unbind', {
        ...conversationFields(conversationKey),
        botId,
        sessionId,
      });
    } catch {
      // ignore a malformed conversation key
    }
  };

  const previousSession = (state, key) => (typeof state.sessionFor === 'function'
    ? state.sessionFor(key)
    : null);

  /**
   * Wrap one bot's state store so every committed binding change is announced.
   * A refused write (`false`) announces nothing, and a write that repeats the
   * current session is not an unbind: the conversation never left it.
   */
  const wrap = (botId, state) => {
    if (state === null || typeof state !== 'object' || state.__announces === true) return state;
    const setSession = state.setSession;
    if (typeof setSession !== 'function') return state;

    state.setSession = async (key, sessionId) => {
      const previous = previousSession(state, key);
      const result = await setSession.call(state, key, sessionId);
      if (result === false) return result;
      if (previous !== null && previous !== sessionId) unbind(botId, key, previous);
      bind(botId, key, sessionId);
      return result;
    };

    if (typeof state.clearSession === 'function') {
      const clearSession = state.clearSession;
      state.clearSession = async (key) => {
        const previous = previousSession(state, key);
        const result = await clearSession.call(state, key);
        unbind(botId, key, previous);
        return result;
      };
    }

    if (typeof state.clearSessions === 'function') {
      const clearSessions = state.clearSessions;
      state.clearSessions = async () => {
        const bindings = typeof state.snapshot === 'function'
          ? state.snapshot()?.sessions ?? null
          : null;
        const result = await clearSessions.call(state);
        for (const [key, sessionId] of Object.entries(bindings ?? {})) {
          unbind(botId, key, sessionId);
        }
        return result;
      };
    }

    state.__announces = true;
    return state;
  };

  return { bind, unbind, wrap };
}

/**
 * The state half of the announcement contract, shared by every channel that
 * assembles its own production controller.
 *
 * A channel loads one state store per bot on demand, and two rules follow from
 * the events above:
 *
 * - the store a conversation binds through must be the wrapped one, otherwise no
 *   `session-pre-bind` is ever announced;
 * - the synchronous identity lookup answers only from stores already in memory,
 *   so the memo has to be warmed before the first prompt, not by the first
 *   delivery.
 *
 * `stateFor(subject)` loads once per key and returns the wrapped store;
 * `stateForSync(subject)` answers from that memo without a single await;
 * `prime(subjects)` warms it and never fails the channel's start.
 *
 * `subject` is what a channel identifies a bot by: a bot id for most of them, a
 * bot configuration where the store path depends on it. `keyOf` turns it into
 * the memo key, and `states` is the memo itself — pass an existing Map to keep
 * the channel's own reference to it, or read the one returned here.
 */
export function createAnnouncedStateStore({
  announcer,
  StateStore,
  statePath,
  storeOptions = null,
  keyOf = (subject) => String(subject ?? ''),
  states = new Map(),
  logger = null,
} = {}) {
  if (announcer === null || typeof announcer !== 'object' || typeof announcer.wrap !== 'function') {
    throw new TypeError('announcer is required');
  }
  if (typeof StateStore !== 'function') throw new TypeError('StateStore is required');
  if (typeof statePath !== 'function') throw new TypeError('statePath is required');
  if (typeof keyOf !== 'function') throw new TypeError('keyOf must be a function');
  if (!(states instanceof Map)) throw new TypeError('states must be a Map');

  // `key -> { token, promise }`. The token identifies the load in flight, so a
  // `forget()` that lands during it wins: a store finished after the bot was
  // deleted must not be memoisd back as if the bot still existed.
  const loading = new Map();

  const load = async (subject, key) => {
    const path = statePath(subject);
    const options = typeof storeOptions === 'function' ? storeOptions(subject) : storeOptions;
    const store = options === null || options === undefined
      ? await new StateStore(path).load()
      : await new StateStore(path, options).load();
    // The memo only ever holds a wrapped store, so the wrapper is applied once.
    return announcer.wrap(key, store);
  };

  const stateFor = (subject) => {
    const key = keyOf(subject);
    const loaded = states.get(key);
    if (loaded !== undefined) return Promise.resolve(loaded);
    // Two concurrent callers (a prime and the first delivery, say) share one
    // load: a second store for the same bot would be a second wrapper and a
    // second set of bindings.
    const inFlight = loading.get(key);
    if (inFlight !== undefined) return inFlight.promise;
    const entry = { token: Symbol(key), promise: null };
    entry.promise = load(subject, key).then((store) => {
      if (loading.get(key) === entry) {
        states.set(key, store);
        loading.delete(key);
      }
      return store;
    }, (error) => {
      if (loading.get(key) === entry) loading.delete(key);
      throw error;
    });
    loading.set(key, entry);
    return entry.promise;
  };

  const stateForSync = (subject) => states.get(keyOf(subject)) ?? null;

  // A bot whose state cannot be read is that bot's problem: the channel starts,
  // the others answer, and the failure resurfaces on the first use. It is named
  // once here, because a silent miss leaves every session of that bot unknown
  // with nothing in the log to explain why.
  const prime = (subjects) => Promise.all(
    [...(subjects ?? [])].map((subject) => stateFor(subject).catch((error) => {
      try {
        logger?.warn?.(
          `[dsh-im] cannot read the state of ${keyOf(subject)} at start-up:`,
          error?.message ?? error,
        );
      } catch {
        // a logger must never turn a failed read into a failed start
      }
      return null;
    })),
  );

  // The bot is gone: drop the memo and any load in flight, so neither the memo
  // nor the late resolution can answer identity for it afterwards.
  const forget = (subject) => {
    const key = keyOf(subject);
    states.delete(key);
    loading.delete(key);
  };

  return { stateFor, stateForSync, prime, forget, states };
}
