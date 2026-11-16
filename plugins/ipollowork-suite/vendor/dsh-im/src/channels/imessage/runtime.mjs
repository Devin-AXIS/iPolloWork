import { createConnectionDiagnostics, atConnectionStage } from '../shared/connection-error.mjs';
import { sendRememberedConnectionTest } from '../shared/connection-test.mjs';
import { MacOSMessagesApi, normalizeIMessage } from './imessage-api.mjs';
import { createIMessageBridgeStatus, IMessageHarnessBridge } from './imessage-bridge.mjs';

const DEFAULT_POLL_INTERVAL_MS = 2_000;

class IMessageBotClient {
  #api;
  #signal;
  constructor(api, signal) { this.#api = api; this.#signal = signal; }
  sendText(target, text) {
    return this.#api.sendText({
      chatGuid: target.chatGuid,
      address: target.address,
      text,
      signal: this.#signal,
    });
  }
  sendTyping() { return Promise.resolve(); }
}

export function createIMessageRuntimeStatus() {
  return { startedAt: null, ready: false, connectionState: 'idle', harnessReachable: false,
    lastCheckedAt: null, lastConnectedAt: null, lastError: null, ...createIMessageBridgeStatus() };
}

export class IMessageRuntime {
  #config; #token; #harness; #state; #contextEnhancement; #accessPolicy; #logger;
  #diagnostics;
  #replyTimeoutMs; #pollIntervalMs; #createApi; #status = createIMessageRuntimeStatus();
  #api; #bridge; #abortController; #timer; #polling; #stopped = true;
  constructor({ config, token, harness, state, contextEnhancement, accessPolicy, logger = console,
    replyTimeoutMs = 600_000, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    createApi = (options) => new MacOSMessagesApi(options) }) {
    if (!config || !token || !harness || !state) throw new TypeError('IMessageRuntime requires config, token, Harness, and state');
    this.#config = config; this.#token = token; this.#harness = harness; this.#state = state;
    this.#contextEnhancement = contextEnhancement; this.#accessPolicy = accessPolicy; this.#logger = logger; this.#diagnostics = createConnectionDiagnostics({ channel: 'imessage', logger });
    this.#replyTimeoutMs = replyTimeoutMs; this.#pollIntervalMs = pollIntervalMs; this.#createApi = createApi;
  }
  get status() { return structuredClone(this.#status); }
  async sendConnectionTest(text) {
    if (!this.#status.ready || !this.#api) { const error = new Error('iMessage gateway is not connected'); error.code = 'test-target-unavailable'; throw error; }
    await sendRememberedConnectionTest({
      state: this.#state,
      text,
      channelLabel: 'iMessage',
      send: (target, value) => this.#api.sendText({
        chatGuid: target.chatGuid, address: target.address, text: value,
      }),
    });
  }
  async sendProactiveText(target, text, options = {}) {
    if (!this.#status.ready || !this.#api) { const error = new Error('iMessage gateway is not connected'); error.code = 'bot-not-connected'; throw error; }
    const chatGuid = target?.route?.chatGuid;
    if (!chatGuid) { const error = new TypeError('Invalid iMessage proactive delivery target'); error.code = 'invalid-target'; throw error; }
    await this.#api.sendText({ chatGuid, text, signal: options.signal });
    return { sent: true };
  }
  async start() {
    if (this.#status.ready) return this.status;
    await this.stop(); this.#stopped = false; this.#status.startedAt = new Date().toISOString(); this.#status.connectionState = 'connecting';
    this.#abortController = new AbortController();
    try {
      await atConnectionStage('harness.check', () => this.#harness.ensureRunning()); this.#status.harnessReachable = true;
      this.#api = this.#createApi({ signal: this.#abortController.signal });
      const permissions = await this.#api.getPermissions();
      if (permissions.database !== 'granted' || permissions.automation !== 'granted') {
        const error = new Error('macOS Messages permissions are required');
        error.code = 'messages-permission-required';
        error.permissions = permissions;
        throw error;
      }
      if (this.#state.cursor() === null && typeof this.#api.getLatestMessageRowId === 'function') {
        await this.#state.setCursor(await this.#api.getLatestMessageRowId());
      }
      const client = new IMessageBotClient(this.#api, this.#abortController.signal);
      this.#bridge = new IMessageHarnessBridge({ bot: client, harness: this.#harness, state: this.#state,
        contextEnhancement: this.#contextEnhancement, accessPolicy: this.#accessPolicy, status: this.#status,
        logger: this.#logger, replyTimeoutMs: this.#replyTimeoutMs, signal: this.#abortController.signal });
      this.#status.ready = true; this.#status.connectionState = 'connected'; this.#status.lastConnectedAt = Date.now();
      this.#schedulePoll(0); return this.status;
    } catch (error) { this.#status.ready = false; this.#status.connectionState = 'failed'; this.#status.error = this.#diagnostics.report(error, { operation: 'connection.restore', reuse: true, botId: this.#config?.botId, automatic: true }).publicError;
      this.#status.lastError = this.#status.error.message; await this.stop(); throw error; }
  }
  async stop() { this.#stopped = true; clearTimeout(this.#timer); this.#timer = null; this.#abortController?.abort(); await this.#polling?.catch(() => {}); this.#polling = null; this.#bridge = null; this.#api = null; this.#status.ready = false; }
  #schedulePoll(delay) { if (this.#stopped) return; this.#timer = setTimeout(() => { this.#polling = this.#poll().finally(() => this.#schedulePoll(this.#pollIntervalMs)); }, delay); this.#timer.unref?.(); }
  async #poll() {
    if (!this.#api || !this.#bridge || this.#stopped) return;
    try {
      const rows = await this.#api.listMessages({ after: this.#state.cursor() ?? 0, limit: 100 });
      const messages = Array.isArray(rows) ? rows : rows?.messages ?? rows?.data ?? [];
      for (const raw of messages) {
        const message = normalizeIMessage(raw, { botId: this.#config.platformId });
        if (message) await this.#bridge.accept(message);
        if (Number.isSafeInteger(raw.rowid)) await this.#state.setCursor(raw.rowid);
      }
      this.#status.lastCheckedAt = Date.now(); this.#status.lastError = null; this.#status.error = null; this.#diagnostics.clear();
    } catch (error) { if (!this.#stopped) { this.#status.error = this.#diagnostics.report(error, { operation: 'connection.monitor', botId: this.#config?.botId, automatic: true }).publicError;
      this.#status.lastError = this.#status.error.message;  } }
  }
}
