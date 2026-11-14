// Email conversation keys contain Message-IDs or bound Session IDs, not
// recipient addresses. Keep email targets explicit until a mapping is stored.
const CHANNELS = new Set([
  'weixin',
  'feishu',
  'dingtalk',
  'wecom',
  'wecom-app',
  'qq',
  'slack',
  'telegram',
  'discord',
  'whatsapp',
  'imessage',
  'matrix',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function opaqueId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 512
    && value.trim() === value
    && !/[\s:\u0000-\u001f\u007f]/u.test(value);
}

function afterPrefix(key, prefix) {
  const marker = `${prefix}:`;
  if (!key.startsWith(marker)) return null;
  const value = key.slice(marker.length);
  return opaqueId(value) ? value : null;
}

function simpleSuggestion(key, definitions) {
  for (const [prefix, kind, field] of definitions) {
    const value = afterPrefix(key, prefix);
    if (value) return { kind, route: { [field]: value } };
  }
  return null;
}

function feishuSuggestion(key) {
  const openId = afterPrefix(key, 'p2p');
  if (openId?.startsWith('ou_')) {
    return { kind: 'user', route: { openId } };
  }
  return simpleSuggestion(key, [['group', 'group', 'chatId']]);
}

function slackSuggestion(key) {
  const directChannel = afterPrefix(key, 'direct');
  if (directChannel && /^[A-Za-z0-9_-]{1,128}$/.test(directChannel)) {
    return { kind: 'conversation', route: { channelId: directChannel } };
  }
  const match = /^group:([^:]+):(\d{1,20}(?:\.\d{1,20})?)$/.exec(key);
  if (!match || !/^[A-Za-z0-9_-]{1,128}$/.test(match[1])) return null;
  return { kind: 'thread', route: { channelId: match[1], threadTs: match[2] } };
}

// Telegram-only: numeric chat/topic keys can safely prefill Telegram target fields.
// Other channels must use their native route fields; never turn their keys into Telegram links.
function telegramSuggestion(key) {
  const match = /^(direct|group):(-?\d+)(?::([1-9]\d*))?$/.exec(key);
  if (!match) return null;
  const chatId = Number(match[2]);
  if (!Number.isSafeInteger(chatId)) return null;
  if (match[1] === 'direct' && match[3] !== undefined) return null;
  if (match[3] === undefined) return { kind: 'chat', route: { chatId: match[2] } };
  const messageThreadId = Number(match[3]);
  if (!Number.isSafeInteger(messageThreadId) || messageThreadId <= 0) return null;
  return { kind: 'topic', route: { chatId: match[2], messageThreadId } };
}

function discordSuggestion(key) {
  const match = /^(?:direct|group):(\d{1,32})$/.exec(key);
  return match ? { kind: 'channel', route: { channelId: match[1] } } : null;
}

function whatsappSuggestion(key) {
  const direct = /^direct:(\d{5,32}@(s\.whatsapp\.net|lid))$/.exec(key);
  if (direct) return { kind: 'user', route: { jid: direct[1] } };
  const group = /^group:(\d{5,32}(?:-\d{1,32})?@g\.us)$/.exec(key);
  return group ? { kind: 'group', route: { jid: group[1] } } : null;
}

function matrixSuggestion(key) {
  const dm = /^dm:(@[A-Za-z0-9._=\-\/+]+:[A-Za-z0-9.-]+(?::\d{1,5})?)$/.exec(key);
  if (dm) return { kind: 'dm', route: { userId: dm[1] } };
  const room = /^room:([!#][^:$\s]+:[A-Za-z0-9.-]+(?::\d{1,5})?)(?:\$(\$[^\s]+))?$/u.exec(key);
  if (!room) return null;
  if (room[2] === undefined) return { kind: 'room', route: { roomId: room[1] } };
  return { kind: 'thread', route: { roomId: room[1], threadId: room[2] } };
}

/** Convert one persisted conversation key into a stable proactive-delivery route. */
export function deliverySuggestionFromConversationKey(channel, key) {
  if (!CHANNELS.has(channel) || typeof key !== 'string') return null;
  switch (channel) {
    case 'weixin':
      return simpleSuggestion(key, [['p2p', 'user', 'toUserId']]);
    case 'feishu':
      return feishuSuggestion(key);
    case 'dingtalk':
      return simpleSuggestion(key, [
        ['p2p', 'user', 'userId'],
        ['group', 'group', 'openConversationId'],
      ]);
    case 'wecom':
      return simpleSuggestion(key, [
        ['direct', 'user', 'chatId'],
        ['group', 'group', 'chatId'],
      ]);
    case 'wecom-app':
      return simpleSuggestion(key, [['p2p', 'user', 'chatId']]);
    case 'qq':
      return simpleSuggestion(key, [
        ['c2c', 'user', 'userOpenId'],
        ['group', 'group', 'groupOpenId'],
      ]);
    case 'slack':
      return slackSuggestion(key);
    case 'telegram':
      return telegramSuggestion(key);
    case 'discord':
      return discordSuggestion(key);
    case 'whatsapp':
      return whatsappSuggestion(key);
    case 'imessage': {
      const chatGuid = key.startsWith('direct:') ? key.slice('direct:'.length) : '';
      // Older iMessage runtimes recorded every conversation as direct. Its
      // native GUID's single-recipient marker must also match; + denotes groups.
      return /^(?:iMessage|any);-;[^;]+$/u.test(chatGuid)
        && chatGuid.length <= 512 && chatGuid.trim() === chatGuid
        && !/[\u0000-\u001f\u007f]/u.test(chatGuid)
        ? { kind: 'user', route: { chatGuid } } : null;
    }
    case 'matrix':
      return matrixSuggestion(key.replace(/^(direct|group):/, ''));
    default:
      return null;
  }
}

/** Convert only a persisted private-chat key into its stable delivery route. */
export function privateDeliverySuggestionFromConversationKey(channel, key) {
  if (channel === 'matrix' && typeof key === 'string') key = key.replace(/^direct:dm:/, 'dm:');
  const separator = typeof key === 'string' ? key.indexOf(':') : -1;
  const prefix = separator > 0 ? key.slice(0, separator) : '';
  const privatePrefix = {
    weixin: 'p2p',
    feishu: 'p2p',
    dingtalk: 'p2p',
    wecom: 'direct',
    'wecom-app': 'p2p',
    qq: 'c2c',
    slack: 'direct',
    telegram: 'direct',
    discord: 'direct',
    whatsapp: 'direct',
    imessage: 'direct',
    matrix: 'dm',
  }[channel];
  if (!privatePrefix || prefix !== privatePrefix) return null;
  return deliverySuggestionFromConversationKey(channel, key);
}

function routeIdentity(value) {
  if (!isRecord(value?.route) || typeof value.kind !== 'string') return null;
  return JSON.stringify([
    value.kind,
    Object.keys(value.route).sort().map((key) => [key, value.route[key]]),
  ]);
}

/** Check that one saved private conversation key still identifies this target route. */
export function privateConversationKeyMatchesTarget(channel, key, target) {
  const suggestion = privateDeliverySuggestionFromConversationKey(channel, key);
  const suggestionIdentity = routeIdentity(suggestion);
  return suggestionIdentity !== null && suggestionIdentity === routeIdentity(target);
}

/** Resolve exactly one current private conversation for a normalized delivery target. */
export function resolvePrivateConversationKey(channel, sessions, target) {
  if (!CHANNELS.has(channel) || !isRecord(sessions)) return null;
  const matches = [];
  for (const [key, sessionId] of Object.entries(sessions)) {
    if (typeof sessionId !== 'string' || !sessionId) continue;
    if (privateConversationKeyMatchesTarget(channel, key, target)) matches.push(key);
    if (matches.length > 1) return null;
  }
  return matches[0] ?? null;
}

/**
 * Check that one saved conversation key still identifies this target route.
 *
 * Unlike the private variant this accepts every route the channel can persist —
 * a Telegram forum topic (`group:<chatId>:<threadId>`), a Slack thread, a
 * Discord channel — because mirrored text is not limited to private chat.
 * Questions and approvals keep the private gate: they are resolved through
 * `privateConversationKeyMatchesTarget` instead of this function.
 */
export function conversationKeyMatchesTarget(channel, key, target) {
  const suggestionIdentity = routeIdentity(deliverySuggestionFromConversationKey(channel, key));
  return suggestionIdentity !== null && suggestionIdentity === routeIdentity(target);
}

/** Resolve exactly one current conversation of any route kind for a normalized delivery target. */
export function resolveConversationKey(channel, sessions, target) {
  if (!CHANNELS.has(channel) || !isRecord(sessions)) return null;
  const matches = [];
  for (const [key, sessionId] of Object.entries(sessions)) {
    if (typeof sessionId !== 'string' || !sessionId) continue;
    if (conversationKeyMatchesTarget(channel, key, target)) matches.push(key);
    if (matches.length > 1) return null;
  }
  return matches[0] ?? null;
}

/**
 * Extract and de-duplicate stable delivery routes from a persisted sessions map.
 * Session ids and every other state field are intentionally ignored.
 */
export function deliverySuggestionsFromSessions(channel, sessions) {
  if (!CHANNELS.has(channel) || !isRecord(sessions)) return [];
  const suggestions = [];
  const seen = new Set();
  for (const key of Object.keys(sessions)) {
    const suggestion = deliverySuggestionFromConversationKey(channel, key);
    if (!suggestion) continue;
    const identity = JSON.stringify(suggestion);
    if (seen.has(identity)) continue;
    seen.add(identity);
    suggestions.push(suggestion);
  }
  return suggestions;
}
