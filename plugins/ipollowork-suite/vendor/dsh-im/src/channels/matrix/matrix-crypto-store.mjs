// Persistent device-local crypto state for the Matrix channel. Pickles are opaque
// libolm blobs; the pickling passphrase lives beside them so a stolen file is the
// same trust boundary as the on-disk access token (documented limitation, see
// docs/方案/Matrix端到端加密可行性调研.md §4). All writes are serialized through one
// queue and land atomically with restrictive permissions.
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const CRYPTO_FILE = 'matrix-crypto.json';
const MAX_SESSIONS = 1_000;
const MAX_INBOUND_GROUP_SESSIONS = 1_000;
const MAX_PENDING_ROOM_KEYS = 200;
const MAX_REQUEST_STATE = 200;

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function pickledEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const pickle = cleanText(value.pickle);
  if (!pickle) return null;
  const createdAt = Number(value.createdAt);
  const lastUsedAt = Number(value.lastUsedAt);
  return {
    pickle,
    createdAt: Number.isSafeInteger(createdAt) && createdAt > 0 ? createdAt : 0,
    lastUsedAt: Number.isSafeInteger(lastUsedAt) && lastUsedAt > 0 ? lastUsedAt : 0,
  };
}

function sessionEntries(value, requiredFields) {
  if (!Array.isArray(value)) return [];
  const entries = [];
  for (const candidate of value) {
    const base = pickledEntry(candidate);
    if (!base) continue;
    let ok = true;
    for (const field of requiredFields) {
      if (!cleanText(candidate?.[field])) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const entry = { ...base };
    for (const field of requiredFields) entry[field] = cleanText(candidate[field]);
    entries.push(Object.freeze(entry));
  }
  return Object.freeze(entries);
}

function outboundGroups(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [roomId, candidate] of Object.entries(value)) {
    const base = pickledEntry(candidate);
    const sessionId = cleanText(candidate?.sessionId);
    if (!base || !sessionId || !cleanText(candidate?.sharedOwnerKey)) continue;
    result[roomId] = Object.freeze({
      ...base,
      sessionId,
      sharedOwnerKey: cleanText(candidate.sharedOwnerKey),
      messageIndex: Number.isSafeInteger(Number(candidate.messageIndex)) && Number(candidate.messageIndex) >= 0
        ? Number(candidate.messageIndex) : 0,
      sharedWith: Object.freeze(Array.isArray(candidate.sharedWith)
        ? [...new Set(candidate.sharedWith.filter((entry) => typeof entry === 'string' && entry.trim()))]
        : []),
    });
  }
  return result;
}

function requestState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  let kept = 0;
  for (const [key, candidate] of Object.entries(value)) {
    if (kept >= MAX_REQUEST_STATE) break;
    const at = Number(candidate?.at);
    if (!cleanText(key) || !Number.isSafeInteger(at) || at <= 0) continue;
    result[key] = Object.freeze({
      at,
      tries: Number.isSafeInteger(Number(candidate.tries)) && Number(candidate.tries) > 0
        ? Number(candidate.tries) : 1,
    });
    kept += 1;
  }
  return result;
}

function pendingRoomKeys(value) {
  if (!Array.isArray(value)) return [];
  const entries = [];
  for (const candidate of value) {
    const roomId = cleanText(candidate?.roomId);
    const sessionId = cleanText(candidate?.sessionId);
    const senderKey = cleanText(candidate?.senderKey);
    const exportedSessionKey = cleanText(candidate?.exportedSessionKey);
    if (!roomId || !sessionId || !senderKey || !exportedSessionKey) continue;
    const createdAt = Number(candidate.createdAt);
    entries.push(Object.freeze({
      roomId,
      sessionId,
      senderKey,
      exportedSessionKey,
      createdAt: Number.isSafeInteger(createdAt) && createdAt > 0 ? createdAt : 0,
      tries: Number.isSafeInteger(Number(candidate.tries)) && Number(candidate.tries) > 0
        ? Number(candidate.tries) : 0,
    }));
    if (entries.length >= MAX_PENDING_ROOM_KEYS) break;
  }
  return Object.freeze(entries);
}

function deviceKeySnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const signaturePayload = cleanText(value.signaturePayload);
  if (!signaturePayload) return null;
  const uploadedAt = Number(value.uploadedAt);
  const oneTimeKeyCount = Number(value.oneTimeKeyCount);
  return Object.freeze({
    signaturePayload,
    uploadedAt: Number.isSafeInteger(uploadedAt) && uploadedAt > 0 ? uploadedAt : 0,
    oneTimeKeyCount: Number.isSafeInteger(oneTimeKeyCount) && oneTimeKeyCount >= 0 ? oneTimeKeyCount : 0,
  });
}

