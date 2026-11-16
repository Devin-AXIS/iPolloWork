import { createWeixinDiagnostics } from './connection-error.mjs';
import { DEFAULT_WEIXIN_MAX_MESSAGE_CHARS, WeixinApiError, rejectedProviderResponse, splitWeixinText } from './weixin-api.mjs';
import { chunkMarkdownText } from '../shared/markdown-chunks.mjs';
import {
  createWeixinBridgeStatus, WeixinHarnessBridge, weixinSendError, weixinSendFailureOptions,
} from './weixin-bridge.mjs';
import { providerMessageIdsFor } from '../shared/semantic/delivery.mjs';
import {
  channelDeliveryFailure, clearLastMessageFailure, setLastMessageFailure,
} from '../shared/message-failure.mjs';
import {
  connectionTestTarget,
  connectionTestTargetUnavailable,
} from '../shared/connection-test.mjs';
import { t } from '../shared/i18n.mjs';

const DEFAULT_START_RETRY_DELAYS_MS = Object.freeze([250, 1_000, 3_000]);
const HARNESS_HEALTH_ERROR_CODES = new Set([
  'harness-connect-failed',
  'harness-timeout',
  'harness-auth-required',
  'harness-proxy-auth-required',
  'harness-loopback-forbidden',
  'harness-host-untrusted',
  'harness-request-forbidden',
  'harness-api-not-found',
  'harness-http-failed',
  'harness-response-invalid',
  'harness-rpc-rejected',
]);

function startRetryDelays(value) {
  if (value === undefined) return [...DEFAULT_START_RETRY_DELAYS_MS];
  if (!Array.isArray(value)) throw new TypeError('startRetryDelaysMs must be an array');
  return value.map((wait) => {
    if (!Number.isFinite(wait) || wait < 0) {
      throw new TypeError('startRetryDelaysMs must contain non-negative delays');
    }
    return wait;
  });
}

function retryableStartError(error) {
  if (!(error instanceof WeixinApiError)) return false;
  if (error.code === 'network-error' || error.code === 'timeout') return true;
  return error.code === 'http-error'
    && (error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500);
}

function runtimeStartError(code, cause) {
  const error = new Error(`Weixin runtime failed during ${code}`, { cause });
  error.name = 'WeixinRuntimeStartError';
  error.code = code;
  return error;
}

function harnessHealthError(cause) {
  const code = HARNESS_HEALTH_ERROR_CODES.has(cause?.code)
    ? cause.code
    : 'harness-check-unknown-failed';
  return runtimeStartError(code, cause);
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const finish = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function orderWeixinMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return Array.isArray(messages) ? messages : [];
  const orderField = ['seq', 'create_time_ms'].find((field) => messages.every((message) => (
    (typeof message?.[field] === 'number' && Number.isFinite(message[field]))
      || (typeof message?.[field] === 'string'
        && message[field].trim()
        && Number.isFinite(Number(message[field])))
  )));
  if (!orderField) return messages;
  return messages
    .map((message, index) => ({ message, index, order: Number(message[orderField]) }))
    .sort((left, right) => (
      left.order - right.order || left.index - right.index
    ))
    .map(({ message }) => message);
}

export function createWeixinRuntimeStatus() {
  return {
    startedAt: null,
    ready: false,
    weixinConnectionState: 'idle',
    harnessReachable: false,
    lastCheckedAt: null,
    lastError: null,
    connectionError: null,
    ...createWeixinBridgeStatus(),
  };
}

export class WeixinRuntime {
  #api;
  #config;
  #token;
  #harness;
  #state;
  #contextEnhancement;
  #accessPolicy;
  #logger;
  #diagnostics;
  #startContext = {};
  #replyTimeoutMs;
  #maxMessageChars;
  #startRetryDelaysMs;
  #status = createWeixinRuntimeStatus();
  #bridge = null;
  #abortController = null;
  #monitor = null;
  #starting = null;

  constructor({
    api,
    config,
    token,
    harness,
    state,
    contextEnhancement,
    accessPolicy,
    logger = console,
    diagnostics,
    replyTimeoutMs = 600_000,
    maxMessageChars = DEFAULT_WEIXIN_MAX_MESSAGE_CHARS,
    startRetryDelaysMs,
  }) {
    if (!api || !config || !token || !harness || !state) {
      throw new TypeError('WeixinRuntime requires API, account, token, Harness, and state');
    }
    this.#api = api;
    this.#config = config;
    this.#token = token;
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#accessPolicy = accessPolicy;
    this.#logger = logger;
    this.#diagnostics = diagnostics ?? createWeixinDiagnostics({ logger });
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#maxMessageChars = maxMessageChars;
    this.#startRetryDelaysMs = startRetryDelays(startRetryDelaysMs);
  }

