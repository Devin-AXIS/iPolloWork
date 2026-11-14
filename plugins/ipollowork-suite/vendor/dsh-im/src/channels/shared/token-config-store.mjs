import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const EMPTY_DOCUMENT = Object.freeze({ version: 1, bots: Object.freeze([]) });

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isHexString(value, uppercase) {
  if (typeof value !== 'string' || value.length !== 24) return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    const digit = code >= 48 && code <= 57;
    const letter = uppercase
      ? code >= 65 && code <= 70
      : code >= 97 && code <= 102;
    if (!digit && !letter) return false;
  }
  return true;
}

function matchesTokenIdentity(value, prefix, uppercaseHex) {
  if (typeof value !== 'string') return false;
  const marker = `${prefix}_`;
  if (!value.startsWith(marker)) return false;
  return isHexString(value.slice(marker.length), uppercaseHex);
}

export function deriveTokenBotIdentity(platformId, { botPrefix, tokenRefPrefix }) {
  const raw = cleanString(platformId);
  if (!raw) throw new TypeError('platformId is required');
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 24);
  return {
    botId: `${botPrefix}_${digest}`,
    tokenRef: `${tokenRefPrefix}_${digest.toUpperCase()}`,
  };
}

export function maskPlatformId(platformId, fallback) {
  const value = cleanString(platformId) ?? '';
  if (value.length <= 10) return value ? `${value.slice(0, 3)}•••` : fallback;
  return `${value.slice(0, 6)}••••${value.slice(-4)}`;
}

export class TokenBotConfigStore {
  #path;
  #channel;
  #botPrefix;
  #tokenRefPrefix;
  #normalizeBotExtension;
  #value = EMPTY_DOCUMENT;
  #writeQueue = Promise.resolve();

  constructor(path, {
    channel,
    botPrefix,
    tokenRefPrefix,
    normalizeBotExtension = () => ({}),
  }) {
    if (typeof normalizeBotExtension !== 'function') {
      throw new TypeError('normalizeBotExtension must be a function');
    }
    this.#path = path;
    this.#channel = channel;
    this.#botPrefix = botPrefix;
    this.#tokenRefPrefix = tokenRefPrefix;
    this.#normalizeBotExtension = normalizeBotExtension;
  }

  async load() {
    try {
      const normalized = this.#normalizeDocument(JSON.parse(await readFile(this.#path, 'utf8')));
      if (!normalized) throw new Error(`dsh-im ${this.#channel} config contains invalid bot data`);
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

  getByPlatformId(platformId) {
    const bot = this.#value.bots.find((candidate) => candidate.platformId === platformId);
    return bot ? structuredClone(bot) : null;
  }

  async save(value) {
    const normalized = this.#normalizeBot(value);
    if (!normalized) throw new Error(`Refusing to persist incomplete ${this.#channel} bot data`);
    return this.#mutate((bots) => {
      const identityCollision = bots.find(
        (bot) => bot.platformId === normalized.platformId && bot.botId !== normalized.botId,
      );
      const refCollision = bots.find(
        (bot) => bot.tokenRef === normalized.tokenRef && bot.botId !== normalized.botId,
      );
      if (identityCollision || refCollision) throw new Error(`Duplicate ${this.#channel} bot identity`);
      const index = bots.findIndex((bot) => bot.botId === normalized.botId);
      if (index === -1) bots.push(normalized);
      else bots[index] = normalized;
      return structuredClone(normalized);
    });
  }

  async remove(botId) {
    if (!matchesTokenIdentity(botId, this.#botPrefix, false)) {
      throw new TypeError(`Invalid ${this.#channel} bot id`);
    }
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

  #normalizeBot(value) {
    if (!value || typeof value !== 'object') return null;
    const platformId = cleanString(value.platformId);
    const botId = cleanString(value.botId);
    const tokenRef = cleanString(value.tokenRef);
    const name = cleanString(value.name);
    if (!platformId || !botId || !tokenRef || !name
      || !matchesTokenIdentity(botId, this.#botPrefix, false)
      || !matchesTokenIdentity(tokenRef, this.#tokenRefPrefix, true)) return null;
    const derived = deriveTokenBotIdentity(platformId, {
      botPrefix: this.#botPrefix,
      tokenRefPrefix: this.#tokenRefPrefix,
    });
    if (derived.botId !== botId || derived.tokenRef !== tokenRef) return null;
    const extension = this.#normalizeBotExtension(value);
    if (!extension || typeof extension !== 'object' || Array.isArray(extension)) return null;
    return Object.freeze({
      botId,
      platformId,
      tokenRef,
      name,
      username: cleanString(value.username),
      createdAt: cleanString(value.createdAt) ?? new Date().toISOString(),
      connectedAt: cleanString(value.connectedAt),
      ...extension,
    });
  }

  #normalizeDocument(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.bots)) return null;
    const bots = value.bots.map((bot) => this.#normalizeBot(bot));
    if (bots.some((bot) => bot === null)) return null;
    const ids = new Set();
    const platformIds = new Set();
    const refs = new Set();
    for (const bot of bots) {
      if (ids.has(bot.botId) || platformIds.has(bot.platformId) || refs.has(bot.tokenRef)) return null;
      ids.add(bot.botId);
      platformIds.add(bot.platformId);
      refs.add(bot.tokenRef);
    }
    return Object.freeze({ version: 1, bots: Object.freeze(bots) });
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
