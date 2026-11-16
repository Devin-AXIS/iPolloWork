import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  applyDeliverySyncPatch,
  DEFAULT_DELIVERY_SYNC_SETTINGS,
  DELIVERY_SYNC_SETTINGS_VERSION,
  normalizeDeliverySyncSettings,
} from './delivery-sync-settings.mjs';

const stores = new Map();

/**
 * One settings document for the whole plugin: which non-IM turns reach a chat
 * and which prefixes mark them. Mirrors ImageInputSettingsStore: atomic
 * rename, serialized writes, and a damaged document falls back to the defaults
 * instead of failing the Host.
 */
export class DeliverySyncSettingsStore {
  #path;
  #settings = DEFAULT_DELIVERY_SYNC_SETTINGS;
  #ready;
  #writes = Promise.resolve();

  constructor(path) {
    if (typeof path !== 'string' || !path) {
      throw new TypeError('delivery sync settings store path is required');
    }
    this.#path = path;
  }

  async get() {
    this.#ready ??= this.#load().catch((error) => { this.#ready = null; throw error; });
    await this.#ready;
    return { ...this.#settings };
  }

  async #load() {
    let raw;
    try { raw = await readFile(this.#path, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    let document;
    try { document = JSON.parse(raw); } catch { return; }
    if (!document || typeof document !== 'object' || Array.isArray(document)) return;
    if (document.version !== DELIVERY_SYNC_SETTINGS_VERSION) return;
    // A document with a broken body keeps the defaults; a readable one wins.
    this.#settings = normalizeDeliverySyncSettings(document.deliverySync) ?? DEFAULT_DELIVERY_SYNC_SETTINGS;
  }

  /** Apply a partial update: only the fields present in `patch` are written. */
  async set(patch) {
    const operation = this.#writes.catch(() => {}).then(async () => {
      const current = await this.get();
      const settings = applyDeliverySyncPatch(current, patch);
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.${randomUUID()}.tmp`;
      try {
        await writeFile(
          temporary,
          `${JSON.stringify({ version: DELIVERY_SYNC_SETTINGS_VERSION, deliverySync: settings }, null, 2)}\n`,
          { mode: 0o600, flag: 'wx' },
        );
        await rename(temporary, this.#path);
        this.#settings = settings;
      } finally { await rm(temporary, { force: true }); }
      return { ...settings };
    });
    this.#writes = operation;
    return operation;
  }
}

/** Path of the document, for diagnostics and tests. */
export function deliverySyncSettingsPath(config = {}) {
  const root = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  return join(root, 'integrations', 'dsh-im', 'delivery-sync-settings.json');
}

/** One settings owner per DSH home, shared by the UI, the RPC and the coordinator. */
export function getDeliverySyncSettingsStore(config = {}) {
  const path = deliverySyncSettingsPath(config);
  if (!stores.has(path)) stores.set(path, new DeliverySyncSettingsStore(path));
  return stores.get(path);
}
