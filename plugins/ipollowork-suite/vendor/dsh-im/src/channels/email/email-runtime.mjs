import { extractConnectionEvidence, createConnectionDiagnostics, atConnectionStage } from '../shared/connection-error.mjs';
import { sendRememberedConnectionTest } from '../shared/connection-test.mjs';
import {
  EmailApi,
  normalizeAddress,
  parseMessageIds,
  resolveThreadKey,
  stripQuotedHistory,
} from './email-api.mjs';
import { createEmailBridgeStatus, EmailHarnessBridge } from './email-bridge.mjs';
import { EMAIL_CLIENT_DEFAULTS } from './config-store.mjs';

const DEFAULT_POLL_INTERVAL_MS = EMAIL_CLIENT_DEFAULTS.pollIntervalMs;

// The Agent mailbox API allows 10 requests a minute and 200 an hour, and a
// fixed retry interval burns that budget while the limit is already exceeded —
// so the mailbox never recovers. A rate-limited poll therefore backs off, and
// the delay doubles on each consecutive failure up to this ceiling.
const RATE_LIMIT_BACKOFF_MS = 60_000;

/**
 * The polling interval to use for a declared request budget.
 *
 * The provider publishes its limits at runtime (see `+me`), so the interval is
 * derived from them rather than hard-coded: a poll costs one request for the
 * list plus one per message read, and the provider's own numbers are the only
 * authoritative source. Half the per-minute budget is left for reads, replies
 * and anything else sharing the token, and the floor keeps a small budget from
 * producing an absurdly long interval.
 */
export function pollIntervalForLimits(limits, { perPollRequests = 2, floorMs = 20_000 } = {}) {
  const perMinute = Number(limits?.perMinute);
  if (!Number.isFinite(perMinute) || perMinute <= 0) return null;
  const usable = Math.max(1, Math.floor(perMinute / 2));
  const interval = Math.round((60_000 * perPollRequests) / usable);
  return Math.max(floorMs, interval);
}
const MAX_POLL_BACKOFF_MS = 15 * 60_000;

/**
 * How far behind the mailbox tip the first poll starts. Leaving a small window
 * means mail that lands while the channel is starting is not skipped, while the
 * rest of the backlog stays untouched.
 */
const FIRST_CONNECT_WINDOW = 10;

/** Skip auto-generated mail that would otherwise trigger a turn. */
const IGNORED_SENDER_PATTERNS = [
  /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce)/i,
  /^(noreply|notification|notifications|newsletter|marketing)/i,
];

function isAutomatedSender(address) {
  const local = String(address ?? '').split('@')[0] ?? '';
  return IGNORED_SENDER_PATTERNS.some((pattern) => pattern.test(local));
}

/**
 * True when a message declares itself an automatic reply (RFC 3834). Any value
 * other than "no" counts, matching the standard: "auto-replied",
 * "auto-generated", "auto-notified".
 */
export function isAutoSubmitted(parsed) {
  const raw = parsed?.headers?.get?.('auto-submitted')
    ?? (Array.isArray(parsed?.headerLines)
      ? parsed.headerLines.find((line) => /^auto-submitted:/i.test(line?.line ?? ''))?.line
        ?.slice('auto-submitted:'.length)
      : undefined);
  const value = String(raw ?? '').trim().toLowerCase();
  return value !== '' && value !== 'no';
}

/** Reply subject: keep one "Re:" prefix so threads stay grouped. */
export function replySubject(subject) {
  const text = String(subject ?? '').trim();
  if (!text) return 'Re: (no subject)';
  return /^re:/i.test(text) ? text : `Re: ${text}`;
}

/** Format one address list (To/Cc) as a compact "Name <addr>" string. */
function formatAddressList(value) {
  const entries = Array.isArray(value?.value) ? value.value : [];
  return entries
    .map((entry) => {
      const address = normalizeAddress(entry?.address);
      if (!address) return null;
      const name = String(entry?.name ?? '').trim();
      return name ? `${name} <${address}>` : address;
    })
    .filter(Boolean);
}

