import {
  accumulateFinalAssistantText,
  AssistantTextAccumulator,
  isDshImInputOrigin,
  textFromHarnessContent,
} from '../../src/channels/shared/harness-client.mjs';
import {
  DEFAULT_DELIVERY_SYNC_SETTINGS,
  normalizeDeliverySyncSettings,
  withDeliverySyncIcon,
} from '../../src/channels/shared/delivery-sync-settings.mjs';
import { getDeliverySyncSettingsStore } from '../../src/channels/shared/delivery-sync-settings-store.mjs';
import { deliverSessionSyncMirror } from '../../src/channels/shared/session-sync-registry.mjs';

/**
 * Where the turn came from, as far as a chat mirror is concerned.
 *
 * - `im`: the turn was started by a message from this very messenger. Its
 *   answer is already rendered there, so nothing is delivered.
 * - `web`: the reader typed in the DSH Web GUI. Their own input may be mirrored
 *   into the chat, and the answer may be delivered.
 * - `internal`: a service started the turn — a schedule reminder, an answered
 *   question, a notice such as `subagent-settled`, or the context the Host
 *   injects into every turn. The framing is internal and is never echoed, and
 *   it never decides where the turn came from: only a turn that locked no
 *   meaningful origin at all is delivered as a service turn.
 */
export const TURN_INPUT_ORIGINS = Object.freeze({ im: 'im', web: 'web', internal: 'internal' });

/** Origins that may own a turn; `internal` is a fact about one message, not the turn. */
const MEANINGFUL_ORIGINS = new Set([TURN_INPUT_ORIGINS.im, TURN_INPUT_ORIGINS.web]);

/** Kinds whose turn is started by the Host rather than by a reader. */
const INTERNAL_KINDS = new Set(['schedule', 'user-question-reply']);

function completedTurn(reason) {
  return (typeof reason === 'string' ? reason : reason?.kind) === 'completed';
}

function sessionIdOf(session) {
  const value = session?.id ?? session?.sessionId;
  return typeof value === 'string' && value ? value : null;
}

/**
 * Classify one `user/message` by the source of that very message.
 *
 * `imOwned` is the answer of `isDshImInputOrigin` for this message: only the
 * messenger that received the input has its rpcId registered, so everything
 * else is a different origin even though DSH models both as `kind: 'user'`.
 * The lookup is non-destructive, so it never races the channel that owns the
 * id and never turns the same messenger turn into a mirrored one.
 */
export function classifyTurnInput(source, { imOwned = false } = {}) {
  // A notice is Host framing whatever its kind says; `subagent-settled` and
  // future notice kinds must never be echoed as if the reader had typed them.
  if (source?.form === 'notice') return 'internal';
  if (INTERNAL_KINDS.has(source?.kind)) return 'internal';
  if (source?.kind !== 'user') return 'internal';
  return imOwned ? 'im' : 'web';
}

/**
 * Settings used when the document cannot be read at all.
 *
 * A snapshot that cannot be loaded is not a reason to start mirroring: both
 * switches are held off, so a broken or unreadable file fails closed and the
 * chat simply receives nothing until the document is readable again.
 */
const UNREADABLE_SETTINGS = Object.freeze({
  ...DEFAULT_DELIVERY_SYNC_SETTINGS,
  mirrorUserInput: false,
  deliverModelAnswers: false,
});

/**
 * @param options.loadSettings - Async getter of the delivery-sync settings
 *   document. Read once per turn. A failure is logged and mirrored nowhere: the
 *   reader asked for no mirroring by default, so an unreadable document must
 *   never become one.
 */
