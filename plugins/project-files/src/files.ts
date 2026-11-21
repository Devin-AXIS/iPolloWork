import { createWriteStream, type Stats } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, open, readdir, realpath, rename, rm, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Entry, FileAction, TrashEntry } from './API.ts';

const trashDirectory = '.ipollo-project-trash';
const stagingPrefix = '.ipollo-files-';
const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const badPart = /[\u0000-\u001f<>:"|?*\\/]/;
export const folderLimit = 2000;

export class FileFailure extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}

export interface Move { from: string; to: string; time: number; after: number }
export const stateSchema = z.object({
  moves: z.array(z.object({ from: z.string(), to: z.string(), time: z.number(), after: z.number().default(0) })),
  trash: z.array(z.object({ id: z.uuid(), path: z.string(), time: z.number() })),
});
export type FileState = { moves: Move[]; trash: TrashEntry[] };
export const emptyState: FileState = { moves: [], trash: [] };

export function fileName(value: string): string {
  if (value.length === 0 || Buffer.byteLength(value) > 255 || badPart.test(value)
    || /[ .]$/.test(value) || reserved.test(value) || restricted(value)) throw new FileFailure('invalid-name');
  return value;
}

function restricted(value: string): boolean {
  const name = value.toLowerCase();
  return name === '.git' || name === trashDirectory || name.startsWith(stagingPrefix);
}

export function fromRecordedPath(root: string, value: string): string | undefined {
  const local = value.replaceAll('\\', sep);
  const absolute = resolve(root, local);
  const suffix = relative(root, absolute);
  if (!suffix || suffix === '..' || suffix.startsWith('..' + sep) || isAbsolute(suffix)) return;
  const path = suffix.split(sep).join('/');
  return path.split('/').some(part => restricted(part) || badPart.test(part)) ? undefined : path;
}

export function followMoves(path: string, time: number, moves: readonly Move[]): string {
  for (const { from, to, time: movedAt, after } of moves) {
    if (time > movedAt || (after > 0 && time <= after)) continue;
    if (path === from || path.startsWith(from + '/')) path = to + path.slice(from.length);
  }
  return path;
}

async function inspect(path: string) {
  try { return await lstat(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Refuse aliases at each level so a chosen folder cannot address a different project. */
async function resolveEntry(root: string, path: string, absent = false) {
  const parts = path ? path.split('/') : [];
  let target = root;
  let info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) throw new FileFailure('outside-project', 403);
  for (const [index, part] of parts.entries()) {
    if (!part || part === '.' || part === '..' || badPart.test(part) || restricted(part))
      throw new FileFailure('outside-project', 403);
    if (!info.isDirectory()) throw new FileFailure('not-folder', 409);
    target = join(target, part);
    const child = await inspect(target);
    if (!child) {
      if (absent && index === parts.length - 1) return { target, info: undefined };
      throw new FileFailure('missing', 404);
    }
    if (child.isSymbolicLink() || !(child.isDirectory() || child.isFile())) throw new FileFailure('outside-project', 403);
    info = child;
  }
  return { target, info };
}

function describe(path: string, info: Stats): Entry {
  return { path, name: path.split('/').at(-1) ?? '', kind: info.isDirectory() ? 'directory' : 'file',
    bytes: info.isFile() ? info.size : 0, modified: info.mtimeMs };
}

export async function getEntry(root: string, path: string): Promise<Entry | undefined> {
  try {
    const { info } = await resolveEntry(root, path);
    return info ? describe(path, info) : undefined;
  } catch (error) {
    if (error instanceof FileFailure && [403, 404, 409].includes(error.status)) return;
    throw error;
  }
}

export async function listFolder(root: string, path: string) {
  const { target, info } = await resolveEntry(root, path);
  if (!info?.isDirectory()) throw new FileFailure('not-folder', 409);
  const names = (await readdir(target, { withFileTypes: true }))
    .filter(entry => !entry.name.startsWith('.') && !restricted(entry.name) && (entry.isDirectory() || entry.isFile()))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const entries: Entry[] = [];
  for (let offset = 0; offset < Math.min(names.length, folderLimit); offset += 24) {
    const page = await Promise.all(names.slice(offset, Math.min(offset + 24, folderLimit))
      .map(entry => getEntry(root, path ? path + '/' + entry.name : entry.name)));
    entries.push(...page.filter((entry): entry is Entry => entry !== undefined));
  }
  return { entries, partial: names.length > folderLimit };
}

async function trashLocation(root: string): Promise<string> {
  const target = join(root, trashDirectory);
  await mkdir(target, { mode: 0o700 }).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  });
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(target) !== target)
    throw new FileFailure('outside-project', 403);
  return target;
}

export async function visibleTrash(root: string, entries: readonly TrashEntry[]) {
  const target = join(root, trashDirectory);
  if (!entries.length || await realpath(target).catch(() => '') !== target) return [];
  const stored = new Set(await readdir(target));
  return entries.filter(entry => stored.has(entry.id)).reverse();
}

function relativeParent(path: string) { const index = path.lastIndexOf('/'); return index < 0 ? '' : path.slice(0, index); }
function combine(folder: string, name: string) { return folder ? folder + '/' + name : name; }

