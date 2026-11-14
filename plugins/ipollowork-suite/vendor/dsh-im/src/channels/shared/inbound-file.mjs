import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { t } from './i18n.mjs';

const FILES_DIRECTORY = join('.dsh-im', 'inbound');
const RETENTIONS = new Set(['turn', 'persistent']);
const DIRECTORY_TIMESTAMP_PATTERN = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/;

function padded(value) {
  return String(value).padStart(2, '0');
}

/** Timestamp prefix (`yyyyMMdd-HHmmss-`) handed to mkdtemp for random suffixes. */
function inboundDirectoryPrefix(now = new Date()) {
  return `${now.getFullYear()}${padded(now.getMonth() + 1)}${padded(now.getDate())}`
    + `-${padded(now.getHours())}${padded(now.getMinutes())}${padded(now.getSeconds())}-`;
}

/**
 * Parse the local-time instant encoded in a staged inbound directory name,
 * returning null for legacy `turn-` names and anything unparseable.
 */
export function parseInboundDirectoryName(name) {
  if (typeof name !== 'string') return null;
  const match = DIRECTORY_TIMESTAMP_PATTERN.exec(name);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
    || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) {
    return null;
  }
  return date;
}

export class InboundFileError extends Error {
  constructor(code, message, userMessage = t('文件接收失败，请重新发送后再试。'), options = {}) {
    super(message, options);
    this.name = 'InboundFileError';
    this.code = code;
    this.userMessage = userMessage;
  }
}

function fileSources(message) {
  return Array.isArray(message?.files) ? message.files.filter(Boolean) : [];
}

function displayName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value
    .replaceAll('\\', '/')
    .split('/')
    .at(-1)
    ?.replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return cleaned || fallback;
}

function storageName(value, index) {
  const cleaned = displayName(value, 'file')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .replace(/^\.+/, '')
    .slice(0, 160) || 'file';
  return `${String(index + 1).padStart(2, '0')}-${cleaned}`;
}

function loadedFile(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { data: Buffer.from(value) };
  }
  const raw = value?.data ?? value?.buffer;
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    return {
      data: Buffer.from(raw),
      name: value?.name ?? value?.filename,
      mediaType: value?.mediaType ?? value?.mimetype,
    };
  }
  const stream = value?.stream ?? value;
  if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
    return {
      stream,
      name: value?.name ?? value?.filename,
      mediaType: value?.mediaType ?? value?.mimetype,
    };
  }
  return null;
}

export function hasInboundFiles(message) {
  return fileSources(message).length > 0;
}

/** Start provider downloads immediately while preserving the lazy file-source contract. */
export function prefetchInboundFiles(message, { signal } = {}) {
  const sources = fileSources(message);
  if (sources.length === 0) return message;
  return {
    ...message,
    files: sources.map((source) => {
      if (source?.data !== undefined || typeof source?.load !== 'function') return source;
      let download;
      try {
        download = Promise.resolve(source.load({ signal }));
      } catch (error) {
        download = Promise.reject(error);
      }
      download.catch(() => undefined);
      return {
        ...source,
        async load({ signal: loadSignal } = {}) {
          loadSignal?.throwIfAborted();
          const result = await download;
          loadSignal?.throwIfAborted();
          return result;
        },
      };
    }),
  };
}

