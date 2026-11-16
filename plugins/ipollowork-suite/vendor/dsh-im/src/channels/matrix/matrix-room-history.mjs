// Shared, per-room conversation record for the Matrix channel.
//
// A Matrix room is one shared context: every participant's messages belong to
// the same record, regardless of who is addressed. The channel bot replies only
// when it is mentioned, but it conditions on the whole room. This store keeps a
// bounded, durable timeline of human and bot messages per room so that:
//   - unmentioned chatter is not lost -- it is recorded and later injected as
//     context the next time the bot is addressed, and
//   - older messages remain searchable across days so a session can pull prior
//     room history on demand.
//
// The store owns only the record and its queries; the runtime decides what is
// recorded and when pending context is consumed, so the trigger boundary stays
// in the inbound pipeline.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { buildConversationRoute, encodeConversationRouteKey } from '../shared/conversation/route.mjs';

export const DEFAULT_ROOM_HISTORY_LIMIT = 2_000;
export const MIN_ROOM_HISTORY_LIMIT = 20;
export const MAX_ROOM_HISTORY_LIMIT = 50_000;
export const MIN_ROOM_CONTEXT_LIMIT = 1;
export const MAX_ROOM_CONTEXT_LIMIT = 500;
export const MIN_ROOM_CONTEXT_CHARS = 200;
export const MAX_ROOM_CONTEXT_CHARS = 200_000;
const ENTRY_TEXT_CHARS = 4_000;
const INJECTED_EVENT_MAX = 1_000;
const CONTEXT_LEDGER_ROUTE_MAX = 400;
const CONTEXT_LEDGER_ENTRY_MAX = 1_000;

export function matrixRoomHistoryPathFor(botDir) {
  return `${botDir}/matrix-history.json`;
}

function boundedInteger(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.trunc(value);
  if (!Number.isSafeInteger(rounded)) return fallback;
  return Math.min(Math.max(rounded, min), max);
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function localPart(matrixId) {
  if (typeof matrixId !== 'string') return '';
  const at = matrixId.indexOf(':');
  const local = at >= 0 ? matrixId.slice(1, at) : matrixId.replace(/^@/, '');
  return local.trim();
}

// Start of the civil day that `nowMs` falls in, at the configured UTC offset.
// Returned as an absolute epoch-ms threshold so an entry's own origin_serverTs
// (ms) can be compared against it directly.
export function roomContextDayStartTs(nowMs, tzOffsetMinutes) {
  const now = Number.isSafeInteger(nowMs) ? nowMs : Date.now();
  const offset = Number.isSafeInteger(tzOffsetMinutes) ? tzOffsetMinutes : 0;
  const shifted = now + offset * 60_000;
  const dayStartShifted = Math.floor(shifted / 86_400_000) * 86_400_000;
  return dayStartShifted - offset * 60_000;
}

function toTimestamp(value) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value);
  return Date.now();
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const eventId = cleanText(raw.eventId, 255);
  const text = cleanText(raw.text, ENTRY_TEXT_CHARS);
  if (!eventId) return null;
  // Bot entries may arrive content-free: a pending-placeholder receipt keeps
  // the authorship record until the first edit frame revises it to the body.
  if (!text && raw.fromBot !== true && raw.kind !== 'bot') return null;
  const kind = raw.kind === 'bot' || raw.fromBot === true ? 'bot'
    : raw.kind === 'command' ? 'command' : 'human';
  return {
    eventId,
    sender: cleanText(raw.sender, 512),
    name: cleanText(raw.name, 256) || localPart(raw.sender),
    text,
    ts: toTimestamp(raw.ts),
    threadId: cleanText(raw.threadId, 255) || null,
    kind,
    injected: raw.injected === true || kind !== 'human',
    // Provenance of a bubble one Session produced: the conversation key it was
    // delivered under plus the session generation that stamped it. The runtime's
    // room window retires such a bubble for that conversation while the stamped
    // generation is current; other conversations and a fresh session still read it.
    turnKey: cleanText(raw.turnKey, 512) || null,
    turnEpoch: Number.isSafeInteger(raw.turnEpoch) && raw.turnEpoch >= 0 ? raw.turnEpoch : null,
  };
}