export function createSessionSyncCoordinator({
  deliveryService,
  logger = console,
  loadSettings = null,
} = {}) {
  if (typeof deliveryService?.deliverSessionText !== 'function') {
    throw new TypeError('Session sync requires a delivery service that can follow a Session binding');
  }

  const turns = new Map();
  const tails = new Map();
  let closed = false;

  const logFailure = (phase, error) => {
    logger.warn?.(
      `[dsh-im] ignored Session sync ${phase} failure`
        + ` [${error?.code ?? error?.name ?? 'unknown-error'}]`,
    );
  };

  const logUndelivered = (sessionId, phase, reason) => {
    // The address comes from the binding, so there is nothing secret to hide
    // here, but the message text never appears in a log line.
    logger.warn?.(
      `[dsh-im] Session sync ${phase} found no delivery address`
        + ` [${reason ?? 'no-reason'}] session=${sessionId}`,
    );
  };

  const readSettings = async (state) => {
    if (state.settings) return state.settings;
    try {
      const value = typeof loadSettings === 'function'
        ? await loadSettings()
        : DEFAULT_DELIVERY_SYNC_SETTINGS;
      state.settings = normalizeDeliverySyncSettings(value) ?? DEFAULT_DELIVERY_SYNC_SETTINGS;
    } catch (error) {
      logFailure('settings', error);
      state.settings = UNREADABLE_SETTINGS;
    }
    return state.settings;
  };

  // Saved targets keep control of delivery even when all their sync switches
  // are off; an empty sync list must not bypass them through the binding path.
  const botHasSavedTargets = async (sessionId) => {
    try {
      const described = await deliveryService.describeConversation(sessionId);
      if (!described) return false;
      const listed = await deliveryService.listTargets(described.botId);
      return Array.isArray(listed?.targets) && listed.targets.length > 0;
    } catch {
      return false;
    }
  };

  // A channel may render the answer itself — the Feishu process card does — so a
  // target is not automatically a text recipient. A pending card is not proof of
  // delivery either: the renderer is asked first and only the targets it did not
  // confirm receive the text. Targets without a renderer keep the text path.
  const renderFinalAnswer = async (targets, sessionId, turn, text) => {
    if (!Number.isSafeInteger(turn)) return targets.map(() => false);
    return await Promise.all(targets.map(async (target) => {
      try {
        return await deliverSessionSyncMirror(target, sessionId, turn, text) === true;
      } catch (error) {
        logFailure(`card delivery (${target.channel})`, error);
        return false;
      }
    }));
  };

  // Saved sync targets and DS Bot bindings share the same card receipt path.
  const deliverToTargets = async (sessionId, targets, text, phase, format, { turn = null, cardText = null } = {}) => {
    if (!Array.isArray(targets) || targets.length === 0) {
      logUndelivered(sessionId, phase, 'no-sync-targets');
      return false;
    }
    // Only the final answer has a card renderer; a mirrored user message has no
    // receipt to wait for, so it keeps its text path untouched.
    const rendered = cardText === null
      ? targets.map(() => false)
      : await renderFinalAnswer(targets, sessionId, turn, cardText);
    const pending = targets.filter((_target, index) => !rendered[index]);
    if (pending.length === 0) return true;
    const results = await Promise.allSettled(pending.map((target) => (
      deliveryService.sendSessionSyncText(
        target.botId, target.targetId, sessionId, text,
        // Feishu renders its own card; preserve its plain fallback instead of
        // attempting another rich card.
        { format: target.channel === 'feishu' ? 'plain' : format },
      )
    )));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logFailure(`${phase} (${pending[index].channel})`, result.reason);
      }
    });
    // A confirmed card is a delivered answer even when no text was sent.
    return results.some((result) => result.status === 'fulfilled');
  };

  // New path: no targets configured, so the address comes from the Session binding.
  const deliverToBinding = async (sessionId, text, phase, format) => {
    const attempt = (value) => deliveryService.deliverSessionText(sessionId, text, { format: value });
    try {
      const result = await attempt(format);
      if (result?.sent === true) return true;
      logUndelivered(sessionId, phase, result?.reason);
      return false;
    } catch (error) {
      logFailure(phase, error);
      // Rich text is an extra: a channel that refuses the markdown rendering
      // would otherwise lose the answer entirely, so the same text goes once
      // more as plain. An uncertain send is never repeated — it may already be
      // visible in the chat.
      if (format === 'plain' || error?.code === 'send-result-unknown' || error?.code === 'cancelled') {
        return false;
      }
      try {
        const fallback = await attempt('plain');
        if (fallback?.sent === true) return true;
        logUndelivered(sessionId, `${phase} (plain fallback)`, fallback?.reason);
        return false;
      } catch (fallbackError) {
        logFailure(`${phase} (plain fallback)`, fallbackError);
        return false;
      }
    }
  };

  const deliver = async (sessionId, text, phase, format = 'plain', card = null) => {
    // DS Bot bindings can supply sync targets without any saved delivery target,
    // including after rollover when the persisted Session map is still stale.
    const targets = await deliveryService.listSessionSyncTargets?.(sessionId) ?? [];
    if (targets.length > 0 || await botHasSavedTargets(sessionId)) {
      return deliverToTargets(sessionId, targets, text, phase, format, card ?? {});
    }
    return deliverToBinding(sessionId, text, phase, format);
  };

  const onUserMessage = async (sessionId, state, event, originHint) => {
    if (event.surfaceOp !== 'append') return;
    const origin = classifyTurnInput(event.data?.source, { imOwned: originHint === 'im' });
    // Only a message that says where the reader was may own the turn. A service
    // injection — the runtime context the Host prepends, a reminder, a notice —
    // is often the first message of a turn and says nothing about the reader,
    // so it is remembered as a hint for `turn/end` instead of locking the turn.
    if (MEANINGFUL_ORIGINS.has(origin)) {
      // The chat answers this turn itself as soon as any of its messages came
      // from there, so an IM message outranks an earlier Web one and the whole
      // turn is never delivered; a Web message only claims a turn still free.
      if (origin === TURN_INPUT_ORIGINS.im || state.origin === null) state.origin = origin;
    } else {
      state.sawInternal = true;
    }
    if (state.origin === TURN_INPUT_ORIGINS.im) return;
    // Every message decides its own echo from its own origin: Host framing that
    // appears inside a Web turn never reaches the chat.
    if (origin !== TURN_INPUT_ORIGINS.web) return;

    const settings = await readSettings(state);
    const text = textFromHarnessContent(event.data?.content);
    if (settings.mirrorUserInput !== true || !text) return;
    // The same text twice in one turn is one echo: a retry or a re-appended
    // input must not arrive in the chat twice.
    if (state.echoed.has(text)) return;
    state.echoed.add(text);
    if (!await deliver(sessionId, withDeliverySyncIcon(settings.inputIcon, text), 'user delivery')) {
      state.echoFailed = true;
    }
  };

  const onTurnEnd = async (sessionId, state, event) => {
    // A Web turn is mirrored because the reader was there; a turn that locked no
    // meaningful origin is a service turn only when at least one service
    // message announced it. Anything else — no input at all — stays silent.
    const serviceTurn = state.origin === null && state.sawInternal === true;
    const mirroredTurn = state.origin === TURN_INPUT_ORIGINS.web;
    if (!mirroredTurn && !serviceTurn) return;
    const settings = await readSettings(state);
    if (!settings.deliverModelAnswers || !completedTurn(event.data?.reason)) return;
    // An answer the reader cannot connect to their own input is worse than no
    // answer at all: a turn whose input mirror failed stays silent.
    if (state.echoFailed) return;
    const text = state.assistant.text;
    if (!text) return;
    // The card carries the answer itself, so it gets the text without the icon
    // label that marks a delivered message.
    await deliver(
      sessionId,
      withDeliverySyncIcon(settings.modelIcon, text),
      'assistant delivery',
      'markdown',
      { turn: state.turn, cardText: text },
    );
  };

  const processEvent = async (sessionId, event, origin = 'other') => {
    if (closed || !event || typeof event !== 'object') return;

    if (event.type === 'turn/start') {
      const turn = event.data?.turn;
      if (!Number.isSafeInteger(turn)) return;
      turns.set(sessionId, {
        turn,
        origin: null,
        sawInternal: false,
        settings: null,
        echoed: new Set(),
        echoFailed: false,
        assistant: new AssistantTextAccumulator(),
      });
      return;
    }

    const state = turns.get(sessionId);
    if (!state) return;

    if (event.type === 'user/message') {
      await onUserMessage(sessionId, state, event, origin);
      return;
    }

    // The chat gets the final answer of the turn, not a transcript of it: the
    // accumulator keeps only what arrived after the last tool call.
    if (event.type === 'assistant/message' || event.type === 'assistant/chunk'
      || event.type === 'tool/call') {
      // An IM-owned turn is answered by the chat itself; every other turn keeps
      // its final text, since `turn/end` decides whether it may be delivered.
      if (state.origin === TURN_INPUT_ORIGINS.im) return;
      if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') return;
      if (event.data?.interrupted === true) return;
      if (event.data?.turn !== undefined && event.data.turn !== state.turn) return;
      accumulateFinalAssistantText(state.assistant, event);
      return;
    }

    if (event.type !== 'turn/end' || event.data?.turn !== state.turn) return;
    turns.delete(sessionId);
    await onTurnEnd(sessionId, state, event);
  };

  const enqueue = (sessionId, event, origin = 'other') => {
    if (closed || typeof sessionId !== 'string' || !sessionId) return Promise.resolve();
    const previous = tails.get(sessionId) ?? Promise.resolve();
    const task = previous.then(
      () => processEvent(sessionId, event, origin),
      () => processEvent(sessionId, event, origin),
    );
    const tail = task.catch((error) => logFailure('event handling', error)).finally(() => {
      if (tails.get(sessionId) === tail) tails.delete(sessionId);
    });
    tails.set(sessionId, tail);
    return tail;
  };

  return Object.freeze({
    enqueue,
    async whenIdle() {
      while (tails.size > 0) await Promise.allSettled([...tails.values()]);
    },
    close() {
      closed = true;
      turns.clear();
    },
  });
}

