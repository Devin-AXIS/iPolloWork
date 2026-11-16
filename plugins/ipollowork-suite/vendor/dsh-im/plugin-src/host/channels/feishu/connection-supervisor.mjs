const DEFAULT_RETRY_DELAYS_MS = Object.freeze([250, 1_000, 3_000, 5_000, 10_000, 30_000]);

function safeDelay(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function safeRetryDelays(value) {
  if (!Array.isArray(value) || value.length === 0) return [...DEFAULT_RETRY_DELAYS_MS];
  const delays = value.map((delay) => safeDelay(delay, -1)).filter((delay) => delay >= 0);
  return delays.length > 0 ? delays : [...DEFAULT_RETRY_DELAYS_MS];
}

function totals(status) {
  const configured = Number.isInteger(status?.totals?.configured)
    ? status.totals.configured
    : (Array.isArray(status?.bots) ? status.bots.length : 0);
  const connected = Number.isInteger(status?.totals?.connected)
    ? status.totals.connected
    : (Array.isArray(status?.bots)
      ? status.bots.filter((bot) => bot?.connected === true).length
      : 0);
  return { configured, connected };
}

/**
 * Starts bot connections only after the in-process Harness HTTP API is ready,
 * then periodically reconciles failed/offline bots. Timers never keep the Host
 * alive on their own and shutdown waits for an in-flight reconciliation.
 */
export class ConnectionSupervisor {
  #controller;
  #harness;
  #logger;
  #retryDelaysMs;
  #healthyIntervalMs;
  #setTimeout;
  #clearTimeout;
  #timer = null;
  #running = null;
  #retryIndex = 0;
  #started = false;
  #closed = false;
  #ready;
  #resolveReady;

  constructor({
    controller,
    harness,
    logger = console,
    retryDelaysMs,
    healthyIntervalMs = 15_000,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  }) {
    if (!controller
      || typeof controller.initialize !== 'function'
      || typeof controller.status !== 'function') {
      throw new TypeError('ConnectionSupervisor requires a controller');
    }
    if (!harness || typeof harness.ensureRunning !== 'function') {
      throw new TypeError('ConnectionSupervisor requires a Harness client');
    }
    this.#controller = controller;
    this.#harness = harness;
    this.#logger = logger;
    this.#retryDelaysMs = safeRetryDelays(retryDelaysMs);
    this.#healthyIntervalMs = safeDelay(healthyIntervalMs, 15_000);
    this.#setTimeout = setTimeoutImpl;
    this.#clearTimeout = clearTimeoutImpl;
    this.#ready = new Promise((resolve) => {
      this.#resolveReady = resolve;
    });
  }

  get ready() {
    return this.#ready;
  }

  start() {
    if (this.#started || this.#closed) return this;
    this.#started = true;
    this.#schedule(0);
    return this;
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer !== null) {
      this.#clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.#running?.catch(() => undefined);
    this.#resolveReady?.(null);
    this.#resolveReady = null;
  }

  #schedule(delayMs) {
    if (this.#closed) return;
    this.#timer = this.#setTimeout(() => {
      this.#timer = null;
      void this.#run();
    }, delayMs);
    this.#timer?.unref?.();
  }

  async #run() {
    if (this.#closed || this.#running) return;
    const operation = this.#reconcile();
    this.#running = operation;
    try {
      await operation;
    } finally {
      if (this.#running === operation) this.#running = null;
    }
  }

  async #reconcile() {
    try {
      await this.#harness.ensureRunning();
    } catch (error) {
      if (this.#closed) return;
      this.#retry('Harness Host is not ready', error);
      return;
    }
    if (this.#closed) return;

    try {
      await this.#controller.initialize();
      if (this.#closed) return;

      const status = await this.#controller.status();
      this.#resolveReady?.(status);
      this.#resolveReady = null;
      const current = totals(status);
      if (current.connected < current.configured) {
        const delay = this.#retryDelaysMs[Math.min(this.#retryIndex, this.#retryDelaysMs.length - 1)];
        this.#retryIndex += 1;
        this.#logger.warn?.(
          `[dsh-feishu] ${current.connected}/${current.configured} bots connected; retrying automatically in ${delay}ms`,
        );
        this.#schedule(delay);
        return;
      }

      this.#retryIndex = 0;
      this.#schedule(this.#healthyIntervalMs);
    } catch (error) {
      if (this.#closed) return;
      this.#retry('Bot connection reconciliation failed', error);
    }
  }

  #retry(message, error) {
    const delay = this.#retryDelaysMs[Math.min(this.#retryIndex, this.#retryDelaysMs.length - 1)];
    this.#retryIndex += 1;
    this.#logger.warn?.(
      `[dsh-feishu] ${message}; retrying automatically in ${delay}ms`,
      error,
    );
    this.#schedule(delay);
  }
}

export function createConnectionSupervisor(options) {
  return new ConnectionSupervisor(options);
}
