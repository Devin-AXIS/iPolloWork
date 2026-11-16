import { ConversationStateStore } from '../shared/conversation-state-store.mjs';

const BOT_MESSAGE_LIMIT = 2_000;

export class WhatsappStateStore extends ConversationStateStore {
  #botMessageIds = new Set();

  async load() {
    await super.load();
    const stored = this.extensionState().whatsappBotMessageIds;
    this.#botMessageIds = new Set(Array.isArray(stored)
      ? stored.filter((id) => typeof id === 'string' && id).slice(-BOT_MESSAGE_LIMIT)
      : []);
    return this;
  }

  isBotMessage(jid, id) {
    return typeof id === 'string' && Boolean(id) && this.#botMessageIds.has(`${jid}:${id}`);
  }

  async rememberBotMessage(jid, id) {
    if (typeof jid !== 'string' || !jid.endsWith('@g.us')
      || typeof id !== 'string' || !id || this.isBotMessage(jid, id)) return;
    this.#botMessageIds.add(`${jid}:${id}`);
    while (this.#botMessageIds.size > BOT_MESSAGE_LIMIT) {
      this.#botMessageIds.delete(this.#botMessageIds.values().next().value);
    }
    this.extensionState().whatsappBotMessageIds = [...this.#botMessageIds];
    await this.persist();
  }

  async remove() {
    await super.remove();
    this.#botMessageIds.clear();
  }
}
