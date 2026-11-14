/**
 * The Semantic Message contract every channel adapter normalizes toward.
 *
 * CONTEXT.md separates what must stay platform-neutral (this shape and the
 * conversation route) from the native channel action (cards, edits, reactions,
 * threads as delivery targets). Only the former lives here; anything a channel
 * produces through its own API stays in the channel directory. The shape is a
 * duck-typed contract: existing channel-normalized messages already satisfy it
 * field by field, so adapters may adopt `createSemanticMessage` incrementally.
 */

/**
 * @typedef {Object} MessageRef
 * @property {string} id              Platform event/message id.
 * @property {?string} sender         Author identity of the referenced message.
 * @property {?number} timestamp      Origin ms when known.
 */

/**
 * @typedef {Object} SemanticMessage
 * @property {string} id
 * @property {string} channel
 * @property {?string} botId
 * @property {string} chatId          Room / chat id.
 * @property {?string} threadId       Thread root when the message lives in one.
 * @property {{id: string, name?: string}} sender
 * @property {number} timestamp       Origin ms; ingestion time when the platform hides it.
 * @property {string} content         Model-facing text, verbatim framing is producer-owned.
 * @property {?MessageRef} replyTo
 * @property {{mentionedBot: boolean, repliedToBot: boolean, commandLike: boolean}} trigger
 * @property {'dm'|'group'} kind
 */

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Validate and freeze one semantic message. Throws on identity-bearing fields;
 * optional fields normalize to null instead of throwing so an adapter can
 * forward a best-effort projection.
 * @param {Object} fields
 * @returns {SemanticMessage}
 */
export function createSemanticMessage({
  id, channel, botId = null, chatId, threadId = null,
  sender = {}, timestamp, content = '', replyTo = null, trigger = {}, kind = 'group',
} = {}) {
  if (typeof id !== 'string' || !id) throw new TypeError('A semantic message requires an id');
  if (typeof channel !== 'string' || !channel) throw new TypeError('A semantic message requires a channel');
  if (typeof chatId !== 'string' || !chatId) throw new TypeError('A semantic message requires a chat id');
  const senderId = clean(sender?.id);
  if (!senderId) throw new TypeError('A semantic message requires a sender id');
  const senderName = clean(sender?.name);
  const replyId = clean(replyTo?.id);
  return Object.freeze({
    id,
    channel,
    botId: clean(botId),
    chatId,
    threadId: clean(threadId),
    sender: Object.freeze(senderName ? { id: senderId, name: senderName } : { id: senderId }),
    timestamp: Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : Date.now(),
    content: typeof content === 'string' ? content : '',
    replyTo: replyId
      ? Object.freeze({ id: replyId, sender: clean(replyTo?.sender), timestamp: Number.isSafeInteger(replyTo?.timestamp) && replyTo.timestamp > 0 ? replyTo.timestamp : null })
      : null,
    trigger: Object.freeze({
      mentionedBot: trigger?.mentionedBot === true,
      repliedToBot: trigger?.repliedToBot === true,
      commandLike: trigger?.commandLike === true,
    }),
    kind: kind === 'direct' || kind === 'dm' ? 'dm' : 'group',
  });
}