/**
 * Compose the text the model actually receives.
 *
 * Only the body used to be forwarded, so an instruction written in the subject
 * — a natural place for one — was silently dropped, and a message that also
 * went to other recipients looked like a private note. The subject and the
 * recipient lists are therefore prepended as a small header, and the original
 * body is left untouched below it.
 *
 * This form is for the model only. The shared layer parses `content` for
 * control commands and approval decisions, so a decorated string there makes
 * `/help` and "批准" unrecognisable — those read the plain body instead.
 */
export function mailHeader({ subject, parsed }) {
  const header = [];
  const cleanSubject = String(subject ?? '').trim();
  if (cleanSubject) header.push(`Subject: ${cleanSubject}`);

  const from = formatAddressList(parsed?.from)[0];
  if (from) header.push(`From: ${from}`);

  const to = formatAddressList(parsed?.to);
  if (to.length > 0) header.push(`To: ${to.join(', ')}`);

  const cc = formatAddressList(parsed?.cc);
  if (cc.length > 0) header.push(`Cc: ${cc.join(', ')}`);

  return header.length > 0 ? `${header.join('\n')}\n\n` : '';
}

/** The mail metadata above the original body, as one prompt string. */
export function mailPromptContent({ body, subject, parsed }) {
  const header = [];
  const cleanSubject = String(subject ?? '').trim();
  if (cleanSubject) header.push(`Subject: ${cleanSubject}`);

  const from = formatAddressList(parsed?.from)[0];
  if (from) header.push(`From: ${from}`);

  const to = formatAddressList(parsed?.to);
  if (to.length) header.push(`To: ${to.join(', ')}`);

  const cc = formatAddressList(parsed?.cc);
  if (cc.length) header.push(`Cc: ${cc.join(', ')}`);

  const text = String(body ?? '').trim();
  // A body-less mail (attachment only) still carries its header, so the model
  // sees what the message was about.
  if (header.length === 0) return text;
  return text ? `${header.join('\n')}\n\n${text}` : header.join('\n');
}

/**
 * Turn one parsed mail into the shared bridge's inbound message shape, or null
 * when the mail must be ignored (self-sent, automated, empty body).
 */
export function normalizeEmail(parsed, { address, state } = {}) {
  const messageId = parseMessageIds(parsed?.messageId)[0] ?? null;
  if (!messageId) return null;
  const from = normalizeAddress(parsed?.from?.value?.[0]?.address ?? parsed?.from?.text);
  if (!from) return null;
  // Loop break, per RFC 3834: anything marked as an automatic reply is never
  // answered, so this mailbox can safely be its own sender (writing to itself
  // to drive the Harness) without two bots echoing each other forever.
  if (isAutoSubmitted(parsed)) return null;
  if (isAutomatedSender(from)) return null;

  const references = parseMessageIds(parsed?.references);
  const inReplyTo = parseMessageIds(parsed?.inReplyTo);
  // A fixed binding pins the conversation, so every message routed to that
  // binding resolves to the same Harness session instead of a per-thread one.
  // Without a binding the thread chain decides, which keeps one Harness session
  // per mail thread.
  const boundSession = state?.boundSessionFor?.(from) ?? null;
  const conversationId = boundSession
    ? `bound:${boundSession}`
    : resolveThreadKey({
      messageId,
      references,
      inReplyTo,
      conversationMap: state?.threadMap ?? new Map(),
    });
  const body = stripQuotedHistory(parsed?.text ?? parsed?.html ?? '');
  const attachments = Array.isArray(parsed?.attachments) ? parsed.attachments : [];
  if (!body && attachments.length === 0) return null;

  const subject = String(parsed?.subject ?? '').trim();
  return {
    messageId,
    conversationId,
    kind: 'direct',
    senderId: from,
    addressed: true,
    // Email has no notion of a display name we can trust; the address is both.
    senderName: parsed?.from?.value?.[0]?.name || from,
    senderAlternateId: undefined,
    // The model needs the subject and the recipient lists; the parser must not
    // see them, or `/help` and "批准" stop being recognised. `content` carries
    // the decorated form and `controlText` the plain body.
    content: mailPromptContent({ body, subject, parsed }),
    controlText: body,
    plainText: typeof parsed?.text === 'string',
    images: [],
    files: attachments.map((attachment) => ({
      name: attachment.filename ?? 'attachment',
      size: attachment.size,
      // The shared inbound-file layer reads `mediaType` (not `mimeType`), so an
      // attachment type under any other key is silently dropped.
      ...(attachment.contentType ? { mediaType: String(attachment.contentType) } : {}),
      // The bridge streams files via a loader so large attachments are not
      // held in memory until they are actually needed. Transports differ in
      // what `content` is: IMAP hands over a Buffer (already fetched with the
      // body), while the Agent mailbox can only fetch bytes on demand and so
      // exposes a function. Returning that function unchanged made the loader
      // resolve to a function, which the inbound-file layer rejects as
      // `inbound-file-data-invalid` — the download never happened.
      load: async () => (typeof attachment.content === 'function'
        ? attachment.content()
        : attachment.content),
    })),
    reactionTarget: null,
    replyTarget: {
      to: from,
      subject: replySubject(subject),
      messageId,
      // Some transports address a message by their own id rather than the RFC
      // one (the Agent mailbox replies through /messages/{id}); carrying both
      // lets each transport use what it needs.
      transportMessageId: parsed?.uid ?? null,
      references: [...references, ...inReplyTo, messageId].slice(-10),
    },
    connectionTestTarget: { to: from, subject: 'DSH 连接测试' },
  };
}

