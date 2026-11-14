/**
 * Pure Matrix inbound funnel helpers: identity guards, dedup ring, startup
 * grace and clock-skew detection, mention detection with its fallback chain,
 * mention stripping, the `!command` normalization and the normalized-message
 * projection the TextHarnessBridge consumes. Every function is deterministic
 * and side-effect free so the funnel is unit-testable without a homeserver.
 */

import { isMatrixEventId, isMatrixRoomId, isMatrixUserId } from './matrix-api.mjs';
import { buildConversationRoute, encodeConversationRouteKey } from '../shared/conversation/route.mjs';
import { evaluateTrigger } from '../shared/conversation/trigger-policy.mjs';

const GRACE_MS = 5_000;
const SKEW_OBSERVE_AFTER_MS = 30_000;
const SKEW_THRESHOLD_MS = 300_000;
const SKEW_STREAK_TO_WARN = 3;

function lowerId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function localpartOf(mxid) {
  const raw = lowerId(mxid);
  if (!raw.startsWith('@')) return '';
  const separator = raw.indexOf(':');
  return separator > 1 ? raw.slice(1, separator) : '';
}

export function serverNameOf(mxid) {
  const raw = lowerId(mxid);
  if (!raw.startsWith('@')) return '';
  const separator = raw.indexOf(':');
  return separator > 1 ? raw.slice(separator + 1) : '';
}

export class EventDedupeRing {
  #capacity;
  #seen = new Set();
  #order = [];

  constructor(capacity = 1_000) {
    this.#capacity = capacity;
  }

  seed(ids) {
    for (const id of Array.isArray(ids) ? ids : []) this.#push(id);
  }

  has(eventId) {
    return this.#seen.has(eventId);
  }

  /** Returns true only for the first observation of an event id. */
  mark(eventId) {
    if (typeof eventId !== 'string' || !eventId || this.#seen.has(eventId)) return false;
    this.#push(eventId);
    return true;
  }

  snapshot() {
    return [...this.#order];
  }

  #push(eventId) {
    if (this.#seen.has(eventId)) return;
    this.#seen.add(eventId);
    this.#order.push(eventId);
    while (this.#order.length > this.#capacity) {
      const oldest = this.#order.shift();
      this.#seen.delete(oldest);
    }
  }
}

/**
 * Drops timeline events stamped before the connection became live and detects a
 * host clock running ahead of the homeserver: after the observation window,
 * three consecutive far-past timestamps with a consistent offset mark the
 * local clock skewed, so the guard warns exactly once and keeps dropping the
 * stale backlog instead of silencing the bot forever.
 */
export class ClockSkewGuard {
  #startupTsMs;
  #firstObservedAt = null;
  #skewStreak = 0;
  #warned = false;

  constructor({ startupTsMs = Date.now() } = {}) {
    this.#startupTsMs = startupTsMs;
  }

  evaluate(eventOriginServerTsMs, nowMs = Date.now()) {
    if (!Number.isSafeInteger(eventOriginServerTsMs) || eventOriginServerTsMs <= 0) {
      return { drop: false, warnSkew: false };
    }
    if (eventOriginServerTsMs < this.#startupTsMs - GRACE_MS) {
      return { drop: true, warnSkew: false };
    }
    const skewMs = nowMs - eventOriginServerTsMs;
    if (skewMs <= SKEW_THRESHOLD_MS || nowMs - this.#startupTsMs < SKEW_OBSERVE_AFTER_MS) {
      this.#skewStreak = 0;
      return { drop: false, warnSkew: false };
    }
    this.#skewStreak += 1;
    if (!this.#warned && this.#skewStreak >= SKEW_STREAK_TO_WARN) {
      this.#warned = true;
      return { drop: true, warnSkew: true };
    }
    return { drop: this.#warned, warnSkew: false };
  }

  get warned() {
    return this.#warned;
  }
}

export function isSelfSender(sender, botUserId) {
  // An unresolved own identity is treated as self: dropping a first message is
  // survivable, answering oneself in a loop is not.
  const own = lowerId(botUserId);
  if (!own) return true;
  return lowerId(sender) === own;
}

export function isBridgeOrSystemSender(sender) {
  const raw = typeof sender === 'string' ? sender.trim() : '';
  if (!raw.startsWith('@')) return true;
  const localpart = localpartOf(raw);
  if (!localpart) return true;
  // Appservice bridges and puppeting conventions prefix virtual users with `_`.
  return localpart.startsWith('_');
}

export function compileIgnorePatterns(values) {
  const patterns = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      patterns.push(new RegExp(value, 'iu'));
    } catch {
      // A broken operator pattern must not break the funnel; it is skipped.
    }
  }
  return patterns;
}

export function matchesIgnoredSender(sender, patterns) {
  const raw = typeof sender === 'string' ? sender.trim() : '';
  if (!raw) return false;
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(raw);
  });
}

