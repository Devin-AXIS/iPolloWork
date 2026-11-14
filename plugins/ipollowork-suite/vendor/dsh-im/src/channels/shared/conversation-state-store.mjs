import { createMenuIntroductionSupport, menuIntroductionFields } from './menu-introduction.mjs';
import { deferredStateAccess, normalizeDeferredState } from './deferred-state.mjs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  createSessionRingSupport,
  normalizePendingTitles,
  normalizeSessionRings,
} from './session-ring-support.mjs';

/**
 * Additional persisted keys a subclass may own. Kept intentionally small and
 * explicit: a subclass reads and writes them through extensionState().
 */
const EXTENSION_KEYS = Object.freeze([
  'emailBindings', 'mailCursor', 'pendingAuth', 'threadIds', 'rootAnchors',
  'whatsappBotMessageIds',
]);

const PENDING_MESSAGE_LIMIT = 200;

/**
 * How many conversations remember their last author. One entry per
 * conversation, overwritten on every inbound message, so this is a bounded
 * map of "who spoke here last" -- never a transcript.
 */
const AUTHOR_LIMIT = 500;

/**
 * Keep only what identifies the speaker: no message text, no display extras.
 * A missing or malformed id drops the entry instead of storing a half record.
 */
function normalizeAuthor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const senderId = typeof value.senderId === 'string' ? value.senderId : '';
  if (!senderId) return null;
  const author = { senderId, isBot: value.isBot === true };
  if (typeof value.senderName === 'string' && value.senderName) author.senderName = value.senderName;
  if (typeof value.senderUsername === 'string' && value.senderUsername) author.senderUsername = value.senderUsername;
  if (typeof value.at === 'string' && value.at) author.at = value.at;
  return author;
}

function normalizeAuthors(value) {
  const authors = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return authors;
  const keys = Object.keys(value);
  for (const key of keys.slice(Math.max(0, keys.length - AUTHOR_LIMIT))) {
    if (typeof key !== 'string' || !key) continue;
    const author = normalizeAuthor(value[key]);
    if (author) authors[key] = author;
  }
  return authors;
}

const EMPTY_STATE = Object.freeze({ version: 1, sessions: {}, seenMessageIds: [], cursor: null });

/**
 * A message persisted when it enters a bridge's in-memory queue, so a restart
 * before its turn runs can replay it (submitted: false) or report it
 * (submitted: true, meaning the Harness inbox already owns it).
 *
 * Wired today by TextHarnessBridge (telegram, slack, discord, matrix,
 * whatsapp, email, imessage) and QqHarnessBridge. The channels that run their
 * own queue path (weixin, dingtalk, wecom, wecom-app, feishu) still need the
 * same treatment.
 */
function validPendingMessage(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && ['id', 'key', 'messageId', 'kind', 'text']
      .every((field) => typeof value[field] === 'string' && value[field]);
}

function normalizePendingMessage(value) {
  if (!validPendingMessage(value)) return null;
  const entry = {
    id: value.id,
    key: value.key,
    messageId: value.messageId,
    kind: value.kind,
    text: value.text,
    submitted: value.submitted === true,
  };
  if (typeof value.senderId === 'string' && value.senderId) entry.senderId = value.senderId;
  if (typeof value.createdAt === 'string' && value.createdAt) entry.createdAt = value.createdAt;
  if (value.target !== undefined) {
    try {
      entry.target = structuredClone(value.target);
    } catch {
      // A target that cannot be persisted is dropped; the entry still replays.
    }
  }
  return entry;
}

function normalizePendingMessages(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizePendingMessage).filter(Boolean).slice(-PENDING_MESSAGE_LIMIT);
}

function normalizeState(value) {
  if (!value || typeof value !== 'object') return structuredClone(EMPTY_STATE);
  const sessions = {};
  if (value.sessions && typeof value.sessions === 'object' && !Array.isArray(value.sessions)) {
    for (const [key, sessionId] of Object.entries(value.sessions)) {
      if (typeof key === 'string' && key && typeof sessionId === 'string' && sessionId) {
        sessions[key] = sessionId;
      }
    }
  }
  // An empty queue leaves no key behind, so an untouched state file keeps the
  // shape earlier versions wrote.
  const pendingMessages = normalizePendingMessages(value.pendingMessages);
  // Authors are optional: a state file written before this field existed loads
  // unchanged and simply reports no author.
  const authors = normalizeAuthors(value.authors);
  const normalized = {
    version: 1,
    ...menuIntroductionFields(value),
    sessions,
    ...(Object.keys(authors).length ? { authors } : {}),
    ...(pendingMessages.length ? { pendingMessages } : {}),
    ...(value.deferred ? { deferred: normalizeDeferredState(value.deferred) } : {}),
    seenMessageIds: Array.isArray(value.seenMessageIds)
      ? value.seenMessageIds.filter((id) => typeof id === 'string' && id).slice(-1_000)
      : [],
    cursor: Number.isSafeInteger(value.cursor) && value.cursor >= 0 ? value.cursor : null,
  };
  const rings = normalizeSessionRings(value.rings);
  if (Object.keys(rings).length) normalized.rings = rings;
  const pendingTitles = normalizePendingTitles(value.pendingTitles);
  if (Object.keys(pendingTitles).length) normalized.pendingTitles = pendingTitles;
  // Channel-specific extensions survive a reload; each is normalized by the
  // subclass that owns it (see extensionKeys()).
  for (const key of EXTENSION_KEYS) {
    if (Object.hasOwn(value, key)) normalized[key] = value[key];
  }
  return normalized;
}

