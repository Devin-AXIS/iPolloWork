import { extractConnectionEvidence, atConnectionStage, createConnectionDiagnostics } from '../shared/connection-error.mjs';
import { randomUUID } from 'node:crypto';

import { deriveWecomBotIdentity, maskWecomBotId } from './config-store.mjs';
import {
  connectionTestMessage,
  connectionTestTargetUnavailable,
} from '../shared/connection-test.mjs';
import { t } from '../shared/i18n.mjs';
import { publicMessageFailure } from '../shared/message-failure.mjs';

const ACTIVE_ATTEMPT_STATES = new Set(['pending', 'connecting']);
const TERMINAL_ATTEMPT_STATES = new Set(['connected', 'failed', 'cancelled', 'expired']);

// A runtime may legitimately sit in 'connecting' while the SDK retries with
// backoff: every retry emits 'reconnecting', which refreshes lastCheckedAt at
// least once per reconnect cycle. After a server-side disconnect, however, the
// SDK marks the close manual and stops for good without emitting anything
// else, so 'connecting' goes stale forever and initialize() below would keep
// skipping the bot on every supervisor pass. A 'connecting' status whose last
// transition is older than this grace is treated as stalled and restarted.
const STALLED_CONNECTING_GRACE_MS = 120_000;
// Two deployments holding the same credential keep kicking each other, and
// every restart authenticates successfully (so failure-based backoff never
// triggers) while only surviving one reconnect cycle. A connection that
// dropped again within this window of being established counts as short-lived
// and its restarts are paced; a connection that stays healthy this long
// proves the bot is not in a kick loop and clears the pacing.
const STABLE_CONNECTION_MS = 300_000;
// Automatic restarts are paced per bot: when the same credential is held by
// another connection, each side kicks the other, and restarting at supervisor
// cadence would storm the provider and fight the legitimate holder.
const RESTART_BACKOFF_INITIAL_MS = 60_000;
const RESTART_BACKOFF_MAX_MS = 600_000;

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeError(code, message) {
  return Object.freeze({ code, message });
}

function publicAttempt(record) {
  if (!record) return null;
  return {
    attemptId: record.id,
    status: record.state,
    pollIntervalMs: record.pollIntervalMs,
    qrRevision: record.qrRevision,
    ...(record.verificationUrl ? { verificationUrl: record.verificationUrl } : {}),
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
    ...(record.botId ? { botId: record.botId } : {}),
    ...(record.error ? { error: structuredClone(record.error) } : {}),
  };
}

export class WecomController {
  #qrAuth;
  #credentials;
  #configStore;
  #createRuntime;
  #deleteState;
  #logger;
  #diagnostics;
  #runtimes = new Map();
  #errors = new Map();
  #attempts = new Map();
  #activeAttemptId = null;
  #transitions = new Map();
  #revision = 0;
  #closed = false;
  #now;
  #restartBackoff = new Map();

  constructor({
    qrAuth,
    credentials,
    configStore,
    createRuntime,
    deleteState = async () => {},
    logger = console,
    nowImpl = Date.now,
  }) {
    if (!qrAuth || typeof qrAuth.start !== 'function' || typeof qrAuth.poll !== 'function') {
      throw new TypeError('Enterprise WeChat QR auth is required');
    }
    if (!credentials || typeof credentials.resolve !== 'function'
      || typeof credentials.set !== 'function' || typeof credentials.unset !== 'function') {
      throw new TypeError('WecomController requires the DSH credential provider');
    }
    if (!configStore || typeof configStore.list !== 'function'
      || typeof configStore.save !== 'function' || typeof configStore.remove !== 'function') {
      throw new TypeError('WecomController requires a config store');
    }
    if (typeof createRuntime !== 'function') throw new TypeError('createRuntime is required');
    if (typeof nowImpl !== 'function') throw new TypeError('nowImpl must be a function');
    this.#qrAuth = qrAuth;
    this.#credentials = credentials;
    this.#configStore = configStore;
    this.#createRuntime = createRuntime;
    this.#deleteState = deleteState;
    this.#logger = logger;
    this.#now = nowImpl;
    this.#diagnostics = createConnectionDiagnostics({ channel: 'wecom', logger });
  }

