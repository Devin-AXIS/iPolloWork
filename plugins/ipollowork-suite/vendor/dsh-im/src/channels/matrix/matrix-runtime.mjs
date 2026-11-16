import { createEditableMessageStream, splitMessageText } from '../shared/editable-message-stream.mjs';
import { t } from '../shared/i18n.mjs';
import {
  isMatrixEventId,
  isMatrixRoomId,
  MatrixApi,
  MatrixApiError,
  performMatrixPasswordLogin,
  validateMatrixHomeserver,
} from './matrix-api.mjs';
import {
  createMatrixBridgeStatus,
  MATRIX_DESCRIPTOR,
  MatrixHarnessBridge,
} from './matrix-bridge.mjs';
import { MatrixCryptoEngine } from './matrix-crypto.mjs';
import {
  ClockSkewGuard,
  compileIgnorePatterns,
  EventDedupeRing,
  isMatrixCommandLike,
  normalizeMatrixDeliveryTarget,
  normalizeMatrixTimelineEvent,
  resolveBangMatrixCommand,
  threadIdOf,
  replyEventIdOf,
} from './matrix-normalize.mjs';
import {
  DEFAULT_ROOM_HISTORY_LIMIT,
  formatRoomContextBlock,
  roomContextDayStartTs,
} from './matrix-room-history.mjs';
import {
  applyMatrixRelations,
  buildMatrixEditContent,
  buildMatrixReactionContent,
  buildMatrixTextContent,
  extractOutboundMentions,
  hasRoomMention,
} from './matrix-rich-text.mjs';
import { RootContextRegistry } from '../shared/conversation/root-context.mjs';
import { WindowAmbientProvider } from '../shared/conversation/ambient-provider.mjs';
import { createEventLru, resolveReplyChain } from '../shared/conversation/reply-context.mjs';
import { renderContextEntries } from '../shared/conversation/context-builder.mjs';
import { TRIGGER_REPLY_MODES } from '../shared/conversation/trigger-policy.mjs';
import { chunkMarkdownParts } from '../shared/markdown-chunks.mjs';

const RECONNECT_DELAYS_MS = Object.freeze([1_000, 3_000, 5_000, 10_000, 30_000]);
const SYNC_LONG_POLL_MS = 30_000;
const SYNC_RETRY_DELAY_MS = 5_000;
const INVITE_JOIN_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_MESSAGE_LENGTH = 16_000;
const DEFAULT_MAX_MEDIA_BYTES = 104_857_600;
const EDIT_STREAM_INTERVAL_MS = 350;
const MATRIX_THREADS_MODES = new Set(['inherit', 'isolate', 'auto']);
const MAX_BOT_EVENT_BINDINGS = 5_000;

function safeInt(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.trunc(value);
  if (!Number.isSafeInteger(rounded)) return fallback;
  return Math.min(Math.max(rounded, min), max);
}
const DEAD_ROOM_MARKERS = Object.freeze(['no servers', 'room not found']);
const IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toRoomSet(values) {
  const list = Array.isArray(values) ? values : (values instanceof Set ? [...values] : []);
  return new Set(list.filter((value) => isMatrixRoomId(value)));
}

function toTextSet(values) {
  const list = Array.isArray(values) ? values : (values instanceof Set ? [...values] : []);
  return new Set(list.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()));
}

function safeErrorInfo(error) {
  if (!error) return null;
  return Object.freeze({
    at: new Date().toISOString(),
    code: error instanceof MatrixApiError ? error.code : (error?.code ?? 'error'),
    message: String(error?.message ?? error).slice(0, 400).replaceAll(/mxc:\/\/[^\s]+/g, 'mxc://…'),
  });
}

function summarizeCryptoStats(stats) {
  if (!stats || typeof stats !== 'object') return null;
  return Object.freeze({
    inboundSessions: Number(stats.inboundSessions) || 0,
    outboundRooms: Number(stats.outboundRooms) || 0,
    pendingEvents: Number(stats.pendingEvents) || 0,
    undecryptable: Number(stats.undecryptable) || 0,
    keyUploads: Number(stats.keyUploads) || 0,
    roomKeySends: Number(stats.roomKeySends) || 0,
    shareFailures: Number(stats.shareFailures) || 0,
  });
}

function resolveE2eeMode(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'false' || raw === 'no') return 'off';
  if (raw === 'required' || raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return 'required';
  return 'optional';
}

function inviterAllowed(accessPolicy, inviter) {
  if (!inviter) return false;
  const settings = typeof accessPolicy?.getSettings === 'function' ? accessPolicy.getSettings() : null;
  const candidate = inviter.trim().toLowerCase();
  for (const scope of [settings?.direct, settings?.group]) {
    if (!scope) continue;
    if (scope.mode === 'open') return true;
    const users = Array.isArray(scope.allowlist?.users) ? scope.allowlist.users : [];
    if (users.some((entry) => String(entry?.id ?? '').trim().toLowerCase() === candidate)) return true;
  }
  return false;
}

function inviteSenderOf(inviteRoom) {
  const events = Array.isArray(inviteRoom?.invite_state?.events) ? inviteRoom.invite_state.events : [];
  for (const event of events) {
    if (event?.type === 'm.room.member' && event?.content?.membership === 'invite'
      && typeof event.sender === 'string') return event.sender;
  }
  return null;
}

// A room is a direct chat only when the homeserver itself says so: the invite's own membership event
// carries is_direct, or the account's m.direct listing names the room. A two-member room is an
// ordinary room, where the mention gate must keep applying, so the joined-member count is never a signal.
function inviteMarksDirect(inviteRoom) {
  const events = Array.isArray(inviteRoom?.invite_state?.events) ? inviteRoom.invite_state.events : [];
  return events.some((event) => event?.type === 'm.room.member'
    && event?.content?.membership === 'invite'
    && event?.content?.is_direct === true);
}

function timelineEventsOf(joinRoom) {
  const events = Array.isArray(joinRoom?.timeline?.events) ? joinRoom.timeline.events : [];
  return events.filter((event) => event && typeof event === 'object' && event.state_key === undefined);
}

function initialStateEventsOf(joinRoom) {
  const events = Array.isArray(joinRoom?.state?.events) ? joinRoom.state.events : [];
  return events.filter((event) => event && typeof event === 'object');
}

export function createMatrixRuntimeStatus() {
  return Object.assign(createMatrixBridgeStatus(), {
    startedAt: null,
    ready: false,
    connectionState: 'idle',
    harnessReachable: false,
    lastCheckedAt: null,
    lastConnectedAt: null,
    lastError: null,
    joinedRooms: 0,
    e2eeMode: 'optional',
    e2eeActive: false,
    lastCryptoError: null,
    cryptoStats: null,
    encryptedRoomsSeen: 0,
    lastClockSkewAt: null,
  });
}

export class MatrixRuntime {
  #config;
  #auth;
  #harness;
  #state;
  #sidecar;
  #contextEnhancement;
  #accessPolicy;
  #status;
  #logger;
  #createApi;
  #isKnownCommand;
  #replyTimeoutMs;
  #api = null;
  #bridge = null;
  #approvalController = new AbortController();
  #botUserId = null;
  #deviceId = null;
  #crypto = null;
  #cryptoStore;
  #createCrypto;
  #generation = 0;
  #started = false;
  #stopped = true;
  #syncTask = null;
  #reconnectTimer = null;
  #reconnectIndex = 0;
  #inviteTasks = new Map();
  #clock = new ClockSkewGuard({});
  #ring = new EventDedupeRing(1_000);
  #patterns = [];
  #dmRooms = new Set();
  #joinedRooms = new Set();
  #encryptedRooms = new Set();
  #notifiedEncryptedRooms = new Set();
  #e2eeActive = false;

