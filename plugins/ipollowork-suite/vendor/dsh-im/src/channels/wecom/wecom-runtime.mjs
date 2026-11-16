import { createConnectionDiagnostics, atConnectionStage } from '../shared/connection-error.mjs';
import { WSAuthFailureError, WSClient, WSReconnectExhaustedError } from '@wecom/aibot-node-sdk';

import { createWecomBridgeStatus, WecomHarnessBridge } from './wecom-bridge.mjs';
import { sendRememberedConnectionTest } from '../shared/connection-test.mjs';
import { t } from '../shared/i18n.mjs';
import { chunkMarkdownText } from '../shared/markdown-chunks.mjs';

function timeoutError() {
  const error = new Error('Enterprise WeChat WebSocket authentication timed out');
  error.code = 'connect-timeout';
  return error;
}

export function createWecomRuntimeStatus() {
  return {
    startedAt: null,
    ready: false,
    wecomConnectionState: 'idle',
    harnessReachable: false,
    lastCheckedAt: null,
    lastConnectedAt: null,
    lastError: null,
    ...createWecomBridgeStatus(),
  };
}

export class WecomRuntime {
  #config;
  #secret;
  #harness;
  #state;
  #contextEnhancement;
  #accessPolicy;
  #logger;
  #diagnostics;
  #replyTimeoutMs;
  #streamRotateAfterMs;
  #streamSilentProbeMs;
  #connectTimeoutMs;
  #maxReconnectAttempts;
  #createClient;
  #createBridge;
  #status = createWecomRuntimeStatus();
  #client = null;
  #bridge = null;
  #starting = null;
  #startController = null;
  #runtimeController = null;

  constructor({
    config,
    secret,
    harness,
    state,
    contextEnhancement,
    accessPolicy,
    logger = console,
    replyTimeoutMs = 600_000,
    streamRotateAfterMs = 510_000,
    streamSilentProbeMs = 120_000,
    connectTimeoutMs = 20_000,
    maxReconnectAttempts = 10,
    createClient = (options) => new WSClient(options),
    createBridge = (options) => new WecomHarnessBridge(options),
  }) {
    if (!config || !secret || !harness || !state) {
      throw new TypeError('WecomRuntime requires config, secret, Harness, and state');
    }
    this.#config = config;
    this.#secret = secret;
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#accessPolicy = accessPolicy;
    this.#logger = logger; this.#diagnostics = createConnectionDiagnostics({ channel: 'wecom', logger });
    this.#createBridge = createBridge;
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#streamRotateAfterMs = streamRotateAfterMs;
    this.#streamSilentProbeMs = streamSilentProbeMs;
    this.#connectTimeoutMs = connectTimeoutMs;
    this.#maxReconnectAttempts = maxReconnectAttempts;
    this.#createClient = createClient;
  }

