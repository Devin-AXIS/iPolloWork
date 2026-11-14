import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { normalizeFeishuGroupResponseMode } from './group-response-mode.mjs';
import { normalizeFeishuStepPushMode, normalizeFeishuStepCardPanels } from './step-push-mode.mjs';
import { normalizeFeishuVoiceConfig } from './voice-config.mjs';
import { normalizeSlashPanelConfig } from './slash-command-panel.mjs';

export const LEGACY_FEISHU_SECRET_REF = 'DSH_FEISHU_APP_SECRET';

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeId(value) {
  const id = cleanString(value);
  return id && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
}

function legacyBotId(appId) {
  return `bot_${createHash('sha256').update(appId).digest('hex').slice(0, 24)}`;
}

function normalizeOwners(value) {
  const candidates = Array.isArray(value.ownerOpenIds)
    ? value.ownerOpenIds
    : [value.ownerOpenId];
  return [...new Set(candidates.map(cleanString).filter(Boolean))];
}

function normalizeBot(value, { legacy = false } = {}) {
  if (!value || typeof value !== 'object') return null;
  const appId = cleanString(value.appId);
  const ownerOpenIds = normalizeOwners(value);
  if (!appId || ownerOpenIds.length === 0) return null;
  const id = safeId(value.id) ?? (legacy ? legacyBotId(appId) : null);
  const secretRef = cleanString(value.secretRef) ?? (legacy ? LEGACY_FEISHU_SECRET_REF : null);
  if (!id || !secretRef) return null;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(secretRef)) return null;
  const domain = value.domain === 'lark' ? 'lark' : 'feishu';
  return Object.freeze({
    id,
    consumerMode: value.consumerMode === 'external-consumer' ? 'external-consumer' : 'standalone',
    appId,
    secretRef,
    ownerOpenIds: Object.freeze(ownerOpenIds),
    domain,
    botName: cleanString(value.botName),
    botOpenId: cleanString(value.botOpenId),
    activated: value.activated ?? null,
    groupResponseMode: normalizeFeishuGroupResponseMode(value.groupResponseMode),
    mentionTopicReply: value.mentionTopicReply !== false,
    stepPush: value.stepPush === true,
    stepPushMode: normalizeFeishuStepPushMode(value.stepPushMode),
    stepCardPanels: normalizeFeishuStepCardPanels(value.stepCardPanels),
    voice: normalizeFeishuVoiceConfig(value.voice),
    slashPanel: normalizeSlashPanelConfig(value.slashPanel),
    groupMessagePermissionGranted: value.groupMessagePermissionGranted === true,
    deletionPending: value.deletionPending === true,
    connectedAt: cleanString(value.connectedAt),
    createdAt: cleanString(value.createdAt) ?? cleanString(value.connectedAt),
  });
}

function normalizeDocument(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.version === 2 && Array.isArray(value.bots)) {
    const bots = value.bots.map((bot) => normalizeBot(bot));
    if (bots.some((bot) => bot === null)) {
      throw new Error('dsh-feishu config contains an invalid bot entry');
    }
    const ids = new Set();
    const refs = new Set();
    const appIds = new Set();
    for (const bot of bots) {
      if (ids.has(bot.id) || refs.has(bot.secretRef) || appIds.has(bot.appId)) {
        throw new Error('dsh-feishu config contains duplicate bot identities');
      }
      ids.add(bot.id);
      refs.add(bot.secretRef);
      appIds.add(bot.appId);
    }
    return { value: Object.freeze({ version: 2, bots: Object.freeze(bots) }), migrated: false };
  }

  // Version 1 was a single non-secret bot object. Preserve its existing
  // credential reference so an environment-backed secret remains usable.
  const legacyBot = normalizeBot(value, { legacy: true });
  if (!legacyBot) return null;
  return {
    value: Object.freeze({ version: 2, bots: Object.freeze([legacyBot]) }),
    migrated: true,
  };
}

/** Stores only non-secret onboarding facts for all Feishu bots. */
export class PluginConfigStore {
  #path;
  #value = Object.freeze({ version: 2, bots: Object.freeze([]) });
  #writeQueue = Promise.resolve();

  constructor(path) {
    this.#path = path;
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.#path, 'utf8'));
      const normalized = normalizeDocument(parsed);
      if (!normalized) throw new Error('dsh-feishu config is incomplete or invalid');
      this.#value = normalized.value;
      if (normalized.migrated) await this.#writeDocument(this.#value);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#value = Object.freeze({ version: 2, bots: Object.freeze([]) });
    }
    return this;
  }

  /** Backward-compatible single-bot view used by the original controller. */
  get() {
    const bot = this.#value.bots[0];
    if (!bot) return null;
    const result = structuredClone(bot);
    result.ownerOpenId = result.ownerOpenIds[0];
    return result;
  }

  list() {
    return structuredClone(this.#value.bots);
  }

  getBot(id) {
    const bot = this.#value.bots.find((candidate) => candidate.id === id);
    return bot ? structuredClone(bot) : null;
  }

  /** Backward-compatible save replaces the original single-bot view. */
  async save(value) {
    const fallback = { ...value };
    if (!fallback.id) fallback.id = legacyBotId(cleanString(fallback.appId) ?? 'invalid');
    if (!fallback.secretRef) fallback.secretRef = LEGACY_FEISHU_SECRET_REF;
    const normalized = normalizeBot(fallback);
    if (!normalized) throw new Error('Refusing to persist incomplete dsh-feishu configuration');
    await this.#replaceBots([normalized]);
    return this.get();
  }

  async saveBot(value) {
    const normalized = normalizeBot(value);
    if (!normalized) throw new Error('Refusing to persist incomplete dsh-feishu bot configuration');
    return this.#mutate((bots) => {
      const collision = bots.find((bot) => bot.secretRef === normalized.secretRef && bot.id !== normalized.id);
      if (collision) throw new Error('Refusing to share a credential reference between Feishu bots');
      const appCollision = bots.find((bot) => bot.appId === normalized.appId && bot.id !== normalized.id);
      if (appCollision) throw new Error('Refusing to persist the same Feishu app twice');
      const index = bots.findIndex((bot) => bot.id === normalized.id);
      if (index === -1) bots.push(normalized);
      else bots[index] = normalized;
      return structuredClone(normalized);
    });
  }

  async removeBot(id) {
    if (!safeId(id)) throw new TypeError('Invalid Feishu bot id');
    return this.#mutate((bots) => {
      const index = bots.findIndex((bot) => bot.id === id);
      if (index === -1) return null;
      const [removed] = bots.splice(index, 1);
      return structuredClone(removed);
    });
  }

  async clear() {
    const operation = this.#writeQueue.then(async () => {
      try {
        await unlink(this.#path);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      this.#value = Object.freeze({ version: 2, bots: Object.freeze([]) });
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    await operation;
  }

  async #replaceBots(bots) {
    const document = Object.freeze({ version: 2, bots: Object.freeze([...bots]) });
    const operation = this.#writeQueue.then(async () => {
      await this.#writeDocument(document);
      this.#value = document;
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    await operation;
  }

  async #mutate(mutator) {
    let result;
    const operation = this.#writeQueue.then(async () => {
      const bots = [...this.#value.bots];
      result = mutator(bots);
      const document = Object.freeze({ version: 2, bots: Object.freeze(bots) });
      await this.#writeDocument(document);
      this.#value = document;
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    await operation;
    return result;
  }

  async #writeDocument(document) {
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.#path);
  }
}
