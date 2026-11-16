/**
 * Agent mailbox transport, backed by the official `agently-cli`.
 *
 * This transport speaks the same contract as the IMAP/SMTP one
 * (`transport.mjs`); only the wire protocol differs. All protocol knowledge —
 * OAuth, token storage, refresh, retry — belongs to the CLI, which is the only
 * implementation the server accepts refresh tokens from.
 *
 * Command shapes come from `--print-output-schema`, not guesswork.
 */

import {
  AgentMailCliError,
  cliEnv,
  isCliAvailable,
  runCli,
  startCliLogin,
} from './agently-cli.mjs';
import {
  MAX_REPLY_CHARS,
  normalizeAddress,
  stripQuotedHistory,
} from '../mail-format.mjs';
import { assertTransport, replySubject } from '../transport.mjs';

/** Re-exported so callers keep one import site for Agent mailbox errors. */
export { AgentMailCliError as AgentMailError };

/** How many messages one poll may return. */
const DEFAULT_PAGE_SIZE = 25;

/**
 * The most list pages one poll may walk.
 *
 * The provider caps a page at 25 summaries and rate-limits tightly, so the walk
 * that seeds a fresh mailbox is bounded rather than following `next_cursor`
 * through an arbitrarily long backlog. The bound is deliberately generous: a
 * walk that stops short of the oldest mail cannot return it without either
 * skipping the mail beneath or stranding it behind a cursor, so the seed walk
 * must be allowed to reach the true bottom. 40 pages covers a 1000-message
 * backlog, and an ordinary poll stops at the cursor after one page.
 */
const MAX_LIST_PAGES = 40;

/** Mailbox folders the CLI understands. */
const INBOX = 'inbox';

/**
 * Begin an authorization and return the URL the user opens or scans.
 *
 * `agently-cli auth login` prints the URL and then blocks until the scan
 * completes, so the process is left running and the caller observes the outcome
 * through `agentMailAuthorizationStatus`.
 */
export async function startAgentMailAuthorization({ signal, workspace } = {}) {
  const started = await startCliLogin({ signal, workspace });
  return {
    browserUrl: started.browserUrl,
    inputCode: started.inputCode,
    // The window belongs to the server; this is the CLI's own default.
    expiresInMs: 600_000,
  };
}

/** The authorization status, as the CLI reports it. */
export async function agentMailAuthorizationStatus({ signal, workspace } = {}) {
  try {
    const { document } = await runCli(['auth', 'status'], { signal, env: cliEnv(workspace) });
    const data = document?.data ?? {};
    return {
      loggedIn: data.logged_in === true,
      status: String(data.status ?? ''),
      message: String(data.message ?? ''),
      workspace: String(data.workspace ?? ''),
    };
  } catch (error) {
    if (error?.code === 'auth') return { loggedIn: false, status: 'not_logged_in', message: error.message };
    throw error;
  }
}

/** Force a token refresh through the CLI. */
export async function refreshAgentMailToken({ signal } = {}) {
  await runCli(['auth', 'refresh'], { signal });
  return true;
}

/** The account's own address, from `+me`. */
export async function fetchAgentMailIdentity({ signal, workspace } = {}) {
  const { document } = await runCli(['+me'], { signal, env: cliEnv(workspace) });
  const aliases = Array.isArray(document?.data?.aliases) ? document.data.aliases : [];
  const primary = aliases.find((entry) => entry?.is_primary) ?? aliases[0];
  const address = normalizeAddress(primary?.email);
  if (!address) {
    throw new AgentMailCliError('agently-cli reported no mailbox address', {
      code: 'identity-missing',
    });
  }
  return {
    address,
    aliasId: String(primary?.alias_id ?? '').trim(),
    name: String(primary?.name ?? '').trim(),
    // The provider publishes its own limits here rather than in its docs, so
    // they are read at runtime instead of being hard-coded.
    rateLimits: normalizeRateLimits(document?.data?.rate_limits),
  };
}

/**
 * The provider's declared limits, normalized to a stable shape.
 *
 * Returns null when the account reports none, so callers can fall back rather
 * than treating an absent field as "unlimited".
 */