/** Bot client handed to the shared bridge: only sending is needed here. */
class EmailBotClient {
  #api;
  #signal;
  #state;
  constructor(api, signal, state = null) {
    this.#api = api;
    this.#signal = signal;
    this.#state = state;
  }

  /**
   * Record the RFC Message-ID of our own reply in the thread map.
   *
   * A client that quotes only the immediate parent (iOS Mail sends a
   * one-entry References header) points its next reply at this id. Outgoing
   * ids were never registered, so the resolver found nothing familiar and
   * forked a brand-new session on every phone reply.
   */
  #rememberReply(target, sent) {
    const parentId = parseMessageIds(target?.messageId)[0] ?? null;
    const sentId = typeof sent?.messageId === 'string' ? sent.messageId : null;
    if (!parentId || !sentId) return sent;
    const conversation = this.#state?.conversationForThreadId?.(parentId) ?? null;
    if (conversation) this.#state.rememberThreadId(sentId, conversation);
    return sent;
  }

  async sendText(target, text) {
    const to = target?.to;
    if (!to) {
      const error = new TypeError('Email reply requires a recipient');
      error.code = 'invalid-target';
      throw error;
    }
    return this.#rememberReply(target, await this.#api.sendReply({
      to,
      subject: target.subject,
      text,
      inReplyTo: target.messageId,
      transportMessageId: target.transportMessageId,
      references: target.references,
    }));
  }

  sendTyping() {
    // Mail has no typing indicator; the shared bridge degrades gracefully.
    return Promise.resolve();
  }

  /**
   * Outbound artifacts arrive as the shared materialized shape
   * ({ fileName, mediaType, bytes }), the same structure every other channel
   * consumes — not the { name, content } form.
   */
  #attachmentFrom(file, fallbackName) {
    const bytes = file?.bytes ?? file?.data ?? file?.content;
    return {
      filename: file?.fileName ?? file?.name ?? fallbackName,
      content: bytes,
      ...(file?.mediaType ? { contentType: file.mediaType } : {}),
    };
  }

  async sendFile(target, file) {
    return this.#rememberReply(target, await this.#api.sendReply({
      to: target?.to,
      subject: target?.subject,
      text: '',
      inReplyTo: target?.messageId,
      transportMessageId: target?.transportMessageId,
      references: target?.references,
      attachments: [this.#attachmentFrom(file, 'attachment')],
    }));
  }

  async sendImage(target, image) {
    return this.#rememberReply(target, await this.#api.sendReply({
      to: target?.to,
      subject: target?.subject,
      text: '',
      inReplyTo: target?.messageId,
      transportMessageId: target?.transportMessageId,
      references: target?.references,
      attachments: [this.#attachmentFrom(image, 'image')],
    }));
  }
}

