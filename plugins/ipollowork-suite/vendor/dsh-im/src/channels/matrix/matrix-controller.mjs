import { connectionTestMessage } from '../shared/connection-test.mjs';
import { publicMessageFailure } from '../shared/message-failure.mjs';
import { t } from '../shared/i18n.mjs';
import { deriveMatrixBotIdentity, maskMatrixBotId } from './matrix-config-store.mjs';
import { inspectMatrixCredentials, isMatrixUserId, validateMatrixHomeserver } from './matrix-api.mjs';
import { MATRIX_DESCRIPTOR } from './matrix-bridge.mjs';

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeError(code, message) {
  return Object.freeze({ code, message });
}

export class MatrixController {
  #credentials;
  #configStore;
  #inspectCredentials;
  #createRuntime;
  #deleteState;
  #logger;
  #runtimes = new Map();
  #errors = new Map();
  #transitions = new Map();
  #revision = 0;
  #closed = false;

  constructor({
    credentials,
    configStore,
    inspectCredentials = inspectMatrixCredentials,
    createRuntime,
    deleteState = async () => {},
    logger = console,
  }) {
    if (!credentials || typeof credentials.resolve !== 'function'
      || typeof credentials.set !== 'function' || typeof credentials.unset !== 'function') {
      throw new TypeError('Matrix requires the DSH credential provider');
    }
    if (!configStore || typeof configStore.list !== 'function'
      || typeof configStore.save !== 'function' || typeof configStore.remove !== 'function') {
      throw new TypeError('Matrix requires a config store');
    }
    if (typeof inspectCredentials !== 'function' || typeof createRuntime !== 'function') {
      throw new TypeError('Matrix controller dependencies are incomplete');
    }
    this.#credentials = credentials;
    this.#configStore = configStore;
    this.#inspectCredentials = inspectCredentials;
    this.#createRuntime = createRuntime;
    this.#deleteState = deleteState;
    this.#logger = logger;
  }

