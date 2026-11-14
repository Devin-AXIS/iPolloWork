import { extractConnectionEvidence, atConnectionStage, createConnectionDiagnostics } from '../shared/connection-error.mjs';
import { randomUUID } from 'node:crypto';

import { connectionTestMessage } from '../shared/connection-test.mjs';
import { t } from '../shared/i18n.mjs';
import { publicMessageFailure } from '../shared/message-failure.mjs';
import {
  deriveWhatsappBotId,
  maskWhatsappAccount,
  normalizeWhatsappAccessPolicy,
} from './config-store.mjs';

const ACTIVE_ATTEMPT_STATES = new Set(['starting', 'pending', 'connecting']);
const TERMINAL_ATTEMPT_STATES = new Set(['connected', 'failed', 'cancelled']);
const QR_TTL_MS = 60_000;

function safeError(code, message) {
  return Object.freeze({ code, message });
}

function publicAttempt(record) {
  if (!record) return null;
  return {
    attemptId: record.id,
    status: record.state,
    qrRevision: record.qrRevision,
    pollIntervalMs: 1_000,
    ...(record.qrValue ? { qrValue: record.qrValue } : {}),
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
    ...(record.botId ? { botId: record.botId } : {}),
    ...(record.error ? { error: structuredClone(record.error) } : {}),
  };
}

export class WhatsappController {
  #configStore;
  #authPath;
  #createSession;
  #createRuntime;
  #deleteAuth;
  #deleteState;
  #logger;
  #diagnostics;
  #runtimes = new Map();
  #errors = new Map();
  #attempts = new Map();
  #transitions = new Map();
  #activeAttemptId = null;
  #revision = 0;
  #closed = false;

