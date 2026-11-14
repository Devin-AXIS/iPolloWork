// Device-local E2EE orchestration for the Matrix channel on top of the official
// libolm WASM build (@matrix-org/olm). Covers the PR3 minimal loop: device key
// registration, Megolm room encryption/decryption, and to-device room key sharing,
// forwarding and requests. Key backup, SSSS and interactive verification are out of
// scope by design (docs/方案/Matrix端到端加密可行性调研.md §3).
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { t } from '../shared/i18n.mjs';
import { isMatrixRoomId, isMatrixUserId } from './matrix-api.mjs';

export const MATRIX_MEGOLM_ALGORITHM = 'm.megolm.v1_aes_sha2';
export const MATRIX_OLM_PK_ALGORITHM = 'm.olm.v1.curve25519';
// libolm's own spelling for the one-time ephemeral key field of a pk-encrypted message.
const DEFAULTS = Object.freeze({
  rotationPeriodMsgs: 100,
  rotationPeriodMs: 604_800_000,
  oneTimeKeyFloor: 20,
  oneTimeKeyTarget: 60,
  oneTimeKeyMax: 100,
  keyMaintainMs: 21_600_000,
  deviceKeyTtlMs: 900_000,
  roomMembersTtlMs: 120_000,
  requestThrottleMs: 30_000,
  requestMaxTries: 3,
});

const PK_FIELD = 'org.matrix.olm.pk_encryption_key';
const SIGN_FIELD = 'org.matrix.olm.pk_encryption_signature_payload';

let olmLoader = null;

export function loadMatrixOlm() {
  if (!olmLoader) {
    olmLoader = (async () => {
      const requireFrom = createRequire(import.meta.url);
      const entry = requireFrom.resolve('@matrix-org/olm');
      const wasmEntry = requireFrom.resolve('@matrix-org/olm/olm.wasm');
      const module = await import(pathToFileURL(entry).href);
      const Olm = module.default ?? module;
      const bytes = await readFile(wasmEntry);
      await Olm.init({ wasmBinary: new Uint8Array(bytes) });
      return Olm;
    })().catch((error) => {
      olmLoader = null;
      throw error;
    });
  }
  return olmLoader;
}

export class MatrixCryptoError extends Error {
  constructor(message, { code = 'matrix-crypto', cause = undefined } = {}) {
    super(message);
    this.name = 'MatrixCryptoError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function lowerId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function deviceKey(userId, deviceId) {
  return `${lowerId(userId)}|${deviceId ?? ''}`;
}

export class MatrixCryptoEngine {
  #api;
  #store;
  #userId;
  #deviceId;
  #logger;
  #limits;
  #now;
  #onPendingMessage = null;

  #olm = null;
  #account = null;
  #pkDecryption = null;
  #passphrase = null;
  #identity = Object.freeze({ curve25519: '', ed25519: '' });
  #pkEncryptionKey = '';
  #ready = false;

  #inbound = new Map();
  #outbound = new Map();
  #deviceCache = new Map();
  #memberCache = new Map();
  #seenIndex = new Map();
  #pendingEvents = new Map();
  #requestState = new Map();
  #pendingTasks = new Set();
  #lastKeyMaintenanceAt = 0;
  #stats = {
    undecryptable: 0,
    forwardedResponses: 0,
    keyUploads: 0,
    roomKeySends: 0,
    shareFailures: 0,
  };

  constructor({
    api,
    store,
    userId,
    deviceId,
    logger = console,
    limits = {},
    now = () => Date.now(),
  } = {}) {
    if (!api || typeof api.uploadKeys !== 'function' || typeof api.queryKeys !== 'function') {
      throw new TypeError('Matrix crypto engine requires a Matrix api instance');
    }
    if (!store || typeof store.bootstrap !== 'function' || typeof store.apply !== 'function') {
      throw new TypeError('Matrix crypto engine requires a Matrix crypto store');
    }
    if (!isMatrixUserId(userId) || !cleanText(deviceId)) {
      throw new TypeError('Matrix crypto engine requires a verified user id and device id');
    }
    this.#api = api;
    this.#store = store;
    this.#userId = userId;
    this.#deviceId = String(deviceId);
    this.#logger = logger ?? console;
    this.#limits = Object.freeze({ ...DEFAULTS, ...limits });
    this.#now = now;
  }

  get ready() {
    return this.#ready;
  }

  get identity() {
    return this.#identity;
  }

  setPendingMessageHandler(handler) {
    this.#onPendingMessage = typeof handler === 'function' ? handler : null;
  }

