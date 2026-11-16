/**
 * Per-group reply triggers for the Telegram channel.
 *
 * A bot in a group used to wake up only when someone mentioned it or replied to
 * one of its messages. This module owns the richer, per-chat rule set:
 *
 *   off          — stay quiet (opt-in; chats without a rule keep the legacy
 *                  "mention or reply" behaviour);
 *   mention      — reply to @username mentions and replies, from anyone;
 *   mention-list — the same, but only from the listed member IDs;
 *   all          — reply to every message, from anyone;
 *   all-list     — every message, but only from the listed member IDs.
 *
 * The settings live in the bot config next to `thinkingTraces`/`alias`, so they
 * travel with the account instead of a side file, and every update restarts the
 * runtime through the controller.
 */

export const GROUP_TRIGGER_VERSION = 1;
export const GROUP_TRIGGER_MODES = Object.freeze(['off', 'mention', 'mention-list', 'all', 'all-list']);
export const GROUP_TRIGGER_LIST_MODES = Object.freeze(['mention-list', 'all-list']);
export const GROUP_TRIGGER_MAX_SENDERS = 500;
export const GROUP_TRIGGER_MAX_ID_LENGTH = 64;
export const GROUP_TRIGGER_DEFAULT_SCOPE = Object.freeze(Object.freeze({
  mode: 'mention',
  senders: Object.freeze([]),
}));

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const TELEGRAM_INTERNAL_MESSAGE_LINK = /^(?:https?:\/\/)?t\.me\/c\/(\d{1,20})(?:\/\d{1,20}){0,2}\/?$/i;
const TELEGRAM_PUBLIC_LINK = /^(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{4,64})(?:\/\d{1,20}){0,2}\/?$/i;
const TELEGRAM_INVITE_LINK = /^(?:https?:\/\/)?t\.me\/(?:joinchat\/|\+)([A-Za-z0-9_-]{1,128})\/?$/i;
const TELEGRAM_HANDLE = /^@([A-Za-z][A-Za-z0-9_]{3,63})$/;
const NUMERIC_CHAT_ID = /^-?\d{1,20}$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function invalidGroupTriggers(message) {
  const error = new TypeError(message);
  error.code = 'group-triggers-invalid';
  return error;
}

function cleanIdentifier(value) {
  const text = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > GROUP_TRIGGER_MAX_ID_LENGTH || CONTROL_CHARACTERS.test(text)) return '';
  return text;
}

function normalizeSenders(value) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw invalidGroupTriggers('Member IDs must be an array.');
  const senders = [];
  for (const entry of value) {
    const id = cleanIdentifier(entry);
    if (!id) throw invalidGroupTriggers(`Member IDs must be non-empty strings up to ${GROUP_TRIGGER_MAX_ID_LENGTH} characters.`);
    if (!senders.includes(id)) senders.push(id);
    if (senders.length > GROUP_TRIGGER_MAX_SENDERS) {
      throw invalidGroupTriggers(`At most ${GROUP_TRIGGER_MAX_SENDERS} member IDs are supported per group.`);
    }
  }
  return Object.freeze(senders);
}

export function normalizeGroupTriggerScope(value) {
  const source = isRecord(value) ? value : {};
  const mode = GROUP_TRIGGER_MODES.includes(source.mode) ? source.mode : GROUP_TRIGGER_DEFAULT_SCOPE.mode;
  return Object.freeze({ mode, senders: normalizeSenders(source.senders) });
}

export function normalizeGroupTriggers(value) {
  const source = isRecord(value) ? value : {};
  const groups = {};
  const rawGroups = isRecord(source.groups) ? source.groups : {};
  for (const [chatId, scope] of Object.entries(rawGroups)) {
    const id = cleanIdentifier(chatId);
    if (!id) continue;
    groups[id] = normalizeGroupTriggerScope(scope);
  }
  const hidden = [];
  if (Array.isArray(source.hiddenGroupIds)) {
    for (const entry of source.hiddenGroupIds) {
      const id = cleanIdentifier(entry);
      if (id && !hidden.includes(id)) hidden.push(id);
    }
  }
  return Object.freeze({
    version: GROUP_TRIGGER_VERSION,
    defaults: normalizeGroupTriggerScope(source.defaults),
    groups: Object.freeze(groups),
    // Chats the owner hid in the settings panel. They stay in the group
    // history; the panel simply stops offering them.
    hiddenGroupIds: Object.freeze(hidden),
  });
}

/** The rule that applies to a chat: its own entry, otherwise the defaults. */
export function groupTriggerScopeFor(config, chatId) {
  const normalized = config?.version === GROUP_TRIGGER_VERSION && config.defaults
    ? config : normalizeGroupTriggers(config);
  const id = cleanIdentifier(chatId);
  return (id && Object.hasOwn(normalized.groups, id) ? normalized.groups[id] : normalized.defaults);
}

export function groupTriggerModeFor(config, chatId) {
  return groupTriggerScopeFor(config, chatId).mode;
}

/**
 * Whether a group message should wake the model.
 *
 * `tagged` is the legacy signal: an @username mention or a reply to the bot.
 * Direct chats never reach this function — they are always addressed.
 */