  get status() {
    return structuredClone(this.#status);
  }

  async start(context = {}) {
    if (this.#status.ready && this.#monitor) return this.status;
    if (this.#starting) return this.#starting;
    this.#startContext = context;
    this.#starting = this.#start().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async #start() {
    await this.stop();
    this.#status.startedAt = new Date().toISOString();
    this.#status.weixinConnectionState = 'connecting';
    this.#status.lastError = null;
    this.#status.connectionError = null;
    try {
      try {
        await this.#harness.ensureRunning();
      } catch (error) {
        throw harnessHealthError(error);
      }
      this.#status.harnessReachable = true;
      await this.#state.bindContextTokens?.(this.#token);
      await this.#notifyStart();
      this.#abortController = new AbortController();
      const signal = this.#abortController.signal;
      this.#bridge = new WeixinHarnessBridge({
        api: this.#api,
        baseUrl: this.#config.baseUrl,
        token: this.#token,
        ownerUserId: this.#config.ownerUserId,
        harness: this.#harness,
        state: this.#state,
        contextEnhancement: this.#contextEnhancement,
        accessPolicy: this.#accessPolicy,
        status: this.#status,
        logger: this.#logger,
        replyTimeoutMs: this.#replyTimeoutMs,
        maxMessageChars: this.#maxMessageChars,
        signal,
      });
      this.#status.ready = true;
      this.#status.weixinConnectionState = 'connected';
      this.#status.lastCheckedAt = Date.now();
      this.#monitor = this.#runMonitor(signal).catch((error) => {
        if (signal.aborted) return;
        this.#status.ready = false;
        this.#status.weixinConnectionState = 'failed';
        const failure = this.#diagnostics.report(error, {
          operation: 'connection.monitor', stage: 'connection.poll', botId: this.#config.botId, automatic: true,
        });
        this.#status.connectionError = failure.publicError;
        this.#status.lastError = failure.publicError.message;
      });
      return this.status;
    } catch (error) {
      this.#abortController?.abort();
      this.#abortController = null;
      this.#bridge = null;
      this.#status.ready = false;
      this.#status.weixinConnectionState = 'failed';
      throw error;
    }
  }

  async #notifyStart() {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.#api.notifyStart({
          baseUrl: this.#config.baseUrl,
          token: this.#token,
        });
      } catch (error) {
        const wait = this.#startRetryDelaysMs[attempt];
        if (wait === undefined || !retryableStartError(error)) throw error;
        this.#diagnostics.report(error, {
          ...this.#startContext, stage: 'connection.start', botId: this.#config.botId, automatic: true, warning: true,
        });
        await delay(wait);
      }
    }
  }

  async #runMonitor(signal) {
    let consecutiveFailures = 0;
    while (!signal.aborted) {
      try {
        const response = await this.#api.getUpdates({
          baseUrl: this.#config.baseUrl,
          token: this.#token,
          getUpdatesBuf: this.#state.getUpdatesBuf(),
          signal,
        });
        if (signal.aborted) return;
        const providerCode = rejectedProviderResponse(response, ['errcode', 'ret']);
        if (providerCode) {
          throw new WeixinApiError(
            providerCode === '-14' ? 'stale-token' : 'updates-rejected',
            providerCode === '-14' ? t('微信登录凭据已失效，请移除账号后重新扫码。') : t('微信消息同步请求被拒绝。'),
            { providerCode },
          );
        }
        consecutiveFailures = 0;
        this.#status.ready = true;
        this.#status.weixinConnectionState = 'connected';
        this.#status.lastCheckedAt = Date.now();
        this.#status.lastError = null;
        this.#status.connectionError = null;

        for (const message of orderWeixinMessages(response?.msgs)) {
          void this.#bridge.accept(message).catch((error) => {
            if (signal.aborted) return;
            this.#logger.error?.(
              `[dsh-weixin] account ${this.#config.botId} message handling failed:`,
              error,
            );
          });
        }
        if (typeof response?.get_updates_buf === 'string' && response.get_updates_buf) {
          await this.#state.setGetUpdatesBuf(response.get_updates_buf);
        }
      } catch (error) {
        if (signal.aborted) return;
        consecutiveFailures += 1;
        const failure = this.#diagnostics.report(error, {
          operation: 'connection.monitor', stage: 'connection.poll', botId: this.#config.botId, automatic: true, warning: true,
        });
        this.#status.lastError = failure.publicError.message;
        if (error instanceof WeixinApiError && error.code === 'stale-token') throw failure;
        if (consecutiveFailures >= 3) throw failure;
        await delay(Math.min(2_000 * (2 ** (consecutiveFailures - 1)), 10_000), signal);
      }
    }
  }

  async stop() {
    const warnings = [];
    const monitor = this.#monitor;
    const bridge = this.#bridge;
    const wasStarted = Boolean(this.#abortController || monitor || this.#status.ready);
    this.#abortController?.abort();
    this.#abortController = null;
    this.#monitor = null;
    await bridge?.close?.();
    await monitor?.catch(() => undefined);
    await bridge?.waitForIdle();
    this.#bridge = null;
    if (wasStarted) {
      try {
        await this.#api.notifyStop({
          baseUrl: this.#config.baseUrl,
          token: this.#token,
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        warnings.push(this.#diagnostics.report(error, {
          operation: 'connection.close', stage: 'connection.stop', code: 'connection-stop-failed', botId: this.#config.botId, warning: true,
        }).publicError);
      }
    }
    this.#status.ready = false;
    this.#status.weixinConnectionState = 'idle';
    return { ...this.status, ...(warnings.length ? { warnings } : {}) };
  }

  async sendConnectionTest(text) {
    const remembered = connectionTestTarget(this.#state);
    const toUserId = typeof remembered?.toUserId === 'string' && remembered.toUserId.trim()
      ? remembered.toUserId.trim()
      : typeof this.#config.ownerUserId === 'string' && this.#config.ownerUserId.trim()
        ? this.#config.ownerUserId.trim()
        : null;
    if (!toUserId) throw connectionTestTargetUnavailable(t('微信机器人'));
    if (!this.#status.ready || !this.#abortController) {
      throw new Error('Weixin runtime is not connected');
    }
    await this.#sendTrackedText({
      toUserId,
      text,
      signal: this.#abortController.signal,
    });
    return { sent: true };
  }

  async #sendTrackedText({ toUserId, text, signal, fullText = text, chunkIndex = 0, chunkCount = 1 }) {
    const sentAt = Date.now();
    const contextToken = this.#state.contextTokenFor?.(toUserId);
    let result;
    try {
      result = await this.#api.sendText({
        baseUrl: this.#config.baseUrl,
        token: this.#token,
        toUserId,
        text,
        contextToken,
        signal,
      });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      const error = weixinSendError(cause, {
        baseUrl: this.#config.baseUrl, text: fullText, chunk: text, chunkIndex, chunkCount,
        maxMessageChars: this.#maxMessageChars, contextToken,
      });
      const failure = setLastMessageFailure(this.#status,
        channelDeliveryFailure(error, { uncertain: cause?.code !== 'send-rejected' }),
        weixinSendFailureOptions(error, { proactive: true }));
      this.#logger.warn?.(`[dsh-weixin] outbound delivery failed [${failure.referenceId}]: ${failure.message}`);
      throw error;
    }
    if (this.#status.lastMessageError?.reason === 'WEIXIN_SEND_FAILED') {
      clearLastMessageFailure(this.#status);
    }
    try {
      await this.#state.rememberOutboundMessage?.({
        toUserId,
        text,
        sentAt,
        completedAt: Date.now(),
        providerMessageIds: providerMessageIdsFor(result),
      });
    } catch (error) {
      this.#logger.warn?.('[dsh-weixin] failed to remember an outbound message:', error);
    }
    return result;
  }

  async presentSessionSyncApproval(target, interaction, options = {}) {
    if (!this.#status.ready || !this.#bridge) return false;
    const actor = typeof target?.route?.toUserId === 'string' ? target.route.toUserId.trim() : '';
    if (!actor) return false;
    return this.#bridge.presentSessionSyncApproval(interaction, {
      key: options.key, actor, validate: options.validate,
      send: (text) => this.sendProactiveText(target, text),
    }, options);
  }

  async sendProactiveText(target, text, { signal, format = 'plain' } = {}) {
    const toUserId = typeof target?.route?.toUserId === 'string'
      ? target.route.toUserId.trim() : '';
    if (target?.kind !== 'user' || !toUserId) {
      const error = new TypeError('Invalid Weixin proactive delivery target');
      error.code = 'invalid-target';
      throw error;
    }
    if (!this.#status.ready || !this.#abortController) {
      const error = new Error('Weixin runtime is not connected');
      error.code = 'bot-not-connected';
      throw error;
    }
    const sendSignal = signal ?? this.#abortController.signal;
    sendSignal.throwIfAborted();
    const chunks = format === 'markdown'
      ? chunkMarkdownText(text, this.#maxMessageChars)
      : splitWeixinText(text, this.#maxMessageChars);
    for (const [chunkIndex, chunk] of chunks.entries()) {
      sendSignal.throwIfAborted();
      await this.#sendTrackedText({
        toUserId, text: chunk, signal: sendSignal,
        fullText: text, chunkIndex, chunkCount: chunks.length,
      });
    }
    return { sent: true };
  }
}
