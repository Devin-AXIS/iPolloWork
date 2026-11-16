import { extractConnectionEvidence, atConnectionStage, createConnectionDiagnostics } from '../shared/connection-error.mjs';
import { randomUUID } from 'node:crypto';

import {
  deriveDingtalkBotIdentity,
  deriveDingtalkSenderKey,
  maskDingtalkClientId,
  maskDingtalkSenderId,
} from './config-store.mjs';
import {
  connectionTestMessage,
  connectionTestTargetUnavailable,
} from '../shared/connection-test.mjs';
import { t } from '../shared/i18n.mjs';
import { publicMessageFailure } from '../shared/message-failure.mjs';
import {
  describeDingtalkConnectionFailure,
  dingtalkPublicConnectionError,
  dingtalkRuntimeStartError,
} from './connection-error.mjs';

const ACTIVE_ATTEMPT_STATES = new Set(['starting', 'pending', 'connecting']);
const TERMINAL_ATTEMPT_STATES = new Set(['connected', 'expired', 'failed', 'cancelled']);

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeError(code, message) {
  return Object.freeze({ code, message });
}

function nowFrom(clock) {
  return typeof clock?.now === 'function' ? clock.now() : clock();
}

function isoNow(clock) {
  return new Date(nowFrom(clock)).toISOString();
}

function abortError() {
  return new DOMException('DingTalk provisioning was cancelled', 'AbortError');
}

function publicAttempt(record) {
  if (!record) return null;
  return {
    attemptId: record.id,
    status: record.state,
    ...(record.verificationUrl ? { verificationUrl: record.verificationUrl } : {}),
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
    ...(record.pollIntervalMs ? { pollIntervalMs: record.pollIntervalMs } : {}),
    ...(record.botId ? { botId: record.botId } : {}),
    ...(record.alreadyConnected ? { alreadyConnected: true } : {}),
    ...(record.error ? { error: structuredClone(record.error) } : {}),
  };
}

