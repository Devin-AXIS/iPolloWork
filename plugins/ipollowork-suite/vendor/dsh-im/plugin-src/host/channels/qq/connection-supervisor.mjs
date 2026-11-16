const DEFAULT_RETRY_DELAYS_MS = Object.freeze([250, 1_000, 3_000, 5_000, 10_000, 30_000]);

function retryDelays(value) {
  if (!Array.isArray(value) || value.length === 0) return [...DEFAULT_RETRY_DELAYS_MS];
  const valid = value.filter((delay) => Number.isFinite(delay) && delay >= 0);
  return valid.length > 0 ? valid : [...DEFAULT_RETRY_DELAYS_MS];
}

export class ConnectionSupervisor {
  #controller;
  #harness;
  #logger;
  #retryDelays;
  #healthyIntervalMs;
  #setTimeout;
  #clearTimeout;
  #timer = null;
  #running = null;
  #retryIndex = 0;
  #closed = false;
  #started = false;
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
    if (!controller || typeof controller.initialize !== 'function' || typeof controller.status !== 'function') {
      throw new TypeError('ConnectionSupervisor requires a controller');
    }
    if (!harness || typeof harness.ensureRunning !== 'function') {
      throw new TypeError('ConnectionSupervisor requires a Harness client');
    }
    this.#controller = controller;
    this.#harness = harness;
    this.#logger = logger;
    this.#retryDelays = retryDelays(retryDelaysMs);
    this.#healthyIntervalMs = Number.isFinite(healthyIntervalMs) && healthyIntervalMs >= 0
      ? healthyIntervalMs : 15_000;
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
    if (this.#timer !== null) this.#clearTimeout(this.#timer);
    this.#timer = null;
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
      if (this.#closed) return;
      const status = await this.#controller.initialize();
      if (this.#closed) return;
      this.#resolveReady?.(status);
      this.#resolveReady = null;
      const { configured, connected } = status.totals;
      if (connected < configured) {
        const delay = this.#retryDelays[Math.min(this.#retryIndex, this.#retryDelays.length - 1)];
        this.#retryIndex += 1;
        this.#logger.warn?.(`[dsh-im:qq] ${connected}/${configured} bots connected; retrying in ${delay}ms`);
        this.#schedule(delay);
        return;
      }
      this.#retryIndex = 0;
      this.#schedule(this.#healthyIntervalMs);
    } catch (error) {
      if (this.#closed) return;
      const delay = this.#retryDelays[Math.min(this.#retryIndex, this.#retryDelays.length - 1)];
      this.#retryIndex += 1;
      this.#logger.warn?.(`[dsh-im:qq] connection reconciliation failed; retrying in ${delay}ms`, error);
      this.#schedule(delay);
    }
  }
}

export function createConnectionSupervisor(options) {
  return new ConnectionSupervisor(options);
}