export class ConversationStateStore {
  #path;
  #state = structuredClone(EMPTY_STATE);
  #writeQueue = Promise.resolve();
  #deferred = deferredStateAccess(() => this.#state, () => this.#persist());

  constructor(path) {
    this.#path = path;
    // The ring is not a store of its own: it is a view over this state object,
    // shared with the channels that assemble their own store, so both sides
    // cannot drift apart.
    Object.assign(this, createMenuIntroductionSupport({ state: () => this.#state, persist: () => this.#persist() }));
    Object.assign(this, createSessionRingSupport({
      state: () => this.#state,
      persist: () => this.#persist(),
    }));
  }

  async load() {
    try {
      this.#state = normalizeState(JSON.parse(await readFile(this.#path, 'utf8')));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#state = structuredClone(EMPTY_STATE);
      await this.#persist();
    }
    return this;
  }

  deferredEntries() { return this.#deferred.entries(); }
  putDeferred(entry) { return this.#deferred.put(entry); }
  patchDeferred(id, patch) { return this.#deferred.patch(id, patch); }
  removeDeferred(id) { return this.#deferred.remove(id); }

  pendingMessages() {
    return structuredClone(this.#state.pendingMessages ?? []);
  }

  async putPendingMessage(entry) {
    const normalized = normalizePendingMessage({
      createdAt: new Date().toISOString(),
      ...entry,
    });
    if (!normalized) throw new TypeError('Invalid pending message entry');
    const list = this.#state.pendingMessages ??= [];
    const index = list.findIndex((candidate) => candidate.id === normalized.id);
    if (index < 0) list.push(normalized);
    else list[index] = normalized;
    if (list.length > PENDING_MESSAGE_LIMIT) {
      list.splice(0, list.length - PENDING_MESSAGE_LIMIT);
    }
    await this.#persist();
  }

  async patchPendingMessage(id, patch) {
    const current = (this.#state.pendingMessages ?? []).find((entry) => entry.id === id);
    if (!current) return null;
    const next = {
      ...current,
      ...patch,
      id: current.id,
      key: current.key,
      messageId: current.messageId,
      kind: current.kind,
      text: current.text,
    };
    await this.putPendingMessage(next);
    return normalizePendingMessage(next);
  }

  async removePendingMessage(id) {
    const list = this.#state.pendingMessages ?? [];
    const next = list.filter((entry) => entry.id !== id);
    if (next.length === list.length) return;
    if (next.length) this.#state.pendingMessages = next;
    else delete this.#state.pendingMessages;
    await this.#persist();
  }

  sessionFor(key) {
    return this.#state.sessions[key] ?? null;
  }

  /** The last speaker of a conversation, or null when none was recorded. */
  authorFor(key) {
    const author = this.#state.authors?.[key];
    return author ? structuredClone(author) : null;
  }

  /**
   * Remember who last spoke in a conversation. Persisted so the answer survives
   * a restart; overwritten on every inbound message and bounded by AUTHOR_LIMIT.
   */
  async rememberAuthor(key, value) {
    const author = normalizeAuthor({ at: new Date().toISOString(), ...value });
    if (typeof key !== 'string' || !key || !author) return null;
    const authors = this.#state.authors ??= {};
    delete authors[key];
    authors[key] = author;
    const keys = Object.keys(authors);
    if (keys.length > AUTHOR_LIMIT) {
      for (const stale of keys.slice(0, keys.length - AUTHOR_LIMIT)) delete authors[stale];
    }
    await this.#persist();
    return structuredClone(author);
  }

  async setSession(key, sessionId) {
    this.#state.sessions[key] = sessionId;
    await this.#persist();
  }

  async clearSession(key) {
    delete this.#state.sessions[key];
    await this.#persist();
  }

  async clearSessions() {
    this.#state.sessions = {};
    await this.#persist();
  }

  hasSeen(messageId) {
    return this.#state.seenMessageIds.includes(messageId);
  }

  async markSeen(messageId) {
    if (this.hasSeen(messageId)) return;
    this.#state.seenMessageIds.push(messageId);
    if (this.#state.seenMessageIds.length > 1_000) {
      this.#state.seenMessageIds.splice(0, this.#state.seenMessageIds.length - 1_000);
    }
    await this.#persist();
  }

  /**
   * Take back a `markSeen` whose delivery never happened.
   *
   * `markSeen` means "this message was handled". A turn that failed before
   * producing anything is not handled, so keeping the mark makes the id a
   * permanent tombstone: every later poll short-circuits on `hasSeen` and the
   * mail is never retried. The bridge calls this to separate "attempted" from
   * "done". A message that already succeeded is never unmarked.
   */
  async unmarkSeen(messageId) {
    const index = this.#state.seenMessageIds.indexOf(messageId);
    if (index === -1) return false;
    this.#state.seenMessageIds.splice(index, 1);
    await this.#persist();
    return true;
  }

  cursor() {
    return this.#state.cursor;
  }

  async setCursor(cursor) {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new TypeError('Invalid update cursor');
    this.#state.cursor = cursor;
    await this.#persist();
  }

  snapshot() {
    return structuredClone(this.#state);
  }

  /**
   * Live view of the private state for subclasses that persist their own keys.
   * Returns the real object (not a clone) so an extension can be written in
   * place; call persist() afterwards.
   */
  extensionState() {
    return this.#state;
  }

  /** Flush the current state to disk after an extension write. */
  persist() {
    return this.#persist();
  }

  async remove() {
    try {
      await unlink(this.#path);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    this.#state = structuredClone(EMPTY_STATE);
  }

  async #persist() {
    const snapshot = `${JSON.stringify(this.#state, null, 2)}\n`;
    const operation = this.#writeQueue.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.tmp`;
      await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.#path);
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    await operation;
  }
}