  async initialize() {
    if (this.#closed) return this.status();
    for (const config of this.#configStore.list()) {
      await this.#withBotTransition(config.botId, async () => {
        if (this.#closed || this.#runtimes.get(config.botId)?.status?.ready) return;
        const resolved = await this.#resolveCredentials(config);
        if (!resolved) {
          this.#errors.set(config.botId, safeError(
            'missing-token',
            t('Matrix机器人凭据缺失，请移除后重新接入。'),
          ));
          return;
        }
        try {
          await this.#startRuntime(config, resolved);
          this.#errors.delete(config.botId);
        } catch (error) {
          this.#errors.set(config.botId, safeError(
            'connection-failed',
            error?.message ?? t('Matrix 连接未就绪，插件会自动重试。'),
          ));
          this.#logger.warn?.(
            `[dsh-im:matrix] bot ${config.botId} failed to initialize:`,
            error,
          );
        } finally {
          this.#touch();
        }
      });
    }
    return this.status();
  }

  async bindCredentials({ homeserver, accessToken, userId, password } = {}) {
    if (this.#closed) throw new Error('Matrix controller is closed');
    const base = validateMatrixHomeserver(homeserver);
    const token = cleanString(accessToken);
    const identifier = cleanString(userId);
    const secret = cleanString(password);
    if (!base) {
      const error = new Error(t('Matrix homeserver 地址无效，请填写 https:// 或 http:// 开头的完整地址。'));
      error.code = 'invalid-config';
      throw error;
    }
    if (!token && !(identifier && secret)) {
      const error = new Error(t('Matrix 凭据不完整：请提供访问令牌，或用户 ID 与密码的组合。'));
      error.code = 'invalid-config';
      throw error;
    }
    if (identifier && !isMatrixUserId(identifier)) {
      const error = new Error(t('Matrix 用户 ID 无效，请使用 @user:server 形式。'));
      error.code = 'invalid-config';
      throw error;
    }
    const inspected = await this.#inspectCredentials({
      homeserver: base,
      ...(token ? { accessToken: token } : {}),
      ...(identifier ? { userId: identifier } : {}),
      ...(secret ? { password: secret } : {}),
    });
    const platformId = cleanString(inspected?.platformId);
    const resolvedUserId = cleanString(inspected?.userId);
    const name = cleanString(inspected?.name);
    if (!platformId || !resolvedUserId || !name) {
      throw new Error('Matrix homeserver returned an incomplete bot identity');
    }
    const derived = deriveMatrixBotIdentity({ homeserver: base, userId: resolvedUserId });
    const existing = this.#configStore.getByPlatformId(platformId);
    if (existing && existing.botId !== derived.botId) {
      throw new Error('This Matrix bot belongs to another Harness installation');
    }
    const previous = this.#configStore.get(derived.botId);
    const previousRefs = await Promise.all([
      this.#credentials.resolve(derived.tokenRef).catch(() => undefined),
      this.#credentials.resolve(derived.passwordRef).catch(() => undefined),
    ]);
    try {
      if (token) await this.#credentials.set(derived.tokenRef, token);
      else await this.#credentials.unset(derived.tokenRef);
      if (secret) await this.#credentials.set(derived.passwordRef, secret);
      else await this.#credentials.unset(derived.passwordRef);
      await this.#configStore.save({
        botId: derived.botId,
        platformId,
        homeserver: base,
        userId: resolvedUserId,
        ...(cleanString(inspected?.deviceId) ? { deviceId: cleanString(inspected.deviceId) } : {}),
        tokenRef: derived.tokenRef,
        passwordRef: derived.passwordRef,
        name,
        username: cleanString(inspected?.username),
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        connectedAt: previous?.connectedAt ?? null,
      });
    } catch (error) {
      await Promise.all([
        this.#restoreCredential(derived.tokenRef, previousRefs[0]),
        this.#restoreCredential(derived.passwordRef, previousRefs[1]),
      ]).catch(() => undefined);
      if (!previous) await this.#configStore.remove(derived.botId).catch(() => undefined);
      throw error;
    }
    await this.#withBotTransition(derived.botId, async () => {
      await this.#stopRuntime(derived.botId);
      const config = this.#configStore.get(derived.botId);
      if (!config) return;
      const resolved = await this.#resolveCredentials(config);
      if (!resolved) return;
      await this.#startRuntime(config, resolved);
      this.#errors.delete(derived.botId);
    });
    this.#touch();
    return this.#publicBot(this.#configStore.get(derived.botId));
  }

  async reconnectBot(botId, { sendTest = false } = {}) {
    this.#requireId(botId);
    if (this.#closed) return this.status();
    return await this.#withBotTransition(botId, async () => {
      await this.#stopRuntime(botId);
      const config = this.#configStore.get(botId);
      if (!config) return this.status();
      const resolved = await this.#resolveCredentials(config);
      if (!resolved) {
        this.#errors.set(botId, safeError(
          'missing-token',
          t('Matrix机器人凭据缺失，请重新输入凭据。'),
        ));
        this.#touch();
        return this.status();
      }
      try {
        await this.#startRuntime(config, resolved);
        this.#errors.delete(botId);
        const saved = this.#configStore.get(botId);
        if (saved) {
          await this.#configStore.save({ ...saved, connectedAt: new Date().toISOString() });
        }
        if (sendTest) await this.sendConnectionTest(botId);
      } catch (error) {
        this.#errors.set(botId, safeError('connection-failed', error?.message ?? String(error)));
      } finally {
        this.#touch();
      }
      return this.status();
    });
  }

  async sendConnectionTest(botId) {
    this.#requireId(botId);
    const runtime = this.#runtimes.get(botId);
    if (!runtime?.status?.ready) throw new Error('Matrix bot is not connected');
    const config = this.#configStore.get(botId);
    const masked = maskMatrixBotId(config?.platformId ?? botId);
    const name = cleanString(runtime.status?.name) ?? cleanString(config?.name) ?? masked;
    if (typeof runtime.sendConnectionTest !== 'function') {
      throw new Error('Matrix connection test is unavailable');
    }
    return await runtime.sendConnectionTest(connectionTestMessage(`${name}（${masked}）`, t('Matrix机器人')));
  }

  async sendProactiveText(botId, target, text, options = {}) {
    this.#requireId(botId);
    const runtime = this.#runtimes.get(botId);
    if (!runtime?.status?.ready || typeof runtime.sendProactiveText !== 'function') {
      throw new Error('Matrix bot is not connected for proactive delivery');
    }
    await runtime.sendProactiveText(target, String(text ?? ''), options);
    return { sent: true };
  }

  async presentSessionSyncApproval(botId, target, interaction, options = {}) {
    this.#requireId(botId);
    const runtime = this.#runtimes.get(botId);
    if (!runtime?.status?.ready || typeof runtime.presentSessionSyncApproval !== 'function') {
      throw new Error('Matrix bot is not connected for proactive delivery');
    }
    return runtime.presentSessionSyncApproval(target, interaction, options);
  }

  async deleteBot(botId) {
    this.#requireId(botId);
    const removed = await this.#withBotTransition(botId, async () => {
      const config = this.#configStore.get(botId);
      await this.#stopRuntime(botId);
      await this.#deleteState({ botId, config: config ?? {} }).catch(() => undefined);
      await Promise.all([
        this.#credentials.unset(`DSH_MATRIX_TOKEN_${botId.slice(7).toUpperCase()}`),
        this.#credentials.unset(`DSH_MATRIX_PASSWORD_${botId.slice(7).toUpperCase()}`),
      ]).catch(() => undefined);
      return this.#configStore.remove(botId);
    });
    this.#errors.delete(botId);
    this.#touch();
    return removed;
  }

  status() {
    const bots = this.#configStore.list().map((config) => {
      const runtime = this.#runtimes.get(config.botId);
      const state = runtime?.status ?? null;
      // The shared token-channel settings view (createTokenChannelApi) renders
      // online/offline, the summary line and "最近检查" from these fields. Emit
      // them here so a connected bot is reported as connected instead of falling
      // back to the offline defaults, matching the other token channels.
      const hasError = Boolean(this.#errors.get(config.botId));
      const connected = state?.ready === true
        && state?.connectionState === 'connected'
        && state?.harnessReachable !== false;
      const botState = connected ? 'connected'
        : state?.connectionState === 'connecting' ? 'connecting'
          : hasError || state?.connectionState === 'failed' ? 'error' : 'offline';
      return {
        botId: config.botId,
        name: maskMatrixBotId(config.platformId),
        bot: {
          name: cleanString(config.name) ?? maskMatrixBotId(config.platformId),
          username: cleanString(config.username) ?? undefined,
          idMasked: maskMatrixBotId(config.platformId),
        },
        idMasked: maskMatrixBotId(config.platformId),
        ready: Boolean(state?.ready),
        connectionState: state?.connectionState ?? (hasError ? 'failed' : 'idle'),
        harnessReachable: state ? state.harnessReachable !== false : false,
        connected,
        state: botState,
        configured: true,
        health: {
          status: connected ? 'healthy' : botState === 'error' ? 'error' : 'offline',
          summary: connected
            ? t('Matrix 长轮询接收和 Harness 回复全部正常。')
            : hasError || botState === 'error'
              ? t('Matrix 连接未就绪，插件会自动重试。')
              : t('Matrix 连接当前离线。'),
          lastCheckedAt: state?.lastCheckedAt ?? state?.lastConnectedAt ?? null,
          lastConnectedAt: state?.lastConnectedAt ?? null,
        },
        stats: {
          messagesReceived: state?.messagesReceived ?? 0,
          messagesReplied: state?.messagesReplied ?? 0,
        },
        lastConnectedAt: state?.lastConnectedAt ?? null,
        lastError: this.#errors.get(config.botId) ?? state?.lastError ?? null,
        lastMessageAt: state?.lastMessageAt ?? null,
        lastMessageError: publicMessageFailure(state?.lastMessageError) ?? null,
      };
    });
    const ready = bots.filter((bot) => bot.ready).length;
    return {
      revision: this.#revision,
      ready: this.#runtimes.size > 0 && ready === this.#runtimes.size,
      totals: {
        bots: bots.length,
        ready,
        failed: bots.filter((bot) => bot.connectionState === 'failed').length,
      },
      summary: {
        healthy: this.#runtimes.size > 0 && ready === this.#runtimes.size
          ? t('Matrix 长轮询接收和 Harness 回复全部正常。')
          : ready === 0 && bots.length > 0
            ? t('Matrix 长轮询尚未建立，请检查 homeserver 与凭据。')
            : t('Matrix 正在处理消息；当前存在未恢复的连接。'),
        attention: bots.flatMap((bot) => bot.lastMessageError
          ? [`${bot.name}：${bot.lastMessageError.message}`] : []),
      },
      bots,
    };
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.all([...this.#runtimes.keys()].map((botId) => this.#stopRuntime(botId)));
    this.#runtimes.clear();
    this.#transitions.clear();
    this.#touch();
  }

  async #startRuntime(config, resolved) {
    await this.#stopRuntime(config.botId);
    const runtime = await this.#createRuntime({
      botId: config.botId,
      config,
      homeserver: config.homeserver,
      userId: config.userId,
      ...resolved,
    });
    this.#runtimes.set(config.botId, runtime);
    try {
      await runtime.start();
    } catch (error) {
      await this.#stopRuntime(config.botId);
      throw error;
    }
    if (!runtime.status?.ready) {
      await this.#stopRuntime(config.botId);
      throw new Error('Matrix connection is not ready');
    }
    return runtime;
  }

  async #stopRuntime(botId) {
    const previous = this.#runtimes.get(botId);
    this.#runtimes.delete(botId);
    try {
      await previous?.stop?.();
    } catch (error) {
      this.#logger.warn?.(`[dsh-im:matrix] bot ${botId} stopped with an error:`, error);
    }
  }

  async #resolveCredentials(config) {
    const token = cleanString((await this.#credentials.resolve(config.tokenRef).catch(() => undefined))?.value);
    if (token) return { accessToken: token };
    const password = cleanString((await this.#credentials.resolve(config.passwordRef).catch(() => undefined))?.value);
    if (password && config.userId) return { password, userId: config.userId };
    return null;
  }

  async #restoreCredential(ref, previous) {
    if (previous?.value) await this.#credentials.set(ref, previous.value).catch(() => undefined);
    else await this.#credentials.unset(ref).catch(() => undefined);
  }

  #requireId(botId) {
    if (typeof botId !== 'string' || !/^matrix_[a-f0-9]{24}$/.test(botId)) {
      throw new TypeError('Invalid Matrix bot id');
    }
  }

  #publicBot(config) {
    if (!config) throw new Error('Matrix bot is no longer configured');
    return {
      botId: config.botId,
      name: maskMatrixBotId(config.platformId),
      bot: {
        name: cleanString(config.name) ?? maskMatrixBotId(config.platformId),
        username: cleanString(config.username) ?? undefined,
        idMasked: maskMatrixBotId(config.platformId),
      },
      idMasked: maskMatrixBotId(config.platformId),
    };
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
