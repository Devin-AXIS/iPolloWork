/**
 * Decode a stored conversation key back into the parts a caller can reason
 * about: whether it is a direct chat, a group, or a thread, plus the ids
 * inside it.
 *
 * The keys are written by the channel codecs in `./route.mjs` (and by the
 * channels that still own their own key shape), so this reader accepts every
 * shape we know about. It never invents a key: an unknown or malformed string
 * yields `null` and the caller treats the conversation as unidentified.
 *
 * Known shapes:
 *   direct:dm:<userId>              Matrix direct chat (user ids contain `:`)
 *   direct:<id>                     generic direct chat; whether <id> names
 *                                   the peer user or the DM channel depends
 *                                   on the channel (see SENDER_DIRECT_CHANNELS)
 *   p2p:<userId>                    Feishu / Weixin / WeCom app / DingTalk
 *   c2c:<openid>                    QQ private chat
 *   group:<chatId>                  group without a thread
 *   group:<chatId>:thread:<threadId> Feishu thread (older shape)
 *   group:<chatId>:<threadId>       Telegram forum topic, Slack thread
 *   group:room:<roomId>[$<root>]    Matrix room, `$` separates a thread root
 */

/**
 * @typedef {Object} ParsedConversationKey
 * @property {'dm'|'group'|'thread'} chatType
 * @property {?string} chatId
 * @property {?string} threadId
 * @property {?string} senderId
 */

const SEP = ':';

/** Everything before the first separator is the scope. */
function scopeOf(key) {
  const index = key.indexOf(SEP);
  return index === -1 ? key : key.slice(0, index);
}

function restOf(key) {
  const index = key.indexOf(SEP);
  return index === -1 ? '' : key.slice(index + 1);
}

/**
 * Channels whose `direct:<id>` suffix is the peer user id. Elsewhere (Slack,
 * Discord, WhatsApp, iMessage, email, ...) it names the DM channel or chat,
 * so reporting it as a sender would point a consumer at the wrong user.
 */
const SENDER_DIRECT_CHANNELS = new Set(['telegram', 'wecom']);

function dm(chatId, senderId) {
  return { chatType: 'dm', chatId: chatId || null, threadId: null, senderId: senderId || null };
}

function parseDirect(rest, channel) {
  // `direct:dm:<id>` — Matrix keeps an explicit `dm` marker; the user id
  // itself (`@alice:example.org`) contains the separator, so take it whole.
  if (rest.startsWith('dm' + SEP)) {
    const id = rest.slice(3);
    return id ? dm(null, id) : null;
  }
  return dm(rest, SENDER_DIRECT_CHANNELS.has(channel) ? rest : null);
}

/** `p2p:` and `c2c:` keys are written per sender by every channel that uses them. */
function parsePeer(rest) {
  return dm(null, rest);
}

function parseMatrixRoom(rest) {
  const body = rest.slice('room:'.length);
  const mark = body.indexOf('$');
  if (mark === -1) {
    return body ? { chatType: 'group', chatId: body, threadId: null, senderId: null } : null;
  }
  const chatId = body.slice(0, mark);
  const threadId = body.slice(mark + 1);
  if (!chatId || !threadId) return null;
  return { chatType: 'thread', chatId, threadId, senderId: null };
}

function parseGroup(rest) {
  // Matrix rooms keep their own prefix; everything else is `<chatId>[:<thread>]`
  // or the explicit `<chatId>:thread:<threadId>` form.
  if (rest.startsWith('room:')) return parseMatrixRoom(rest);
  const parts = rest.split(SEP);
  const chatId = parts[0];
  if (!chatId) return null;
  if (parts.length === 1) return { chatType: 'group', chatId, threadId: null, senderId: null };
  if (parts.length === 3 && parts[1] === 'thread' && parts[2]) {
    return { chatType: 'thread', chatId, threadId: parts[2], senderId: null };
  }
  if (parts.length === 2 && parts[1]) {
    return { chatType: 'thread', chatId, threadId: parts[1], senderId: null };
  }
  return null;
}

/**
 * Decode one conversation key.
 * @param {unknown} key stored conversation key
 * @param {{channel?: string}} [options] channel that stored the key; decides
 *   whether a `direct:<id>` suffix is a user id or a chat id
 * @returns {?ParsedConversationKey} parts, or null when the key is not ours
 */
export function parseConversationKey(key, { channel } = {}) {
  if (typeof key !== 'string' || key === '' || key.length > 1_024) return null;
  const scope = scopeOf(key);
  const rest = restOf(key);
  if (rest === '') return null;
  if (scope === 'direct') return parseDirect(rest, channel);
  if (scope === 'p2p' || scope === 'c2c') return parsePeer(rest);
  if (scope === 'group') return parseGroup(rest);
  return null;
}