function normalizeDocument(parsed, { requireIdentity = false } = {}) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.version !== 1) return null;
  const picklingPassphrase = cleanText(parsed.picklingPassphrase);
  const deviceId = cleanText(parsed.deviceId);
  const accountPickle = cleanText(parsed.accountPickle);
  const curveKey = cleanText(parsed.accountIdentities?.curve25519);
  const edKey = cleanText(parsed.accountIdentities?.ed25519);
  const pkDecryptionPickle = cleanText(parsed.pkDecryptionPickle);
  const pkEncryptionKey = cleanText(parsed.pkEncryptionKey);
  if (!picklingPassphrase || !deviceId || !accountPickle || !pkDecryptionPickle || !pkEncryptionKey) return null;
  if (requireIdentity && (!curveKey || !edKey)) return null;
  const watermark = Number(parsed.oneTimeKeyWatermark);
  return {
    version: 1,
    picklingPassphrase,
    deviceId,
    accountPickle,
    accountIdentities: Object.freeze({
      curve25519: curveKey ?? '',
      ed25519: edKey ?? '',
    }),
    pkDecryptionPickle,
    pkEncryptionKey,
    oneTimeKeyWatermark: Number.isSafeInteger(watermark) && watermark >= 0 ? watermark : 0,
    sessions: sessionEntries(parsed.sessions, ['sessionId', 'senderUserId', 'senderDevice']),
    groupInbound: sessionEntries(parsed.groupInbound, ['roomId', 'senderKey', 'sessionId']),
    groupOutbound: outboundGroups(parsed.groupOutbound),
    pendingRoomKeys: pendingRoomKeys(parsed.pendingRoomKeys),
    requestState: requestState(parsed.requestState),
    uploadedKeys: deviceKeySnapshot(parsed.uploadedKeys),
  };
}

export function matrixCryptoPathFor(directory) {
  const clean = cleanText(directory);
  if (!clean) throw new TypeError('Matrix crypto persistence requires a bot directory');
  return `${clean.replace(/[\\/]+$/, '')}/${CRYPTO_FILE}`;
}

export class MatrixCryptoStore {
  #path;
  #value = null;
  #writeQueue = Promise.resolve();

  constructor(path) {
    const clean = cleanText(path);
    if (!clean) throw new TypeError('Matrix crypto store requires a file path');
    this.#path = clean;
  }

  get path() {
    return this.#path;
  }

  async load() {
    try {
      const parsed = normalizeDocument(JSON.parse(await readFile(this.#path, 'utf8')));
      if (!parsed) throw new Error('dsh-im Matrix crypto store contains invalid data');
      this.#value = parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#value = null;
    }
    return this;
  }

  get snapshot() {
    return this.#value ? structuredClone(this.#value) : null;
  }

  get isReady() {
    return this.#value !== null;
  }

  async bootstrap(initial) {
    if (this.#value) return this.#value;
    const candidate = normalizeDocument({
      version: 1,
      picklingPassphrase: cleanText(initial?.picklingPassphrase) ?? Buffer.from(randomBytes(32)).toString('hex'),
      deviceId: initial?.deviceId ?? '',
      accountPickle: initial?.accountPickle ?? '',
      accountIdentities: initial?.accountIdentities ?? {},
      pkDecryptionPickle: initial?.pkDecryptionPickle ?? '',
      pkEncryptionKey: initial?.pkEncryptionKey ?? '',
      oneTimeKeyWatermark: initial?.oneTimeKeyWatermark ?? 0,
      sessions: [],
      groupInbound: [],
      groupOutbound: {},
      pendingRoomKeys: [],
      requestState: {},
      uploadedKeys: null,
    }, { requireIdentity: true });
    if (!candidate) throw new Error('Refusing to persist an incomplete Matrix crypto device state');
    await this.#persist(candidate);
    return structuredClone(candidate);
  }

  async apply(patch) {
    const current = this.#value;
    if (!current) throw new Error('Matrix crypto store is not bootstrapped yet');
    const next = {
      ...current,
      oneTimeKeyWatermark: patch.oneTimeKeyWatermark === undefined
        ? current.oneTimeKeyWatermark
        : (Number.isSafeInteger(Number(patch.oneTimeKeyWatermark)) && Number(patch.oneTimeKeyWatermark) >= 0
          ? Number(patch.oneTimeKeyWatermark) : current.oneTimeKeyWatermark),
      sessions: patch.sessions === undefined ? current.sessions : trim(sessionEntries(patch.sessions, ['sessionId', 'senderUserId', 'senderDevice']), MAX_SESSIONS),
      groupInbound: patch.groupInbound === undefined ? current.groupInbound : trim(sessionEntries(patch.groupInbound, ['roomId', 'senderKey', 'sessionId']), MAX_INBOUND_GROUP_SESSIONS),
      groupOutbound: patch.groupOutbound === undefined ? current.groupOutbound : outboundGroups(patch.groupOutbound),
      pendingRoomKeys: patch.pendingRoomKeys === undefined ? current.pendingRoomKeys : trim(pendingRoomKeys(patch.pendingRoomKeys), MAX_PENDING_ROOM_KEYS),
      requestState: patch.requestState === undefined ? current.requestState : requestState(patch.requestState),
      uploadedKeys: patch.uploadedKeys === undefined ? current.uploadedKeys : deviceKeySnapshot(patch.uploadedKeys),
    };
    const normalized = normalizeDocument(next, { requireIdentity: true });
    if (!normalized) throw new Error('Refusing to persist incomplete Matrix crypto device state');
    await this.#persist(normalized);
    return structuredClone(normalized);
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

  async #persist(next) {
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
}

function trim(entries, limit) {
  return entries.slice(Math.max(0, entries.length - limit));
}
