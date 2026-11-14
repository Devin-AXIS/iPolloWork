/**
 * Channel-neutral conversation routes plus the single generator of the
 * conversation session keys stored in a channel's state file.
 *
 * The codecs encode the established on-disk shapes so adopting this module
 * never rewrites an existing key: Matrix keeps `direct:dm:<lower user id>`
 * and `group:room:<roomId>[$<thread root>]` (event ids themselves begin with
 * `$`, so a thread key reads with a `$$` run on disk); Feishu group chats keep
 * `group:<chatId>` and `group:<chatId>:thread:<threadId>`. Feishu p2p keys
 * are produced by the channel's own `conversationKey` helper until the parity
 * cutover moves them here; the codec therefore refuses to encode a Feishu dm
 * route instead of inventing a second shape.
 */

/**
 * @typedef {Object} ConversationRoute
 * @property {string} channel          Codec selector ('matrix', 'feishu', ...).
 * @property {?string} botId           Bot identity for namespacing; null when the channel key is not bot-scoped.
 * @property {string} chatId           Room / chat id: Matrix `room_id`, Feishu `chat_id`.
 * @property {?string} senderId        Sender identity, required by dm routes.
 * @property {?string} threadId        Server-side thread root (Matrix event id, Feishu thread_id); null on main-feed routes.
 * @property {'dm'|'group'|'thread'} scope
 */

const MATRIX_CODEC = Object.freeze({
  dm: (route) => `direct:dm:${String(route.senderId ?? '').trim().toLowerCase()}`,
  group: (route) => `group:room:${route.chatId}${route.threadId ? `$${route.threadId}` : ''}`,
});

const FEISHU_CODEC = Object.freeze({
  dm: null,
  group: (route) => (route.threadId ? `group:${route.chatId}:thread:${route.threadId}` : `group:${route.chatId}`),
});

const CODECS = Object.freeze({ matrix: MATRIX_CODEC, feishu: FEISHU_CODEC });

/**
 * Build one frozen conversation route from the channel-neutral parts.
 * @param {Object} parts - route parts; `kind` accepts 'direct'|'dm'|'group'.
 * @returns {ConversationRoute}
 */
export function buildConversationRoute({ channel, botId = null, chatId, senderId = null, threadId = null, kind = 'group' } = {}) {
  if (typeof channel !== 'string' || !channel) throw new TypeError('A conversation route requires a channel');
  if (typeof chatId !== 'string' || !chatId) throw new TypeError('A conversation route requires a chat id');
  const scope = kind === 'direct' || kind === 'dm'
    ? 'dm'
    : (typeof threadId === 'string' && threadId ? 'thread' : 'group');
  return Object.freeze({
    channel,
    botId: typeof botId === 'string' && botId ? botId : null,
    chatId,
    senderId: typeof senderId === 'string' && senderId ? senderId : null,
    threadId: scope === 'thread' ? threadId : null,
    scope,
  });
}

/**
 * The one place conversation session keys are produced.
 * @param {ConversationRoute} route
 * @returns {string} the durable conversation key, e.g. `group:room:!a:x.org$$root:y.org`.
 */
export function encodeConversationRouteKey(route) {
  const codec = CODECS[route?.channel];
  if (!codec) throw new TypeError(`No conversation key codec is registered for channel "${route?.channel ?? '?'}"`);
  const encode = codec[route.scope === 'dm' ? 'dm' : 'group'];
  if (typeof encode !== 'function') {
    throw new TypeError(`Channel "${route.channel}" cannot encode a ${route.scope} route`);
  }
  return encode(route);
}
