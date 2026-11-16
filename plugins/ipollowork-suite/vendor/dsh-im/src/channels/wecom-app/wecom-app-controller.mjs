import { extractConnectionEvidence, atConnectionStage, createConnectionDiagnostics } from '../shared/connection-error.mjs';
import {
  deriveWecomAppIdentity,
  generateCallbackSecret,
  maskCorpId,
  validAgentId,
  validApiBaseUrl,
  validCorpId,
} from './config-store.mjs';
import {
  connectionTestMessage,
  connectionTestTargetUnavailable,
} from '../shared/connection-test.mjs';
import { t } from '../shared/i18n.mjs';
import { publicMessageFailure } from '../shared/message-failure.mjs';

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeError(code, message) {
  return Object.freeze({ code, message });
}

function validSecret(value) {
  const secret = cleanString(value);
  return Boolean(secret && /^[A-Za-z0-9_-]{16,128}$/.test(secret));
}

function validCallbackToken(value) {
  const token = cleanString(value);
  return Boolean(token && /^[A-Za-z0-9_-]{3,64}$/.test(token));
}

function validEncodingAesKey(value) {
  const key = cleanString(value);
  return Boolean(key && /^[A-Za-z0-9]{43}$/.test(key));
}

export class WecomAppController {
  #credentials;
  #configStore;
  #createRuntime;
  #deleteState;
  #logger;
  #diagnostics;
  #buildCallbackUrl;
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
    buildCallbackUrl = null,
  }) {
    if (!credentials || typeof credentials.resolve !== 'function'
      || typeof credentials.set !== 'function' || typeof credentials.unset !== 'function') {
      throw new TypeError('WecomAppController requires the DSH credential provider');
    }
    if (!configStore || typeof configStore.list !== 'function'
      || typeof configStore.save !== 'function' || typeof configStore.remove !== 'function') {
      throw new TypeError('WecomAppController requires a config store');
    }
    if (typeof createRuntime !== 'function') throw new TypeError('createRuntime is required');
    this.#credentials = credentials;
    this.#configStore = configStore;
    this.#createRuntime = createRuntime;
    this.#deleteState = deleteState;
    this.#logger = logger;
    this.#diagnostics = createConnectionDiagnostics({ channel: 'wecom-app', logger });
    this.#buildCallbackUrl = typeof buildCallbackUrl === 'function' ? buildCallbackUrl : null;
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
        if (this.#runtimes.has(config.botId)) return;
        try {
          const secrets = await this.#resolveSecrets(config);
          if (!secrets) {
            this.#errors.set(config.botId, safeError('missing-credentials', t('企业微信应用凭据缺失，请重新绑定。')));
            return;
          }
          await this.#startRuntime(config, secrets);
          this.#errors.delete(config.botId);
        } catch (error) {
          this.#errors.set(config.botId, this.#failure(error, 'connection-failed', t('企业微信应用连接未就绪，插件会自动重试。')));

        } finally {
          this.#touch();
        }
      });
    }
    return this.status();
  }

  async bindApp({
    corpId,
    agentId,
    secret,
    token,
    encodingAESKey,
    apiBaseUrl,
    callbackBaseUrl,
    streamEnabled,
  } = {}) {
    if (this.#closed) throw new Error('Enterprise WeChat app controller is closed');
    const normalizedCorpId = cleanString(corpId);
    const normalizedAgentId = cleanString(agentId);
    const normalizedSecret = cleanString(secret);
    const normalizedToken = cleanString(token);
    const normalizedAesKey = cleanString(encodingAESKey);
    if (!validCorpId(normalizedCorpId)) throw new TypeError(t('请输入正确的企业 ID（例如 ww1234567890abcdef）。'));
    if (!validAgentId(normalizedAgentId)) throw new TypeError(t('请输入正确的应用 AgentId（纯数字）。'));
    if (!validSecret(normalizedSecret)) throw new TypeError(t('应用 Secret 格式不正确。'));
    if (!validCallbackToken(normalizedToken)) throw new TypeError(t('回调 Token 格式不正确。'));
    if (!validEncodingAesKey(normalizedAesKey)) throw new TypeError(t('EncodingAESKey 必须是 43 位字母或数字。'));
    if (!validApiBaseUrl(apiBaseUrl ?? undefined)) throw new TypeError(t('代理地址必须是 http(s) 地址。'));
    if (!validApiBaseUrl(callbackBaseUrl ?? undefined)) throw new TypeError(t('回调基址必须是 http(s) 地址。'));
    const identity = deriveWecomAppIdentity({ corpId: normalizedCorpId, agentId: normalizedAgentId });
    await this.#withBotTransition(identity.botId, async () => {
      if (this.#closed) throw new Error('Enterprise WeChat app controller is closed');
      const previousConfig = this.#configStore.getByCorpAgent(normalizedCorpId, normalizedAgentId);
      const botId = identity.botId;
      const config = {
        botId,
        corpId: normalizedCorpId,
        agentId: normalizedAgentId,
        secretRef: identity.secretRef,
        callbackTokenRef: identity.callbackTokenRef,
        callbackKeyRef: identity.callbackKeyRef,
        callbackSecret: previousConfig?.callbackSecret ?? generateCallbackSecret(),
        apiBaseUrl: cleanString(apiBaseUrl) ?? undefined,
        callbackBaseUrl: cleanString(callbackBaseUrl) ?? undefined,
        streamEnabled: streamEnabled !== false,
        createdAt: previousConfig?.createdAt ?? new Date().toISOString(),
        connectedAt: new Date().toISOString(),
      };
      const previous = await this.#resolveSecrets(config);
      await this.#setSecrets(identity, {
        corpSecret: normalizedSecret,
        token: normalizedToken,
        encodingAESKey: normalizedAesKey,
      });
      try {
        await atConnectionStage('account.save', () => this.#configStore.save(config), 'account-config');
      } catch (error) {
        await this.#restoreSecrets(identity, previous);
        throw error;
      }
      try {
        await this.#startRuntime(config, {
          corpSecret: normalizedSecret,
          token: normalizedToken,
          encodingAESKey: normalizedAesKey,
        });
        this.#errors.delete(botId);
      } catch (error) {
        this.#errors.set(botId, this.#failure(error, 'connection-failed', t('企业微信应用已绑定，但尚未就绪。')));

      }
      this.#touch();
    });
    return this.status();
  }

  async updateAppSettings(botId, { apiBaseUrl, callbackBaseUrl, streamEnabled } = {}) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Enterprise WeChat app bot');
    await this.#withBotTransition(botId, async () => {
      const previous = await this.#resolveSecrets(config);
      const patch = {};
      if (apiBaseUrl !== undefined) {
        if (!validApiBaseUrl(apiBaseUrl)) throw new TypeError(t('代理地址必须是 http(s) 地址。'));
        patch.apiBaseUrl = cleanString(apiBaseUrl) ?? null;
      }
      if (callbackBaseUrl !== undefined) {
        if (!validApiBaseUrl(callbackBaseUrl)) throw new TypeError(t('回调基址必须是 http(s) 地址。'));
        patch.callbackBaseUrl = cleanString(callbackBaseUrl) ?? null;
      }
      if (streamEnabled !== undefined) patch.streamEnabled = streamEnabled === true;
      if (Object.keys(patch).length === 0) return;
      try {
        await this.#configStore.update(botId, patch);
      } catch (error) {
        await this.#restoreSecrets(config, previous);
        throw error;
      }
      const updated = this.#configStore.get(botId);
      const runtime = this.#runtimes.get(botId);
      if (streamEnabled !== undefined && runtime && typeof runtime.setStreamEnabled === 'function') {
        runtime.setStreamEnabled(patch.streamEnabled);
      }
      if (apiBaseUrl !== undefined) {
        // The API client bakes in the base URL; restart to pick up the change.
        const secrets = await this.#resolveSecrets(updated);
        if (secrets) {
          try {
            await this.#startRuntime(updated, secrets);
          } catch (error) {
            this.#errors.set(botId, this.#failure(error, 'connection-failed', t('企业微信应用已更新，但尚未就绪。')));

          }
        }
      }
      this.#errors.delete(botId);
      this.#touch();
    });
    return this.status();
  }

  async resetCallbackSecret(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Enterprise WeChat app bot');
    await this.#withBotTransition(botId, async () => {
      await this.#configStore.update(botId, { callbackSecret: generateCallbackSecret() });
      const updated = this.#configStore.get(botId);
      const secrets = await this.#resolveSecrets(updated);
      if (secrets && this.#runtimes.has(botId)) {
        try {
          await this.#startRuntime(updated, secrets);
        } catch (error) {
          this.#errors.set(botId, this.#failure(error, 'connection-failed', t('回调密钥已重置，但机器人重启失败，请手动重连。')));
        }
      }
      this.#touch();
    });
    return this.status();
  }

  async reconnectBot(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Enterprise WeChat app bot');
    await this.#withBotTransition(botId, async () => {
      const secrets = await this.#resolveSecrets(config);
      if (!secrets) throw new Error('Enterprise WeChat app bot credentials are missing');
      try {
        await this.#startRuntime(config, secrets);
        this.#errors.delete(botId);
      } catch (error) {
        this.#errors.set(botId, this.#failure(error, 'connection-failed', t('企业微信应用仍未就绪，请稍后重试。')));
        throw error;
      } finally {
        this.#touch();
      }
    });
    return this.status();
  }

  async sendConnectionTest(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Enterprise WeChat app bot');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.sendConnectionTest !== 'function') {
        throw connectionTestTargetUnavailable(t('企业微信应用'));
      }
      return runtime.sendConnectionTest(connectionTestMessage(
        t('企业微信应用（{corpId}）', { corpId: maskCorpId(config.corpId) }),
        t('企业微信应用'),
      ));
    });
  }

  async sendProactiveText(botId, target, text, options = {}) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Enterprise WeChat app bot');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.sendProactiveText !== 'function') {
        const error = new Error(t('企业微信应用当前离线'));
        error.code = 'bot-not-connected';
        throw error;
      }
      return runtime.sendProactiveText(target, text, options);
    });
  }

  async presentSessionSyncApproval(botId, target, interaction, options = {}) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Enterprise WeChat app bot');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.presentSessionSyncApproval !== 'function') {
        const error = new Error(t('企业微信应用当前离线'));
        error.code = 'bot-not-connected';
        throw error;
      }
      return runtime.presentSessionSyncApproval(target, interaction, options);
    });
  }

  async deleteBot(botId) {
    const warnings = [];
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown Enterprise WeChat app bot');
    await this.#withBotTransition(botId, async () => {
      const previous = await this.#resolveSecrets(config);
      await this.#stopRuntime(botId);
      try {
        await atConnectionStage('credential.remove', () => this.#credentials.unset(config.secretRef), 'credential-store');
        await atConnectionStage('credential.remove', () => this.#credentials.unset(config.callbackTokenRef), 'credential-store');
        await atConnectionStage('credential.remove', () => this.#credentials.unset(config.callbackKeyRef), 'credential-store');
        await atConnectionStage('account.remove', () => this.#configStore.remove(botId), 'account-config');
      } catch (error) {
        if (!this.#configStore.get(botId)) {
          warnings.push(this.#diagnostics.report(error, { operation: 'bot.delete', stage: 'workspace.cleanup', warning: true,
            publicError: { code: 'workspace-cleanup-failed', message: '账号已移除，但本地状态清理失败。' } }).publicError);
        } else {
          if (previous) {
            await this.#setSecrets(config, previous).catch(() => undefined);
            await this.#startRuntime(config, previous).catch(() => undefined);
          }
          throw new Error('Unable to remove the Enterprise WeChat app bot safely.', { cause: error });
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
        && runtimeStatus.wecomAppConnectionState === 'connected'
        && runtimeStatus.harnessReachable === true;
      const state = connected ? 'connected'
        : runtimeStatus?.wecomAppConnectionState === 'connecting' ? 'connecting'
          : this.#errors.has(config.botId) || runtimeStatus?.wecomAppConnectionState === 'failed'
            ? 'error' : 'offline';
      const callbackUrl = typeof this.#buildCallbackUrl === 'function'
        ? this.#buildCallbackUrl(config) ?? null
        : null;
      return {
        botId: config.botId,
        state,
        connected,
        configured: true,
        bot: {
          name: t('企业微信应用'),
          corpIdMasked: maskCorpId(config.corpId),
          agentId: config.agentId,
          apiBaseUrl: config.apiBaseUrl ?? null,
          callbackBaseUrl: config.callbackBaseUrl ?? null,
          streamEnabled: config.streamEnabled !== false,
          callbackUrl,
        },
        health: {
          status: connected ? 'healthy' : state === 'error' ? 'error' : 'offline',
          summary: connected ? t('企业微信应用回调通道就绪')
            : state === 'error' ? t('企业微信应用连接未就绪，插件会自动重试') : t('企业微信应用当前离线'),
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
    return {
      schemaVersion: 1,
      revision: this.#revision,
      state: bots.length === 0 ? 'disconnected'
        : connectedCount === bots.length ? 'connected'
          : connectedCount > 0 ? 'degraded' : 'offline',
      bots,
      totals: { configured: bots.length, connected: connectedCount },
    };
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.allSettled([...this.#transitions.values()]);
    await Promise.allSettled([...this.#runtimes.keys()].map((botId) => this.#stopRuntime(botId)));
  }

  async #startRuntime(config, secrets) {
    if (this.#closed) throw new Error('Enterprise WeChat app controller is closed');
    await this.#stopRuntime(config.botId);
    if (this.#closed) throw new Error('Enterprise WeChat app controller is closed');
    const runtime = await atConnectionStage('runtime.prepare', () => this.#createRuntime({ botId: config.botId, config, secrets }));
    if (!runtime || typeof runtime.start !== 'function' || typeof runtime.stop !== 'function') {
      throw new TypeError('createRuntime returned an invalid Enterprise WeChat app runtime');
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
      this.#logger.warn?.(`[dsh-im:wecom-app] bot ${botId} failed to stop cleanly:`, extractConnectionEvidence(error).details);
    });
  }

  async #resolveSecrets(config) {
    const corpSecret = await this.#resolveSecret(config.secretRef);
    const token = await this.#resolveSecret(config.callbackTokenRef);
    const encodingAESKey = await this.#resolveSecret(config.callbackKeyRef);
    if (!corpSecret || !token || !encodingAESKey) return null;
    return { corpSecret, token, encodingAESKey };
  }

  async #setSecrets(identity, { corpSecret, token, encodingAESKey }) {
    await atConnectionStage('credential.save', () => this.#credentials.set(identity.secretRef, corpSecret), 'credential-store');
    await atConnectionStage('credential.save', () => this.#credentials.set(identity.callbackTokenRef, token), 'credential-store');
    await atConnectionStage('credential.save', () => this.#credentials.set(identity.callbackKeyRef, encodingAESKey), 'credential-store');
  }

  async #resolveSecret(ref) {
    const result = await atConnectionStage('credential.read', () => this.#credentials.resolve(ref), 'credential-store');
    return cleanString(result?.value);
  }

  async #restoreSecrets(identity, previous) {
    if (previous) {
      await this.#setSecrets(identity, previous).catch(() => undefined);
      return;
    }
    await atConnectionStage('credential.remove', () => this.#credentials.unset(identity.secretRef), 'credential-store').catch(() => undefined);
    await atConnectionStage('credential.remove', () => this.#credentials.unset(identity.callbackTokenRef), 'credential-store').catch(() => undefined);
    await atConnectionStage('credential.remove', () => this.#credentials.unset(identity.callbackKeyRef), 'credential-store').catch(() => undefined);
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
