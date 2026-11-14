import { createMenuIntroductionSupport, menuIntroductionFields } from '../shared/menu-introduction.mjs';
import { deferredStateAccess, normalizeDeferredState } from '../shared/deferred-state.mjs';
import { createSessionRingSupport, normalizePendingTitles, normalizeSessionRings } from '../shared/session-ring-support.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { t } from '../shared/i18n.mjs';

const EMPTY_STATE = Object.freeze({
  version: 1,
  sessions: {},
  seenMessageIds: [],
  pendingSenders: {},
  recentOutboundMessages: [],
});

export const DINGTALK_RECENT_OUTBOUND_LIMIT = 200;
export const DINGTALK_RECENT_OUTBOUND_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const DINGTALK_RECENT_OUTBOUND_TEXT_LIMIT = 8_000;
export const DINGTALK_RECENT_OUTBOUND_MATCH_TOLERANCE_MS = 15_000;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function displayName(value) {
  return (nonEmptyString(value) ?? t('钉钉用户')).slice(0, 100);
}

function timestampMs(value) {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.trunc(number < 10_000_000_000 ? number * 1_000 : number);
}

function providerMessageIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((id) => (id === undefined || id === null ? null : nonEmptyString(String(id))))
    .filter(Boolean))];
}

function truncateText(value) {
  const text = nonEmptyString(value);
  return text ? [...text].slice(0, DINGTALK_RECENT_OUTBOUND_TEXT_LIMIT).join('') : null;
}

function normalizeRecentOutboundMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const conversationKey = nonEmptyString(value.conversationKey);
  const text = truncateText(value.text);
  const sentAt = timestampMs(value.sentAt);
  const completedAt = timestampMs(value.completedAt) ?? sentAt;
  if (!conversationKey || !text || sentAt === null || completedAt === null) return null;
  return {
    conversationKey,
    text,
    sentAt,
    completedAt: Math.max(sentAt, completedAt),
    providerMessageIds: providerMessageIds(value.providerMessageIds),
  };
}

function recentOutboundMessages(value, now = Date.now()) {
  if (!Array.isArray(value)) return [];
  const cutoff = now - DINGTALK_RECENT_OUTBOUND_TTL_MS;
  return value
    .map(normalizeRecentOutboundMessage)
    .filter((entry) => entry && entry.completedAt >= cutoff)
    .slice(-DINGTALK_RECENT_OUTBOUND_LIMIT);
}

function normalizePendingSender(value, fallbackRequestId) {
  if (!value || typeof value !== 'object') return null;
  const requestId = nonEmptyString(value.requestId) ?? nonEmptyString(fallbackRequestId);
  const staffId = nonEmptyString(value.staffId);
  const requestedAt = nonEmptyString(value.requestedAt) ?? nonEmptyString(value.lastSeenAt);
  const lastSeenAt = nonEmptyString(value.lastSeenAt) ?? requestedAt;
  if (!requestId || !staffId || !requestedAt || !lastSeenAt) return null;
  return {
    requestId,
    staffId,
    displayName: displayName(value.displayName ?? value.nick),
    requestedAt,
    lastSeenAt,
  };
}

function normalizeState(value) {
  if (!value || typeof value !== 'object') return structuredClone(EMPTY_STATE);
  const sessions = {};
  if (value.sessions && typeof value.sessions === 'object' && !Array.isArray(value.sessions)) {
    for (const [key, sessionId] of Object.entries(value.sessions)) {
      const normalizedKey = nonEmptyString(key);
      const normalizedSession = nonEmptyString(sessionId);
      if (normalizedKey && normalizedSession) sessions[normalizedKey] = normalizedSession;
    }
  }

  const pendingSenders = {};
  const entries = Array.isArray(value.pendingSenders)
    ? value.pendingSenders.map((entry) => [entry?.requestId, entry])
    : Object.entries(value.pendingSenders && typeof value.pendingSenders === 'object'
      ? value.pendingSenders
      : {});
  for (const [key, candidate] of entries) {
    const pending = normalizePendingSender(candidate, key);
    if (!pending) continue;
    const duplicate = Object.values(pendingSenders).find((entry) => entry.staffId === pending.staffId);
    if (!duplicate || duplicate.lastSeenAt < pending.lastSeenAt) {
      if (duplicate) delete pendingSenders[duplicate.requestId];
      pendingSenders[pending.requestId] = pending;
    }
  }

  // A file written before the navigation ring existed loads unchanged: the keys
  // are only added when they hold something.
  const rings = normalizeSessionRings(value.rings);
  const pendingTitles = normalizePendingTitles(value.pendingTitles);
  return {
    version: 1,
    ...menuIntroductionFields(value),
    sessions,
    ...(value.deferred ? { deferred: normalizeDeferredState(value.deferred) } : {}),
    seenMessageIds: Array.isArray(value.seenMessageIds)
      ? [...new Set(value.seenMessageIds.map(nonEmptyString).filter(Boolean))].slice(-1_000)
      : [],
    pendingSenders,
    recentOutboundMessages: recentOutboundMessages(value.recentOutboundMessages),
    ...(Object.keys(rings).length ? { rings } : {}),
    ...(Object.keys(pendingTitles).length ? { pendingTitles } : {}),
  };
}

export class DingtalkStateStore {
  #path;
  #state = structuredClone(EMPTY_STATE);
  #writeQueue = Promise.resolve();
  #deferred = deferredStateAccess(() => this.#state, () => this.#persist());
  #idFactory;
  #now;

