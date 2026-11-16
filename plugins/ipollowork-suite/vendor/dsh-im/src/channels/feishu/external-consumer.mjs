function refusal(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function identifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : undefined;
}

export function normalizeExternalText(event, { botId, appId, botOpenId, fingerprint }) {
  const message = event?.message;
  const actorId = identifier(event?.sender?.sender_id?.open_id);
  const messageId = identifier(message?.message_id);
  const conversationId = identifier(message?.chat_id);
  const eventId = identifier(event?.event_id ?? event?.header?.event_id);
  const eventApp = event?.app_id ?? event?.header?.app_id;
  if (eventApp !== undefined && eventApp !== appId) throw refusal('account-changed');
  if (event?.sender?.sender_type === 'app' || event?.sender?.sender_type === 'bot') return null;
  if (event?.sender?.sender_type !== 'user'
    || !['p2p', 'group'].includes(message?.chat_type) || message?.message_type !== 'text') return null;
  if (message.chat_type === 'group' && !identifier(botOpenId)) throw refusal('account-unverified');
  if (message.mentions !== undefined && (!Array.isArray(message.mentions) || message.mentions.length > 100))
    throw refusal('invalid-inbound');
  const mentions = Object.freeze((message.mentions ?? []).map(mention => {
    const id = identifier(mention?.id?.open_id ?? mention?.open_id);
    const key = identifier(mention?.key);
    if (!id || !key) throw refusal('invalid-inbound');
    return Object.freeze({ id, key, ...(identifier(mention.name) ? { name: mention.name } : {}) });
  }));
  if (!actorId || !messageId || !conversationId || !eventId
    || !/^[a-f0-9]{64}$/.test(fingerprint ?? '')) throw refusal('invalid-inbound');
  let text;
  try { text = JSON.parse(message.content)?.text; } catch { throw refusal('invalid-inbound'); }
  if (typeof text !== 'string' || !text.trim() || text.length > 16000) throw refusal('invalid-inbound');
  const milliseconds = Number(message.create_time);
  const timestamp = new Date(milliseconds);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || !Number.isFinite(timestamp.getTime()))
    throw refusal('invalid-inbound');
  const route = Object.freeze({
    messageId, conversationId, actorId,
    ...(identifier(message.thread_id) ? { threadId: message.thread_id } : {}),
    ...(identifier(message.root_id) ? { rootId: message.root_id } : {}),
    ...(identifier(message.parent_id) ? { parentId: message.parent_id } : {}),
  });
  return Object.freeze({
    version: 1, channel: 'feishu', botId, fingerprint, eventId, messageId,
    actor: Object.freeze({ kind: 'user', id: actorId,
      ...(identifier(event.sender.sender_name) ? { name: event.sender.sender_name } : {}) }),
    conversation: Object.freeze({ kind: message.chat_type === 'group' ? 'group' : 'dm', id: conversationId }),
    mentions, mentionedAccount: mentions.some(mention => mention.id === botOpenId),
    at: timestamp.toISOString(), text, reply: route,
    replay: Object.freeze({ kind: 'provider-redelivery', resumeCursor: false, gapPossible: true }),
  });
}

export class ExclusiveInboundConsumers {
  #entries = new Map();

  register(botId, { fingerprint, onEvent, signal }) {
    if (this.#entries.has(botId)) throw refusal('consumer-conflict');
    if (!/^[a-f0-9]{64}$/.test(fingerprint ?? '') || typeof onEvent !== 'function')
      throw refusal('bad-request');
    signal?.throwIfAborted();
    const controller = new AbortController();
    const entry = { fingerprint, onEvent, controller, dispose: undefined };
    const dispose = () => {
      if (this.#entries.get(botId) === entry) this.#entries.delete(botId);
      controller.abort(refusal('consumer-unavailable'));
      signal?.removeEventListener('abort', dispose);
    };
    entry.dispose = dispose;
    this.#entries.set(botId, entry);
    signal?.addEventListener('abort', dispose, { once: true });
    return dispose;
  }

  async accept(botId, evidence, signal) {
    const entry = this.#entries.get(botId);
    if (!entry) throw refusal('consumer-unavailable');
    if (entry.fingerprint !== evidence.fingerprint) throw refusal('account-changed');
    const deliverySignal = signal
      ? AbortSignal.any([signal, entry.controller.signal]) : entry.controller.signal;
    deliverySignal.throwIfAborted();
    let abort;
    const interrupted = new Promise((_, reject) => {
      abort = () => reject(deliverySignal.reason);
      deliverySignal.addEventListener('abort', abort, { once: true });
      if (deliverySignal.aborted) abort();
    });
    let result;
    try {
      result = await Promise.race([entry.onEvent(evidence, { signal: deliverySignal }), interrupted]);
    } finally {
      deliverySignal.removeEventListener('abort', abort);
    }
    deliverySignal.throwIfAborted();
    if (this.#entries.get(botId) !== entry) throw refusal('consumer-unavailable');
    if (result?.accepted !== true) throw refusal('ingress-not-accepted');
    return { accepted: true };
  }

  signalFor(botId, fingerprint) {
    const entry = this.#entries.get(botId);
    if (!entry) throw refusal('consumer-unavailable');
    if (entry.fingerprint !== fingerprint) throw refusal('account-changed');
    return entry.controller.signal;
  }

  remove(botId) {
    const entry = this.#entries.get(botId);
    entry?.dispose();
  }

  close() {
    for (const botId of this.#entries.keys()) this.remove(botId);
  }
}
