const ACTIVE_REGISTRATION_STATES = new Set([
  'starting',
  'qr_ready',
  'polling',
  'slow_down',
  'domain_switched',
]);

function credentialResult(result) {
  const appId = result?.client_id ?? result?.appId;
  const appSecret = result?.client_secret ?? result?.appSecret;
  if (typeof appId !== 'string' || appId.length === 0
    || typeof appSecret !== 'string' || appSecret.length === 0) {
    throw new TypeError('Feishu registration returned invalid credentials');
  }
  return {
    appId,
    appSecret,
    userInfo: result?.user_info ?? result?.userInfo,
  };
}

async function readConnectionStatus(connectionManager) {
  if (typeof connectionManager.status !== 'function') return {};
  return await connectionManager.status();
}

function isConnected(status) {
  if (status?.connected === true) return true;
  return status?.ready === true
    && status?.feishuLongConnectionState === 'connected'
    && status?.harnessReachable === true;
}

/**
 * Minimal orchestration boundary between QR provisioning and the live bot.
 *
 * `createProvisioningManager` receives the only callback that can observe the
 * App Secret.  The callback persists credentials and starts the long-lived
 * connection before the provisioning manager may report `succeeded`.
 */
export class ProvisioningBackedController {
  #credentialStore;
  #connectionManager;
  #registrationOptions;
  #manager;
  #knownConfigured = false;
  #lastError = null;

  constructor({
    createProvisioningManager,
    credentialStore,
    connectionManager,
    registrationOptions = {},
  } = {}) {
    if (typeof createProvisioningManager !== 'function') {
      throw new TypeError('createProvisioningManager is required');
    }
    if (!credentialStore
      || typeof credentialStore.save !== 'function'
      || typeof credentialStore.clear !== 'function') {
      throw new TypeError('credentialStore.save/clear are required');
    }
    if (!connectionManager
      || typeof connectionManager.connect !== 'function'
      || typeof connectionManager.disconnect !== 'function') {
      throw new TypeError('connectionManager.connect/disconnect are required');
    }
    if (registrationOptions === null
      || typeof registrationOptions !== 'object'
      || Array.isArray(registrationOptions)) {
      throw new TypeError('registrationOptions must be an object');
    }

    this.#credentialStore = credentialStore;
    this.#connectionManager = connectionManager;
    this.#registrationOptions = structuredClone(registrationOptions);
    this.#manager = createProvisioningManager({
      onCredentials: (result) => this.#acceptCredentials(result),
    });
    if (!this.#manager
      || typeof this.#manager.start !== 'function'
      || typeof this.#manager.status !== 'function'
      || typeof this.#manager.cancel !== 'function') {
      throw new TypeError('The provisioning manager must implement start/status/cancel');
    }
  }

  async startRegistration() {
    this.#lastError = null;
    await this.#manager.start(structuredClone(this.#registrationOptions));
    return this.status();
  }

  async cancelRegistration() {
    await this.#manager.cancel();
    return this.status();
  }

  async disconnect() {
    await this.#manager.cancel();
    await this.#connectionManager.disconnect();
    try {
      await this.#credentialStore.clear();
      this.#knownConfigured = false;
      this.#lastError = null;
    } catch {
      // Do not reflect a credential provider's error text across the RPC
      // boundary.  It may include a backend path or secret reference detail.
      this.#lastError = {
        code: 'credential_removal_failed',
        message: 'Unable to remove the Feishu credentials.',
      };
    }
    return this.status();
  }

  async status() {
    const registration = await this.#manager.status();
    const connection = await readConnectionStatus(this.#connectionManager);
    const connected = isConnected(connection);
    let configured = this.#knownConfigured;
    if (typeof this.#credentialStore.configured === 'function') {
      try {
        configured = await this.#credentialStore.configured();
      } catch {
        configured = this.#knownConfigured;
      }
    }

    let phase = 'unconfigured';
    if (connected) phase = 'connected';
    else if (ACTIVE_REGISTRATION_STATES.has(registration?.state)) phase = 'registering';
    else if (registration?.state === 'saving') phase = 'connecting';
    else if (this.#lastError || registration?.state === 'error') phase = 'error';
    else if (configured) phase = 'disconnected';

    return {
      phase,
      connected,
      configured,
      registration,
      connection,
      error: this.#lastError ?? registration?.error ?? null,
    };
  }

  async close() {
    await this.#manager.cancel();
    await this.#connectionManager.disconnect();
  }

  async #acceptCredentials(result) {
    const credentials = credentialResult(result);
    try {
      await this.#credentialStore.save(credentials);
      this.#knownConfigured = true;
      await this.#connectionManager.connect(credentials);
      this.#lastError = null;
    } catch {
      this.#lastError = {
        code: 'connection_failed',
        message: 'The bot was created, but its connection could not be started.',
      };
      throw new Error('Unable to activate the Feishu connection.');
    }
  }
}

export function createProvisioningBackedController(options) {
  return new ProvisioningBackedController(options);
}
