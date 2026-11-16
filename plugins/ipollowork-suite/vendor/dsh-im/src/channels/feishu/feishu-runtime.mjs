import { createConnectionDiagnostics, atConnectionStage } from '../shared/connection-error.mjs';
import { readExternalHistory } from './history-reader.mjs';
import { randomUUID } from 'node:crypto';
import { FeishuHarnessBridge } from './bridge.mjs';
import { cardActionProbeCard } from './feishu-cards.mjs';
import { VerifiedFeishuChannel, waitForFeishuOperation } from './feishu-channel.mjs';
import { normalizeFeishuGroupResponseMode } from './group-response-mode.mjs';
import { normalizeFeishuStepPushMode, normalizeFeishuStepCardPanels } from './step-push-mode.mjs';
import { createVoice } from './voice.mjs';
import {
  syncSlashCommands,
} from './slash-command-registry.mjs';
import { normalizeSlashPanelConfig, feishuSlashManifest } from './slash-command-panel.mjs';
import { channelCapabilities } from '../shared/channel-capabilities.mjs';
import {
  connectionTestTargetUnavailable,
  sendRememberedConnectionTest,
} from '../shared/connection-test.mjs';
import { t } from '../shared/i18n.mjs';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const CALLBACK_PROBE_SUCCESS_NOTICE = '✅ 修复完成：已实测收到 card.action.trigger，菜单按钮现在可用。';
const CALLBACK_PROBE_TIMEOUT_NOTICE = '⚠️ 修复验证超时：未收到测试卡按钮的 card.action.trigger，不能确认按钮已修复。请不要重复授权；先检查飞书开放平台的卡片回调配置，确认后再发送 /repair。';
const CALLBACK_PROBE_SEND_FAILURE_NOTICE = '⚠️ 修复验证失败：无法发送专用测试卡，不能确认 card.action.trigger 已恢复。请不要重复授权；先检查机器人消息权限和连接状态。';
const CALLBACK_PROBE_ABORT_NOTICE = '⚠️ 修复验证中断：Runtime 已停止，未完成 card.action.trigger 实测，不能确认修复成功。请不要重复授权；先等待机器人恢复连接。';
const REUSABLE_WS_STATES = new Set(['connected', 'connecting', 'reconnecting']);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function strictCardOperatorOpenId(event) {
  return nonEmptyString(event?.operator?.open_id)
    ?? nonEmptyString(event?.operator?.operator_id?.open_id);
}

function websocketState(wsClient, fallback) {
  try {
    const state = wsClient?.getConnectionStatus?.()?.state;
    return typeof state === 'string' && state ? state : fallback;
  } catch {
    return fallback;
  }
}

function probeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function httpInstanceWithTimeout(httpInstance, timeoutMs) {
  if (!httpInstance || typeof httpInstance.request !== 'function') return undefined;
  const optionsWithTimeout = (options) => ({
    ...(options ?? {}),
    timeout: options?.timeout ?? timeoutMs,
  });
  return {
    request: (options) => httpInstance.request(optionsWithTimeout(options)),
    get: (url, options) => httpInstance.get(url, optionsWithTimeout(options)),
    delete: (url, options) => httpInstance.delete(url, optionsWithTimeout(options)),
    head: (url, options) => httpInstance.head(url, optionsWithTimeout(options)),
    options: (url, options) => httpInstance.options(url, optionsWithTimeout(options)),
    post: (url, data, options) => httpInstance.post(url, data, optionsWithTimeout(options)),
    put: (url, data, options) => httpInstance.put(url, data, optionsWithTimeout(options)),
    patch: (url, data, options) => httpInstance.patch(url, data, optionsWithTimeout(options)),
  };
}

export function createBridgeStatus({ allowedSenderCount = 1 } = {}) {
  return {
    startedAt: null,
    ready: false,
    feishuLongConnectionState: 'idle',
    harnessReachable: false,
    messagesReceived: 0,
    messagesReplied: 0,
    messagesRejected: 0,
    reactionsAdded: 0,
    reactionsRemoved: 0,
    reactionErrors: 0,
    streamResponses: 0,
    streamUpdates: 0,
    streamFallbacks: 0,
    streamErrors: 0,
    cardActionsReceived: 0,
    cardActionProbesVerified: 0,
    lastMessageAt: null,
    lastReplyAt: null,
    lastRejectedAt: null,
    lastCardActionAt: null,
    lastError: null,
    agentPreset: 'standard',
    authorizationMode: 'sender-open-id-allowlist',
    allowedSenderCount,
    slashCommandRegistration: 'idle',
    slashCommandsRegistered: 0,
    slashCommandsExisting: 0,
    slashCommandsFailed: 0,
    slashCommandsRemoved: 0,
    slashCommandsError: null,
  };
}

