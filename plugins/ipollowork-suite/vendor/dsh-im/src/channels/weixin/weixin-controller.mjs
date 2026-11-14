import { randomUUID } from 'node:crypto';
import { createWeixinDiagnostics, knownWeixinErrorCode, weixinStageError } from './connection-error.mjs';

import {
  normalizeWeixinApiBaseUrl,
  WEIXIN_QR_BASE_URL,
  WeixinApiError,
} from './weixin-api.mjs';
import { deriveWeixinBotIdentity, maskWeixinAccountId } from './config-store.mjs';
import {
  connectionTestMessage,
  connectionTestTargetUnavailable,
} from '../shared/connection-test.mjs';
import { publicMessageFailure } from '../shared/message-failure.mjs';
import { t } from '../shared/i18n.mjs';

const ACTIVE_ATTEMPT_STATES = new Set([
  'starting',
  'pending',
  'scanned',
  'needs_verification',
  'connecting',
]);
const TERMINAL_ATTEMPT_STATES = new Set(['connected', 'expired', 'failed', 'cancelled']);
const QR_TTL_MS = 5 * 60_000;
function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function abortError() {
  return new DOMException('Provisioning was cancelled', 'AbortError');
}

function apiBaseFromServer(value, fallback) {
  const raw = cleanString(value);
  if (!raw) return normalizeWeixinApiBaseUrl(fallback);
  return normalizeWeixinApiBaseUrl(raw.includes('://') ? raw : `https://${raw}`);
}

function publicAttempt(record) {
  if (!record) return null;
  return {
    attemptId: record.id,
    status: record.state,
    ...(record.verificationUrl ? { verificationUrl: record.verificationUrl } : {}),
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
    pollIntervalMs: 1_000,
    ...(record.state === 'needs_verification' ? { verificationRequired: true } : {}),
    ...(record.botId ? { botId: record.botId } : {}),
    ...(record.alreadyConnected ? { alreadyConnected: true } : {}),
    ...(record.error ? { error: structuredClone(record.error) } : {}),
  };
}

function safeAccountError(code, message) {
  return Object.freeze({ code, message });
}

function preserveActivationError(error, fallbackCode) {
  return knownWeixinErrorCode(error?.code) ? error : weixinStageError(fallbackCode, error);
}

export class WeixinController {
  #api;
  #credentials;
  #configStore;
  #createRuntime;
  #deleteState;
  #diagnostics;
  #runtimes = new Map();
  #errors = new Map();
  #attempts = new Map();
  #activeAttemptId = null;
  #transitions = new Map();
  #revision = 0;
  #closed = false;

  constructor({
    api,
    credentials,
    configStore,
    createRuntime,
    deleteState = async () => {},
    logger = console,
    diagnostics,
  }) {
    if (!api || typeof api.beginLogin !== 'function' || typeof api.pollLogin !== 'function') {
      throw new TypeError('WeixinController requires a Weixin API client');
    }
    if (!credentials
      || typeof credentials.resolve !== 'function'
      || typeof credentials.set !== 'function'
      || typeof credentials.unset !== 'function') {
      throw new TypeError('WeixinController requires the DSH credential provider');
    }
    if (!configStore
      || typeof configStore.list !== 'function'
      || typeof configStore.save !== 'function'
      || typeof configStore.remove !== 'function') {
      throw new TypeError('WeixinController requires a config store');
    }
    if (typeof createRuntime !== 'function') throw new TypeError('createRuntime is required');
    this.#api = api;
    this.#credentials = credentials;
    this.#configStore = configStore;
    this.#createRuntime = createRuntime;
    this.#deleteState = deleteState;
    this.#diagnostics = diagnostics ?? createWeixinDiagnostics({ logger });
  }

