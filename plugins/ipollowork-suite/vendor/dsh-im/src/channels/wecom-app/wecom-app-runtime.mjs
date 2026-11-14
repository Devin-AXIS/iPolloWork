import { atConnectionStage } from '../shared/connection-error.mjs';
import {
  WecomAppApi,
  WecomAppError,
  createUserCrypto,
  splitUtf8ByBytes,
} from './wecom-app-api.mjs';
import { WecomAppBridge } from './wecom-app-bridge.mjs';
import { sendRememberedConnectionTest } from '../shared/connection-test.mjs';
import { t } from '../shared/i18n.mjs';
import { syncWecomAppMenu } from './menu.mjs';

function timeoutError(message) {
  const error = new Error(message);
  error.code = 'connect-timeout';
  return error;
}

export function createWecomAppRuntimeStatus() {
  return {
    startedAt: null,
    ready: false,
    wecomAppConnectionState: 'idle',
    harnessReachable: false,
    lastCheckedAt: null,
    lastConnectedAt: null,
    lastError: null,
    messagesReceived: 0,
    messagesReplied: 0,
    lastMessageAt: null,
    lastReplyAt: null,
    menuRegistration: 'idle',
  };
}

// One runtime per bound self-built application. Unlike the WeCom smart-robot
// channel there is no outbound WebSocket: the runtime registers a callback
// route on the shared WecomAppCallbackServer and replies either passively
// (stream) or through the cgi-bin message/send API.
export class WecomAppRuntime {
  #config;
  #secrets;
  #harness;
  #state;
  #contextEnhancement;
  #accessPolicy;
  #logger;
  #callbackServer;
  #replyTimeoutMs;
  #streamEnabled;
  #status = createWecomAppRuntimeStatus();
  #api = null;
  #bridge = null;
  #started = false;
  #controller = new AbortController();

  constructor({
    config,
    secrets,
    harness,
    state,
    contextEnhancement,
    accessPolicy,
    logger = console,
    callbackServer,
    replyTimeoutMs = 600_000,
  }) {
    if (!config || !secrets || !harness || !state) {
      throw new TypeError('WecomAppRuntime requires config, secrets, Harness, and state');
    }
    if (!callbackServer || typeof callbackServer.registerRoute !== 'function') {
      throw new TypeError('WecomAppRuntime requires the shared WecomAppCallbackServer');
    }
    this.#config = config;
    this.#secrets = secrets;
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#accessPolicy = accessPolicy;
    this.#logger = logger;
    this.#callbackServer = callbackServer;
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#streamEnabled = config.streamEnabled !== false;
  }

