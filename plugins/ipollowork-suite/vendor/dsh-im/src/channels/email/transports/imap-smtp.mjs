/**
 * Standard mailbox transport: IMAP receive + SMTP send.
 *
 * One dedicated mailbox (the bot identity). Inbound mail is polled over IMAP;
 * replies go back over SMTP inside the same mail thread. Everything above the
 * transport — thread mapping, allowlist, quote stripping, loop prevention —
 * is shared with every other transport.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

import {
  MAX_REPLY_CHARS, imapSecurity, normalizeAddress, smtpSecurity,
} from '../mail-format.mjs';

export class ImapSmtpTransport {
  #config;
  #signal;
  #imap = null;
  #transport = null;

  constructor({ config, signal } = {}) {
    if (!config?.address || !config?.password) {
      throw new TypeError('ImapSmtpTransport requires an address and password');
    }
    this.#config = config;
    this.#signal = signal;
  }

  get address() {
    return this.#config.address;
  }

  /** Open the IMAP connection and select the monitored mailbox. */
  async connect() {
    if (this.#imap?.usable) return;
    this.#imap?.close();
    this.#imap = null;
    const client = new ImapFlow({
      host: this.#config.imapHost,
      port: this.#config.imapPort,
      ...imapSecurity(this.#config.imapPort, this.#config.imapSecure),
      auth: { user: this.#config.address, pass: this.#config.password },
      logger: false,
      ...(this.#config.rejectUnauthorized === false ? { tls: { rejectUnauthorized: false } } : {}),
    });
    // The next poll reconnects after a socket closes. A late event from an
    // old client must never discard its healthy replacement.
    client.on('close', () => {
      if (this.#imap === client) this.#imap = null;
    });
    client.on('error', () => client.close());
    try {
      await client.connect();
      await client.mailboxOpen(this.#config.mailbox ?? 'INBOX');
      this.#imap = client;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  async disconnect() {
    const client = this.#imap;
    this.#imap = null;
    if (client) await client.logout().catch(() => client.close?.());
  }

  /** Highest UID currently in the mailbox, used to skip pre-existing mail. */
  async latestUid() {
    await this.connect();
    const status = await this.#imap.status(this.#config.mailbox ?? 'INBOX', { uidNext: true, messages: true });
    const next = Number(status?.uidNext);
    return Number.isFinite(next) && next > 1 ? next - 1 : 0;
  }

  /**
   * Fetch messages with a UID greater than `afterUid`.
   *
   * The sender is read from the lightweight envelope first and checked against
   * `allowSenders` before the body is requested. A monitored mailbox also
   * receives ordinary personal mail, and that content must not be downloaded
   * or parsed at all — not merely filtered after the fact.
   */
  async listMessages({ afterUid = 0, limit = 25, allowSenders = null } = {}) {
    await this.connect();
    const mailbox = this.#config.mailbox ?? 'INBOX';
    // A Set — even an empty one — means the caller supplied a policy: an
    // empty allowlist admits nobody, so no body is fetched at all. Treating
    // it as "no filter" downloaded mail the policy had already refused.
    const allowed = allowSenders instanceof Set ? allowSenders : null;

    // Step 1: read only the lightweight envelopes. ImapFlow cannot run a second
    // fetch while one is being iterated, so the accepted UIDs are collected
    // first and their bodies pulled afterwards.
    const accepted = [];
    for await (const message of this.#imap.fetch(
      { uid: `${afterUid + 1}:*` },
      { uid: true, envelope: true },
      { uid: true },
    )) {
      // A range fetch that matches nothing still yields the last message, so
      // the UID bound is re-checked here.
      if (!Number.isFinite(message.uid) || message.uid <= afterUid) continue;
      if (allowed) {
        const from = normalizeAddress(message.envelope?.from?.[0]?.address);
        if (!from || !allowed.has(from)) continue;
      }
      accepted.push(message.uid);
      if (accepted.length >= limit) break;
    }

    // Step 2: fetch and parse the bodies of accepted senders only. Mail from
    // anyone else is never downloaded, so its content is not read at all.
    const found = [];
    for (const uid of accepted) {
      const source = await this.#fetchSource(uid);
      if (!source) continue;
      const parsed = await simpleParser(source);
      // Carry the UID alongside the parsed mail: it is the polling cursor and
      // is not part of the RFC822 source.
      parsed.uid = uid;
      found.push(parsed);
    }
    await this.#imap.mailboxOpen(mailbox, { readOnly: false }).catch(() => {});
    return found;
  }

  /** Read one message's RFC822 source by UID. */
  async #fetchSource(uid) {
    // A failed read must fail the poll, otherwise a later message could move
    // the cursor past this unread mail. A vanished message still returns null.
    const message = await this.#imap.fetchOne(String(uid), { source: true }, { uid: true });
    return message?.source ?? null;
  }

  /** Send a reply inside the originating thread. */
  async sendReply({ to, subject, text, inReplyTo, references, attachments = [] } = {}) {
    const body = String(text ?? '').slice(0, MAX_REPLY_CHARS);
    const transport = await this.#transportFor();
    const info = await transport.sendMail({
      from: this.#config.from ?? this.#config.address,
      to,
      subject: subject || '(no subject)',
      text: body,
      // RFC 3834: mark this as an automatic reply so any bot on the other side
      // (including this mailbox replying to itself) can refuse to auto-answer
      // it. That is the standard loop break, and it lets a mailbox accept its
      // own address as a sender without risking an endless exchange.
      headers: { 'Auto-Submitted': 'auto-replied' },
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(references?.length ? { references: references.join(' ') } : {}),
      ...(attachments.length ? { attachments } : {}),
    });
    return { sent: true, messageId: info?.messageId ?? null };
  }

  /** Send a standalone message (proactive delivery, no thread). */
  async sendText({ to, subject, text, attachments = [] } = {}) {
    return this.sendReply({ to, subject, text, attachments });
  }

  async #transportFor() {
    if (this.#transport) return this.#transport;
    this.#transport = nodemailer.createTransport({
      host: this.#config.smtpHost,
      port: this.#config.smtpPort,
      ...smtpSecurity(this.#config.smtpPort, this.#config.smtpSecure),
      auth: { user: this.#config.address, pass: this.#config.password },
      ...(this.#config.rejectUnauthorized === false ? { tls: { rejectUnauthorized: false } } : {}),
    });
    return this.#transport;
  }
}
