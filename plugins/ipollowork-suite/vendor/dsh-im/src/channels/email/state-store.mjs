import { ConversationStateStore } from '../shared/conversation-state-store.mjs';

/**
 * Email adds one need on top of the shared conversation store: mail threads are
 * identified by Message-ID headers, so the inbound chain (References /
 * In-Reply-To) must resolve back to the conversation key we already created.
 * The map is bounded — only the most recent ids are kept, since a thread that
 * has been quiet for thousands of messages is not worth unbounded growth.
 */
const MAX_THREAD_IDS = 2_000;

/** A conversation key that pins the chat to one existing Harness session. */
export const BOUND_KEY_PREFIX = 'bound:';

export class EmailStateStore extends ConversationStateStore {
  // Loaded from persisted state on first use. Held in memory because threading
  // reads it synchronously, and written back on every change so a restart does
  // not turn a continuing thread into a brand-new conversation.
  #threadIds = null;

  /** The Message-ID → conversation map, loaded once from persisted state. */
  #threads() {
    if (this.#threadIds) return this.#threadIds;
    const stored = this.extensionState().threadIds;
    const map = new Map();
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      for (const [id, key] of Object.entries(stored)) {
        if (typeof id === 'string' && id && typeof key === 'string' && key) map.set(id, key);
      }
    }
    this.#threadIds = map;
    return map;
  }

  /** Record that `messageId` belongs to `conversationKey`. */
  rememberThreadId(messageId, conversationKey) {
    if (typeof messageId !== 'string' || !messageId || typeof conversationKey !== 'string') return;
    const threads = this.#threads();
    // Re-insert so the freshest ids survive eviction.
    threads.delete(messageId);
    threads.set(messageId, conversationKey);
    while (threads.size > MAX_THREAD_IDS) {
      threads.delete(threads.keys().next().value);
    }
    // Persisted, so a reply arriving after a restart still joins its thread.
    this.extensionState().threadIds = Object.fromEntries(threads);
    void this.persist();
  }

  /** Conversation key previously associated with this Message-ID, if any. */
  conversationForThreadId(messageId) {
    return this.#threads().get(messageId) ?? null;
  }

  /** Read-only view used by the threading resolver. */
  get threadMap() {
    return this.#threads();
  }

  /**
   * A QR authorization in flight. Persisted because the code stays valid for
   * ten minutes, which easily outlives a plugin reload — losing it meant an
   * already-completed scan could never be redeemed.
   */
  pendingAuth() {
    const value = this.extensionState().pendingAuth;
    if (!value || typeof value !== 'object') return null;
    if (typeof value.pollUrl !== 'string' || !value.pollUrl) return null;
    if (!Number.isFinite(value.expiresAt)) return null;
    return { pollUrl: value.pollUrl, expiresAt: value.expiresAt, transport: value.transport };
  }

  async setPendingAuth(value) {
    if (!value) {
      delete this.extensionState().pendingAuth;
    } else {
      this.extensionState().pendingAuth = {
        pollUrl: String(value.pollUrl ?? ''),
        expiresAt: Number(value.expiresAt ?? 0),
        ...(value.transport ? { transport: String(value.transport) } : {}),
      };
    }
    await this.persist();
  }

  /**
   * Fixed-session bindings, both scopes in one document:
   *   { account: <sessionId|null>, senders: { <address>: <sessionId> } }
   * A sender entry wins over the account default; with neither set the
   * conversation starts a fresh session per thread (the original behaviour).
   */
  emailBindings() {
    const bindings = this.extensionState().emailBindings;
    if (!bindings || typeof bindings !== 'object') return { account: null, senders: {} };
    const senders = {};
    if (bindings.senders && typeof bindings.senders === 'object' && !Array.isArray(bindings.senders)) {
      for (const [address, sessionId] of Object.entries(bindings.senders)) {
        if (typeof address === 'string' && address
          && typeof sessionId === 'string' && sessionId) senders[address] = sessionId;
      }
    }
    return {
      account: typeof bindings.account === 'string' && bindings.account ? bindings.account : null,
      senders,
    };
  }

  async setEmailBindings(value) {
    const next = value && typeof value === 'object' ? value : {};
    const senders = {};
    if (next.senders && typeof next.senders === 'object' && !Array.isArray(next.senders)) {
      for (const [address, sessionId] of Object.entries(next.senders)) {
        if (typeof address === 'string' && address
          && typeof sessionId === 'string' && sessionId) senders[address] = sessionId;
      }
    }
    this.extensionState().emailBindings = {
      account: typeof next.account === 'string' && next.account ? next.account : null,
      senders,
    };
    await this.persist();
    return this.emailBindings();
  }

  /**
   * Resolve the session a message should use, honouring the binding order:
   * a sender-specific binding, then the account-wide binding, then null which
   * means "start a new session for this thread".
   */
  boundSessionFor(senderAddress) {
    const { account, senders } = this.emailBindings();
    const address = typeof senderAddress === 'string' ? senderAddress.trim().toLowerCase() : '';
    if (address && senders[address]) return senders[address];
    return account;
  }

  /**
   * Mail cursors are not always numbers: IMAP addresses messages by an integer
   * UID, while the Agent mailbox pages by an opaque string id. The shared store
   * only accepts integers, so the mailbox keeps its own cursor and returns it
   * through the inherited accessor.
   */
  cursor() {
    const value = this.extensionState().mailCursor;
    return value === undefined ? null : value;
  }

  async setCursor(cursor) {
    if (typeof cursor !== 'string' && !Number.isSafeInteger(cursor)) {
      throw new TypeError('Invalid update cursor');
    }
    if (typeof cursor === 'string' && cursor === '') {
      throw new TypeError('Invalid update cursor');
    }
    this.extensionState().mailCursor = cursor;
    await this.persist();
  }

  /**
   * A bound conversation key maps straight to the pinned session. Without this,
   * the resolver would miss the mapping and create a brand-new session even
   * though the user asked for a fixed one. The bridge prefixes the key with the
   * chat kind (`direct:`), so the marker is searched rather than assumed to be
   * at the start.
   */
  sessionFor(key) {
    if (typeof key === 'string') {
      const marker = key.indexOf(BOUND_KEY_PREFIX);
      if (marker !== -1) {
        const sessionId = key.slice(marker + BOUND_KEY_PREFIX.length);
        if (sessionId) return sessionId;
      }
    }
    return super.sessionFor(key);
  }
}
