/**
 * Shared mail formatting and thread helpers.
 *
 * These are transport-independent: quote stripping, thread resolution, address
 * normalization, and the TLS-mode derivation used by the IMAP/SMTP transport.
 */

/** Reply text longer than this is truncated so it survives mail gateways. */
const MAX_REPLY_CHARS = 100_000;

/**
 * Quoted-history markers. Mail clients append the whole prior conversation to
 * every reply; leaving it in place would grow the prompt each turn and confuse
 * the model, so the body is cut at the first marker.
 */
const QUOTE_MARKERS = [
  /^On .{10,120} wrote:$/mi,
  /^-{2,}\s*Original Message\s*-{2,}$/mi,
  /^在 .{4,60}(写道|寫道)[:：]?\s*$/mi,
  /^-{2,}\s*原始邮件\s*-{2,}$/mi,
  /^\s*_{10,}\s*$/m,
  /^From:\s.+$/mi,
  /^发件人[:：]\s*.+$/mi,
];

/** Cut a mail body at the first quoted-history marker. */
export function stripQuotedHistory(text) {
  const body = String(text ?? '').replace(/\r\n/g, '\n');
  let cut = body.length;
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(body);
    if (match && match.index > 0 && match.index < cut) cut = match.index;
  }
  return body
    .slice(0, cut)
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Derive the transport security mode from the port, which is how mail clients
 * decide in practice: 465 is implicit TLS, 587 and 25 negotiate STARTTLS, and
 * anything else is left to the explicit `secure` flag. Treating 587 as
 * implicit TLS is the classic misconfiguration that makes SMTP hang.
 */
export function smtpSecurity(port, secure) {
  if (secure === true) return { secure: true };
  if (secure === false) return { secure: false, requireTLS: true };
  if (port === 465) return { secure: true };
  if (port === 587 || port === 25 || port === 2525) return { secure: false, requireTLS: true };
  return { secure: false };
}

/** IMAP uses implicit TLS on 993 and STARTTLS otherwise. */
export function imapSecurity(port, secure) {
  if (secure !== undefined) return { secure: secure !== false };
  return { secure: port === 993 };
}

/** Collect every message id from a header value (References / In-Reply-To). */
export function parseMessageIds(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(' ') : String(value);
  return (raw.match(/<[^<>@\s]+@[^<>\s]+>/g) ?? []).map((id) => id.trim());
}

/**
 * Resolve the thread key for a message: an existing conversation is reused when
 * the reply chain points at a message we have seen before, otherwise the
 * message starts a new conversation.
 */
export function resolveThreadKey({ messageId, references = [], inReplyTo = [], conversationMap }) {
  const chain = [...parseMessageIds(references), ...parseMessageIds(inReplyTo)];
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const key = conversationMap.get(chain[index]);
    if (key) return key;
  }
  return parseMessageIds(messageId)[0] ?? `email:${Date.now()}`;
}

/** Lowercase a bare address, keeping only the addr-spec part. */
export function normalizeAddress(value) {
  const text = String(value ?? '').trim().toLowerCase();
  const angled = /<([^<>]+)>/.exec(text);
  return (angled ? angled[1] : text).trim();
}

export { MAX_REPLY_CHARS };
