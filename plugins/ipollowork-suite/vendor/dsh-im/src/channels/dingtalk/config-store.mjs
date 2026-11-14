import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { t } from '../shared/i18n.mjs';

const EMPTY_DOCUMENT = Object.freeze({ version: 1, bots: Object.freeze([]) });
const STORED_BOT_KEYS = new Set(['clientId', 'secretRef', 'approvedSenders']);

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeBotId(value) {
  const id = cleanString(value);
  return id && /^dt_[a-f0-9]{24}$/.test(id) ? id : null;
}

function safeSecretRef(value) {
  const ref = cleanString(value);
  return ref && /^DSH_DINGTALK_BOT_SECRET_[A-F0-9]{24}$/.test(ref) ? ref : null;
}

function safeSenderKey(value) {
  const key = cleanString(value);
  return key && /^dt_sender_[a-f0-9]{32}$/.test(key) ? key : null;
}

function normalizeApprovedSender(value) {
  const record = typeof value === 'string' ? { staffId: value } : value;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const senderKey = safeSenderKey(record.senderKey);
  const staffId = cleanString(record.staffId);
  if (!senderKey || !staffId) return null;
  return Object.freeze({
    senderKey,
    staffId,
    displayName: cleanString(record.displayName),
    approvedAt: cleanString(record.approvedAt),
  });
}

function normalizeApprovedSenders(value) {
  if (!Array.isArray(value)) return null;
  const senders = value.map(normalizeApprovedSender);
  if (senders.some((sender) => sender === null)) return null;
  const ids = new Set();
  const keys = new Set();
  for (const sender of senders) {
    if (ids.has(sender.staffId) || keys.has(sender.senderKey)) return null;
    ids.add(sender.staffId);
    keys.add(sender.senderKey);
  }
  return Object.freeze(senders);
}

/**
 * Derives stable non-secret identifiers for a DingTalk bot credential.
 * @param {string} clientId DingTalk application client ID.
 * @returns {{botId: string, secretRef: string}} Derived identifiers.
 */
export function deriveDingtalkBotIdentity(clientId) {
  const value = cleanString(clientId);
  if (!value) throw new TypeError('clientId is required');
  const valueDigest = digest(value).slice(0, 24);
  return Object.freeze({
    botId: `dt_${valueDigest}`,
    secretRef: `DSH_DINGTALK_BOT_SECRET_${valueDigest.toUpperCase()}`,
  });
}

/**
 * Creates a random browser-safe key for an approved DingTalk sender.
 * @returns {string} Opaque sender key.
 */
export function deriveDingtalkSenderKey() {
  return `dt_sender_${randomUUID().replaceAll('-', '')}`;
}

/**
 * Redacts a DingTalk sender ID for display.
 * @param {string} staffId DingTalk staff ID.
 * @returns {string} Partially redacted identifier.
 */
export function maskDingtalkSenderId(staffId) {
  const value = cleanString(staffId);
  if (!value) return t('钉钉用户');
  return t('身份已隐藏');
}

/**
 * Redacts a DingTalk client ID for display.
 * @param {string} clientId DingTalk application client ID.
 * @returns {string} Partially redacted client ID.
 */
export function maskDingtalkClientId(clientId) {
  const value = cleanString(clientId);
  if (!value) return t('钉钉机器人');
  if (value.length <= 8) return `${value.slice(0, 2)}••••`;
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function normalizeBot(value, { stored = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if ('clientSecret' in value || 'client_secret' in value || 'deviceCode' in value) return null;
  if (stored && Object.keys(value).some((key) => !STORED_BOT_KEYS.has(key))) return null;
  const clientId = cleanString(value.clientId);
  const secretRef = safeSecretRef(value.secretRef);
  const approvedSenders = normalizeApprovedSenders(value.approvedSenders ?? []);
  if (!clientId || !secretRef || !approvedSenders) return null;
  const identity = deriveDingtalkBotIdentity(clientId);
  if (identity.secretRef !== secretRef) return null;
  const suppliedBotId = value.botId === undefined ? identity.botId : safeBotId(value.botId);
  if (suppliedBotId !== identity.botId) return null;
  return Object.freeze({
    botId: identity.botId,
    clientId,
    secretRef,
    approvedSenders,
  });
}

function normalizeDocument(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.bots)) return null;
  const bots = value.bots.map((bot) => normalizeBot(bot, { stored: true }));
  if (bots.some((bot) => bot === null)) return null;
  const botIds = new Set();
  const clientIds = new Set();
  const secretRefs = new Set();
  for (const bot of bots) {
    if (botIds.has(bot.botId) || clientIds.has(bot.clientId) || secretRefs.has(bot.secretRef)) {
      return null;
    }
    botIds.add(bot.botId);
    clientIds.add(bot.clientId);
    secretRefs.add(bot.secretRef);
  }
  return Object.freeze({ version: 1, bots: Object.freeze(bots) });
}

