import { extractConnectionEvidence, atConnectionStage, createConnectionDiagnostics } from '../shared/connection-error.mjs';
import { t } from '../shared/i18n.mjs';
import {
  createAccessPolicy,
  createAccessPolicyScope,
} from '../shared/access-policy.mjs';
import { assertTransport } from './transport.mjs';
import { ImapSmtpTransport } from './transports/imap-smtp.mjs';
import {
  AgentMailTransport,
  agentMailAuthorizationStatus,
  fetchAgentMailIdentity,
  startAgentMailAuthorization,
} from './transports/agent-mail.mjs';
import {
  DEFAULT_EMAIL_TRANSPORT,
  EMAIL_TRANSPORTS,
  normalizeEmailTransport,
} from './config-store.mjs';
import {
  EMAIL_PROVIDERS,
  EmailConfigStore,
  deriveEmailBotIdentity,
  maskEmailBotId,
  normalizeEmailAddress,
  normalizeEmailAccessPolicy,
} from './config-store.mjs';
import { EmailStateStore } from './state-store.mjs';
import { EMAIL_DESCRIPTOR } from './email-bridge.mjs';

/**
 * Fallback validity window for a QR authorization, used only when the server
 * does not state one. Normally the server's `expires_in` governs.
 */
const AGENT_MAIL_AUTH_TTL_MS = 600_000;

/**
 * Credential payload for one mailbox.
 *
 * The whole payload lives under one credential ref as JSON — the channel's
 * established shape, unlike the single-secret channels — because a mailbox
 * needs its address alongside its secret.
 *
 * A standard mailbox carries an app password; the Agent mailbox carries an
 * OAuth pair instead, since it has no password at all.
 */
function normalizeCredential(value) {
  if (!value || typeof value !== 'object') return null;
  const address = typeof value.address === 'string' ? value.address.trim().toLowerCase() : '';
  if (!address) return null;
  const password = typeof value.password === 'string' ? value.password : '';
  const accessToken = typeof value.accessToken === 'string' ? value.accessToken : '';
  const refreshToken = typeof value.refreshToken === 'string' ? value.refreshToken : '';
  if (!password && !accessToken) return null;
  return {
    address,
    ...(password ? { password } : {}),
    ...(accessToken ? { accessToken } : {}),
    ...(refreshToken ? { refreshToken } : {}),
  };
}

export class EmailController {
  #credentials;
  #configStore;
  #createRuntime;
  #transports;
  #pendingAuth = null;
  #syncAccessPolicy;
  #ensureWorkspace;
  #stateFor;
  #listWorkspaceSessions;
  #botWorkspaceFor;
  #defaultWorkspace;
  #deleteState;
  #logger;
  #diagnostics;
  #runtimes = new Map();
  #errors = new Map();
  #revision = 0;
  #closed = false;
  #transitions = new Map();

  constructor({
    credentials,
    configStore,
    createRuntime,
    deleteState = async () => {},
    logger = console,
    // Transport implementations by key. A new mail protocol is a new entry
    // here, not another channel.
    transports = {
      'imap-smtp': (options) => new ImapSmtpTransport(options),
      'agent-mail': (options) => new AgentMailTransport(options),
    },
    // Host-owned hook: the mailbox allowlist and the Harness access policy are
    // two separate stores, so a changed allowlist must be pushed into the
    // policy or the channel keeps rejecting the new senders.
    syncAccessPolicy = null,
    // Host-owned hook: create the bot's workspace record if it does not exist
    // yet. The access policy lives *inside* that record, so a freshly bound
    // mailbox has nowhere to push its allowlist until this has run.
    ensureWorkspace = null,
    // Optional: supplied when the channel supports pinning a chat to an
    // existing session (the settings page session picker).
    stateFor = null,
    listWorkspaceSessions = null,
    botWorkspaceFor = null,
    defaultWorkspace = null,
  }) {
    if (!credentials || typeof credentials.resolve !== 'function'
      || typeof credentials.set !== 'function' || typeof credentials.unset !== 'function') {
      throw new TypeError('EmailController requires the DSH credential provider');
    }
    if (!configStore || typeof configStore.list !== 'function'
      || typeof configStore.save !== 'function' || typeof configStore.remove !== 'function') {
      throw new TypeError('EmailController requires a config store');
    }
    if (typeof createRuntime !== 'function') throw new TypeError('createRuntime is required');
    this.#credentials = credentials;
    this.#configStore = configStore;
    this.#createRuntime = createRuntime;
    if (!transports || typeof transports !== 'object') {
      throw new TypeError('EmailController requires a transport registry');
    }
    this.#transports = transports;
    this.#syncAccessPolicy = typeof syncAccessPolicy === 'function' ? syncAccessPolicy : null;
    this.#ensureWorkspace = typeof ensureWorkspace === 'function' ? ensureWorkspace : null;
    this.#stateFor = typeof stateFor === 'function' ? stateFor : null;
    this.#listWorkspaceSessions = typeof listWorkspaceSessions === 'function'
      ? listWorkspaceSessions : null;
    this.#botWorkspaceFor = typeof botWorkspaceFor === 'function' ? botWorkspaceFor : null;
    this.#defaultWorkspace = typeof defaultWorkspace === 'string' ? defaultWorkspace : null;
    this.#deleteState = deleteState;
    this.#logger = logger;
    this.#diagnostics = createConnectionDiagnostics({ channel: 'email', logger });
  }

