import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { DEFAULT_IMAGE_INPUT_SETTINGS, normalizeImageInputSettings } from './image-input-policy.mjs';

const stores = new Map();

export class ImageInputSettingsStore {
  #path;
  #settings = DEFAULT_IMAGE_INPUT_SETTINGS;
  #ready;
  #writes = Promise.resolve();

  constructor(path) { this.#path = path; }

  async get() {
    this.#ready ??= this.#load().catch((error) => { this.#ready = null; throw error; });
    await this.#ready;
    return { ...this.#settings };
  }

  async #load() {
    let raw;
    try { raw = await readFile(this.#path, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const document = JSON.parse(raw);
    const settings = document.version === 1 && normalizeImageInputSettings(document.imageInput);
    if (!settings) throw new Error('Invalid image input settings document');
    this.#settings = settings;
  }

  async set(value) {
    const settings = normalizeImageInputSettings(value);
    if (!settings) throw new TypeError('Invalid image input settings');
    const operation = this.#writes.catch(() => {}).then(async () => {
      await this.get();
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify({ version: 1, imageInput: settings }, null, 2)}\n`,
          { mode: 0o600, flag: 'wx' });
        await rename(temporary, this.#path);
        this.#settings = settings;
      } finally { await rm(temporary, { force: true }); }
      return { ...settings };
    });
    this.#writes = operation;
    return operation;
  }
}

/** One settings owner per DSH home, shared by the UI and channel Harness clients. */
export function getImageInputSettingsStore(config = {}) {
  const root = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  const path = join(root, 'integrations', 'dsh-im', 'image-input-settings.json');
  if (!stores.has(path)) stores.set(path, new ImageInputSettingsStore(path));
  return stores.get(path);
}
