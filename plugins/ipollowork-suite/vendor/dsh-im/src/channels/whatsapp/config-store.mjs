import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { t } from '../shared/i18n.mjs';

const EMPTY_DOCUMENT = Object.freeze({ version: 2, bots: Object.freeze([]) });
const BOT_ID_PATTERN = /^whatsapp_[a-f0-9]{24}$/;
const AUTH_DIRECTORY_PATTERN = /^[a-f0-9-]{36}$/;
const WHATSAPP_PHONE_NUMBER = /^[1-9]\d{4,14}$/;

export const WHATSAPP_ACCESS_MODES = Object.freeze({
  selfOnly: 'self-only',
  privateAllowlist: 'private-allowlist',
  open: 'open',
});

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeWhatsappAccountJid(value) {
  const jid = cleanString(value)?.toLowerCase();
  return /^\d{5,32}@(s\.whatsapp\.net|lid)$/.test(jid ?? '') ? jid : null;
}

export function deriveWhatsappBotId(accountJid) {
  const normalized = normalizeWhatsappAccountJid(accountJid);
  if (!normalized) throw new TypeError('A valid WhatsApp account JID is required');
  return `whatsapp_${createHash('sha256').update(normalized).digest('hex').slice(0, 24)}`;
}

export function maskWhatsappAccount(accountJid) {
  const digits = normalizeWhatsappAccountJid(accountJid)?.split('@')[0] ?? '';
  if (!digits) return t('WhatsApp账号');
  if (digits.length <= 7) return `${digits.slice(0, 2)}•••${digits.slice(-2)}`;
  return `${digits.slice(0, 4)}••••${digits.slice(-4)}`;
}

export function normalizeWhatsappAllowedNumbers(value) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new TypeError('allowedNumbers must be an array of WhatsApp phone numbers');
  }
  const normalized = value.map((entry) => {
    const number = typeof entry === 'string' ? entry.trim().replace(/^\+/, '') : '';
    if (!WHATSAPP_PHONE_NUMBER.test(number)) {
      throw new TypeError('allowedNumbers contains an invalid WhatsApp phone number');
    }
    return number;
  });
  return Object.freeze([...new Set(normalized)]);
}

export function normalizeWhatsappAccessPolicy(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('WhatsApp access policy must be an object');
  }
  const accessMode = value.accessMode ?? WHATSAPP_ACCESS_MODES.selfOnly;
  if (!Object.values(WHATSAPP_ACCESS_MODES).includes(accessMode)) {
    throw new TypeError('WhatsApp accessMode is invalid');
  }
  return Object.freeze({
    accessMode,
    allowedNumbers: normalizeWhatsappAllowedNumbers(value.allowedNumbers),
  });
}

export class WhatsappConfigStore {
  #path;
  #value = EMPTY_DOCUMENT;
  #writeQueue = Promise.resolve();

  constructor(path) {
    this.#path = path;
  }

  async load() {
    try {
      const normalized = this.#normalizeDocument(JSON.parse(await readFile(this.#path, 'utf8')));
      if (!normalized) throw new Error('dsh-im WhatsApp config contains invalid account data');
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

  getByAccountJid(accountJid) {
    const normalized = normalizeWhatsappAccountJid(accountJid);
    const bot = this.#value.bots.find((candidate) => candidate.accountJid === normalized);
    return bot ? structuredClone(bot) : null;
  }

  async save(value) {
    const normalized = this.#normalizeBot(value);
    if (!normalized) throw new Error('Refusing to persist incomplete WhatsApp account data');
    return this.#mutate((bots) => {
      const duplicate = bots.find((bot) => bot.accountJid === normalized.accountJid
        && bot.botId !== normalized.botId);
      const authCollision = bots.find((bot) => bot.authDirectory === normalized.authDirectory
        && bot.botId !== normalized.botId);
      if (duplicate || authCollision) throw new Error('Duplicate WhatsApp account identity');
      const index = bots.findIndex((bot) => bot.botId === normalized.botId);
      if (index === -1) bots.push(normalized);
      else bots[index] = normalized;
      return structuredClone(normalized);
    });
  }

  async remove(botId) {
    if (!BOT_ID_PATTERN.test(botId)) throw new TypeError('Invalid WhatsApp bot id');
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
    const accountJid = normalizeWhatsappAccountJid(value.accountJid);
    const botId = cleanString(value.botId);
    const authDirectory = cleanString(value.authDirectory);
    const name = cleanString(value.name);
    if (!accountJid || !botId || !authDirectory || !name
      || !BOT_ID_PATTERN.test(botId) || !AUTH_DIRECTORY_PATTERN.test(authDirectory)
      || deriveWhatsappBotId(accountJid) !== botId) return null;
    let accessPolicy;
    try {
      accessPolicy = normalizeWhatsappAccessPolicy(value);
    } catch {
      return null;
    }
    return Object.freeze({
      botId,
      accountJid,
      authDirectory,
      name,
      createdAt: cleanString(value.createdAt) ?? new Date().toISOString(),
      connectedAt: cleanString(value.connectedAt),
      ...accessPolicy,
    });
  }

  #normalizeDocument(value) {
    if (!value || value.version !== 2 || !Array.isArray(value.bots)) return null;
    const bots = value.bots.map((bot) => this.#normalizeBot(bot));
    if (bots.some((bot) => bot === null)) return null;
    const botIds = new Set();
    const accountJids = new Set();
    const authDirectories = new Set();
    for (const bot of bots) {
      if (botIds.has(bot.botId) || accountJids.has(bot.accountJid)
        || authDirectories.has(bot.authDirectory)) return null;
      botIds.add(bot.botId);
      accountJids.add(bot.accountJid);
      authDirectories.add(bot.authDirectory);
    }
    return Object.freeze({ version: 2, bots: Object.freeze(bots) });
  }

  async #mutate(mutator) {
    let result;
    const operation = this.#writeQueue.then(async () => {
      const bots = [...this.#value.bots];
      result = mutator(bots);
      const document = Object.freeze({ version: 2, bots: Object.freeze(bots) });
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