/**
 * Mention detection with a fallback chain: the MSC3952 `m.mentions.user_ids`
 * signal is authoritative, then a raw full MXID in the body, then a pill link
 * in formatted_body, then a word-bounded localpart. One weak signal missing
 * never silences the bot because the chain keeps the stronger ones.
 */
export function detectMatrixMention(content, botUserId) {
  const own = lowerId(botUserId);
  if (!own) return false;
  const mentions = Array.isArray(content?.['m.mentions']?.user_ids) ? content['m.mentions'].user_ids : [];
  if (mentions.some((candidate) => lowerId(candidate) === own)) return true;
  const body = typeof content?.body === 'string' ? content.body : '';
  if (body.toLowerCase().includes(`<${own}>`)) return true;
  if (body.toLowerCase().includes(own)) {
    const escaped = own.replace(/[.*+?^${}()|\\\[\]]/g, '\\$&');
    if (new RegExp(`(^|[^A-Za-z0-9._=\\-\\/+])${escaped}($|[^A-Za-z0-9._=\\-\\/+])`, 'iu').test(body)) return true;
  }
  const formatted = typeof content?.formatted_body === 'string' ? content.formatted_body : '';
  if (formatted.toLowerCase().includes(`matrix.to/#/${own}`)) return true;
  const localpart = localpartOf(own);
  if (localpart.length >= 2 && localpart !== 'room' && localpart !== 'all') {
    const escaped = localpart.replace(/[.*+?^${}()|\\\[\]]/g, '\\$&');
    const bodyHit = new RegExp(`(^|[^A-Za-z0-9._=\\-\\/+])@${escaped}($|[^A-Za-z0-9._=\\-\\/+])`, 'iu').test(body);
    if (bodyHit) return true;
  }
  return false;
}

/**
 * Remove bot-directed mention forms from prompt text. Only full `@local:server`
 * forms and Matrix pill forms are stripped; a bare localpart word is never
 * removed so phrases like "Hermes Agent" survive intact.
 */
export function stripMatrixMentions(body, botUserId) {
  let text = String(body ?? '');
  const own = lowerId(botUserId);
  if (own) {
    const escaped = own.replace(/[.*+?^${}()|\\\[\]]/g, '\\$&');
    const pill = new RegExp(`\\[<${escaped}>\\]\\(https?://matrix\\.to/[^)]*\\)`, 'gi');
    text = text.replaceAll(pill, '');
    text = text.replaceAll(new RegExp(`<${escaped}>`, 'gi'), '');
    text = text.replaceAll(new RegExp(escaped, 'gi'), '');
  }
  return text.trim();
}

export function isMatrixCommandLike(text) {
  return /^[/!][A-Za-z][A-Za-z0-9_-]{0,63}(\s|$)/.test(String(text ?? '').trim());
}