  async initialize() {
    if (this.#closed) return this.status();
    for (const config of this.#configStore.list()) {
      const current = this.#runtimes.get(config.botId);
      if (current?.status?.ready === true) continue;
      await this.#withBotTransition(config.botId, async () => {
        const latest = this.#configStore.get(config.botId);
        if (!latest || this.#closed) return;
        try {
          const token = await this.#resolveToken(latest.tokenRef);
          if (!token) throw weixinStageError('missing-token');
          await this.#startRuntime(latest, token, { operation: 'connection.restore', automatic: true });
          this.#errors.delete(latest.botId);
          this.#diagnostics.clear(latest.botId);
        } catch (error) {
          this.#errors.set(latest.botId, this.#diagnostics.report(error, {
            operation: 'connection.restore', stage: 'connection.start', botId: latest.botId, automatic: true,
          }).publicError);
        } finally {
          this.#touch();
        }
      });
    }
    return this.status();
  }

  reportRestoreFailure(error) {
    for (const config of this.#configStore.list()) {
      if (this.#runtimes.get(config.botId)?.status?.ready) continue;
      this.#errors.set(config.botId, this.#diagnostics.report(error, {
        operation: 'connection.restore', stage: 'harness.check', code: 'harness-check-unknown-failed',
        botId: config.botId, automatic: true,
      }).publicError);
    }
    this.#touch();
  }

  async startProvisioning() {
    if (this.#closed) throw new Error('dsh-weixin controller is closed');
    if (this.#activeAttemptId) await this.cancelProvisioning(this.#activeAttemptId);

    const record = {
      id: randomUUID(),
      state: 'starting',
      createdAt: Date.now(),
      expiresAt: Date.now() + QR_TTL_MS,
      controller: new AbortController(),
      pendingVerifyCode: null,
      verifyResolve: null,
      currentBaseUrl: WEIXIN_QR_BASE_URL,
      error: null,
      botId: null,
      task: null,
    };
    this.#attempts.set(record.id, record);
    this.#activeAttemptId = record.id;
    this.#touch();

    try {
      const localTokens = (await Promise.all(
        this.#configStore.list().slice(-10).map(async (config) => {
          try { return await this.#resolveToken(config.tokenRef); }
          catch (error) {
            this.#diagnostics.report(error, { operation: 'provision.begin', botId: config.botId, warning: true });
            return undefined;
          }
        }),
      )).filter(Boolean);
      const login = await this.#api.beginLogin({
        localTokens,
        signal: record.controller.signal,
      });
      this.#assertAttemptActive(record);
      record.qrcode = login.qrcode;
      record.verificationUrl = login.qrcodeUrl;
      record.state = 'pending';
      record.expiresAt = Date.now() + QR_TTL_MS;
      this.#touch();
      record.task = this.#runProvisioning(record);
      return publicAttempt(record);
    } catch (error) {
      if (record.controller.signal.aborted) {
        record.state = 'cancelled';
        record.error = safeAccountError('cancelled', t('扫码绑定已取消。'));
      } else {
        record.state = 'failed';
        error = this.#diagnostics.report(error, { operation: 'provision.begin', stage: 'qr.begin', code: 'qr-start-failed' });
        record.error = error.publicError;
      }
      if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
      this.#touch();
      throw error;
    }
  }

  registrationStatus(attemptId) {
    return publicAttempt(this.#attempts.get(attemptId));
  }

  async submitVerification(attemptId, verifyCode) {
    const record = this.#attempts.get(attemptId);
    if (!record || record.state !== 'needs_verification') {
      throw weixinStageError(record ? 'provision-state-invalid' : 'provision-attempt-not-found', undefined, 'qr.verify');
    }
    const code = cleanString(verifyCode);
    if (!code || !/^\d{4,8}$/.test(code)) {
      throw new TypeError('Verification code must contain 4 to 8 digits');
    }
    record.pendingVerifyCode = code;
    record.state = 'scanned';
    record.verifyResolve?.();
    record.verifyResolve = null;
    this.#touch();
    return publicAttempt(record);
  }

  async cancelProvisioning(attemptId) {
    const record = this.#attempts.get(attemptId);
    if (!record) return null;
    if (!TERMINAL_ATTEMPT_STATES.has(record.state)) {
      record.controller.abort();
      record.verifyResolve?.();
      record.verifyResolve = null;
      await record.task?.catch(() => undefined);
      if (!TERMINAL_ATTEMPT_STATES.has(record.state)) record.state = 'cancelled';
      record.error ??= safeAccountError('cancelled', t('扫码绑定已取消。'));
    }
    if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
    this.#touch();
    return publicAttempt(record);
  }

  async reconnectBot(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Weixin account');
    await this.#withBotTransition(botId, async () => {
      try {
        const token = await this.#resolveToken(config.tokenRef);
        if (!token) throw weixinStageError('missing-token');
        await this.#startRuntime(config, token, { operation: 'bot.reconnect' });
        this.#errors.delete(botId);
        this.#diagnostics.clear(botId);
      } catch (error) {
        const failure = this.#diagnostics.report(error, { operation: 'bot.reconnect', stage: 'connection.start', botId });
        this.#errors.set(botId, failure.publicError);
        throw failure;
      } finally {
        this.#touch();
      }
    });
    return this.status();
  }

  async sendConnectionTest(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Weixin account');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.sendConnectionTest !== 'function') {
        throw connectionTestTargetUnavailable(t('微信机器人'));
      }
      return runtime.sendConnectionTest(connectionTestMessage(
        t('微信机器人（{name}）', { name: maskWeixinAccountId(config.accountId) }),
      ));
    });
  }

  async sendProactiveText(botId, target, text, options = {}) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Weixin account');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.sendProactiveText !== 'function') {
        const error = new Error(t('微信连接当前离线'));
        error.code = 'bot-not-connected';
        throw error;
      }
      return runtime.sendProactiveText(target, text, options);
    });
  }

  async presentSessionSyncApproval(botId, target, interaction, options = {}) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Weixin account');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.presentSessionSyncApproval !== 'function') {
        const error = new Error(t('微信连接当前离线'));
        error.code = 'bot-not-connected';
        throw error;
      }
      return runtime.presentSessionSyncApproval(target, interaction, options);
    });
  }

  async deleteBot(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw weixinStageError('workspace-bot-not-found', undefined, 'account.remove');
    const warnings = [];
    const context = { operation: 'bot.delete', botId };
    await this.#withBotTransition(botId, async () => {
      const previousToken = await this.#credentials.resolve(config.tokenRef).catch(error => {
        warnings.push(this.#diagnostics.report(weixinStageError('credential-read-failed', error), { ...context, warning: true }).publicError);
      });
      warnings.push(...await this.#stopRuntime(botId));
      let stage = 'credential-remove-failed';
      try {
        await this.#writeCredential(config.tokenRef, undefined);
        stage = 'account-config-remove-failed';
        await this.#configStore.remove(botId);
      } catch (error) {
        // A config removal observer may throw after the account was durably removed.
        if (stage === 'account-config-remove-failed' && !this.#configStore.get(botId)) {
          warnings.push(this.#diagnostics.report(weixinStageError('workspace-cleanup-failed', error), { ...context, warning: true }).publicError);
        } else {
          const failure = this.#diagnostics.report(weixinStageError(stage, error), context);
          let rollback = previousToken?.value ? 'succeeded' : 'unknown';
          if (previousToken?.value) {
            for (const restore of [
              () => this.#credentials.set(config.tokenRef, previousToken.value),
              () => this.#startRuntime(config, previousToken.value, context),
            ]) {
              try { await restore(); }
              catch (restoreError) {
                rollback = 'failed';
                this.#diagnostics.report(weixinStageError('rollback-failed', restoreError), { ...context, warning: true, parentReferenceId: failure.publicError.details.referenceId });
              }
            }
          }
          if (rollback === 'succeeded' && !this.#runtimes.get(botId)?.status?.ready) rollback = 'unknown';
          this.#diagnostics.outcome(failure, rollback);
          throw failure;
        }
      }
      try {
        await this.#deleteState({ botId, config });
      } catch (error) {
        warnings.push(this.#diagnostics.report(weixinStageError('account-state-cleanup-failed', error), { ...context, warning: true }).publicError);
      }
      this.#errors.delete(botId);
      this.#diagnostics.clear(botId);
      this.#touch();
    });
    return { ...this.status(), ...(warnings.length ? { warnings } : {}) };
  }

  status() {
    const accounts = this.#configStore.list().map((config) => {
      const runtimeStatus = this.#runtimes.get(config.botId)?.status ?? null;
      const connected = runtimeStatus?.ready === true
        && runtimeStatus.weixinConnectionState === 'connected'
        && runtimeStatus.harnessReachable === true;
      const state = connected
        ? 'connected'
        : runtimeStatus?.weixinConnectionState === 'connecting'
          ? 'connecting'
          : this.#errors.has(config.botId) || runtimeStatus?.weixinConnectionState === 'failed'
            ? 'error'
            : 'offline';
      const error = connected ? null : this.#errors.get(config.botId) ?? runtimeStatus?.connectionError ?? (state === 'error'
        ? safeAccountError('connection-failed', t('微信连接未就绪，插件会自动重试。'))
        : null);
      return {
        botId: config.botId,
        state,
        connected,
        configured: true,
        bot: {
          name: t('微信机器人'),
          accountIdMasked: maskWeixinAccountId(config.accountId),
        },
        health: {
          status: connected ? 'healthy' : state === 'error' ? 'error' : 'offline',
          summary: connected
            ? t('微信消息长轮询运行正常')
            : state === 'error'
              ? t('微信连接未就绪，插件会自动重试')
              : t('微信连接当前离线'),
          lastCheckedAt: runtimeStatus?.lastCheckedAt ?? null,
        },
        stats: {
          messagesReceived: runtimeStatus?.messagesReceived ?? 0,
          messagesReplied: runtimeStatus?.messagesReplied ?? 0,
        },
        lastMessageError: publicMessageFailure(runtimeStatus?.lastMessageError),
        error: error ? structuredClone(error) : null,
      };
    });
    const connectedCount = accounts.filter((account) => account.connected).length;
    const active = this.#activeAttemptId ? this.#attempts.get(this.#activeAttemptId) : null;
    return {
      schemaVersion: 1,
      revision: this.#revision,
      state: active && ACTIVE_ATTEMPT_STATES.has(active.state)
        ? 'provisioning'
        : accounts.length === 0
          ? 'disconnected'
          : connectedCount === accounts.length
            ? 'connected'
            : connectedCount > 0
              ? 'degraded'
              : 'offline',
      bots: accounts,
      totals: { configured: accounts.length, connected: connectedCount },
      ...(active && ACTIVE_ATTEMPT_STATES.has(active.state)
        ? { provisioning: publicAttempt(active) }
        : {}),
    };
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#activeAttemptId) await this.cancelProvisioning(this.#activeAttemptId);
    await Promise.allSettled([...this.#runtimes.keys()].map((botId) => this.#stopRuntime(botId)));
    this.#diagnostics.clear();
  }

  async #runProvisioning(record) {
    try {
      while (!record.controller.signal.aborted && Date.now() < record.expiresAt) {
        if (record.state === 'needs_verification' && !record.pendingVerifyCode) {
          await new Promise((resolve) => {
            record.verifyResolve = resolve;
            if (record.controller.signal.aborted) resolve();
          });
          record.verifyResolve = null;
          this.#assertAttemptActive(record);
        }

        const response = await this.#api.pollLogin({
          qrcode: record.qrcode,
          baseUrl: record.currentBaseUrl,
          verifyCode: record.pendingVerifyCode,
          signal: record.controller.signal,
        });
        this.#assertAttemptActive(record);
        if (response.status === 'wait') {
          record.state = 'pending';
        } else if (response.status === 'scaned') {
          record.pendingVerifyCode = null;
          record.state = 'scanned';
        } else if (response.status === 'need_verifycode') {
          record.pendingVerifyCode = null;
          record.state = 'needs_verification';
        } else if (response.status === 'verify_code_blocked') {
          record.state = 'failed';
          record.error = safeAccountError('verification-blocked', t('配对码多次错误，请重新生成二维码。'));
          break;
        } else if (response.status === 'expired') {
          record.state = 'expired';
          record.error = safeAccountError('expired', t('二维码已过期，请重新生成。'));
          break;
        } else if (response.status === 'scaned_but_redirect') {
          record.currentBaseUrl = apiBaseFromServer(response.redirect_host, record.currentBaseUrl);
          record.state = 'scanned';
        } else if (response.status === 'binded_redirect') {
          const existing = this.#configStore.list().find(
            (config) => this.#runtimes.get(config.botId)?.status?.ready === true,
          ) ?? this.#configStore.list()[0];
          if (!existing) {
            record.state = 'failed';
            record.error = safeAccountError('already-bound', t('该微信账号已绑定，但本机没有可恢复的凭据。'));
          } else {
            record.state = 'connected';
            record.botId = existing.botId;
            record.alreadyConnected = true;
          }
          break;
        } else if (response.status === 'confirmed') {
          const token = cleanString(response.bot_token);
          const accountId = cleanString(response.ilink_bot_id);
          const ownerUserId = cleanString(response.ilink_user_id);
          if (!token || !accountId || !ownerUserId) {
            throw new WeixinApiError('incomplete-login', t('微信授权成功，但返回的账号凭据不完整。'));
          }
          record.state = 'connecting';
          this.#touch();
          const baseUrl = apiBaseFromServer(response.baseurl, record.currentBaseUrl);
          record.botId = await this.#activateAccount(record, {
            token,
            accountId,
            ownerUserId,
            baseUrl,
          });
          record.state = 'connected';
          record.error = null;
          break;
        }
        this.#touch();
      }
      if (!record.controller.signal.aborted && Date.now() >= record.expiresAt
        && !TERMINAL_ATTEMPT_STATES.has(record.state)) {
        record.state = 'expired';
        record.error = safeAccountError('expired', t('二维码已过期，请重新生成。'));
      }
    } catch (error) {
      if (record.controller.signal.aborted || error?.name === 'AbortError') {
        record.state = 'cancelled';
        record.error = safeAccountError('cancelled', t('扫码绑定已取消。'));
      } else {
        const failedStage = record.state === 'connecting' ? 'activation' : 'qr.poll';
        record.state = 'failed';
        record.error = this.#diagnostics.report(error, {
          operation: 'provision.poll', stage: failedStage,
          code: 'activation-unknown-failed', rollback: error?.rollback,
        }).publicError;
      }
    } finally {
      record.pendingVerifyCode = null;
      record.verifyResolve?.();
      record.verifyResolve = null;
      if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
      this.#touch();
      this.#pruneAttempts();
    }
  }

  async #activateAccount(record, { token, accountId, ownerUserId, baseUrl }) {
    const identity = deriveWeixinBotIdentity(accountId);
    const previousConfig = this.#configStore.getByAccountId(accountId);
    const config = {
      botId: identity.botId,
      accountId,
      tokenRef: identity.tokenRef,
      ownerUserId,
      baseUrl,
      createdAt: previousConfig?.createdAt ?? new Date().toISOString(),
      connectedAt: new Date().toISOString(),
    };
    let previousToken;
    try {
      previousToken = await this.#credentials.resolve(identity.tokenRef);
    } catch (error) {
      throw weixinStageError('credential-read-failed', error);
    }

    return this.#withBotTransition(identity.botId, async () => {
      try {
        try {
          await this.#writeCredential(identity.tokenRef, token);
        } catch (error) {
          throw weixinStageError('credential-save-failed', error);
        }
        this.#assertAttemptActive(record);
        try {
          await this.#configStore.save(config);
        } catch (error) {
          throw weixinStageError('account-config-save-failed', error);
        }
        this.#assertAttemptActive(record);
        await this.#startRuntime(config, token, { operation: 'provision.poll' });
        this.#assertAttemptActive(record);
        this.#errors.delete(identity.botId);
        this.#touch();
        return identity.botId;
      } catch (error) {
        const cancelled = record.controller.signal.aborted || error?.name === 'AbortError';
        const failure = cancelled ? error : this.#diagnostics.report(error, {
          operation: 'provision.poll', stage: 'activation', code: 'activation-unknown-failed', botId: identity.botId,
        });
        let rollback = 'succeeded';
        const recover = async (action) => {
          try { return await action(); }
          catch (restoreError) {
            rollback = 'failed';
            this.#diagnostics.report(weixinStageError('rollback-failed', restoreError), {
              operation: cancelled ? 'provision.cancel' : 'provision.poll', botId: identity.botId, warning: true,
              parentReferenceId: failure.publicError?.details.referenceId,
            });
          }
        };
        await this.#stopRuntime(identity.botId);
        if (previousConfig) await recover(() => this.#configStore.save(previousConfig));
        else if (this.#configStore.get(identity.botId)) {
          const removed = await recover(() => this.#configStore.remove(identity.botId));
          if (removed) await recover(() => this.#deleteState({ botId: identity.botId, config }));
        }
        await recover(() => previousToken?.value
          ? this.#credentials.set(identity.tokenRef, previousToken.value)
          : this.#credentials.unset(identity.tokenRef));
        if (previousConfig && previousToken?.value) {
          await recover(() => this.#startRuntime(previousConfig, previousToken.value, { operation: 'provision.poll' }));
          if (rollback === 'succeeded' && !this.#runtimes.get(identity.botId)?.status?.ready) rollback = 'unknown';
        }
        this.#diagnostics.outcome(failure, rollback);
        throw failure;
      }
    });
  }

  async #startRuntime(config, token, context = {}) {
    await this.#stopRuntime(config.botId);
    let runtime;
    try {
      runtime = await this.#createRuntime({ botId: config.botId, config, token });
    } catch (error) {
      throw preserveActivationError(error, 'runtime-prepare-failed');
    }
    if (!runtime || typeof runtime.start !== 'function' || typeof runtime.stop !== 'function') {
      throw weixinStageError(
        'runtime-prepare-failed',
        new TypeError('createRuntime returned an invalid Weixin runtime'),
      );
    }
    try {
      await runtime.start({ ...context, botId: config.botId });
      this.#runtimes.set(config.botId, runtime);
    } catch (error) {
      await runtime.stop().catch(() => undefined);
      throw preserveActivationError(error, 'connection-start-failed');
    }
  }

  async #stopRuntime(botId) {
    const runtime = this.#runtimes.get(botId);
    this.#runtimes.delete(botId);
    try {
      const stopped = await runtime?.stop();
      return stopped?.warnings ?? [];
    } catch (error) {
      return [this.#diagnostics.report(error, {
        operation: 'connection.close', stage: 'connection.stop', code: 'connection-stop-failed', botId, warning: true,
      }).publicError];
    }
  }

  async #resolveToken(ref) {
    try { return cleanString((await this.#credentials.resolve(ref))?.value); }
    catch (error) { throw weixinStageError('credential-read-failed', error); }
  }

  async #writeCredential(ref, value) {
    try {
      if (value === undefined) await this.#credentials.unset(ref);
      else await this.#credentials.set(ref, value);
    } catch (cause) {
      let description;
      try { description = await this.#credentials.describe?.(ref); } catch { /* Preserve the original write failure. */ }
      if (description?.writable === false) {
        cause = Object.assign(new Error('Credential source is read-only', { cause }), { code: 'read-only' });
      }
      throw weixinStageError(value === undefined ? 'credential-remove-failed' : 'credential-save-failed', cause);
    }
  }

  #assertAttemptActive(record) {
    if (record.controller.signal.aborted || this.#activeAttemptId !== record.id) throw abortError();
  }

  #withBotTransition(botId, operation) {
    const previous = this.#transitions.get(botId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const settled = current.finally(() => {
      if (this.#transitions.get(botId) === settled) this.#transitions.delete(botId);
    });
    this.#transitions.set(botId, settled);
    return settled;
  }

  #pruneAttempts() {
    for (const [id, record] of this.#attempts) {
      if (id !== this.#activeAttemptId && TERMINAL_ATTEMPT_STATES.has(record.state)
        && this.#attempts.size > 16) {
        this.#attempts.delete(id);
      }
    }
  }

  #touch() {
    this.#revision += 1;
  }
}
