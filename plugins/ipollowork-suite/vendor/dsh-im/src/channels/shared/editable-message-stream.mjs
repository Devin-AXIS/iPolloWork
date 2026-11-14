import { t } from './i18n.mjs';

export function splitMessageText(value, limit) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return [];
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n', limit);
    if (cut < Math.floor(limit * 0.55)) cut = remaining.lastIndexOf(' ', limit);
    if (cut < Math.floor(limit * 0.55)) cut = limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function createEditableMessageStream({
  initialText = t('正在处理…'),
  limit,
  updateIntervalMs = 800,
  create,
  edit,
  sendRemainder,
  messageIdForResult = () => null,
  logger = console,
}) {
  let messageId;
  const providerMessageIds = [];
  let pending = null;
  let timer = null;
  let inFlight = null;
  let closed = false;
  let lastSent = initialText;

  const schedule = () => {
    if (closed || timer !== null || inFlight || !pending) return;
    timer = setTimeout(() => {
      timer = null;
      const text = pending;
      pending = null;
      const next = splitMessageText(text, limit)[0] ?? initialText;
      inFlight = Promise.resolve(next === lastSent ? undefined : edit(messageId, next))
        .then(() => { lastSent = next; })
        .catch((error) => logger.warn?.('[dsh-im] streamed message update failed:', error))
        .finally(() => {
          inFlight = null;
          schedule();
        });
    }, updateIntervalMs);
    timer?.unref?.();
  };

  return {
    get messageId() {
      return messageId;
    },
    get providerMessageIds() {
      return [...providerMessageIds];
    },
    async start() {
      messageId = await create(initialText);
      if ((typeof messageId === 'string' && messageId.trim()) || Number.isSafeInteger(messageId)) {
        providerMessageIds.push(String(messageId));
      }
      return this;
    },
    update(text) {
      if (closed || typeof text !== 'string' || !text.trim()) return;
      pending = text;
      schedule();
    },
    async finish(text) {
      if (closed) throw new Error('Message stream is already closed');
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      await inFlight?.catch(() => undefined);
      const chunks = splitMessageText(text, limit);
      const first = chunks[0] ?? t('处理完成。');
      if (first !== lastSent) await edit(messageId, first);
      lastSent = first;
      for (const chunk of chunks.slice(1)) {
        const result = await sendRemainder(chunk);
        const id = messageIdForResult(result);
        if ((typeof id === 'string' && id.trim()) || Number.isSafeInteger(id)) {
          providerMessageIds.push(String(id));
        }
      }
    },
    cancel() {
      closed = true;
      pending = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
