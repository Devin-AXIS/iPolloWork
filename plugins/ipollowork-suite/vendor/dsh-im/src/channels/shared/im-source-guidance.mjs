// Session-keyed source guidance for the current conversation.
//
// The prompt RPC carries no message source, so a channel publishes the guidance
// it would otherwise repeat inside every user message when it dispatches the
// prompt. The Host materializes it once per session as dynamic prompt context
// (`systemPrompt.context`), which appends a durable snapshot only when the
// rendered text changes. The registry is module-level because one process owns
// exactly one, the same shape `outboundArtifactRegistry` uses.

/** Prompt-context name the Host materializes this guidance under. */
export const IM_SOURCE_GUIDANCE_CONTEXT = 'dsh-im:source-guidance';

/** Contexts are joined in ascending order; this one follows the policy facts. */
export const IM_SOURCE_GUIDANCE_ORDER = 125;

/** Bound for one session's guidance; the settings cap is the same size. */
const GUIDANCE_MAX_LENGTH = 8_000;

/** Bound on retained sessions, so an abandoned conversation cannot grow it. */
const MAX_SESSIONS = 1_024;

class ImSourceGuidanceRegistry {
  #bySession = new Map();

  /**
   * Publish the guidance in force for one session. Empty guidance clears it, so
   * a conversation that turns enhancement off stops contributing a snapshot.
   * @param sessionId - the Session the prompt was dispatched to.
   * @param guidance - the scope's guidance text, or empty when none applies.
   */
  publish(sessionId, guidance) {
    if (typeof sessionId !== 'string' || !sessionId) return;
    const text = typeof guidance === 'string' ? guidance.slice(0, GUIDANCE_MAX_LENGTH) : '';
    // Delete first so the re-inserted key is the most recently used one.
    this.#bySession.delete(sessionId);
    if (!text.trim()) return;
    this.#bySession.set(sessionId, text);
    while (this.#bySession.size > MAX_SESSIONS) {
      this.#bySession.delete(this.#bySession.keys().next().value);
    }
  }

  /**
   * @param sessionId - a Session id, or anything else.
   * @returns the guidance in force for that session, or undefined.
   */
  get(sessionId) {
    return typeof sessionId === 'string' ? this.#bySession.get(sessionId) : undefined;
  }

  /**
   * Drop one session's guidance.
   * @param sessionId - the Session leaving the registry.
   */
  forget(sessionId) {
    if (typeof sessionId === 'string') this.#bySession.delete(sessionId);
  }

  /** @returns how many sessions currently carry guidance. */
  get size() {
    return this.#bySession.size;
  }
}

export const imSourceGuidance = new ImSourceGuidanceRegistry();
