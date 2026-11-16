import { harnessPeer } from './harness-peer.mjs';

export function dsBotError(code = 'ds-bot-unavailable') {
  return Object.assign(new Error(code), { code });
}

function appearance(bot) {
  const avatar = {};
  if (/^[a-z][\w-]{0,31}$/u.test(bot.avatar?.shape ?? '')) avatar.shape = bot.avatar.shape;
  if (typeof bot.avatar?.image === 'string' && bot.avatar.image.length <= 1_500_000
    && /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(bot.avatar.image)) {
    avatar.image = bot.avatar.image;
  }
  return {
    ...(/^(?:#[0-9a-fA-F]{6}|[a-z][\w-]{0,31})$/u.test(bot.color ?? '') ? { color: bot.color } : {}),
    ...(Object.keys(avatar).length ? { avatar } : {}),
  };
}

/** Read DS Bot through the current Host's registered route, without a second
 * runtime, credentials, or assumptions about its configured storage directory. */
export function createDsBotClient(ctx) {
  async function call(endpoint, payload = {}, options = {}) {
    options.signal?.throwIfAborted();
    const connection = ctx.connection;
    if (typeof connection?.createSharedFetchHandler !== 'function') throw dsBotError();
    const timeout = AbortSignal.timeout(15_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const response = await connection.createSharedFetchHandler('/api').fetch(new Request(
      'http://localhost/api/bot', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, payload }), signal,
      },
    ), harnessPeer(ctx));
    if (!response.ok) throw dsBotError();
    const result = await response.json();
    if (result?.ok !== true) {
      throw dsBotError(result?.error?.code === 'bot/stale' ? 'interaction-not-pending' : 'ds-bot-unavailable');
    }
    return result.value;
  }
  async function status() {
    try {
      const manager = ctx.get?.('pluginManager');
      if (typeof manager?.listBundles === 'function') {
        const bundles = await manager.listBundles();
        const bundle = bundles.find((entry) => entry.name === 'ds-bot');
        if (!bundle?.installed) return { state: 'missing', bots: [] };
        if (!bundle.enabled) return { state: 'disabled', bots: [] };
      }
      const value = await call('state');
      if (!Array.isArray(value?.bots)) {
        return { state: 'unavailable', bots: [] };
      }
      if (value.readOnly) return { state: 'readonly', bots: [] };
      const bots = value.bots.filter((bot) => (
        typeof bot.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(bot.id)
        && typeof bot.sessionId === 'string' && Boolean(bot.sessionId)
        && typeof bot.name === 'string'
      )).map((bot) => ({
        id: bot.id, name: bot.name, sessionId: bot.sessionId, ...appearance(bot),
        ...(Array.isArray(bot.parts) ? { parts: bot.parts.filter((id) => typeof id === 'string') } : {}),
      }));
      return { state: 'ready', bots };
    } catch {
      return { state: 'unavailable', bots: [] };
    }
  }
  return Object.freeze({
    status,
    async question(sessionId) {
      const value = await call('state');
      if (value?.readOnly) throw dsBotError();
      if (!value?.bots?.some((bot) => bot.sessionId === sessionId)) return null;
      const question = value.questions?.[sessionId];
      return typeof question?.id === 'string' && typeof question.question === 'string'
        && Array.isArray(question.options) ? question : null;
    },
    answerQuestion(sessionId, questionId, answer) {
      return call('answer-question', { sessionId, questionId, answer });
    },
    async updateBotModel(id, selection, options = {}) {
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)
        || typeof selection?.provider !== 'string' || !selection.provider
        || typeof selection?.model !== 'string' || !selection.model
        || (selection.reasoningEffort !== undefined
          && (typeof selection.reasoningEffort !== 'string' || !selection.reasoningEffort))) {
        throw dsBotError('model-unavailable');
      }
      // DS Bot owns both its persisted model and all of its sessions. A model
      // change without an explicit effort resets to that model's default.
      const ref = `${selection.provider}/${selection.model}`;
      const updated = await call('update-bot', {
        id, model: ref, effort: selection.reasoningEffort ?? null,
      }, options);
      if (updated?.id !== id || updated?.model !== ref || updated?.appliedModel !== ref) {
        throw dsBotError('model-selection-mismatch');
      }
      return { selected: {
        provider: selection.provider,
        model: selection.model,
        ...(updated.appliedEffort ? { reasoningEffort: updated.appliedEffort } : {}),
      } };
    },
    async resolve(id) {
      const result = await status();
      if (result.state !== 'ready') throw dsBotError();
      const bot = result.bots.find((entry) => entry.id === id);
      if (!bot) throw dsBotError('ds-bot-not-found');
      return bot;
    },
  });
}
