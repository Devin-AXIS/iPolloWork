function refuse(code) { throw Object.assign(new Error(code), { code }); }
const count = value => Number.isInteger(value) && value >= 0 && value <= 20;

export async function readNearbyHistory(readPage, route, query, anchorTime) {
  const before = query.beforeCount ?? 10;
  const after = query.afterCount ?? 5;
  if (!count(before) || !count(after)) refuse('bad-request');
  const start = Math.max(0, anchorTime - 300000);
  const end = anchorTime + 300000;
  const window = { start: Math.floor(start / 1000), end: Math.floor(end / 1000) + 1 };
  let state = { phase: 'window', before: 0, after: 0 };
  if (query.cursor !== undefined) {
    try {
      const decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
      if (decoded.version !== 1 || decoded.anchor !== route.messageId || decoded.at !== anchorTime
        || decoded.minBefore !== before || decoded.minAfter !== after || decoded.limit !== query.limit
        || !['window', 'before', 'after'].includes(decoded.phase)
        || !count(decoded.before) || !count(decoded.after)
        || (decoded.page !== undefined && (typeof decoded.page !== 'string' || !decoded.page || decoded.page.length > 3000)))
        refuse('bad-request');
      state = decoded;
    } catch { refuse('bad-request'); }
  }
  const params = { container_id_type: 'chat', container_id: route.conversationId,
    page_size: query.limit, with_sender_name: true,
    sort_type: state.phase === 'before' ? 'ByCreateTimeDesc' : 'ByCreateTimeAsc',
    ...(state.page === undefined ? {} : { page_token: state.page }),
    ...(state.phase === 'window' ? { start_time: String(window.start), end_time: String(window.end) }
      : state.phase === 'before' ? { end_time: String(window.start + 1) }
        : { start_time: String(Math.floor(end / 1000)) }),
  };
  // Lark defaults an omitted end_time to now and rejects a future start_time.
  // A fresh anchor has no existing messages beyond its future window boundary.
  const page = state.phase === 'after' && end >= Date.now()
    ? { events: [], omitted: 0, hasMore: false }
    : await readPage(params);
  const events = [];
  for (const event of page.events) {
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) refuse('history-unavailable');
    if (state.phase === 'window') {
      if (at < start || at > end) continue;
      events.push(event);
      if (event.messageId !== route.messageId && at < anchorTime) state.before = Math.min(20, state.before + 1);
      if (event.messageId !== route.messageId && at > anchorTime) state.after = Math.min(20, state.after + 1);
    } else if (state.phase === 'before' && at < start && state.before < before) {
      events.push(event); state.before++;
    } else if (state.phase === 'after' && at > end && state.after < after) {
      events.push(event); state.after++;
    }
  }
  const needsPage = page.hasMore && (state.phase === 'window'
    || (state.phase === 'before' ? state.before < before : state.after < after));
  if (needsPage) {
    if (page.nextCursor === state.page) refuse('history-unavailable');
    state.page = page.nextCursor;
  } else {
    delete state.page;
    if (state.phase === 'window' && state.before < before) state.phase = 'before';
    else if (state.phase !== 'after' && state.after < after) state.phase = 'after';
    else state.phase = 'done';
  }
  let nextCursor;
  if (state.phase !== 'done') {
    nextCursor = Buffer.from(JSON.stringify({version:1, anchor:route.messageId, at:anchorTime,
      minBefore:before, minAfter:after, limit:query.limit, phase:state.phase,
      before:state.before, after:state.after, ...(state.page ? {page:state.page} : {})})).toString('base64url');
    if (nextCursor.length > 4096) refuse('history-unavailable');
  }
  return {version:1, scope:'nearby', events, omitted:page.omitted, hasMore:!!nextCursor,
    ...(nextCursor ? {nextCursor} : {}), window, coverage:'provider-visible-human-text'};
}
