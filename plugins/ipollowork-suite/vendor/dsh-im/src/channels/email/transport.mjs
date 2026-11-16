/**
 * Mailbox transport contract.
 *
 * A transport moves mail; it owns nothing else. Conversation mapping, the
 * sender allowlist, quote stripping, session binding, and loop prevention all
 * live in the runtime and are shared by every transport — so adding a mail
 * protocol means writing one adapter here, not another channel.
 *
 * Implementations:
 *   imap-smtp   any standard mailbox, polled over IMAP and sent over SMTP
 *   agent-mail  Tencent Agent Mail (agent.qq.com), HTTP + OAuth, long-polled
 *
 * Required methods:
 *   connect()                        open the underlying connection
 *   disconnect()                     close it; must be safe to call twice
 *   latestUid()                      highest cursor value currently present
 *   listMessages({ afterUid, limit, allowSenders })
 *                                    messages newer than the cursor, already
 *                                    filtered to allowlisted senders when a
 *                                    set is supplied
 *   sendReply({ to, subject, text, inReplyTo, references, attachments })
 *                                    send inside the originating conversation
 *   sendText({ to, subject, text, attachments })
 *                                    send a standalone message
 *
 * A message returned by listMessages() is a mailparser-shaped object with a
 * `uid` added:
 *   { uid, messageId, from, to, cc, subject, text, html, attachments, headers }
 * `attachments[]` entries carry { filename, contentType, size, content }.
 */

/** Methods every transport must provide. */
export const TRANSPORT_METHODS = Object.freeze([
  'connect',
  'disconnect',
  'latestUid',
  'listMessages',
  'sendReply',
  'sendText',
]);

/** Default reply subject: one "Re:" prefix so threads stay grouped. */
export function replySubject(subject) {
  const text = String(subject ?? '').trim();
  if (!text) return 'Re: (no subject)';
  return /^re:/i.test(text) ? text : `Re: ${text}`;
}

/**
 * Assert that a value satisfies the transport contract. Called when a
 * transport is constructed so a malformed adapter fails at the boundary
 * rather than part-way through a poll.
 */
export function assertTransport(transport, label = 'transport') {
  if (!transport || typeof transport !== 'object') {
    throw new TypeError(`${label} must be an object`);
  }
  for (const method of TRANSPORT_METHODS) {
    if (typeof transport[method] !== 'function') {
      throw new TypeError(`${label} must implement ${method}()`);
    }
  }
  return transport;
}
