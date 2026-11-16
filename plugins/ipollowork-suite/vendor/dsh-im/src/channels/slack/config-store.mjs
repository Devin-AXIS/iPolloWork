import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { t } from '../shared/i18n.mjs';

const EMPTY_DOCUMENT = Object.freeze({ version: 1, bots: Object.freeze([]) });
const BOT_ID_PATTERN = /^slack_[a-f0-9]{24}$/;
const BOT_TOKEN_REF_PATTERN = /^DSH_SLACK_BOT_TOKEN_[A-F0-9]{24}$/;
const APP_TOKEN_REF_PATTERN = /^DSH_SLACK_APP_TOKEN_[A-F0-9]{24}$/;

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function deriveSlackBotIdentity(platformId) {
  const raw = cleanString(platformId);
  if (!raw) throw new TypeError('platformId is required');
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 24);
  const suffix = digest.toUpperCase();
  return {
    botId: `slack_${digest}`,
    botTokenRef: `DSH_SLACK_BOT_TOKEN_${suffix}`,
    appTokenRef: `DSH_SLACK_APP_TOKEN_${suffix}`,
  };
}

export function maskSlackBotId(platformId) {
  const value = cleanString(platformId) ?? '';
  const [teamId, userId] = value.split(':');
  if (teamId && userId) return `${teamId.slice(0, 5)}••• · ${userId.slice(0, 5)}•••`;
  return value ? `${value.slice(0, 6)}••••` : t('Slack机器人');
}

export class SlackConfigStore {
  #path;
  #value = EMPTY_DOCUMENT;
  #writeQueue = Promise.resolve();

  constructor(path) {
    this.#path = path;
  }

  async load() {
    try {
      const normalized = this.#normalizeDocument(JSON.parse(await readFile(this.#path, 'utf8')));
      if (!normalized) throw new Error('dsh-im Slack config contains invalid bot data');
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
    if (!normalized) throw new Error('Refusing to persist incomplete Slack bot data');
    return this.#mutate((bots) => {
      const collision = bots.find((bot) => (
        bot.botId !== normalized.botId
        && (bot.platformId === normalized.platformId
          || bot.botTokenRef === normalized.botTokenRef
          || bot.appTokenRef === normalized.appTokenRef)
      ));
      if (collision) throw new Error('Duplicate Slack bot identity');
      const index = bots.findIndex((bot) => bot.botId === normalized.botId);
      if (index === -1) bots.push(normalized);
      else bots[index] = normalized;
      return structuredClone(normalized);
    });
  }

  async remove(botId) {
    if (!BOT_ID_PATTERN.test(botId)) throw new TypeError('Invalid Slack bot id');
    return this.#mutate((bots) => {
      const index = bots.findIndex((bot) => bot.botId === botId);
      if (index === -1) return null;
      return structuredClone(bots.splice(index, 1)[0]);
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
    const botId = cleanString(value.botId);
    const platformId = cleanString(value.platformId);
    const botTokenRef = cleanString(value.botTokenRef);
    const appTokenRef = cleanString(value.appTokenRef);
    const name = cleanString(value.name);
    if (!botId || !platformId || !botTokenRef || !appTokenRef || !name
      || !BOT_ID_PATTERN.test(botId)
      || !BOT_TOKEN_REF_PATTERN.test(botTokenRef)
      || !APP_TOKEN_REF_PATTERN.test(appTokenRef)) return null;
    const derived = deriveSlackBotIdentity(platformId);
    if (derived.botId !== botId
      || derived.botTokenRef !== botTokenRef
      || derived.appTokenRef !== appTokenRef) return null;
    return Object.freeze({
      botId,
      platformId,
      botTokenRef,
      appTokenRef,
      name,
      username: cleanString(value.username),
      teamId: cleanString(value.teamId),
      teamName: cleanString(value.teamName),
      createdAt: cleanString(value.createdAt) ?? new Date().toISOString(),
      connectedAt: cleanString(value.connectedAt),
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
      if (ids.has(bot.botId) || platformIds.has(bot.platformId)
        || refs.has(bot.botTokenRef) || refs.has(bot.appTokenRef)) return null;
      ids.add(bot.botId);
      platformIds.add(bot.platformId);
      refs.add(bot.botTokenRef);
      refs.add(bot.appTokenRef);
    }
    return Object.freeze({ version: 1, bots: Object.freeze(bots) });
  }

  async #mutate(mutator) {
    let result;
    const operation = this.#writeQueue.then(async () => {
      const bots = [...this.#value.bots];
      result = mutator(bots);
      const document = Object.freeze({ version: 1, bots: Object.freeze(bots) });
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: 'utf8', mode: 0o600,
      });
      await rename(temporary, this.#path);
      this.#value = document;
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    await operation;
    return result;
  }
}