export function createEmailRuntimeStatus() {
  return {
    startedAt: null,
    ready: false,
    connectionState: 'idle',
    harnessReachable: false,
    lastCheckedAt: null,
    lastConnectedAt: null,
    lastError: null,
    ...createEmailBridgeStatus(),
  };
}

export class EmailRuntime {
  #config;
  #token;
  #harness;
  #state;
  #contextEnhancement;
  #accessPolicy;
  #logger;
  #diagnostics;
  #replyTimeoutMs;
  #pollIntervalMs;
  // Current delay between polls; grows on failure and resets on success.
  #pollDelayMs;
  #consecutivePollFailures = 0;
  #createApi;
  #credential = null;
  #onTokensRefreshed;
  #status = createEmailRuntimeStatus();
  // Turns started by the poll loop, kept so `stop()` can wait for them and so
  // a failure is reported instead of surfacing as an unhandled rejection.
  #deliveries = new Set();
  // Message keys handed to the bridge but not yet finished, so a re-listing
  // during processing cannot deliver the same message twice.
  #inFlight = new Set();
  #api;
  #bridge;
  #abortController;
  #timer;
  #polling;
  #stopped = true;

  constructor({
    config, token, harness, state, contextEnhancement, accessPolicy, logger = console,
    replyTimeoutMs = 600_000, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    // The caller supplies a transport chosen from the mailbox's config; the
    // default exists for direct construction (tests) and assumes IMAP/SMTP.
    createApi = (options) => new EmailApi(options),
    credential = null, onTokensRefreshed = null, createTransport = null,
  }) {
    // `token` is absent for a transport that authenticates another way: the
    // Agent mailbox lets agently-cli hold the credentials in the system
    // keychain, so requiring one here blocked it from ever starting.
    if (!config || !harness || !state) {
      throw new TypeError('EmailRuntime requires config, Harness, and state');
    }
    this.#config = config;
    this.#token = token;
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#accessPolicy = accessPolicy;
    this.#logger = logger; this.#diagnostics = createConnectionDiagnostics({ channel: 'email', logger });
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#pollIntervalMs = pollIntervalMs;
    this.#pollDelayMs = pollIntervalMs;
    // A caller-supplied transport wins; it is what knows the mailbox's protocol.
    this.#createApi = typeof createTransport === 'function' ? createTransport : createApi;
    this.#credential = credential ?? null;
    this.#onTokensRefreshed = typeof onTokensRefreshed === 'function' ? onTokensRefreshed : null;
  }

