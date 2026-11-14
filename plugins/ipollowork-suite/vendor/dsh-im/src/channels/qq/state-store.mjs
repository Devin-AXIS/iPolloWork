import { createMenuIntroductionSupport, menuIntroductionFields } from '../shared/menu-introduction.mjs';
import { deferredStateAccess, normalizeDeferredState } from '../shared/deferred-state.mjs';
import { createSessionRingSupport, normalizePendingTitles, normalizeSessionRings } from '../shared/session-ring-support.mjs';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { qqStateError } from './state-error.mjs';

const PENDING_MESSAGE_LIMIT = 200;
const AUTHOR_LIMIT = 500;
const EMPTY_STATE = Object.freeze({ version: 1, sessions: {}, seenMessageIds: [] });

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
  for (const key of Object.keys(value).slice(-AUTHOR_LIMIT)) {
    const author = normalizeAuthor(value[key]);
    if (author) authors[key] = author;
  }
  return authors;
}

/**
 * A message persisted when it enters the QQ bridge's in-memory queue, so a
 * restart before its turn runs can replay it (submitted: false) or report it
 * (submitted: true, meaning the Harness inbox already owns it). Mirrors the
 * shared ConversationStateStore contract used by the other text bridges.
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
      if (typeof key === 'string' && typeof sessionId === 'string' && sessionId) {
        sessions[key] = sessionId;
      }
    }
  }
  // An empty queue leaves no key behind, so an untouched state file keeps the
  // shape earlier versions wrote.
  const pendingMessages = normalizePendingMessages(value.pendingMessages);
  // A file written before the navigation ring existed loads unchanged: the keys
  // are only added when they hold something.
  const rings = normalizeSessionRings(value.rings);
  const pendingTitles = normalizePendingTitles(value.pendingTitles);
  return {
    version: 1,
    ...menuIntroductionFields(value),
    sessions,
    ...(value.authors ? { authors: normalizeAuthors(value.authors) } : {}),
    includeArchivedSessions: value.includeArchivedSessions === true,
    ...(pendingMessages.length ? { pendingMessages } : {}),
    ...(value.deferred ? { deferred: normalizeDeferredState(value.deferred) } : {}),
    seenMessageIds: Array.isArray(value.seenMessageIds)
      ? value.seenMessageIds.filter((id) => typeof id === 'string').slice(-1_000)
      : [],
    ...(Object.keys(rings).length ? { rings } : {}),
    ...(Object.keys(pendingTitles).length ? { pendingTitles } : {}),
  };
}

export class QqStateStore {
  #path;
  #logger;
  #state = structuredClone(EMPTY_STATE);
  #writeQueue = Promise.resolve();
  #deferred = deferredStateAccess(() => this.#state, () => this.#persist());

  constructor(path, { logger = console } = {}) {
    this.#path = path;
    this.#logger = logger;
    // The navigation ring is a view over this store's state, shared with the
    // channels that inherit `ConversationStateStore`.
    Object.assign(this, createMenuIntroductionSupport({ state: () => this.#state, persist: () => this.#persist() }));
    Object.assign(this, createSessionRingSupport({
      state: () => this.#state,
      persist: () => this.#persist(),
    }));
  }
  async load() {
    let bytes;
    try {
      bytes = await fs.readFile(this.#path);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw qqStateError('state-read-failed', error);
      this.#state = structuredClone(EMPTY_STATE);
      await this.#persist();
      return this;
    }

    let parsed;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      const backup = `${this.#path}.corrupt-${Date.now()}-${randomUUID()}`;
      try {
        // Copy the exact bytes before replacing anything. A failed rebuild
        // leaves both the original and this exclusive backup available.
        await fs.writeFile(backup, bytes, { flag: 'wx', mode: 0o600 });
      } catch (cause) {
        throw qqStateError('state-backup-failed', cause);
      }
      this.#state = structuredClone(EMPTY_STATE);
      await this.#persist();
      this.#logger.warn?.(`[dsh-im:qq] state-recovered: ${this.#path}; backup: ${backup}; conversation mappings, message deduplication and deferred deliveries have been reset.`);
      return this;
    }
    this.#state = normalizeState(parsed);
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

  includesArchivedSessions() { return this.#state.includeArchivedSessions === true; }

  authorFor(key) {
    const author = this.#state.authors?.[key];
    return author ? structuredClone(author) : null;
  }

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

  async setIncludeArchivedSessions(include) {
    this.#state.includeArchivedSessions = include === true;
    await this.#persist();
  }

  sessionFor(key) {
    return this.#state.sessions[key] ?? null;
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

  snapshot() {
    return structuredClone(this.#state);
  }

  async remove() {
    try {
      await fs.unlink(this.#path);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    this.#state = structuredClone(EMPTY_STATE);
  }

  async #persist() {
    const snapshot = `${JSON.stringify(this.#state, null, 2)}\n`;
    const operation = this.#writeQueue.then(async () => {
      await fs.mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.tmp`;
      await fs.writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporary, this.#path);
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    await operation.catch(error => { throw qqStateError('state-write-failed', error); });
  }
}