// A recorded bot bubble missing its provenance stamp was delivered before that stamp
// existed; its own room and thread name the route it was delivered under. Repair the
// stamp at load so the runtime's self-answer guard retires the bubble from that
// conversation's windows again after a restart. The healed generation is the first one
// (0): a conversation that cleared its session still reads the bubble back once.
function healBotProvenance(entries, roomId) {
  for (const entry of entries) {
    if (entry.kind !== 'bot' || entry.turnKey !== null || !entry.text) continue;
    entry.turnKey = encodeConversationRouteKey(buildConversationRoute({
      channel: 'matrix', chatId: roomId, threadId: entry.threadId, kind: 'group',
    }));
    entry.turnEpoch = 0;
  }
}

/**
 * Durable, bounded, per-room message record. Entries are kept in arrival order
 * (the runtime feeds the sync timeline, which is chronological per room). Each
 * room is trimmed to `limit` most-recent entries and injected-event markers are
 * pruned against the live entries so growth stays bounded. A durable per-conversation
 * collection ledger (`ledgers`) records which events each conversation has already been
 * offered as context, together with the session generation that retired them, so the
 * read-once retirement survives a restart. Writes are serialized
 * through an in-memory queue with an atomic temp-file rename, mirroring the
 * Matrix sidecar.
 */
export class MatrixRoomHistoryStore {
  #path;
  #limit;
  #value = { rooms: Object.create(null), ledgers: Object.create(null) };
  #writeQueue = Promise.resolve();

  constructor(path, { limit = DEFAULT_ROOM_HISTORY_LIMIT } = {}) {
    if (!path) throw new TypeError('Matrix room history requires a file path');
    this.#path = path;
    this.#limit = boundedInteger(limit, MIN_ROOM_HISTORY_LIMIT, MAX_ROOM_HISTORY_LIMIT, DEFAULT_ROOM_HISTORY_LIMIT);
  }

  get limit() {
    return this.#limit;
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.#path, 'utf8'));
      const rooms = Object.create(null);
      if (parsed && typeof parsed === 'object' && parsed.rooms && typeof parsed.rooms === 'object') {
        for (const [roomId, room] of Object.entries(parsed.rooms)) {
          if (!roomId || !room || typeof room !== 'object') continue;
          const entries = Array.isArray(room.entries)
            ? room.entries.map(normalizeEntry).filter(Boolean)
            : [];
          const injected = new Set((Array.isArray(room.injected) ? room.injected : [])
            .filter((id) => typeof id === 'string' && id));
          rooms[roomId] = { entries, injected };
          healBotProvenance(entries, roomId);
        }
      }
      const ledgers = Object.create(null);
      if (parsed && typeof parsed === 'object' && parsed.ledgers && typeof parsed.ledgers === 'object') {
        for (const [conversationKey, ledger] of Object.entries(parsed.ledgers)) {
          if (!conversationKey || !ledger || typeof ledger !== 'object') continue;
          const epoch = Number.isSafeInteger(ledger.epoch) && ledger.epoch >= 0 ? ledger.epoch : 0;
          const seen = new Set();
          const injected = [];
          for (const eventId of Array.isArray(ledger.injected) ? ledger.injected : []) {
            if (typeof eventId !== 'string' || !eventId || seen.has(eventId)) continue;
            seen.add(eventId);
            injected.push(eventId);
          }
          ledgers[conversationKey] = { epoch, injected: injected.slice(-CONTEXT_LEDGER_ENTRY_MAX) };
        }
        const keys = Object.keys(ledgers);
        for (let index = 0; index < keys.length - CONTEXT_LEDGER_ROUTE_MAX; index += 1) delete ledgers[keys[index]];
      }
      this.#value = { rooms, ledgers };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return this;
  }