  constructor(path, { idFactory = randomUUID, now = () => new Date().toISOString() } = {}) {
    if (!nonEmptyString(path)) throw new TypeError('state path is required');
    if (typeof idFactory !== 'function' || typeof now !== 'function') {
      throw new TypeError('idFactory and now must be functions');
    }
    this.#path = path;
    this.#idFactory = idFactory;
    this.#now = now;
    // The navigation ring is a view over this store's state, shared with the
    // channels that inherit `ConversationStateStore`.
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

  sessionFor(key) {
    return this.#state.sessions[key] ?? null;
  }

  async setSession(key, sessionId) {
    const normalizedKey = nonEmptyString(key);
    const normalizedSession = nonEmptyString(sessionId);
    if (!normalizedKey || !normalizedSession) throw new TypeError('key and sessionId are required');
    this.#state.sessions[normalizedKey] = normalizedSession;
    await this.#persist();
  }

  async clearSession(key) {
    const normalizedKey = nonEmptyString(key);
    if (!normalizedKey || !(normalizedKey in this.#state.sessions)) return;
    delete this.#state.sessions[normalizedKey];
    await this.#persist();
  }

  async clearSessions() {
    this.#state.sessions = {};
    await this.#persist();
  }

  hasSeen(messageId) {
    const id = nonEmptyString(messageId);
    return Boolean(id && this.#state.seenMessageIds.includes(id));
  }

  async markSeen(messageId) {
    const id = nonEmptyString(messageId);
    if (!id) throw new TypeError('messageId is required');
    if (this.hasSeen(id)) return;
    this.#state.seenMessageIds.push(id);
    if (this.#state.seenMessageIds.length > 1_000) {
      this.#state.seenMessageIds.splice(0, this.#state.seenMessageIds.length - 1_000);
    }
    await this.#persist();
  }

  async rememberOutboundMessage({
    conversationKey,
    text,
    sentAt = Date.now(),
    completedAt = Date.now(),
    providerMessageIds: messageIds = [],
  } = {}) {
    const entry = normalizeRecentOutboundMessage({
      conversationKey,
      text,
      sentAt,
      completedAt,
      providerMessageIds: messageIds,
    });
    if (!entry) throw new TypeError('Invalid DingTalk outbound message');
    this.#state.recentOutboundMessages = recentOutboundMessages([
      ...this.#state.recentOutboundMessages,
      entry,
    ]);
    await this.#persist();
  }

  recentOutboundTextFor({
    conversationKey,
    processQueryKey,
    messageId,
    createdAt,
    now = Date.now(),
  } = {}) {
    const key = nonEmptyString(conversationKey);
    if (!key) return null;
    const active = recentOutboundMessages(this.#state.recentOutboundMessages, now)
      .filter((entry) => entry.conversationKey === key);
    const quotedIds = providerMessageIds([processQueryKey, messageId]);
    for (const quotedId of quotedIds) {
      const exact = active.filter((entry) => entry.providerMessageIds.includes(quotedId));
      if (exact.length === 1) return exact[0].text;
      if (exact.length > 1) return null;
    }
    const quotedAt = timestampMs(createdAt);
    if (quotedAt === null) return null;
    const candidates = active.filter((entry) => (
      quotedAt >= entry.sentAt - DINGTALK_RECENT_OUTBOUND_MATCH_TOLERANCE_MS
        && quotedAt <= entry.completedAt + DINGTALK_RECENT_OUTBOUND_MATCH_TOLERANCE_MS
    ));
    return candidates.length === 1 ? candidates[0].text : null;
  }

  pendingSenders() {
    return Object.values(this.#state.pendingSenders)
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
      .map((entry) => structuredClone(entry));
  }

  pendingSender(requestId) {
    const id = nonEmptyString(requestId);
    const entry = id ? this.#state.pendingSenders[id] : null;
    return entry ? structuredClone(entry) : null;
  }

  async recordPendingSender(staffIdOrEntry, name, seenAt) {
    const input = staffIdOrEntry && typeof staffIdOrEntry === 'object'
      ? staffIdOrEntry
      : { staffId: staffIdOrEntry, displayName: name, lastSeenAt: seenAt };
    const staffId = nonEmptyString(input.staffId);
    if (!staffId) throw new TypeError('staffId is required');
    const timestamp = nonEmptyString(input.lastSeenAt) ?? nonEmptyString(input.requestedAt) ?? this.#now();
    const existing = Object.values(this.#state.pendingSenders)
      .find((entry) => entry.staffId === staffId);
    const entry = {
      requestId: existing?.requestId ?? `ding_sender_${this.#idFactory()}`,
      staffId,
      displayName: displayName(input.displayName ?? input.nick ?? name),
      requestedAt: existing?.requestedAt ?? timestamp,
      lastSeenAt: timestamp,
    };
    this.#state.pendingSenders[entry.requestId] = entry;
    await this.#persist();
    return structuredClone(entry);
  }

  async removePendingSender(requestId) {
    const id = nonEmptyString(requestId);
    if (!id || !this.#state.pendingSenders[id]) return false;
    delete this.#state.pendingSenders[id];
    await this.#persist();
    return true;
  }

  async removePendingSenderByStaffId(staffId) {
    const id = nonEmptyString(staffId);
    const pending = id
      ? Object.values(this.#state.pendingSenders).find((entry) => entry.staffId === id)
      : null;
    return pending ? this.removePendingSender(pending.requestId) : false;
  }

  snapshot() {
    return structuredClone(this.#state);
  }

  async remove() {
    await this.#writeQueue;
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

export const DingTalkStateStore = DingtalkStateStore;