  get status() {
    return structuredClone(this.#status);
  }

  async start() {
    if (this.#status.ready && this.#client) return this.status;
    if (this.#starting) return this.#starting;
    this.#runtimeController?.abort(new DOMException('Enterprise WeChat runtime replaced', 'AbortError'));
    const controller = new AbortController();
    this.#startController = controller;
    this.#runtimeController = controller;
    this.#starting = this.#start(controller.signal).finally(() => {
      if (this.#startController === controller) this.#startController = null;
      this.#starting = null;
    });
    return this.#starting;
  }

  async #start(signal) {
    await this.#stopActive();
    signal.throwIfAborted();
    this.#status.startedAt = new Date().toISOString();
    this.#status.wecomConnectionState = 'connecting';
    this.#status.lastError = null; this.#status.error = null; this.#diagnostics.clear();
    await atConnectionStage('harness.check', () => this.#harness.ensureRunning());
    this.#status.harnessReachable = true;

    // The SDK's own logger reports reply ack errors (errcode/errmsg) that are
    // invisible otherwise; keep debug/info quiet but surface warn/error.
    const silentSdkLogger = {
      debug() {},
      info() {},
      warn: (...args) => this.#logger.warn?.('[dsh-im:wecom-sdk]', ...args),
      error: (...args) => this.#logger.error?.('[dsh-im:wecom-sdk]', ...args),
    };
    const client = this.#createClient({
      botId: this.#config.remoteBotId,
      secret: this.#secret,
      logger: silentSdkLogger,
      maxReconnectAttempts: this.#maxReconnectAttempts,
    });
    if (!client || typeof client.connect !== 'function' || typeof client.disconnect !== 'function') {
      throw new TypeError('Enterprise WeChat client factory returned an invalid client');
    }
    this.#client = client;
    this.#bridge = this.#createBridge({
      client,
      harness: this.#harness,
      state: this.#state,
      contextEnhancement: this.#contextEnhancement,
      accessPolicy: this.#accessPolicy,
      status: this.#status,
      logger: this.#logger,
      replyTimeoutMs: this.#replyTimeoutMs,
      streamRotateAfterMs: this.#streamRotateAfterMs,
      streamSilentProbeMs: this.#streamSilentProbeMs,
      signal,
    });

    let readyResolve;
    let readyReject;
    let authenticated = false;
    const ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const onAuthenticated = () => {
      if (this.#client !== client || signal.aborted) return;
      authenticated = true;
      const now = Date.now();
      this.#status.ready = true;
      this.#status.wecomConnectionState = 'connected';
      this.#status.lastCheckedAt = now;
      this.#status.lastConnectedAt = now;
      this.#status.lastError = null; this.#status.error = null; this.#diagnostics.clear();
      readyResolve();
    };
    const onDisconnected = () => {
      if (this.#client !== client) return;
      this.#status.ready = false;
      this.#status.wecomConnectionState = 'connecting';
      this.#status.lastCheckedAt = Date.now();
    };
    const onReconnecting = () => {
      if (this.#client !== client) return;
      this.#status.ready = false;
      this.#status.wecomConnectionState = 'connecting';
      this.#status.lastCheckedAt = Date.now();
    };
    const onError = (error) => {
      if (this.#client !== client) return;
      const terminal = error instanceof WSAuthFailureError || error instanceof WSReconnectExhaustedError;
      if (!authenticated && terminal) readyReject(error);
      if (terminal) {
        this.#status.ready = false;
        this.#status.wecomConnectionState = 'failed';
      }
      this.#status.error = this.#diagnostics.report(error, { operation: 'connection.monitor', botId: this.#config?.botId, automatic: true }).publicError;
      this.#status.lastError = this.#status.error.message;
      this.#logger.warn?.(`[dsh-im:wecom] bot ${this.#config.botId} connection error`);
    };
    const onMessage = (frame) => this.#bridge?.accept(frame);
    client.on('authenticated', onAuthenticated);
    client.on('disconnected', onDisconnected);
    client.on('reconnecting', onReconnecting);
    client.on('error', onError);
    client.on('message', onMessage);
    client.on('event.enter_chat', (frame) => this.#bridge?.acceptEvent(frame));
    client.on('event.template_card_event', (frame) => this.#bridge?.acceptEvent(frame));

    let timer;
    try {
      client.connect();
      await Promise.race([
        ready,
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(timeoutError()), this.#connectTimeoutMs);
        }),
      ]);
      return this.status;
    } catch (error) {
      if (signal.aborted) {
        await this.#stopActive();
        throw error;
      }
      this.#status.ready = false;
      this.#status.wecomConnectionState = 'failed';
      this.#status.error = this.#diagnostics.report(error, { operation: 'connection.monitor', botId: this.#config?.botId, automatic: true }).publicError;
      this.#status.lastError = this.#status.error.message;
      await this.#stopActive();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async stop() {
    const starting = this.#starting;
    this.#startController?.abort(new DOMException('Enterprise WeChat runtime stopped', 'AbortError'));
    this.#runtimeController?.abort(new DOMException('Enterprise WeChat runtime stopped', 'AbortError'));
    this.#runtimeController = null;
    await this.#stopActive();
    await starting?.catch(() => undefined);
    return this.status;
  }

  async sendConnectionTest(text) {
    return sendRememberedConnectionTest({
      state: this.#state,
      text,
      channelLabel: t('企业微信机器人'),
      send: async ({ chatId }, content) => {
        if (!this.#status.ready || !this.#client) {
          throw new Error('Enterprise WeChat runtime is not connected');
        }
        await this.#client.sendMessage(chatId, {
          msgtype: 'markdown',
          markdown: { content },
        });
      },
    });
  }

  async presentSessionSyncApproval(target, interaction, options = {}) {
    if (!this.#status.ready || !this.#bridge) return false;
    const actor = typeof target?.route?.chatId === 'string' ? target.route.chatId.trim() : '';
    if (!actor) return false;
    return this.#bridge.presentSessionSyncApproval(interaction, {
      key: options.key, actor, validate: options.validate,
      send: (text) => this.sendProactiveText(target, text),
    }, options);
  }

  async sendProactiveText(target, text, { signal, format = 'plain' } = {}) {
    const chatId = typeof target?.route?.chatId === 'string'
      ? target.route.chatId.trim() : '';
    if ((target?.kind !== 'user' && target?.kind !== 'group') || !chatId) {
      const error = new TypeError('Invalid Enterprise WeChat proactive delivery target');
      error.code = 'invalid-target';
      throw error;
    }
    if (!this.#status.ready || !this.#client) {
      const error = new Error('Enterprise WeChat runtime is not connected');
      error.code = 'bot-not-connected';
      throw error;
    }
    signal?.throwIfAborted();
    // At most three UTF-8 bytes per UTF-16 unit: stay within the existing
    // bridge's 18,000-byte budget while keeping Markdown structures intact.
    const chunks = format === 'markdown' ? chunkMarkdownText(text, 6_000) : [text];
    for (const content of chunks) {
      signal?.throwIfAborted();
      await this.#client.sendMessage(chatId, {
        msgtype: 'markdown', markdown: { content },
      });
    }
    return { sent: true };
  }

  async #stopActive() {
    const client = this.#client;
    const bridge = this.#bridge;
    this.#client = null;
    this.#bridge = null;
    try {
      client?.disconnect();
      client?.removeAllListeners?.();
    } catch (error) {
      this.#logger.warn?.(`[dsh-im:wecom] bot ${this.#config.botId} failed to stop cleanly`);
    }
    await bridge?.waitForIdle();
    this.#status.ready = false;
    this.#status.wecomConnectionState = 'idle';
  }
}