  #roomEntry(roomId) {
    let room = this.#value.rooms[roomId];
    if (!room) {
      room = { entries: [], injected: new Set() };
      this.#value.rooms[roomId] = room;
    }
    return room;
  }

  #ledgerEntry(conversationKey) {
    let ledger = this.#value.ledgers[conversationKey];
    if (ledger) return ledger;
    ledger = { epoch: 0, injected: [] };
    this.#value.ledgers[conversationKey] = ledger;
    const keys = Object.keys(this.#value.ledgers);
    for (let index = 0; index < keys.length - CONTEXT_LEDGER_ROUTE_MAX; index += 1) {
      const oldest = keys[index];
      if (oldest === conversationKey && keys.length === 1) break;
      delete this.#value.ledgers[oldest];
    }
    return ledger;
  }

  #persist() {
    const rooms = Object.create(null);
    for (const [roomId, room] of Object.entries(this.#value.rooms)) {
      if (room.entries.length === 0) continue;
      rooms[roomId] = {
        entries: room.entries,
        injected: [...room.injected].slice(-INJECTED_EVENT_MAX),
      };
    }
    const ledgers = Object.create(null);
    for (const [conversationKey, ledger] of Object.entries(this.#value.ledgers)) {
      if (ledger.epoch === 0 && ledger.injected.length === 0) continue;
      ledgers[conversationKey] = { epoch: ledger.epoch, injected: ledger.injected.slice(-CONTEXT_LEDGER_ENTRY_MAX) };
    }
    const snapshot = JSON.stringify({ rooms, ledgers }, null, 2);
    const operation = this.#writeQueue.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.tmp`;
      await writeFile(temporary, `${snapshot}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.#path);
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    void operation.catch(() => undefined);
  }

  /**
   * Record one room message. The caller decides the kind ('human', 'command'
   * or 'bot'); non-human and explicitly injected entries are marked as already
   * consumed so they never surface as pending context. Duplicate event ids are
   * ignored to keep a replayed sync from double-counting an entry. A turn-bound
   * send passes `turnKey`/`turnEpoch` — the conversation its Session produced
   * the bubble for and the session generation that delivered it.
   */
  append({ roomId, eventId, sender, name, text, ts, threadId, kind = 'human', injected, turnKey = null, turnEpoch = null } = {}) {
    if (!roomId || typeof eventId !== 'string' || !eventId.trim()) return null;
    const entry = normalizeEntry({ eventId, sender, name, text, ts, threadId, kind, injected, turnKey, turnEpoch });
    if (!entry) return null;
    const room = this.#roomEntry(roomId);
    if (room.entries.some((existing) => existing.eventId === entry.eventId)) return null;
    room.entries.push(entry);
    if (entry.injected) room.injected.add(entry.eventId);
    if (room.entries.length > this.#limit) {
      const dropped = room.entries.splice(0, room.entries.length - this.#limit);
      for (const removed of dropped) room.injected.delete(removed.eventId);
    }
    this.#persist();
    return entry;
  }

  /**
   * Bring one recorded entry to its latest edit frame — the shape a streamed bot
   * answer takes while the client edits the placeholder event toward the final
   * body. Revising an entry that is not stored yet records it, so the last frame
   * always owns the entry regardless of which frame reaches here first.
   */
  revise({ roomId, eventId, sender, name, text, ts, threadId, kind = 'bot', turnKey = null, turnEpoch = null } = {}) {
    if (!roomId || typeof eventId !== 'string' || !eventId.trim()) return false;
    const room = this.#roomEntry(roomId);
    const existing = room.entries.find((entry) => entry.eventId === eventId);
    if (existing) {
      const nextText = cleanText(text, ENTRY_TEXT_CHARS);
      if (nextText) existing.text = nextText;
      const nextTs = Number.isSafeInteger(ts) && ts > 0 ? ts : null;
      if (nextTs !== null && nextTs >= existing.ts) existing.ts = nextTs;
      const nextName = cleanText(name, 256);
      if (nextName) existing.name = nextName;
      if (existing.threadId === null) existing.threadId = cleanText(threadId, 255) || null;
      // An echo-ingested receipt may have created the entry before the send face
      // knew its turn; the first frame that carries provenance owns the backfill.
      if (existing.turnKey === null && typeof turnKey === 'string' && turnKey) existing.turnKey = turnKey;
      if (existing.turnEpoch === null && Number.isSafeInteger(turnEpoch) && turnEpoch >= 0) existing.turnEpoch = turnEpoch;
      this.#persist();
      return true;
    }
    return this.append({ roomId, eventId, sender, name, text, ts, threadId, kind, turnKey, turnEpoch }) !== null;
  }

  /**
   * Ambient human chatter that has not been injected yet, from the same civil
   * day (entries at or after `sinceTs`), in chronological order. Pure -- does not
   * mark anything -- so the runtime can inspect what would be injected.
   */
  pending({ roomId, sinceTs = 0, limit = MAX_ROOM_CONTEXT_LIMIT } = {}) {
    const room = this.#value.rooms[roomId];
    if (!room) return [];
    const cap = boundedInteger(limit, MIN_ROOM_CONTEXT_LIMIT, MAX_ROOM_CONTEXT_LIMIT, MAX_ROOM_CONTEXT_LIMIT);
    return room.entries
      .filter((entry) => entry.kind === 'human' && !room.injected.has(entry.eventId) && entry.ts > sinceTs)
      .slice(-cap);
  }

  /**
   * Select the pending same-day chatter to inject now and mark those entries as
   * consumed, bounded by both a count and a character budget (the most recent
   * entries are preferred so the freshest context wins when the budget binds).
   */
  consumePending({ roomId, sinceTs = 0, limit, maxChars, now = Date.now() } = {}) {
    const room = this.#value.rooms[roomId];
    if (!room) return [];
    const cap = boundedInteger(limit, MIN_ROOM_CONTEXT_LIMIT, MAX_ROOM_CONTEXT_LIMIT, 50);
    const charCap = boundedInteger(maxChars, MIN_ROOM_CONTEXT_CHARS, MAX_ROOM_CONTEXT_CHARS, 8_000);
    const dayStart = roomContextDayStartTs(now, 0);
    const floor = Math.max(Number.isSafeInteger(sinceTs) ? sinceTs : 0, dayStart);
    const candidates = room.entries
      .filter((entry) => entry.kind === 'human' && !room.injected.has(entry.eventId) && entry.ts > floor);
    const selected = [];
    let used = 0;
    for (let index = candidates.length - 1; index >= 0 && selected.length < cap; index -= 1) {
      const entry = candidates[index];
      const cost = entry.text.length + (entry.name ? entry.name.length + 2 : 1);
      if (selected.length > 0 && used + cost > charCap) break;
      selected.unshift(entry);
      used += cost;
    }
    for (const entry of selected) room.injected.add(entry.eventId);
    if (selected.length > 0) this.#persist();
    return selected;
  }

  /**
   * The recorded kind of one event ('bot', 'human' or 'command'), or null when
   * the event is not stored. Lets callers reason about authorship without
   * trusting an id the room record has never seen.
   */
  kindOf({ roomId, eventId } = {}) {
    const room = this.#value.rooms[roomId];
    const entry = room?.entries.find((candidate) => candidate.eventId === eventId);
    return entry ? entry.kind : null;
  }

  /**
   * Search the recorded room history across the retained window. Substring match
   * against text and speaker display name (case-insensitive), with optional
   * inclusive time bounds and a recency-first limit. Used to surface older room
   * history a session can pull in after the current-day auto-context has expired.
   */
  search({ roomId, query = '', sender = null, from = null, to = null, limit = 20 } = {}) {
    const room = this.#value.rooms[roomId];
    if (!room) return [];
    const needle = cleanText(query, 512).toLowerCase();
    const wantSender = cleanText(sender, 512).toLowerCase();
    const cap = boundedInteger(limit, 1, MAX_ROOM_CONTEXT_LIMIT, 20);
    const matches = [];
    for (let index = room.entries.length - 1; index >= 0 && matches.length < cap; index -= 1) {
      const entry = room.entries[index];
      if (Number.isSafeInteger(from) && from > 0 && entry.ts < from) continue;
      if (Number.isSafeInteger(to) && to > 0 && entry.ts > to) continue;
      if (wantSender
        && entry.sender.toLowerCase() !== wantSender
        && localPart(entry.sender).toLowerCase() !== wantSender
        && entry.name.toLowerCase() !== wantSender) continue;
      if (needle) {
        const haystack = `${entry.text}\n${entry.name}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
      }
      matches.push(entry);
    }
    return matches;
  }

  /**
   * Recent room-visible entries for a context window: every kind, whether or
   * not already consumed, newest-bounded by a count, a character budget, and a
   * freshness floor, with caller-named events skipped. The window stays inside
   * one message list — the room's mainline (`threadId: null`) or one thread —
   * so messages members cannot read in the current conversation stay out. A
   * thread window also holds that thread's root bubble: the panel heads with the
   * root message itself and an answer sent as the reply that opened a thread is
   * stored on the mainline where it was sent — the root leads the window and is
   * exempt from the freshness floor, being the panel's permanent head rather
   * than a recent post. Pure read — consumption bookkeeping stays with the
   * caller's per-conversation ledger.
   */
  recent({ roomId, threadId = null, exclude = null, limit = 8, maxChars = 4_000, sinceTs = 0 } = {}) {
    const room = this.#value.rooms[roomId];
    if (!room) return [];
    const cap = boundedInteger(limit, MIN_ROOM_CONTEXT_LIMIT, MAX_ROOM_CONTEXT_LIMIT, 8);
    const charCap = boundedInteger(maxChars, MIN_ROOM_CONTEXT_CHARS, MAX_ROOM_CONTEXT_CHARS, 4_000);
    const floor = Number.isSafeInteger(sinceTs) ? sinceTs : 0;
    const wantedThread = cleanText(threadId, 255) || null;
    const skip = exclude instanceof Set ? exclude : new Set(Array.isArray(exclude) ? exclude : []);
    const selected = [];
    let used = 0;
    const rootEntry = wantedThread === null ? null
      : room.entries.find((entry) => entry.eventId === wantedThread && entry.text && !skip.has(entry.eventId)) ?? null;
    if (rootEntry) {
      used += rootEntry.text.length + (rootEntry.name ? rootEntry.name.length + 2 : 1);
    }
    for (let index = room.entries.length - 1; index >= 0 && selected.length < (rootEntry ? cap - 1 : cap); index -= 1) {
      const entry = room.entries[index];
      if (rootEntry !== null && entry.eventId === rootEntry.eventId) continue;
      if ((entry.threadId ?? null) !== wantedThread) continue;
      if (!entry.text) continue;
      if (entry.ts <= floor || skip.has(entry.eventId)) continue;
      const cost = entry.text.length + (entry.name ? entry.name.length + 2 : 1);
      if (used + cost > charCap && selected.length > 0) break;
      selected.unshift(entry);
      used += cost;
    }
    return rootEntry === null ? selected : [rootEntry, ...selected];
  }

  /**
   * Mark recorded entries as already offered to a conversation so no later
   * query re-offers them (the ambient provider's consumption step). Only ids of
   * live entries count; the count of newly marked ids is returned so callers
   * can log how much context one turn actually consumed.
   */
  markInjected(roomId, eventIds) {
    const room = this.#value.rooms[roomId];
    if (!room || !Array.isArray(eventIds)) return 0;
    const live = new Set(room.entries.map((entry) => entry.eventId));
    let marked = 0;
    for (const eventId of eventIds) {
      if (typeof eventId !== 'string' || room.injected.has(eventId) || !live.has(eventId)) continue;
      room.injected.add(eventId);
      marked += 1;
    }
    if (marked > 0) this.#persist();
    return marked;
  }

  /**
   * Durable counterpart of the runtime's per-conversation injection ledger: within one
   * conversation an event enters the model as collected context at most once, and that
   * once must outlive the process. The session generation rides the same record, so an
   * answer retired under a live generation is not read back merely because the process
   * restarted; only a cleared session lifts the retirement.
   */
  contextEpoch({ conversationKey } = {}) {
    if (typeof conversationKey !== 'string' || !conversationKey) return 0;
    return this.#value.ledgers[conversationKey]?.epoch ?? 0;
  }

  /** Advance one conversation's durable generation (its session was cleared); returns the new value. */
  bumpContextEpoch({ conversationKey } = {}) {
    if (typeof conversationKey !== 'string' || !conversationKey) return 0;
    const ledger = this.#ledgerEntry(conversationKey);
    ledger.epoch += 1;
    this.#persist();
    return ledger.epoch;
  }

  /** Whether one event was already injected into one conversation's collected context. */
  contextInjected({ conversationKey, eventId } = {}) {
    if (typeof conversationKey !== 'string' || !conversationKey || typeof eventId !== 'string' || !eventId) return false;
    const ledger = this.#value.ledgers[conversationKey];
    return ledger ? ledger.injected.includes(eventId) : false;
  }

  /** Record events as injected into one conversation; the most recent entries are kept when the bound binds. */
  markContextInjected({ conversationKey, eventIds } = {}) {
    if (typeof conversationKey !== 'string' || !conversationKey || !Array.isArray(eventIds)) return false;
    const ledger = this.#ledgerEntry(conversationKey);
    const seen = new Set(ledger.injected);
    let marked = 0;
    for (const eventId of eventIds) {
      if (typeof eventId !== 'string' || !eventId || seen.has(eventId)) continue;
      seen.add(eventId);
      ledger.injected.push(eventId);
      marked += 1;
    }
    if (marked === 0) return false;
    if (ledger.injected.length > CONTEXT_LEDGER_ENTRY_MAX) {
      ledger.injected.splice(0, ledger.injected.length - CONTEXT_LEDGER_ENTRY_MAX);
    }
    // Recency follows the last offer, so the route cap evicts the stalest conversation.
    delete this.#value.ledgers[conversationKey];
    this.#value.ledgers[conversationKey] = ledger;
    this.#persist();
    return true;
  }

  /** Release one conversation's injected records: its cleared successor session reads each bubble back once. */
  clearContextInjected({ conversationKey } = {}) {
    if (typeof conversationKey !== 'string' || !conversationKey) return false;
    const ledger = this.#value.ledgers[conversationKey];
    if (!ledger || ledger.injected.length === 0) return false;
    ledger.injected = [];
    this.#persist();
    return true;
  }

  /** Drop a room record entirely (used when a room is removed/reset). */
  clear(roomId) {
    if (!this.#value.rooms[roomId]) return false;
    delete this.#value.rooms[roomId];
    this.#persist();
    return true;
  }

  /** Await the serialized write queue so all queued changes reach disk. */
  async flush() {
    await this.#writeQueue;
  }

  async remove() {
    const operation = this.#writeQueue.then(async () => {
      const { unlink } = await import('node:fs/promises');
      await unlink(this.#path).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    await operation;
  }
}

/**
 * Format pending entries as a context block prepended to the prompt. Entries are
 * attributed by display name so the model can tell participants apart; the block
 * states it is room chatter the bot was not directly addressed in.
 */
// Each line carries a clock stamp and a bracketed speaker, and the whole run sits between a labelled
// opening and a closing fence: a bare list of speaker-colon-text lines reads to the model as questions
// that are waiting to be answered one by one.
function roomContextStamp(ts, offsetMinutes) {
  const stamp = Number.isSafeInteger(ts) ? ts : 0;
  const offset = Number.isSafeInteger(offsetMinutes) ? offsetMinutes : 0;
  const shifted = new Date(stamp + offset * 60_000);
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `[${hours}:${minutes}]`;
}

export function formatRoomContextBlock(entries, {
  header = '', instruction = '', begin = '', end = '', tzOffsetMinutes = 0,
} = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const lines = entries.map((entry) => {
    const speaker = entry.name || entry.sender || '?';
    return `${roomContextStamp(entry.ts, tzOffsetMinutes)} [${speaker}] ${entry.text}`;
  });
  const parts = [];
  if (header) parts.push(header);
  if (instruction) parts.push(instruction);
  if (begin) parts.push(begin);
  parts.push(...lines);
  if (end) parts.push(end);
  return parts.join('\n');
}