  get diagnostics() { return this.#diagnostics; }

  #failure(error, code, message) {
    const stage = code.startsWith('qr-') ? 'qr.begin' : code === 'activation-failed' ? 'activation' : 'connection.start';
    return this.#diagnostics.report(error, { reuse: true, stage, publicError: { code, message } }).publicError;
  }

  async initialize() {
    if (this.#closed) return this.status();
    for (const config of this.#configStore.list()) {
      await this.#withBotTransition(config.botId, async () => {
        const existing = this.#runtimes.get(config.botId)?.status;
        if (this.#closed || existing?.ready) {
          // A single successful authenticate does not prove the bot is back
          // for good: in a kick loop every restart authenticates and is
          // dropped again one cycle later. Only a connection that has now
          // held healthy past the stability window clears the pacing.
          if (existing?.ready && this.#connectionStable(existing)) this.#restartBackoff.delete(config.botId);
          return;
        }
        if (existing?.wecomConnectionState === 'connecting' && !this.#stalledConnecting(existing)) return;
        const stalled = this.#stalledConnecting(existing);
        const shortLived = stalled && this.#shortLivedConnecting(existing);
        const backoff = this.#restartBackoff.get(config.botId);
        if (backoff && backoff.nextAttemptAt > this.#now()) return;
        if (shortLived && !backoff) {
          // First short-lived drop: schedule one pacing window before
          // contending for the credential again, instead of grabbing it back
          // at supervisor cadence and immediately kicking the other side.
          this.#scheduleRestartBackoff(config.botId);
          this.#logger.warn?.(`[dsh-im:wecom] bot ${config.botId} connection was short-lived; deferring reconnect`);
          return;
        }
        try {
          const secret = await this.#resolveSecret(config.secretRef);
          if (!secret) {
            this.#errors.set(config.botId, safeError('missing-secret', t('企业微信机器人凭据缺失，请移除后重新扫码。')));
            return;
          }
          if (stalled) {
            if (shortLived) {
              // The pacing window has elapsed; contend again. The schedule
              // above doubles the next window first, so a renewed kick loop
              // slows down instead of cycling at supervisor cadence.
              this.#scheduleRestartBackoff(config.botId);
            }
            this.#logger.warn?.(`[dsh-im:wecom] bot ${config.botId} connection stalled in 'connecting'; restarting`);
          }
          await this.#startRuntime(config, secret);
          this.#errors.delete(config.botId);
        } catch (error) {
          this.#errors.set(config.botId, this.#failure(error, 'connection-failed', t('企业微信连接未就绪，插件会自动重试。')));
          this.#scheduleRestartBackoff(config.botId);
          this.#logger.warn?.(`[dsh-im:wecom] bot ${config.botId} failed to initialize`);
        } finally {
          this.#touch();
        }
      });
    }
    return this.status();
  }

  #stalledConnecting(status) {
    if (status?.wecomConnectionState !== 'connecting') return false;
    const { lastCheckedAt } = status;
    return typeof lastCheckedAt === 'number' && this.#now() - lastCheckedAt > STALLED_CONNECTING_GRACE_MS;
  }

  // Whether the connection that just went silent had been established for
  // less than the stability window: the signature of a credential contested
  // by another deployment, as opposed to an ordinary healthy connection that
  // dropped. Based on the timestamps of the drop (lastCheckedAt) and of the
  // last successful authenticate (lastConnectedAt), so it does not change as
  // time passes without a new connection.
  #shortLivedConnecting(status) {
    const { lastCheckedAt, lastConnectedAt } = status ?? {};
    return typeof lastCheckedAt === 'number' && typeof lastConnectedAt === 'number'
      && lastCheckedAt > lastConnectedAt
      && lastCheckedAt - lastConnectedAt < STABLE_CONNECTION_MS;
  }

