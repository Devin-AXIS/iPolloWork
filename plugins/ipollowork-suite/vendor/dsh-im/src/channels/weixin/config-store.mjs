import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { normalizeWeixinApiBaseUrl } from './weixin-api.mjs';
import { t } from '../shared/i18n.mjs';
import { configValidationError, withConfigResource } from '../shared/config-read-error.mjs';

const EMPTY_DOCUMENT = Object.freeze({ version: 1, accounts: Object.freeze([]) });

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeBotId(value) {
  const id = cleanString(value);
  return id && /^wx_[a-f0-9]{24}$/.test(id) ? id : null;
}

function safeTokenRef(value) {
  const ref = cleanString(value);
  return ref && /^DSH_WEIXIN_BOT_TOKEN_[A-F0-9]{24}$/.test(ref) ? ref : null;
}

export function deriveWeixinBotIdentity(accountId) {
  const raw = cleanString(accountId);
  if (!raw) throw new TypeError('accountId is required');
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 24);
  return {
    botId: `wx_${digest}`,
    tokenRef: `DSH_WEIXIN_BOT_TOKEN_${digest.toUpperCase()}`,
  };
}

export function maskWeixinAccountId(accountId) {
  const value = cleanString(accountId) ?? '';
  if (value.length <= 10) return value ? `${value.slice(0, 3)}•••` : t('微信机器人');
  return `${value.slice(0, 6)}••••${value.slice(-4)}`;
}

function normalizeAccount(value, invalid = () => null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('', 'expected-object');
  const accountId = cleanString(value.accountId);
  const ownerUserId = cleanString(value.ownerUserId);
  const botId = safeBotId(value.botId);
  const tokenRef = safeTokenRef(value.tokenRef);
  if (!accountId) return invalid('.accountId', 'invalid-string');
  if (!ownerUserId) return invalid('.ownerUserId', 'invalid-string');
  if (!botId) return invalid('.botId', 'invalid-identifier');
  if (!tokenRef) return invalid('.tokenRef', 'invalid-identifier');
  const derived = deriveWeixinBotIdentity(accountId);
  if (derived.botId !== botId) return invalid('.botId', 'identity-mismatch');
  if (derived.tokenRef !== tokenRef) return invalid('.tokenRef', 'identity-mismatch');
  let baseUrl;
  try {
    baseUrl = normalizeWeixinApiBaseUrl(value.baseUrl);
  } catch (error) {
    return invalid('.baseUrl', error?.code === 'untrusted-base-url' ? 'untrusted-api-url' : 'invalid-api-url');
  }
  return Object.freeze({
    botId,
    accountId,
    tokenRef,
    ownerUserId,
    baseUrl,
    createdAt: cleanString(value.createdAt) ?? new Date().toISOString(),
    connectedAt: cleanString(value.connectedAt),
  });
}

function normalizeDocument(value) {
  const invalid = (field, issue) => {
    throw configValidationError('dsh-weixin config contains invalid account data', field, issue);
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('$', 'expected-object');
  if (value.version !== 1) return invalid('version', 'unsupported-version');
  if (!Array.isArray(value.accounts)) return invalid('accounts', 'expected-array');
  const accounts = value.accounts.map((account, index) => normalizeAccount(account,
    (field, issue) => invalid(`accounts[${index}]${field}`, issue)));
  const ids = new Set();
  const accountIds = new Set();
  const refs = new Set();
  for (const [index, account] of accounts.entries()) {
    if (ids.has(account.botId)) return invalid(`accounts[${index}].botId`, 'duplicate-identity');
    if (accountIds.has(account.accountId)) return invalid(`accounts[${index}].accountId`, 'duplicate-identity');
    if (refs.has(account.tokenRef)) return invalid(`accounts[${index}].tokenRef`, 'duplicate-identity');
    ids.add(account.botId);
    accountIds.add(account.accountId);
    refs.add(account.tokenRef);
  }
  return Object.freeze({ version: 1, accounts: Object.freeze(accounts) });
}

export class WeixinConfigStore {
  #path;
  #value = EMPTY_DOCUMENT;
  #writeQueue = Promise.resolve();

  constructor(path) {
    this.#path = path;
  }

  async load() {
    try {
      const normalized = normalizeDocument(JSON.parse(await readFile(this.#path, 'utf8')));
      this.#value = normalized;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw withConfigResource(error, 'account-config');
      this.#value = EMPTY_DOCUMENT;
    }
    return this;
  }

  list() {
    return structuredClone(this.#value.accounts);
  }

  get(botId) {
    const account = this.#value.accounts.find((candidate) => candidate.botId === botId);
    return account ? structuredClone(account) : null;
  }

  getByAccountId(accountId) {
    const account = this.#value.accounts.find((candidate) => candidate.accountId === accountId);
    return account ? structuredClone(account) : null;
  }

  async save(value) {
    const normalized = normalizeAccount(value);
    if (!normalized) throw new Error('Refusing to persist incomplete dsh-weixin account data');
    return this.#mutate((accounts) => {
      const accountCollision = accounts.find(
        (account) => account.accountId === normalized.accountId && account.botId !== normalized.botId,
      );
      const refCollision = accounts.find(
        (account) => account.tokenRef === normalized.tokenRef && account.botId !== normalized.botId,
      );
      if (accountCollision || refCollision) throw new Error('Duplicate Weixin account identity');
      const index = accounts.findIndex((account) => account.botId === normalized.botId);
      if (index === -1) accounts.push(normalized);
      else accounts[index] = normalized;
      return structuredClone(normalized);
    });
  }

  async remove(botId) {
    if (!safeBotId(botId)) throw new TypeError('Invalid Weixin bot id');
    return this.#mutate((accounts) => {
      const index = accounts.findIndex((account) => account.botId === botId);
      if (index === -1) return null;
      const [removed] = accounts.splice(index, 1);
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
      const accounts = [...this.#value.accounts];
      result = mutator(accounts);
      const document = Object.freeze({ version: 1, accounts: Object.freeze(accounts) });
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