  constructor({
    config = {},
    accessToken,
    password,
    harness,
    state,
    sidecar,
    contextEnhancement,
    accessPolicy,
    status = createMatrixRuntimeStatus(),
    logger = console,
    replyTimeoutMs = 600_000,
    createApi = (options) => new MatrixApi(options),
    cryptoStore = null,
    createCrypto = null,
    roomHistory = null,
    isKnownCommand,
  } = {}) {
    const homeserver = validateMatrixHomeserver(config.homeserver);
    if (!homeserver) throw new TypeError('Matrix runtime requires a valid homeserver');
    const token = cleanString(accessToken);
    const secret = cleanString(password);
    const userId = cleanString(config.userId);
    if (!token && !(secret && userId)) {
      throw new TypeError('Matrix runtime requires an access token or a user id with password');
    }
    this.#config = Object.freeze({
      ...config,
      homeserver,
      maxMessageLength: Number.isSafeInteger(config.maxMessageLength)
        ? Math.min(Math.max(config.maxMessageLength, 500), 65_535)
        : DEFAULT_MAX_MESSAGE_LENGTH,
      maxMediaBytes: Number.isSafeInteger(config.maxMediaBytes) && config.maxMediaBytes > 0
        ? Math.min(config.maxMediaBytes, 104_857_600)
        : DEFAULT_MAX_MEDIA_BYTES,
      requireMention: config.requireMention !== false,
      processNotices: config.processNotices === true,
      allowRoomMentions: config.allowRoomMentions === true,
      reactions: config.reactions !== false,
      autoJoinInvites: config.autoJoinInvites === 'all' ? 'all' : 'authorized',
      e2eeMode: resolveE2eeMode(config.e2eeMode),
    });
    this.#auth = Object.freeze(token ? { accessToken: token } : { password: secret, userId });
    this.#harness = harness;
    this.#state = state;
    this.#sidecar = sidecar;
    this.#contextEnhancement = contextEnhancement;
    this.#accessPolicy = accessPolicy;
    this.#status = status;
    this.#status.e2eeMode = this.#config.e2eeMode;
    this.#logger = logger;
    this.#createApi = createApi;
    if (cryptoStore != null
      && (typeof cryptoStore.load !== 'function'
        || typeof cryptoStore.bootstrap !== 'function'
        || typeof cryptoStore.apply !== 'function')) {
      throw new TypeError('Matrix crypto store is missing the load/bootstrap/apply contract');
    }
    this.#cryptoStore = cryptoStore ?? null;
    this.#createCrypto = typeof createCrypto === 'function'
      ? createCrypto
      : (options) => new MatrixCryptoEngine(options);
    this.#isKnownCommand = typeof isKnownCommand === 'function' ? isKnownCommand : () => false;
    this.#roomHistory = roomHistory
      && typeof roomHistory.append === 'function'
      && typeof roomHistory.consumePending === 'function'
      && typeof roomHistory.pending === 'function'
      && typeof roomHistory.search === 'function'
      && typeof roomHistory.recent === 'function'
      ? roomHistory
      : null;
    this.#roomContextLimit = safeInt(config.roomContextLimit, 1, 500, 50);
    this.#roomContextMaxChars = safeInt(config.roomContextMaxChars, 200, 200_000, 8_000);
    this.#roomContextTzOffsetMinutes = safeInt(config.roomContextTzOffsetMinutes, -840, 840, 0);
    this.#roomContextEnabled = config.roomContextEnabled !== false;
    this.#threadsMode = MATRIX_THREADS_MODES.has(config.threadsMode) ? config.threadsMode : 'inherit';
    this.#triggerOnReply = TRIGGER_REPLY_MODES.includes(config.triggerOnReply) ? config.triggerOnReply : 'never';
    this.#rootOnceEnabled = config.rootContextOnceEnabled === true;
    this.#replyContextEnabled = config.replyContextEnabled === true;
    this.#ambientContextEnabled = config.ambientContextEnabled === true;
    // The room-visible window is shipped on: what members can read in the room
    // timeline reaches the model as collected context, bounded only by the
    // window and budget knobs below.
    this.#visibleContextEnabled = config.visibleContextEnabled !== false;
    this.#visibleContextWindowMs = safeInt(config.visibleContextWindowMs, 10_000, 86_400_000, 600_000);
    this.#visibleContextLimit = safeInt(config.visibleContextLimit, 1, 50, 8);
    // Follow-up lanes for rooms run on rapid consecutive posts: a same sender's
    // burst folds into one dispatch, and that sender's mid-turn follow-ups steer
    // the in-flight turn rather than queueing behind the answer they correct.
    // Other members' messages still queue one voice at a time.
    this.#autoSteerSameSender = config.autoSteerSameSender !== false;
    this.#autoSteerLimit = safeInt(config.autoSteerLimit, 0, 20, 5);
    this.#coalesceWindowMs = safeInt(config.coalesceWindowMs, 0, 3_000, 450);
    this.#visibleContextChars = safeInt(config.visibleContextChars, 200, 200_000, 4_000);
    this.#contextMaxChars = safeInt(config.contextMaxChars, 200, 200_000, 8_000);
    this.#replyMaxDepth = safeInt(config.replyMaxDepth, 1, 10, 5);
    this.#rootRegistry = new RootContextRegistry({ state });
    this.#ambientProvider = this.#roomHistory
      ? new WindowAmbientProvider({
        store: this.#roomHistory,
        burstGapMs: safeInt(config.ambientBurstGapMs, 5_000, 3_600_000, 90_000),
        recentWindowMs: safeInt(config.ambientRecentWindowMs, 10_000, 86_400_000, 180_000),
        recentCount: safeInt(config.ambientRecentCount, 1, 200, 20),
        maxContextChars: this.#contextMaxChars,
      })
      : null;
    this.#contextEvents = createEventLru(256);
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#patterns = compileIgnorePatterns(config.ignoreUserPatterns);
    for (const roomId of toRoomSet(config.freeResponseRooms)) this.#freeRooms.add(roomId);
    this.#allowedRooms = toRoomSet(config.allowedRooms);
  }

  #freeRooms = new Set();
  #allowedRooms = new Set();
  #roomHistory = null;
  #roomContextLimit = 50;
  #roomContextMaxChars = 8_000;
  #roomContextTzOffsetMinutes = 0;
  #roomContextEnabled = true;
  #threadsMode = 'inherit';
  #triggerOnReply = 'never';
  /**
   * Within one conversation an event enters the model as collected context at most
   * once. The in-memory map rides on the room record's durable per-conversation
   * ledger (`contextInjected`/`markContextInjected`), so an entry that was already
   * offered stays retired across restarts; only a cleared session releases it.
   */
  #contextLedger = new Map();
  /**
   * Per-conversation session generation, bumped when /new clears the session. A
   * recorded bubble's epoch retires it from its own conversation's window only
   * while it matches this counter, so a fresh session re-reads the previous
   * session's bubbles once instead of inheriting their retirement.
   */
  #turnEpochs = new Map();
  #ledgerRouteCap = 400;
  #ledgerEntryCap = 512;
  /**
   * Group senders' room-state display names. Reads are synchronous against this
   * cache so the timeline handler never blocks on the homeserver; a miss
   * schedules the state read and the same sender reads as its MXID localpart
   * until the name arrives. Entries expire after the TTL and the Map evicts in
   * insertion order beyond the cap.
   */
  #memberNames = new Map();
  #memberNameCap = 512;
  #memberNameTtlMs = 600_000;
  #rootOnceEnabled = false;
  #replyContextEnabled = false;
  #ambientContextEnabled = false;
  #visibleContextEnabled = true;
  #visibleContextWindowMs = 600_000;
  #visibleContextLimit = 8;
  #autoSteerSameSender = true;
  #autoSteerLimit = 5;
  #coalesceWindowMs = 450;
  #visibleContextChars = 4_000;
  #contextMaxChars = 8_000;
  #replyMaxDepth = 5;
  #rootRegistry = null;
  #ambientProvider = null;
  #contextEvents = null;
  #botEventBindings = new Map();

  get status() {
    return this.#status;
  }

  async start() {
    if (this.#started && this.#status.ready) return;
    this.#stopped = false;
    this.#approvalController = new AbortController();
    this.#started = true;
    const generation = ++this.#generation;
    const homeserver = this.#config.homeserver;
    let accessToken = this.#auth.accessToken ?? null;
    let resolvedUserId = 'userId' in this.#auth ? this.#auth.userId : cleanString(this.#config.userId);
    let resolvedDeviceId = cleanString(this.#config.deviceId);
    if (!accessToken) {
      const session = await performMatrixPasswordLogin({
        homeserver,
        userId: resolvedUserId,
        password: this.#auth.password,
        ...(resolvedDeviceId ? { deviceId: resolvedDeviceId } : {}),
      });
      accessToken = session.accessToken;
      resolvedUserId = session.userId;
      if (session.deviceId && resolvedDeviceId && session.deviceId !== resolvedDeviceId) {
        this.#logger.warn?.(t('Matrix 配置的 device_id 与服务端实际设备不一致，以服务端设备为准。'));
      }
      resolvedDeviceId = session.deviceId ?? resolvedDeviceId;
    }
    const api = this.#createApi({ homeserver, accessToken, userId: resolvedUserId });
    const identity = await api.whoami();
    const verifiedUserId = cleanString(identity?.user_id) ?? resolvedUserId;
    const verifiedDeviceId = cleanString(identity?.device_id);
    if (!verifiedUserId) throw new Error('Matrix whoami returned no user id');
    if (resolvedUserId && verifiedUserId.toLowerCase() !== resolvedUserId.toLowerCase()) {
      this.#logger.warn?.(
        t('Matrix whoami 返回的用户 {verified} 与配置的用户 {configured} 不一致，以 whoami 结果为准。'),
        { verified: verifiedUserId, configured: resolvedUserId },
      );
    }
    if (verifiedDeviceId && resolvedDeviceId && verifiedDeviceId !== resolvedDeviceId) {
      this.#logger.warn?.(
        t('Matrix 配置的 device_id {configured} 与令牌绑定设备 {verified} 不一致，令牌仅能为其设备共享密钥，以令牌设备为准。'),
        { configured: resolvedDeviceId, verified: verifiedDeviceId },
      );
    }
    this.#api = api;
    this.#botUserId = verifiedUserId;
    this.#deviceId = verifiedDeviceId ?? resolvedDeviceId;
    await this.#startCrypto(api, verifiedUserId, this.#deviceId);
    if (generation !== this.#generation) return;
    this.#clock = new ClockSkewGuard({});
    this.#ring.seed(this.#state.snapshot?.()?.seenMessageIds ?? []);
    this.#bridge = new MatrixHarnessBridge({
      descriptor: { ...MATRIX_DESCRIPTOR, reactions: this.#config.reactions ? MATRIX_DESCRIPTOR.reactions : {} },
      bot: this.#createBotClient(),
      harness: this.#harness,
      state: this.#state,
      contextEnhancement: this.#contextEnhancement,
      accessPolicy: this.#accessPolicy,
      status: this.#status,
      logger: this.#logger,
      replyTimeoutMs: this.#replyTimeoutMs,
      autoSteerSameSender: this.#autoSteerSameSender,
      autoSteerLimit: this.#autoSteerLimit,
      coalesceWindowMs: this.#coalesceWindowMs,
      // The binding table and the /new anchor reset serve the trigger policy and the
      // `auto` thread router, not only the context collectors, so those modes wire the
      // hooks even when every structured-context collector stays off.
      contextHooks: this.#structuredContextActive() || this.#triggerOnReply === 'bot-only' || this.#threadsMode === 'auto'
        ? this.#createContextHooks()
        : null,
    });
    await this.#initialSync();
    if (generation !== this.#generation) return;
    this.#status.ready = true;
    this.#status.connectionState = 'connected';
    this.#status.harnessReachable = true;
    this.#status.lastConnectedAt = new Date().toISOString();
    this.#status.lastCheckedAt = this.#status.lastConnectedAt;
    this.#status.lastError = null;
    this.#status.startedAt ??= this.#status.lastConnectedAt;
    this.#status.e2eeActive = this.#e2eeActive;
    this.#reconnectIndex = 0;
    this.#syncTask = Promise.resolve().then(() => this.#syncLoop(generation));
  }

  async stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#approvalController.abort();
    this.#started = false;
    this.#generation += 1;
    if (this.#reconnectTimer !== null) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    for (const task of this.#inviteTasks.values()) task.abort?.();
    this.#inviteTasks.clear();
    const bridge = this.#bridge;
    this.#bridge = null;
    const crypto = this.#crypto;
    this.#crypto = null;
    this.#e2eeActive = false;
    this.#status.e2eeActive = false;
    this.#api = null;
    await Promise.race([
      bridge?.waitForIdle() ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 2_000).unref?.()),
    ]);
    await crypto?.stop?.().catch(() => undefined);
    this.#status.ready = false;
    this.#status.connectionState = 'idle';
  }

  async sendConnectionTest(text) {
    const bridge = this.#bridge;
    if (!bridge) throw new Error('Matrix bot is not connected');
    return await bridge.sendConnectionTest(text);
  }

  async presentSessionSyncApproval(target, interaction, options = {}) {
    if (!this.#status.ready || !this.#bridge) return false;
    const actor = typeof target?.route?.userId === 'string' ? target.route.userId.trim() : '';
    if (!actor) return false;
    return this.#bridge.presentSessionSyncApproval(interaction, {
      key: options.key.startsWith('dm:') ? `direct:${options.key}` : options.key,
      actor, validate: options.validate,
      send: (text) => this.sendProactiveText(target, text),
    }, { ...options, runtimeSignal: this.#approvalController.signal });
  }

  async sendProactiveText(target, text, options = {}) {
    const api = this.#api;
    if (!api) throw new Error('Matrix bot is not connected');
    const normalized = normalizeMatrixDeliveryTarget(target ?? {});
    if (normalized.error) {
      const error = new Error(`Matrix delivery target is invalid: ${normalized.error}`);
      error.code = 'invalid-target';
      throw error;
    }
    const route = normalized.value;
    if (route.kind === 'dm') {
      const roomId = await this.#resolveDmRoom(route.userId, options);
      await this.#sendRoomText({ roomId, threadId: null }, text, options);
      return { sent: true };
    }
    await this.#sendRoomText({ roomId: route.roomId, threadId: route.threadId ?? null }, text, options);
    return { sent: true };
  }

  // ---- 端到端加密 ----

  async #startCrypto(api, userId, deviceId) {
    this.#crypto = null;
    this.#e2eeActive = false;
    this.#status.cryptoStats = null;
    this.#status.lastCryptoError = null;
    if (this.#config.e2eeMode === 'off') return;
    if (!this.#cryptoStore) {
      this.#status.lastCryptoError = safeErrorInfo(new Error('matrix crypto store is not configured'));
      if (this.#config.e2eeMode === 'required') {
        throw new Error(t('端到端加密模式为 required，但未配置加密状态存储，已拒绝建立加密连接。'));
      }
      this.#logger.warn?.(t('Matrix 端到端加密未配置状态存储，加密房间消息将明确降级跳过。'));
      return;
    }
    let engine = null;
    try {
      await this.#cryptoStore.load();
      engine = this.#createCrypto({
        api,
        store: this.#cryptoStore,
        userId,
        deviceId,
        logger: this.#logger,
      });
      engine.setPendingMessageHandler((roomId, event) => this.#handleTimelineEvent(roomId, event));
      await engine.start();
      this.#crypto = engine;
      this.#e2eeActive = true;
      this.#status.cryptoStats = summarizeCryptoStats(engine.getStats());
      this.#logger.info?.(t('Matrix 端到端加密引擎已就绪，设备密钥与一次性密钥已注册。'));
    } catch (error) {
      this.#e2eeActive = false;
      this.#crypto = null;
      this.#status.cryptoStats = null;
      this.#status.lastCryptoError = safeErrorInfo(error);
      await engine?.stop?.().catch(() => undefined);
      if (this.#config.e2eeMode === 'required') {
        const reason = String(error?.message ?? error).replaceAll(/mxc:\/\/[^\s]+/g, 'mxc://…').slice(0, 300);
        throw new Error(t('端到端加密模式为 required，但加密引擎启动失败，已拒绝建立加密连接：{reason}', { reason }));
      }
      this.#logger.warn?.(t('Matrix 端到端加密引擎启动失败，加密房间消息将明确降级跳过。'), error?.message ?? error);
    }
  }

  async #dispatchToDeviceEvents(events) {
    if (!this.#crypto || !Array.isArray(events)) return;
    await this.#crypto.handleToDeviceEvents(events).catch(() => undefined);
  }

  // ---- 连接与 sync 循环 ----

  async #initialSync() {
    const api = this.#api;
    const initial = await api.sync({ timeout: 0 });
    const rooms = initial?.rooms ?? {};
    for (const roomId of Object.keys(rooms.join ?? {})) {
      if (!isMatrixRoomId(roomId)) continue;
      this.#joinedRooms.add(roomId);
      for (const event of initialStateEventsOf(rooms.join?.[roomId])) {
        if (event?.type === 'm.room.encryption') this.#encryptedRooms.add(roomId);
      }
    }
    const direct = await api.getAccountData('m.direct').catch(() => null);
    for (const list of Object.values(direct ?? {})) {
      if (!Array.isArray(list)) continue;
      for (const roomId of list) if (isMatrixRoomId(roomId)) this.#dmRooms.add(roomId);
    }
    // A persisted direct chat survives only where the bot really routes a person to it, or where the
    // account data above re-registers it: residue from the retired member-count rule is forgotten here.
    const routedTo = new Set(Object.values(this.#sidecar.dmRoomByUser()).filter((roomId) => isMatrixRoomId(roomId)));
    for (const roomId of this.#sidecar.dmRooms()) if (routedTo.has(roomId)) this.#dmRooms.add(roomId);
    for (const roomId of this.#sidecar.joinedRooms()) this.#joinedRooms.add(roomId);
    for (const [roomId, room] of Object.entries(rooms.invite ?? {})) {
      this.#scheduleInviteJoin(roomId, inviteSenderOf(room), inviteMarksDirect(room));
    }
    // Queued to-device room keys land before the offline timeline replay so queued ciphertext can decrypt on first sight.
    await this.#dispatchToDeviceEvents(initial?.to_device?.events);
    for (const [roomId, room] of Object.entries(rooms.join ?? {})) {
      for (const event of timelineEventsOf(room)) await this.#handleTimelineEvent(roomId, event);
    }
    if (typeof initial?.next_batch === 'string' && initial.next_batch) {
      this.#lastBatch = initial.next_batch;
      await this.#sidecar.apply({
        nextBatch: initial.next_batch,
        joinedRooms: [...this.#joinedRooms],
        dmRooms: [...this.#dmRooms],
      });
    }
    this.#status.joinedRooms = this.#joinedRooms.size;
    this.#status.encryptedRoomsSeen = this.#encryptedRooms.size;
  }

  async #syncLoop(generation) {
    while (!this.#stopped && generation === this.#generation && this.#api) {
      try {
        const data = await this.#api.sync({
          since: this.#lastBatch ?? undefined,
          timeout: SYNC_LONG_POLL_MS,
        });
        if (generation !== this.#generation || this.#stopped) return;
        await this.#handleSyncData(data);
        if (this.#crypto) {
          await this.#crypto.maintain?.().catch(() => undefined);
          this.#status.cryptoStats = summarizeCryptoStats(this.#crypto.getStats());
        }
        this.#status.lastCheckedAt = new Date().toISOString();
        this.#reconnectIndex = 0;
      } catch (error) {
        if (generation !== this.#generation || this.#stopped) return;
        const permanent = error instanceof MatrixApiError
          ? error.permanent
          : /m_unknown_token|unauthorized|forbidden/i.test(String(error?.message ?? ''));
        if (permanent) {
          this.#status.connectionState = 'failed';
          this.#status.harnessReachable = false;
          this.#status.lastError = safeErrorInfo(error);
          this.#logger.warn?.('[dsh-im:matrix] sync loop stopped on a permanent auth error; reconnecting', error);
          this.#scheduleReconnect(generation);
          return;
        }
        this.#logger.warn?.('[dsh-im:matrix] sync loop error; retrying', error);
        await new Promise((resolve) => setTimeout(resolve, SYNC_RETRY_DELAY_MS).unref?.());
      }
    }
  }

  #scheduleReconnect(generation) {
    if (this.#stopped || generation !== this.#generation || this.#reconnectTimer !== null) return;
    const delayMs = RECONNECT_DELAYS_MS[Math.min(this.#reconnectIndex, RECONNECT_DELAYS_MS.length - 1)];
    this.#reconnectIndex += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#stopped || generation !== this.#generation) return;
      this.#status.connectionState = 'connecting';
      void this.start().catch((error) => {
        this.#logger.warn?.('[dsh-im:matrix] reconnect attempt failed; the supervisor will retry', error);
      });
    }, delayMs);
    this.#reconnectTimer.unref?.();
  }

  async #handleSyncData(data) {
    const rooms = data?.rooms ?? {};
    await this.#dispatchToDeviceEvents(data?.to_device?.events);
    let joinedChanged = false;
    for (const [roomId, room] of Object.entries(rooms.join ?? {})) {
      if (!isMatrixRoomId(roomId)) continue;
      if (!this.#joinedRooms.has(roomId)) {
        this.#joinedRooms.add(roomId);
        joinedChanged = true;
      }
      for (const event of initialStateEventsOf(room)) {
        if (event?.type === 'm.room.encryption') this.#encryptedRooms.add(roomId);
        // A membership change invalidates the shared-device set so the next send re-shares the room key.
        else if (event?.type === 'm.room.member' && event?.state_key && this.#crypto) this.#crypto.invalidateRoomSharing(roomId);
      }
      for (const event of timelineEventsOf(room)) await this.#handleTimelineEvent(roomId, event);
    }
    for (const [roomId, room] of Object.entries(rooms.invite ?? {})) {
      if (!isMatrixRoomId(roomId)) continue;
      this.#scheduleInviteJoin(roomId, inviteSenderOf(room), inviteMarksDirect(room));
    }
    if (typeof data?.next_batch === 'string' && data.next_batch) {
      this.#lastBatch = data.next_batch;
      await this.#sidecar.apply({
        nextBatch: data.next_batch,
        ...(joinedChanged ? { joinedRooms: [...this.#joinedRooms] } : {}),
      });
      this.#status.joinedRooms = this.#joinedRooms.size;
      this.#status.encryptedRoomsSeen = this.#encryptedRooms.size;
    }
  }

  async #handleTimelineEvent(roomId, event) {
    if (event?.type === 'm.room.encrypted') {
      this.#noteEncryptedRoom(roomId);
      if (!this.#crypto) return;
      if (typeof event?.event_id !== 'string' || !event.event_id) return;
      const decrypted = await this.#crypto.decryptRoomEvent(roomId, event).catch(() => null);
      if (!decrypted || typeof decrypted.content !== 'object' || decrypted.content === null) return;
      event = { ...event, type: 'm.room.message', content: decrypted.content };
    }
    if (event?.type !== 'm.room.message' && event?.type !== 'm.room.encryption') return;
    if (event?.type === 'm.room.encryption') {
      this.#encryptedRooms.add(roomId);
      return;
    }
    const content = event?.content;
    if (content?.['m.relates_to']?.rel_type === 'm.replace') return;
    const isDirect = this.#dmRooms.has(roomId);
    const outcome = normalizeMatrixTimelineEvent({
      event,
      roomId,
      botUserId: this.#botUserId,
      isDirect,
      config: {
        requireMention: this.#config.requireMention,
        processNotices: this.#config.processNotices,
        freeResponseRooms: this.#freeRooms,
        allowedRooms: this.#allowedRooms.size > 0 ? this.#allowedRooms : null,
        threadsMode: this.#threadsMode,
        triggerOnReply: this.#triggerOnReply,
        botId: this.#config.botId ?? null,
      },
      patterns: this.#patterns,
      ring: this.#ring,
      clock: this.#clock,
      deps: {
        createMediaSource: (mediaContent, msgtype) => this.#createMediaSource(mediaContent, msgtype),
        classifyReplyTarget: (eventId) => this.#classifyReplyTarget(eventId),
        routeOverrideForReply: (eventId) => this.#routeOverrideForReply(eventId),
        isBotRoomEvent: (roomId, eventId) => (this.#roomHistory?.kindOf({ roomId, eventId }) ?? null) === 'bot',
      },
    });
    if (outcome.drop) {
      if (outcome.warnSkew && !this.#status.lastClockSkewAt) {
        this.#status.lastClockSkewAt = new Date().toISOString();
        this.#logger.warn?.(t('Matrix 收到的时间戳持续远落后于本机时间，检测到本机时钟超前，请校准系统时间后重启机器人。'));
      }
      if (outcome.drop === 'mention-required'
        || outcome.drop === 'reply-to-human'
        || outcome.drop === 'reply-target-unknown') this.#recordRoomAmbient(roomId, event);
      else if (outcome.drop === 'self') this.#recordRoomBotReply(roomId, event);
      return;
    }
    const message = { ...outcome.message };
    if (message.kind === 'group' && typeof message.senderId === 'string' && message.senderId) {
      const speakerName = this.#resolveSenderDisplayName(roomId, message.senderId);
      if (speakerName) {
        message.speakerName = speakerName;
        const baseSource = typeof message.contextSource === 'function' ? message.contextSource() : {};
        message.contextSource = () => ({ ...baseSource, senderName });
      }
    }
    if (message.addressed && typeof message.content === 'string' && message.content.startsWith('!')) {
      const resolved = resolveBangMatrixCommand(message.content, (name) => this.#isKnownCommand(name));
      if (resolved !== message.content) {
        message.content = resolved;
        message.addressed = true;
      }
    }
    if (this.#roomHistory && this.#roomContextEnabled && message.kind === 'group') {
      if (message.addressed) {
        const commandLike = isMatrixCommandLike(message.content);
        const directAddress = message.mentioned === true || Boolean(message.replyToEventId);
        this.#recordRoomHuman(message, { kind: commandLike ? 'command' : 'human', injected: true });
        if (!commandLike && directAddress && !this.#structuredContextActive()) {
          const block = this.#consumeRoomContext(message.roomId);
          if (block) {
            const label = t('【下面这条才是对你的提问，请只回答它】');
            message.content = `${block}\n\n${label}\n${message.content}`;
          }
        }
      } else {
        this.#recordRoomHuman(message, { kind: 'human', injected: false });
      }
    }
    void Promise.resolve(this.#bridge?.accept(message)).catch((error) => {
      this.#logger.warn?.('[dsh-im:matrix] inbound message handling failed:', error?.message ?? error);
    });
    if (message.addressed) {
      void this.#api?.setTyping(message.roomId, { typing: true, timeoutMs: 20_000 }).catch(() => undefined);
    }
  }

  #structuredContextActive() {
    return this.#rootOnceEnabled === true
      || this.#replyContextEnabled === true
      || this.#ambientContextEnabled === true
      || this.#visibleContextEnabled === true;
  }

  /** Sync classifier fed to the trigger table: a bound event id proves bot authorship. */
  #classifyReplyTarget(eventId) {
    return typeof eventId === 'string' && this.#botEventBindings.has(eventId) ? 'bot' : null;
  }

  /** The `auto` thread mode's routing hint: the conversation a reply target belongs to. */
  #routeOverrideForReply(eventId) {
    if (typeof eventId !== 'string') return null;
    return this.#botEventBindings.get(eventId)?.conversationKey ?? null;
  }

  /**
   * The conversation's current session generation. A live clear updates the in-memory
   * counter; after a restart the durable counter in the room record keeps retired
   * answers retired without a read-back.
   */
  #contextEpoch(conversationKey) {
    if (typeof conversationKey !== 'string' || !conversationKey) return 0;
    const live = this.#turnEpochs.get(conversationKey);
    if (Number.isSafeInteger(live) && live >= 0) return live;
    return this.#roomHistory?.contextEpoch({ conversationKey }) ?? 0;
  }

  #recordBotEventDelivery({ conversationKey, sessionId, providerMessageIds }) {
    if (!Array.isArray(providerMessageIds) || providerMessageIds.length === 0) return;
    for (const eventId of providerMessageIds) {
      if (typeof eventId !== 'string' || !eventId) continue;
      const boundKey = typeof conversationKey === 'string' && conversationKey ? conversationKey : null;
      this.#botEventBindings.set(eventId, {
        conversationKey: boundKey,
        sessionId: typeof sessionId === 'string' && sessionId ? sessionId : null,
        // The session generation live at delivery, the same stamp the room-visible
        // record carries at the send exit: after /new bumps the epoch, the former
        // session's bubbles are no longer this conversation's own words.
        turnEpoch: boundKey ? this.#contextEpoch(boundKey) : null,
        at: Date.now(),
      });
    }
    while (this.#botEventBindings.size > MAX_BOT_EVENT_BINDINGS) {
      const oldest = this.#botEventBindings.keys().next().value;
      this.#botEventBindings.delete(oldest);
    }
  }

  /**
   * Whether an event is this conversation's own answer of the current session
   * generation. Its text is transcript content already, so no collection lane may
   * re-serve it as room speech, however the trigger reached it. The provenance
   * rides the delivery binding (`#recordBotEventDelivery`); once `/new` bumps the
   * generation, the successor conversation no longer claims the bubble and reads
   * it back through the windows once.
   */
  #isOwnCurrentAnswer(conversationKey, eventId) {
    if (typeof conversationKey !== 'string' || !conversationKey) return false;
    if (typeof eventId !== 'string' || !eventId) return false;
    const binding = this.#botEventBindings.get(eventId);
    if (!binding || binding.conversationKey !== conversationKey) return false;
    return Number.isSafeInteger(binding.turnEpoch) && binding.turnEpoch >= 0
      && binding.turnEpoch === this.#contextEpoch(conversationKey);
  }

  /**
   * Resolve one event for the context collectors through the CS API single-event
   * endpoint, decrypting when the room is end-to-end encrypted. Resolved lookups
   * (including misses) are cached per room so a burst of replies into one chain
   * does not refetch shared ancestors.
   */
  async #fetchContextEvent(roomId, eventId) {
    if (!this.#api || typeof this.#api.getEvent !== 'function') return null;
    if (typeof eventId !== 'string' || !eventId) return null;
    const cacheKey = `${roomId}|${eventId}`;
    const cached = this.#contextEvents.get(cacheKey);
    if (cached !== undefined) return cached;
    const event = await this.#api.getEvent(roomId, eventId).catch(() => null);
    let resolved = null;
    if (event && typeof event.content === 'object' && event.content !== null) {
      let content = event.content;
      if (event.type === 'm.room.encrypted' && this.#crypto) {
        content = (await this.#crypto.decryptRoomEvent(roomId, event).catch(() => null))?.content ?? null;
      }
      const body = typeof content?.body === 'string' ? content.body : '';
      if (body) {
        // Chain walking follows genuine reply relations only; a falling-back
        // relation is the thread-membership declaration, not a reply target.
        const replyTo = replyEventIdOf(content);
        resolved = {
          sender: typeof event.sender === 'string' ? event.sender : '',
          name: '',
          text: body,
          ts: Number.isSafeInteger(event.origin_server_ts) && event.origin_server_ts > 0 ? event.origin_server_ts : null,
          replyTo,
        };
      }
    }
    this.#contextEvents.set(cacheKey, resolved);
    return resolved;
  }

  #contextAlreadyInjected(conversationKey, eventId) {
    if (typeof conversationKey !== 'string' || !conversationKey || typeof eventId !== 'string' || !eventId) return false;
    if (this.#contextLedger.get(conversationKey)?.has(eventId) === true) return true;
    return this.#roomHistory?.contextInjected({ conversationKey, eventId }) === true;
  }

  #markContextInjected(conversationKey, eventIds) {
    if (typeof conversationKey !== 'string' || !conversationKey || eventIds.length === 0) return;
    let seen = this.#contextLedger.get(conversationKey);
    if (seen) {
      // Recency follows the last injection, so the route cap evicts the stalest conversation.
      this.#contextLedger.delete(conversationKey);
      this.#contextLedger.set(conversationKey, seen);
    } else {
      seen = new Set();
      this.#contextLedger.set(conversationKey, seen);
      while (this.#contextLedger.size > this.#ledgerRouteCap) {
        const oldest = this.#contextLedger.keys().next().value;
        if (oldest === conversationKey && this.#contextLedger.size === 1) break;
        this.#contextLedger.delete(oldest);
      }
    }
    for (const eventId of eventIds) {
      seen.add(eventId);
      while (seen.size > this.#ledgerEntryCap) {
        seen.delete(seen.values().next().value);
      }
    }
    this.#roomHistory?.markContextInjected({ conversationKey, eventIds });
  }

  /**
   * The bridge-facing context pipeline. Collection runs after command handling
   * so commands never pay for a lookup; consumption markers are applied only when
   * the turn completed successfully, and delivered event ids feed the binding
   * table that classifies reply targets and routes `auto` thread replies.
   */
  #createContextHooks() {
    return {
      enabled: () => this.#structuredContextActive(),
      collect: async ({ message, conversationKey, sessionIdHint }) => {
        const entries = [];
        let used = 0;
        const placeholder = t('正在处理…');
        // The coalescer folded this turn out of several bubbles: the extra
        // members are already spoken here as the turn's own words, so the
        // windows retire them with the turn instead of re-serving that text a
        // turn later.
        if (Array.isArray(message.coalescedEventIds)) {
          this.#markContextInjected(conversationKey, message.coalescedEventIds.filter(
            (eventId) => typeof eventId === 'string' && eventId,
          ));
        }
        const offer = (entry) => {
          if (entry.eventId && entries.some((existing) => existing.eventId === entry.eventId)) return false;
          // An event whose fetched body is still the pending-placeholder
          // template carries no content members can read: homeservers hand
          // back the pre-edit body, so the receipt never enters the context.
          if (typeof entry.text === 'string' && entry.text.trim() === placeholder) return false;
          const cost = (typeof entry.text === 'string' ? entry.text.length : 0) + 48;
          if (used + cost > this.#contextMaxChars) return false;
          used += cost;
          entries.push(entry);
          return true;
        };
        const roomId = typeof message.roomId === 'string' ? message.roomId : '';
        if (this.#rootOnceEnabled && message.kind === 'group'
          && typeof message.threadId === 'string' && message.threadId) {
          const plan = this.#rootRegistry.plan({
            routeKey: conversationKey,
            sessionId: sessionIdHint,
            rootId: message.threadId,
          });
          if (plan.inject && !this.#contextAlreadyInjected(conversationKey, message.threadId)) {
            const rootId = message.threadId;
            const root = await this.#fetchContextEvent(roomId, rootId);
            // A pending placeholder that opened the thread reads as its receipt
            // line in the thread header, not as question content; what members can
            // read of that answer is the final body, which reaches the model
            // through the same-list room-visible record instead, so a
            // placeholder root contributes no entry of its own.
            if (root && root.text !== placeholder && !this.#contextAlreadyInjected(conversationKey, rootId)) {
              offer({
                collector: 'thread-root',
                roomId,
                eventId: rootId,
                sender: root.sender,
                name: root.name,
                ts: root.ts,
                text: root.text,
              });
            }
          }
        }
        if (this.#replyContextEnabled
          && typeof message.replyToEventId === 'string' && message.replyToEventId) {
          const chain = await resolveReplyChain({
            fetch: (eventId) => this.#fetchContextEvent(roomId, eventId),
            startReplyTo: message.replyToEventId,
            maxDepth: this.#replyMaxDepth,
          });
          // A machine receipt is not a human target: the chain answers only up
          // to the pending-placeholder body (oldest ancestor first, so entries
          // nearer the trigger follow it). The walk ends at the receipt and the
          // question behind a placeholder never crosses into the panel above it.
          const receiptAt = chain.findIndex(
            (node) => typeof node.text === 'string' && node.text.trim() === placeholder,
          );
          const walkable = receiptAt >= 0 ? chain.slice(receiptAt + 1) : chain;
          for (const node of walkable) {
            if (this.#contextAlreadyInjected(conversationKey, node.eventId)) continue;
            // The quote is a platform fact, yet the bubble behind it can be this
            // conversation's own answer of the current generation: transcript
            // content already, held out of the context as the room window holds it.
            if (this.#isOwnCurrentAnswer(conversationKey, node.eventId)) continue;
            if (!offer({
              collector: 'reply',
              roomId,
              eventId: node.eventId,
              sender: node.sender,
              name: node.name,
              ts: node.ts,
              text: node.text,
            })) break;
          }
        }
        // The room-visible window backfills the surrounding readback an
        // elliptical follow-up leans on — earlier answered questions and the
        // bot's own results included — whatever the other collectors did not
        // already carry and this conversation has not seen yet. It leads the
        // ambient queries so the chronological room window keeps the earlier
        // slots; the offer guard then keeps later collectors from repeating it.
        if (this.#visibleContextEnabled && message.kind === 'group' && this.#roomHistory) {
          const seenEventIds = new Set(entries.map((entry) => entry.eventId).filter(Boolean));
          if (typeof message.messageId === 'string' && message.messageId) seenEventIds.add(message.messageId);
          const window = this.#roomHistory.recent({
            roomId,
            threadId: typeof message.threadId === 'string' && message.threadId ? message.threadId : null,
            exclude: seenEventIds,
            limit: this.#visibleContextLimit,
            maxChars: this.#visibleContextChars,
            sinceTs: Date.now() - this.#visibleContextWindowMs,
          });
          for (const record of window) {
            if (this.#contextAlreadyInjected(conversationKey, record.eventId)) continue;
            // What this conversation's own current session produced already sits in
            // its transcript; re-serving it as room speech duplicates the model's
            // own words. Other conversations and a since-cleared session (newer
            // epoch) keep reading the bubble — its root-bubble panel role survives.
            if (record.turnKey === conversationKey
              && record.turnEpoch === this.#contextEpoch(conversationKey)) continue;
            if (!offer({
              collector: 'room-visible',
              roomId,
              eventId: record.eventId,
              sender: record.sender,
              name: record.name,
              ts: record.ts,
              text: record.text,
            })) break;
          }
        }
        if (this.#ambientContextEnabled && message.kind === 'group' && this.#ambientProvider) {
          const { burst, recent } = this.#ambientProvider.query({
            roomId,
            senderId: typeof message.senderId === 'string' ? message.senderId : '',
            threadId: typeof message.threadId === 'string' && message.threadId ? message.threadId : null,
          });
          for (const record of burst) {
            if (this.#contextAlreadyInjected(conversationKey, record.eventId)) continue;
            if (!offer({
              collector: 'ambient-burst',
              roomId,
              eventId: record.eventId,
              sender: record.sender,
              name: record.name,
              ts: record.ts,
              text: record.text,
            })) break;
          }
          for (const record of recent) {
            if (this.#contextAlreadyInjected(conversationKey, record.eventId)) continue;
            if (!offer({
              collector: 'ambient-recent',
              roomId,
              eventId: record.eventId,
              sender: record.sender,
              name: record.name,
              ts: record.ts,
              text: record.text,
            })) break;
          }
        }
        // The trigger body itself now rides this conversation's model input; the
        // ledger records that so a later turn's room-visible window never
        // re-serves the question the session already answered verbatim.
        if (typeof message.messageId === 'string' && message.messageId) {
          this.#markContextInjected(conversationKey, [message.messageId]);
        }
        return entries;
      },
      render: (entries) => renderContextEntries(entries),
      onConsumed: async ({ conversationKey, sessionId, entries }) => {
        const ambient = entries.filter((entry) => entry.collector === 'ambient-burst' || entry.collector === 'ambient-recent');
        if (ambient.length > 0 && this.#ambientProvider) {
          await this.#ambientProvider.markConsumed({ roomId: ambient[0]?.roomId, entries: ambient });
        }
        const root = entries.find((entry) => entry.collector === 'thread-root');
        if (root && typeof sessionId === 'string' && sessionId) {
          await this.#rootRegistry.markInjected({ routeKey: conversationKey, sessionId, rootId: root.eventId });
        }
        const collected = entries.filter((entry) => entry.collector === 'reply' || entry.collector === 'thread-root' || entry.collector === 'room-visible');
        if (collected.length > 0) {
          this.#markContextInjected(conversationKey, collected.map((entry) => entry.eventId).filter(Boolean));
        }
      },
      /**
       * The steered body reached the Session inside the in-flight turn, exactly
       * like a folded coalescer member: retire its bubble with the turn so the
       * window never re-serves text the same session has already taken in.
       */
      onSteered: async ({ conversationKey, messageId }) => {
        if (typeof messageId === 'string' && messageId) {
          this.#markContextInjected(conversationKey, [messageId]);
        }
      },
      onSessionCleared: async (conversationKey) => {
        await this.#rootRegistry.clearRoute(conversationKey);
        this.#contextLedger.delete(conversationKey);
        // The successor session never saw the previous one's answers; bumping the
        // generation lifts their retirement so they read back into this window once.
        // The durable ledger and the durable generation carry the same reset across a
        // restart, so the read-back stays bounded to once per conversation instead of
        // recurring on every reboot.
        const durable = this.#roomHistory ? this.#roomHistory.bumpContextEpoch({ conversationKey }) : null;
        this.#turnEpochs.set(conversationKey, Number.isSafeInteger(durable) && durable > 0
          ? durable
          : (this.#turnEpochs.get(conversationKey) ?? 0) + 1);
        this.#roomHistory?.clearContextInjected({ conversationKey });
      },
      onDelivered: async ({ conversationKey, sessionId, providerMessageIds }) => {
        this.#recordBotEventDelivery({ conversationKey, sessionId, providerMessageIds });
      },
    };
  }

  #recordRoomAmbient(roomId, event) {
    if (!this.#roomHistory || !this.#roomContextEnabled) return;
    if (this.#dmRooms.has(roomId)) return;
    const eventId = typeof event?.event_id === 'string' ? event.event_id : '';
    const sender = typeof event?.sender === 'string' ? event.sender : '';
    const body = typeof event?.content?.body === 'string' ? event.content.body.trim() : '';
    if (!eventId || !sender || !body) return;
    const self = this.#botUserId?.toLowerCase() ?? '';
    if (self !== '' && sender.toLowerCase() === self) return;
    this.#roomHistory.append({
      roomId,
      eventId,
      sender,
      text: body,
      ts: Number.isSafeInteger(event?.origin_server_ts) ? event.origin_server_ts : Date.now(),
      threadId: threadIdOf(event?.content),
      kind: 'human',
      injected: false,
    });
  }

  // One recorded bot message, from any exit that reaches the room: a plain
  // send, an edit frame of a streamed answer, or an echoed timeline event.
  // The pending placeholder carries no content and stays out of the record.
  #recordBotRoomMessage({ roomId, eventId, text, threadId = null, edit = false, turnKey = null }) {
    if (!this.#roomHistory || !this.#roomContextEnabled || !this.#visibleContextEnabled) return;
    if (this.#dmRooms.has(roomId)) return;
    const body = typeof text === 'string' ? text.trim() : '';
    if (!eventId) return;
    const turnEpoch = turnKey === null ? null : this.#contextEpoch(turnKey);
    const self = this.#botUserId ?? '';
    const name = self ? this.#resolveSenderDisplayName(roomId, self) : null;
    const ts = Date.now();
    // A pending placeholder earns a content-free bot receipt: the window never
    // renders an empty entry, while the fork policy and the final edit frames
    // (which revise the same entry to the read body) both key off this id.
    if (!body || body === t('正在处理…')) {
      this.#roomHistory.append({ roomId, eventId, sender: self, name, text: '', ts, threadId, kind: 'bot', turnKey, turnEpoch });
      return;
    }
    if (edit) {
      this.#roomHistory.revise({ roomId, eventId, sender: self, name, text: body, ts, threadId, turnKey, turnEpoch });
      return;
    }
    this.#roomHistory.append({ roomId, eventId, sender: self, name, text: body, ts, threadId, kind: 'bot', turnKey, turnEpoch });
  }

  // The timeline face of bot authorship: kept for homeservers that echo bot
  // events back, coalescing by event id with the send-face records. Edit
  // frames are owned by the send-face revising writer and skip here so one
  // streamed answer never lands twice under relation ids.
  #recordRoomBotReply(roomId, event) {
    if (!this.#roomHistory || !this.#roomContextEnabled || !this.#visibleContextEnabled) return;
    const content = event?.content;
    if (content?.['m.new_content'] || content?.['m.rel_type'] === 'm.replace') return;
    const eventId = typeof event?.event_id === 'string' ? event.event_id : '';
    const body = typeof content?.body === 'string' ? content.body : '';
    const msgtype = content?.msgtype;
    if (msgtype && msgtype !== 'm.text') return;
    this.#recordBotRoomMessage({
      roomId,
      eventId,
      text: body,
      threadId: threadIdOf(content),
    });
  }

  #recordRoomHuman(message, { kind = 'human', injected = false } = {}) {
    if (!this.#roomHistory || !this.#roomContextEnabled) return;
    const text = typeof message.content === 'string' ? message.content.trim() : '';
    if (!text || !message.messageId || !message.senderId) return;
    const self = this.#botUserId?.toLowerCase() ?? '';
    if (self !== '' && message.senderId.toLowerCase() === self) return;
    this.#roomHistory.append({
      roomId: message.roomId,
      eventId: message.messageId,
      sender: message.senderId,
      text,
      ts: Date.now(),
      threadId: typeof message.threadId === 'string' && message.threadId ? message.threadId : null,
      kind,
      injected,
    });
  }

  #consumeRoomContext(roomId) {
    if (!this.#roomHistory) return '';
    const now = Date.now();
    const selected = this.#roomHistory.consumePending({
      roomId,
      sinceTs: roomContextDayStartTs(now, this.#roomContextTzOffsetMinutes),
      limit: this.#roomContextLimit,
      maxChars: this.#roomContextMaxChars,
      now,
    });
    if (selected.length === 0) return '';
    // The room timeline echoes the bot's own messages too; showing them as other members' speech makes
    // the model quote itself and answer its own earlier reply, so only third-party lines are presented.
    const self = this.#botUserId?.toLowerCase() ?? '';
    const others = selected.filter((entry) => self === '' || String(entry?.sender ?? '').toLowerCase() !== self);
    if (others.length === 0) return '';
    return formatRoomContextBlock(others, {
      header: t('【群聊背景】以下各条是群里其他成员之间的发言，均未指向你。'),
      instruction: t('这些内容只用来了解现场发生过什么。请勿逐条回应、复述、翻译或总结它们，也不要因为它们而改变下面那条提问的回答。'),
      begin: t('—— 背景开始 ——'),
      end: t('—— 背景结束（以上无需回应） ——'),
      tzOffsetMinutes: this.#roomContextTzOffsetMinutes,
    });
  }

  #noteEncryptedRoom(roomId) {
    this.#encryptedRooms.add(roomId);
    this.#status.encryptedRoomsSeen = this.#encryptedRooms.size;
    if (this.#e2eeActive || this.#config.e2eeMode === 'off') return;
    if (this.#notifiedEncryptedRooms.has(roomId)) return;
    this.#notifiedEncryptedRooms.add(roomId);
    this.#logger.warn?.(
      `[dsh-im:matrix] ${roomId} ${t('端到端加密未启用或不可用，加密房间 {room} 的密文会被明确降级跳过。', { room: roomId })}`,
    );
  }

  // ---- 邀请 join ----

  #scheduleInviteJoin(roomId, inviter, marksDirect = false) {
    if (this.#stopped || !isMatrixRoomId(roomId) || this.#joinedRooms.has(roomId)) return;
    if (this.#sidecar.isDeclined(roomId)) return;
    const allowed = this.#config.autoJoinInvites === 'all' || inviterAllowed(this.#accessPolicy, inviter);
    if (!allowed) {
      this.#logger.warn?.(
        t('Matrix 拒绝了来自未授权用户 {inviter} 的入房邀请 {room}。'),
        { inviter: inviter ?? '?', room: roomId },
      );
      return;
    }
    if (this.#inviteTasks.has(roomId)) return;
    const controller = new AbortController();
    this.#inviteTasks.set(roomId, controller);
    void this.#joinInvitedRoom(roomId, inviter, controller, marksDirect).finally(() => {
      this.#inviteTasks.delete(roomId);
    });
  }

  async #joinInvitedRoom(roomId, inviter, controller, marksDirect = false) {
    const timeout = AbortSignal.timeout(INVITE_JOIN_TIMEOUT_MS);
    const signal = AbortSignal.any([controller.signal, timeout]);
    try {
      await this.#api.joinRoom(roomId, { signal });
      this.#joinedRooms.add(roomId);
      this.#status.joinedRooms = this.#joinedRooms.size;
      await this.#sidecar.apply({ joinedRooms: [...this.#joinedRooms] });
      if (inviter) await this.#recordDmRoom(roomId, inviter, marksDirect);
      this.#logger.info?.(t('Matrix 已按授权邀请加入房间 {room}。'), { room: roomId });
    } catch (error) {
      const text = String(error?.message ?? '').toLowerCase();
      if (DEAD_ROOM_MARKERS.some((marker) => text.includes(marker))) {
        try {
          await this.#api.leaveRoom(roomId, { signal: AbortSignal.timeout(10_000) });
          await this.#sidecar.apply({ declinedRooms: [...this.#sidecar.declinedRooms(), roomId] });
          this.#logger.info?.(t('Matrix 已婉拒失效房间的遗留邀请 {room}。'), { room: roomId });
        } catch {
          // A dead-room decline is best effort; a later sync reconciles again.
        }
        return;
      }
      this.#logger.warn?.('[dsh-im:matrix] invite join failed; sync will reconcile again:', error?.message ?? error);
    }
  }

  // The inviter's cached room stays usable for outbound routing either way; only an authoritative