function storedDocument(document) {
  return {
    version: 1,
    bots: document.bots.map((bot) => ({
      clientId: bot.clientId,
      secretRef: bot.secretRef,
      approvedSenders: bot.approvedSenders.map((sender) => ({
        senderKey: sender.senderKey,
        staffId: sender.staffId,
        displayName: sender.displayName,
        approvedAt: sender.approvedAt,
      })),
    })),
  };
}

/** Atomic non-secret DingTalk bot configuration store. */
export class DingtalkConfigStore {
  #path;
  #value = EMPTY_DOCUMENT;
  #writeQueue = Promise.resolve();

  /** @param {string} path Absolute or process-relative configuration file path. */
  constructor(path) {
    if (!cleanString(path)) throw new TypeError('config path is required');
    this.#path = path;
  }

  /** @returns {Promise<DingtalkConfigStore>} Loaded store. */
  async load() {
    try {
      const normalized = normalizeDocument(JSON.parse(await readFile(this.#path, 'utf8')));
      if (!normalized) throw new Error('dsh-dingtalk config contains invalid bot data');
      this.#value = normalized;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#value = EMPTY_DOCUMENT;
    }
    return this;
  }

  /** @returns {Array<object>} Cloned bot configurations with derived bot IDs. */
  list() {
    return structuredClone(this.#value.bots);
  }

  /** @param {string} botId Derived bot ID. @returns {object|null} Bot configuration. */
  get(botId) {
    const found = this.#value.bots.find((bot) => bot.botId === botId);
    return found ? structuredClone(found) : null;
  }

  /** @param {string} clientId DingTalk client ID. @returns {object|null} Bot configuration. */
  getByClientId(clientId) {
    const found = this.#value.bots.find((bot) => bot.clientId === clientId);
    return found ? structuredClone(found) : null;
  }

  /** @param {object} value Bot configuration without a client secret. @returns {Promise<object>} Saved config. */
  async save(value) {
    const normalized = normalizeBot(value);
    if (!normalized) throw new Error('Refusing to persist invalid dsh-dingtalk bot data');
    return this.#mutate((bots) => {
      const collision = bots.find(
        (bot) => (bot.clientId === normalized.clientId || bot.secretRef === normalized.secretRef)
          && bot.botId !== normalized.botId,
      );
      if (collision) throw new Error('Duplicate DingTalk bot identity');
      const index = bots.findIndex((bot) => bot.botId === normalized.botId);
      if (index === -1) bots.push(normalized);
      else bots[index] = normalized;
      return structuredClone(normalized);
    });
  }

  /** @param {string} botId Derived bot ID. @returns {Promise<object|null>} Removed config. */
  async remove(botId) {
    if (!safeBotId(botId)) throw new TypeError('Invalid DingTalk bot id');
    return this.#mutate((bots) => {
      const index = bots.findIndex((bot) => bot.botId === botId);
      if (index === -1) return null;
      const [removed] = bots.splice(index, 1);
      return structuredClone(removed);
    });
  }

  /** Removes the configuration file and resets the in-memory store. */
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
    const temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(storedDocument(document), null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporary, this.#path);
    } catch (error) {
      try {
        await unlink(temporary);
      } catch (cleanupError) {
        if (cleanupError?.code !== 'ENOENT') throw new AggregateError([error, cleanupError]);
      }
      throw error;
    }
  }
}

export { deriveDingtalkBotIdentity as deriveDingTalkBotIdentity };
export { deriveDingtalkSenderKey as deriveDingTalkSenderKey };
export { maskDingtalkClientId as maskDingTalkClientId };
export { maskDingtalkSenderId as maskDingTalkSenderId };
export { DingtalkConfigStore as DingTalkConfigStore };