export function normalizeRateLimits(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // The payload nests limits by capability in some revisions and is flat in
  // others, so the object is flattened one level before reading.
  const flat = { ...raw };
  for (const value of Object.values(raw)) {
    if (value && typeof value === 'object') Object.assign(flat, value);
  }
  const positive = (...keys) => {
    for (const key of keys) {
      const value = Number(flat[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return null;
  };
  const limits = {
    perMinute: positive('requests_per_minute', 'per_minute', 'rpm'),
    perHour: positive('requests_per_hour', 'per_hour', 'rph'),
    dailySendQuota: positive('daily_send_quota', 'per_day'),
  };
  const normalized = Object.fromEntries(
    Object.entries(limits).filter(([, value]) => value !== null),
  );
  return Object.keys(normalized).length > 0 ? normalized : null;
}

/** One message summary or full message, in this channel's shape. */
export function normalizeAgentMailMessage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.message_id ?? '').trim();
  if (!id) return null;
  const addressOf = (entry) => normalizeAddress(entry?.email ?? entry);
  const people = (list) => (Array.isArray(list) ? list : [])
    .map((entry) => ({ address: addressOf(entry), name: entry?.name }))
    .filter((entry) => entry.address);
  return {
    // `uid` is the CLI's own id, used for every follow-up command.
    uid: id,
    // The RFC Message-ID is the thread key; it only comes with the full read.
    messageId: String(raw.rfc_message_id ?? '').trim(),
    from: { value: people(raw.from ? [raw.from] : []) },
    to: { value: people(raw.to) },
    cc: { value: people(raw.cc) },
    subject: String(raw.subject ?? ''),
    text: typeof raw.body === 'string' ? raw.body : String(raw.snippet ?? ''),
    html: '',
    // Field names follow what the runtime reads (`filename`/`size`/
    // `contentType`); the API's own names live on the right, and the earlier
    // aliases (`fileName`/`bytes`/`mediaType`) were simply ignored, so an
    // inbound attachment arrived with no name, no size and no type.
    attachments: (Array.isArray(raw.attachments) ? raw.attachments : []).map((file) => ({
      filename: String(file?.filename ?? 'attachment'),
      size: Number(file?.size) || 0,
      ...(file?.content_type ? { contentType: String(file.content_type) } : {}),
      attachmentId: String(file?.attachment_id ?? ''),
      // A large attachment exposes a download URL instead of an id.
      ...(file?.download_url ? { downloadUrl: String(file.download_url) } : {}),
    })),
    headers: { get: () => undefined },
  };
}

export class AgentMailTransport {
  #config;
  #signal;
  #connected = false;
  #address = '';
  // Indirection so tests can drive the protocol without the real binary.
  #run = runCli;
  #workspace = '';
  // undefined = not yet probed; '' = use the CLI default.
  #workspaceResolved;

  /** Test seam: swap the CLI runner. Not part of the transport contract. */
  __setRunCliForTests(impl) {
    if (typeof impl === 'function') this.#run = impl;
  }

  /**
   * The workspace to call the CLI in.
   *
   * agently-cli separates accounts per workspace, so a mailbox normally reads
   * from its own. That matters only when several workspaces have logins: with a
   * single authorized account every mailbox belongs to it, and pinning each one
   * to a workspace nobody logged into just reports "authorization required".
   * The pinned workspace is therefore used when it has a login, and the CLI's
   * default otherwise.
   */
  async #workspaceFor() {
    if (this.#workspaceResolved !== undefined) return this.#workspaceResolved;
    let resolved = '';
    if (this.#workspace) {
      try {
        const { document } = await this.#run(['auth', 'status'], { signal: this.#signal, env: cliEnv(this.#workspace) });
        if (document?.data?.logged_in === true) resolved = this.#workspace;
      } catch {
        // No login there; fall through to the CLI default.
      }
    }
    this.#workspaceResolved = resolved;
    return resolved;
  }

  /**
   * The mailbox this transport is actually talking to.
   *
   * A fallback to the CLI default is only safe when that login owns this
   * address. Reusing another mailbox's login would silently send this
   * mailbox's replies from the wrong sender, which the recipient sees as a
   * stranger answering them.
   */
  async #assertIdentity(address) {
    // Callers pass the mailbox as `address` (the runtime and the bind probe
    // both do); `platformId` is the same value under its config-store name.
    // Reading only one of them left `wanted` empty and skipped the check.
    const wanted = normalizeAddress(this.#config.address) || normalizeAddress(this.#config.platformId);
    if (!wanted) {
      throw new AgentMailCliError(
        'the mailbox address is unknown, so the CLI login cannot be verified',
        { code: 'identity-unknown' },
      );
    }
    if (address === wanted) return;
    throw new AgentMailCliError(
      `agently-cli is logged in as ${address}, not ${wanted}; authorize this mailbox separately`,
      { code: 'identity-mismatch' },
    );
  }

  /** Invalidate the cached workspace, after an authorization for instance. */
  __resetWorkspaceCache() {
    this.#workspaceResolved = undefined;
  }

  /** Call the CLI in this mailbox's workspace, resolved once and cached. */
  async #call(args, options = {}) {
    const workspace = await this.#workspaceFor();
    return this.#run(args, { ...options, env: { ...cliEnv(workspace), ...(options.env ?? {}) } });
  }

  constructor({ config, signal } = {}) {
    if (!config || typeof config !== 'object') {
      throw new TypeError('AgentMailTransport requires a config');
    }
    if (!isCliAvailable()) {
      throw new AgentMailCliError(
        'the Agent mailbox requires @tencent-qqmail/agently-cli, which is not installed',
        { code: 'cli-missing' },
      );
    }
    this.#config = config;
    this.#signal = signal;
    this.#address = normalizeAddress(config.address);
    // Stable per-mailbox workspace derived from the address, so a login is
    // never shared between two mailboxes.
    this.#workspace = String(config.workspace ?? config.platformId ?? config.address ?? '').trim();
  }

  get address() {
    return this.#address || this.#config.address || '';
  }

  get transportKey() {
    return 'agent-mail';
  }

  /** The CLI holds the session, so this only proves it is usable. */
  async connect() {
    if (this.#connected) return;
    // Goes through the instance runner so tests never spawn the real binary.
    const { document } = await this.#call(['+me'], { signal: this.#signal });
    const aliases = Array.isArray(document?.data?.aliases) ? document.data.aliases : [];
    const primary = aliases.find((entry) => entry?.is_primary) ?? aliases[0];
    const address = normalizeAddress(primary?.email);
    if (!address) {
      throw new AgentMailCliError('agently-cli reported no mailbox address', {
        code: 'identity-missing',
      });
    }
    await this.#assertIdentity(address);
    this.#address = address;
    this.#connected = true;
  }

  async disconnect() {
    // Stateless: each command is its own process, so there is nothing to close.
    this.#connected = false;
  }

  /**
   * The newest id, used to seed a cursor.
   *
   * Reads the list summary only. Going through `listMessages` without an
   * allowlist meant "no filter", so seeding a cursor downloaded the body of the
   * newest message — mail the policy may well refuse, fetched before anyone
   * asked for it. The newest id is in the first summary already.
   */
  async latestUid() {
    const { document } = await this.#call(
      ['message', '+list', '--dir', INBOX, '--limit', '1'],
      { signal: this.#signal },
    );
    const items = Array.isArray(document?.data?.data) ? document.data.data : [];
    return String(items[0]?.message_id ?? '').trim() || 0;
  }

  /**
   * New mail, oldest first.
   *
   * The provider lists newest-first and caps a page at 25 summaries, so the
   * oldest unhandled batch is usually only reachable by following the page
   * cursor: with a 30-message backlog the five oldest sit on the second page.
   * Reversing a single page therefore both skipped the backlog (the cursor then
   * advanced past it) and, on the next poll, re-delivered the same handled mail
   * — burning rate limit on bodies already read.
   *
   * The walk here is over summaries only. A summary is filtered by the cursor
   * and the sender allowlist first, so a body is fetched exactly once, for mail
   * this call actually returns.
   */
  async listMessages({ afterUid = null, limit = DEFAULT_PAGE_SIZE, allowSenders = null } = {}) {
    // A Set — even an empty one — means the caller supplied a policy: an
    // empty allowlist admits nobody, so no body is fetched at all. Treating
    // it as "no filter" downloaded mail the policy had already refused.
    const allowed = allowSenders instanceof Set ? allowSenders : null;
    const handledUid = afterUid === null || afterUid === undefined ? null : String(afterUid);
    // Newest-first summaries of unhandled, allowed mail, newest first across
    // every page walked; reversed into age order once the walk ends.
    const pending = [];
    let cursor = '';
    // Whether the walk actually reached the handled boundary. When the page cap
    // stops it first, the backlog below the deepest page is still unseen, so the
    // batch must stay contiguous with the cursor instead of skipping ahead.
    // With no cursor there is no known boundary to reach, so the walk simply
    // goes as deep as the page cap allows.
    let reachedHandled = false;

    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const args = ['message', '+list', '--dir', INBOX, '--limit', String(DEFAULT_PAGE_SIZE)];
      if (cursor) args.push('--cursor', cursor);
      const { document } = await this.#call(args, { signal: this.#signal });
      const items = Array.isArray(document?.data?.data) ? document.data.data : [];
      if (items.length === 0) {
        // The mailbox ends here, so nothing older than this page is pending.
        reachedHandled = true;
        break;
      }

      // Summaries arrive newest-first, so stopping at the cursor keeps the
      // backlog older than it out of this batch.
      for (const raw of items) {
        const id = String(raw?.message_id ?? '').trim();
        if (!id) continue;
        if (handledUid !== null && id === handledUid) {
          reachedHandled = true;
          break;
        }
        if (allowed && !allowed.has(normalizeAddress(raw?.from?.email))) continue;
        pending.push(raw);
      }

      // The walk stops once the cursor is covered: everything older than it is
      // already handled, so paging further would only re-read processed mail.
      //
      // `limit` deliberately never stops the walk: pages are newest-first, so
      // the oldest unhandled mail sits on the LAST page reached, not the first.
      // Breaking as soon as `limit` summaries had been collected is what left
      // the 5-message tail of a 30-message backlog on an unread page and then
      // advanced the cursor past it.
      if (reachedHandled) break;

      const next = String(document?.data?.pagination?.next_cursor ?? '');
      if (!next || next === cursor) {
        reachedHandled = true;
        break;
      }
      cursor = next;
    }

    // `pending` is newest-first, so the oldest `limit` entries are its tail.
    // That tail is only the mailbox's oldest unhandled mail once the walk has
    // reached the handled boundary (or the end of a fresh mailbox). While the
    // backlog below the deepest page is still unseen, the tail would advance
    // the cursor past pages nobody read, stranding them; the head is taken
    // instead, which keeps the batch contiguous so the remaining backlog is
    // drained from the top on the polls that follow.
    const batch = (reachedHandled ? pending.slice(-limit) : pending.slice(0, limit)).reverse();
    return this.#oldestFirst(batch, allowed);
  }

  /** Oldest-first, with each message's body and RFC id filled in. */
  async #oldestFirst(items, allowed) {
    // The caller already ordered these oldest-first; reversing here would undo
    // the ordering the limit was applied to.
    const ordered = items.slice();
    const loaded = [];
    for (const raw of ordered) {
      loaded.push(await this.#readMessage(raw, allowed));
    }
    return loaded.filter(Boolean);
  }

  /** Read one message in full, falling back to the summary if that fails. */
  async #readMessage(raw, allowed) {
    const summary = normalizeAgentMailMessage(raw);
    if (!summary) return null;
    if (allowed && !allowed.has(normalizeAddress(summary.from?.value?.[0]?.address))) return null;
    try {
      const { document } = await this.#call(['message', '+read', '--id', summary.uid], {
        signal: this.#signal,
      });
      const full = normalizeAgentMailMessage(document?.data ?? {});
      if (!full) return summary;
      const attachments = full.attachments.length > 0 ? full.attachments : summary.attachments;
      return {
        ...summary,
        // The full read is the only place the thread id and body appear.
        messageId: full.messageId || summary.messageId,
        text: full.text || summary.text,
        html: full.html || summary.html,
        attachments: this.#withAttachmentContent(summary.uid, attachments),
        cc: full.cc.value.length > 0 ? full.cc : summary.cc,
      };
    } catch {
      // A failed read must not lose the mail; the snippet keeps it usable.
      return summary;
    }
  }

  /**
   * Attach a content loader to each attachment.
   *
   * The transport contract asks for `content`, but the API exposes only an id,
   * so the bytes are fetched from `attachment +download` on demand. A failed
   * download leaves that attachment without content rather than losing the
   * message — its name and size are still reported.
   */
  #withAttachmentContent(messageId, attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) return [];
    return attachments.map((file) => ({
      ...file,
      content: async () => {
        if (!file.attachmentId) return undefined;
        try {
          const { document } = await this.#call([
            'attachment', '+download',
            '--msg', messageId,
            '--att', file.attachmentId,
          ], { signal: this.#signal });
          const saved = document?.data?.saved_to;
          if (!saved) return undefined;
          const { readFile } = await import('node:fs/promises');
          return await readFile(saved);
        } catch {
          return undefined;
        }
      },
    }));
  }

  /** Reply, threading on the message's own RFC id. */
  async sendReply({
    to, subject, text, transportMessageId, references, attachments = [], headers,
  } = {}) {
    const body = this.#composeBody(text);
    // The CLI takes the text through --body; `--body-file -` is read as a
    // literal filename and fails with ENOENT.
    const args = [
      'message', '+reply',
      '--id', String(transportMessageId ?? ''),
    ];
    if (attachments.length > 0) {
      const uploaded = await this.#uploadAttachments(attachments);
      for (const id of uploaded) args.push('--attachment', id);
    }
    await this.#withConfirmation(args, body, headers);
    return { sent: true, to, subject: subject ?? replySubject(''), references };
  }

  /** Send a new message rather than a reply. */
  async sendText({ to, subject, text, attachments = [], headers } = {}) {
    const body = this.#composeBody(text);
    const args = ['message', '+send', '--to', String(to ?? '')];
    if (subject) args.push('--subject', String(subject));
    if (attachments.length > 0) {
      const uploaded = await this.#uploadAttachments(attachments);
      for (const id of uploaded) args.push('--attachment', id);
    }
    await this.#withConfirmation(args, body, headers);
    return { sent: true, to, subject };
  }

  /** Reply bodies are trimmed to the same ceiling as the IMAP transport. */
  #composeBody(text) {
    return stripQuotedHistory(String(text ?? '')).slice(0, MAX_REPLY_CHARS);
  }

  /** Upload local attachments and return their ids. */
  async #uploadAttachments(attachments) {
    const ids = [];
    for (const file of attachments) {
      // A path can be uploaded directly; the runtime hands over bytes instead
      // (`{ filename, content, contentType }`), which must be written out
      // first — the earlier version read only `path`, skipped every real
      // attachment, and the send still reported success.
      let path = file?.path ?? file?.filePath ?? null;
      let cleanup = null;
      if (!path) {
        const bytes = file?.content ?? file?.bytes ?? file?.data;
        if (!bytes) {
          throw new AgentMailCliError(
            `attachment ${String(file?.filename ?? '(unnamed)')} has neither a path nor content`,
            { code: 'attachment-unreadable' },
          );
        }
        const written = await this.#writeTempAttachment(file?.filename, bytes);
        if (!written) {
          throw new AgentMailCliError(
            `attachment ${String(file?.filename ?? '(unnamed)')} could not be staged for upload`,
            { code: 'attachment-unwritable' },
          );
        }
        ({ path, cleanup } = written);
      }
      try {
        const { document } = await this.#call(['attachment', '+upload', '--file', path], {
          signal: this.#signal,
        });
        const id = String(document?.data?.attachment_id ?? '').trim();
        if (id) ids.push(id);
      } finally {
        if (cleanup) await cleanup();
      }
    }
    return ids;
  }

  /** Write attachment bytes to a temp file so the CLI can upload them. */
  async #writeTempAttachment(filename, bytes) {
    try {
      const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join, basename } = await import('node:path');
      const dir = await mkdtemp(join(tmpdir(), 'dsh-email-att-'));
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const safe = basename(String(filename ?? 'attachment')).replace(/[^\w.-]/g, '_') || 'attachment';
      const path = join(dir, safe);
      await writeFile(path, buffer);
      return { path, cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}) };
    } catch {
      return null;
    }
  }

  /**
   * Run a sending command, completing the two-step confirmation.
   *
   * The first call returns `confirmation_token` with exit 0; resending the same
   * arguments plus that token performs the send.
   */
  async #withConfirmation(args, body, headers) {
    // agently-cli exposes no --header flag; extra headers are dropped rather
    // than passed as an argument it would reject.
    // The body travels as an argument: `--body-file -` is read as a literal
    // filename and fails with ENOENT, so stdin is not an option here.
    const withBody = [...args, '--body', body];
    const first = await this.#call(withBody, { signal: this.#signal });
    const token = String(first.document?.data?.confirmation_token ?? '').trim();
    if (!token) return first.document;
    const confirmed = await this.#call(
      [...withBody, '--confirmation-token', token],
      { signal: this.#signal },
    );
    return confirmed.document;
  }
}

assertTransport(AgentMailTransport.prototype, 'AgentMailTransport');

/**
 * Build a transport whose CLI calls are supplied by the caller.
 *
 * Tests need to drive list/read/send without the real binary; production
 * constructs `AgentMailTransport` directly.
 */
export function createAgentMailTransportForTests({ config, runCliImpl }) {
  const transport = new AgentMailTransport({ config });
  transport.__setRunCliForTests(runCliImpl);
  return transport;
}