export function groupTriggerAddressed(config, { chatId, senderId, tagged = false } = {}) {
  const scope = groupTriggerScopeFor(config, chatId);
  const member = scope.senders.includes(typeof senderId === 'string' ? senderId : String(senderId ?? ''));
  if (scope.mode === 'mention') return tagged === true;
  if (scope.mode === 'all') return true;
  if (scope.mode === 'mention-list') return tagged === true && member;
  if (scope.mode === 'all-list') return member;
  return false;
}

/** Chat IDs hidden in the settings panel. */
export function hiddenGroupIds(value) {
  const normalized = value?.version === GROUP_TRIGGER_VERSION ? value : normalizeGroupTriggers(value);
  return normalized.hiddenGroupIds;
}

/**
 * Split whatever the owner pasted into a Telegram chat reference.
 *
 * Numeric IDs and `t.me/c/<internal>/...` links already determine the chat id;
 * usernames and invite links only resolve through the Bot API.
 */
export function parseGroupReference(value) {
  const text = typeof value === 'string' ? value.replace(/[\s\u00a0]+/g, '') : '';
  if (!text) throw invalidGroupTriggers('Enter a group ID, @username or a t.me link.');
  if (NUMERIC_CHAT_ID.test(text)) return { chatId: text, query: text, numeric: true };
  const internal = text.match(TELEGRAM_INTERNAL_MESSAGE_LINK);
  if (internal) {
    const chatId = `-100${internal[1]}`;
    return { chatId, query: chatId, numeric: true };
  }
  // `getChat` accepts a numeric id or a supergroup/channel @username only, so an
  // invite link can never be resolved by the Bot API; reject it explicitly
  // instead of forwarding a URL the platform would refuse.
  if (TELEGRAM_INVITE_LINK.test(text)) {
    throw invalidGroupTriggers('Invite links cannot be resolved through the Bot API. Use the group @username or its numeric ID.');
  }
  const named = text.match(TELEGRAM_PUBLIC_LINK);
  if (named) return { chatId: null, query: `@${named[1]}`, numeric: false };
  const handle = text.match(TELEGRAM_HANDLE);
  if (handle) return { chatId: null, query: `@${handle[1]}`, numeric: false };
  throw invalidGroupTriggers('Unrecognized group reference; use a numeric ID, @username or a t.me link.');
}

/**
 * Resolve a pasted reference into the real chat id.
 *
 * `getChat` is injected so the caller owns the Bot API token and tests can run
 * without a network. Numeric references still succeed when the API is down;
 * usernames and invites cannot, and the error tells the owner what to do.
 */
export async function resolveGroupReference(value, { getChat } = {}) {
  const reference = parseGroupReference(value);
  if (!reference.chatId && typeof getChat !== 'function') {
    throw invalidGroupTriggers('Could not resolve this reference through Telegram (Bot API is unavailable). Retry later or enter the numeric group ID.');
  }
  let chat = null;
  let failure = null;
  if (typeof getChat === 'function') {
    try {
      chat = await getChat(reference.query);
    } catch (error) {
      failure = error;
    }
  }
  if (!chat && reference.numeric && /^\d{6,20}$/.test(reference.chatId)) {
    try {
      chat = await getChat(`-100${reference.chatId}`);
    } catch {
      // The first attempt already recorded the failure worth reporting.
    }
  }
  const chatId = chat?.id === undefined || chat?.id === null ? reference.chatId : String(chat.id);
  if (!chatId) {
    const reason = failure && typeof failure.message === 'string' && failure.message
      ? failure.message : 'Bot API is unavailable';
    throw invalidGroupTriggers(`Could not resolve this reference through Telegram (${reason}). Retry later or enter the numeric group ID.`);
  }
  if (chat?.type === 'private') {
    throw invalidGroupTriggers('This reference points to a private chat, not a group.');
  }
  return Object.freeze({
    chatId,
    title: typeof chat?.title === 'string' && chat.title.trim() ? chat.title.trim() : null,
    type: typeof chat?.type === 'string' ? chat.type : null,
    verified: Boolean(chat),
  });
}

/** Panel view: the stored rules plus the groups the bot has actually seen. */
export function groupTriggersSettings(config, seenGroups = []) {
  const normalized = config?.version === GROUP_TRIGGER_VERSION ? config : normalizeGroupTriggers(config);
  const hidden = new Set(normalized.hiddenGroupIds);
  const groups = {};
  for (const [chatId, scope] of Object.entries(normalized.groups)) {
    if (hidden.has(chatId)) continue;
    groups[chatId] = { mode: scope.mode, senders: [...scope.senders] };
  }
  const seen = [];
  for (const entry of Array.isArray(seenGroups) ? seenGroups : []) {
    const chatId = cleanIdentifier(entry?.chatId);
    if (!chatId || hidden.has(chatId) || seen.some((item) => item.chatId === chatId)) continue;
    seen.push({
      chatId,
      title: typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : null,
      type: typeof entry.type === 'string' ? entry.type : null,
      lastSeenAt: typeof entry.lastSeenAt === 'string' ? entry.lastSeenAt : null,
      lastSenderName: typeof entry.lastSenderName === 'string' ? entry.lastSenderName : null,
    });
  }
  return { defaults: { mode: normalized.defaults.mode, senders: [...normalized.defaults.senders] }, groups, seen };
}
