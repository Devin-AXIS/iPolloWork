/**
 * One-consumption registry for conversation roots (Feishu topic roots, Matrix
 * thread roots): the first message of a thread is context for that thread's AI
 * conversation, but it must not be re-fed on every turn.
 *
 * The contract mirrors the behavior shipped for Feishu topics in CHANGELOG
 * 4.24.1: the root rides along only until one turn using it completes
 * successfully — commands, rejected messages, and failed lookups or requests
 * never consume it — and a cleared, switched, or rebuilt session receives it
 * again. Anchors persist through the conversation state store's extension
 * mechanism so a restart does not re-inject; a state without that mechanism
 * (tests, older stores) falls back to an in-process table.
 */

export class RootContextRegistry {
  #state;
  // Same shape as the persisted anchor table so every accessor reads one kind of value.
  #fallback = Object.create(null);

  constructor({ state = null } = {}) {
    this.#state = state;
  }

  /** The live anchor table, creating it inside the persisted state when possible. */
  #table(create = false) {
    const extension = typeof this.#state?.extensionState === 'function' ? this.#state.extensionState() : null;
    if (extension && typeof extension === 'object') {
      if (extension.rootAnchors && typeof extension.rootAnchors === 'object') return extension.rootAnchors;
      if (create) extension.rootAnchors = Object.create(null);
      return extension ? extension.rootAnchors ?? null : null;
    }
    return this.#fallback;
  }

  #persist() {
    if (typeof this.#state?.persist === 'function') return this.#state.persist();
    return undefined;
  }

  /**
   * @param {{sessionId: ?string, rootId: ?string}|null} anchor
   */
  anchorFor(routeKey) {
    const anchor = this.#table(false)?.[routeKey];
    if (!anchor || typeof anchor !== 'object') return null;
    return Object.freeze({
      sessionId: typeof anchor.sessionId === 'string' && anchor.sessionId ? anchor.sessionId : null,
      rootId: typeof anchor.rootId === 'string' && anchor.rootId ? anchor.rootId : null,
    });
  }

  /**
   * Whether the root context should ride along on the next prompt.
   * @param {{routeKey: string, sessionId: ?string, rootId: ?string}} request
   * @returns {{inject: boolean, reason: string}}
   */
  plan({ routeKey, sessionId = null, rootId = null } = {}) {
    if (!routeKey || typeof rootId !== 'string' || !rootId) {
      return Object.freeze({ inject: false, reason: 'no-root' });
    }
    const anchor = this.anchorFor(routeKey);
    const effectiveSessionId = typeof sessionId === 'string' && sessionId ? sessionId : null;
    if (!anchor) return Object.freeze({ inject: true, reason: 'fresh' });
    if (anchor.rootId !== rootId) return Object.freeze({ inject: true, reason: 'root-changed' });
    if (anchor.sessionId !== effectiveSessionId) return Object.freeze({ inject: true, reason: 'session-changed' });
    return Object.freeze({ inject: false, reason: 'consumed' });
  }

  /** Record a successful consumption; only call this after the turn succeeded. */
  async markInjected({ routeKey, sessionId = null, rootId } = {}) {
    if (!routeKey || typeof rootId !== 'string' || !rootId) return false;
    const table = this.#table(true);
    if (!table) return false;
    table[routeKey] = {
      sessionId: typeof sessionId === 'string' && sessionId ? sessionId : null,
      rootId,
      at: new Date().toISOString(),
    };
    await this.#persist();
    return true;
  }

  /** Drop one route's anchor so the next successful turn re-receives the root (a cleared session). */
  async clearRoute(routeKey) {
    const table = this.#table(false);
    if (!table || !(routeKey in table)) return false;
    delete table[routeKey];
    await this.#persist();
    return true;
  }

  /** Drop every anchor (a full reset of the conversation state). */
  async clearAll() {
    const table = this.#table(false);
    if (table) {
      for (const key of Object.keys(table)) delete table[key];
      await this.#persist();
    }
    for (const key of Object.keys(this.#fallback)) delete this.#fallback[key];
  }
}