/** Reserve an absent target with an exclusive create before publishing any bytes. */
async function publish(source: string, destination: string, isDirectory: boolean) {
  try {
    if (isDirectory) await mkdir(destination);
    else await (await open(destination, 'wx', 0o600)).close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new FileFailure('name-exists', 409);
    throw error;
  }
  try {
    // Win32 cannot replace an existing directory, even when it is empty.
    if (isDirectory && process.platform === 'win32') await rmdir(destination);
    await rename(source, destination);
  } catch (error) {
    if (process.platform !== 'win32' || !isDirectory)
      await (isDirectory ? rmdir(destination) : unlink(destination)).catch(() => undefined);
    throw error;
  }
}

async function availableCopyPath(root: string, candidate: string, isDirectory: boolean) {
  let path = candidate;
  let destination = await resolveEntry(root, path, true);
  if (destination.info) {
    const name = basename(candidate);
    const extension = isDirectory ? -1 : name.lastIndexOf('.');
    const stem = extension > 0 ? name.slice(0, extension) : name;
    const suffix = extension > 0 ? name.slice(extension) : '';
    for (let index = 1; index <= 999 && destination.info; index++) {
      path = combine(relativeParent(candidate), fileName(stem + ' (' + index + ')' + suffix));
      destination = await resolveEntry(root, path, true);
    }
  }
  if (destination.info) throw new FileFailure('name-exists', 409);
  return { path, ...destination };
}

export async function copyAttachment(root: string, folder: string, name: string, bytes: AsyncIterable<Uint8Array>, signal: AbortSignal) {
  const destination = await availableCopyPath(root, combine(folder, fileName(name)), false);
  const stage = join(dirname(destination.target), stagingPrefix + randomUUID());
  try {
    await pipeline(Readable.from(bytes), createWriteStream(stage, { flags: 'wx', mode: 0o600 }), { signal });
    await publish(stage, destination.target, false);
    return destination.path;
  } finally {
    await unlink(stage).catch(() => undefined);
  }
}

export async function changeFile(root: string, action: Exclude<FileAction, { kind: 'copy-attachment' }>, state: FileState, save: (next: FileState) => Promise<void>) {
  if (action.kind === 'mkdir') {
    const path = combine(action.folder, fileName(action.name));
    const { target, info } = await resolveEntry(root, path, true);
    if (info) throw new FileFailure('name-exists', 409);
    try { await mkdir(target); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new FileFailure('name-exists', 409);
      throw error;
    }
    return path;
  }
  if (action.kind === 'restore') {
    const entry = state.trash.find(item => item.id === action.id);
    if (!entry) throw new FileFailure('missing', 404);
    const { target, info } = await resolveEntry(root, entry.path, true);
    if (info) throw new FileFailure('name-exists', 409);
    const source = join(await trashLocation(root), entry.id);
    const file = await inspect(source);
    if (!file || file.isSymbolicLink()) throw new FileFailure('missing', 404);
    await publish(source, target, file.isDirectory());
    await save({ ...state, trash: state.trash.filter(item => item.id !== entry.id) });
    return entry.path;
  }
  if (!action.path) throw new FileFailure('outside-project', 403);
  const { target: source, info } = await resolveEntry(root, action.path);
  if (!info) throw new FileFailure('missing', 404);
  if (action.kind === 'trash') {
    const id = randomUUID();
    const time = Date.now();
    const destination = join(await trashLocation(root), id);
    // Persist recovery metadata before removing the item from its folder.
    const next = { ...state, trash: [...state.trash, { id, path: action.path, time }] };
    await save(next);
    try { await publish(source, destination, info.isDirectory()); } catch (error) { await save(state); throw error; }
    return '';
  }
  const candidate = action.kind === 'rename'
    ? combine(relativeParent(action.path), fileName(action.name))
    : combine(action.folder, basename(action.path));
  if (candidate === action.path && action.kind !== 'copy') return candidate;
  if (candidate.startsWith(action.path + '/')) throw new FileFailure('same-folder', 409);
  const copied = action.kind === 'copy' ? await availableCopyPath(root, candidate, info.isDirectory()) : undefined;
  const path = copied?.path ?? candidate;
  const destination = copied ?? await resolveEntry(root, path, true);
  const caseOnly = action.kind === 'rename' && action.path.toLowerCase() === path.toLowerCase()
    && destination.info?.ino === info.ino && destination.info.dev === info.dev;
  if (destination.info && !caseOnly) throw new FileFailure('name-exists', 409);
  if (action.kind === 'copy') {
    const stage = join(dirname(destination.target), stagingPrefix + randomUUID());
    try {
      await cp(source, stage, { recursive: info.isDirectory(), errorOnExist: true, force: false, verbatimSymlinks: true });
      await publish(stage, destination.target, info.isDirectory());
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  } else {
    const replacedAfter = state.trash.reduce((time, entry) =>
      action.path === entry.path || action.path.startsWith(entry.path + '/') ? Math.max(time, entry.time) : time, 0);
    const move: Move = { from: action.path, to: path, time: Date.now(), after: replacedAfter };
    await save({ ...state, moves: [...state.moves, move] });
    try {
      if (caseOnly) {
        const temporary = join(dirname(source), stagingPrefix + randomUUID());
        await publish(source, temporary, info.isDirectory());
        try { await publish(temporary, destination.target, info.isDirectory()); }
        catch (error) { await publish(temporary, source, info.isDirectory()); throw error; }
      } else await publish(source, destination.target, info.isDirectory());
    } catch (error) {
      await save(state);
      throw error;
    }
  }
  return path;
}