  get status() {
    return structuredClone(this.#status);
  }

  async sendConnectionTest(text) {
    if (!this.#status.ready || !this.#api) {
      const error = new Error('Email mailbox is not connected');
      error.code = 'test-target-unavailable';
      throw error;
    }
    await sendRememberedConnectionTest({
      state: this.#state,
      text,
      channelLabel: 'Email',
      send: (target, value) => this.#api.sendReply({
        to: target.to,
        subject: target.subject ?? 'DSH 连接测试',
        text: value,
      }),
    });
  }

  async sendProactiveText(target, text, options = {}) {
    if (!this.#status.ready || !this.#api) {
      const error = new Error('Email mailbox is not connected');
      error.code = 'bot-not-connected';
      throw error;
    }
    const to = normalizeAddress(target?.route?.address);
    if (!to) {
      const error = new TypeError('Invalid Email proactive delivery target');
      error.code = 'invalid-target';
      throw error;
    }
    await this.#api.sendText({ to, subject: target?.route?.subject ?? 'DSH 消息', text });
    return { sent: true };
  }

  async start() {
    if (this.#status.ready) return this.status;
    await this.stop();
    this.#stopped = false;
    this.#status.startedAt = new Date().toISOString();
    this.#status.connectionState = 'connecting';
    this.#abortController = new AbortController();
    try {
      await atConnectionStage('harness.check', () => this.#harness.ensureRunning());
      this.#status.harnessReachable = true;
      const api = this.#createApi({
        config: {
          address: this.#config.platformId,
          // Which protocol to speak. Omitting it fell back to IMAP/SMTP, so an
          // Agent mailbox was dialled as if it were a mail server and failed
          // with ECONNREFUSED.
          transport: this.#config.transport,
          // A standard mailbox authenticates with the app password; the Agent
          // mailbox has none and carries an OAuth pair instead.
          password: this.#token,
          ...(this.#credential?.accessToken ? { accessToken: this.#credential.accessToken } : {}),
          ...(this.#credential?.refreshToken ? { refreshToken: this.#credential.refreshToken } : {}),
          imapHost: this.#config.imapHost,
          imapPort: this.#config.imapPort,
          smtpHost: this.#config.smtpHost,
          smtpPort: this.#config.smtpPort,
          mailbox: this.#config.mailbox ?? EMAIL_CLIENT_DEFAULTS.mailbox,
        },
        signal: this.#abortController.signal,
        // Token refresh must be persisted; the controller owns that write.
        ...(typeof this.#onTokensRefreshed === 'function'
          ? { onTokensRefreshed: this.#onTokensRefreshed } : {}),
      });
      this.#api = api;
      if (this.#state.cursor() === null) {
        // On first connect the existing backlog must not be replayed as new
        // instructions, so polling starts near the mailbox tip. A small window
        // before the tip is still scanned though: a message that arrives while
        // the channel is starting up would otherwise be skipped forever. Those
        // few older messages are filtered by the sender allowlist and the
        // seen-message set, so the window cannot re-drive old requests.
        const tip = await api.latestUid();
        // IMAP numbers messages, so a small window can be stepped back to pick
        // up mail that arrived during startup.
        //
        // A transport with an opaque cursor treats it as "already handled", so
        // seeding it with the newest id discarded that message forever. Starting
        // with no cursor is safe: the allowlist and the seen-message set still
        // stop history from re-driving old requests.
        if (Number.isSafeInteger(tip)) {
          await this.#state.setCursor(Math.max(0, tip - FIRST_CONNECT_WINDOW));
        }
      }
      const client = new EmailBotClient(api, this.#abortController.signal, this.#state);
      this.#bridge = new EmailHarnessBridge({
        bot: client,
        harness: this.#harness,
        state: this.#state,
        contextEnhancement: this.#contextEnhancement,
        accessPolicy: this.#accessPolicy,
        status: this.#status,
        logger: this.#logger,
        replyTimeoutMs: this.#replyTimeoutMs,
        signal: this.#abortController.signal,
      });
      this.#status.ready = true;
      this.#status.connectionState = 'connected';
      this.#status.lastConnectedAt = Date.now();
      this.#schedulePoll(0);
      return this.status;
    } catch (error) {
      this.#status.ready = false;
      this.#status.connectionState = 'failed';
      this.#status.error = this.#diagnostics.report(error, { operation: 'connection.monitor', botId: this.#config?.botId, automatic: true }).publicError;
      this.#status.lastError = this.#status.error.message;
      await this.stop();
      throw error;
    }
  }

  async stop() {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#timer = null;
    this.#abortController?.abort();
    await this.#polling?.catch(() => {});
    this.#polling = null;
    // Deliveries are no longer awaited by the poll loop, so shutdown waits for
    // them here instead of dropping a turn mid-flight.
    await this.whenIdle({ timeoutMs: 1_000 });
    const api = this.#api;
    this.#api = null;
    this.#bridge = null;
    if (api) await api.disconnect().catch(() => {});
    this.#status.ready = false;
  }

  #schedulePoll(delay) {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#polling = this.#poll().finally(() => this.#schedulePoll(this.#pollDelayMs));
    }, delay);
    this.#timer.unref?.();
  }

  /**
   * Start a delivery without blocking the poll loop.
   *
   * The promise is retained rather than dropped: `stop()` waits on the set, and
   * a rejection is logged here so it cannot become an unhandled rejection.
   */
  #track(promise) {
    if (!promise || typeof promise.then !== 'function') return;
    const task = promise
      .catch((error) => {
        if (this.#stopped) return;
        this.#status.lastMessageError = this.#safeMessageError(error);
        this.#logger.warn?.('[dsh-im:email] delivery failed', extractConnectionEvidence(error).details);
      })
      .finally(() => { this.#deliveries.delete(task); });
    this.#deliveries.add(task);
  }

  /**
   * Hand one message to the bridge, exactly once.
   *
   * The poll loop can re-list a message before the bridge has recorded it: the
   * bridge writes its "already handled" entry only once processing starts, and
   * the loop no longer waits for that. This set is the loop's own guard against
   * handing the same message over twice — the bridge remains the authority on
   * what has actually been processed.
   *
   * Marking the message seen here instead (as the loop used to) ran *ahead* of
   * the bridge's queue: by the time `#process` started, `hasSeen` was already
   * true and the message was dropped silently.
   */
  #deliver(message, seenKey) {
    const key = seenKey ?? message?.messageId;
    const tracked = key !== undefined && key !== null && key !== '';
    if (tracked) {
      if (this.#inFlight.has(key)) return Promise.resolve();
      this.#inFlight.add(key);
    }
    return Promise.resolve(this.#bridge.accept(message)).finally(() => {
      if (tracked) this.#inFlight.delete(key);
    });
  }

  /** The bridge in use, so a caller can observe or steer delivery. */
  get bridge() {
    return this.#bridge;
  }

  /**
   * Wait for the deliveries started by the poll loop.
   *
   * Bounded: a delivery whose Harness turn is parked on an approval never
   * settles, and shutdown must not hang on it. The abort signal is raised
   * before this is called, so a parked turn is already being torn down.
   */
  async whenIdle({ timeoutMs = 5_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (this.#deliveries.size > 0 && Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const settled = await Promise.race([
        Promise.allSettled([...this.#deliveries]).then(() => true),
        // Deliberately NOT unref'd. An unref'd timer does not hold the event
        // loop open, so when it is the only pending handle the process can
        // finish before it fires — leaving this race unresolved forever and
        // hanging whoever awaited it. That is exactly what wedged CI: the
        // parked-delivery test replaced `accept` with a never-settling promise,
        // `stop()` awaited this race, and the timer never got to run.
        new Promise((resolve) => { setTimeout(() => resolve(false), remaining); }),
      ]);
      if (!settled) break;
    }
    // The bound is a deliberate trade-off: a turn parked on an approval never
    // settles, and unload must not hang on it. Work that outlives the bound is
    // ABANDONED — `stop()` nulls the api right after this returns, so such a
    // turn can no longer reply. Report it rather than dropping it silently.
    const abandoned = this.#deliveries.size;
    if (abandoned > 0) {
      this.#logger.warn?.(
        `[dsh-im:email] shutdown abandoned ${abandoned} in-flight delivery(ies); `
        + 'their replies will not be sent',
      );
    }
    return abandoned;
  }

  /** A short, log-safe description of a delivery failure. */
  #safeMessageError(error) {
    const code = typeof error?.code === 'string' ? error.code : null;
    const message = typeof error?.message === 'string' ? error.message : '';
    return { code: code ?? 'delivery-failed', message: message.slice(0, 200) };
  }

  async #poll() {
    if (!this.#api || !this.#bridge || this.#stopped) return;
    try {
      const cursor = this.#state.cursor() ?? 0;
      // Pass the mailbox allowlist down so unlisted mail is never downloaded.
      const allowSenders = new Set(
        (this.#config.allowedSenders ?? []).map((a) => String(a).trim().toLowerCase()),
      );
      const messages = await this.#api.listMessages({ afterUid: cursor, limit: 25, allowSenders });
      for (const parsed of messages) {
        // Transports address messages by an integer UID (IMAP) or an opaque
        // string id (Agent mailbox); the cursor follows whichever it is.
        const uid = parsed?.uid;
        const message = normalizeEmail(parsed, { address: this.#config.platformId, state: this.#state });
        // The seen set is the real guard against re-processing. A cursor marks a
        // boundary, but a listing that shifts underneath it (mail moved or
        // deleted) loses that boundary and replays everything. Keyed on the RFC
        // Message-ID, which every transport provides.
        const seenKey = message?.messageId
          ?? (uid === undefined || uid === null ? null : String(uid));
        if (seenKey && this.#state.hasSeen(seenKey)) {
          if (uid !== undefined && uid !== null && uid !== '' && uid !== cursor) {
            await this.#state.setCursor(uid);
          }
          continue;
        }
        if (message) {
          // Remember the thread chain before the turn runs so a reply that
          // arrives while the turn is still working still joins this session.
          for (const id of [message.messageId, ...message.replyTarget.references]) {
            this.#state.rememberThreadId(id, message.conversationId);
          }
          // Deliberately not awaited. `accept` resolves only when the whole
          // Harness turn finishes, and a turn that is waiting for an approval
          // or an answer blocks the poll loop — so later mail stayed unread
          // until someone replied. The bridge already serialises per
          // conversation, so ordering is preserved without waiting here.
          //
          // The bridge owns the "already handled" record, and it only writes it
          // once the message is actually being processed. The poll loop must not
          // mark the message seen as well: doing it here runs *ahead* of the
          // bridge's queue, so by the time `#process` starts, `hasSeen` is
          // already true and the message is dropped silently. The loop therefore
          // only rotates the in-flight set — it is the ordering guard that stops
          // a re-listing from handing the same message to the bridge twice.
          this.#track(this.#deliver(message, seenKey));
          if (uid !== undefined && uid !== null && uid !== '' && uid !== cursor) {
            await this.#state.setCursor(uid);
          }
        }
      }
      this.#status.lastCheckedAt = Date.now();
      this.#status.lastError = null; this.#status.error = null; this.#diagnostics.clear();
      // A poll that works is the proof the mailbox is reachable.
      this.#status.connectionState = 'connected';
      this.#consecutivePollFailures = 0;
      this.#pollDelayMs = this.#pollIntervalMs;
    } catch (error) {
      if (!this.#stopped) {
        this.#status.error = this.#diagnostics.report(error, { operation: 'connection.monitor', botId: this.#config?.botId, automatic: true }).publicError;
        this.#status.lastError = this.#status.error.message;
        // A failing poll means the mailbox is NOT usable, even though the
        // transport opened; leaving this as "connected" reported a healthy
        // channel while no mail could be read at all.
        this.#status.connectionState = 'failed';
        this.#consecutivePollFailures += 1;

        // Retrying a rate-limited endpoint on a fixed interval keeps the limit
        // exceeded, so the mailbox never comes back. Back off instead — and
        // wait longer each time, because the hourly window refills slowly.
        const limited = isRateLimitError(error);
        const base = limited ? RATE_LIMIT_BACKOFF_MS : this.#pollIntervalMs;
        this.#pollDelayMs = Math.min(
          base * (2 ** Math.min(this.#consecutivePollFailures - 1, 5)),
          MAX_POLL_BACKOFF_MS,
        );
        this.#status.retryAt = Date.now() + this.#pollDelayMs;
        if (limited) this.#status.rateLimited = true;


      }
    }
  }
}

/** Whether an error is the provider refusing us for exceeding a rate limit. */
export function isRateLimitError(error) {
  if (error?.status === 429 || error?.httpStatus === 429) return true;
  const code = String(error?.code ?? '');
  if (code === 'rate-limited' || code === 'RATE_LIMIT_EXCEEDED' || code === '429') return true;
  const text = String(error?.message ?? '');
  return /rate limit|too many requests|429/i.test(text);
}
