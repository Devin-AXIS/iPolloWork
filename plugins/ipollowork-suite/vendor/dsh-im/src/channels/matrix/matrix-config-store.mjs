import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { isMatrixRoomId, isMatrixUserId, validateMatrixHomeserver } from './matrix-api.mjs';

const EMPTY_DOCUMENT = Object.freeze({ version: 1, bots: Object.freeze([]) });
const BOT_ID_PATTERN = /^matrix_[a-f0-9]{24}$/;
const TOKEN_REF_PATTERN = /^DSH_MATRIX_TOKEN_[A-F0-9]{24}$/;
const PASSWORD_REF_PATTERN = /^DSH_MATRIX_PASSWORD_[A-F0-9]{24}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._=-]{1,128}$/;
const E2EE_MODES = new Set(['off', 'optional', 'required']);
const AUTO_JOIN_MODES = new Set(['authorized', 'all']);
const MAX_MESSAGE_LENGTH_BOUNDS = Object.freeze({ min: 500, max: 65_535 });
const MAX_MEDIA_BYTES_CEILING = 104_857_600;
const ROOM_CONTEXT_LIMIT_BOUNDS = Object.freeze({ min: 1, max: 500 });
const ROOM_CONTEXT_CHARS_BOUNDS = Object.freeze({ min: 200, max: 200_000 });
const ROOM_CONTEXT_TZ_BOUNDS = Object.freeze({ min: -840, max: 840 });
const CONTEXT_CHARS_BOUNDS = Object.freeze({ min: 200, max: 200_000 });
const REPLY_DEPTH_BOUNDS = Object.freeze({ min: 1, max: 10 });
const AMBIENT_GAP_BOUNDS = Object.freeze({ min: 5_000, max: 3_600_000 });
const AMBIENT_WINDOW_BOUNDS = Object.freeze({ min: 10_000, max: 86_400_000 });
const AMBIENT_COUNT_BOUNDS = Object.freeze({ min: 1, max: 200 });
const VISIBLE_CONTEXT_WINDOW_BOUNDS = Object.freeze({ min: 0, max: 86_400_000 });
const VISIBLE_CONTEXT_LIMIT_BOUNDS = Object.freeze({ min: 0, max: 500 });
const VISIBLE_CONTEXT_CHARS_BOUNDS = Object.freeze({ min: 200, max: 200_000 });
const COALESCE_WINDOW_BOUNDS = Object.freeze({ min: 0, max: 60_000 });
const AUTO_STEER_LIMIT_BOUNDS = Object.freeze({ min: 0, max: 100 });
const THREADS_MODES = Object.freeze(['inherit', 'isolate', 'auto']);
const TRIGGER_ON_REPLY_MODES = Object.freeze(['any', 'bot-only', 'never']);

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function boundedInteger(value, { min, max }) {
  if (value === undefined || value === null) return undefined;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < min || numeric > max) return null;
  return numeric;
}

function roomIdList(value) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  const list = [];
  for (const entry of value) {
    const clean = cleanString(entry);
    if (!clean || !isMatrixRoomId(clean)) return null;
    if (!list.includes(clean)) list.push(clean);
  }
  return list;
}

function patternList(value) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  const list = [];
  for (const entry of value) {
    const clean = cleanString(entry);
    if (!clean || clean.length > 512) return null;
    try {
      new RegExp(clean);
    } catch {
      return null;
    }
    if (!list.includes(clean)) list.push(clean);
  }
  return list;
}

export function deriveMatrixBotIdentity({ homeserver, userId } = {}) {
  const base = validateMatrixHomeserver(homeserver);
  const identifier = cleanString(userId);
  if (!base || !isMatrixUserId(identifier ?? '')) {
    throw new TypeError('Matrix bot identity requires a valid homeserver and @user:server id');
  }
  const host = new URL(base).host.toLowerCase();
  const digest = createHash('sha256').update(`${host}|${identifier.toLowerCase()}`).digest('hex').slice(0, 24);
  const suffix = digest.toUpperCase();
  return {
    botId: `matrix_${digest}`,
    tokenRef: `DSH_MATRIX_TOKEN_${suffix}`,
    passwordRef: `DSH_MATRIX_PASSWORD_${suffix}`,
  };
}