export async function stageInboundFiles(message, {
  workspace,
  signal,
  retention = 'turn',
  onStagedDirectory = null,
} = {}) {
  if (!RETENTIONS.has(retention)) {
    throw new InboundFileError(
      'inbound-file-retention-invalid',
      `Unknown inbound file retention: ${String(retention)}`,
    );
  }
  if (onStagedDirectory !== null && typeof onStagedDirectory !== 'function') {
    throw new TypeError('onStagedDirectory must be a function');
  }
  const sources = fileSources(message);
  if (sources.length === 0) return null;
  if (typeof workspace !== 'string' || !isAbsolute(workspace)) {
    throw new InboundFileError(
      'inbound-file-workspace-unavailable',
      'The Harness Session workspace is unavailable for inbound files.',
    );
  }

  signal?.throwIfAborted();
  const root = resolve(workspace, FILES_DIRECTORY);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(root, inboundDirectoryPrefix()));
  // Register the batch before any file is written so a concurrent TTL=0
  // sweep can never observe the directory as untracked mid-staging.
  onStagedDirectory?.(directory);
  const files = [];

  try {
    for (const [index, source] of sources.entries()) {
      signal?.throwIfAborted();
      let value;
      try {
        value = source?.data === undefined
          ? await source?.load?.({ signal })
          : source.data;
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new InboundFileError(
          'inbound-file-download-failed',
          `Unable to download inbound file ${index + 1}: ${error?.message ?? String(error)}`,
          t('文件下载失败，请重新发送后再试。'),
          { cause: error },
        );
      }

      const loaded = loadedFile(value);
      if (!loaded) {
        throw new InboundFileError(
          'inbound-file-data-invalid',
          `Inbound file ${index + 1} returned no readable data.`,
        );
      }
      const name = displayName(loaded.name ?? source?.name, `file-${index + 1}`);
      const path = join(directory, storageName(name, index));
      if (loaded.data) {
        await writeFile(path, loaded.data, { mode: 0o600, signal });
      } else {
        try {
          await pipeline(
            loaded.stream,
            createWriteStream(path, { flags: 'wx', mode: 0o600 }),
            { signal },
          );
        } catch (error) {
          if (signal?.aborted) throw error;
          throw new InboundFileError(
            'inbound-file-download-failed',
            `Unable to stream inbound file ${index + 1}: ${error?.message ?? String(error)}`,
            t('文件下载失败，请重新发送后再试。'),
            { cause: error },
          );
        }
      }
      const relativePath = relative(resolve(workspace), path);
      if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw new InboundFileError(
          'inbound-file-path-invalid',
          'The staged inbound file escaped the Harness Session workspace.',
        );
      }
      files.push(Object.freeze({
        name,
        path: relativePath,
        ...(typeof source?.transcript === 'string' && source.transcript.trim()
          ? { transcript: source.transcript.trim() } : {}),
        ...(typeof (loaded.mediaType ?? source?.mediaType) === 'string'
          && (loaded.mediaType ?? source.mediaType).trim()
          ? { mediaType: (loaded.mediaType ?? source.mediaType).trim() }
          : {}),
      }));
    }
    return Object.freeze({
      files: Object.freeze(files),
      directory,
      retention,
      async cleanup() {
        // Persistent retention leaves the directory to the global TTL sweeper.
        if (retention !== 'turn') return;
        await rm(directory, { recursive: true, force: true });
      },
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Delete expired staged inbound directories under one workspace. Only
 * directories whose names parse as `yyyyMMdd-HHmmss` timestamps are managed;
 * legacy `turn-` names and anything unparseable stay untouched. Directories
 * reported as tracked by an in-flight turn are always skipped.
 */
export async function sweepInboundAttachments(workspace, ttlHours, {
  now = () => new Date(),
  isTracked,
} = {}) {
  if (typeof workspace !== 'string' || !workspace) {
    throw new TypeError('sweepInboundAttachments requires a workspace');
  }
  // An unparsable TTL must never widen into unconditional deletion.
  if (ttlHours !== 0 && !(Number.isInteger(ttlHours) && ttlHours > 0)) {
    return { deleted: 0 };
  }
  const root = resolve(workspace, FILES_DIRECTORY);
  let canonicalWorkspace;
  let canonicalRoot;
  try {
    [canonicalWorkspace, canonicalRoot] = await Promise.all([
      realpath(workspace),
      realpath(root),
    ]);
  } catch (error) {
    if (error?.code === 'ENOENT') return { deleted: 0 };
    throw error;
  }
  const rootInWorkspace = relative(canonicalWorkspace, canonicalRoot);
  if (!rootInWorkspace || rootInWorkspace.startsWith('..') || isAbsolute(rootInWorkspace)) {
    throw new InboundFileError(
      'inbound-file-root-outside-workspace',
      'The inbound attachment directory does not resolve inside the Harness Session workspace.',
    );
  }
  let entries;
  try {
    entries = await readdir(canonicalRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return { deleted: 0 };
    throw error;
  }
  const current = now();
  let deleted = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const stagedAt = parseInboundDirectoryName(entry.name);
    if (stagedAt === null) continue;
    const directory = join(root, entry.name);
    const canonicalDirectory = join(canonicalRoot, entry.name);
    if (typeof isTracked === 'function'
      && (isTracked(directory) || (directory !== canonicalDirectory && isTracked(canonicalDirectory)))) {
      continue;
    }
    const ageHours = (current - stagedAt) / 3_600_000;
    if (ttlHours === 0 || ageHours >= ttlHours) {
      try {
        await rm(canonicalDirectory, { recursive: true, force: true });
        deleted += 1;
      } catch {
        // One undeletable directory must not abort the remaining sweep.
      }
    }
  }
  return { deleted };
}

export function appendInboundFilesToPrompt(prompt, staged) {
  if (!staged?.files?.length) return prompt;
  const manifest = [
    '<dsh_im_files>',
    JSON.stringify({
      description: 'Files uploaded with this user message. Paths are relative to the current Harness workspace.',
      files: staged.files.map(({ receiptId, ...file }) => file),
      ...(staged.files.some(file => file.mediaType?.startsWith('audio/')) ? {
        audio: 'Use the transcript when speech.status is transcribed. For any other speech.status the recording was retained but not understood; tell the user transcription is unavailable. Never invent its content.',
      } : {}),
    }),
    '</dsh_im_files>',
  ].join('\n');

  const content = Array.isArray(prompt) ? prompt : typeof prompt === 'string' && prompt.trim() ? [{ type: 'text', text: prompt.trim() }] : [];
  const hasImages = content.some(part => part.type === 'image');
  const receipts = staged.files.filter(file => file.receiptId && (!hasImages || !file.mediaType?.startsWith('image/')))
    .map(file => ({ type: 'file', receiptId: file.receiptId }));
  if (Array.isArray(prompt) || receipts.length) return [...content, ...receipts, { type: 'text', text: manifest }];
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  return text ? `${text}\n\n${manifest}` : manifest;
}

export function inboundFileUserMessage(error) {
  return error instanceof InboundFileError ? error.userMessage : null;
}
