import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { DEFAULT_INBOUND_TTL_HOURS, normalizeInboundTtlHours } from './inbound-ttl.mjs';

const DOCUMENT_VERSION = 1;
// Fail-safe TTL for documents that exist but cannot be trusted (damage or an
// unknown future version, e.g. after a rollback). TTL 0 would sweep every
// untracked directory on the next pass, so keep-forever is the safe fallback.
const UNREADABLE_DOCUMENT_TTL_HOURS = -1;

function invalidTtlError() {
  const error = new Error('Invalid inbound attachment TTL hours.');
  error.code = 'inbound-ttl-invalid';
  return error;
}

// Mirrors the atomic settings writes of the bot workspace store and the
// update service: create a private temporary file, then rename it into place.
async function writeSettingsDocument(path, document) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

/** Durable host-side settings for the global inbound attachment TTL. */
export class InboundTtlStore {
  #path;
  #ttlHours = DEFAULT_INBOUND_TTL_HOURS;

  constructor(path) {
    if (typeof path !== 'string' || !path) throw new TypeError('inbound TTL store path is required');
    this.#path = path;
  }

  /**
   * A missing file means first run (default TTL). A damaged or future
   * document falls back to keep-forever so an unreadable intent can never
   * widen into deletion; the value stays visible in the settings UI.
   */
  async load() {
    let raw;
    try {
      raw = await readFile(this.#path, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#ttlHours = DEFAULT_INBOUND_TTL_HOURS;
      await this.#removeStaleTemporaries();
      return this;
    }
    this.#ttlHours = this.#readTtlHours(raw) ?? UNREADABLE_DOCUMENT_TTL_HOURS;
    await this.#removeStaleTemporaries();
    return this;
  }

  // Crash leftovers from an interrupted atomic write are unreferenced by
  // anyone; remove them so the settings directory stays clean.
  async #removeStaleTemporaries() {
    const directory = dirname(this.#path);
    const prefix = `${basename(this.#path)}.`;
    try {
      const entries = await readdir(directory);
      await Promise.all(entries
        .filter((name) => name.startsWith(prefix) && name.endsWith('.tmp'))
        .map((name) => unlink(join(directory, name)).catch(() => {})));
    } catch {
      // A missing directory or concurrent removal is fine; cleanup is best-effort.
    }
  }

  #readTtlHours(raw) {
    let document;
    try {
      document = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!document || typeof document !== 'object' || Array.isArray(document)) return null;
    if (document.version !== DOCUMENT_VERSION) return null;
    if (document.inboundAttachmentTtlHours === undefined) return DEFAULT_INBOUND_TTL_HOURS;
    return normalizeInboundTtlHours(document.inboundAttachmentTtlHours);
  }

  getTtlHours() {
    return this.#ttlHours;
  }

  async setTtlHours(value) {
    const ttlHours = normalizeInboundTtlHours(value);
    if (ttlHours === null) throw invalidTtlError();
    await writeSettingsDocument(this.#path, {
      version: DOCUMENT_VERSION,
      inboundAttachmentTtlHours: ttlHours,
    });
    this.#ttlHours = ttlHours;
    return ttlHours;
  }
}