  async start() {
    if (this.#ready) return;
    this.#olm = await loadMatrixOlm();
    const snapshot = this.#store.snapshot;
    if (snapshot) {
      if (snapshot.deviceId !== this.#deviceId) {
        throw new MatrixCryptoError(
          t('Matrix 加密状态绑定于设备 {stored}，与当前令牌设备 {active} 不符；请先修复设备配置，切勿删除加密状态文件后静默重建设备。'),
          { code: 'crypto-device-drift' },
        );
      }
      const account = new this.#olm.Account();
      account.unpickle(snapshot.picklingPassphrase, snapshot.accountPickle);
      const pkDecryption = new this.#olm.PkDecryption();
      pkDecryption.unpickle(snapshot.picklingPassphrase, snapshot.pkDecryptionPickle);
      this.#account = account;
      this.#pkDecryption = pkDecryption;
      this.#passphrase = snapshot.picklingPassphrase;
      this.#identity = Object.freeze({
        curve25519: snapshot.accountIdentities.curve25519,
        ed25519: snapshot.accountIdentities.ed25519,
      });
      this.#pkEncryptionKey = snapshot.pkEncryptionKey;
      for (const entry of snapshot.groupInbound) {
        const key = `${entry.roomId}|${entry.senderKey}|${entry.sessionId}`;
        if (this.#inbound.has(key) || key.length > 600) continue;
        try {
          const session = new this.#olm.InboundGroupSession();
          session.unpickle(this.#passphrase, entry.pickle);
          this.#inbound.set(key, { session, lastUsedAt: entry.lastUsedAt || this.#now(), meta: entry });
        } catch (error) {
          this.#logger.warn?.('[dsh-im:matrix] an inbound group session failed to restore and was dropped:', error?.message ?? error);
        }
      }
      for (const [roomId, entry] of Object.entries(snapshot.groupOutbound)) {
        try {
          const session = new this.#olm.OutboundGroupSession(this.#account, {
            algorithm: MATRIX_MEGOLM_ALGORITHM,
            rotation_period_msgs: this.#limits.rotationPeriodMsgs,
            rotation_period_ms: this.#limits.rotationPeriodMs,
          });
          session.unpickle(this.#passphrase, entry.pickle);
          this.#outbound.set(roomId, {
            session,
            sessionId: entry.sessionId,
            sharedWith: new Set(entry.sharedWith),
            sharedOwnerKey: entry.sharedOwnerKey,
            createdAt: entry.createdAt || this.#now(),
            needsRotation: false,
          });
        } catch (error) {
          this.#logger.warn?.('[dsh-im:matrix] an outbound group session failed to restore and will rotate fresh:', error?.message ?? error);
        }
      }
      for (const [key, state] of Object.entries(snapshot.requestState ?? {})) {
        this.#requestState.set(key, { ...state });
      }
      this.#lastKeyMaintenanceAt = snapshot.uploadedKeys?.uploadedAt ?? 0;
    } else {
      const account = new this.#olm.Account();
      account.create();
      const pkDecryption = new this.#olm.PkDecryption();
      const pkPublicKey = pkDecryption.generate_key();
      const identity = JSON.parse(account.identity_keys());
      const passphraseSeed = Buffer.from(randomBytes(32)).toString('hex');
      await this.#store.bootstrap({
        deviceId: this.#deviceId,
        picklingPassphrase: passphraseSeed,
        accountPickle: account.pickle(passphraseSeed),
        accountIdentities: Object.freeze({
          curve25519: String(identity.curve25519 ?? ''),
          ed25519: String(identity.ed25519 ?? ''),
        }),
        pkDecryptionPickle: pkDecryption.pickle(passphraseSeed),
        pkEncryptionKey: String(pkPublicKey ?? ''),
        oneTimeKeyWatermark: 0,
      });
      this.#account = account;
      this.#pkDecryption = pkDecryption;
      this.#passphrase = passphraseSeed;
      this.#identity = Object.freeze({
        curve25519: String(identity.curve25519 ?? ''),
        ed25519: String(identity.ed25519 ?? ''),
      });
      this.#pkEncryptionKey = String(pkPublicKey ?? '');
    }
    if (!this.#identity.ed25519 || !this.#pkEncryptionKey) {
      throw new MatrixCryptoError(t('Matrix 设备加密身份不完整，无法建立端到端加密会话。'), { code: 'crypto-init' });
    }
    await this.#registerKeys(true);
    this.#ready = true;
  }

  async stop() {
    this.#ready = false;
    // A key request can enqueue persistence after shutdown starts. Drain both
    // before releasing sessions or allowing the caller to remove the store.
    while (this.#pendingTasks.size > 0) {
      await Promise.allSettled([...this.#pendingTasks]);
    }
    for (const entry of this.#inbound.values()) entry.session.free?.();
    for (const entry of this.#outbound.values()) entry.session.free?.();
    this.#inbound.clear();
    this.#outbound.clear();
    this.#deviceCache.clear();
    this.#memberCache.clear();
    this.#pendingEvents.clear();
    this.#seenIndex.clear();
  }

  #trackTask(task) {
    const tracked = task.finally(() => this.#pendingTasks.delete(tracked));
    this.#pendingTasks.add(tracked);
    return tracked;
  }

  async maintain() {
    if (!this.#ready) return;
    const nowMs = this.#now();
    if (nowMs - this.#lastKeyMaintenanceAt < this.#limits.keyMaintainMs) return;
    await this.#registerKeys(false);
  }

  getStats() {
    return {
      ready: this.#ready,
      deviceId: this.#deviceId,
      ed25519Fingerprint: this.#identity.ed25519.slice(0, 12),
      curve25519Fingerprint: this.#identity.curve25519.slice(0, 12),
      inboundSessions: this.#inbound.size,
      outboundRooms: this.#outbound.size,
      cachedDevices: this.#deviceCache.size,
      pendingEvents: this.#pendingEvents.size,
      throttledRequests: this.#requestState.size,
      ...this.#stats,
    };
  }

  // ---- outbound ----------------------------------------------------------

  async encryptForRoom(roomId, content) {
    if (!this.#ready) throw new MatrixCryptoError(t('Matrix 加密引擎尚未就绪。'), { code: 'crypto-init' });
    if (!isMatrixRoomId(roomId)) throw new TypeError('Matrix room id is invalid');
    const members = await this.#roomMembers(roomId);
    const recipients = await this.#devicesForMembers(members);
    const entry = await this.#getOutbound(roomId);
    const missing = recipients.filter((device) => !entry.sharedWith.has(deviceKey(device.userId, device.deviceId)));
    if (missing.length > 0 || entry.sharedOwnerKey !== this.#identity.ed25519) {
      await this.#shareRoomKey(roomId, entry, missing.length > 0 ? missing : recipients);
    }
    const plaintext = JSON.stringify({
      content,
      room_id: roomId,
      sender_key: this.#identity.ed25519,
      sender_device_id: this.#deviceId,
      sender_claimed_keys: {},
      recipient_claimed_keys: {},
      forwarding_claimed_keys: {},
    });
    let ciphertext;
    try {
      ciphertext = entry.session.encrypt(plaintext);
    } catch (error) {
      // A corrupted or stale session must rotate instead of poisoning the room timeline.
      this.#logger.warn?.('[dsh-im:matrix] outbound group session failed; rotating before retry:', error?.message ?? error);
      this.#rotateOutbound(roomId);
      const fresh = await this.#getOutbound(roomId);
      await this.#shareRoomKey(roomId, fresh, recipients);
      ciphertext = fresh.session.encrypt(plaintext);
    }
    if (this.#messageIndex(entry) >= this.#limits.rotationPeriodMsgs) entry.needsRotation = true;
    this.#persistOutbound(roomId, entry);
    return Object.freeze({
      algorithm: MATRIX_MEGOLM_ALGORITHM,
      sender_key: this.#identity.ed25519,
      device_id: this.#deviceId,
      session_id: entry.sessionId,
      ciphertext,
    });
  }

  async #getOutbound(roomId) {
    const existing = this.#outbound.get(roomId);
    if (existing && !existing.needsRotation) return existing;
    if (existing) {
      const ageOk = this.#now() - existing.createdAt < this.#limits.rotationPeriodMs;
      const indexOk = this.#messageIndex(existing) < this.#limits.rotationPeriodMsgs;
      if (ageOk && indexOk && !existing.needsRotation) return existing;
      existing.session.free?.();
      this.#outbound.delete(roomId);
    }
    const session = new this.#olm.OutboundGroupSession(this.#account, {
      algorithm: MATRIX_MEGOLM_ALGORITHM,
      rotation_period_msgs: this.#limits.rotationPeriodMsgs,
      rotation_period_ms: this.#limits.rotationPeriodMs,
    });
    session.create();
    const entry = {
      session,
      sessionId: session.session_id(),
      sharedWith: new Set(),
      sharedOwnerKey: this.#identity.ed25519,
      createdAt: this.#now(),
      needsRotation: false,
    };
    this.#outbound.set(roomId, entry);
    return entry;
  }

  #rotateOutbound(roomId) {
    const existing = this.#outbound.get(roomId);
    if (existing) {
      existing.session.free?.();
      this.#outbound.delete(roomId);
    }
  }

  #messageIndex(entry) {
    const index = Number(entry.session?.message_index?.() ?? 0);
    return Number.isSafeInteger(index) && index >= 0 ? index : 0;
  }

  async #shareRoomKey(roomId, entry, recipients) {
    if (recipients.length === 0) {
      entry.sharedWith = new Set();
      this.#persistOutbound(roomId, entry);
      return;
    }
    const sessionKey = entry.session.session_key();
    const messages = {};
    const shared = new Set(entry.sharedWith);
    let sent = 0;
    for (const device of recipients) {
      if (!device.pkEncryptionKey) {
        this.#stats.shareFailures += 1;
        continue;
      }
      const payload = JSON.stringify({
        room_id: roomId,
        session_id: entry.sessionId,
        session_key: sessionKey,
        sender_key: this.#identity.ed25519,
        sender_device_id: this.#deviceId,
        sender_claimed_keys: {},
        forwarding_claimed_keys: {},
      });
      let pkg;
      try {
        const pkEncryption = new this.#olm.PkEncryption();
        pkEncryption.set_recipient_key(device.pkEncryptionKey);
        pkg = pkEncryption.encrypt(payload);
      } catch (error) {
        this.#stats.shareFailures += 1;
        this.#logger.warn?.('[dsh-im:matrix] room key pk-encryption failed for one device:', error?.message ?? error);
        continue;
      }
      const perUser = (messages[device.userId] ??= {});
      perUser[device.deviceId] = {
        algorithm: MATRIX_OLM_PK_ALGORITHM,
        recipient_key: device.pkEncryptionKey,
        sender_key: this.#identity.ed25519,
        sender_claimed_keys: {},
        ciphertext: pkg.ciphertext,
        mac: pkg.mac,
        ephemeral: pkg.ephemeral ?? pkg.ephemeral_key ?? null,
      };
      shared.add(deviceKey(device.userId, device.deviceId));
      sent += 1;
    }
    if (sent > 0) {
      try {
        await this.#api.sendToDevice('m.room_key', messages);
        this.#stats.roomKeySends += 1;
      } catch (error) {
        // Do not claim delivery the messages did not get; the next send retries the share.
        this.#stats.shareFailures += 1;
        this.#logger.warn?.('[dsh-im:matrix] to-device room key submission failed; it will be retried:', error?.message ?? error);
        return;
      }
    }
    entry.sharedWith = shared;
    entry.sharedOwnerKey = this.#identity.ed25519;
    this.#persistOutbound(roomId, entry);
  }

  async #roomMembers(roomId) {
    const cached = this.#memberCache.get(roomId);
    if (cached && this.#now() - cached.at < this.#limits.roomMembersTtlMs) return cached.members;
    const listing = await this.#api.getJoinedMembers(roomId).catch(() => null);
    const members = Object.freeze(Array.isArray(listing)
      ? listing.filter((entry) => isMatrixUserId(entry) && lowerId(entry) !== lowerId(this.#userId))
      : []);
    this.#memberCache.set(roomId, { at: this.#now(), members });
    return members;
  }

  async #devicesForMembers(userIds) {
    const devices = [];
    const missing = [];
    for (const userId of userIds) {
      const cached = this.#deviceCache.get(lowerId(userId));
      if (cached && this.#now() - cached.at < this.#limits.deviceKeyTtlMs) {
        for (const device of cached.devices.values()) devices.push({ userId, ...device });
        continue;
      }
      missing.push(userId);
    }
    if (missing.length > 0) await this.#queryDevices(missing);
    for (const userId of missing) {
      const cached = this.#deviceCache.get(lowerId(userId));
      if (!cached) continue;
      for (const device of cached.devices.values()) devices.push({ userId, ...device });
    }
    return devices;
  }

  async #queryDevices(userIds) {
    if (userIds.length === 0) return;
    const response = await this.#api.queryKeys(userIds).catch(() => null);
    const all = response?.device_keys ?? {};
    for (const userId of userIds) {
      const devices = new Map();
      const perUser = all[userId] ?? {};
      for (const [deviceId, entry] of Object.entries(perUser)) {
        const keys = entry?.keys && typeof entry.keys === 'object' ? entry.keys : {};
        const curve = cleanText(keys.curve25519);
        const ed = cleanText(keys.ed25519);
        const pkEncryptionKey = cleanText(entry?.[PK_FIELD]) ?? cleanText(keys[PK_FIELD]);
        if (!curve || !ed || !pkEncryptionKey) continue;
        const verified = this.#verifyDeviceSignature(userId, deviceId, entry);
        if (!verified) {
          this.#logger.warn?.(`[dsh-im:matrix] device ${deviceId} of ${userId} failed signature verification and was skipped`);
          continue;
        }
        devices.set(deviceId, {
          deviceId,
          curve25519: curve,
          ed25519: ed,
          pkEncryptionKey,
          signatures: entry?.signatures ?? null,
        });
      }
      this.#deviceCache.set(lowerId(userId), { at: this.#now(), devices });
    }
  }

  #verifyDeviceSignature(userId, deviceId, entry) {
    const signaturePayload = cleanText(entry?.[SIGN_FIELD]);
    const edKey = cleanText(entry?.keys?.ed25519);
    const signature = cleanText(entry?.signatures?.[edKey ?? '']) ?? cleanText(entry?.signatures_ed?.[edKey ?? '']);
    if (!signaturePayload || !edKey || !signature) return false;
    try {
      const utility = new this.#olm.Utility();
      // Measured shape: ed25519_verify(publicKey, message, signature); wrong orders throw INVALID_BASE64.
      utility.ed25519_verify(edKey, signaturePayload, signature);
      return true;
    } catch {
      return false;
    }
  }

  invalidateRoomSharing(roomId) {
    this.#memberCache.delete(roomId);
    this.#deviceCache.clear();
    const entry = this.#outbound.get(roomId);
    if (entry) {
      entry.sharedWith = new Set();
      this.#persistOutbound(roomId, entry);
    }
  }

  // ---- inbound -----------------------------------------------------------

  async handleToDeviceEvents(events) {
    if (!this.#ready || !Array.isArray(events)) return;
    for (const event of events) {
      const type = event?.type;
      try {
        if (type === 'm.room_key') await this.#handleRoomKeyEvent(event);
        else if (type === 'm.forwarded_room_key') await this.#handleForwardedRoomKeyEvent(event);
        else if (type === 'm.room_key_request') await this.#handleRoomKeyRequest(event);
      } catch (error) {
        this.#logger.warn?.('[dsh-im:matrix] a to-device crypto event could not be processed:', error?.message ?? error);
      }
    }
  }

  #pkDecryptPayload(pkg) {
    const ephemeral = cleanText(pkg?.ephemeral ?? pkg?.ephemeral_key);
    const mac = cleanText(pkg?.mac);
    const ciphertext = cleanText(pkg?.ciphertext);
    if (!ephemeral || !mac || !ciphertext) return null;
    try {
      return this.#pkDecryption.decrypt(ephemeral, mac, ciphertext);
    } catch (error) {
      // The recipient's pk keys cannot open this package (wrong recipient, replay or tamper): drop it
      // quietly as undecryptable rather than leak the olm error text, which carries attacker data.
      void error;
      return null;
    }
  }

  // Every to-device handler consumes per-device pk packages: objects carrying an olm/megolm
  // ciphertext plus its mac and ephemeral key. A delivered event holds the package as its own
  // content; a relaying homeserver or a sending-side caller may keep the { user: { device: package } }
  // map; and the legacy forwarded-key form nests the packages one level deeper under `keys`.
  #mineToDevicesMessages(content) {
    const payloads = [];
    const pushPackage = (value) => {
      if (value && typeof value === 'object' && typeof value.ciphertext === 'string') payloads.push(value);
    };
    const messages = content?.messages;
    if (messages && typeof messages === 'object' && !Array.isArray(messages)) {
      // Servers key the to-device map by the original casing; also scan case-insensitively.
      const mine = messages[this.#userId] ?? messages[lowerId(this.#userId)];
      const deviceMaps = mine && typeof mine === 'object'
        ? [mine]
        : Object.values(messages).filter((entry) => entry && typeof entry === 'object');
      for (const deviceMap of deviceMaps) {
        for (const value of Object.values(deviceMap)) pushPackage(value);
      }
    }
    pushPackage(content);
    if (payloads.length === 0) {
      const keys = content?.keys;
      if (keys && typeof keys === 'object' && !Array.isArray(keys)) {
        for (const perUser of Object.values(keys)) {
          if (!perUser || typeof perUser !== 'object') continue;
          for (const perDevice of Object.values(perUser)) {
            if (!perDevice || typeof perDevice !== 'object') continue;
            for (const value of Object.values(perDevice)) pushPackage(value);
          }
        }
      }
    }
    return payloads;
  }

  async #handleRoomKeyEvent(event) {
    const content = event?.content;
    if (cleanText(content?.action) === 'request_cancellation') {
      const sessionId = cleanText(content?.session_id);
      if (sessionId) for (const key of [...this.#requestState.keys()]) {
        if (key.includes(`|${sessionId}`)) this.#requestState.delete(key);
      }
      return;
    }
    for (const pkg of this.#mineToDevicesMessages(content)) {
      const action = cleanText(pkg?.action);
      if (action !== null && action !== 'send') continue;
      const inner = this.#pkDecryptPayload(pkg);
      if (!inner) {
        this.#stats.undecryptable += 1;
        continue;
      }
      let payload;
      try {
        payload = JSON.parse(inner);
      } catch {
        continue;
      }
      const roomId = cleanText(payload.room_id);
      const sessionId = cleanText(payload.session_id);
      const sessionKey = cleanText(payload.session_key);
      const senderKey = cleanText(payload.sender_key) ?? cleanText(pkg.sender_key);
      if (!isMatrixRoomId(roomId) || !sessionId || !sessionKey || !senderKey) continue;
      await this.#importInbound(roomId, senderKey, sessionId, sessionKey, { forwarded: false });
    }
  }

  async #handleForwardedRoomKeyEvent(event) {
    const pkg = this.#mineToDevicesMessages(event?.content)[0] ?? event?.content;
    const inner = this.#pkDecryptPayload(pkg);
    if (!inner) {
      this.#stats.undecryptable += 1;
      return;
    }
    let payload;
    try {
      payload = JSON.parse(inner);
    } catch {
      return;
    }
    const roomId = cleanText(payload.room_id);
    const sessionId = cleanText(payload.session_id);
    const sessionKey = cleanText(payload.session_key ?? payload.exported_session_key);
    const senderKey = cleanText(payload.sender_key);
    const forwardingKey = cleanText(payload.forwarding_key);
    if (!isMatrixRoomId(roomId) || !sessionId || !sessionKey || !senderKey) return;
    // Only accept forwarded keys from a source whose own key we already trust in this room,
    // which bounds the key-poisoning surface to peers the room key already came through.
    const trusted = this.#inbound.has(`${roomId}|${senderKey}|${sessionId}`)
      || this.#inbound.has(`${roomId}|${forwardingKey ?? ''}|${sessionId}`);
    if (!trusted) {
      this.#logger.warn?.('[dsh-im:matrix] a forwarded room key from an unknown forwarding device was rejected');
      return;
    }
    await this.#importInbound(roomId, senderKey, sessionId, sessionKey, { forwarded: true });
  }

  async #handleRoomKeyRequest(event) {
    const pkg = this.#mineToDevicesMessages(event?.content)[0] ?? event?.content;
    const inner = this.#pkDecryptPayload(pkg);
    if (!inner) return;
    let payload;
    try {
      payload = JSON.parse(inner);
    } catch {
      return;
    }
    if (cleanText(payload.action) !== 'request') return;
    const roomId = cleanText(payload.room_id);
    const sessionId = cleanText(payload.session_id);
    const requestingUserId = cleanText(payload.requesting_user_id);
    const requestingDeviceId = cleanText(payload.requesting_device_id);
    if (!isMatrixRoomId(roomId) || !sessionId || !requestingUserId || !requestingDeviceId) return;
    if (lowerId(requestingUserId) === lowerId(this.#userId)) return;
    const throttleKey = `${lowerId(requestingUserId)}|${requestingDeviceId}|${roomId}|${sessionId}`;
    const state = this.#requestState.get(throttleKey);
    const nowMs = this.#now();
    if (state && nowMs - state.at < this.#limits.requestThrottleMs && state.tries >= this.#limits.requestMaxTries) return;
    for (const [key, entry] of this.#inbound) {
      if (!key.startsWith(`${roomId}|`) || !key.endsWith(`|${sessionId}`)) continue;
      let exported = null;
      try {
        exported = entry.session.export_session(entry.meta?.firstKnownIndex ?? 0);
      } catch {
        try {
          exported = entry.session.export_session(0);
        } catch {
          exported = null;
        }
      }
      if (!exported) return;
      const devices = await this.#devicesForMembers([requestingUserId]);
      const target = devices.find((device) => device.deviceId === requestingDeviceId);
      if (!target?.pkEncryptionKey) return;
      const body = JSON.stringify({
        action: 'send',
        room_id: roomId,
        session_id: sessionId,
        sender_key: this.#identity.ed25519,
        forwarding_key: this.#identity.ed25519,
        session_key: exported,
        exported: true,
      });
      const pkEncryption = new this.#olm.PkEncryption();
      pkEncryption.set_recipient_key(target.pkEncryptionKey);
      const pkgOut = pkEncryption.encrypt(body);
      await this.#api.sendToDevice('m.forwarded_room_key', {
        [requestingUserId]: {
          [requestingDeviceId]: {
            algorithm: MATRIX_OLM_PK_ALGORITHM,
            recipient_key: target.pkEncryptionKey,
            sender_key: this.#identity.ed25519,
            sender_claimed_keys: {},
            ciphertext: pkgOut.ciphertext,
            mac: pkgOut.mac,
            ephemeral: pkgOut.ephemeral ?? pkgOut.ephemeral_key ?? null,
          },
        },
      }).catch(() => undefined);
      this.#stats.forwardedResponses += 1;
      this.#requestState.set(throttleKey, { at: nowMs, tries: (state?.tries ?? 0) + 1 });
      this.#persistRequestState();
      return;
    }
  }

  async decryptRoomEvent(roomId, event) {
    if (!this.#ready) return null;
    const content = event?.content;
    const algorithm = cleanText(content?.algorithm);
    const sessionId = cleanText(content?.session_id);
    const senderKey = cleanText(content?.sender_key);
    const ciphertext = cleanText(content?.ciphertext);
    if (!algorithm || !sessionId || !senderKey || !ciphertext) return null;
    if (algorithm !== MATRIX_MEGOLM_ALGORITHM) return null;
    const key = `${roomId}|${senderKey}|${sessionId}`;
    const entry = this.#inbound.get(key);
    if (!entry) {
      this.#stats.undecryptable += 1;
      this.#pendingEvents.set(`${key}|${event?.event_id ?? 'x'}`, { roomId, event, at: this.#now() });
      void this.#trackTask(this.#requestRoomKey(roomId, event).catch((error) => {
        this.#logger.warn?.('[dsh-im:matrix] a room key request failed:', error?.message ?? error);
      }));
      return null;
    }
    const seen = this.#seenIndexes(key);
    let messageIndex = 0;
    let plaintext;
    try {
      const result = entry.session.decrypt(ciphertext);
      if (typeof result === 'string') {
        plaintext = result;
        messageIndex = Number(entry.session.last_message_index?.() ?? 0) || 0;
      } else {
        plaintext = result?.plaintext;
        messageIndex = Number(result?.message_index) || 0;
      }
    } catch {
      this.#stats.undecryptable += 1;
      return null;
    }
    if (seen.has(messageIndex)) {
      // A replayed megolm payload of an already accepted index must not duplicate the message.
      this.#stats.undecryptable += 1;
      return null;
    }
    seen.add(messageIndex);
    if (seen.size > 4_096) seen.delete(seen.values().next().value);
    entry.lastUsedAt = this.#now();
    let payload;
    try {
      payload = JSON.parse(plaintext);
    } catch {
      this.#stats.undecryptable += 1;
      return null;
    }
    if (cleanText(payload.room_id) !== roomId) {
      this.#stats.undecryptable += 1;
      return null;
    }
    if (cleanText(payload.sender_key) && cleanText(payload.sender_key) !== senderKey) {
      this.#stats.undecryptable += 1;
      return null;
    }
    const content2 = payload.content && typeof payload.content === 'object' ? payload.content : null;
    if (!content2) {
      this.#stats.undecryptable += 1;
      return null;
    }
    return {
      content: content2,
      senderKey,
      sessionId,
      senderDeviceId: cleanText(payload.sender_device_id) ?? cleanText(content.device_id) ?? null,
    };
  }

  #seenIndexes(key) {
    let set = this.#seenIndex.get(key);
    if (!set) {
      set = new Set();
      this.#seenIndex.set(key, set);
    }
    return set;
  }

  async #requestRoomKey(roomId, event) {
    const sessionId = cleanText(event?.content?.session_id);
    const senderKey = cleanText(event?.content?.sender_key);
    if (!sessionId) return;
    const throttleKey = `req|${roomId}|${sessionId}|${senderKey ?? ''}`;
    const state = this.#requestState.get(throttleKey);
    const nowMs = this.#now();
    if (state && nowMs - state.at < this.#limits.requestThrottleMs && state.tries >= this.#limits.requestMaxTries) return;
    const members = await this.#roomMembers(roomId);
    const devices = await this.#devicesForMembers(members.filter((_, index) => index < 50));
    if (devices.length === 0) return;
    const body = JSON.stringify({
      action: 'request',
      room_id: roomId,
      session_id: sessionId,
      requesting_user_id: this.#userId,
      requesting_device_id: this.#deviceId,
    });
    const messages = {};
    for (const device of devices) {
      if (!device.pkEncryptionKey) continue;
      const pkEncryption = new this.#olm.PkEncryption();
      pkEncryption.set_recipient_key(device.pkEncryptionKey);
      let pkg;
      try {
        pkg = pkEncryption.encrypt(body);
      } catch {
        continue;
      }
      const perUser = (messages[device.userId] ??= {});
      perUser[device.deviceId] = {
        algorithm: MATRIX_OLM_PK_ALGORITHM,
        recipient_key: device.pkEncryptionKey,
        sender_key: this.#identity.ed25519,
        sender_claimed_keys: {},
        ciphertext: pkg.ciphertext,
        mac: pkg.mac,
        ephemeral: pkg.ephemeral ?? pkg.ephemeral_key ?? null,
      };
    }
    if (Object.keys(messages).length === 0) return;
    await this.#api.sendToDevice('m.room_key_request', messages).catch(() => undefined);
    this.#requestState.set(throttleKey, { at: nowMs, tries: (state?.tries ?? 0) + 1 });
    this.#persistRequestState();
  }

  async #importInbound(roomId, senderKey, sessionId, sessionKey, { forwarded }) {
    const key = `${roomId}|${senderKey}|${sessionId}`;
    const existing = this.#inbound.get(key);
    if (existing) {
      existing.lastUsedAt = this.#now();
      await this.#flushPendingForKey(key);
      return;
    }
    const session = new this.#olm.InboundGroupSession();
    try {
      if (forwarded) session.import_session(sessionKey);
      else session.create(sessionKey);
    } catch {
      try {
        session.import_session(sessionKey);
      } catch (error) {
        session.free?.();
        this.#logger.warn?.('[dsh-im:matrix] an incoming room key could not be imported:', error?.message ?? error);
        return;
      }
    }
    const firstKnownIndex = Number(session.first_known_index?.() ?? 0) || 0;
    this.#inbound.set(key, {
      session,
      lastUsedAt: this.#now(),
      meta: { roomId, senderKey, sessionId, firstKnownIndex },
    });
    this.#trimInbound();
    await this.#persistInbound(key);
    await this.#flushPendingForKey(key);
  }

  #trimInbound() {
    if (this.#inbound.size <= 900) return;
    const ordered = [...this.#inbound.entries()].sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);
    for (const [key, entry] of ordered.slice(0, this.#inbound.size - 800)) {
      entry.session.free?.();
      this.#inbound.delete(key);
      this.#seenIndex.delete(key);
    }
  }

  async #flushPendingForKey(key) {
    if (!this.#onPendingMessage) return;
    const prefix = `${key}|`;
    for (const [pendingKey, pending] of [...this.#pendingEvents]) {
      if (!pendingKey.startsWith(prefix)) continue;
      this.#pendingEvents.delete(pendingKey);
      try {
        await this.#onPendingMessage(pending.roomId, pending.event);
      } catch (error) {
        this.#logger.warn?.('[dsh-im:matrix] a late-decrypted message could not be dispatched:', error?.message ?? error);
      }
    }
    // Keep the buffer bounded even when no handler drains it.
    if (this.#pendingEvents.size > 64) {
      const oldest = [...this.#pendingEvents.keys()].sort((left, right) =>
        (this.#pendingEvents.get(left)?.at ?? 0) - (this.#pendingEvents.get(right)?.at ?? 0));
      for (const stale of oldest.slice(0, this.#pendingEvents.size - 64)) this.#pendingEvents.delete(stale);
    }
  }

  // ---- persistence -------------------------------------------------------

  #persistOutbound(roomId, entry) {
    const snapshot = this.#store.snapshot;
    if (!snapshot) return Promise.resolve();
    const groupOutbound = { ...snapshot.groupOutbound };
    try {
      groupOutbound[roomId] = {
        pickle: entry.session.pickle(this.#passphrase),
        sessionId: entry.sessionId,
        sharedOwnerKey: entry.sharedOwnerKey,
        messageIndex: this.#messageIndex(entry),
        sharedWith: [...entry.sharedWith],
        createdAt: entry.createdAt,
        lastUsedAt: this.#now(),
      };
    } catch {
      return Promise.resolve();
    }
    return this.#trackTask(this.#store.apply({ groupOutbound }).catch(() => undefined));
  }

  #persistInbound(key) {
    const snapshot = this.#store.snapshot;
    if (!snapshot) return Promise.resolve();
    const entry = this.#inbound.get(key);
    if (!entry) return Promise.resolve();
    let pickle;
    try {
      pickle = entry.session.pickle(this.#passphrase);
    } catch {
      return Promise.resolve();
    }
    const groupInbound = [
      ...snapshot.groupInbound.filter((candidate) =>
        !(candidate.roomId === entry.meta.roomId && candidate.senderKey === entry.meta.senderKey
          && candidate.sessionId === entry.meta.sessionId)),
      {
        roomId: entry.meta.roomId,
        senderKey: entry.meta.senderKey,
        sessionId: entry.meta.sessionId,
        pickle,
        firstKnownIndex: entry.meta.firstKnownIndex ?? 0,
        createdAt: entry.lastUsedAt,
        lastUsedAt: entry.lastUsedAt,
      },
    ].slice(-900);
    return this.#trackTask(this.#store.apply({ groupInbound }).catch(() => undefined));
  }

  #persistRequestState() {
    const snapshot = this.#store.snapshot;
    if (!snapshot) return Promise.resolve();
    const requestState = {};
    for (const [key, state] of [...this.#requestState].slice(-200)) requestState[key] = { ...state };
    return this.#trackTask(this.#store.apply({ requestState }).catch(() => undefined));
  }

  // ---- key registration ---------------------------------------------------

  async #registerKeys(force) {
    if (!this.#account) return;
    if (!force && this.#now() - this.#lastKeyMaintenanceAt < this.#limits.keyMaintainMs) return;
    const unpublished = this.#unpublishedCount();
    if (!force && unpublished >= this.#limits.oneTimeKeyFloor) return;
    const missing = Math.max(0, this.#limits.oneTimeKeyTarget - unpublished);
    if (missing > 0) {
      this.#account.generate_one_time_keys(Math.min(missing, this.#limits.oneTimeKeyMax));
    }
    const otkJson = JSON.parse(this.#account.one_time_keys() ?? '{}');
    const otk = otkJson?.curve25519 && typeof otkJson.curve25519 === 'object' ? otkJson.curve25519 : {};
    const fallbackJson = JSON.parse(this.#account.unpublished_fallback_key() ?? '{}');
    if (!fallbackJson?.curve25519 || Object.keys(fallbackJson.curve25519).length === 0) {
      this.#account.generate_fallback_key();
    }
    const fallbackParsed = JSON.parse(this.#account.fallback_key() ?? '{}');
    const fallback = fallbackParsed?.curve25519 && typeof fallbackParsed.curve25519 === 'object'
      ? fallbackParsed.curve25519 : {};
    const fallbackKeys = Object.entries(fallback).map(([keyId, key]) => ({ key_id: keyId, key: String(key) }));
    const signaturePayload = JSON.stringify({
      user_id: this.#userId,
      device_id: this.#deviceId,
      curve25519: this.#identity.curve25519,
      ed25519: this.#identity.ed25519,
      [PK_FIELD]: this.#pkEncryptionKey,
    });
    const signature = this.#account.sign(signaturePayload);
    await this.#api.uploadKeys({
      device_id: this.#deviceId,
      keys: { curve25519: this.#identity.curve25519, ed25519: this.#identity.ed25519 },
      fallback_keys: fallbackKeys,
      one_time_keys: otk,
      signatures: { [this.#identity.ed25519]: signature },
      signatures_ed: { [this.#identity.ed25519]: signature },
      [PK_FIELD]: this.#pkEncryptionKey,
      [SIGN_FIELD]: signaturePayload,
    });
    this.#account.mark_keys_as_published();
    this.#lastKeyMaintenanceAt = this.#now();
    this.#stats.keyUploads += 1;
    const snapshot = this.#store.snapshot;
    if (snapshot) {
      await this.#store.apply({
        oneTimeKeyWatermark: (snapshot.oneTimeKeyWatermark ?? 0) + Object.keys(otk).length,
        uploadedKeys: {
          signaturePayload,
          uploadedAt: this.#lastKeyMaintenanceAt,
          oneTimeKeyCount: Object.keys(otk).length,
        },
      }).catch(() => undefined);
    }
  }

  #unpublishedCount() {
    try {
      const parsed = JSON.parse(this.#account.one_time_keys() ?? '{}');
      return parsed?.curve25519 && typeof parsed.curve25519 === 'object'
        ? Object.keys(parsed.curve25519).length : 0;
    } catch {
      return 0;
    }
  }
}