/**
 * Whether this input was submitted by the messenger that is currently asking.
 *
 * The registered rpcId is only read here, never claimed: the channel that owns
 * it stays able to consume it, and every later reader of the same event sees
 * the same answer instead of a turn that changes its origin between handlers.
 */
export function isImOwnedInput(scope, event) {
  const source = event?.data?.source;
  if (source?.kind !== 'user' || typeof source.rpcId !== 'string' || !source.rpcId) return false;
  return isDshImInputOrigin(scope, source.rpcId);
}

export function installSessionSyncCoordinator(ctx, deliveryService, {
  logger = console,
  inputScope = ctx?.root ?? ctx,
  loadSettings = null,
  imInputOwnership = isImOwnedInput,
  config = {},
} = {}) {
  if (typeof ctx?.on !== 'function') {
    throw new TypeError('Session sync requires Host session events');
  }
  // The settings page writes this document over RPC; the coordinator reads it
  // once per turn, so a save applies to the next turn without a restart.
  const readSettings = loadSettings ?? (() => getDeliverySyncSettingsStore(config).get());
  const coordinator = createSessionSyncCoordinator({
    deliveryService,
    logger,
    loadSettings: readSettings,
  });
  const disposeEvent = ctx.on('session/event', (session, event) => {
    const sessionId = sessionIdOf(session);
    if (!sessionId) return;
    // Only messenger ownership is decided here, synchronously and without
    // claiming the id; the coordinator classifies the rest of the turn, and a
    // message's origin is read from that same message, never from the turn.
    const origin = event?.type === 'user/message' && imInputOwnership(inputScope, event)
      ? 'im'
      : 'other';
    void coordinator.enqueue(sessionId, event, origin);
  }, { global: true });
  let disposed = false;
  const close = () => {
    if (disposed) return;
    disposed = true;
    disposeEvent?.();
    coordinator.close();
  };
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => close, 'dsh-im: Session sync coordinator');
  }
  return Object.freeze({ ...coordinator, close });
}