export function resolveBangMatrixCommand(text, isKnownSlashCommand) {
  const trimmed = String(text ?? '');
  if (!trimmed.startsWith('!') || trimmed.startsWith('!!')) return trimmed;
  const candidate = trimmed.replace(/^!/, '');
  const token = `/${candidate.split(/\s/u, 1)[0] ?? ''}`.replace(/[。？！,.!?；;:]+$/u, '');
  const name = token.slice(1);
  if (!name || typeof isKnownSlashCommand !== 'function') return trimmed;
  if (!isKnownSlashCommand(name) && !isKnownSlashCommand(token)) return trimmed;
  return `/${candidate}`;
}

const MEDIA_MSGTYPES = new Set(['m.image', 'm.audio', 'm.video', 'm.file']);

function eventOriginTs(event) {
  const ts = Number(event?.origin_server_ts ?? event?.['org.matrix.server_ts']);
  return Number.isSafeInteger(ts) && ts > 0 ? (ts < 1e12 ? ts * 1_000 : ts) : null;
}

/** The thread root a timeline event belongs to, from its MSC3402 relations. */
export function threadIdOf(content) {
  const relates = content?.['m.relates_to'];
  if (!relates || typeof relates !== 'object') return null;
  const chain = Array.isArray(relates.chain) ? relates.chain : [];
  const threaded = chain.find((entry) => entry?.rel_type === 'm.thread') ?? (relates.rel_type === 'm.thread' ? relates : null);
  const eventId = typeof threaded?.event_id === 'string' ? threaded.event_id : null;
  return eventId && isMatrixEventId(eventId) ? eventId : null;
}

function cleanEventId(value) {
  const eventId = typeof value === 'string' ? value.trim() : '';
  return eventId && isMatrixEventId(eventId) ? eventId : null;
}

/**
 * The target of a genuine reply relation, in either relation form the Matrix
 * spec permits: the new form names it under `m.relates_to` with
 * `rel_type: "m.reply"`, the legacy form under the top-level `m.in_reply_to`,
 * and this plugin's own writer nests it under `m.relates_to` for the events it
 * sends itself. The `is_falling_back` marker — at `m.relates_to`, at the
 * legacy `m.in_reply_to`, or on the nested form — demotes the declaration to
 * the thread-membership statement clients attach automatically when sending
 * inside a thread; per the spec that is not a human reply, so it must not
 * drive reply context collection, reply classification, recorded reply targets,
 * or the thread fork decision.
 */
export function replyEventIdOf(content) {
  const relates = content?.['m.relates_to'];
  const legacy = content?.['m.in_reply_to'];
  const nested = relates?.['m.in_reply_to'];
  if (relates?.is_falling_back === true || legacy?.is_falling_back === true || nested?.is_falling_back === true) return null;
  if (relates?.rel_type === 'm.reply') {
    const target = cleanEventId(relates.event_id);
    if (target) return target;
  }
  for (const candidate of [legacy?.event_id, nested?.event_id]) {
    const target = cleanEventId(candidate);
    if (target) return target;
  }
  return null;
}

/**
 * Project one timeline event into the normalized bridge message, or into a
 * typed drop reason. The order of gates is fixed: self, bridge/system,
 * ignore patterns, dedup, clock, shape, notice/edit, room policy, mention
 * policy. Media sources are created through `deps.createMediaSource` so the
 * funnel stays free of transport code.
 */
