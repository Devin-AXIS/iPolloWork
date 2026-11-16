import { AssistantTextAccumulator, accumulateFinalAssistantText } from './harness-client.mjs';

export const MAX_DEFERRED_PER_KEY = 4;

/** Classify one turn/end event into a terminal-reason label. */
export function terminalOutcomeOf(turnEndEvent) {
  const raw = turnEndEvent?.data?.reason;
  const kind = typeof raw === 'string'
    ? raw
    : typeof raw?.kind === 'string' ? raw.kind : null;
  return { kind: kind ?? 'other' };
}

function eventOf(entry) {
  return entry?.event ?? (entry?.type ? entry : null);
}

function orderedEvents(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map(eventOf)
    .filter(Boolean)
    .sort((left, right) => (left.seq ?? -1) - (right.seq ?? -1));
}

function textFromContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((block) => (block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
    .join('\n')
    .trim();
}

/**
 * Extract the final answer of one completed turn from durable history events.
 *
 * Reuses HarnessReplyTracker text accumulation: chunk deltas accumulate per
 * (step, part index); a canonical assistant/message replaces its step; steps
 * join with a blank line. finalAnswerOnly discards text before tool calls.
 * `turn` omitted → prefer the latest completed answer.
 * Returns `{ found, turn, text, reason, endSeq }`; `found: false` when the
 * turn ended without a completed final answer (stopped/failed/empty/
 * interrupted) — `reason`/`endSeq` still identify the confirmed terminal.
 */
export function extractCompletedTurnAnswer(entries, { turn, finalAnswerOnly = false } = {}) {
  const events = orderedEvents(entries);
  const wantTurn = Number.isSafeInteger(turn) ? turn : null;
  function turnAnswer(turnEnd) {
    const accumulator = new AssistantTextAccumulator();
    let interrupted = false;
    for (const event of events) {
      if (event.seq > turnEnd.seq || event.data?.turn !== turnEnd.data.turn) continue;
      if (finalAnswerOnly === true) {
        accumulateFinalAssistantText(accumulator, event);
      } else if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'text-delta') {
        accumulator.appendDelta(event.data.step, event.data.chunk.index, event.data.chunk.text);
      } else if (event.type === 'assistant/message') {
        accumulator.setCanonical(event.data.step, textFromContent(event.data.message?.content));
      }
      if (event.type === 'assistant/message') interrupted = event.data.interrupted === true;
    }
    return { text: accumulator.text, interrupted };
  }

  function scan(matchTurn, acceptAnyTerminal = false) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type !== 'turn/end' || !Number.isSafeInteger(event.data?.turn)) continue;
      if (matchTurn !== null && event.data.turn !== matchTurn) continue;
      const raw = event.data?.reason;
      const reason = typeof raw === 'string' ? raw : typeof raw?.kind === 'string' ? raw.kind : null;
      const answer = turnAnswer(event);
      const hasAnswer = reason === 'completed' && !answer.interrupted;
      const text = hasAnswer ? answer.text : null;
      if (hasAnswer && text) {
        return { found: true, turn: event.data.turn, text, reason, endSeq: event.seq ?? -1 };
      }
      if (matchTurn !== null || acceptAnyTerminal) {
        return { found: false, turn: event.data.turn, text: null, reason, endSeq: event.seq ?? -1 };
      }
    }
    return null;
  }

  const completed = scan(wantTurn);
  if (completed) return completed;
  const anyTerminal = scan(wantTurn, true);
  if (anyTerminal) return anyTerminal;
  return { found: false, turn: wantTurn, text: null, reason: null, endSeq: -1 };
}

/**
 * Registry over a tiny persistence interface:
 * `listDeferred() / putDeferred(entry) / patchDeferred(id, patch) / removeDeferred(id)`.
 * Entries are owned snapshots; prompt ids distinguish tasks even before turn/start.
 */
export function createDeferredDeliveryRegistry(store, {
  now = () => Date.now(),
  maxPerKey = MAX_DEFERRED_PER_KEY,
  logger = console,
} = {}) {
  function deferredId(key, sessionId, turn) {
    return `${key} ${sessionId} ${Number.isSafeInteger(turn) ? turn : 'any'}`;
  }

  return {
    deferredId,
    async register({
      key, chatId = null, target = null, replyToMessageId = null, sessionId, turn = null, afterSeq = -1, promptRpcId = null,
    }) {
      if (typeof key !== 'string' || !key) throw new TypeError('key is required');
      if ((!chatId || typeof chatId !== 'string') && (!target || typeof target !== 'object')) {
        throw new TypeError('chatId or a channel target is required');
      }
      if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
      const entry = {
        id: promptRpcId ? `${key} ${sessionId} ${promptRpcId}` : deferredId(key, sessionId, turn),
        key,
        chatId,
        ...(target ? { target: structuredClone(target) } : {}),
        replyToMessageId: typeof replyToMessageId === 'string' ? replyToMessageId : null,
        sessionId,
        promptRpcId,
        turn: Number.isSafeInteger(turn) ? turn : null,
        afterSeq: Number.isSafeInteger(afterSeq) ? afterSeq : -1,
        lastSeenEndSeq: -1,
        attempts: 0,
        status: 'pending',
        createdAt: now(),
      };
      const sameKey = (await store.listDeferred())
        .filter((candidate) => candidate.key === key && candidate.status === 'pending');
      const existing = sameKey.find((candidate) => candidate.id === entry.id);
      if (existing) return existing;
      if (sameKey.length >= maxPerKey) {
        logger?.warn?.('[dsh-im] deferred delivery limit reached for key; dropping the oldest entry');
        await store.removeDeferred(sameKey[0].id);
      }
      await store.putDeferred(entry);
      return entry;
    },
    async pendingForSession(sessionId) {
      return (await store.listDeferred())
        .filter((entry) => entry.status === 'pending' && entry.sessionId === sessionId);
    },
    async pendingForKey(key) {
      return (await store.listDeferred())
        .filter((entry) => entry.status === 'pending' && entry.key === key);
    },
    async allPending() {
      return (await store.listDeferred()).filter((entry) => entry.status === 'pending');
    },
    async markFailedAttempt(entry) {
      // Read fresh state: the caller's snapshot goes stale across attempts.
      const current = (await store.listDeferred())
        .find((candidate) => candidate.id === entry.id) ?? entry;
      const attempts = (current.attempts ?? 0) + 1;
      await store.patchDeferred(entry.id, { attempts, status: attempts >= 3 ? 'failed' : 'pending' });
      return attempts;
    },
    async remove(entry) {
      await store.removeDeferred(entry.id);
    },
  };
}
