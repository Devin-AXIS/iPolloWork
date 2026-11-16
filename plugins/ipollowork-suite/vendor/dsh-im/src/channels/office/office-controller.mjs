import { atConnectionStage, createConnectionDiagnostics } from '../shared/connection-error.mjs';
import { createHash } from 'node:crypto';

import { normalizeOfficeBaseUrl, officeHookUrls } from './protocol.mjs';
import { normalizeOfficeConfig } from './config-store.mjs';
import { OfficeRuntime } from './office-runtime.mjs';

function clean(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }

export function officeTokenRef(baseUrl, deviceId) {
  const digest = createHash('sha256').update(`${baseUrl}\n${deviceId}`).digest('hex').slice(0, 24).toUpperCase();
  return `DSH_OFFICE_DEVICE_TOKEN_${digest}`;
}

export class OfficeController {
  #credentials;
  #store;
  #logger;
  #diagnostics;
  #createRuntime;
  #runtime = null;
  #transition = Promise.resolve();

  constructor({ credentials, configStore, logger = console, createRuntime }) {
    if (!credentials?.resolve || !credentials?.set || !credentials?.unset) {
      throw new TypeError('AI Office requires the Harness credential provider');
    }
    if (!configStore?.get || !configStore?.save || !configStore?.clear) {
      throw new TypeError('AI Office requires a config store');
    }
    this.#credentials = credentials;
    this.#store = configStore;
    this.#logger = logger;
    this.#diagnostics = createConnectionDiagnostics({ channel: 'office', logger });
    this.#createRuntime = createRuntime ?? ((options) => new OfficeRuntime(options));
  }

  get diagnostics() { return this.#diagnostics; }

  async initialize() {
    const config = this.#store.get();
    if (config) {
      const credential = await atConnectionStage('credential.read', () => this.#credentials.resolve(config.deviceTokenRef), 'credential-store');
      if (credential?.value) await this.#start(config, credential.value);
    }
    return this.status();
  }

  async configure(input = {}) {
    return this.#serial(async () => {
      const previous = this.#store.get();
      const requestedBaseUrl = clean(input.baseUrl);
      const deviceId = clean(input.deviceId);
      if (!requestedBaseUrl || !deviceId) throw new TypeError('Office URL and Device ID are required');
      const baseUrl = normalizeOfficeBaseUrl(requestedBaseUrl).origin;
      const tokenRef = officeTokenRef(baseUrl, deviceId);
      const suppliedToken = clean(input.deviceToken);
      const priorCredential = await atConnectionStage('credential.read', () => this.#credentials.resolve(tokenRef), 'credential-store');
      const token = suppliedToken ?? priorCredential?.value;
      if (!token || token.length < 32) throw new TypeError('Device Token must contain at least 32 characters');
      const now = new Date().toISOString();
      const config = normalizeOfficeConfig({
        version: 1,
        baseUrl,
        deviceId,
        deviceTokenRef: tokenRef,
        maxConcurrency: input.maxConcurrency,
        heartbeatSeconds: input.heartbeatSeconds,
        workspaces: input.workspaces,
        instructionPresets: input.instructionPresets,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      });
      if (!config) throw new TypeError('AI Office connector configuration is invalid');

      await atConnectionStage('credential.save', () => this.#credentials.set(tokenRef, token), 'credential-store');
      try {
        await atConnectionStage('account.save', () => this.#store.save(config), 'account-config');
      } catch (error) {
        if (priorCredential?.value) await atConnectionStage('credential.save', () => this.#credentials.set(tokenRef, priorCredential.value), 'credential-store').catch(() => undefined);
        else await atConnectionStage('credential.remove', () => this.#credentials.unset(tokenRef), 'credential-store').catch(() => undefined);
        throw error;
      }
      if (previous?.deviceTokenRef && previous.deviceTokenRef !== tokenRef) {
        await atConnectionStage('credential.remove', () => this.#credentials.unset(previous.deviceTokenRef), 'credential-store');
      }
      await this.#start(config, token);
      return this.status();
    });
  }

  async reconnect() {
    return this.#serial(async () => {
      const config = this.#store.get();
      if (!config) throw new Error('AI Office connector is not configured');
      await this.#start(config);
      return this.status();
    });
  }

  async test() {
    const config = this.#store.get();
    if (!config) throw new Error('AI Office connector is not configured');
    const token = await this.#resolveToken(config);
    const runtime = this.#createRuntime({ config, token, logger: this.#logger });
    try { await runtime.testConnection(AbortSignal.timeout(10_000)); } finally { await runtime.stop().catch(() => undefined); }
    return { tested: true, snapshot: await this.status() };
  }

  async remove() {
    return this.#serial(async () => {
      const warnings = [];
      const config = this.#store.get();
      await this.#stop();
      await atConnectionStage('account.remove', () => this.#store.clear(), 'account-config');
      if (config?.deviceTokenRef) {
        await atConnectionStage('credential.remove', () => this.#credentials.unset(config.deviceTokenRef), 'credential-store').catch(error => {
          warnings.push(this.#diagnostics.report(error, { reuse: true, operation: 'connector.remove', warning: true,
            publicError: { code: 'cleanup-failed', message: '连接已移除，但登录凭据清理失败。' } }).publicError);
        });
      }
      return { ...await this.status(), ...(warnings.length ? { warnings } : {}) };
    });
  }

  async status() {
    const config = this.#store.get();
    if (!config) return { schemaVersion: 1, configured: false, connected: false, state: 'unconfigured' };
    const credential = await atConnectionStage('credential.read', () => this.#credentials.resolve(config.deviceTokenRef), 'credential-store');
    const runtime = this.#runtime?.status ?? null;
    return {
      schemaVersion: 1,
      configured: true,
      connected: runtime?.connected === true,
      state: runtime?.state ?? (credential?.value ? 'idle' : 'missing-token'),
      config: {
        protocolVersion: config.protocolVersion,
        baseUrl: config.baseUrl,
        deviceId: config.deviceId,
        maxConcurrency: config.maxConcurrency,
        heartbeatSeconds: config.heartbeatSeconds,
        workspaces: config.workspaces,
        instructionPresets: config.instructionPresets,
        hooks: officeHookUrls(config.baseUrl),
      },
      health: runtime,
      tokenConfigured: Boolean(credential?.value),
    };
  }

  async close() { await this.#transition.catch(() => undefined); await this.#stop(); }

  async #resolveToken(config) {
    const credential = await atConnectionStage('credential.read', () => this.#credentials.resolve(config.deviceTokenRef), 'credential-store');
    if (!credential?.value) throw new Error('AI Office Device Token is missing');
    return credential.value;
  }

  async #start(config, knownToken) {
    await this.#stop();
    const token = knownToken ?? await this.#resolveToken(config);
    const runtime = this.#createRuntime({ config, token, logger: this.#logger });
    this.#runtime = runtime;
    runtime.start();
  }

  async #stop() {
    const runtime = this.#runtime;
    this.#runtime = null;
    if (runtime) await runtime.stop();
  }

  #serial(operation) {
    const run = this.#transition.then(operation, operation);
    this.#transition = run.then(() => undefined, () => undefined);
    return run;
  }
}