export function normalizeMatrixTimelineEvent({
  event,
  roomId,
  botUserId,
  isDirect,
  config = {},
  patterns = [],
  ring,
  clock,
  deps = {},
} = {}) {
  const senderId = typeof event?.sender === 'string' ? event.sender.trim() : '';
  const eventId = typeof event?.event_id === 'string' ? event.event_id.trim() : '';
  if (!isMatrixRoomId(roomId) || !eventId || !senderId) return { drop: 'malformed' };
  if (isSelfSender(senderId, botUserId)) return { drop: 'self' };
  if (isBridgeOrSystemSender(senderId)) return { drop: 'bridge' };
  if (matchesIgnoredSender(senderId, patterns)) return { drop: 'ignored' };
  if (ring && !ring.mark(eventId)) return { drop: 'duplicate' };
  if (clock) {
    const verdict = clock.evaluate(eventOriginTs(event));
    if (verdict.drop) return { drop: 'clock', warnSkew: verdict.warnSkew };
  }
  if (event?.type !== 'm.room.message') return { drop: 'type' };
  const content = event.content && typeof event.content === 'object' ? event.content : {};
  const msgtype = typeof content.msgtype === 'string' ? content.msgtype : 'm.text';
  if (msgtype === 'm.notice' && config.processNotices !== true) return { drop: 'notice' };
  const isEdit = content['m.relates_to']?.rel_type === 'm.replace';
  if (isEdit) return { drop: 'edit' };

  const kind = isDirect ? 'direct' : 'group';
  const allowedRooms = config.allowedRooms instanceof Set ? config.allowedRooms : null;
  if (kind === 'group' && allowedRooms && allowedRooms.size > 0 && !allowedRooms.has(roomId)) {
    return { drop: 'room-not-allowed' };
  }

  const threadId = threadIdOf(content);
  const replyToEventId = replyEventIdOf(content);
  const rawText = typeof content.body === 'string' ? content.body : '';
  const mentioned = detectMatrixMention(content, botUserId);
  const commandLike = isMatrixCommandLike(rawText);
  // One table decides the mention gate and the addressed bit, shared with other
  // channels through the trigger policy. `triggerOnReply` defaults to 'never' —
  // a room message wakes the bot only through an @-mention or a command, so an
  // unaddressed reply on the room timeline or in a thread stays a recorded fact.
  // 'any' restores the 4.25-era shape where every reply relation addresses the
  // bot; 'bot-only' requires the channel's classifier (usually the bot-event
  // binding table) to prove the reply answers one of the bot's own messages.
  const replyTargetKind = kind === 'group' && replyToEventId !== null
    && typeof deps.classifyReplyTarget === 'function'
    ? deps.classifyReplyTarget(replyToEventId) ?? null
    : null;
  const gate = evaluateTrigger({
    kind,
    requireMention: config.requireMention,
    freeResponse: config.freeResponseRooms instanceof Set && config.freeResponseRooms.has(roomId),
    mentioned,
    commandLike,
    replyToPresent: replyToEventId !== null,
    replyTargetKind,
    replyMode: config.triggerOnReply,
  });
  if (!gate.pass) return { drop: gate.reason };

  const text = stripMatrixMentions(rawText, botUserId);
  const media = MEDIA_MSGTYPES.has(msgtype)
    ? (deps.createMediaSource ? deps.createMediaSource(content, msgtype) : null)
    : null;
  if (MEDIA_MSGTYPES.has(msgtype) && !media) return { drop: 'media-unusable' };
  if (msgtype !== 'm.text' && msgtype !== 'm.notice' && !MEDIA_MSGTYPES.has(msgtype)) return { drop: 'type' };

  // Thread conversation fork policy. A genuine reply whose thread root equals
  // its reply target says "answer this message" — the client started a thread at
  // the replied-to event — so it inherits the conversation its target belongs to
  // (the room's main conversation) instead of forking a fresh session. The
  // thread-membership declaration clients attach automatically (a falling-back
  // relation) is not a human reply and never selects a conversation: posts made
  // inside a thread fork that thread's own conversation. A reply to a root the
  // bot itself authored does the same — the panel under a bot answer is read as
  // its own message list, not as a continuation of the mainline turn the answer
  // once replied to. `isolate` restores fork-always; `auto` prefers the
  // bot-event binding table when the channel supplies one for the reply target.
  const threadsMode = config.threadsMode === 'isolate' || config.threadsMode === 'auto'
    ? config.threadsMode
    : 'inherit';
  const rootIsBotAuthored = kind === 'group' && threadId !== null
    && ((typeof deps.classifyReplyTarget === 'function' && deps.classifyReplyTarget(threadId) === 'bot')
      || (typeof deps.isBotRoomEvent === 'function' && deps.isBotRoomEvent(roomId, threadId) === true));
  const inheritsThreadTarget = kind === 'group' && threadId !== null
    && threadsMode !== 'isolate' && replyToEventId === threadId && !rootIsBotAuthored;
  const routeThreadId = kind === 'group' && threadId !== null && !inheritsThreadTarget ? threadId : null;
  const boundRouteKey = threadsMode === 'auto' && kind === 'group' && replyToEventId !== null
    && typeof deps.routeOverrideForReply === 'function'
    ? deps.routeOverrideForReply(replyToEventId)
    : null;
  const routeKey = typeof boundRouteKey === 'string' && boundRouteKey
    ? boundRouteKey
    : encodeConversationRouteKey(buildConversationRoute({
      channel: 'matrix',
      botId: config.botId ?? null,
      chatId: roomId,
      senderId,
      threadId: routeThreadId,
      kind,
    }));
  const keyPrefix = kind === 'direct' ? 'direct:' : 'group:';
  const conversationId = routeKey.startsWith(keyPrefix) ? routeKey.slice(keyPrefix.length) : routeKey;

  return {
    message: {
      kind,
      roomId,
      messageId: eventId,
      senderId,
      senderIsBot: false,
      conversationId,
      contextSource: () => ({ chatId: roomId, ...(threadId ? { threadId } : {}) }),
      content: text,
      plainText: msgtype === 'm.text' && content.format !== 'org.matrix.custom.html',
      images: media?.images ?? [],
      files: media?.files ?? [],
      addressed: gate.addressed,
      mentioned,
      threadId,
      replyToEventId,
      reactionTarget: { roomId, eventId },
      replyTarget: {
        roomId,
        ...(threadId ? { threadId } : {}),
        ...(!threadId && replyToEventId ? { replyToEventId } : {}),
        recipientUserId: senderId,
      },
      ...(kind === 'direct' ? { connectionTestTarget: { roomId } } : {}),
    },
  };
}

