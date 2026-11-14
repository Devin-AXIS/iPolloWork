/** Correlate failures before user/message via the durable inbox's exact claim.
 * This grants no live turn/interaction ownership and never guesses from the
 * next turn/start: other callers may already be queued in the same Session.
 */
export class PromptFailureTracker {
  #rpcId;
  #seq;
  #pending = new Map();
  #openTurn = null;
  #claimedTurn = null;
  #failedTurn = null;

  constructor(rpcId, afterSeq = -1) {
    this.#rpcId = rpcId;
    this.#seq = afterSeq;
  }

  consume(event) {
    const { seq, type, data = {} } = event;
    if (!Number.isSafeInteger(seq) || seq <= this.#seq || this.#failedTurn !== null) {
      return this.#failedTurn;
    }
    // Missing splices could have changed queue positions or canceled the input.
    // Prefer no attribution over attributing another caller's failure.
    if (seq !== this.#seq + 1) {
      this.#pending.clear();
      this.#openTurn = null;
      this.#claimedTurn = null;
    }
    this.#seq = seq;
    if (type === 'turn/start') this.#openTurn = data.turn ?? null;
    if (type === 'agent/inbox/spliced') {
      const { target, start, inserted, outcome } = data;
      const count = data.removedCount ?? 0;
      if (!['next-turn', 'next-step'].includes(target) || !Number.isSafeInteger(start) || start < 0
        || !Number.isSafeInteger(count) || count < 0 || !Array.isArray(inserted)) {
        this.#pending.clear();
        this.#claimedTurn = null;
        return this.#failedTurn;
      }
      const positions = this.#pending.get(target) ?? [];
      const next = [];
      for (const index of positions) {
        if (index < start) next.push(index);
        else if (index >= start + count) next.push(index + inserted.length - count);
        else if (outcome === undefined && inserted.length === 0 && Number.isSafeInteger(this.#openTurn)) {
          this.#claimedTurn = this.#openTurn;
        }
      }
      inserted.forEach((message, index) => {
        if (message?.source?.rpcId === this.#rpcId) next.push(start + index);
      });
      this.#pending.set(target, next);
    }
    if (type === 'turn/end') {
      const kind = typeof data.reason === 'string' ? data.reason : data.reason?.kind;
      if (Number.isSafeInteger(this.#claimedTurn) && data.turn === this.#claimedTurn && kind && kind !== 'completed') {
        this.#failedTurn = data.turn;
      }
      if (data.turn === this.#claimedTurn) this.#claimedTurn = null;
      this.#openTurn = null;
    }
    return this.#failedTurn;
  }
}
