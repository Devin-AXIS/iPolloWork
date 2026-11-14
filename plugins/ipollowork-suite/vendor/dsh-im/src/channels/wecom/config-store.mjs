import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { t } from '../shared/i18n.mjs';

const EMPTY_DOCUMENT = Object.freeze({ version: 1, bots: Object.freeze([]) });

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeIntegrationId(value) {
  const id = cleanString(value);
  return id && /^wecom_[a-f0-9]{24}$/.test(id) ? id : null;
}

function safeSecretRef(value) {
  const ref = cleanString(value);
  return ref && /^DSH_WECOM_BOT_SECRET_[A-F0-9]{24}$/.test(ref) ? ref : null;
}

export function deriveWecomBotIdentity(remoteBotId) {
  const raw = cleanString(remoteBotId);
  if (!raw) throw new TypeError('Enterprise WeChat bot ID is required');
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 24);
  return {
    botId: `wecom_${digest}`,
    secretRef: `DSH_WECOM_BOT_SECRET_${digest.toUpperCase()}`,
  };
}

export function maskWecomBotId(remoteBotId) {
  const value = cleanString(remoteBotId) ?? '';
  if (!value) return t('企业微信机器人');
  if (value.length <= 10) return `${value.slice(0, 3)}•••`;
  return `${value.slice(0, 6)}••••${value.slice(-4)}`;
}

function normalizeBot(value) {
  if (!value || typeof value !== 'object') return null;
  const botId = safeIntegrationId(value.botId);
  const remoteBotId = cleanString(value.remoteBotId);
  const secretRef = safeSecretRef(value.secretRef);
  if (!botId || !remoteBotId || !secretRef) return null;
  const derived = deriveWecomBotIdentity(remoteBotId);
  if (derived.botId !== botId || derived.secretRef !== secretRef) return null;
  return Object.freeze({
    botId,
    remoteBotId,
    secretRef,
    createdAt: cleanString(value.createdAt) ?? new Date().toISOString(),
    connectedAt: cleanString(value.connectedAt),
  });
}

function normalizeDocument(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.bots)) return null;
  const bots = value.bots.map(normalizeBot);
  if (bots.some((bot) => bot === null)) return null;
  const ids = new Set();
  const remoteIds = new Set();
  const refs = new Set();
  for (const bot of bots) {
    if (ids.has(bot.botId) || remoteIds.has(bot.remoteBotId) || refs.has(bot.secretRef)) return null;
    ids.add(bot.botId);
    remoteIds.add(bot.remoteBotId);
    refs.add(bot.secretRef);
  }
  return Object.freeze({ version: 1, bots: Object.freeze(bots) });
}

export class WecomConfigStore {
  #path;
  #value = EMPTY_DOCUMENT;
  #writeQueue = Promise.resolve();

  constructor(path) {
    this.#path = path;
  }

  async load() {
    try {
      const normalized = normalizeDocument(JSON.parse(await readFile(this.#path, 'utf8')));
      if (!normalized) throw new Error('dsh-im Enterprise WeChat config contains invalid bot data');
      this.#value = normalized;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#value = EMPTY_DOCUMENT;
    }
    return this;
  }

  list() {
    return structuredClone(this.#value.bots);
  }

  get(botId) {
    const bot = this.#value.bots.find((candidate) => candidate.botId === botId);
    return bot ? structuredClone(bot) : null;
  }

  getByRemoteBotId(remoteBotId) {
    const bot = this.#value.bots.find((candidate) => candidate.remoteBotId === remoteBotId);
    return bot ? structuredClone(bot) : null;
  }

  async save(value) {
    const normalized = normalizeBot(value);
    if (!normalized) throw new Error('Refusing to persist incomplete Enterprise WeChat bot data');
    return this.#mutate((bots) => {
      const remoteCollision = bots.find(
        (bot) => bot.remoteBotId === normalized.remoteBotId && bot.botId !== normalized.botId,
      );
      const refCollision = bots.find(
        (bot) => bot.secretRef === normalized.secretRef && bot.botId !== normalized.botId,
      );
      if (remoteCollision || refCollision) throw new Error('Duplicate Enterprise WeChat bot identity');
      const index = bots.findIndex((bot) => bot.botId === normalized.botId);
      if (index === -1) bots.push(normalized);
      else bots[index] = normalized;
      return structuredClone(normalized);
    });
  }

  async remove(botId) {
    if (!safeIntegrationId(botId)) throw new TypeError('Invalid Enterprise WeChat bot ID');
    return this.#mutate((bots) => {
      const index = bots.findIndex((bot) => bot.botId === botId);
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
      this.#value = EMPTY_DOCUMENT;
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    await operation;
  }

  async #mutate(mutator) {
    let result;
    const operation = this.#writeQueue.then(async () => {
      const bots = [...this.#value.bots];
      result = mutator(bots);
      const document = Object.freeze({ version: 1, bots: Object.freeze(bots) });
      await this.#write(document);
      this.#value = document;
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    await operation;
    return result;
  }

  async #write(document) {
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporary, this.#path);
  }
}
