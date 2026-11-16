import { TokenBotController } from '../shared/token-bot-controller.mjs';
import {
  deriveTelegramBotIdentity,
  maskTelegramBotId,
  normalizeSendLimitPerMinute,
  normalizeTelegramAccessPolicy,
} from './config-store.mjs';
import {
  normalizeThinkingIntervalSeconds,
  normalizeThinkingNumbering,
} from '../shared/thinking-cadence.mjs';
import {
  GROUP_TRIGGER_VERSION,
  groupTriggersSettings,
  normalizeGroupTriggers,
  parseGroupReference,
  resolveGroupReference,
} from './group-triggers.mjs';
import { inspectTelegramToken, TelegramApi } from './telegram-api.mjs';
import { createTelegramHttpTransport } from './telegram-http.mjs';
import { TELEGRAM_DESCRIPTOR } from './telegram-bridge.mjs';

export class TelegramController extends TokenBotController {
  #configStore;

  #credentials;

  #groupHistory;

  #createApi;

  #createHttpTransport;

  constructor(options) {
    super({
      ...options,
      descriptor: TELEGRAM_DESCRIPTOR,
      inspectToken: options.inspectToken ?? inspectTelegramToken,
      deriveIdentity: deriveTelegramBotIdentity,
      maskPlatformId: maskTelegramBotId,
    });
    this.#configStore = options.configStore;
    this.#credentials = options.credentials ?? null;
    this.#groupHistory = options.groupHistory ?? null;
    this.#createApi = options.createApi ?? ((apiOptions) => new TelegramApi(apiOptions));
    // Lookup must go through the same proxy-aware transport as the runtime.
    this.#createHttpTransport = options.createHttpTransport ?? createTelegramHttpTransport;
  }

  status() {
    const snapshot = super.status();
    return {
      ...snapshot,
      bots: snapshot.bots.map((bot) => {
        const config = this.#configStore.get(bot.botId);
        const accessPolicy = normalizeTelegramAccessPolicy(config ?? {});
        return {
          ...bot,
          accessPolicy,
          // Default ON; only an explicit false in the config opts out.
          thinkingTraces: config?.thinkingTraces !== false,
          thinkingNumbering: normalizeThinkingNumbering(config?.thinkingNumbering),
          // 0 means no pacing, which is also what an absent field means.
          thinkingIntervalSeconds: normalizeThinkingIntervalSeconds(config?.thinkingIntervalSeconds),
          groupTriggers: normalizeGroupTriggers(config?.groupTriggers),
          sendLimitPerMinute: normalizeSendLimitPerMinute(config?.sendLimitPerMinute),
        };
      }),
    };
  }

  async setAccessPolicy(botId, value) {
    const accessPolicy = normalizeTelegramAccessPolicy(value);
    return this.updateBotConfig(botId, (config) => ({ ...config, ...accessPolicy }));
  }

  async setThinkingTraces(botId, value) {
    return this.updateBotConfig(botId, (config) => ({
      ...config,
      thinkingTraces: value === true,
    }));
  }

  /**
   * Persist trace numbering and pacing; the runtime restarts with the new
   * values, so the next turn already follows them.
   */
  async setThinkingCadence(botId, { thinkingNumbering, thinkingIntervalSeconds } = {}) {
    const numbering = normalizeThinkingNumbering(thinkingNumbering);
    const interval = normalizeThinkingIntervalSeconds(thinkingIntervalSeconds);
    return this.updateBotConfig(botId, (config) => ({
      ...config,
      thinkingNumbering: numbering,
      thinkingIntervalSeconds: interval,
    }));
  }

  /** Persist the per-chat send limit; the runtime restarts with the new value. */
  async setSendLimitPerMinute(botId, value) {
    const sendLimitPerMinute = normalizeSendLimitPerMinute(value);
    return this.updateBotConfig(botId, (config) => ({ ...config, sendLimitPerMinute }));
  }

  /** Channels the bot has actually received messages from. */
  async knownGroups() {
    if (typeof this.#groupHistory?.listGroups !== 'function') return [];
    try {
      return await this.#groupHistory.listGroups({ channel: 'telegram' });
    } catch {
      // History only feeds the settings panel: a broken archive must not take
      // the settings page down with it.
      return [];
    }
  }

  async groupTriggersPanel(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Telegram bot');
    return groupTriggersSettings(config.groupTriggers, await this.knownGroups());
  }

  /**
   * Persist the per-group reply rules.
   *
   * `removed` lists the chats the owner deleted in the panel: they keep their
   * archived history but stop being offered in the settings page.
   */
  async updateGroupTriggers(botId, { config: value, removed = [] } = {}) {
    const stored = this.#configStore.get(botId);
    if (!stored) throw new Error('Unknown Telegram bot');
    const normalized = normalizeGroupTriggers(value);
    const groups = { ...normalized.groups };
    // The panel never echoes `hiddenGroupIds`, so they are merged with what the
    // store already holds; otherwise a second save would resurrect every group
    // removed by the first one.
    const hidden = new Set(normalizeGroupTriggers(stored.groupTriggers).hiddenGroupIds);
    for (const chatId of Array.isArray(removed) ? removed : []) {
      const id = typeof chatId === 'string' ? chatId.trim() : '';
      if (!id) continue;
      delete groups[id];
      hidden.add(id);
    }
    // An explicit rule means the owner brought the chat back into the panel.
    for (const chatId of Object.keys(groups)) hidden.delete(chatId);
    const next = {
      version: GROUP_TRIGGER_VERSION,
      defaults: normalized.defaults,
      groups,
      hiddenGroupIds: [...hidden],
    };
    await this.updateBotConfig(botId, (config) => ({ ...config, groupTriggers: next }));
    return groupTriggersSettings(next, await this.knownGroups());
  }

  /**
   * Turn a pasted group reference into a chat id.
   *
   * Numeric IDs resolve locally; usernames and invite links need the Bot API,
   * so the call borrows the bot's own token instead of asking the owner for it.
   */
  async resolveGroupTrigger(botId, input) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Telegram bot');
    let token = '';
    if (this.#credentials && typeof this.#credentials.resolve === 'function') {
      const resolved = await this.#credentials.resolve(config.tokenRef);
      token = typeof resolved?.value === 'string' ? resolved.value.trim() : '';
    }
    // Numeric ids and message links resolve offline; only a username or an
    // invite link needs the Bot API (and therefore a transport).
    const reference = parseGroupReference(input);
    if (reference.chatId) {
      return Object.freeze({ chatId: reference.chatId, title: null, type: null, verified: false });
    }
    if (!token) return resolveGroupReference(input, {});
    const transport = this.#createHttpTransport();
    try {
      const api = this.#createApi({
        token,
        fetchImpl: transport.fetchImpl,
        FormDataImpl: transport.FormDataImpl,
      });
      return await resolveGroupReference(input, {
        getChat: (chatId) => api.getChat({ chatId }),
      });
    } finally {
      await transport.destroy?.();
    }
  }
}
