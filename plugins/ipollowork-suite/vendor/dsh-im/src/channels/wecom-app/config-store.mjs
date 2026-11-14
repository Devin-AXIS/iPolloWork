import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { t } from '../shared/i18n.mjs';

const EMPTY_DOCUMENT = Object.freeze({ version: 1, bots: Object.freeze([]) });

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeIntegrationId(value) {
  const id = cleanString(value);
  return id && /^wecomapp_[a-f0-9]{24}$/.test(id) ? id : null;
}

function safeRef(value, prefix) {
  const ref = cleanString(value);
  if (!ref?.startsWith(prefix)) return null;
  const suffix = ref.slice(prefix.length);
  return /^[A-F0-9]{24}$/.test(suffix) ? ref : null;
}

// A bot identity is stable per (corpId, agentId) pair so re-binding the same
// application replaces its credentials in place instead of piling up bots.
export function deriveWecomAppIdentity({ corpId, agentId }) {
  const id = cleanString(corpId);
  const agent = cleanString(agentId);
  if (!id || !agent) throw new TypeError('Enterprise WeChat corpId and agentId are required');
  const digest = createHash('sha256').update(`${id}:${agent}`).digest('hex').slice(0, 24);
  return {
    botId: `wecomapp_${digest}`,
    secretRef: `DSH_WECOM_APP_SECRET_${digest.toUpperCase()}`,
    callbackTokenRef: `DSH_WECOM_APP_TOKEN_${digest.toUpperCase()}`,
    callbackKeyRef: `DSH_WECOM_APP_AESKEY_${digest.toUpperCase()}`,
  };
}

export function generateCallbackSecret() {
  return randomBytes(16).toString('hex');
}

export function maskCorpId(corpId) {
  const value = cleanString(corpId) ?? '';
  if (!value) return t('企业微信应用');
  if (value.length <= 10) return `${value.slice(0, 3)}•••`;
  return `${value.slice(0, 6)}••••${value.slice(-4)}`;
}

export function validCorpId(value) {
  const id = cleanString(value);
  return Boolean(id && /^[A-Za-z][A-Za-z0-9_-]{2,127}$/.test(id));
}

export function validAgentId(value) {
  const agent = cleanString(value);
  return Boolean(agent && /^\d{1,32}$/.test(agent) && Number(agent) > 0);
}

export function validApiBaseUrl(value) {
  const raw = cleanString(value);
  return raw === null || /^https?:\/\//iu.test(raw);
}

function normalizeBot(value) {
  if (!value || typeof value !== 'object') return null;
  const botId = safeIntegrationId(value.botId);
  const corpId = cleanString(value.corpId);
  const agentId = cleanString(value.agentId);
  const secretRef = safeRef(value.secretRef, 'DSH_WECOM_APP_SECRET_');
  const callbackTokenRef = safeRef(value.callbackTokenRef, 'DSH_WECOM_APP_TOKEN_');
  const callbackKeyRef = safeRef(value.callbackKeyRef, 'DSH_WECOM_APP_AESKEY_');
  const callbackSecret = cleanString(value.callbackSecret);
  if (!botId || !corpId || !agentId || !secretRef || !callbackTokenRef || !callbackKeyRef) return null;
  if (!validCorpId(corpId) || !validAgentId(agentId)) return null;
  if (!callbackSecret || !/^[a-f0-9]{32}$/.test(callbackSecret)) return null;
  if (!validApiBaseUrl(value.apiBaseUrl ?? undefined)) return null;
  if (!validApiBaseUrl(value.callbackBaseUrl ?? undefined)) return null;
  const derived = deriveWecomAppIdentity({ corpId, agentId });
  if (derived.botId !== botId || derived.secretRef !== secretRef
    || derived.callbackTokenRef !== callbackTokenRef || derived.callbackKeyRef !== callbackKeyRef) return null;
  return Object.freeze({
    botId,
    corpId,
    agentId,
    secretRef,
    callbackTokenRef,
    callbackKeyRef,
    callbackSecret,
    apiBaseUrl: cleanString(value.apiBaseUrl) ?? undefined,
    callbackBaseUrl: cleanString(value.callbackBaseUrl) ?? undefined,
    streamEnabled: value.streamEnabled !== false,
    createdAt: cleanString(value.createdAt) ?? new Date().toISOString(),
    connectedAt: cleanString(value.connectedAt),
  });
}