export function normalizeMatrixDeliveryTarget({ kind, route } = {}) {
  if (kind === 'room') {
    if (Object.keys(route ?? {}).join(',') !== 'roomId') return { error: 'route' };
    const roomId = String(route.roomId ?? '').trim();
    if (!isMatrixRoomId(roomId)) return { error: 'roomId' };
    return { value: { kind, roomId } };
  }
  if (kind === 'thread') {
    if (Object.keys(route ?? {}).sort().join(',') !== 'roomId,threadId') return { error: 'route' };
    const roomId = String(route.roomId ?? '').trim();
    const threadId = String(route.threadId ?? '').trim();
    if (!isMatrixRoomId(roomId)) return { error: 'roomId' };
    if (!isMatrixEventId(threadId)) return { error: 'threadId' };
    return { value: { kind, roomId, threadId } };
  }
  if (kind === 'dm') {
    if (Object.keys(route ?? {}).join(',') !== 'userId') return { error: 'route' };
    const userId = String(route.userId ?? '').trim();
    if (!isMatrixUserId(userId)) return { error: 'userId' };
    return { value: { kind, userId } };
  }
  return { error: 'kind' };
}

export function matrixConversationKeyFromTarget(target) {
  if (!target) return null;
  if (target.kind === 'dm') {
    return encodeConversationRouteKey(buildConversationRoute({
      channel: 'matrix',
      chatId: target.userId,
      senderId: target.userId,
      kind: 'dm',
    })).slice('direct:'.length);
  }
  return encodeConversationRouteKey(buildConversationRoute({
    channel: 'matrix',
    chatId: target.roomId,
    threadId: 'threadId' in target ? target.threadId : null,
  })).slice('group:'.length);
}