  #connectionStable(status) {
    const { lastConnectedAt } = status ?? {};
    return typeof lastConnectedAt === 'number' && this.#now() - lastConnectedAt >= STABLE_CONNECTION_MS;
  }

  #scheduleRestartBackoff(botId) {
    const entry = this.#restartBackoff.get(botId) ?? { consecutive: 0, nextAttemptAt: 0 };
    entry.consecutive += 1;
    entry.nextAttemptAt = this.#now()
      + Math.min(RESTART_BACKOFF_INITIAL_MS * 2 ** (entry.consecutive - 1), RESTART_BACKOFF_MAX_MS);
    this.#restartBackoff.set(botId, entry);
  }

  async startProvisioning() {
    if (this.#closed) throw new Error('Enterprise WeChat controller is closed');
    if (this.#activeAttemptId) await this.cancelProvisioning(this.#activeAttemptId);
    const record = {
      id: randomUUID(),
      state: 'pending',
      createdAt: Date.now(),
      expiresAt: null,
      pollIntervalMs: 3_000,
      qrRevision: 1,
      verificationUrl: null,
      scode: null,
      botId: null,
      error: null,
      controller: new AbortController(),
      polling: null,
      transition: null,
    };
    this.#attempts.set(record.id, record);
    this.#activeAttemptId = record.id;
    this.#touch();
    try {
      const started = await this.#qrAuth.start({ signal: record.controller.signal });
      record.scode = cleanString(started.scode);
      record.verificationUrl = cleanString(started.verificationUrl);
      record.expiresAt = Number(started.expiresAt);
      record.pollIntervalMs = Math.min(10_000, Math.max(500, Number(started.pollIntervalMs) || 3_000));
      if (!record.scode || !record.verificationUrl || !Number.isFinite(record.expiresAt)) {
        throw new Error('Enterprise WeChat QR auth returned incomplete data');
      }
      this.#touch();
      return publicAttempt(record);
    } catch (error) {
      record.state = record.controller.signal.aborted ? 'cancelled' : 'failed';
      record.error = record.controller.signal.aborted
        ? safeError('cancelled', t('扫码绑定已取消。'))
        : this.#failure(error, 'qr-start-failed', t('无法生成企业微信二维码，请稍后重试。'));
      this.#finishAttempt(record);
      throw error;
    }
  }

  async registrationStatus(attemptId) {
    const record = this.#attempts.get(attemptId);
    if (!record || TERMINAL_ATTEMPT_STATES.has(record.state)) return publicAttempt(record);
    if (record.state === 'connecting') {
      await record.transition?.catch(() => undefined);
      return publicAttempt(record);
    }
    if (Date.now() >= record.expiresAt) {
      record.state = 'expired';
      record.error = safeError('expired', t('企业微信二维码已过期，请重新生成。'));
      record.controller.abort();
      this.#finishAttempt(record);
      return publicAttempt(record);
    }
    if (!record.polling) {
      const polling = this.#pollAttempt(record).finally(() => {
        if (record.polling === polling) record.polling = null;
      });
      record.polling = polling;
    }
    await record.polling.catch(() => undefined);
    return publicAttempt(record);
  }

  async bindCredentials({ botId, secret } = {}) {
    if (this.#closed) throw new Error('Enterprise WeChat controller is closed');
    const remoteBotId = cleanString(botId);
    const normalizedSecret = cleanString(secret);
    if (!remoteBotId || !normalizedSecret) {
      throw new TypeError('Enterprise WeChat Bot ID and Secret are required');
    }
    if (this.#activeAttemptId) await this.cancelProvisioning(this.#activeAttemptId);
    if (this.#closed) throw new Error('Enterprise WeChat controller is closed');
    const identity = deriveWecomBotIdentity(remoteBotId);
    await this.#withBotTransition(identity.botId, async () => {
      if (this.#closed) throw new Error('Enterprise WeChat controller is closed');
      const previousConfig = this.#configStore.getByRemoteBotId(remoteBotId);
      const previousSecret = await atConnectionStage('credential.read', () => this.#credentials.resolve(identity.secretRef), 'credential-store');
      if (this.#closed) throw new Error('Enterprise WeChat controller is closed');
      const config = {
        botId: identity.botId,
        remoteBotId,
        secretRef: identity.secretRef,
        createdAt: previousConfig?.createdAt ?? new Date().toISOString(),
        connectedAt: new Date().toISOString(),
      };
      await atConnectionStage('credential.save', () => this.#credentials.set(identity.secretRef, normalizedSecret), 'credential-store');
      try {
        await atConnectionStage('account.save', () => this.#configStore.save(config), 'account-config');
      } catch (error) {
        await this.#restoreCredential(identity.secretRef, previousSecret);
        throw error;
      }
      try {
        await this.#startRuntime(config, normalizedSecret);
        this.#errors.delete(identity.botId);
      } catch {
        this.#errors.set(
          identity.botId,
          safeError('connection-failed', t('企业微信机器人已绑定，消息连接暂未就绪。')),
        );
        this.#logger.warn?.(`[dsh-im:wecom] bot ${identity.botId} credential connection failed`);
      }
      this.#touch();
    });
    return this.status();
  }

  async cancelProvisioning(attemptId) {
    const record = this.#attempts.get(attemptId);
    if (!record) return null;
    if (!TERMINAL_ATTEMPT_STATES.has(record.state)) {
      record.controller.abort();
      await Promise.allSettled([record.polling, record.transition].filter(Boolean));
      if (!TERMINAL_ATTEMPT_STATES.has(record.state)) record.state = 'cancelled';
      record.error ??= safeError('cancelled', t('扫码绑定已取消。'));
      this.#finishAttempt(record);
    }
    return publicAttempt(record);
  }

  async reconnectBot(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Enterprise WeChat bot');
    await this.#withBotTransition(botId, async () => {
      const secret = await this.#resolveSecret(config.secretRef);
      if (!secret) throw new Error('Enterprise WeChat bot secret is missing');
      try {
        await this.#startRuntime(config, secret);
        this.#errors.delete(botId);
      } catch (error) {
        this.#errors.set(botId, this.#failure(error, 'connection-failed', t('企业微信连接仍未就绪，请稍后重试。')));
        throw error;
      } finally {
        this.#touch();
      }
    });
    return this.status();
  }

  async sendConnectionTest(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Enterprise WeChat bot');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.sendConnectionTest !== 'function') {
        throw connectionTestTargetUnavailable(t('企业微信机器人'));
      }
      return runtime.sendConnectionTest(connectionTestMessage(
        t('企业微信机器人（{botId}）', { botId: maskWecomBotId(config.remoteBotId) }),
      ));
    });
  }

  async sendProactiveText(botId, target, text, options = {}) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Enterprise WeChat bot');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.sendProactiveText !== 'function') {
        const error = new Error(t('企业微信连接当前离线'));
        error.code = 'bot-not-connected';
        throw error;
      }
      return runtime.sendProactiveText(target, text, options);
    });
  }

  async presentSessionSyncApproval(botId, target, interaction, options = {}) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Enterprise WeChat bot');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.presentSessionSyncApproval !== 'function') {
        const error = new Error(t('企业微信连接当前离线'));
        error.code = 'bot-not-connected';
        throw error;
      }
      return runtime.presentSessionSyncApproval(target, interaction, options);
    });
  }

  async deleteBot(botId) {
    const warnings = [];
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Enterprise WeChat bot');
    await this.#withBotTransition(botId, async () => {
      const previous = await atConnectionStage('credential.read', () => this.#credentials.resolve(config.secretRef), 'credential-store');
      await this.#stopRuntime(botId);
      try {
        await atConnectionStage('credential.remove', () => this.#credentials.unset(config.secretRef), 'credential-store');
        await atConnectionStage('account.remove', () => this.#configStore.remove(botId), 'account-config');
      } catch (error) {
        if (!this.#configStore.get(botId)) {
          warnings.push(this.#diagnostics.report(error, { operation: 'bot.delete', stage: 'workspace.cleanup', warning: true,
            publicError: { code: 'workspace-cleanup-failed', message: '账号已移除，但本地状态清理失败。' } }).publicError);
        } else {
          if (previous?.value) {
            await atConnectionStage('credential.save', () => this.#credentials.set(config.secretRef, previous.value), 'credential-store').catch(() => undefined);
            await this.#startRuntime(config, previous.value).catch(() => undefined);
          }
          throw new Error('Unable to remove the Enterprise WeChat bot safely.', { cause: error });
        }
      }
      await this.#deleteState({ botId, config }).catch(error => { warnings.push(this.#diagnostics.report(error, { reuse: true, operation: 'bot.delete', stage: 'state.cleanup', resource: 'account-state', warning: true, publicError: { code: 'cleanup-failed', message: '账号已移除，但本地状态清理失败。' } }).publicError); });
      this.#errors.delete(botId);
      this.#touch();
    });
    return { ...this.status(), ...(warnings.length ? { warnings } : {}) };
  }

  status() {
    const bots = this.#configStore.list().map((config) => {
      const runtimeStatus = this.#runtimes.get(config.botId)?.status ?? null;
      const connected = runtimeStatus?.ready === true
        && runtimeStatus.wecomConnectionState === 'connected'
        && runtimeStatus.harnessReachable === true;
      const state = connected ? 'connected'
        : runtimeStatus?.wecomConnectionState === 'connecting' ? 'connecting'
          : this.#errors.has(config.botId) || runtimeStatus?.wecomConnectionState === 'failed'
            ? 'error' : 'offline';
      return {
        botId: config.botId,
        state,
        connected,
        configured: true,
        bot: { name: t('企业微信机器人'), appIdMasked: maskWecomBotId(config.remoteBotId) },
        health: {
          status: connected ? 'healthy' : state === 'error' ? 'error' : 'offline',
          summary: connected ? t('企业微信 WebSocket 长连接运行正常')
            : state === 'error' ? t('企业微信连接未就绪，插件会自动重试') : t('企业微信连接当前离线'),
          lastCheckedAt: runtimeStatus?.lastCheckedAt ?? null,
          lastConnectedAt: runtimeStatus?.lastConnectedAt ?? null,
        },
        stats: {
          messagesReceived: runtimeStatus?.messagesReceived ?? 0,
          messagesReplied: runtimeStatus?.messagesReplied ?? 0,
        },
        lastMessageError: publicMessageFailure(runtimeStatus?.lastMessageError),
        error: structuredClone(runtimeStatus?.error ?? this.#errors.get(config.botId) ?? null),
      };
    });
    const connectedCount = bots.filter((bot) => bot.connected).length;
    const active = this.#activeAttemptId ? this.#attempts.get(this.#activeAttemptId) : null;
    return {
      schemaVersion: 1,
      revision: this.#revision,
      state: active && ACTIVE_ATTEMPT_STATES.has(active.state) ? 'provisioning'
        : bots.length === 0 ? 'disconnected'
          : connectedCount === bots.length ? 'connected'
            : connectedCount > 0 ? 'degraded' : 'offline',
      bots,
      totals: { configured: bots.length, connected: connectedCount },
      ...(active && ACTIVE_ATTEMPT_STATES.has(active.state)
        ? { provisioning: publicAttempt(active) } : {}),
    };
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#activeAttemptId) await this.cancelProvisioning(this.#activeAttemptId);
    await Promise.allSettled([...this.#transitions.values()]);
    await Promise.allSettled([...this.#runtimes.keys()].map((botId) => this.#stopRuntime(botId)));
  }

  async #pollAttempt(record) {
    try {
      const result = await this.#qrAuth.poll({ scode: record.scode, signal: record.controller.signal });
      if (record.controller.signal.aborted || TERMINAL_ATTEMPT_STATES.has(record.state)) return;
      if (result.status === 'waiting') return;
      if (result.status === 'expired') {
        record.state = 'expired';
        record.error = safeError('expired', t('企业微信二维码已过期，请重新生成。'));
        this.#finishAttempt(record);
        return;
      }
      if (result.status !== 'success') {
        record.state = 'failed';
        record.error = safeError('qr-connect-failed', t('企业微信扫码没有完成，请重新生成二维码。'));
        this.#finishAttempt(record);
        return;
      }
      record.state = 'connecting';
      record.verificationUrl = null;
      record.expiresAt = null;
      record.scode = null;
      this.#touch();
      const transition = this.#completeProvisioning(record, result);
      record.transition = transition;
      await transition;
    } catch (error) {
      if (record.controller.signal.aborted) return;
      record.state = 'failed';
      record.error = this.#failure(error, 'qr-connect-failed', t('企业微信扫码服务暂时不可用，请重新生成二维码。'));
      this.#logger.warn?.('[dsh-im:wecom] QR polling failed');
      this.#finishAttempt(record);
    }
  }

  async #completeProvisioning(record, result) {
    try {
      const remoteBotId = cleanString(result.remoteBotId);
      const secret = cleanString(result.secret);
      if (!remoteBotId || !secret) throw new Error('Enterprise WeChat authorization returned incomplete credentials');
      record.botId = await this.#activateBot(record, { remoteBotId, secret });
      record.state = 'connected';
      record.error = null;
    } catch (error) {
      if (record.controller.signal.aborted) {
        record.state = 'cancelled';
        record.error = safeError('cancelled', t('扫码绑定已取消。'));
      } else {
        record.state = 'failed';
        record.error = this.#failure(error, 'activation-failed', t('企业微信已授权，但无法安全保存接入配置。'));
        this.#logger.error?.('[dsh-im:wecom] provisioning failed');
      }
    } finally {
      this.#finishAttempt(record);
    }
  }

  async #activateBot(record, { remoteBotId, secret }) {
    const identity = deriveWecomBotIdentity(remoteBotId);
    const previousConfig = this.#configStore.getByRemoteBotId(remoteBotId);
    const previousSecret = await atConnectionStage('credential.read', () => this.#credentials.resolve(identity.secretRef), 'credential-store');
    const config = {
      botId: identity.botId,
      remoteBotId,
      secretRef: identity.secretRef,
      createdAt: previousConfig?.createdAt ?? new Date().toISOString(),
      connectedAt: new Date().toISOString(),
    };
    return this.#withBotTransition(identity.botId, async () => {
      await atConnectionStage('credential.save', () => this.#credentials.set(identity.secretRef, secret), 'credential-store');
      try {
        if (record.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        await atConnectionStage('account.save', () => this.#configStore.save(config), 'account-config');
      } catch (error) {
        await this.#restoreCredential(identity.secretRef, previousSecret);
        throw error;
      }
      try {
        if (record.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        await this.#startRuntime(config, secret);
        this.#errors.delete(identity.botId);
      } catch (error) {
        if (record.controller.signal.aborted) {
          await this.#stopRuntime(identity.botId);
          if (previousConfig) await atConnectionStage('account.save', () => this.#configStore.save(previousConfig), 'account-config').catch(() => undefined);
          else {
            const removed = await atConnectionStage('account.remove', () => this.#configStore.remove(identity.botId), 'account-config').catch(() => null);
            if (removed) {
              await this.#deleteState({ botId: identity.botId, config }).catch((cleanupError) => {
                this.#logger.warn?.('[dsh-im:wecom] cancelled bot state cleanup failed:', extractConnectionEvidence(cleanupError).details);
              });
            }
          }
          await this.#restoreCredential(identity.secretRef, previousSecret);
          throw error;
        }
        this.#errors.set(identity.botId, this.#failure(error, 'connection-failed', t('企业微信机器人已绑定，消息连接暂未就绪。')));
        this.#logger.warn?.(`[dsh-im:wecom] bot ${identity.botId} activation connection failed`);
      }
      this.#touch();
      return identity.botId;
    });
  }

  async #startRuntime(config, secret) {
    if (this.#closed) throw new Error('Enterprise WeChat controller is closed');
    await this.#stopRuntime(config.botId);
    if (this.#closed) throw new Error('Enterprise WeChat controller is closed');
    const runtime = await atConnectionStage('runtime.prepare', () => this.#createRuntime({ botId: config.botId, config, secret }));
    if (!runtime || typeof runtime.start !== 'function' || typeof runtime.stop !== 'function') {
      throw new TypeError('createRuntime returned an invalid Enterprise WeChat runtime');
    }
    this.#runtimes.set(config.botId, runtime);
    try {
      await runtime.start();
    } catch (error) {
      await runtime.stop().catch(() => undefined);
      this.#runtimes.delete(config.botId);
      throw error;
    }
  }

  async #stopRuntime(botId) {
    const runtime = this.#runtimes.get(botId);
    this.#runtimes.delete(botId);
    await runtime?.stop().catch((error) => {
      this.#logger.warn?.(`[dsh-im:wecom] bot ${botId} failed to stop cleanly:`, extractConnectionEvidence(error).details);
    });
  }

  async #resolveSecret(ref) {
    const result = await atConnectionStage('credential.read', () => this.#credentials.resolve(ref), 'credential-store');
    return cleanString(result?.value);
  }

  async #restoreCredential(ref, previous) {
    if (previous?.value) await atConnectionStage('credential.save', () => this.#credentials.set(ref, previous.value), 'credential-store').catch(() => undefined);
    else await atConnectionStage('credential.remove', () => this.#credentials.unset(ref), 'credential-store').catch(() => undefined);
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

  #finishAttempt(record) {
    record.scode = null;
    record.verificationUrl = null;
    record.expiresAt = null;
    if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
    this.#touch();
    const terminal = [...this.#attempts.values()].filter((attempt) => TERMINAL_ATTEMPT_STATES.has(attempt.state));
    while (terminal.length > 16) this.#attempts.delete(terminal.shift().id);
  }

  #touch() {
    this.#revision += 1;
  }
}