  get status() {
    return structuredClone(this.#status);
  }

  get streamEnabled() {
    return this.#streamEnabled;
  }

  setStreamEnabled(enabled) {
    this.#streamEnabled = enabled === true;
  }

  async start() {
    if (this.#started) return this.status;
    const corpSecret = this.#secrets.corpSecret;
    const token = this.#secrets.token;
    const encodingAESKey = this.#secrets.encodingAESKey;
    if (!corpSecret || !token || !encodingAESKey) {
      this.#status.lastError = 'missing-credentials';
      throw new WecomAppError('missing-credentials', t('企业微信应用凭据不完整，请重新绑定。'));
    }
    this.#status.startedAt = new Date().toISOString();
    this.#status.lastError = null;
    this.#status.wecomAppConnectionState = 'connecting';
    await atConnectionStage('harness.check', () => this.#harness.ensureRunning({ signal: this.#signal() }));
    this.#status.harnessReachable = true;

    this.#api = new WecomAppApi({
      corpId: this.#config.corpId,
      corpSecret,
      agentId: this.#config.agentId,
      apiBaseUrl: this.#config.apiBaseUrl,
      logger: this.#logger,
      signal: undefined,
    });
    this.#bridge = new WecomAppBridge({
      api: this.#api,
      harness: this.#harness,
      state: this.#state,
      status: this.#status,
      contextEnhancement: this.#contextEnhancement,
      accessPolicy: this.#accessPolicy,
      logger: this.#logger,
      replyTimeoutMs: this.#replyTimeoutMs,
      signal: this.#signal(),
      streamRegistry: this.#callbackServer,
      nativeMenuReady: () => this.#status.menuRegistration === 'registered',
    });
    await this.#callbackServer.registerRoute({
      botId: this.#config.botId,
      callbackSecret: this.#config.callbackSecret,
      cryptoFor: () => createUserCrypto({
        token,
        encodingAESKey,
        corpId: this.#config.corpId,
      }),
      streamEnabled: () => this.#streamEnabled,
      onInbound: async ({ kind, message, stream }) => {
        if (kind === 'event') {
          await this.#bridge.acceptEvent(message);
          return;
        }
        const sink = stream
          ? {
              streamId: stream.streamId,
              append: (chunk, options) => this.#callbackServer.appendStream(stream.streamId, chunk, options),
              finish: (error) => this.#callbackServer.finishStream(stream.streamId, { error }),
              refreshes: () => this.#callbackServer.getStream(stream.streamId)?.refreshes ?? 0,
              finished: () => this.#callbackServer.getStream(stream.streamId)?.finished === true,
            }
          : null;
        await this.#bridge.accept(message, { sink });
      },
    });
    this.#started = true;
    const now = Date.now();
    this.#status.ready = true;
    this.#status.wecomAppConnectionState = 'connected';
    this.#status.lastCheckedAt = now;
    this.#status.lastConnectedAt = now;
    this.#status.menuRegistration = 'registering';
    try {
      this.#status.menuRegistration = await syncWecomAppMenu(this.#api, this.#signal());
    } catch (error) {
      if (this.#signal().aborted) throw error;
      this.#status.menuRegistration = 'failed';
      this.#logger.warn?.('[ipollo-im:wecom-app] Native menu unavailable; first-chat guidance remains available.');
    }
    return this.status;
  }

  async stop() {
    this.#controller.abort(new DOMException('WecomAppRuntime stopped', 'AbortError'));
    if (this.#bridge) {
      await this.#bridge.close().catch((error) => {
        this.#logger.warn?.('[dsh-im:wecom-app] bridge stop failed:', error);
      });
    }
    this.#bridge = null;
    this.#api = null;
    this.#callbackServer.unregisterRoute(this.#config.botId);
    this.#started = false;
    this.#status.ready = false;
    this.#status.wecomAppConnectionState = 'idle';
    return this.status;
  }

  async sendConnectionTest(text) {
    return sendRememberedConnectionTest({
      state: this.#state,
      text,
      channelLabel: t('企业微信应用'),
      send: async ({ toUserId }, content) => {
        if (!this.#started || !this.#api) {
          throw new WecomAppError('not-connected', 'Enterprise WeChat app runtime is not connected');
        }
        await this.#api.sendText({ userId: toUserId, content });
      },
    });
  }

  async presentSessionSyncApproval(target, interaction, options = {}) {
    if (!this.#started || !this.#bridge) return false;
    const actor = typeof target?.route?.chatId === 'string' ? target.route.chatId.trim() : '';
    if (!actor) return false;
    return this.#bridge.presentSessionSyncApproval(interaction, {
      key: options.key, actor, validate: options.validate,
      send: (text) => this.sendProactiveText(target, text),
    }, options);
  }

  async sendProactiveText(target, text, { signal } = {}) {
    const chatId = typeof target?.route?.chatId === 'string' ? target.route.chatId.trim() : '';
    if ((target?.kind !== 'user') || !chatId) {
      const error = new TypeError('Invalid Enterprise WeChat app proactive delivery target');
      error.code = 'invalid-target';
      throw error;
    }
    if (!this.#started || !this.#api) {
      const error = new WecomAppError('bot-not-connected', 'Enterprise WeChat app runtime is not connected');
      error.code = 'bot-not-connected';
      throw error;
    }
    signal?.throwIfAborted();
    const chunks = splitUtf8ByBytes(text);
    for (const chunk of chunks) {
      if (!chunk) continue;
      await this.#api.sendText({ userId: chatId, content: chunk, signal });
    }
    return { sent: true };
  }

  #signal() {
    // Each start() gets a fresh controller; stop() aborts the latest one.
    if (this.#controller.signal.aborted) this.#controller = new AbortController();
    return this.#controller.signal;
  }
}
