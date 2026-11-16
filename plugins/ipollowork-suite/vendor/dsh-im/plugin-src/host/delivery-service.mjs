import { createHash } from 'node:crypto';
import { normalizeDeliveryTarget } from './delivery-adapter.mjs';
import { deliverySuggestionFromConversationKey } from './delivery-suggestions.mjs';
import { COMPETITIVE_APPROVAL_CHANNELS } from '../../src/channels/shared/harness-approval.mjs';
import { t } from '../../src/channels/shared/i18n.mjs';
import { parseConversationKey } from '../../src/channels/shared/conversation/describe.mjs';

const BOT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const TARGET_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,128}$/;
const CHANNEL_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const DRAFT_TARGET_ID = '__test__';

const ADAPTER_METHODS = Object.freeze([
  'ownsBot',
  'listBots',
  'listTargets',
  'listSuggestions',
  'createTarget',
  'updateTarget',
  'deleteTarget',
  'sendText',
]);

const DELIVERY_ERROR_CODES = new Set([
  'ds-bot-unavailable',
  'ds-bot-not-found',
  'ds-bot-bound',
  'ds-bot-private-required',
  'ds-bot-binding-conflict',
  'bad-request',
  'account-unverified',
  'account-changed',
  'target-changed',
  'capability-unavailable',
  'unknown-bot',
  'unknown-target',
  'target-conflict',
  'invalid-target',
  'bot-not-connected',
  'target-rejected',
  'delivery-failed',
  'send-result-unknown',
  'session-sync-unavailable',
  'cancelled',
  'provider-unavailable',
  'consumer-unavailable',
  'consumer-conflict',
  'ingress-not-accepted',
  'invalid-inbound',
  'stale-route',
  'reply-result-unknown',
  'history-permission-denied',
  'history-unavailable',
  'thread-unavailable',
  'untrusted-source',
]);

const SESSION_SYNC_METHODS = Object.freeze([
  'setSessionSync',
  'listSessionSyncTargets',
  'sendSessionSyncText',
]);

function deliveryError(code, message = code, options) {
  const error = new Error(message, options);
  error.code = code;
  return error;
}

function botIdOf(value) {
  if (typeof value !== 'string' || !BOT_ID_PATTERN.test(value)) {
    throw deliveryError('bad-request', 'Invalid bot id');
  }
  return value;
}

function targetIdOf(value) {
  if (typeof value !== 'string' || !TARGET_ID_PATTERN.test(value)) {
    throw deliveryError('bad-request', 'Invalid target id');
  }
  return value;
}

function conversationKeyOf(value) {
  if (typeof value !== 'string' || !value || value.length > 1_024
    || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw deliveryError('bad-request', 'Invalid private conversation');
  }
  return value;
}

function targetObject(value, { includesTargetId } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw deliveryError('bad-request', 'Invalid target');
  }
  if (includesTargetId) targetIdOf(value.targetId);
  else if (Object.hasOwn(value, 'targetId')) {
    throw deliveryError('bad-request', 'A target id cannot be changed');
  }
  return value;
}

function draftTargetObject(value) {
  targetObject(value);
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('route')) {
    throw deliveryError('bad-request', 'Invalid draft target');
  }
  return value;
}

function cancellation(signal) {
  if (signal?.aborted) throw deliveryError('cancelled', 'Request cancelled');
}

function publicOperationError(error, fallback = 'delivery-failed') {
  if (error?.code === 'workspace-bot-not-found') {
    return deliveryError('unknown-bot', 'Unknown bot', { cause: error });
  }
  if (DELIVERY_ERROR_CODES.has(error?.code)) return error;
  return deliveryError(fallback, fallback, { cause: error });
}

function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object'
    || typeof adapter.channel !== 'string' || !CHANNEL_PATTERN.test(adapter.channel)) {
    throw new TypeError('A delivery adapter with a valid channel is required');
  }
  for (const method of ADAPTER_METHODS) {
    if (typeof adapter[method] !== 'function') {
      throw new TypeError(`A complete delivery adapter is required (${method})`);
    }
  }
  return adapter;
}

function sessionSyncState(value, available) {
  const enabled = value?.enabled === true;
  if (!available) return { enabled, state: 'unavailable' };
  const state = value?.state;
  if (['off', 'active', 'waiting', 'unavailable'].includes(state)) {
    return { enabled, state };
  }
  return { enabled: false, state: 'unavailable' };
}