export function maskMatrixBotId(platformId) {
  const value = cleanString(platformId) ?? '';
  const [host, userId] = value.split('|');
  if (host && userId) return `${host.slice(0, 6)}••• · ${userId.slice(0, 8)}•••`;
  return value ? `${value.slice(0, 6)}••••` : 'Matrix 机器人';
}

export class MatrixConfigStore {
  #path;
  #value = EMPTY_DOCUMENT;
  #writeQueue = Promise.resolve();

  constructor(path) {
    this.#path = path;
  }

  async load() {
    try {
      const normalized = this.#normalizeDocument(JSON.parse(await readFile(this.#path, 'utf8')));
      if (!normalized) throw new Error('dsh-im Matrix config contains invalid bot data');
      this.#value = normalized;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#value = EMPTY_DOCUMENT;
    }
    return this;
  }

  list() {
    return structuredClone(this.#value.bots);
  }

  get(botId) {
    const bot = this.#value.bots.find((candidate) => candidate.botId === botId);
    return bot ? structuredClone(bot) : null;
  }

  getByPlatformId(platformId) {
    const bot = this.#value.bots.find((candidate) => candidate.platformId === platformId);
    return bot ? structuredClone(bot) : null;
  }

  async save(value) {
    const normalized = this.#normalizeBot(value);
    if (!normalized) throw new Error('Refusing to persist incomplete Matrix bot data');
    return this.#mutate((bots) => {
      const collision = bots.find((bot) => (
        bot.botId !== normalized.botId
        && (bot.platformId === normalized.platformId
          || bot.tokenRef === normalized.tokenRef
          || bot.passwordRef === normalized.passwordRef)
      ));
      if (collision) throw new Error('Duplicate Matrix bot identity');
      const index = bots.findIndex((bot) => bot.botId === normalized.botId);
      if (index === -1) bots.push(normalized);
      else bots[index] = normalized;
      return structuredClone(normalized);
    });
  }

  async remove(botId) {
    if (!BOT_ID_PATTERN.test(botId)) throw new TypeError('Invalid Matrix bot id');
    return this.#mutate((bots) => {
      const index = bots.findIndex((bot) => bot.botId === botId);
      if (index === -1) return null;
      return structuredClone(bots.splice(index, 1)[0]);
    });
  }

  async clear() {
    const operation = this.#writeQueue.then(async () => {
      try {
        await unlink(this.#path);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      this.#value = EMPTY_DOCUMENT;
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    await operation;
  }

  #normalizeBot(value) {
    if (!value || typeof value !== 'object') return null;
    const botId = cleanString(value.botId);
    const platformId = cleanString(value.platformId);
    const homeserver = validateMatrixHomeserver(value.homeserver);
    const userId = cleanString(value.userId);
    const tokenRef = cleanString(value.tokenRef);
    const passwordRef = cleanString(value.passwordRef);
    const name = cleanString(value.name);
    const deviceId = cleanString(value.deviceId);
    if (!botId || !platformId || !homeserver || !isMatrixUserId(userId ?? '')
      || !tokenRef || !passwordRef || !name
      || !BOT_ID_PATTERN.test(botId)
      || !TOKEN_REF_PATTERN.test(tokenRef)
      || !PASSWORD_REF_PATTERN.test(passwordRef)
      || (deviceId !== null && !DEVICE_ID_PATTERN.test(deviceId))) return null;
    const derived = deriveMatrixBotIdentity({ homeserver, userId });
    if (derived.botId !== botId || derived.tokenRef !== tokenRef || derived.passwordRef !== passwordRef) {
      return null;
    }
    const e2eeMode = cleanString(value.e2eeMode) ?? 'optional';
    const autoJoinInvites = cleanString(value.autoJoinInvites) ?? 'authorized';
    const maxMessageLength = boundedInteger(value.maxMessageLength, MAX_MESSAGE_LENGTH_BOUNDS);
    const maxMediaBytes = boundedInteger(value.maxMediaBytes, { min: 1, max: MAX_MEDIA_BYTES_CEILING });
    const allowedRooms = roomIdList(value.allowedRooms);
    const freeResponseRooms = roomIdList(value.freeResponseRooms);
    const ignoreUserPatterns = patternList(value.ignoreUserPatterns);
    const roomContextLimit = boundedInteger(value.roomContextLimit, ROOM_CONTEXT_LIMIT_BOUNDS);
    const roomContextMaxChars = boundedInteger(value.roomContextMaxChars, ROOM_CONTEXT_CHARS_BOUNDS);
    const roomContextTzOffsetMinutes = boundedInteger(value.roomContextTzOffsetMinutes, ROOM_CONTEXT_TZ_BOUNDS);
    const threadsMode = cleanString(value.threadsMode) ?? 'inherit';
    const triggerOnReply = cleanString(value.triggerOnReply) ?? 'never';
    const contextMaxChars = boundedInteger(value.contextMaxChars, CONTEXT_CHARS_BOUNDS);
    const replyMaxDepth = boundedInteger(value.replyMaxDepth, REPLY_DEPTH_BOUNDS);
    const ambientBurstGapMs = boundedInteger(value.ambientBurstGapMs, AMBIENT_GAP_BOUNDS);
    const ambientRecentWindowMs = boundedInteger(value.ambientRecentWindowMs, AMBIENT_WINDOW_BOUNDS);
    const ambientRecentCount = boundedInteger(value.ambientRecentCount, AMBIENT_COUNT_BOUNDS);
    const visibleContextWindowMs = boundedInteger(value.visibleContextWindowMs, VISIBLE_CONTEXT_WINDOW_BOUNDS);
    const visibleContextLimit = boundedInteger(value.visibleContextLimit, VISIBLE_CONTEXT_LIMIT_BOUNDS);
    const visibleContextChars = boundedInteger(value.visibleContextChars, VISIBLE_CONTEXT_CHARS_BOUNDS);
    const coalesceWindowMs = boundedInteger(value.coalesceWindowMs, COALESCE_WINDOW_BOUNDS);
    const autoSteerLimit = boundedInteger(value.autoSteerLimit, AUTO_STEER_LIMIT_BOUNDS);
    if (!E2EE_MODES.has(e2eeMode) || !AUTO_JOIN_MODES.has(autoJoinInvites)
      || maxMessageLength === null || maxMediaBytes === null
      || allowedRooms === null || freeResponseRooms === null || ignoreUserPatterns === null
      || roomContextLimit === null || roomContextMaxChars === null
      || roomContextTzOffsetMinutes === null
      || !THREADS_MODES.includes(threadsMode) || !TRIGGER_ON_REPLY_MODES.includes(triggerOnReply)
      || contextMaxChars === null || replyMaxDepth === null
      || ambientBurstGapMs === null || ambientRecentWindowMs === null || ambientRecentCount === null
      || visibleContextWindowMs === null || visibleContextLimit === null || visibleContextChars === null
      || coalesceWindowMs === null || autoSteerLimit === null) return null;
    for (const key of ['requireMention', 'processNotices', 'allowRoomMentions', 'reactions', 'roomContextEnabled',
      'rootContextOnceEnabled', 'replyContextEnabled', 'ambientContextEnabled',
      'visibleContextEnabled', 'autoSteerSameSender']) {
      if (value?.[key] !== undefined && typeof value[key] !== 'boolean') return null;
    }
    return Object.freeze({
      botId,
      platformId,
      homeserver,
      userId,
      ...(deviceId ? { deviceId } : {}),
      tokenRef,
      passwordRef,
      name,
      username: cleanString(value.username),
      createdAt: cleanString(value.createdAt) ?? new Date().toISOString(),
      connectedAt: cleanString(value.connectedAt),
      ...(e2eeMode !== 'optional' ? { e2eeMode } : {}),
      ...(autoJoinInvites !== 'authorized' ? { autoJoinInvites } : {}),
      ...(typeof value.requireMention === 'boolean' ? { requireMention: value.requireMention } : {}),
      ...(typeof value.processNotices === 'boolean' ? { processNotices: value.processNotices } : {}),
      ...(typeof value.allowRoomMentions === 'boolean' ? { allowRoomMentions: value.allowRoomMentions } : {}),
      ...(typeof value.reactions === 'boolean' ? { reactions: value.reactions } : {}),
      ...(maxMessageLength !== undefined ? { maxMessageLength } : {}),
      ...(maxMediaBytes !== undefined ? { maxMediaBytes } : {}),
      ...(allowedRooms !== undefined ? { allowedRooms: Object.freeze(allowedRooms) } : {}),
      ...(freeResponseRooms !== undefined ? { freeResponseRooms: Object.freeze(freeResponseRooms) } : {}),
      ...(ignoreUserPatterns !== undefined ? { ignoreUserPatterns: Object.freeze(ignoreUserPatterns) } : {}),
      ...(typeof value.roomContextEnabled === 'boolean' ? { roomContextEnabled: value.roomContextEnabled } : {}),
      ...(roomContextLimit !== undefined ? { roomContextLimit } : {}),
      ...(roomContextMaxChars !== undefined ? { roomContextMaxChars } : {}),
      ...(roomContextTzOffsetMinutes !== undefined ? { roomContextTzOffsetMinutes } : {}),
      ...(threadsMode !== 'inherit' ? { threadsMode } : {}),
      ...(triggerOnReply !== 'never' ? { triggerOnReply } : {}),
      ...(typeof value.rootContextOnceEnabled === 'boolean' ? { rootContextOnceEnabled: value.rootContextOnceEnabled } : {}),
      ...(typeof value.replyContextEnabled === 'boolean' ? { replyContextEnabled: value.replyContextEnabled } : {}),
      ...(typeof value.ambientContextEnabled === 'boolean' ? { ambientContextEnabled: value.ambientContextEnabled } : {}),
      ...(contextMaxChars !== undefined ? { contextMaxChars } : {}),
      ...(replyMaxDepth !== undefined ? { replyMaxDepth } : {}),
      ...(ambientBurstGapMs !== undefined ? { ambientBurstGapMs } : {}),
      ...(ambientRecentWindowMs !== undefined ? { ambientRecentWindowMs } : {}),
      ...(ambientRecentCount !== undefined ? { ambientRecentCount } : {}),
      ...(typeof value.visibleContextEnabled === 'boolean' ? { visibleContextEnabled: value.visibleContextEnabled } : {}),
      ...(visibleContextWindowMs !== undefined ? { visibleContextWindowMs } : {}),
      ...(visibleContextLimit !== undefined ? { visibleContextLimit } : {}),
      ...(visibleContextChars !== undefined ? { visibleContextChars } : {}),
      ...(coalesceWindowMs !== undefined ? { coalesceWindowMs } : {}),
      ...(typeof value.autoSteerSameSender === 'boolean' ? { autoSteerSameSender: value.autoSteerSameSender } : {}),
      ...(autoSteerLimit !== undefined ? { autoSteerLimit } : {}),
    });
  }

  #normalizeDocument(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.bots)) return null;
    const bots = value.bots.map((bot) => this.#normalizeBot(bot));
    if (bots.some((bot) => bot === null)) return null;
    const ids = new Set();
    const platformIds = new Set();
    const refs = new Set();
    for (const bot of bots) {
      if (ids.has(bot.botId) || platformIds.has(bot.platformId)
        || refs.has(bot.tokenRef) || refs.has(bot.passwordRef)) return null;
      ids.add(bot.botId);
      platformIds.add(bot.platformId);
      refs.add(bot.tokenRef);
      refs.add(bot.passwordRef);
    }
    return Object.freeze({ version: 1, bots: Object.freeze(bots) });
  }

  async #mutate(mutator) {
    let result;
    const operation = this.#writeQueue.then(async () => {
      const bots = [...this.#value.bots];
      result = mutator(bots);
      const document = Object.freeze({ version: 1, bots: Object.freeze(bots) });
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: 'utf8', mode: 0o600,
      });
      await rename(temporary, this.#path);
      this.#value = document;
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    await operation;
    return result;
  }
}

