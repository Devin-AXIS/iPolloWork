import { getImHostLanguage } from '../../src/channels/shared/i18n.mjs';
import { SESSION_CHANNEL_LABELS as CHANNEL_LABELS } from '../../src/channels/shared/session-channel-labels.mjs';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// HarnessClient uses these ids for prompts and steering, independently of
// context enhancement. Read the durable source, never the message's text.
const IM_RPC_ID = new RegExp(`^(${Object.keys(CHANNEL_LABELS).join('|')})-(?:steer-)?${UUID}$`, 'u');
const LEGACY_SESSION_ID = new RegExp(`^(${Object.keys(CHANNEL_LABELS).join('|')})-.+`, 'u');

function eventsOf(session) {
  const events = typeof session?.snapshotEvents === 'function'
    ? session.snapshotEvents()
    : session?.events;
  return Array.isArray(events) ? events : [];
}

function channelOf(session, events) {
  // A Web-created fork must not acquire a channel just from its parent's
  // messages. Both supported Session implementations expose this boundary.
  const inherited = session.inheritedEventCount;
  if (session.header?.parentSession && !Number.isSafeInteger(inherited)) return null;
  for (const event of events) {
    if (Number.isSafeInteger(inherited) && event.seq < inherited) continue;
    if (event.type !== 'user/message' || event.data?.source?.kind !== 'user') continue;
    const channel = IM_RPC_ID.exec(event.data.source.rpcId)?.[1];
    if (channel) return channel;
  }
  if (session.header?.parentSession) return null;
  return LEGACY_SESSION_ID.exec(session.id ?? session.sessionId)?.[1] ?? null;
}

export function withSessionChannelPrefix(title, channel, language = getImHostLanguage()) {
  const labels = CHANNEL_LABELS[channel];
  if (!labels || typeof title !== 'string' || !title.trim()) return title;
  // Keep the original title intact, including Unicode graphemes. The Host
  // has already normalized and capped its generated text before this point.
  if (labels.some((label) => title.startsWith(`${label} · `))) return title;
  return `${labels[language === 'en' ? 1 : 0]} · ${title}`;
}

function validTitleData(data) {
  if (typeof data?.title !== 'string' || !data.title.trim()
    || !Array.isArray(data.messageSeqs)) return false;
  if (data.source?.kind === 'user') return data.messageSeqs.length === 0;
  if (!['fallback', 'provider'].includes(data.source?.kind)
    || data.messageSeqs.length === 0
    || data.messageSeqs.some((seq) => !Number.isSafeInteger(seq) || seq < 0)) return false;
  return data.source.kind !== 'provider'
    || (typeof data.source.provider === 'string' && Boolean(data.source.provider));
}

/**
 * Decorate accepted titles without session.rename(): rename pins them as
 * user-owned and supersedes automatic generation. Appending a log-only title
 * with the same source and citations preserves the Host's scheduling and
 * explicit-rename semantics. No provider, prompt, or stored event is changed.
 */
export function installSessionTitlePrefix(ctx, { logger = console } = {}) {
  if (typeof ctx?.on !== 'function' || typeof ctx?.sessions?.get !== 'function'
    || typeof ctx?.sessions?.list !== 'function') {
    throw new TypeError('Session title prefixes require Host sessions and events');
  }
  const pending = new Map();
  let closed = false;

  const decorate = (session) => {
    if (closed || ctx.sessions.get(session.id ?? session.sessionId) !== session
      || typeof session.append !== 'function') return;
    const events = eventsOf(session);
    const channel = channelOf(session, events);
    if (!channel) return;
    const latest = events.findLast((event) => event.type === 'session/title');
    if (!validTitleData(latest?.data)) return;
    const title = withSessionChannelPrefix(latest.data.title, channel);
    if (title === latest.data.title) return;
    // There is no await between the latest-title read and this append. A
    // queued old result can therefore never replace a newer/manual title.
    session.append('session/title', {
      ...structuredClone(latest.data),
      title,
    });
  };

  const enqueue = (session) => {
    if (closed || pending.has(session)) return;
    // Leave the current append/notification stack before writing another
    // event, so persistence and client projections observe monotonically
    // ordered events. Read the newest title when the microtask runs.
    const task = Promise.resolve().then(() => {
      pending.delete(session);
      decorate(session);
    }).catch((error) => {
      logger.warn?.('[dsh-im] unable to add Session channel prefix:', error?.message ?? error);
    }).finally(() => {
      if (pending.get(session) === task) pending.delete(session);
    });
    pending.set(session, task);
  };

  const disposeEvent = ctx.on('session/event', (session, event) => {
    if (event?.type === 'session/title'
      || (event?.type === 'user/message' && IM_RPC_ID.test(event.data?.source?.rpcId))) {
      enqueue(session);
    }
  }, { global: true });
  const disposeCreated = ctx.on('session/created', enqueue, { global: true });
  const close = () => {
    if (closed) return;
    closed = true;
    disposeEvent?.();
    disposeCreated?.();
  };
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => close, 'dsh-im: Session title channel prefixes');
  }
  for (const session of ctx.sessions.list()) enqueue(session);
  return Object.freeze({
    close,
    async whenIdle() {
      while (pending.size) await Promise.allSettled([...pending.values()]);
    },
  });
}