function runtimeStatus(runtime) {
  if (!runtime) return {};
  const value = typeof runtime.status === 'function' ? runtime.status() : runtime.status;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isRuntimeConnected(runtime, status) {
  if (!runtime) return false;
  if (status.connected === false || status.ready === false) return false;
  const state = cleanString(
    status.dingtalkStreamState
      ?? status.dingtalkConnectionState
      ?? status.connectionState
      ?? status.state,
  )?.toLowerCase();
  if (['failed', 'error', 'offline', 'disconnected', 'stopped'].includes(state)) return false;
  return status.connected === true
    || status.ready === true
    || state === 'connected'
    || state === 'ready';
}

function normalizePendingSender(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const staffId = cleanString(value.staffId ?? value.senderStaffId ?? value.senderId);
  if (!staffId) return null;
  const suppliedRequestId = cleanString(value.requestId);
  const opaqueRequestId = suppliedRequestId
    && /^ding_sender_[A-Za-z0-9_-]{1,100}$/.test(suppliedRequestId)
    && !suppliedRequestId.includes(staffId)
      ? suppliedRequestId
      : null;
  if (!opaqueRequestId) return null;
  return {
    requestId: opaqueRequestId,
    staffId,
    displayName: cleanString(value.displayName ?? value.senderName ?? value.senderNick) ?? t('钉钉用户'),
    requestedAt: cleanString(value.requestedAt),
  };
}

function internalPendingSenders(status) {
  if (!Array.isArray(status.pendingSenders)) return [];
  const seen = new Set();
  const senders = [];
  for (const value of status.pendingSenders) {
    const sender = normalizePendingSender(value);
    if (!sender || seen.has(sender.staffId)) continue;
    seen.add(sender.staffId);
    senders.push(sender);
  }
  return senders;
}

function publicPendingSender(sender) {
  return {
    requestId: sender.requestId,
    displayName: sender.displayName,
    senderIdMasked: maskDingtalkSenderId(sender.staffId),
    requestedAt: sender.requestedAt,
  };
}

function publicApprovedSender(sender) {
  return {
    senderKey: sender.senderKey,
    displayName: cleanString(sender.displayName) ?? t('钉钉用户'),
    senderIdMasked: maskDingtalkSenderId(sender.staffId),
    approvedAt: cleanString(sender.approvedAt),
  };
}

/** Coordinates DingTalk QR registration, credentials, runtimes, and sender approvals. */
export class DingtalkController {
  #deviceAuth;
  #credentials;
  #configStore;
  #createRuntime;
  #deleteState;
  #logger;
  #diagnostics;
  #clock;
  #runtimes = new Map();
  #errors = new Map();
  #attempts = new Map();
  #activeAttemptId = null;
  #transitions = new Map();
  #revision = 0;
  #closed = false;

  /**
   * @param {object} options Controller dependencies.
   * @param {object} options.deviceAuth Host-only DingTalk device auth client.
   * @param {object} options.credentials DSH credential provider.
   * @param {object} options.configStore Loaded DingTalk config store.
   * @param {Function} options.createRuntime Runtime factory.
   * @param {Function} [options.deleteState] Per-bot state cleanup callback.
   * @param {Console} [options.logger] Host logger.
   * @param {{now(): number}|(()=>number)} [options.clock] Injectable clock.
   */
  constructor({
    deviceAuth,
    credentials,
    configStore,
    createRuntime,
    deleteState = async () => {},
    logger = console,
    clock = Date,
  }) {
    if (!deviceAuth
      || typeof deviceAuth.start !== 'function'
      || typeof deviceAuth.poll !== 'function') {
      throw new TypeError('DingtalkController requires a DingTalk device auth client');
    }
    if (!credentials
      || typeof credentials.resolve !== 'function'
      || typeof credentials.set !== 'function'
      || typeof credentials.unset !== 'function') {
      throw new TypeError('DingtalkController requires the DSH credential provider');
    }
    if (!configStore
      || typeof configStore.list !== 'function'
      || typeof configStore.get !== 'function'
      || typeof configStore.getByClientId !== 'function'
      || typeof configStore.save !== 'function'
      || typeof configStore.remove !== 'function') {
      throw new TypeError('DingtalkController requires a loaded config store');
    }
    if (typeof createRuntime !== 'function') throw new TypeError('createRuntime is required');
    if (typeof deleteState !== 'function') throw new TypeError('deleteState must be a function');
    if (typeof clock !== 'function' && typeof clock?.now !== 'function') {
      throw new TypeError('clock must be a function or expose now()');
    }
    this.#deviceAuth = deviceAuth;
    this.#credentials = credentials;
    this.#configStore = configStore;
    this.#createRuntime = createRuntime;
    this.#deleteState = deleteState;
    this.#logger = logger;
    this.#diagnostics = createConnectionDiagnostics({ channel: 'dingtalk', prefix: 'DT-CONN', logger });
    this.#clock = clock;
  }

  /** Starts all configured DingTalk runtimes whose secrets are available. */
  get diagnostics() { return this.#diagnostics; }
  #failure(error, code, message) {
    const stage = code.startsWith('poll-') ? 'qr.poll' : code === 'activation-failed' ? 'activation' : 'qr.begin';
    return this.#diagnostics.report(error, { reuse: true, stage, publicError: { code, message } }).publicError;
  }

  async initialize() {
    if (this.#closed) return this.status();
    for (const config of this.#configStore.list()) {
      const current = this.#runtimes.get(config.botId);
      try {
        if (isRuntimeConnected(current, runtimeStatus(current))) continue;
      } catch {
        // A runtime with an unreadable status is replaced below.
      }
      await this.#withBotTransition(config.botId, async () => {
        const latest = this.#configStore.get(config.botId);
        if (!latest || this.#closed) return;
        let clientSecret;
        try {
          clientSecret = await this.#resolveSecret(latest.secretRef);
          if (!clientSecret) {
            this.#errors.set(
              latest.botId,
              safeError('missing-secret', t('钉钉机器人凭据缺失，请移除后重新扫码。')),
            );
            this.#touch();
            return;
          }
          await this.#startRuntime(latest, clientSecret);
          this.#errors.delete(latest.botId);
        } catch (error) {
          this.#rememberConnectionFailure({
            config: latest,
            clientSecret,
            error,
            fallbackMessage: '钉钉连接未就绪，请稍后重试。',
            context: `bot ${latest.botId} failed to initialize`,
          });
        }
        this.#touch();
      });
    }
    return this.status();
  }

  /** Starts one DingTalk QR registration, cancelling any prior active attempt. */
  async startProvisioning({ signal } = {}) {
    if (this.#closed) throw new Error('dsh-dingtalk controller is closed');
    if (this.#activeAttemptId) await this.cancelProvisioning(this.#activeAttemptId);
    const record = {
      id: randomUUID(),
      state: 'starting',
      controller: new AbortController(),
      deviceCode: null,
      verificationUrl: null,
      expiresAt: null,
      pollIntervalMs: null,
      pollTask: null,
      botId: null,
      alreadyConnected: false,
      error: null,
    };
    this.#attempts.set(record.id, record);
    this.#activeAttemptId = record.id;
    this.#touch();
    const abortFromRequest = () => record.controller.abort(signal?.reason);
    if (signal?.aborted) abortFromRequest();
    else signal?.addEventListener('abort', abortFromRequest, { once: true });
    try {
      const begun = await this.#deviceAuth.start({ signal: record.controller.signal });
      this.#assertAttemptActive(record);
      record.deviceCode = cleanString(begun.deviceCode);
      record.verificationUrl = cleanString(begun.verificationUrl);
      record.expiresAt = Number(begun.expiresAt);
      record.pollIntervalMs = Number(begun.pollIntervalMs);
      if (!record.deviceCode
        || !record.verificationUrl
        || !Number.isFinite(record.expiresAt)
        || !Number.isFinite(record.pollIntervalMs)
        || record.pollIntervalMs <= 0) {
        throw new Error('DingTalk device auth returned incomplete registration metadata');
      }
      record.state = 'pending';
      this.#touch();
      return publicAttempt(record);
    } catch (error) {
      if (record.controller.signal.aborted || error?.name === 'AbortError') {
        record.state = 'cancelled';
        record.error = safeError('cancelled', t('扫码接入已取消。'));
      } else {
        record.state = 'failed';
        record.error = this.#failure(error, 'qr-start-failed', t('无法生成钉钉二维码，请稍后重试。'));
      }
      if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
      this.#touch();
      if (record.state === 'failed') throw error;
      return publicAttempt(record);
    } finally {
      signal?.removeEventListener('abort', abortFromRequest);
    }
  }

  /** Binds one DingTalk application with an existing Client ID and Client Secret. */
  async bindCredentials({ clientId, clientSecret } = {}) {
    if (this.#closed) throw new Error('dsh-dingtalk controller is closed');
    const normalizedClientId = cleanString(clientId);
    const normalizedSecret = cleanString(clientSecret);
    if (!normalizedClientId || !normalizedSecret) {
      throw new TypeError('DingTalk Client ID and Client Secret are required');
    }
    if (this.#activeAttemptId) await this.cancelProvisioning(this.#activeAttemptId);
    if (this.#closed) throw new Error('dsh-dingtalk controller is closed');
    const identity = deriveDingtalkBotIdentity(normalizedClientId);
    await this.#withBotTransition(identity.botId, async () => {
      if (this.#closed) throw abortError();
      const previousConfig = this.#configStore.getByClientId(normalizedClientId);
      const previousSecret = await atConnectionStage('credential.read', () => this.#credentials.resolve(identity.secretRef), 'credential-store');
      if (this.#closed) throw abortError();
      const config = {
        botId: identity.botId,
        clientId: normalizedClientId,
        secretRef: identity.secretRef,
        approvedSenders: previousConfig?.approvedSenders ?? [],
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
      } catch (error) {
        this.#rememberConnectionFailure({
          config,
          clientSecret: normalizedSecret,
          error,
          fallbackMessage: '钉钉已接入，但消息连接暂未就绪，请稍后重试。',
          context: `credential-bound bot ${identity.botId} is not ready`,
        });
      }
      this.#touch();
    });
    return this.status();
  }

  /** Polls one QR registration without exposing its device code or returned secret. */
  async registrationStatus(attemptId) {
    const record = this.#attempts.get(attemptId);
    if (!record) return null;
    if (TERMINAL_ATTEMPT_STATES.has(record.state) || record.state === 'starting') {
      return publicAttempt(record);
    }
    if (nowFrom(this.#clock) >= record.expiresAt) {
      record.state = 'expired';
      record.error = safeError('expired', t('二维码已过期，请重新生成。'));
      if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
      this.#touch();
      return publicAttempt(record);
    }
    if (!record.pollTask) {
      const task = this.#pollRegistration(record).finally(() => {
        if (record.pollTask === task) record.pollTask = null;
      });
      record.pollTask = task;
    }
    await record.pollTask;
    return publicAttempt(record);
  }

  /** Cancels an active QR registration. */
  async cancelProvisioning(attemptId) {
    const record = this.#attempts.get(attemptId);
    if (!record) return null;
    if (!TERMINAL_ATTEMPT_STATES.has(record.state)) {
      record.controller.abort();
      await record.pollTask?.catch(() => undefined);
      if (!TERMINAL_ATTEMPT_STATES.has(record.state)) record.state = 'cancelled';
      record.error ??= safeError('cancelled', t('扫码接入已取消。'));
    }
    if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
    this.#touch();
    return publicAttempt(record);
  }

  /** Replaces one bot runtime using its stored credential. */
  async reconnectBot(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown DingTalk bot');
    await this.#withBotTransition(botId, async () => {
      const clientSecret = await this.#resolveSecret(config.secretRef);
      if (!clientSecret) throw new Error('The DingTalk client secret is missing');
      try {
        await this.#startRuntime(config, clientSecret);
        this.#errors.delete(botId);
      } catch (error) {
        const publicError = this.#rememberConnectionFailure({
          config,
          clientSecret,
          error,
          fallbackMessage: '钉钉连接仍未就绪，请稍后重试。',
          context: `bot ${botId} failed to reconnect`,
        });
        throw dingtalkPublicConnectionError(publicError, error);
      } finally {
        this.#touch();
      }
    });
    return this.status();
  }

  async sendConnectionTest(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown DingTalk bot');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.sendConnectionTest !== 'function') {
        throw connectionTestTargetUnavailable(t('钉钉机器人'));
      }
      return runtime.sendConnectionTest(connectionTestMessage(
        t('钉钉机器人（{clientId}）', { clientId: maskDingtalkClientId(config.clientId) }),
      ));
    });
  }

  async sendProactiveText(botId, target, text, options = {}) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown DingTalk bot');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.sendProactiveText !== 'function') {
        const error = new Error(t('钉钉消息连接当前离线'));
        error.code = 'bot-not-connected';
        throw error;
      }
      return runtime.sendProactiveText(target, text, options);
    });
  }

  async presentSessionSyncApproval(botId, target, interaction, options = {}) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown DingTalk bot');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.presentSessionSyncApproval !== 'function') {
        const error = new Error(t('钉钉消息连接当前离线'));
        error.code = 'bot-not-connected';
        throw error;
      }
      return runtime.presentSessionSyncApproval(target, interaction, options);
    });
  }

  /** Removes one bot, its secret, runtime, and local conversation state. */
  async deleteBot(botId) {
    const warnings = [];
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown DingTalk bot');
    await this.#withBotTransition(botId, async () => {
      const previousSecret = await atConnectionStage('credential.read', () => this.#credentials.resolve(config.secretRef), 'credential-store');
      await this.#stopRuntime(botId);
      try {
        await atConnectionStage('credential.remove', () => this.#credentials.unset(config.secretRef), 'credential-store');
        await atConnectionStage('account.remove', () => this.#configStore.remove(botId), 'account-config');
      } catch (error) {
        if (!this.#configStore.get(botId)) {
          warnings.push(this.#diagnostics.report(error, { operation: 'bot.delete', stage: 'workspace.cleanup', warning: true,
            publicError: { code: 'workspace-cleanup-failed', message: '账号已移除，但本地状态清理失败。' } }).publicError);
        } else {
          if (cleanString(previousSecret?.value)) {
            await atConnectionStage('credential.save', () => this.#credentials.set(config.secretRef, previousSecret.value), 'credential-store').catch(() => undefined);
            await this.#startRuntime(config, previousSecret.value).catch(() => undefined);
          }
          throw new Error('Unable to remove the DingTalk bot safely.', { cause: error });
        }
      }
      try {
        await this.#deleteState({ botId, config });
      } catch (error) {
        warnings.push(this.#diagnostics.report(error, { reuse: true, operation: 'bot.delete', stage: 'state.cleanup', warning: true,
          publicError: { code: 'cleanup-failed', message: '账号已移除，但本地状态清理失败。' } }).publicError);
      }
      this.#errors.delete(botId);
      this.#touch();
    });
    return { ...this.status(), ...(warnings.length ? { warnings } : {}) };
  }

  /** Approves one opaque pending-sender request for a bot. */
  async approveSender(botId, requestId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown DingTalk bot');
    const runtime = this.#runtimes.get(botId);
    const direct = typeof runtime?.pendingSender === 'function'
      ? normalizePendingSender(runtime.pendingSender(requestId))
      : null;
    const pending = internalPendingSenders(runtimeStatus(runtime));
    const sender = direct?.requestId === requestId
      ? direct
      : pending.find((candidate) => candidate.requestId === requestId);
    if (!sender) throw new Error('Unknown DingTalk sender approval request');
    if (config.approvedSenders.some((approved) => approved.staffId === sender.staffId)) {
      return this.status();
    }
    const updated = {
      ...config,
      approvedSenders: [
        ...config.approvedSenders,
        {
          senderKey: deriveDingtalkSenderKey(),
          staffId: sender.staffId,
          displayName: sender.displayName,
          approvedAt: isoNow(this.#clock),
        },
      ],
    };
    await this.#saveAndRestart(config, updated);
    return this.status();
  }

  /** Revokes one approved sender by its browser-safe sender key. */
  async revokeSender(botId, senderKey) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown DingTalk bot');
    const index = config.approvedSenders.findIndex(
      (sender) => sender.senderKey === senderKey,
    );
    if (index === -1) throw new Error('Unknown approved DingTalk sender');
    const approvedSenders = [...config.approvedSenders];
    approvedSenders.splice(index, 1);
    await this.#saveAndRestart(config, { ...config, approvedSenders });
    return this.status();
  }

  /** Returns browser-safe bot, health, and sender-approval state. */
  status() {
    const bots = this.#configStore.list().map((config) => {
      const runtime = this.#runtimes.get(config.botId);
      let currentStatus = {};
      try {
        currentStatus = runtimeStatus(runtime);
      } catch {
        currentStatus = { state: 'error' };
      }
      const connected = isRuntimeConnected(runtime, currentStatus);
      const accountError = currentStatus.error ?? this.#errors.get(config.botId);
      const state = connected ? 'connected' : accountError ? 'error' : 'offline';
      const approvedIds = new Set(config.approvedSenders.map((sender) => sender.staffId));
      const pending = internalPendingSenders(currentStatus)
        .filter((sender) => !approvedIds.has(sender.staffId))
        .map(publicPendingSender);
      return {
        botId: config.botId,
        state,
        connected,
        configured: true,
        bot: {
          name: t('钉钉机器人'),
          clientIdMasked: maskDingtalkClientId(config.clientId),
        },
        health: {
          status: connected ? 'healthy' : accountError ? 'error' : 'offline',
          summary: connected
            ? t('钉钉 Stream 消息连接运行正常')
            : accountError?.message ?? t('钉钉消息连接当前离线'),
          lastCheckedAt: currentStatus.lastCheckedAt ?? null,
        },
        stats: {
          messagesReceived: Number(currentStatus.messagesReceived) || 0,
          messagesReplied: Number(currentStatus.messagesReplied) || 0,
        },
        lastMessageError: publicMessageFailure(currentStatus.lastMessageError),
        senders: {
          pending,
          approved: config.approvedSenders.map(publicApprovedSender),
        },
        error: accountError ? structuredClone(accountError) : null,
      };
    });
    const connectedCount = bots.filter((bot) => bot.connected).length;
    const active = this.#activeAttemptId ? this.#attempts.get(this.#activeAttemptId) : null;
    return {
      schemaVersion: 1,
      revision: this.#revision,
      state: active && ACTIVE_ATTEMPT_STATES.has(active.state)
        ? 'provisioning'
        : bots.length === 0
          ? 'disconnected'
          : connectedCount === bots.length
            ? 'connected'
            : connectedCount > 0
              ? 'degraded'
              : 'offline',
      bots,
      totals: { configured: bots.length, connected: connectedCount },
      ...(active && ACTIVE_ATTEMPT_STATES.has(active.state)
        ? { provisioning: publicAttempt(active) }
        : {}),
    };
  }

  /** Cancels provisioning and stops every bot runtime. */
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#activeAttemptId) await this.cancelProvisioning(this.#activeAttemptId);
    await Promise.allSettled([...this.#runtimes.keys()].map((botId) => this.#stopRuntime(botId)));
    await Promise.allSettled([...this.#transitions.values()]);
    await Promise.allSettled([...this.#runtimes.keys()].map((botId) => this.#stopRuntime(botId)));
  }

  async #pollRegistration(record) {
    try {
      this.#assertAttemptActive(record);
      const response = await this.#deviceAuth.poll({
        deviceCode: record.deviceCode,
        signal: record.controller.signal,
      });
      this.#assertAttemptActive(record);
      const state = cleanString(response.status)?.toUpperCase();
      if (state === 'WAITING') {
        record.state = 'pending';
        record.error = null;
      } else if (state === 'SUCCESS') {
        const clientId = cleanString(response.clientId);
        const clientSecret = cleanString(response.clientSecret);
        if (!clientId || !clientSecret) throw new Error('DingTalk returned incomplete credentials');
        record.state = 'connecting';
        record.error = null;
        this.#touch();
        const activation = await this.#activateBot(record, { clientId, clientSecret });
        record.botId = activation.botId;
        record.alreadyConnected = activation.alreadyConnected;
        record.state = 'connected';
        if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
      } else if (state === 'EXPIRED') {
        record.state = 'expired';
        record.error = safeError('expired', t('二维码已过期，请重新生成。'));
        if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
      } else if (state === 'FAIL') {
        record.state = 'failed';
        record.error = safeError('authorization-failed', t('钉钉未完成机器人授权，请重新扫码。'));
        if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
      } else {
        record.state = 'pending';
        record.error = safeError('poll-pending', t('钉钉授权状态暂时不可用，正在重试。'));
      }
    } catch (error) {
      if (record.controller.signal.aborted || error?.name === 'AbortError') {
        record.state = 'cancelled';
        record.error = safeError('cancelled', t('扫码接入已取消。'));
        if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
      } else if (record.state === 'connecting') {
        record.state = 'failed';
        record.error = this.#failure(error,
          'activation-failed',
          t('钉钉已授权，但无法安全保存接入配置。'),
        );
        if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
        this.#logger.error?.('[dsh-dingtalk] bot activation failed');
      } else {
        record.state = 'pending';
        record.error = this.#failure(error, 'poll-failed', t('钉钉授权查询暂时失败，正在重试。'));
      }
    } finally {
      this.#touch();
      this.#pruneAttempts();
    }
  }

  async #activateBot(record, { clientId, clientSecret }) {
    const identity = deriveDingtalkBotIdentity(clientId);
    const previousConfig = this.#configStore.getByClientId(clientId);
    const previousSecret = await atConnectionStage('credential.read', () => this.#credentials.resolve(identity.secretRef), 'credential-store');
    const config = {
      botId: identity.botId,
      clientId,
      secretRef: identity.secretRef,
      approvedSenders: previousConfig?.approvedSenders ?? [],
    };
    return this.#withBotTransition(identity.botId, async () => {
      const rollback = async () => {
        await this.#stopRuntime(identity.botId);
        if (previousConfig) await atConnectionStage('account.save', () => this.#configStore.save(previousConfig), 'account-config').catch(() => undefined);
        else if (this.#configStore.get(identity.botId)) {
          const removed = await atConnectionStage('account.remove', () => this.#configStore.remove(identity.botId), 'account-config').catch(() => null);
          if (removed) {
            await this.#deleteState({ botId: identity.botId, config }).catch((cleanupError) => {
              this.#logger.warn?.('[dsh-dingtalk] failed to clean up cancelled bot state:', extractConnectionEvidence(cleanupError).details);
            });
          }
        }
        await this.#restoreCredential(identity.secretRef, previousSecret);
        if (previousConfig && cleanString(previousSecret?.value)) {
          await this.#startRuntime(previousConfig, previousSecret.value).catch(() => undefined);
        }
      };
      await atConnectionStage('credential.save', () => this.#credentials.set(identity.secretRef, clientSecret), 'credential-store');
      try {
        this.#assertAttemptActive(record);
        await atConnectionStage('account.save', () => this.#configStore.save(config), 'account-config');
        this.#assertAttemptActive(record);
      } catch (error) {
        await rollback();
        throw error;
      }
      try {
        await this.#startRuntime(config, clientSecret);
        this.#assertAttemptActive(record);
        this.#errors.delete(identity.botId);
      } catch (error) {
        if (record.controller.signal.aborted || this.#activeAttemptId !== record.id) {
          await rollback();
          throw abortError();
        }
        this.#rememberConnectionFailure({
          config,
          clientSecret,
          error,
          fallbackMessage: '钉钉已接入，但消息连接暂未就绪，请稍后重试。',
          context: `authorized bot ${identity.botId} is not ready`,
        });
      }
      return { botId: identity.botId, alreadyConnected: Boolean(previousConfig) };
    });
  }

  async #saveAndRestart(previousConfig, nextConfig) {
    return this.#withBotTransition(previousConfig.botId, async () => {
      const clientSecret = await this.#resolveSecret(previousConfig.secretRef);
      if (!clientSecret) throw new Error('The DingTalk client secret is missing');
      await atConnectionStage('account.save', () => this.#configStore.save(nextConfig), 'account-config');
      try {
        await this.#startRuntime(nextConfig, clientSecret);
        this.#errors.delete(previousConfig.botId);
      } catch (error) {
        await atConnectionStage('account.save', () => this.#configStore.save(previousConfig), 'account-config').catch(() => undefined);
        await this.#startRuntime(previousConfig, clientSecret).catch(() => undefined);
        const publicError = this.#rememberConnectionFailure({
          config: previousConfig,
          clientSecret,
          error,
          fallbackMessage: '钉钉连接未就绪，请稍后重试。',
          context: `bot ${previousConfig.botId} failed to apply updated settings`,
        });
        throw dingtalkPublicConnectionError(publicError, error);
      } finally {
        this.#touch();
      }
    });
  }

  async #startRuntime(config, clientSecret) {
    if (this.#closed) throw abortError();
    await this.#stopRuntime(config.botId);
    if (this.#closed) throw abortError();
    let runtime;
    try {
      runtime = await atConnectionStage('runtime.prepare', () => this.#createRuntime({
        botId: config.botId,
        config: structuredClone(config),
        clientSecret,
      }));
    } catch (error) {
      throw dingtalkRuntimeStartError('dingtalk-runtime-prepare-failed', error);
    }
    if (!runtime || typeof runtime.start !== 'function' || typeof runtime.stop !== 'function') {
      throw dingtalkRuntimeStartError(
        'dingtalk-runtime-prepare-failed',
        new TypeError('createRuntime returned an invalid DingTalk runtime'),
      );
    }
    if (this.#closed) {
      await runtime.stop().catch(() => undefined);
      throw abortError();
    }
    this.#runtimes.set(config.botId, runtime);
    try {
      await runtime.start();
      if (this.#closed) {
        await runtime.stop().catch(() => undefined);
        throw abortError();
      }
    } catch (error) {
      if (this.#runtimes.get(config.botId) === runtime) this.#runtimes.delete(config.botId);
      await runtime.stop().catch(() => undefined);
      throw dingtalkRuntimeStartError('dingtalk-stream-connect-failed', error);
    }
  }

  #rememberConnectionFailure({
    config,
    clientSecret,
    error,
    fallbackMessage,
    context,
  }) {
    const failure = describeDingtalkConnectionFailure(error, {
      fallbackMessage,
      clientId: config.clientId,
      clientSecret,
    });
    const reported = this.#diagnostics.report(error, { reuse: true, botId: config.botId, stage: 'connection.start', publicError: { ...failure.publicError, details: { dependencies: failure.diagnostic.dependencies, proxyConfigured: failure.diagnostic.proxy.configured } } }).publicError;
    const visible = { ...failure.publicError, details: reported.details };
    this.#errors.set(config.botId, visible);
    return visible;
  }

  async #stopRuntime(botId) {
    const runtime = this.#runtimes.get(botId);
    this.#runtimes.delete(botId);
    await runtime?.stop().catch(() => {
      this.#logger.warn?.(`[dsh-dingtalk] bot ${botId} failed to stop cleanly`);
    });
  }

  async #resolveSecret(secretRef) {
    const result = await atConnectionStage('credential.read', () => this.#credentials.resolve(secretRef), 'credential-store');
    return cleanString(result?.value);
  }

  async #restoreCredential(secretRef, previous) {
    try {
      if (cleanString(previous?.value)) await atConnectionStage('credential.save', () => this.#credentials.set(secretRef, previous.value), 'credential-store');
      else await atConnectionStage('credential.remove', () => this.#credentials.unset(secretRef), 'credential-store');
    } catch {
      this.#logger.error?.(`[dsh-dingtalk] failed to restore credential ${secretRef}`);
    }
  }

  #assertAttemptActive(record) {
    if (record.controller.signal.aborted || this.#activeAttemptId !== record.id) throw abortError();
  }

  #withBotTransition(botId, operation) {
    if (this.#closed) return Promise.reject(new Error('dsh-dingtalk controller is closed'));
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
      if (id !== this.#activeAttemptId
        && TERMINAL_ATTEMPT_STATES.has(record.state)
        && this.#attempts.size > 16) {
        this.#attempts.delete(id);
      }
    }
  }

  #touch() {
    this.#revision += 1;
  }
}

export { DingtalkController as DingTalkController };