// is_direct invite registers the room as a direct chat for inbound handling.
  async #recordDmRoom(roomId, inviter, marksDirect = false) {
    const direct = await this.#api.getAccountData('m.direct').catch(() => null);
    const map = { ...(direct && typeof direct === 'object' && !Array.isArray(direct) ? direct : {}) };
    const list = Array.isArray(map[inviter]) ? [...map[inviter]] : [];
    if (!list.includes(roomId)) list.push(roomId);
    map[inviter] = list;
    await this.#api.setAccountData('m.direct', map).catch(() => undefined);
    if (marksDirect) this.#dmRooms.add(roomId);
    const dmRoomByUser = { ...this.#sidecar.dmRoomByUser(), [inviter.trim().toLowerCase()]: roomId };
    await this.#sidecar.apply({ dmRooms: [...this.#dmRooms], dmRoomByUser });
  }

  async #resolveDmRoom(userId, options = {}) {
    const key = userId.trim().toLowerCase();
    const known = this.#sidecar.dmRoomByUser()[key];
    if (known && isMatrixRoomId(known)) return known;
    const created = await this.#api.createRoom({
      preset: 'private_chat',
      is_direct: true,
      invite: [userId],
    }, options).catch(() => null);
    const roomId = cleanString(created?.room_id ?? created?.room_Id);
    if (!roomId || !isMatrixRoomId(roomId)) {
      const error = new Error(t('Matrix 无法为该用户创建私聊房间。'));
      error.code = 'dm-room-unavailable';
      throw error;
    }
    this.#dmRooms.add(roomId);
    this.#joinedRooms.add(roomId);
    await this.#sidecar.apply({
      dmRooms: [...this.#dmRooms],
      joinedRooms: [...this.#joinedRooms],
      dmRoomByUser: { ...this.#sidecar.dmRoomByUser(), [key]: roomId },
    });
    return roomId;
  }

  // ---- 出站 ----

  async #sendRoomEvent(roomId, eventType, content, options = {}) {
    const api = this.#api;
    if (!api) throw new Error('Matrix bot is not connected');
    if (this.#crypto && this.#encryptedRooms.has(roomId)) {
      const encrypted = await this.#crypto.encryptForRoom(roomId, content);
      return await api.sendEvent(roomId, 'm.room.encrypted', encrypted, options);
    }
    return await api.sendEvent(roomId, eventType, content, options);
  }

  // Resolves a group sender's display name without blocking the synchronous
  // timeline handler: a fresh entry answers at once, a stale entry still beats
  // the localpart while the refresh runs, and a miss labels with the MXID
  // localpart while the room state read fills the cache for later turns.
  #resolveSenderDisplayName(roomId, senderId) {
    const key = `${roomId}|${senderId.toLowerCase()}`;
    const hit = this.#memberNames.get(key);
    if (hit && hit.at + this.#memberNameTtlMs > Date.now()) return hit.name;
    const api = this.#api;
    if (typeof api?.getRoomMemberDisplayName === 'function') {
      Promise.resolve(api.getRoomMemberDisplayName(roomId, senderId))
        .then((name) => {
          if (!name) return;
          this.#memberNames.delete(key);
          this.#memberNames.set(key, { name, at: Date.now() });
          while (this.#memberNames.size > this.#memberNameCap) {
            this.#memberNames.delete(this.#memberNames.keys().next().value);
          }
        })
        .catch(() => undefined);
    }
    if (hit) return hit.name;
    const local = senderId.startsWith('@') ? senderId.slice(1) : senderId;
    const colon = local.indexOf(':');
    return (colon > 0 ? local.slice(0, colon) : local) || null;
  }

  #createMediaSource(content, msgtype) {
    const encrypted = content?.file && typeof content.file === 'object' ? content.file : null;
    const contentUri = cleanString(content?.url ?? encrypted?.url);
    if (!contentUri || !contentUri.startsWith('mxc://')) return null;
    const declaredSize = Number(content?.info?.size ?? encrypted?.size);
    if (Number.isFinite(declaredSize) && declaredSize > this.#config.maxMediaBytes) return null;
    const name = cleanString(content?.body) ?? cleanString(content?.filename) ?? undefined;
    const api = this.#api;
    const mediaType = cleanString(content?.info?.mimetype ?? content?.mimetype);
    const load = async (options = {}) => {
      try {
        return await api.downloadContent(contentUri, {
          ...options,
          maxBytes: this.#config.maxMediaBytes,
        });
      } catch {
        return null;
      }
    };
    const source = { name, ...(mediaType ? { mediaType } : {}), load };
    if (msgtype === 'm.image' && mediaType && !IMAGE_MEDIA_TYPES.has(mediaType.toLowerCase())) return null;
    if (msgtype === 'm.image') return { images: [source], files: [] };
    if (msgtype === 'm.audio' || msgtype === 'm.video' || msgtype === 'm.file' || msgtype === 'm.sticker') {
      return { images: [], files: [source] };
    }
    return null;
  }

  #createBotClient() {
    return {
      sendText: async (target, text) => await this.#sendRoomText(target, text),
      sendTyping: async (target) => {
        await this.#api?.setTyping(target?.roomId ?? '', { typing: true, timeoutMs: 20_000 }).catch(() => undefined);
      },
      addReaction: async (target, key) => {
        if (!isMatrixRoomId(target?.roomId) || !isMatrixEventId(target?.eventId)) return undefined;
        await this.#sendRoomEvent(target.roomId, 'm.reaction', buildMatrixReactionContent(target.eventId, key));
        return key;
      },
      removeReaction: async (target, key) => {
        if (!isMatrixRoomId(target?.roomId) || !isMatrixEventId(target?.eventId) || !this.#botUserId) return;
        const listing = await this.#api.listRelations(target.roomId, target.eventId, 'm.annotation');
        let events = Array.isArray(listing?.events) ? listing.events : [];
        if (this.#crypto) {
          const opened = [];
          for (const event of events) {
            if (event?.type !== 'm.room.encrypted') { opened.push(event); continue; }
            const decrypted = await this.#crypto.decryptRoomEvent(target.roomId, event).catch(() => null);
            if (decrypted?.content && typeof decrypted.content === 'object') opened.push({ ...event, content: decrypted.content });
          }
          events = opened;
        }
        const own = events.filter((event) => (
          typeof event?.sender === 'string'
          && event.sender.toLowerCase() === this.#botUserId.toLowerCase()
          && event?.content?.['m.reaction'] === key
        ));
        for (const event of own.slice(0, 5)) {
          await this.#api.redactEvent(target.roomId, event.event_id).catch(() => undefined);
        }
      },
      sendImage: async (target, file) => await this.#sendArtifact(target, file, true),
      sendFile: async (target, file) => await this.#sendArtifact(target, file, false),
      openStream: (target) => this.#openStream(target),
    };
  }

  /** The conversation key a turn-bound delivery target was stamped with, or null for a local send. */
  #targetTurnKey(target) {
    return typeof target?.dshTurnKey === 'string' && target.dshTurnKey ? target.dshTurnKey : null;
  }

  async #sendRoomText(target, text, options = {}) {
    const api = this.#api;
    if (!api) throw new Error('Matrix bot is not connected');
    const roomId = typeof target?.roomId === 'string' ? target.roomId : '';
    if (!isMatrixRoomId(roomId)) throw new TypeError('Matrix reply target requires a valid room id');
    const threadId = typeof target?.threadId === 'string' && isMatrixEventId(target.threadId)
      ? target.threadId : null;
    const replyToEventId = typeof target?.replyToEventId === 'string' && isMatrixEventId(target.replyToEventId)
      ? target.replyToEventId : null;
    const chunks = options.format === 'markdown'
      ? chunkMarkdownParts(text, this.#config.maxMessageLength)
      : splitMessageText(text, this.#config.maxMessageLength).map(plain => ({ markdown: plain, plain }));
    const providerMessageIds = [];
    for (const chunk of chunks) {
      let content;
      let sentBody;
      try {
        content = buildMatrixTextContent({
          text: chunk.markdown,
          mentionUserIds: extractOutboundMentions(chunk.markdown),
          roomMention: this.#config.allowRoomMentions && hasRoomMention(chunk.markdown),
        });
        sentBody = typeof content.body === 'string' && content.body ? content.body : chunk.plain;
      } catch {
        this.#logger.warn?.('[dsh-im:matrix] Rich text could not be prepared; sending plain text');
        if (!chunk.plain) continue;
        content = { msgtype: 'm.text', body: chunk.plain };
        sentBody = chunk.plain;
      }
      applyMatrixRelations(content, { threadId, replyToEventId });
      const result = await this.#sendRoomEvent(roomId, 'm.room.message', content, {
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (typeof result?.event_id === 'string') providerMessageIds.push(result.event_id);
      // The send exits are the trusted record of what the room received: this
      // deployment's homeserver verifiably does not echo bot-authored events
      // back onto the timeline, so the room-visible store is fed here too and
      // coalesces with any echo a different server does deliver.
      if (options.recordRoom !== false) {
        this.#recordBotRoomMessage({ roomId, eventId: result?.event_id, text: sentBody, threadId, turnKey: this.#targetTurnKey(target) });
      }
    }
    return { providerMessageIds };
  }

  async #openStream(target) {
    const roomId = typeof target?.roomId === 'string' ? target.roomId : '';
    if (!isMatrixRoomId(roomId)) throw new TypeError('Matrix stream target requires a valid room id');
    if (!this.#api) throw new Error('Matrix bot is not connected');
    const initialText = t('正在处理…');
    const opened = await this.#sendRoomText(target, initialText);
    const messageId = opened.providerMessageIds[0] ?? null;
    const threadId = typeof target?.threadId === 'string' && isMatrixEventId(target.threadId)
      ? target.threadId : null;
    const stream = createEditableMessageStream({
      initialText,
      limit: this.#config.maxMessageLength,
      updateIntervalMs: EDIT_STREAM_INTERVAL_MS,
      create: async () => messageId,
      edit: async (streamMessageId, text) => {
        if (!isMatrixEventId(streamMessageId)) return;
        const content = buildMatrixEditContent({
          originalContent: { msgtype: 'm.text', body: initialText },
          newText: text,
          eventId: streamMessageId,
        });
        if (threadId) {
          content['m.relates_to'] = {
            ...content['m.relates_to'],
            chain: [{ event_id: threadId, origin_server: null, origin_sender: null, rel_type: 'm.thread' }],
          };
        }
        await this.#sendRoomEvent(roomId, 'm.room.message', content);
        // Every edit frame revises the same entry, so the store ends holding the
        // final body members read in the room regardless of frame count. The turn
        // stamp rides the same target the stream opened under, so the placeholder
        // receipt and its final body share one provenance.
        this.#recordBotRoomMessage({ roomId, eventId: streamMessageId, text, threadId, edit: true, turnKey: this.#targetTurnKey(target) });
      },
      sendRemainder: async (chunk) => await this.#sendRoomText(target, chunk),
      messageIdForResult: (result) => result?.providerMessageIds?.at(-1) ?? null,
      logger: this.#logger,
    });
    await stream.start();
    return stream;
  }

  async #sendArtifact(target, file, preferImage) {
    const api = this.#api;
    if (!api) throw new Error('Matrix bot is not connected');
    const roomId = typeof target?.roomId === 'string' ? target.roomId : '';
    if (!isMatrixRoomId(roomId)) throw new TypeError('Matrix artifact target requires a valid room id');
    const bytes = await file?.load?.({}).catch(() => null);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      const error = new Error(t('结果文件内容为空或下载失败。'));
      error.code = 'artifact-provider-failed';
      throw error;
    }
    if (bytes.byteLength > this.#config.maxMediaBytes) {
      const error = new Error(t('结果文件超过 Matrix 媒体大小上限。'));
      error.code = 'artifact-too-large';
      throw error;
    }
    const mediaType = cleanString(file?.mediaType) ?? 'application/octet-stream';
    const fileName = cleanString(file?.name) ?? (preferImage ? 'image.jpg' : 'file.bin');
    const contentUri = await api.uploadMedia(bytes, { filename: fileName, mediaType }).catch((cause) => {
      const error = new Error(t('Matrix 媒体上传失败。'));
      error.code = 'artifact-provider-failed';
      error.cause = cause;
      throw error;
    });
    const threadId = typeof target?.threadId === 'string' && isMatrixEventId(target.threadId)
      ? target.threadId : null;
    const imageLike = preferImage && mediaType.toLowerCase().startsWith('image/');
    const baseContent = {
      body: fileName,
      filename: fileName,
      url: contentUri,
    };
    const info = { mimetype: mediaType, size: bytes.byteLength };
    const attempts = imageLike
      ? [{ msgtype: 'm.image', extra: { info } }, { msgtype: 'm.file', extra: { 'm.file': info } }]
      : [{ msgtype: 'm.file', extra: { 'm.file': info } }];
    let lastError = null;
    for (const attempt of attempts) {
      const content = { ...baseContent, msgtype: attempt.msgtype, ...attempt.extra };
      applyMatrixRelations(content, { threadId });
      try {
        await this.#sendRoomEvent(roomId, 'm.room.message', content);
        return { sent: true, msgtype: attempt.msgtype };
      } catch (error) {
        lastError = error;
        if (!(error instanceof MatrixApiError) || (error.code !== 'matrix-rejected' && error.code !== 'matrix-forbidden')) {
          throw error;
        }
      }
    }
    throw lastError ?? new Error(t('Matrix 文件消息发送失败。'));
  }

  #lastBatch = null;
}