  constructor({
    configStore,
    authPath,
    createSession,
    createRuntime,
    deleteAuth = async () => {},
    deleteState = async () => {},
    logger = console,
  }) {
    if (!configStore || typeof configStore.list !== 'function'
      || typeof configStore.save !== 'function' || typeof configStore.remove !== 'function') {
      throw new TypeError('WhatsappController requires a config store');
    }
    if (typeof authPath !== 'function' || typeof createSession !== 'function'
      || typeof createRuntime !== 'function') {
      throw new TypeError('WhatsappController dependencies are incomplete');
    }
    this.#configStore = configStore;
    this.#authPath = authPath;
    this.#createSession = createSession;
    this.#createRuntime = createRuntime;
    this.#deleteAuth = deleteAuth;
    this.#deleteState = deleteState;
    this.#logger = logger;
    this.#diagnostics = createConnectionDiagnostics({ channel: 'whatsapp', logger });
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
        if (this.#closed || this.#runtimes.get(config.botId)?.status?.ready) return;
        try {
          await this.#startRuntime(config);
          this.#errors.delete(config.botId);
        } catch (error) {
          this.#errors.set(config.botId, this.#failure(error,
            error?.code === 'relink-required' ? 'relink-required' : 'connection-failed',
            error?.code === 'relink-required'
              ? t('WhatsApp 关联设备已失效，请移除后重新扫码。')
              : t('WhatsApp 连接未就绪，插件会自动重试。'),
          ));
          this.#logger.warn?.(`[dsh-im:whatsapp] bot ${config.botId} failed to initialize`);
        } finally {
          this.#touch();
        }
      });
    }
    return this.status();
  }

  async startProvisioning() {
    if (this.#closed) throw new Error('WhatsApp controller is closed');
    if (this.#activeAttemptId) await this.cancelProvisioning(this.#activeAttemptId);
    let resolveFirstQr;
    let rejectFirstQr;
    let firstQrSettled = false;
    const firstQr = new Promise((resolve, reject) => {
      resolveFirstQr = () => {
        if (firstQrSettled) return;
        firstQrSettled = true;
        resolve();
      };
      rejectFirstQr = (error) => {
        if (firstQrSettled) return;
        firstQrSettled = true;
        reject(error);
      };
    });
    const id = randomUUID();
    const record = {
      id,
      state: 'starting',
      authDirectory: id,
      createdAt: Date.now(),
      expiresAt: null,
      qrRevision: 0,
      qrValue: null,
      controller: new AbortController(),
      session: null,
      task: null,
      error: null,
      botId: null,
    };
    this.#attempts.set(id, record);
    this.#activeAttemptId = id;
    this.#touch();

    try {
      const session = await this.#createSession({
        authDir: this.#authPath(record.authDirectory),
        signal: record.controller.signal,
        logger: this.#logger,
        onQr: (value) => {
          if (record.controller.signal.aborted || TERMINAL_ATTEMPT_STATES.has(record.state)
            || typeof value !== 'string' || !value) return;
          record.qrValue = value;
          record.qrRevision += 1;
          record.expiresAt = Date.now() + QR_TTL_MS;
          record.state = 'pending';
          this.#touch();
          resolveFirstQr();
        },
      });
      record.session = session;
      record.task = session.ready.then((identity) => this.#completeProvisioning(record, identity))
        .catch((error) => this.#failProvisioning(record, error, rejectFirstQr));
      await firstQr;
      return publicAttempt(record);
    } catch (error) {
      await this.#failProvisioning(record, error, rejectFirstQr);
      throw error;
    }
  }

  registrationStatus(attemptId) {
    return publicAttempt(this.#attempts.get(attemptId));
  }

  async cancelProvisioning(attemptId) {
    const record = this.#attempts.get(attemptId);
    if (!record) return null;
    if (!TERMINAL_ATTEMPT_STATES.has(record.state)) {
      record.controller.abort();
      await record.session?.close().catch(() => undefined);
      await record.task?.catch(() => undefined);
      if (!TERMINAL_ATTEMPT_STATES.has(record.state)) {
        record.state = 'cancelled';
        record.error = safeError('cancelled', t('扫码接入已取消。'));
      }
      await this.#deleteAuth(record.authDirectory).catch(() => undefined);
    }
    if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
    this.#touch();
    return publicAttempt(record);
  }

  async reconnectBot(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown WhatsApp bot');
    await this.#withBotTransition(botId, async () => {
      try {
        await this.#startRuntime(config);
        this.#errors.delete(botId);
      } catch (error) {
        this.#errors.set(botId, this.#failure(error,
          error?.code === 'relink-required' ? 'relink-required' : 'connection-failed',
          error?.code === 'relink-required'
            ? t('WhatsApp 关联设备已失效，请移除后重新扫码。')
            : t('WhatsApp 连接仍未就绪，请稍后重试。'),
        ));
        throw error;
      } finally {
        this.#touch();
      }
    });
    return this.status();
  }

  async sendConnectionTest(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown WhatsApp bot');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.sendConnectionTest !== 'function') {
        const error = new Error(t('WhatsApp机器人尚未连接'));
        error.code = 'test-target-unavailable';
        throw error;
      }
      return runtime.sendConnectionTest(
        connectionTestMessage(
          `${config.name}（${maskWhatsappAccount(config.accountJid)}）`,
          t('WhatsApp机器人'),
        ),
      );
    });
  }

  async sendProactiveText(botId, target, text, options = {}) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown WhatsApp bot');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.sendProactiveText !== 'function') {
        const error = new Error(t('WhatsApp机器人尚未连接'));
        error.code = 'bot-not-connected';
        throw error;
      }
      return runtime.sendProactiveText(target, text, options);
    });
  }

  async presentSessionSyncApproval(botId, target, interaction, options = {}) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown WhatsApp bot');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.presentSessionSyncApproval !== 'function') {
        const error = new Error(t('WhatsApp机器人尚未连接'));
        error.code = 'bot-not-connected';
        throw error;
      }
      return runtime.presentSessionSyncApproval(target, interaction, options);
    });
  }

  async setAccessPolicy(botId, value) {
    if (this.#closed) throw new Error('WhatsApp controller is closed');
    const accessPolicy = normalizeWhatsappAccessPolicy(value);
    await this.#withBotTransition(botId, async () => {
      if (this.#closed) throw new Error('WhatsApp controller is closed');
      const config = this.#configStore.get(botId);
      if (!config) throw new Error('Unknown WhatsApp bot');
      const saved = await atConnectionStage('account.save', () => this.#configStore.save({ ...config, ...accessPolicy }), 'account-config');
      this.#runtimes.get(botId)?.setAccessPolicy?.(saved);
      this.#touch();
    });
    return this.status();
  }

  async deleteBot(botId) {
    const warnings = [];
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown WhatsApp bot');
    await this.#withBotTransition(botId, async () => {
      await this.#stopRuntime(botId);
      try {
        await atConnectionStage('account.remove', () => this.#configStore.remove(botId), 'account-config');
      } catch (error) {
        if (!this.#configStore.get(botId)) {
          warnings.push(this.#diagnostics.report(error, { operation: 'bot.delete', stage: 'workspace.cleanup', warning: true,
            publicError: { code: 'workspace-cleanup-failed', message: '账号已移除，但本地状态清理失败。' } }).publicError);
        } else {
          await this.#startRuntime(config).catch(() => undefined);
          throw error;
        }
      }
      const cleanup = await Promise.allSettled([
        this.#deleteAuth(config.authDirectory),
        this.#deleteState({ botId, config }),
      ]);
      for (const result of cleanup) if (result.status === 'rejected') warnings.push(this.#diagnostics.report(result.reason, { operation: 'bot.delete', stage: 'state.cleanup', warning: true, publicError: { code: 'cleanup-failed', message: '账号已移除，但本地状态清理失败。' } }).publicError);
      this.#errors.delete(botId);
      this.#touch();
    });
    return { ...this.status(), ...(warnings.length ? { warnings } : {}) };
  }

  status() {
    const bots = this.#configStore.list().map((config) => {
      const runtimeStatus = this.#runtimes.get(config.botId)?.status ?? null;
      const connected = runtimeStatus?.ready === true
        && runtimeStatus.connectionState === 'connected'
        && runtimeStatus.harnessReachable === true;
      const state = connected ? 'connected'
        : runtimeStatus?.connectionState === 'connecting' ? 'connecting'
          : this.#errors.has(config.botId) || runtimeStatus?.connectionState === 'failed'
            ? 'error' : 'offline';
      return {
        botId: config.botId,
        state,
        connected,
        configured: true,
        bot: { name: config.name, idMasked: maskWhatsappAccount(config.accountJid) },
        health: {
          status: connected ? 'healthy' : state === 'error' ? 'error' : 'offline',
          summary: connected ? t('WhatsApp Web 关联设备运行正常')
            : state === 'error' ? t('WhatsApp 连接未就绪') : t('WhatsApp 连接当前离线'),
          lastCheckedAt: runtimeStatus?.lastCheckedAt ?? null,
          lastConnectedAt: runtimeStatus?.lastConnectedAt ?? null,
        },
        stats: {
          messagesReceived: runtimeStatus?.messagesReceived ?? 0,
          messagesReplied: runtimeStatus?.messagesReplied ?? 0,
        },
        lastMessageError: publicMessageFailure(runtimeStatus?.lastMessageError),
        accessPolicy: normalizeWhatsappAccessPolicy(config),
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

  async #completeProvisioning(record, identity) {
    if (record.controller.signal.aborted || this.#closed) return;
    record.state = 'connecting';
    record.qrValue = null;
    record.expiresAt = null;
    this.#touch();
    const botId = deriveWhatsappBotId(identity.accountJid);
    record.botId = botId;
    await record.session?.close();
    const previous = this.#configStore.get(botId);
    const config = {
      botId,
      accountJid: identity.accountJid,
      authDirectory: record.authDirectory,
      name: identity.name,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      connectedAt: new Date().toISOString(),
      accessMode: previous?.accessMode,
      allowedNumbers: previous?.allowedNumbers,
    };
    try {
      if (record.controller.signal.aborted || this.#closed) throw Object.assign(new Error(), { name: 'AbortError' });
      await atConnectionStage('account.save', () => this.#configStore.save(config), 'account-config');
      if (record.controller.signal.aborted || this.#closed) throw Object.assign(new Error(), { name: 'AbortError' });
      try {
        await this.#startRuntime(config);
        this.#errors.delete(botId);
      } catch (error) {
        this.#errors.set(botId, this.#failure(error, 'connection-failed', t('WhatsApp 已绑定，消息连接暂未就绪。')));
        this.#logger.warn?.(`[dsh-im:whatsapp] bot ${botId} did not reconnect after QR binding`);
      }
      if (previous?.authDirectory && previous.authDirectory !== config.authDirectory) {
        await this.#deleteAuth(previous.authDirectory).catch(() => undefined);
      }
      record.state = 'connected';
      record.error = null;
    } catch (error) {
      if (record.controller.signal.aborted || this.#closed || error?.name === 'AbortError') {
        await this.#stopRuntime(botId);
        if (previous) await atConnectionStage('account.save', () => this.#configStore.save(previous), 'account-config').catch(() => undefined);
        else {
          const removed = await atConnectionStage('account.remove', () => this.#configStore.remove(botId), 'account-config').catch(() => null);
          if (removed) {
            await this.#deleteState({ botId, config }).catch((cleanupError) => {
              this.#logger.warn?.('[dsh-im:whatsapp] cancelled bot state cleanup failed:', extractConnectionEvidence(cleanupError).details);
            });
          }
        }
        await this.#deleteAuth(record.authDirectory).catch(() => undefined);
        if (previous) await this.#startRuntime(previous).catch(() => undefined);
        record.state = 'cancelled';
        record.error = safeError('cancelled', t('扫码接入已取消。'));
      } else {
        await this.#deleteAuth(record.authDirectory).catch(() => undefined);
        record.state = 'failed';
        record.error = this.#failure(error, 'activation-failed', t('WhatsApp 已扫码，但无法保存关联设备。'));
        this.#logger.error?.('[dsh-im:whatsapp] unable to persist linked-device session');
      }
    } finally {
      if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
      this.#touch();
    }
  }

  async #failProvisioning(record, error, rejectFirstQr = () => {}) {
    if (TERMINAL_ATTEMPT_STATES.has(record.state)) return;
    if (record.controller.signal.aborted || error?.name === 'AbortError') {
      record.state = 'cancelled';
      record.error = safeError('cancelled', t('扫码接入已取消。'));
    } else {
      record.state = 'failed';
      record.error = safeError('qr-connect-failed', t('无法连接 WhatsApp，请重新生成二维码。'));
    }
    if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
    await record.session?.close().catch(() => undefined);
    await this.#deleteAuth(record.authDirectory).catch(() => undefined);
    this.#touch();
    rejectFirstQr(error);
  }

  async #startRuntime(config) {
    if (this.#closed) throw new Error('WhatsApp controller is closed');
    await this.#stopRuntime(config.botId);
    if (this.#closed) throw new Error('WhatsApp controller is closed');
    const runtime = await atConnectionStage('runtime.prepare', () => this.#createRuntime({
      botId: config.botId,
      config,
      authDir: this.#authPath(config.authDirectory),
    }));
    if (!runtime || typeof runtime.start !== 'function' || typeof runtime.stop !== 'function') {
      throw new TypeError('createRuntime returned an invalid WhatsApp runtime');
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
    await runtime?.stop().catch(() => undefined);
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

  #touch() {
    this.#revision += 1;
  }
}