function normalizeDocument(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.bots)) return null;
  const bots = value.bots.map(normalizeBot);
  if (bots.some((bot) => bot === null)) return null;
  const ids = new Set();
  const corpAgents = new Set();
  const secrets = new Set();
  const callbackSecrets = new Set();
  for (const bot of bots) {
    const corpAgent = `${bot.corpId}:${bot.agentId}`;
    if (ids.has(bot.botId) || corpAgents.has(corpAgent)
      || secrets.has(bot.secretRef) || callbackSecrets.has(bot.callbackSecret)) return null;
    ids.add(bot.botId);
    corpAgents.add(corpAgent);
    secrets.add(bot.secretRef);
    callbackSecrets.add(bot.callbackSecret);
  }
  return Object.freeze({ version: 1, bots: Object.freeze(bots) });
}

export class WecomAppConfigStore {
  #path;
  #value = EMPTY_DOCUMENT;
  #writeQueue = Promise.resolve();

  constructor(path) {
    this.#path = path;
  }

  async load() {
    try {
      const normalized = normalizeDocument(JSON.parse(await readFile(this.#path, 'utf8')));
      if (!normalized) throw new Error('dsh-im Enterprise WeChat app config contains invalid bot data');
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

  getByCorpAgent(corpId, agentId) {
    const bot = this.#value.bots.find((candidate) => candidate.corpId === corpId && candidate.agentId === agentId);
    return bot ? structuredClone(bot) : null;
  }

  async save(value) {
    const normalized = normalizeBot(value);
    if (!normalized) throw new Error('Refusing to persist incomplete Enterprise WeChat app bot data');
    return this.#mutate((bots) => {
      const corpAgent = `${normalized.corpId}:${normalized.agentId}`;
      const collision = bots.find((bot) =>
        (bot.botId === normalized.botId || `${bot.corpId}:${bot.agentId}` === corpAgent
          || bot.secretRef === normalized.secretRef || bot.callbackSecret === normalized.callbackSecret)
        && bot.botId !== normalized.botId);
      if (collision) throw new Error('Duplicate Enterprise WeChat app bot identity');
      const index = bots.findIndex((bot) => bot.botId === normalized.botId);
      if (index === -1) bots.push(normalized);
      else bots[index] = normalized;
      return structuredClone(normalized);
    });
  }

  async update(botId, patch = {}) {
    const existing = this.get(botId);
    if (!existing) throw new Error('Unknown Enterprise WeChat app bot');
    const merged = { ...existing };
    if (patch.apiBaseUrl !== undefined) {
      merged.apiBaseUrl = cleanString(patch.apiBaseUrl) ?? null;
      if (!validApiBaseUrl(merged.apiBaseUrl ?? undefined)) {
        throw new Error('代理地址必须是 http(s) 地址');
      }
    }
    if (patch.callbackBaseUrl !== undefined) {
      merged.callbackBaseUrl = cleanString(patch.callbackBaseUrl) ?? null;
      if (!validApiBaseUrl(merged.callbackBaseUrl ?? undefined)) {
        throw new Error('回调基址必须是 http(s) 地址');
      }
    }
    if (patch.streamEnabled !== undefined) merged.streamEnabled = patch.streamEnabled === true;
    if (patch.callbackSecret !== undefined) {
      const secret = cleanString(patch.callbackSecret);
      if (!secret || !/^[a-f0-9]{32}$/.test(secret)) throw new Error('回调密钥格式不正确');
      merged.callbackSecret = secret;
    }
    return this.save(merged);
  }

  async remove(botId) {
    if (!safeIntegrationId(botId)) throw new TypeError('Invalid Enterprise WeChat app bot ID');
    return this.#mutate((bots) => {
      const index = bots.findIndex((candidate) => candidate.botId === botId);
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
