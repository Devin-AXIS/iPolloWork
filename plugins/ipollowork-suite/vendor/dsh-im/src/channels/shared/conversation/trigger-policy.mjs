/**
 * The trigger rule table: which inbound message may wake the AI, and which is
 * only recorded by the channel. The rules are a pure function over the bits an
 * adapter already extracted (mention, command shape, reply relation) plus an
 * optional synchronous classification of a reply's target, so the decision is
 * testable without any transport.
 *
 * `replyMode` is what separates the product shapes a room bot can have; the
 * shipped default is `never`, so a room only wakes the bot through an
 * @-mention or a command:
 * - `never`: replies never address the bot; only mentions and commands do.
 * - `bot-only`: only replies that provably answer one of the bot's own messages
 *   address it; a reply to a human message is not a trigger and an
 *   unclassifiable target stays unaddressed too, so the classifier (usually the
 *   bot-event binding table) must be wired before this mode is enabled.
 * - `any`: the 4.25-era room shape — a reply relation anywhere addresses the bot.
 */

export const TRIGGER_REPLY_MODES = Object.freeze(['any', 'bot-only', 'never']);

export function normalizeTriggerPolicy({ requireMention = true, freeResponse = false, replyMode = 'never' } = {}) {
  return Object.freeze({
    requireMention: requireMention !== false,
    freeResponse: freeResponse === true,
    replyMode: TRIGGER_REPLY_MODES.includes(replyMode) ? replyMode : 'never',
  });
}

/**
 * @typedef {Object} TriggerDecision
 * @property {boolean} pass      Whether the inbound funnel may keep the message.
 * @property {boolean} addressed Whether the message counts as addressed.
 * @property {string} reason     Stable drop/accept label ('mention', 'command', 'reply',
 *   'reply-to-human', 'reply-target-unknown', 'dm', 'free-response', 'mention-required', ...).
 */

/**
 * Decide the mention gate and the addressed bit for one message.
 * @param {Object} input
 * @param {'group'|'direct'|'dm'} input.kind
 * @param {boolean} [input.requireMention=true]
 * @param {boolean} [input.freeResponse=false]  Room-level override that opens the gate.
 * @param {boolean} [input.mentioned=false]
 * @param {boolean} [input.commandLike=false]
 * @param {boolean} [input.replyToPresent=false]
 * @param {('bot'|'human'|null)} [input.replyTargetKind=null] Synchronous classification of the reply target.
 * @param {('any'|'bot-only'|'never')} [input.replyMode='never']
 * @returns {TriggerDecision}
 */
export function evaluateTrigger({
  kind = 'group',
  requireMention = true,
  freeResponse = false,
  mentioned = false,
  commandLike = false,
  replyToPresent = false,
  replyTargetKind = null,
  replyMode = 'never',
} = {}) {
  const policy = normalizeTriggerPolicy({ requireMention, freeResponse, replyMode });
  if (kind === 'direct' || kind === 'dm') return Object.freeze({ pass: true, addressed: true, reason: 'dm' });
  const gateOpen = !policy.requireMention || policy.freeResponse;
  const replyCounts = replyToPresent && policy.replyMode !== 'never'
    && !(policy.replyMode === 'bot-only' && replyTargetKind !== 'bot');
  const addressed = mentioned === true || commandLike === true || replyCounts;
  if (!gateOpen && !addressed) {
    if (policy.replyMode === 'bot-only' && replyToPresent && replyTargetKind === 'human') {
      return Object.freeze({ pass: false, addressed: false, reason: 'reply-to-human' });
    }
    if (policy.replyMode === 'bot-only' && replyToPresent && replyTargetKind == null) {
      return Object.freeze({ pass: false, addressed: false, reason: 'reply-target-unknown' });
    }
    return Object.freeze({ pass: false, addressed: false, reason: 'mention-required' });
  }
  const reason = mentioned === true ? 'mention'
    : commandLike === true ? 'command'
      : replyCounts ? 'reply'
        : gateOpen ? 'free-response' : 'other';
  return Object.freeze({ pass: true, addressed, reason });
}
