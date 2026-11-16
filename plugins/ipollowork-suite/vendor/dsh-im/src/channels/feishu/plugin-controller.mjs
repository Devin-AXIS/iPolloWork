import { RegistrationManager } from './registration-manager.mjs';
import { SLASH_COMMAND_TENANT_SCOPES } from './slash-command-registry.mjs';

export const FEISHU_SECRET_REF = 'DSH_FEISHU_APP_SECRET';

export const REQUIRED_TENANT_SCOPES = Object.freeze([
  'im:message.p2p_msg:readonly',
  'im:message.group_at_msg:readonly',
  'im:message.group_at_msg.include_bot:readonly',
  'im:message.group_msg',
  'im:message:readonly',
  'im:message:send_as_bot',
  'im:message.reactions:write_only',
  'im:message:recall',
  'im:resource',
  'cardkit:card:write',
  ...SLASH_COMMAND_TENANT_SCOPES,
]);

function safeConnectionStatus(runtime) {
  if (!runtime) return {
    ready: false,
    feishuLongConnectionState: 'idle',
    harnessReachable: false,
  };
  return runtime.status;
}

function publicBot(config) {
  if (!config) return null;
  const appIdMasked = config.appId.length > 12
    ? `${config.appId.slice(0, 8)}••••${config.appId.slice(-4)}`
    : 'cli_••••';
  return {
    name: config.botName,
    appIdMasked,
    openId: config.botOpenId,
    activated: config.activated,
    domain: config.domain,
  };
}

/** Coordinates QR provisioning, durable credentials and the live chat runtime. */
export class DshFeishuController {
  #registerApp;
  #verifyApp;
  #credentials;
  #configStore;
  #createRuntime;
  #registration;
  #runtime = null;
  #lastError = null;
  #transition = Promise.resolve();