/**
 * Matrix-only durable side data kept next to the shared conversation state
 * file: the sync token, joined rooms, DM rooms and permanently declined dead
 * invites. Sessions, seen-message rings and deferred delivery stay in the
 * shared `ConversationStateStore`.
 */
export class MatrixSidecarStore {
  #path;
  #value = { nextBatch: null, joinedRooms: [], dmRooms: [], declinedRooms: [], dmRoomByUser: {} };
  #writeQueue = Promise.resolve();

  constructor(path) {
    this.#path = path;
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.#path, 'utf8'));
      this.#value = {
        nextBatch: typeof parsed?.nextBatch === 'string' && parsed.nextBatch ? parsed.nextBatch : null,
        joinedRooms: stringList(parsed?.joinedRooms),
        dmRooms: stringList(parsed?.dmRooms),
        declinedRooms: stringList(parsed?.declinedRooms),
        dmRoomByUser: stringMap(parsed?.dmRoomByUser),
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return this;
  }

  nextBatch() {
    return this.#value.nextBatch;
  }

  joinedRooms() {
    return [...this.#value.joinedRooms];
  }

  dmRooms() {
    return [...this.#value.dmRooms];
  }

  dmRoomByUser() {
    return { ...this.#value.dmRoomByUser };
  }

  declinedRooms() {
    return [...this.#value.declinedRooms];
  }

  isDeclined(roomId) {
    return this.#value.declinedRooms.includes(roomId);
  }

  async apply(patch) {
    const next = {
      nextBatch: patch.nextBatch === undefined ? this.#value.nextBatch
        : (typeof patch.nextBatch === 'string' && patch.nextBatch ? patch.nextBatch : null),
      joinedRooms: patch.joinedRooms === undefined
        ? this.#value.joinedRooms : stringList(patch.joinedRooms),
      dmRooms: patch.dmRooms === undefined ? this.#value.dmRooms : stringList(patch.dmRooms),
      declinedRooms: patch.declinedRooms === undefined
        ? this.#value.declinedRooms : stringList(patch.declinedRooms),
      dmRoomByUser: patch.dmRoomByUser === undefined
        ? this.#value.dmRoomByUser : stringMap(patch.dmRoomByUser),
    };
    const operation = this.#writeQueue.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
        encoding: 'utf8', mode: 0o600,
      });
      await rename(temporary, this.#path);
      this.#value = next;
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    await operation;
  }

  async remove() {
    const operation = this.#writeQueue.then(async () => {
      try {
        await unlink(this.#path);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    await operation;
  }
}

function stringList(value) {
  return Array.isArray(value)
    ? Object.freeze([...new Set(value.filter((entry) => typeof entry === 'string' && entry.trim()))])
    : [];
}

function stringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({});
  const entries = Object.entries(value)
    .filter(([key, target]) => typeof key === 'string' && key && typeof target === 'string' && target);
  return Object.freeze(Object.fromEntries(entries));
}