export class DeliveryService {
  #adapters = new Map();
  #unavailableSessionSyncChannels;
  #logger;
  dsBot;

  constructor({ unavailableSessionSyncChannels = [], dsBot, logger = console } = {}) {
    if (!Array.isArray(unavailableSessionSyncChannels)
      || unavailableSessionSyncChannels.some((channel) => (
        typeof channel !== 'string' || !CHANNEL_PATTERN.test(channel)
      ))) {
      throw new TypeError('unavailableSessionSyncChannels must contain valid channel ids');
    }
    this.#unavailableSessionSyncChannels = new Set(unavailableSessionSyncChannels);
    this.#logger = logger ?? console;
    this.dsBot = dsBot;
  }

  async listDsBotSessions() {
    const ids = new Set();
    for (const { adapter } of this.#adapters.values()) {
      if (!this.#supportsSessionSync(adapter)) continue;
      for (const binding of await adapter.listDsBotBindings?.() ?? []) ids.add(binding.dsBotId);
    }
    if (!ids.size) return [];
    const result = await this.dsBot?.status();
    if (result?.state !== 'ready') return [];
    // Only current, bound sessions and public appearance; no private routes,
    // account configuration, conversation contents, or historical parts.
    return result.bots.filter((bot) => ids.has(bot.id)).map(({ sessionId, id, name, color, avatar }) => ({
      sessionId,
      bot: { id, name, ...(color ? { color } : {}), ...(avatar ? { avatar } : {}) },
    }));
  }

  async dsBotStatus(botId) {
    const adapter = await this.#adapterFor(botIdOf(botId));
    const result = this.#supportsSessionSync(adapter)
      ? await this.dsBot?.status() ?? { state: 'unavailable', bots: [] }
      : { state: 'remote', bots: [] };
    return {
      state: result.state,
      bots: result.bots.map(({ id, name, color, avatar }) => ({
        id, name, ...(color ? { color } : {}), ...(avatar ? { avatar } : {}),
      })),
      conversations: await adapter.listDsBotConversations?.(botId) ?? [],
    };
  }

  async bindDsBot(botId, conversationKey, dsBotId) {
    const id = botIdOf(botId);
    const adapter = await this.#adapterFor(id);
    if (!this.#supportsSessionSync(adapter) || !adapter.bindDsBot) {
      throw deliveryError('ds-bot-unavailable');
    }
    try {
      return await adapter.bindDsBot(id, conversationKeyOf(conversationKey), botIdOf(dsBotId));
    } catch (error) {
      throw publicOperationError(error);
    }
  }

  async unbindDsBot(botId, conversationKey) {
    const id = botIdOf(botId);
    const adapter = await this.#adapterFor(id);
    try {
      return await adapter.unbindDsBot(id, conversationKeyOf(conversationKey));
    } catch (error) {
      throw publicOperationError(error);
    }
  }

  registerAdapter(value) {
    const adapter = validateAdapter(value);
    this.#adapters.get(adapter.channel)?.controller.abort(deliveryError('provider-unavailable'));
    const registration = Object.freeze({ adapter, controller: new AbortController() });
    this.#adapters.set(adapter.channel, registration);
    return () => {
      if (this.#adapters.get(adapter.channel) !== registration) return false;
      this.#adapters.delete(adapter.channel);
      registration.controller.abort(deliveryError('provider-unavailable'));
      return true;
    };
  }

  async listTargets(botId) {
    const id = botIdOf(botId);
    const adapter = await this.#adapterFor(id);
    try {
      const targets = await adapter.listTargets(id);
      if (!Array.isArray(targets)) throw new TypeError('Adapter returned invalid targets');
      const available = this.#supportsSessionSync(adapter);
      return {
        botId: id,
        channel: adapter.channel,
        targets: targets.map((target) => ({
          ...target,
          sessionSync: sessionSyncState(target?.sessionSync, available),
        })),
      };
    } catch (error) {
      throw publicOperationError(error);
    }
  }

  async listBots() {
    const bots = [];
    for (const { adapter } of this.#adapters.values()) {
      try {
        const ids = await adapter.listBots();
        if (!Array.isArray(ids)) throw new TypeError('Adapter returned invalid bots');
        for (const botId of ids) bots.push({ botId: botIdOf(botId), channel: adapter.channel });
      } catch (error) {
        throw publicOperationError(error);
      }
    }
    return bots;
  }

  async listSuggestions(botId) {
    const id = botIdOf(botId);
    const adapter = await this.#adapterFor(id);
    try {
      const suggestions = await adapter.listSuggestions(id);
      if (!Array.isArray(suggestions)) throw new TypeError('Adapter returned invalid suggestions');
      return {
        botId: id,
        channel: adapter.channel,
        suggestions: suggestions.map((suggestion) => normalizeDeliveryTarget(
          adapter.channel,
          suggestion,
          { targetIdRequired: false },
        )),
      };
    } catch (error) {
      throw publicOperationError(error);
    }
  }

  async createTarget(botId, target) {
    const id = botIdOf(botId);
    targetObject(target, { includesTargetId: true });
    const adapter = await this.#adapterFor(id);
    try {
      return await adapter.createTarget(id, target);
    } catch (error) {
      throw publicOperationError(error);
    }
  }

  async updateTarget(botId, targetId, replacement) {
    const id = botIdOf(botId);
    const targetKey = targetIdOf(targetId);
    targetObject(replacement);
    const adapter = await this.#adapterFor(id);
    try {
      return await adapter.updateTarget(id, targetKey, replacement);
    } catch (error) {
      throw publicOperationError(error);
    }
  }

  async deleteTarget(botId, targetId) {
    const id = botIdOf(botId);
    const targetKey = targetIdOf(targetId);
    const adapter = await this.#adapterFor(id);
    try {
      await adapter.deleteTarget(id, targetKey);
      return { deleted: true };
    } catch (error) {
      throw publicOperationError(error);
    }
  }

  async setSessionSync(botId, targetId, enabled) {
    const id = botIdOf(botId);
    const targetKey = targetIdOf(targetId);
    if (typeof enabled !== 'boolean') throw deliveryError('bad-request', 'Invalid enabled state');
    const adapter = await this.#adapterFor(id);
    const hasMethods = SESSION_SYNC_METHODS.every((method) => typeof adapter[method] === 'function');
    if (!hasMethods || (enabled && !this.#supportsSessionSync(adapter))) {
      throw deliveryError('session-sync-unavailable', 'Session sync is unavailable');
    }
    try {
      return await adapter.setSessionSync(id, targetKey, enabled);
    } catch (error) {
      throw publicOperationError(error);
    }
  }

  async listSessionSyncTargets(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) {
      throw deliveryError('bad-request', 'Invalid Session id');
    }
    const targets = [];
    for (const { adapter } of this.#adapters.values()) {
      if (!this.#supportsSessionSync(adapter)) continue;
      try {
        const listed = await adapter.listSessionSyncTargets(sessionId);
        if (!Array.isArray(listed)) throw new TypeError('Adapter returned invalid sync targets');
        for (const target of listed) {
          targets.push({
            channel: adapter.channel,
            botId: botIdOf(target?.botId),
            targetId: targetIdOf(target?.targetId),
          });
        }
      } catch (error) {
        console.warn(
          `[dsh-im] ignored ${adapter.channel} Session sync target lookup failure`
            + ` (${error?.code ?? error?.name ?? 'unknown-error'})`,
        );
      }
    }
    return targets;
  }

  /** Offer a question to one unambiguous bound private chat, like synced approvals. */
  async presentSessionSyncQuestion(sessionId, interaction, options = {}) {
    const { signal } = options;
    const targets = await this.listSessionSyncTargets(sessionId);
    if (signal?.aborted || targets.length === 0) return false;
    const candidates = new Map();
    let unresolvedTarget = false;
    for (const target of targets) {
      try {
        const adapter = await this.#adapterFor(target.botId);
        if (typeof adapter.describeSessionSyncQuestionTarget !== 'function') {
          unresolvedTarget = true;
          continue;
        }
        const info = await adapter.describeSessionSyncQuestionTarget(target.botId, target.targetId, sessionId);
        candidates.set(JSON.stringify([target.channel, target.botId, info.conversationKey]), { adapter, target });
      } catch {
        unresolvedTarget = true;
      }
    }
    if (signal?.aborted) return false;
    if (!unresolvedTarget && candidates.size === 1) {
      const { adapter, target } = candidates.values().next().value;
      try {
        if (await adapter.presentSessionSyncQuestion?.(target.botId, target.targetId, sessionId, interaction, options)) {
          return true;
        }
      } catch (error) {
        if (!signal?.aborted) console.warn('[dsh-im] synced question unavailable:', error?.code ?? error?.name);
      }
    }
    if (!signal?.aborted) {
      const results = await Promise.allSettled(targets.map((target) => this.sendSessionSyncText(
        target.botId, target.targetId, sessionId, t('本会话有问题等待回答，请在桌面端回答。'), { signal },
      )));
      if (results.every((result) => result.status === 'rejected')) {
        console.warn('[dsh-im] synced question notice could not be delivered');
      }
    }
    return false;
  }

  /** Offer one existing bound private chat the same approval the Host is awaiting. */
  async presentSessionSyncApproval(sessionId, interaction, { signal, completion } = {}) {
    const targets = (await this.listSessionSyncTargets(sessionId))
      .filter((target) => COMPETITIVE_APPROVAL_CHANNELS.includes(target.channel));
    if (signal?.aborted || targets.length === 0) return false;
    let outcome = null;
    let notified = false;
    const notify = async (finished = false) => {
      if (!finished && (signal?.aborted || outcome !== null)) return;
      const text = finished
        ? t('未找到可处理端，本次操作未获批准。')
        : t('有操作在等待审批：{tool}，请到 Web 处理。', { tool: interaction.payload.toolName });
      const results = await Promise.allSettled(targets.map((target) => this.sendSessionSyncText(
        target.botId, target.targetId, sessionId, text, finished ? {} : { signal },
      )));
      notified ||= results.some((result) => result.status === 'fulfilled');
    };
    Promise.resolve(completion).then(async (value) => {
      outcome = value;
      if (value === 'unavailable' && notified) await notify(true);
    }).catch((error) => console.warn('[dsh-im] approval status notification failed:', error?.code ?? error?.name));
    const candidates = new Map();
    let unresolvedTarget = false;
    for (const target of targets) {
      try {
        const adapter = await this.#adapterFor(target.botId);
        if (typeof adapter.describeSessionSyncApprovalTarget !== 'function') {
          unresolvedTarget = true;
          continue;
        }
        const info = await adapter.describeSessionSyncApprovalTarget(target.botId, target.targetId, sessionId);
        candidates.set(JSON.stringify([target.channel, target.botId, info.conversationKey]), { adapter, target });
      } catch (error) {
        unresolvedTarget = true;
        console.warn('[dsh-im] approval target unavailable:', error?.code ?? error?.name);
      }
    }
    if (signal?.aborted) return false;
    if (!unresolvedTarget && candidates.size === 1) {
      const { adapter, target } = candidates.values().next().value;
      try {
        if (await adapter.presentSessionSyncApproval(target.botId, target.targetId, sessionId, interaction, {
          signal, completion,
        })) return true;
      } catch (error) {
        if (!signal?.aborted) console.warn('[dsh-im] synced approval unavailable:', error?.code ?? error?.name);
      }
    }
    if (outcome === 'unavailable') await notify(true);
    else await notify();
    return false;
  }

  async sendSessionSyncText(botId, targetId, sessionId, text, { signal, format = 'plain' } = {}) {
    const id = botIdOf(botId);
    const targetKey = targetIdOf(targetId);
    if (typeof sessionId !== 'string' || !sessionId
      || typeof text !== 'string' || !text.trim()
      || (format !== 'plain' && format !== 'markdown')) {
      throw deliveryError('bad-request', 'Invalid session sync delivery');
    }
    cancellation(signal);
    const adapter = await this.#adapterFor(id);
    if (!this.#supportsSessionSync(adapter)) {
      throw deliveryError('session-sync-unavailable', 'Session sync is unavailable');
    }
    try {
      await adapter.sendSessionSyncText(id, targetKey, sessionId, text, { signal, format });
      return { sent: true };
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
        throw deliveryError('cancelled', 'Request cancelled', { cause: error });
      }
      throw publicOperationError(error);
    }
  }

  #assertRegistered(registration) {
    if (this.#adapters.get(registration.adapter.channel) !== registration) {
      throw deliveryError('capability-unavailable');
    }
  }

  /**
   * Describe the conversation a session belongs to, or null when no channel
   * owns it. Pure lookup: no network, no session creation, no throwing.
   * @param {string} sessionId harness session id
   */
  async describeConversation(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return null;
    for (const { adapter } of this.#adapters.values()) {
      if (typeof adapter.describeConversationBySession !== 'function') continue;
      try {
        const described = await adapter.describeConversationBySession(sessionId);
        if (described) return described;
      } catch {
        // A channel that cannot answer must not hide the others.
        continue;
      }
    }
    return null;
  }

  /**

   * The same lookup, answered from memory only: no await, no network. A session
   * whose channel has not loaded its state yet answers null — which is exactly the
   * truth a synchronous prompt assembly can act on.
   * @param {string} sessionId harness session id
   */
  describeConversationSync(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return null;
    for (const { adapter } of this.#adapters.values()) {
      if (typeof adapter.describeConversationBySessionSync !== 'function') continue;
      try {
        const described = adapter.describeConversationBySessionSync(sessionId);
        if (described) return described;
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * The Session no channel state owns may still be a DS Bot's current session:
   * its chat was bound to the bot, the bot's `sessionId` rolled over without a
   * new inbound message, and only the bot service knows the new session. Reverse
   * the binding through `dsBot.status()` so delivery survives that rollover.
   * An unavailable DS Bot, or a session no bot currently owns, answers `null`.
   */
  async describeViaDsBot(sessionId) {
    try {
      const status = await this.dsBot?.status();
      if (status?.state !== 'ready') return null;
      const bot = status.bots.find((entry) => entry.sessionId === sessionId);
      if (!bot) return null;
      for (const { adapter } of this.#adapters.values()) {
        const bindings = await adapter.listDsBotBindings?.() ?? [];
        const binding = bindings.find((entry) => entry.dsBotId === bot.id);
        if (!binding) continue;
        const parsed = parseConversationKey(binding.conversationKey, { channel: adapter.channel });
        return {
          channel: adapter.channel,
          botId: binding.botId,
          botName: bot.name ?? null,
          conversationKey: binding.conversationKey,
          chatType: parsed?.chatType ?? null,
          chatId: parsed?.chatId ?? null,
          threadId: parsed?.threadId ?? null,
          chatTitle: null,
          senderId: null,
          senderName: null,
          senderUsername: null,
          senderIsBot: null,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Deliver one text to the chat this Session is currently bound to.
   *
   * The address is not configured anywhere beforehand: `describeConversation`
   * reads the conversation the channel itself keeps for the Session, and its
   * conversation key becomes the same draft route the manual delivery path
   * accepts. A Session no channel owns simply has nowhere to go, which is a
   * result rather than an error; a real send failure is thrown like `send()`.
   *
   * @param {string} sessionId harness session id
   * @param {string} text message body
   * @param {{format?: 'plain'|'markdown', signal?: AbortSignal}} [options]
   * @returns {Promise<{sent: true} | {sent: false, reason: 'unbound'|'unroutable'}>}
   */
  async deliverSessionText(sessionId, text, { format = 'plain', signal } = {}) {
    if (typeof sessionId !== 'string' || !sessionId
      || typeof text !== 'string' || !text.trim()
      || (format !== 'plain' && format !== 'markdown')) {
      throw deliveryError('bad-request', 'Invalid Session delivery');
    }
    cancellation(signal);
    const described = await this.describeConversation(sessionId) ?? await this.describeViaDsBot(sessionId);
    cancellation(signal);
    if (!described) {
      this.#warnUndelivered(sessionId, 'unbound', null);
      return { sent: false, reason: 'unbound' };
    }
    const draft = deliverySuggestionFromConversationKey(described.channel, described.conversationKey);
    if (!draft) {
      // A key the channel persisted but no route covers stays unroutable. An
      // older shape such as `direct:<chatId>:<threadId>` is deliberately not
      // reinterpreted as a chat: guessing a recipient would drop the thread and
      // message the wrong place, so the key is only reported here.
      this.#warnUndelivered(sessionId, 'unroutable', described);
      return { sent: false, reason: 'unroutable' };
    }
    // The draft goes through the ordinary send path, so the adapter validates
    // and normalizes it exactly as it does a saved target.
    return this.send(described.botId, { kind: draft.kind, route: draft.route }, text, { signal, format });
  }

  /**
   * Report one text that found nowhere to go. Only the identifiers that make the
   * miss diagnosable are logged — Session, channel, conversation key — never the
   * message body, and never a channel credential.
   */
  #warnUndelivered(sessionId, reason, described) {
    const where = described
      ? ` channel=${described.channel} conversationKey=${described.conversationKey}`
      : '';
    this.#logger?.warn?.(
      `[dsh-im] Session text was not delivered [${reason}] session=${sessionId}${where}`,
    );
  }

  async describeBot(botId) {
    const id = botIdOf(botId);
    const registration = await this.#checkedRegistrationFor(id);
    const { adapter } = registration;
    if (typeof adapter.describeAccount !== 'function') throw deliveryError('capability-unavailable');
    this.#assertRegistered(registration);
    try {
      const account = await adapter.describeAccount(id);
      this.#assertRegistered(registration);
      return account;
    } catch (error) { throw publicOperationError(error); }
  }

  async consumeInbound(botId, options = {}) {
    const id = botIdOf(botId);
    cancellation(options.signal);
    if (!/^[a-f0-9]{64}$/.test(options.expectedFingerprint ?? '') || typeof options.onEvent !== 'function')
      throw deliveryError('bad-request');
    const registration = await this.#checkedRegistrationFor(id);
    if (typeof registration.adapter.consumeInbound !== 'function' || typeof options.onEvent !== 'function')
      throw deliveryError('capability-unavailable');
    this.#assertRegistered(registration);
    const dispose = await registration.adapter.consumeInbound(id, {
      ...options,
      signal: options.signal ? AbortSignal.any([options.signal, registration.controller.signal]) : registration.controller.signal,
      onEvent: async (evidence, context) => {
        this.#assertRegistered(registration);
        const result = await options.onEvent(evidence, context);
        this.#assertRegistered(registration);
        return result;
      },
    });
    try { this.#assertRegistered(registration); } catch (error) { dispose(); throw error; }
    return dispose;
  }

  async historyChecked(botId, route, query, options = {}) {
    const id = botIdOf(botId);
    cancellation(options.signal);
    if (!/^[a-f0-9]{64}$/.test(options.expectedFingerprint ?? '')) throw deliveryError('bad-request');
    const registration = await this.#checkedRegistrationFor(id);
    if (typeof registration.adapter.historyChecked !== 'function') throw deliveryError('capability-unavailable');
    this.#assertRegistered(registration);
    const signal = options.signal ? AbortSignal.any([options.signal, registration.controller.signal]) : registration.controller.signal;
    try {
      const result = await registration.adapter.historyChecked(id, structuredClone(route), structuredClone(query), { ...options, signal });
      this.#assertRegistered(registration);
      cancellation(options.signal);
      return result;
    } catch (error) {
      this.#assertRegistered(registration);
      if (signal.aborted || error?.name === 'AbortError') throw deliveryError('cancelled');
      throw publicOperationError(error, 'history-unavailable');
    }
  }

  async replyChecked(botId, route, text, options = {}) {
    const id = botIdOf(botId);
    cancellation(options.signal);
    if (!/^[a-f0-9]{64}$/.test(options.expectedFingerprint ?? '')
      || typeof text !== 'string' || !text.trim() || text.length > 4000)
      throw deliveryError('bad-request');
    const registration = await this.#checkedRegistrationFor(id);
    if (typeof registration.adapter.replyChecked !== 'function') throw deliveryError('capability-unavailable');
    this.#assertRegistered(registration);
    try { return await registration.adapter.replyChecked(id, structuredClone(route), text, {
      ...options, signal: options.signal ? AbortSignal.any([options.signal, registration.controller.signal]) : registration.controller.signal,
    }); }
    catch (error) { throw publicOperationError(error); }
  }

  async sendChecked(botId, targetId, text, { expectedFingerprint, expectedTargetDigest, signal, format = 'plain', receipt = false } = {}) {
    const id = botIdOf(botId);
    const key = targetIdOf(targetId);
    if (typeof text !== 'string' || !text.trim() || !['plain', 'markdown'].includes(format) || typeof receipt !== 'boolean'
      || !/^[a-f0-9]{64}$/.test(expectedFingerprint ?? '') || !/^[a-f0-9]{64}$/.test(expectedTargetDigest ?? '')) {
      throw deliveryError('bad-request');
    }
    cancellation(signal);
    const registration = await this.#checkedRegistrationFor(id);
    const { adapter } = registration;
    if (typeof adapter.describeAccount !== 'function') throw deliveryError('capability-unavailable');
    this.#assertRegistered(registration);
    try {
      const candidates = await adapter.listTargets(id);
      const saved = candidates.find((target) => target?.targetId === key);
      if (!saved) throw deliveryError('unknown-target');
      const target = normalizeDeliveryTarget(adapter.channel, {
        targetId: saved.targetId, kind: saved.kind, route: structuredClone(saved.route),
      });
      const digest = createHash('sha256').update(JSON.stringify({ kind: target.kind,
        route: Object.fromEntries(Object.entries(target.route).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) })).digest('hex');
      if (digest !== expectedTargetDigest) throw deliveryError('target-changed');
      const account = await adapter.describeAccount(id);
      if (account?.version !== 1 || !account.capabilities?.includes('proactive-text-checked')) {
        throw deliveryError('capability-unavailable');
      }
      if (account.account?.fingerprint !== expectedFingerprint) throw deliveryError('account-changed');
      if (receipt && (!account.capabilities?.includes('proactive-receipt-checked') || target.kind !== 'group'))
        throw deliveryError('capability-unavailable');
      const beforeSend = () => {
        cancellation(signal);
        this.#assertRegistered(registration);
      };
      beforeSend();
      const result = await adapter.sendText(id, target, text, { signal, expectedFingerprint, beforeSend,
        ...(receipt ? { receipt: true } : {}),
        ...(format === 'markdown' ? { format } : {}) });
      if (!receipt) return { sent: true };
      if (result?.sent !== true || result.receipt?.version !== 1
        || typeof result.receipt.messageId !== 'string' || !result.receipt.messageId || result.receipt.messageId.length > 512
        || result.receipt.conversationId !== target.route.chatId)
        throw deliveryError('send-result-unknown');
      return { sent: true, receipt: { version: 1, messageId: result.receipt.messageId, conversationId: result.receipt.conversationId } };
    } catch (error) { throw publicOperationError(error); }
  }

  async send(botId, targetIdOrDraft, text, { signal, format = 'plain' } = {}) {
    const id = botIdOf(botId);
    const targetKey = typeof targetIdOrDraft === 'string'
      ? targetIdOf(targetIdOrDraft)
      : null;
    const draft = targetKey === null ? draftTargetObject(targetIdOrDraft) : null;
    if (typeof text !== 'string' || !text.trim()) {
      throw deliveryError('bad-request', 'Message text is required');
    }
    if (format !== 'plain' && format !== 'markdown') {
      throw deliveryError('bad-request', 'Message format must be plain or markdown');
    }
    cancellation(signal);
    const adapter = await this.#adapterFor(id);
    try {
      let target;
      if (draft) {
        target = { targetId: DRAFT_TARGET_ID, ...draft };
      } else {
        const targets = await adapter.listTargets(id);
        if (!Array.isArray(targets)) throw new TypeError('Adapter returned invalid targets');
        target = targets.find((candidate) => candidate?.targetId === targetKey);
        if (!target) throw deliveryError('unknown-target', 'Unknown target');
      }
      cancellation(signal);
      await adapter.sendText(id, target, text, {
        signal,
        ...(format === 'markdown' ? { format } : {}),
      });
      return { sent: true };
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
        throw deliveryError('cancelled', 'Request cancelled', { cause: error });
      }
      throw publicOperationError(error);
    }
  }

  async #checkedRegistrationFor(botId) {
    for (const registration of this.#adapters.values()) {
      let ownsBot;
      try { ownsBot = await registration.adapter.ownsBot(botId); }
      catch (error) { throw publicOperationError(error); }
      if (ownsBot) {
        this.#assertRegistered(registration);
        return registration;
      }
    }
    throw deliveryError('unknown-bot', 'Unknown bot');
  }

  async #adapterFor(botId) {
    for (const { adapter } of this.#adapters.values()) {
      let ownsBot;
      try {
        ownsBot = await adapter.ownsBot(botId);
      } catch (error) {
        throw publicOperationError(error);
      }
      if (ownsBot) return adapter;
    }
    throw deliveryError('unknown-bot', 'Unknown bot');
  }

  #supportsSessionSync(adapter) {
    return !this.#unavailableSessionSyncChannels.has(adapter.channel)
      && SESSION_SYNC_METHODS.every((method) => typeof adapter[method] === 'function');
  }
}

export function createDeliveryService(options) {
  return new DeliveryService(options);
}