  constructor({ registerApp, verifyApp, credentials, configStore, createRuntime }) {
    if (typeof registerApp !== 'function') throw new Error('registerApp is required');
    if (typeof verifyApp !== 'function') throw new Error('verifyApp is required');
    if (!credentials) throw new Error('credentials service is required');
    if (!configStore) throw new Error('config store is required');
    if (typeof createRuntime !== 'function') throw new Error('createRuntime is required');

    this.#registerApp = registerApp;
    this.#verifyApp = verifyApp;
    this.#credentials = credentials;
    this.#configStore = configStore;
    this.#createRuntime = createRuntime;
    this.#registration = new RegistrationManager({
      registerApp: this.#registerApp,
      onCredentials: (result) => this.#serialize(() => this.#acceptCredentials(result)),
    });
  }

  async initialize() {
    const config = this.#configStore.get();
    if (!config) return this.status();
    return this.#serialize(async () => {
      const resolved = await this.#credentials.resolve(FEISHU_SECRET_REF);
      if (!resolved?.value) {
        this.#lastError = {
          code: 'missing_credentials',
          message: '机器人凭据缺失，请重新扫码接入。',
        };
        return this.status();
      }
      try {
        await this.#startRuntime(config, resolved.value);
        this.#lastError = null;
      } catch {
        this.#lastError = {
          code: 'connection_failed',
          message: '机器人暂时无法连接飞书，请重试。',
        };
      }
      return this.status();
    });
  }

  startRegistration() {
    this.#lastError = null;
    this.#registration.start({
      source: 'deepseek-harness',
      createOnly: true,
      appPreset: {
        name: '{user} 的北汇星河 AI 助手',
        desc: '连接飞书与 DeepSeek Harness，在聊天中使用企业 AI 助手。',
      },
      addons: {
        preset: false,
        scopes: { tenant: [...REQUIRED_TENANT_SCOPES] },
        events: { items: { tenant: ['im.message.receive_v1'] } },
        callbacks: { items: ['card.action.trigger'] },
      },
    });
    return this.status();
  }

  cancelRegistration() {
    this.#registration.cancel();
    return this.status();
  }

  async reconnect() {
    return this.#serialize(async () => {
      const config = this.#configStore.get();
      const resolved = await this.#credentials.resolve(FEISHU_SECRET_REF);
      if (!config || !resolved?.value) {
        this.#lastError = {
          code: 'missing_credentials',
          message: '没有可用的机器人凭据，请重新扫码接入。',
        };
        return this.status();
      }
      try {
        await this.#startRuntime(config, resolved.value);
        this.#lastError = null;
      } catch {
        this.#lastError = {
          code: 'connection_failed',
          message: '机器人暂时无法连接飞书，请重试。',
        };
      }
      return this.status();
    });
  }

  async disconnect() {
    this.#registration.cancel();
    return this.#serialize(async () => {
      await this.#stopRuntime();
      await this.#configStore.clear();
      try {
        await this.#credentials.unset(FEISHU_SECRET_REF);
      } catch {
        // A read-only environment value may shadow the managed store. Clearing
        // the non-secret config still prevents automatic reuse of that value.
      }
      this.#lastError = null;
      return this.status();
    });
  }

  async close() {
    this.#registration.cancel();
    await this.#serialize(() => this.#stopRuntime());
  }

  status() {
    const config = this.#configStore.get();
    const registration = this.#registration.status();
    const connection = safeConnectionStatus(this.#runtime);
    const connected = connection.ready === true
      && connection.feishuLongConnectionState === 'connected'
      && connection.harnessReachable === true;

    let phase = 'unconfigured';
    if (connected) phase = 'connected';
    else if (['starting', 'qr_ready', 'polling', 'slow_down', 'domain_switched'].includes(registration.state)) {
      phase = 'registering';
    } else if (registration.state === 'saving') phase = 'connecting';
    else if (this.#lastError || registration.state === 'error') phase = 'error';
    else if (config) phase = 'disconnected';

    return {
      phase,
      connected,
      configured: Boolean(config),
      bot: publicBot(config),
      registration,
      connection,
      error: this.#lastError ?? registration.error ?? null,
    };
  }

  async #acceptCredentials(result) {
    const appId = result.client_id;
    const appSecret = result.client_secret;
    const ownerOpenId = result.user_info?.open_id;
    const domain = result.user_info?.tenant_brand === 'lark' ? 'lark' : 'feishu';
    if (!ownerOpenId) throw new Error('Feishu registration returned no owner open_id');

    const bot = await this.#verifyApp({ appId, appSecret, domain });
    await this.#credentials.set(FEISHU_SECRET_REF, appSecret);
    let config;
    try {
      config = await this.#configStore.save({
        appId,
        ownerOpenId,
        domain,
        botName: bot.name,
        botOpenId: bot.openId,
        activated: bot.activated,
        groupMessagePermissionGranted: true,
        connectedAt: new Date().toISOString(),
      });
    } catch (error) {
      await this.#credentials.unset(FEISHU_SECRET_REF).catch(() => undefined);
      throw error;
    }

    try {
      await this.#startRuntime(config, appSecret);
      this.#lastError = null;
    } catch (error) {
      this.#lastError = {
        code: 'connection_failed',
        message: '机器人已经创建，但长连接未就绪，请点击重试。',
      };
      throw error;
    }
  }

  async #startRuntime(config, appSecret) {
    await this.#stopRuntime();
    const runtime = await this.#createRuntime({ config, appSecret });
    this.#runtime = runtime;
    try {
      await runtime.start();
    } catch (error) {
      if (this.#runtime === runtime) this.#runtime = null;
      await runtime.stop({ preserveError: true }).catch(() => undefined);
      throw error;
    }
  }

  async #stopRuntime() {
    const runtime = this.#runtime;
    this.#runtime = null;
    if (runtime) await runtime.stop();
  }

  #serialize(operation) {
    const result = this.#transition.then(operation, operation);
    this.#transition = result.then(() => undefined, () => undefined);
    return result;
  }
}