/**
 * Owns one live Feishu long connection and the already-tested bridge stack.
 * The class intentionally receives the SDK and Harness dependencies so the
 * plugin can run it in-process while tests exercise the lifecycle without a
 * real Feishu tenant.
 */
export class FeishuRuntime {
  #lark;
  #botId;
  #appId;
  #appSecret;
  #domain;
  #botOpenId;
  #groupResponseMode;
  #mentionTopicReply;
  #stepPush;
  #stepPushMode;
  #stepCardPanels;
  #voice = null;
  #sessionSyncTargetsFor;
  #ownerOpenIds;
  #harness;
  #state;
  #contextEnhancement;
  #groupHistory;
  #accessPolicy;
  #replyTimeoutMs;
  #connectTimeoutMs;
  #requestTimeoutMs;
  #wsAgent;
  #logger;
  #diagnostics;
  #repair;
  #client = null;
  #bridge = null;
  #consumerMode;
  #acceptExternal;
  #wsClient = null;
  #starting = null;
  #stopping = null;
  #abortController = null;
  #pendingCardActionProbes = new Map();
  #status;
  #slashCommands = true;
  /** Which commands the "/" panel should offer, and in which order. */
  #slashPanel = null;
  /** Capability-narrowed manifest (no /fork without fork, honest /tail). */
  #slashManifest = null;
  /** HTTP instance kept for panel re-syncs after startup. */
  #slashHttpInstance = null;
  /**
   * Bumped on every panel change: a sync started for an older config stops at
   * its next checkpoint instead of racing the newer one (last writer wins).
   */
  #slashSyncEpoch = 0;
  /** Cancels the panel sync in flight; it stops before its next request. */
  #slashSyncCancel = null;
  /** Panel syncs run one after another, so two plans never interleave. */
  #slashSyncQueue = Promise.resolve();

  constructor({
    lark,
    consumerMode = 'standalone',
    acceptExternal,
    botId,
    appId,
    appSecret,
    domain = 'feishu',
    botOpenId,
    groupResponseMode,
    mentionTopicReply = true,
    stepPush = false,
    stepPushMode = 'post',
    stepCardPanels,
    voice = null,
    sessionSyncTargetsFor = null,
    ownerOpenId,
    ownerOpenIds,
    harness,
    state,
    contextEnhancement,
    groupHistory,
    accessPolicy,
    repair,
    replyTimeoutMs = 600000,
    connectTimeoutMs = 15000,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    slashCommands = true,
    slashPanel = null,
    wsAgent,
    logger = console,
  }) {
    if (!lark) throw new Error('FeishuRuntime requires the Feishu SDK');
    if (!appId || !appSecret) throw new Error('FeishuRuntime requires app credentials');
    const allowedOwners = Array.isArray(ownerOpenIds) ? ownerOpenIds : [ownerOpenId];
    const normalizedOwners = [...new Set(allowedOwners.filter((value) => typeof value === 'string' && value))];
    if (normalizedOwners.length === 0) throw new Error('FeishuRuntime requires at least one owner open_id');
    if (!harness) throw new Error('FeishuRuntime requires a Harness client');
    if (!state) throw new Error('FeishuRuntime requires a state store');
    if (repair !== undefined && repair !== null && !nonEmptyString(botId)) {
      throw new TypeError('FeishuRuntime repair capability requires a botId');
    }
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new TypeError('FeishuRuntime requestTimeoutMs must be a positive number');
    }

