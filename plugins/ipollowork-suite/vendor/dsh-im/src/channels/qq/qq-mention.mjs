// Keep the decision after the SDK sanitizes the mention out of the content.
const addressedToBot = Symbol('qq.addressedToBot');

function selfMentions(message) {
  return Array.isArray(message?.mentions)
    ? message.mentions.filter((mention) => mention?.is_you === true)
    : [];
}

export function isQqMessageAddressed(message) {
  return Boolean(message) && (message.kind !== 'group'
    || message[addressedToBot] === true
    || message.rawEventType === 'GROUP_AT_MESSAGE_CREATE'
    || selfMentions(message).length > 0);
}

/** botIds belongs to one runtime; only platform-marked self mentions add IDs. */
export function normalizeQqMentions(message, botIds = new Set()) {
  if (message?.kind !== 'group') return message;
  for (const mention of selfMentions(message)) {
    for (const id of [mention.id, mention.user_openid, mention.member_openid]) {
      if (typeof id === 'string' && id.trim()) botIds.add(id.trim());
    }
  }
  const marker = /<@!?([^<>\s]+)>/gu;
  const content = typeof message.content === 'string' ? message.content : '';
  // raw.content is still the current message, never the quoted message snapshot.
  const rawContent = typeof message.raw?.content === 'string' ? message.raw.content : '';
  const mentioned = isQqMessageAddressed(message)
    || [...`${content}\n${rawContent}`.matchAll(marker)].some((match) => botIds.has(match[1]));
  // Match the SDK sanitizer's in-place contract: later sender enrichment must
  // remain visible to the existing queued message and source-context capture.
  message[addressedToBot] = mentioned;
  message.content = content.replace(/<@!?([^<>\s]+)>[ \t]*/gu,
    (match, id) => botIds.has(id) ? '' : match).trim();
  return message;
}
