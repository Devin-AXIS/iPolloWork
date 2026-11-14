/**
 * Compatibility surface for the mailbox channel.
 *
 * The implementation moved to a transport seam so a second mail protocol can
 * be added without another channel:
 *   mail-format.mjs              transport-independent helpers
 *   transports/imap-smtp.mjs     standard IMAP/SMTP mailbox
 *
 * This module re-exports those so existing imports keep working.
 */
export {
  MAX_REPLY_CHARS,
  imapSecurity,
  normalizeAddress,
  parseMessageIds,
  resolveThreadKey,
  smtpSecurity,
  stripQuotedHistory,
} from './mail-format.mjs';
export { ImapSmtpTransport, ImapSmtpTransport as EmailApi } from './transports/imap-smtp.mjs';