    this.#consumerMode = consumerMode;
    this.#acceptExternal = acceptExternal;
    this.#lark = lark;
    this.#botId = nonEmptyString(botId);
    this.#appId = appId;
    this.#appSecret = appSecret;
    this.#domain = domain;
    this.#botOpenId = nonEmptyString(botOpenId);
    this.#groupResponseMode = normalizeFeishuGroupResponseMode(groupResponseMode);
    this.#mentionTopicReply = mentionTopicReply !== false;
    this.#stepPush = stepPush === true;
    this.#stepPushMode = normalizeFeishuStepPushMode(stepPushMode);
    this.#stepCardPanels = normalizeFeishuStepCardPanels(stepCardPanels);
    // voice 为 { config, secret } 来源;凭据缺失时 createVoice 返回禁用对象,
    // 桥接层完全跳过语音路径,不影响连接。
    this.#voice = voice == null
      ? null
      : createVoice({ settings: voice.config, secret: voice.secret, logger });
    this.#sessionSyncTargetsFor = typeof sessionSyncTargetsFor === 'function'
      ? sessionSyncTargetsFor
      : null;
    this.#ownerOpenIds = normalizedOwners;
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#groupHistory = groupHistory;
    this.#accessPolicy = accessPolicy;
    this.#repair = repair ?? null;
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#connectTimeoutMs = connectTimeoutMs;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#slashCommands = consumerMode !== 'external-consumer' && Boolean(slashCommands);
    this.#slashPanel = normalizeSlashPanelConfig(slashPanel);
    this.#slashManifest = feishuSlashManifest({
      supportsFork: typeof harness?.supportsSessionFork === 'function'
        ? harness.supportsSessionFork()
        : true,
      fileSend: channelCapabilities('feishu').fileSend,
    });
    this.#wsAgent = wsAgent;
    this.#logger = logger; this.#diagnostics = createConnectionDiagnostics({ channel: 'feishu', logger });
    this.#status = createBridgeStatus({ allowedSenderCount: normalizedOwners.length });
  }

  get status() {
    return structuredClone(this.#status);
  }

  setGroupResponseMode(value) {
    this.#groupResponseMode = normalizeFeishuGroupResponseMode(value);
    this.#bridge?.setGroupResponseMode(this.#groupResponseMode);
  }

  setMentionTopicReply(value) {
    this.#mentionTopicReply = value !== false;
    this.#bridge?.setMentionTopicReply(this.#mentionTopicReply);
  }

  setStepPush(value) {
    this.#stepPush = value === true;
    this.#bridge?.setStepPush(this.#stepPush);
  }

  setStepPushMode(value) {
    this.#stepPushMode = normalizeFeishuStepPushMode(value);
    this.#bridge?.setStepPushMode(this.#stepPushMode);
  }

  setStepCardPanels(value) {
    this.#stepCardPanels = normalizeFeishuStepCardPanels(value);
    this.#bridge?.setStepCardPanels(this.#stepCardPanels);
  }

  setVoice(source) {
    this.#voice = source == null
      ? null
      : createVoice({ settings: source.config, secret: source.secret, logger: this.#logger });
    this.#bridge?.setVoice(this.#voice);
  }

  /**
   * Record which commands the "/" panel should offer. The panel itself lives on
   * Feishu's side, so a connected bot re-syncs it in the background; the newer
   * config wins and any sync still running for the older one stops.
   */
  setSlashPanel(value) {
    this.#slashPanel = normalizeSlashPanelConfig(value);
    this.#slashSyncEpoch += 1;
    this.#scheduleSlashPanelSync();
  }

  async start() {
    while (true) {
      while (this.#stopping) await this.#stopping;
      if (this.#starting) return this.#starting;

      const wsClient = this.#wsClient;
      if (wsClient) {
        const state = websocketState(wsClient, this.#status.feishuLongConnectionState);
        if (REUSABLE_WS_STATES.has(state)) return this.status;

        await this.stop({ preserveError: state === 'failed' });
        continue;
      }

      // A partial/failed attempt may have created resources before its
      // WSClient became observable. Drain them before assigning a new attempt.
      if (this.#client || this.#bridge || this.#abortController) {
        await this.stop({
          preserveError: this.#status.feishuLongConnectionState === 'failed',
        });
        continue;
      }

      break;
    }

    let starting;
    starting = this.#start().finally(() => {
      if (this.#starting === starting) this.#starting = null;
    });
    this.#starting = starting;
    return starting;
  }

  async #start() {
    const abortController = new AbortController();
    this.#abortController = abortController;
    const { signal } = abortController;
    const abortError = () => (
      signal.reason ?? new DOMException('Feishu runtime stopped', 'AbortError')
    );
    const isCurrentStart = () => (
      !signal.aborted && this.#abortController === abortController
    );
    const assertCurrentStart = () => {
      if (!isCurrentStart()) throw abortError();
    };
    this.#status.startedAt = new Date().toISOString();
    this.#status.feishuLongConnectionState = 'connecting';
    this.#status.lastError = null; this.#status.error = null; this.#diagnostics.clear();

    try {
      await atConnectionStage('harness.check', () => this.#harness.ensureRunning({ signal }));
      assertCurrentStart();
      this.#status.harnessReachable = true;

      const sdkDomain = this.#domain === 'lark'
        ? this.#lark.Domain.Lark
        : this.#lark.Domain.Feishu;
      const larkConfig = {
        appId: this.#appId,
        appSecret: this.#appSecret,
        domain: sdkDomain,
      };
      const httpInstance = httpInstanceWithTimeout(
        this.#lark.defaultHttpInstance,
        this.#requestTimeoutMs,
      );
      if (httpInstance) larkConfig.httpInstance = httpInstance;
      const client = new this.#lark.Client(larkConfig);
      this.#client = client;
      const channel = new VerifiedFeishuChannel({
        client,
        initialText: t('已连接 DeepSeek Harness，正在思考…'),
      });
      const bridge = this.#consumerMode === 'external-consumer' ? null : new FeishuHarnessBridge({
        client,
        channel,
        harness: this.#harness,
        state: this.#state,
        contextEnhancement: this.#contextEnhancement,
      groupHistory: this.#groupHistory,
        groupHistoryScope: this.#domain,
        accessPolicy: this.#accessPolicy,
        status: this.#status,
        allowedSenderOpenIds: new Set(this.#ownerOpenIds),
        botId: this.#botId,
        appId: this.#appId,
        botOpenId: this.#botOpenId,
        groupResponseMode: this.#groupResponseMode,
        mentionTopicReply: this.#mentionTopicReply,
        stepPush: this.#stepPush,
        stepPushMode: this.#stepPushMode,
        stepCardPanels: this.#stepCardPanels,
        voice: this.#voice,
        nativeMenuReady: () => this.#status.slashCommandRegistration === 'done' && this.#status.slashCommandsFailed === 0,
        sessionSyncTargetsFor: this.#sessionSyncTargetsFor,
        repair: this.#repair,
        requestTimeoutMs: this.#requestTimeoutMs,
        replyTimeoutMs: this.#replyTimeoutMs,
        // Interaction cards (approval/question buttons) are on by default.
        // Set DSH_IM_INTERACTION_CARDS=0 to fall back to plain-text replies.
        interactionCards: !['0', 'false', 'no', 'off'].includes(
          String(process.env.DSH_IM_INTERACTION_CARDS ?? '').trim().toLowerCase(),
        ),
        signal,
        logger: this.#logger,
      });
      this.#bridge = bridge;

      const dispatcher = new this.#lark.EventDispatcher({}).register({
        'im.message.receive_v1': (event) => {
          if (this.#consumerMode === 'external-consumer') {
            assertCurrentStart();
            if (typeof this.#acceptExternal !== 'function')
              throw Object.assign(new Error('consumer-unavailable'), { code: 'consumer-unavailable' });
            return this.#acceptExternal(event, { signal });
          }
          if (isCurrentStart()) void bridge.accept(event);
        },
        'im.message.reaction.created_v1': () => undefined,
        'im.message.reaction.deleted_v1': () => undefined,
        // Interactive-card button callbacks (only delivered when the app
        // subscribes card.action.trigger; the number-reply fallback covers
        // apps that do not).
        'card.action.trigger': (event) => {
          if (!isCurrentStart() || this.#consumerMode === 'external-consumer') return;
          this.#status.cardActionsReceived += 1;
          this.#status.lastCardActionAt = new Date().toISOString();
          if (!this.#consumeCardActionProbe(event)) void bridge.onCardAction(event);
        },
      });

      let settleReady;
      let settleError;
      const ready = new Promise((resolve, reject) => {
        let settled = false;
        const onAbort = () => {
          settleError(abortError());
        };
        const settle = (callback, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          callback(value);
        };
        const timer = setTimeout(() => {
          settle(
            reject,
            new Error(`Feishu WebSocket handshake timed out after ${this.#connectTimeoutMs}ms`),
          );
        }, this.#connectTimeoutMs);
        settleReady = () => {
          settle(resolve);
        };
        settleError = (error) => {
          settle(reject, error);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      // The SDK constructor can throw before Promise.all attaches below.
      // Keep the abort-driven rejection observed in that path as well.
      void ready.catch(() => undefined);

      const wsClient = new this.#lark.WSClient({
        ...larkConfig,
        ...(this.#wsAgent ? { agent: this.#wsAgent } : {}),
        loggerLevel: this.#lark.LoggerLevel.info,
        handshakeTimeoutMs: this.#connectTimeoutMs,
        onReady: () => {
          if (!isCurrentStart()) return;
          this.#status.feishuLongConnectionState = 'connected';
          this.#status.ready = true;
          this.#status.lastError = null; this.#status.error = null; this.#diagnostics.clear();
          settleReady();
        },
        onError: (error) => {
          if (!isCurrentStart()) return;
          this.#status.feishuLongConnectionState = 'failed';
          this.#status.ready = false;
          this.#status.error = this.#diagnostics.report(error, { operation: 'connection.monitor', botId: this.#botId, automatic: true }).publicError;
          this.#status.lastError = this.#status.error.message;

          settleError(error);
        },
        onReconnecting: () => {
          if (!isCurrentStart()) return;
          this.#status.feishuLongConnectionState = 'reconnecting';
          this.#status.ready = false;
        },
        onReconnected: () => {
          if (!isCurrentStart()) return;
          this.#status.feishuLongConnectionState = 'connected';
          this.#status.ready = true;
          this.#status.lastError = null; this.#status.error = null; this.#diagnostics.clear();
        },
      });
      this.#wsClient = wsClient;
      const wsStarted = Promise.resolve()
        .then(() => wsClient.start({ eventDispatcher: dispatcher }))
        .catch((error) => {
          settleError(error);
          throw error;
        });
      await Promise.all([wsStarted, ready]);
      assertCurrentStart();
      // Register the native Slash Command panel best-effort and asynchronously
      // so it never blocks the long-connection startup. The panel is only a
      // client-side convenience; failure here must not take the bot down. The
      // HTTP instance is kept so a later panel change can re-sync while running.
      if (this.#slashCommands && httpInstance) {
        this.#slashHttpInstance = httpInstance;
        this.#scheduleSlashPanelSync();
      }
      return this.status;
    } catch (error) {
      // stop() owns the terminal idle state for an explicitly aborted start.
      // In particular, do not let the rejected handshake waiter overwrite it.
      if (signal.aborted) throw error;
      this.#status.ready = false;
      this.#status.feishuLongConnectionState = 'failed';
      this.#status.error = this.#diagnostics.report(error, { operation: 'connection.restore', reuse: true, botId: this.#botId, automatic: true }).publicError;
      this.#status.lastError = this.#status.error.message;
      await this.#cleanup({ preserveError: true, abortController });
      throw error;
    }
  }

  /**
   * Send a one-shot callback card and resolve only after Feishu delivers the
   * exact message/nonce/operator tuple over card.action.trigger. The controller
   * uses this as the final proof for both browser- and chat-initiated repairs.
   */
  async beginCardActionProbe({ expectedOperatorOpenId, timeoutMs = 90_000 } = {}) {
    if (!this.#status.ready || !this.#client) {
      throw probeError('card_action_probe_unavailable', '飞书机器人尚未连接');
    }
    const operatorOpenId = nonEmptyString(expectedOperatorOpenId);
    if (!operatorOpenId || operatorOpenId === '*') {
      throw new TypeError('A precise Feishu operator open_id is required');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10 * 60_000) {
      throw new TypeError('Card-action probe timeout must be between 1 and 600000ms');
    }

    const nonce = randomUUID().replaceAll('-', '');
    let response;
    try {
      response = await this.#client.im.v1.message.create({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: operatorOpenId,
          msg_type: 'interactive',
          content: cardActionProbeCard(nonce),
        },
      });
    } catch {
      void this.#sendCardActionProbeNotice(
        operatorOpenId,
        t(CALLBACK_PROBE_SEND_FAILURE_NOTICE),
        'failure',
      );
      throw probeError('card_action_probe_send_failed', '无法发送飞书卡片回调测试');
    }
    if (response?.code && response.code !== 0) {
      void this.#sendCardActionProbeNotice(
        operatorOpenId,
        t(CALLBACK_PROBE_SEND_FAILURE_NOTICE),
        'failure',
      );
      throw probeError('card_action_probe_send_failed', '无法发送飞书卡片回调测试');
    }
    const messageId = nonEmptyString(response?.data?.message_id)
      ?? nonEmptyString(response?.message_id);
    if (!messageId) {
      void this.#sendCardActionProbeNotice(
        operatorOpenId,
        t(CALLBACK_PROBE_SEND_FAILURE_NOTICE),
        'failure',
      );
      throw probeError('card_action_probe_send_failed', '飞书未返回测试卡片的消息 ID');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const current = this.#pendingCardActionProbes.get(messageId);
        if (!current || current.nonce !== nonce) return;
        this.#pendingCardActionProbes.delete(messageId);
        void this.#sendCardActionProbeNotice(
          operatorOpenId,
          t(CALLBACK_PROBE_TIMEOUT_NOTICE),
          'timeout',
        );
        reject(probeError(
          'card_action_probe_timeout',
          '在规定时间内未收到飞书卡片按钮回调',
        ));
      }, timeoutMs);
      timeout.unref?.();
      this.#pendingCardActionProbes.set(messageId, {
        messageId,
        nonce,
        expectedOperatorOpenId: operatorOpenId,
        timeout,
        resolve,
        reject,
      });
    });
  }

  #consumeCardActionProbe(event) {
    const messageId = nonEmptyString(event?.context?.open_message_id);
    if (!messageId) return false;
    const probe = this.#pendingCardActionProbes.get(messageId);
    if (!probe) return false;
    const value = event?.action?.value;
    const operatorOpenId = strictCardOperatorOpenId(event);
    if (value?.action !== 'repair_verify'
      || value?.nonce !== probe.nonce
      || operatorOpenId !== probe.expectedOperatorOpenId) {
      return false;
    }
    clearTimeout(probe.timeout);
    this.#pendingCardActionProbes.delete(messageId);
    this.#status.cardActionProbesVerified += 1;
    // Start the terminal notification before resolving the controller-facing
    // probe. A repair may rotate the App Secret and immediately replace this
    // runtime after resolution; initiating the send here keeps chat and web
    // repair flows equally observable. Notification failure never invalidates
    // the callback proof itself.
    void this.#sendCardActionProbeNotice(
      operatorOpenId,
      t(CALLBACK_PROBE_SUCCESS_NOTICE),
      'success',
    ).finally(() => {
      probe.resolve({
        verified: true,
        messageId,
        operatorOpenId,
      });
    });
    return true;
  }

  #sendCardActionProbeNotice(operatorOpenId, text, outcome) {
    const client = this.#client;
    if (!client) {
      this.#logger.warn?.(`[dsh-feishu] unable to send the callback repair ${outcome} notice`);
      return Promise.resolve(false);
    }
    return Promise.resolve().then(async () => {
      const response = await client.im.v1.message.create({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: operatorOpenId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
      if (response?.code && response.code !== 0) {
        throw new Error('Feishu callback repair notice failed');
      }
      return true;
    }).catch(() => {
      this.#logger.warn?.(`[dsh-feishu] unable to send the callback repair ${outcome} notice`);
      return false;
    });
  }

  async sendConnectionTest(text) {
    if (!this.#status.ready || !this.#client) {
      const error = new Error('飞书机器人尚未连接');
      error.code = 'test-target-unavailable';
      throw error;
    }
    if (typeof text !== 'string' || !text.trim()) {
      throw new TypeError('Feishu connection test text is required');
    }
    const send = async (receiveIdType, receiveId, content) => {
      const response = await this.#client.im.v1.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: receiveId,
          msg_type: 'text',
          content: JSON.stringify({ text: content }),
        },
      });
      if (response?.code && response.code !== 0) {
        throw new Error(`Feishu connection test failed: ${response.msg || response.code}`);
      }
    };

    const ownerOpenId = this.#ownerOpenIds.find((value) => value !== '*');
    if (ownerOpenId) {
      await send('open_id', ownerOpenId, text);
      return { sent: true };
    }

    return sendRememberedConnectionTest({
      state: this.#state,
      text,
      channelLabel: t('飞书机器人'),
      send: async (target, content) => {
        const chatId = typeof target?.chatId === 'string' ? target.chatId.trim() : '';
        if (!chatId) throw connectionTestTargetUnavailable(t('飞书机器人'));
        await send('chat_id', chatId, content);
      },
    });
  }

  async presentSessionSyncApproval(target, interaction, options = {}) {
    if (!this.#status.ready || !this.#bridge) return false;
    const actor = typeof target?.route?.openId === 'string' ? target.route.openId.trim() : '';
    if (!actor) return false;
    return this.#bridge.presentSessionSyncApproval(interaction, {
      key: options.key, actor, validate: options.validate,
      chatId: actor, receiveIdType: 'open_id',
      send: (text) => this.sendProactiveText(target, text),
    }, options);
  }

  async presentSessionSyncQuestion(target, interaction, options = {}) {
    if (!this.#status.ready || !this.#bridge || target?.kind !== 'user') return false;
    const actor = nonEmptyString(target.route?.openId);
    if (!actor) return false;
    return this.#bridge.presentSessionSyncQuestion(interaction, {
      key: options.key, actor, validate: options.validate,
      chatId: actor, receiveIdType: 'open_id', requiresMention: false,
    }, options);
  }

  async sendProactiveText(target, text, { signal, format = 'plain', receipt = false } = {}) {
    if (!this.#status.ready || !this.#client) {
      const error = new Error('飞书机器人尚未连接');
      error.code = 'bot-not-connected';
      throw error;
    }
    const receiveIdType = target?.kind === 'user' ? 'open_id'
      : target?.kind === 'group' ? 'chat_id' : null;
    const receiveId = target?.kind === 'user'
      ? nonEmptyString(target?.route?.openId)
      : target?.kind === 'group'
        ? nonEmptyString(target?.route?.chatId)
        : null;
    if (!receiveIdType || !receiveId) {
      const error = new TypeError('Invalid Feishu proactive delivery target');
      error.code = 'invalid-target';
      throw error;
    }
    if (format !== 'plain' && format !== 'markdown') {
      const error = new TypeError('Message format must be plain or markdown');
      error.code = 'bad-request';
      throw error;
    }
    if (typeof receipt !== 'boolean' || (receipt && target.kind !== 'group'))
      throw Object.assign(new Error('capability-unavailable'), { code: 'capability-unavailable' });
    signal?.throwIfAborted();
    // Use the same native Markdown element as chat, without opening a stream
    // or retrying as plain text after a possibly accepted delivery.
    const content = format === 'markdown'
      ? { schema: '2.0', body: { elements: [{ tag: 'markdown', content: text }] } }
      : { text };
    const activeSignal = signal
      ? AbortSignal.any([signal, this.#abortController.signal])
      : this.#abortController.signal;
    const response = await waitForFeishuOperation(() => this.#client.im.v1.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: receiveId,
        msg_type: format === 'markdown' ? 'interactive' : 'text',
        content: JSON.stringify(content),
      },
    }), {
      signal: activeSignal,
      timeoutMs: this.#requestTimeoutMs,
      stage: `proactive text send (${this.#requestTimeoutMs}ms)`,
    });
    if (response?.code && response.code !== 0) {
      const error = new Error(`Feishu proactive delivery failed: ${response.msg || response.code}`);
      error.code = 'target-rejected';
      throw error;
    }
    if (!receipt) return { sent: true };
    const messageId = response?.data?.message_id;
    const conversationId = response?.data?.chat_id;
    if (typeof messageId !== 'string' || !messageId || messageId.length > 512 || conversationId !== receiveId)
      throw Object.assign(new Error('send-result-unknown'), { code: 'send-result-unknown' });
    return { sent: true, receipt: { version: 1, messageId, conversationId } };
  }

  async historyChecked(identity, route, query, { signal } = {}) {
    const client = this.#client;
    if (!client || this.#consumerMode !== 'external-consumer')
      throw Object.assign(new Error('bot-not-connected'), { code: 'bot-not-connected' });
    const result = await readExternalHistory(client, identity, route, query, signal);
    signal?.throwIfAborted();
    if (this.#client !== client)
      throw Object.assign(new Error('bot-not-connected'), { code: 'bot-not-connected' });
    return result;
  }

  async replyChecked(route, text, { signal } = {}) {
    if (!route || typeof route.messageId !== 'string' || typeof route.conversationId !== 'string'
      || typeof route.actorId !== 'string' || typeof text !== 'string' || !text.trim() || text.length > 4000)
      throw Object.assign(new Error('bad-request'), { code: 'bad-request' });
    const client = this.#client;
    if (!client || this.#consumerMode !== 'external-consumer')
      throw Object.assign(new Error('bot-not-connected'), { code: 'bot-not-connected' });
    signal?.throwIfAborted();
    const current = await client.im.v1.message.get({ path: { message_id: route.messageId } });
    const source = current?.data?.items?.find(item => item.message_id === route.messageId);
    if (current?.code || !source || source.deleted === true || source.chat_id !== route.conversationId
      || source.sender?.sender_type !== 'user' || source.sender?.id_type !== 'open_id'
      || source.sender?.id !== route.actorId || (source.thread_id || undefined) !== route.threadId
      || (source.root_id || undefined) !== route.rootId || (source.parent_id || undefined) !== route.parentId)
      throw Object.assign(new Error('stale-route'), { code: 'stale-route' });
    signal?.throwIfAborted();
    if (this.#client !== client) throw Object.assign(new Error('bot-not-connected'), { code: 'bot-not-connected' });
    let response;
    try {
      response = await client.im.v1.message.reply({
        path: { message_id: route.messageId },
        data: { msg_type: 'text', content: JSON.stringify({ text }), reply_in_thread: Boolean(route.threadId) },
      });
    } catch (cause) {
      // The request may have reached Lark. Do not turn an ambiguous result into
      // a retryable pre-send failure or send again on the group mainline.
      throw Object.assign(new Error('reply-result-unknown', { cause }), { code: 'reply-result-unknown' });
    }
    const messageId = response?.data?.message_id;
    if (response?.code || typeof messageId !== 'string' || !messageId)
      throw Object.assign(new Error('reply-result-unknown'), { code: 'reply-result-unknown' });
    return { sent: true, messageId };
  }

  /**
   * Queue one panel sync for the current config.
   *
   * Two saves in a row used to run two syncs concurrently, and the older one
   * kept deleting and creating commands from a plan nobody wanted anymore. Here
   * the run in flight is cancelled first — it stops at its next checkpoint while
   * requests already sent are left to finish — and the new run starts only once
   * it has settled, so the panel converges to the newest config.
   */
  #scheduleSlashPanelSync() {
    const httpInstance = this.#slashHttpInstance;
    const connectionSignal = this.#abortController?.signal;
    if (!this.#slashCommands || !httpInstance || !connectionSignal || connectionSignal.aborted) return;
    const epoch = this.#slashSyncEpoch;
    this.#slashSyncCancel?.();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const forwardAbort = () => cancel();
    this.#slashSyncCancel = cancel;
    connectionSignal.addEventListener('abort', forwardAbort, { once: true });
    if (connectionSignal.aborted) cancel();
    const run = this.#slashSyncQueue.then(() => this.#registerSlashCommands(
      httpInstance,
      () => !connectionSignal.aborted && this.#abortController?.signal === connectionSignal,
      controller.signal,
      epoch,
    ));
    const settled = run.then(() => {}, () => {});
    this.#slashSyncQueue = settled;
    void settled.then(() => {
      connectionSignal.removeEventListener('abort', forwardAbort);
      if (this.#slashSyncCancel === cancel) this.#slashSyncCancel = null;
    });
  }

  async #registerSlashCommands(httpInstance, isCurrentStart, signal, epoch = this.#slashSyncEpoch) {
    this.#status.slashCommandRegistration = 'registering';
    this.#status.slashCommandsError = null;
    try {
      const result = await syncSlashCommands({
        appId: this.#appId,
        appSecret: this.#appSecret,
        domain: this.#domain,
        httpInstance,
        signal,
        manifest: this.#slashManifest,
        config: this.#slashPanel,
      });
      // A newer panel config took over while this sync was running: its own run
      // reports the outcome, so this one only stops.
      if (!isCurrentStart() || epoch !== this.#slashSyncEpoch || result.superseded === true) return;
      this.#status.slashCommandRegistration = 'done';
      this.#status.slashCommandsRegistered = result.created.length;
      this.#status.slashCommandsExisting = result.existing.length;
      this.#status.slashCommandsFailed = result.failed.length;
      this.#status.slashCommandsRemoved = result.deleted.length;
      this.#status.slashCommandsError = result.failed.length > 0
        ? result.failed.map((f) => `/${f.command}: ${f.error?.message ?? String(f.error)}`).join('; ')
        : null;
      if (result.created.length > 0 || result.deleted.length > 0) {
        this.#logger.info?.(
          `[dsh-feishu] slash panel synced: ${result.created.length} added, ${result.deleted.length} removed`,
        );
      }
      if (result.failed.length > 0) {
        this.#logger.warn?.(
          `[dsh-feishu] ${result.failed.length} slash command(s) failed to register: ${this.#status.slashCommandsError}`,
        );
      }
    } catch (error) {
      if (!isCurrentStart()) return;
      this.#status.slashCommandRegistration = 'failed';
      this.#status.slashCommandsError = error?.message ?? String(error);
      this.#logger.warn?.(
        `[dsh-feishu] slash command registration skipped: ${this.#status.slashCommandsError}`,
      );
    }
  }

  stop(options = {}) {
    if (this.#stopping) return this.#stopping;

    let stopping;
    stopping = this.#stop(options).finally(() => {
      if (this.#stopping === stopping) this.#stopping = null;
    });
    this.#stopping = stopping;
    return stopping;
  }

  async #stop({ preserveError = false } = {}) {
    const abortController = this.#abortController;
    if (this.#abortController === abortController) this.#abortController = null;
    abortController?.abort(new DOMException('Feishu runtime stopped', 'AbortError'));

    const starting = this.#starting;
    if (starting) await starting.catch(() => undefined);
    return this.#cleanup({ preserveError, abortController });
  }

  async #cleanup({ preserveError = false, abortController } = {}) {
    const error = preserveError ? this.#status.lastError : null;
    const diagnostic = preserveError ? this.#status.error : null;
    if (this.#abortController === abortController) this.#abortController = null;
    abortController?.abort(new DOMException('Feishu runtime stopped', 'AbortError'));
    for (const probe of this.#pendingCardActionProbes.values()) {
      clearTimeout(probe.timeout);
      void this.#sendCardActionProbeNotice(
        probe.expectedOperatorOpenId,
        t(CALLBACK_PROBE_ABORT_NOTICE),
        'abort',
      );
      probe.reject(probeError('abort', '飞书运行时已停止'));
    }
    this.#pendingCardActionProbes.clear();
    this.#status.ready = false;
    const wsClient = this.#wsClient;
    this.#wsClient = null;
    wsClient?.close({ force: true });
    const bridge = this.#bridge;
    this.#bridge = null;
    let timer;
    try {
      const idle = await Promise.race([
        (bridge?.waitForIdle() ?? Promise.resolve()).then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), 2_000);
          timer.unref?.();
        }),
      ]);
      if (!idle) this.#logger.warn?.('[dsh-feishu] bridge idle wait timed out after 2000ms; continuing cleanup');
    } finally {
      clearTimeout(timer);
    }
    this.#client = null;
    this.#status.feishuLongConnectionState = preserveError ? 'failed' : 'idle';
    this.#status.slashCommandRegistration = 'idle';
    this.#status.error = diagnostic;
    this.#status.lastError = error;
    if (!preserveError) this.#diagnostics.clear();
    return this.status;
  }
}