  async initialize() {
    if (this.#closed) return this.status();
    for (const config of this.#configStore.list()) {
      await this.#withBotTransition(config.botId, async () => {
        // initialize() runs on every supervisor health check. Without this
        // guard each check tore down the running runtime and started a new
        // one, so its poll loop never completed a single pass and no mail was
        // ever read.
        if (this.#runtimes.get(config.botId)?.status?.ready) return;
        try {
          const secrets = await this.#resolveSecrets(config);
          if (!secrets) return;
          await this.#startRuntime(config, secrets);
          this.#errors.delete(config.botId);
        } catch (error) {
          this.#errors.set(config.botId, this.#safeError('connection-failed', error));
          this.#logger.warn?.(`[dsh-im:email] bot ${config.botId} failed to start:`, extractConnectionEvidence(error).details);
        }
      });
    }
    return this.status();
  }

  /** Connect one mailbox. The password is verified against IMAP/SMTP before it
   * is persisted, so a bad app password fails here rather than silently
   * producing a bot that never receives mail. */
  async bindMailbox({
    address, password, accessToken, refreshToken, provider, transport,
    imapHost, imapPort, smtpHost, smtpPort, allowedSenders,
  } = {}) {
    if (this.#closed) throw new Error(`${EMAIL_DESCRIPTOR.label} controller is closed`);
    const normalizedAddress = normalizeEmailAddress(address);
    const transportKey = normalizeEmailTransport(transport);
    const definition = EMAIL_TRANSPORTS[transportKey];
    // Only the IMAP/SMTP transport needs a password; others authorize another
    // way (the Agent mailbox does so by QR code).
    const needsPassword = definition.fields.includes('password');
    // A standard mailbox carries an app password. The Agent mailbox carries
    // nothing: agently-cli keeps its own credentials in the system keychain, so
    // only the address is stored here (to name and bind the mailbox).
    const credential = needsPassword
      ? normalizeCredential({ address: normalizedAddress, password })
      : Object.freeze({ address: normalizedAddress });
    if (needsPassword && !credential) {
      throw new TypeError(t('邮箱地址与应用密码均为必填'));
    }
    // Server hosts only apply to transports that speak a mail protocol.
    const needsHosts = definition.fields.includes('hosts');
    const preset = needsHosts ? EMAIL_PROVIDERS[provider] ?? null : null;
    const security = {
      transport: transportKey,
      ...(needsHosts ? { provider: preset?.key ?? 'custom' } : {}),
      ...(needsHosts ? {
        imapHost: imapHost || preset?.imapHost,
        imapPort: imapPort ?? preset?.imapPort ?? 993,
        smtpHost: smtpHost || preset?.smtpHost,
        smtpPort: smtpPort ?? preset?.smtpPort ?? 465,
      } : {}),
      allowedSenders: normalizeEmailAccessPolicy({ allowedSenders }).allowedSenders,
    };
    if (needsHosts && (!security.imapHost || !security.smtpHost)) {
      throw new TypeError(t('请选择邮箱服务商或填写 IMAP/SMTP 服务器地址'));
    }
    // An empty allowlist is allowed so a mailbox can be connected first and
    // authorized later. It stays fail-closed: the access policy derived from an
    // empty list admits nobody, so the mailbox can be read but not driven.
    const identity = deriveEmailBotIdentity(normalizedAddress);
    await this.#withBotTransition(identity.botId, async () => {
      const previousConfig = this.#configStore.getByPlatformId(normalizedAddress);
      // resolve() returns a wrapper; the plain secret lives on .value.
      const previousResult = await atConnectionStage('credential.read', () => this.#credentials.resolve(identity.tokenRef), 'credential-store');
      const previousCredential = previousResult?.value;
      const probe = this.#createTransport({
        address: normalizedAddress,
        ...(credential.password ? { password: credential.password } : {}),
        ...(credential.accessToken ? { accessToken: credential.accessToken } : {}),
        ...(credential.refreshToken ? { refreshToken: credential.refreshToken } : {}),
        ...security,
      });
      try {
        await probe.connect();
        await probe.disconnect();
      } catch (error) {
        throw this.#diagnostics.report(error, { reuse: true, stage: 'credential.verify', operation: 'bot.bind-mailbox',
          publicError: { code: 'email-bind-failed', message: t('邮箱连接失败，请检查地址、应用密码与服务器设置') } });
      }
      const config = {
        botId: identity.botId,
        platformId: normalizedAddress,
        tokenRef: identity.tokenRef,
        name: normalizedAddress,
        username: normalizedAddress,
        createdAt: previousConfig?.createdAt ?? new Date().toISOString(),
        connectedAt: new Date().toISOString(),
        ...security,
      };
      await atConnectionStage('credential.save', () => this.#credentials.set(identity.tokenRef, JSON.stringify(credential)), 'credential-store');
      try {
        await atConnectionStage('account.save', () => this.#configStore.save(config), 'account-config');
      } catch (error) {
        await this.#restoreCredential(identity.tokenRef, previousCredential);
        throw error;
      }
      // From here the mailbox is on disk, so every later failure must either
      // undo that write or leave state a retry can recover from. A mailbox saved
      // but neither reachable nor authorized is exactly the broken state this
      // guards against.
      try {
        // The access policy lives *inside* the bot's workspace record, so that
        // record has to exist before the allowlist can be pushed into it. The
        // runtime used to be the only thing that created it — and the runtime
        // starts after this — so on a brand-new mailbox the push failed with
        // "workspace-bot-not-found", leaving the config on disk with no runtime
        // and no policy.
        await this.#ensureBotWorkspace(identity.botId, config);
        // The allowlist has to reach the Harness now, not only when the settings
        // are edited later: without it a freshly bound mailbox admits nobody, so
        // its first mail is refused for the wrong reason.
        await this.#applyAllowlistToPolicy(identity.botId, config);
        await this.#stopRuntime(identity.botId);
        try {
          await this.#startRuntime(config, credential);
          this.#errors.delete(identity.botId);
        } catch (error) {
          this.#errors.set(identity.botId, this.#safeError('connection-failed', error));
        }
      } catch (error) {
        // Roll the mailbox back instead of persisting a half-bound one, so the
        // user sees a clean failure and a plain retry works.
        await this.#rollbackBind(config, previousConfig, previousCredential);
        throw error;
      }
      this.#touch();
    });
    return this.status();
  }

  /** Patch a subset of settings (hosts, ports, allowlist) without reconnecting. */
  async updateMailboxSettings(botId, update = {}) {
    if (this.#closed) throw new Error(`${EMAIL_DESCRIPTOR.label} controller is closed`);
    return this.#withBotTransition(botId, async () => {
      const config = this.#requireConfig(botId);
      const next = { ...config };
      // A mailbox can move between protocols, so the transport is patchable
      // like any other setting rather than fixed at bind time.
      if (update.transport !== undefined) {
        next.transport = normalizeEmailTransport(update.transport);
      }
      if (update.provider !== undefined) next.provider = update.provider;
      if (update.imapHost !== undefined) next.imapHost = update.imapHost;
      if (update.imapPort !== undefined) next.imapPort = update.imapPort;
      if (update.smtpHost !== undefined) next.smtpHost = update.smtpHost;
      if (update.smtpPort !== undefined) next.smtpPort = update.smtpPort;
      if (update.allowedSenders !== undefined) {
        next.allowedSenders = normalizeEmailAccessPolicy({ allowedSenders: update.allowedSenders }).allowedSenders;
      }
      const allowlistChanged = update.allowedSenders !== undefined;
      const saved = await atConnectionStage('account.save', () => this.#configStore.save(next), 'account-config');
      if (allowlistChanged) await this.#applyAllowlistToPolicy(botId, saved);
      // Host, allowlist and approval changes take effect immediately.
      await this.#stopRuntime(botId);
      const secrets = await this.#resolveSecrets(saved);
      if (secrets) {
        try {
          await this.#startRuntime(saved, secrets);
          this.#errors.delete(botId);
        } catch (error) {
          this.#errors.set(botId, this.#safeError('connection-failed', error));
        }
      }
      this.#touch();
      return this.status();
    });
  }

  async reconnectBot(botId) {
    if (this.#closed) throw new Error(`${EMAIL_DESCRIPTOR.label} controller is closed`);
    return this.#withBotTransition(botId, async () => {
      const config = this.#requireConfig(botId);
      await this.#stopRuntime(botId);
      const secrets = await this.#resolveSecrets(config);
      if (!secrets) throw new Error(t('邮箱凭据已丢失，请重新绑定'));
      await this.#startRuntime(config, secrets);
      this.#errors.delete(botId);
      this.#touch();
      return this.status();
    });
  }

  async sendConnectionTest(botId) {
    const runtime = this.#runtimes.get(botId);
    if (!runtime) throw new Error(t('邮箱尚未连接'));
    await runtime.sendConnectionTest(t('邮箱通道连接正常。'));
    return { sent: true };
  }

  async sendProactiveText(botId, target, text, options = {}) {
    const runtime = this.#runtimes.get(botId);
    if (!runtime) {
      const error = new Error(t('邮箱尚未连接'));
      error.code = 'bot-not-connected';
      throw error;
    }
    return runtime.sendProactiveText(target, text, options);
  }

  async deleteBot(botId) {
    const warnings = [];
    return this.#withBotTransition(botId, async () => {
      const config = this.#configStore.get(botId);
      await this.#stopRuntime(botId);
      let removed;
      try { removed = await atConnectionStage('account.remove', () => this.#configStore.remove(botId), 'account-config'); }
      catch (error) {
        if (this.#configStore.get(botId)) throw error;
        removed = config;
        warnings.push(this.#diagnostics.report(error, { operation: 'bot.delete', stage: 'workspace.cleanup', warning: true,
          publicError: { code: 'workspace-cleanup-failed', message: '账号已移除，但本地状态清理失败。' } }).publicError);
      }
      if (removed?.tokenRef) await atConnectionStage('credential.remove', () => this.#credentials.unset(removed.tokenRef), 'credential-store').catch(error => { warnings.push(this.#diagnostics.report(error, { reuse: true, operation: 'bot.delete', stage: 'credential.remove', warning: true, publicError: { code: 'cleanup-failed', message: '账号已移除，但登录凭据清理失败。' } }).publicError); });
      await this.#deleteState(botId).catch(error => { warnings.push(this.#diagnostics.report(error, { reuse: true, operation: 'bot.delete', stage: 'state.cleanup', resource: 'account-state', warning: true, publicError: { code: 'cleanup-failed', message: '账号已移除，但本地状态清理失败。' } }).publicError); });
      this.#errors.delete(botId);
      this.#touch();
      return { ...this.status(), ...(warnings.length ? { warnings } : {}) };
    });
  }

  status() {
    const bots = this.#configStore.list().map((config) => {
      const runtime = this.#runtimes.get(config.botId);
      const runtimeStatus = runtime?.status ?? null;
      const error = runtimeStatus?.error ?? this.#errors.get(config.botId);
      // The connection supervisor and the settings client both read these
      // fields, so a mailbox reports connectivity the same way every other
      // token channel does.
      const connected = runtimeStatus?.ready === true
        && runtimeStatus.connectionState === 'connected';
      const state = connected ? 'connected'
        : error ? 'error'
          : runtimeStatus?.connectionState === 'connecting' ? 'connecting' : 'disconnected';
      return {
        botId: config.botId,
        // The shared client reads the identity from `bot`, so the name must live
        // there — a top-level name is ignored and the UI falls back to
        // "<channel>机器人". The address doubles as the display name, which
        // beats a generic label.
        bot: {
          name: config.name || config.platformId,
          username: config.username || config.platformId,
          idMasked: maskEmailBotId(config.platformId),
        },
        // The raw address is already semi-public, but the UI shows the masked
        // form for consistency with other channels.
        platformId: maskEmailBotId(config.platformId),
        // Which protocol this mailbox speaks. The settings page needs it to
        // show the right form; without it an Agent mailbox was described with
        // IMAP/SMTP fields it does not use.
        transport: config.transport ?? DEFAULT_EMAIL_TRANSPORT,
        provider: config.provider,
        imapHost: config.imapHost,
        imapPort: config.imapPort,
        smtpHost: config.smtpHost,
        smtpPort: config.smtpPort,
        allowedSenders: config.allowedSenders ?? [],
        createdAt: config.createdAt,
        connectedAt: config.connectedAt,
        connected,
        configured: true,
        state,
        health: {
          status: connected ? 'healthy' : state === 'error' ? 'error' : 'offline',
          summary: connected
            ? t('邮箱通道运行正常')
            : error?.message ?? t('邮箱通道尚未连接'),
        },
        ...(error ? { error } : {}),
        runtime: runtimeStatus,
      };
    });
    const connectedCount = bots.filter((bot) => bot.connected).length;
    return {
      revision: this.#revision,
      bots,
      totals: { configured: bots.length, connected: connectedCount },
    };
  }

  /**
   * Current session bindings for one mailbox, plus the senders known to this
   * mailbox so the settings page can offer a per-sender override.
   */
  async getSessionBinding(botId) {
    const config = this.#requireConfig(botId);
    const state = await this.#stateFor?.(botId);
    const bindings = state?.emailBindings?.() ?? { account: null, senders: {} };
    const senders = Array.isArray(config.allowedSenders) ? config.allowedSenders : [];
    return {
      botId,
      account: bindings.account ?? null,
      senders: bindings.senders ?? {},
      // The picker offers these as the per-sender rows.
      knownSenders: senders,
    };
  }

  /**
   * Replace the bindings. An empty value clears them, which restores the
   * default behaviour of one Harness session per mail thread.
   */
  async setSessionBinding(botId, value = {}) {
    this.#requireConfig(botId);
    if (!this.#stateFor) throw new Error(t('当前环境不支持会话绑定'));
    const state = await this.#stateFor(botId);
    if (typeof state?.setEmailBindings !== 'function') {
      throw new Error(t('当前环境不支持会话绑定'));
    }
    const account = typeof value.account === 'string' && value.account.trim()
      ? value.account.trim() : null;
    const senders = {};
    if (value.senders && typeof value.senders === 'object' && !Array.isArray(value.senders)) {
      for (const [address, sessionId] of Object.entries(value.senders)) {
        const key = typeof address === 'string' ? address.trim().toLowerCase() : '';
        const session = typeof sessionId === 'string' ? sessionId.trim() : '';
        if (key && session) senders[key] = session;
      }
    }
    await state.setEmailBindings({ account, senders });
    this.#touch();
    return this.getSessionBinding(botId);
  }

  /**
   * The bot's workspace, tolerating both a synchronous accessor and an async
   * one, and treating a failure as "unknown" rather than failing the listing.
   */
  async #resolveBotWorkspace(botId) {
    if (!this.#botWorkspaceFor) return null;
    try {
      return (await this.#botWorkspaceFor(botId)) ?? null;
    } catch {
      return null;
    }
  }

  /** Sessions available to bind to, for the settings picker. */
  async listSessions(botId) {
    const config = this.#requireConfig(botId);
    // The bot's own workspace is authoritative; defaultWorkspace is only a
    // fallback for hosts that do not expose a per-bot workspace.
    const workspace = (await this.#resolveBotWorkspace(botId)) ?? this.#defaultWorkspace;
    if (!workspace || !this.#listWorkspaceSessions) {
      return { botId, workspace: workspace ?? null, sessions: [] };
    }
    const listed = await this.#listWorkspaceSessions(workspace);
    const sessions = Array.isArray(listed?.sessions) ? listed.sessions : [];
    return {
      botId,
      workspace: listed?.workspace ?? workspace,
      sessions: sessions.map((session) => ({
        sessionId: session.sessionId ?? session.id ?? '',
        title: String(session.title ?? '').slice(0, 120),
        updatedAt: session.updatedAt ?? null,
      })).filter((session) => session.sessionId),
      config,
    };
  }

  /**
   * The shared token-bot RPC handler addresses mailbox binding through the
   * generic `bindCredentials` endpoint, so the mailbox-specific method is
   * exposed under that name as well.
   */
  bindCredentials(payload) {
    return this.bindMailbox(payload);
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const botId of [...this.#runtimes.keys()]) {
      await this.#stopRuntime(botId).catch(() => {});
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Build the Harness access policy for a mailbox: both scopes are allowlists
   * seeded from the configured senders, so mail from anyone else is refused.
   */
  #accessPolicyFor(config) {
    const senders = Array.isArray(config?.allowedSenders) ? config.allowedSenders : [];
    const scope = createAccessPolicyScope({
      mode: 'allowlist',
      open: { defaultCanExecuteCommands: false, commandPermissionOverrides: [] },
      allowlist: { users: senders.map((id) => ({ id, canExecuteCommands: true })) },
    });
    return createAccessPolicy({ direct: scope, group: scope });
  }

  /**
   * Make sure the bot's workspace record exists before anything is written to
   * it. The access policy is stored inside that record, so on a brand-new
   * mailbox `#applyAllowlistToPolicy` has no bot to address yet and the store
   * refuses it with "workspace-bot-not-found". Ordering the policy push after
   * the runtime would fix that too, but it would also make the runtime — and
   * the whole transport handshake behind it — a precondition for a purely
   * local write, and would leave a mailbox briefly bound with no policy.
   *
   * Hosts without the hook (and the unit tests) skip this: their syncAccessPolicy
   * has its own storage and never needed the record.
   */
  async #ensureBotWorkspace(botId, config) {
    if (!this.#ensureWorkspace) return;
    try {
      await this.#ensureWorkspace(botId, config);
    } catch (error) {
      this.#logger.warn?.('[dsh-im:email] failed to prepare the bot workspace:', extractConnectionEvidence(error).details);
      throw new Error(t('邮箱访问策略同步失败，请重试'));
    }
  }

  /**
   * Undo a bind that failed after its config was written. Restoring the
   * credential first, then the config, keeps the pair consistent: a config
   * pointing at a token ref that no longer holds a secret is the one state the
   * channel cannot recover from on its own.
   *
   * A brand-new mailbox is removed outright; a re-bind of an existing one is
   * restored to the config it had, so the user's previous working mailbox
   * survives a failed re-bind.
   */
  async #rollbackBind(config, previousConfig, previousCredential) {
    await this.#restoreCredential(config.tokenRef, previousCredential);
    try {
      if (previousConfig) await atConnectionStage('account.save', () => this.#configStore.save(previousConfig), 'account-config');
      else await atConnectionStage('account.remove', () => this.#configStore.remove(config.botId), 'account-config');
    } catch (error) {
      // The bind failure is the error the user needs to see; a rollback that
      // could not complete is reported alongside it rather than replacing it.
      this.#logger.warn?.('[dsh-im:email] failed to roll back the mailbox config:', extractConnectionEvidence(error).details);
    }
  }

  /** Push the mailbox allowlist into the Harness access policy. */
  async #applyAllowlistToPolicy(botId, config) {
    if (!this.#syncAccessPolicy) return;
    try {
      await this.#syncAccessPolicy(botId, this.#accessPolicyFor(config));
    } catch (error) {
      // The mailbox itself is already saved and connected; a policy push
      // failure must not undo that, but it is surfaced for diagnosis.
      this.#logger.warn?.('[dsh-im:email] failed to sync the access policy:', extractConnectionEvidence(error).details);
      throw new Error(t('邮箱访问策略同步失败，请重试'));
    }
  }

  /**
   * Instantiate the transport a mailbox is configured to use. The registry is
   * injected so tests can substitute one, and an unknown key falls back to the
   * default rather than failing the whole channel.
   */
  #createTransport(config) {
    const key = normalizeEmailTransport(config?.transport ?? DEFAULT_EMAIL_TRANSPORT);
    const factory = this.#transports[key] ?? this.#transports[DEFAULT_EMAIL_TRANSPORT];
    if (typeof factory !== 'function') {
      throw new TypeError(`No transport registered for ${key}`);
    }
    return assertTransport(factory({ config }), `email transport ${key}`);
  }

  #requireConfig(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error(t('未找到该邮箱配置'));
    return config;
  }

  /**
   * The credential provider resolves a ref to a wrapper object whose payload
   * lives on `.value` (the same contract the shared token controller uses), so
   * the stored JSON is unwrapped from there rather than parsed directly.
   */
  async #resolveSecrets(config) {
    const result = await atConnectionStage('credential.read', () => this.#credentials.resolve(config.tokenRef), 'credential-store');
    const stored = result?.value;
    if (typeof stored === 'string' && stored) {
      try {
        // The mailbox secret is stored as JSON so one ref carries the address
        // and the app password together.
        const parsed = normalizeCredential(JSON.parse(stored));
        if (parsed) return parsed;
      } catch {
        // Fall through to the transport-specific default below.
      }
    }
    // The Agent mailbox needs no secret of ours: agently-cli keeps its own
    // credentials in the system keychain. Returning null here used to skip the
    // mailbox entirely, so it silently never started.
    if (normalizeEmailTransport(config.transport) === 'agent-mail') {
      return Object.freeze({ address: config.platformId });
    }
    return null;
  }

  async #startRuntime(config, credential) {
    // Production owns state/workspace resolution; the controller only passes
    // the identity and the mailbox secret through.
    const runtime = await atConnectionStage('runtime.prepare', () => this.#createRuntime({
      botId: config.botId,
      config,
      // `token` stays for the shared runtime shape; the full credential is what
      // a transport actually needs, since a mailbox may carry tokens instead of
      // a password.
      token: credential.password ?? credential.accessToken,
      credential,
      // The runtime must build the transport the mailbox is configured for.
      // Its own default is IMAP/SMTP, so without this an Agent mailbox was
      // dialled as a mail server and failed with ECONNREFUSED on port 993.
      createTransport: (options) => this.#createTransport(options.config ?? options),
    }));
    if (!runtime || typeof runtime.start !== 'function' || typeof runtime.stop !== 'function') {
      throw new TypeError('createRuntime returned an invalid Email runtime');
    }
    this.#runtimes.set(config.botId, runtime);
    try {
      await runtime.start();
    } catch (error) {
      this.#runtimes.delete(config.botId);
      await runtime.stop().catch(() => {});
      throw error;
    }
  }

  async #stopRuntime(botId) {
    const runtime = this.#runtimes.get(botId);
    this.#runtimes.delete(botId);
    await runtime?.stop().catch((error) => {
      this.#logger.warn?.(`[dsh-im:email] bot ${botId} failed to stop cleanly:`, extractConnectionEvidence(error).details);
    });
  }

  /** Roll a credential ref back to its previous plain value, or clear it. */
  /**
   * Begin an out-of-band authorization for a transport that needs one (the
   * Agent mailbox authorizes by WeChat QR code rather than a password). The
   * pending device code is held until the matching poll completes it.
   */
  async startAuthorization({ transport, hostname, workspace } = {}) {
    const key = normalizeEmailTransport(transport ?? DEFAULT_EMAIL_TRANSPORT);
    if (key !== 'agent-mail') {
      throw new TypeError(t('该接入方式不需要扫码授权'));
    }
    // The official CLI owns the Agent mailbox protocol, including the token
    // refresh: a hand-written client was refused one (invalid_grant), so the
    // mailbox died an hour after every authorization.
    //
    // The CLI isolates accounts per workspace, so a mailbox authorizes into its
    // own. Sharing one workspace made every Agent mailbox read the first
    // account that logged in.
    const scope = String(workspace ?? '').trim();
    const device = await startAgentMailAuthorization({ workspace: scope });
    const expiresAt = Date.now() + (device.expiresInMs ?? AGENT_MAIL_AUTH_TTL_MS);
    const pending = { transport: key, workspace: scope, startedAt: Date.now(), expiresAt };
    this.#pendingAuth = pending;
    // Persisted too: the code outlives a reload, and losing it would strand an
    // authorization the user already completed.
    await this.#storePendingAuth(pending);
    return {
      transport: key,
      // The authorization page embeds its own WeChat QR, so the URL is what the
      // user opens or scans; there is no one-shot scan payload to render.
      browserUrl: device.browserUrl,
      inputCode: device.inputCode,
      expiresAt,
      expiresInMs: expiresAt - Date.now(),
    };
  }

  /**
   * Check a pending authorization once.
   *
   * The CLI stores the credentials itself, so nothing is returned to bind —
   * only the address, which the panel shows and names the mailbox after.
   */
  async pollAuthorization() {
    // The in-memory copy is authoritative; the stored one survives a restart so
    // a completed scan can still be redeemed.
    const pending = this.#pendingAuth ?? await this.#loadPendingAuth();
    if (!pending) throw new TypeError(t('扫码授权尚未开始'));
    if (Date.now() > pending.expiresAt) {
      this.#pendingAuth = null;
      await this.#storePendingAuth(null);
      throw new TypeError(t('扫码授权已超时，请重新发起'));
    }
    const status = await agentMailAuthorizationStatus({ workspace: pending.workspace });
    if (!status.loggedIn) {
      return { status: status.status || 'pending', authorized: false };
    }
    this.#pendingAuth = null;
    await this.#storePendingAuth(null);
    // The mailbox address is what the account is named and bound as, and the
    // server already knows it — so it is read here rather than typed.
    let identity = null;
    try {
      identity = await fetchAgentMailIdentity({ workspace: pending.workspace });
    } catch (error) {
      this.#logger.warn?.('[dsh-im:email] unable to resolve the mailbox identity:', extractConnectionEvidence(error).details);
    }
    return {
      status: 'authorized',
      authorized: true,
      ...(identity ? { address: identity.address, name: identity.name } : {}),
    };
  }

  /** Find the mailbox state that owns a pending authorization. */
  async #stateForPendingAuth() {
    if (!this.#stateFor) return null;
    const [first] = this.#configStore.list();
    if (!first) return null;
    return this.#stateFor(first.botId).catch(() => null);
  }

  async #storePendingAuth(pending) {
    const state = await this.#stateForPendingAuth();
    await state?.setPendingAuth?.(pending).catch(() => {});
  }

  async #loadPendingAuth() {
    const state = await this.#stateForPendingAuth();
    const stored = state?.pendingAuth?.() ?? null;
    if (!stored) return null;
    if (Date.now() > stored.expiresAt) return null;
    return stored;
  }

  /**
   * Persist tokens a transport rotated mid-flight. The Agent mailbox hands back
   * a new refresh token on every refresh, so losing the write would break the
   * next refresh and eventually sign the mailbox out.
   */
  async persistTokens(botId, tokens = {}) {
    const config = this.#configStore.list().find((entry) => entry.botId === botId);
    if (!config) return false;
    const accessToken = typeof tokens.accessToken === 'string' ? tokens.accessToken : '';
    if (!accessToken) return false;
    const current = (await this.#resolveSecrets(config)) ?? {};
    const next = {
      ...current,
      accessToken,
      ...(typeof tokens.refreshToken === 'string' && tokens.refreshToken
        ? { refreshToken: tokens.refreshToken } : {}),
    };
    await atConnectionStage('credential.save', () => this.#credentials.set(config.tokenRef, JSON.stringify(next)), 'credential-store');
    this.#touch();
    return true;
  }

  async #restoreCredential(tokenRef, previous) {
    if (typeof previous !== 'string' || !previous) {
      await atConnectionStage('credential.remove', () => this.#credentials.unset(tokenRef), 'credential-store').catch(() => {});
      return;
    }
    await atConnectionStage('credential.save', () => this.#credentials.set(tokenRef, previous), 'credential-store').catch(() => {});
  }

  get diagnostics() { return this.#diagnostics; }
  #safeError(code, error) {
    return this.#diagnostics.report(error, { reuse: true, stage: 'connection.start', code }).publicError;
  }

  #touch() {
    this.#revision += 1;
  }

  async #withBotTransition(botId, task) {
    const previous = this.#transitions.get(botId) ?? Promise.resolve();
    const next = previous.then(task, task).finally(() => {
      if (this.#transitions.get(botId) === next) this.#transitions.delete(botId);
    });
    this.#transitions.set(botId, next);
    return next;
  }
}

export { EmailConfigStore, EmailStateStore };
