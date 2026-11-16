function assistantText(event) {
  if (event?.type !== 'assistant/message'
    || !Number.isSafeInteger(event.data?.turn)
    || event.data.turn < 0
    || !Array.isArray(event.data?.message?.content)) return null;
  const text = event.data.message.content
    .flatMap((block) => (block?.type === 'text' && typeof block.text === 'string'
      ? [block.text]
      : []))
    .join('\n')
    .trim();
  return text ? { turn: event.data.turn, time: event.time, text } : null;
}

function completedAssistantTurns(events) {
  const starts = new Map();
  const assistants = new Map();
  const completed = [];
  for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
    if (event?.type === 'turn/start' && Number.isSafeInteger(event.data?.turn)) {
      starts.set(event.data.turn, event.time);
    }
    const assistant = assistantText(event);
    if (assistant) assistants.set(assistant.turn, assistant);
    if (event?.type !== 'turn/end' || !Number.isSafeInteger(event.data?.turn)) continue;
    const final = assistants.get(event.data.turn);
    assistants.delete(event.data.turn);
    if ((event.data?.reason?.kind ?? event.data?.reason) !== 'completed' || !final) continue;
    completed.push({
      ...final,
      startedAt: starts.get(event.data.turn),
      completedAt: event.time,
    });
  }
  return completed;
}

function matchingAssistantText(events, quotedAt, toleranceMs) {
  const candidates = completedAssistantTurns(events).filter((entry) => {
    if (Number.isFinite(entry.time) && Math.abs(entry.time - quotedAt) <= toleranceMs) {
      return true;
    }
    return Number.isFinite(entry.startedAt) && Number.isFinite(entry.completedAt)
      && quotedAt >= entry.startedAt - toleranceMs
      && quotedAt <= entry.completedAt + toleranceMs;
  });
  return candidates.length === 1 ? candidates[0].text : null;
}

/**
 * Recover one completed assistant answer near a provider message timestamp.
 *
 * @param {object} options Recovery inputs.
 * @param {{readHistory: Function}} options.session Bound Harness Session handle.
 * @param {number} options.quotedAt Provider message timestamp in milliseconds.
 * @param {AbortSignal} [options.signal] Caller cancellation signal.
 * @param {number} [options.pageSize=100] History events requested per page.
 * @param {number} [options.maxPages=3] Maximum history pages to inspect.
 * @param {number} [options.timeoutMs=5000] Total history read deadline.
 * @param {number} [options.toleranceMs=15000] Provider/session clock tolerance.
 * @returns {Promise<string|null>} The unique matching answer, or null.
 */
export async function recoverAssistantTextByTimestamp({
  session,
  quotedAt,
  signal: callerSignal,
  pageSize = 100,
  maxPages = 3,
  timeoutMs = 5_000,
  toleranceMs = 15_000,
} = {}) {
  if (typeof session?.readHistory !== 'function' || !Number.isFinite(quotedAt)) return null;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  const deadline = Date.now() + timeoutMs;
  const events = new Map();
  let beforeSeq;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    signal.throwIfAborted();
    const page = await session.readHistory({
      maxMessages: pageSize,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      timeoutMs: Math.max(1, deadline - Date.now()),
      signal,
    });
    if (!page || !Array.isArray(page.events) || typeof page.hasMore !== 'boolean') return null;
    let oldestSeq = beforeSeq ?? Infinity;
    let oldestTime = Infinity;
    for (const entry of page.events) {
      const event = entry?.event;
      if (!event || !Number.isSafeInteger(event.seq) || event.seq < 0) continue;
      events.set(event.seq, event);
      oldestSeq = Math.min(oldestSeq, event.seq);
      if (Number.isFinite(event.time)) oldestTime = Math.min(oldestTime, event.time);
    }
    const text = matchingAssistantText([...events.values()], quotedAt, toleranceMs);
    const passedTarget = oldestTime <= quotedAt - toleranceMs;
    if (text && (passedTarget || !page.hasMore)) return text;
    if (!page.hasMore || passedTarget
      || !Number.isFinite(oldestSeq) || oldestSeq === beforeSeq) break;
    beforeSeq = oldestSeq;
  }
  return null;
}
