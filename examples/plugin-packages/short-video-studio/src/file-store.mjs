import { mkdir, readFile, writeFile, rename, readdir, lstat, realpath, copyFile, unlink } from 'node:fs/promises';
import { join, resolve, dirname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { id, newProject, validateProject } from './project.mjs';

// Never follow a workspace symlink out of the user-selected root.
export async function within(root, relative, createParents = false) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.startsWith('/') || relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('文件路径无效');
  const base = await realpath(root);
  const parts = relative.split('/'); let current = base;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    if (!current.startsWith(`${base}${sep}`)) throw new Error('文件不在当前项目内');
    try { const info = await lstat(current); if (info.isSymbolicLink()) throw new Error('不允许符号链接'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; if (createParents && i < parts.length - 1) await mkdir(current); }
  }
  return current;
}
export async function atomicJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  await rename(temp, path);
}
export class ProjectStore {
  #locks = new Map();
  constructor(root) { this.root = resolve(root); }
  async exclusive(key, task) {
    const prior = this.#locks.get(key) ?? Promise.resolve();
    const pending = prior.catch(() => {}).then(task); this.#locks.set(key, pending);
    try { return await pending; } finally { if (this.#locks.get(key) === pending) this.#locks.delete(key); }
  }
  path(projectId, file = 'project.json', create = false) { return within(this.root, `short-video/${id(projectId)}/${file}`, create); }
  async read(projectId) { const path = await this.path(projectId); const info = await lstat(path); if (info.size > 2_000_000) throw new Error('工程过大'); return validateProject(JSON.parse(await readFile(path, 'utf8'))); }
  async list() {
    const dir = await within(this.root, 'short-video');
    let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const projects = [];
    for (const entry of entries.filter(e => e.isDirectory() && /^p_/.test(e.name)).slice(0, 1000)) {
      try { const p = await this.read(entry.name); projects.push({ id: p.id, title: p.title, updatedAt: p.updatedAt, revision: p.revision }); } catch { /* A damaged or foreign directory is not a plugin project. */ }
    }
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async create(title) { const p = validateProject(newProject(title)); await atomicJson(await this.path(p.id, 'project.json', true), p); return p; }
  async update(projectId, revision, mutate) {
    return this.exclusive(projectId, async () => {
      const before = await this.read(projectId);
      if (revision !== undefined && before.revision !== revision) throw new Error('项目已被对话或另一个窗口更新，请重新载入后再保存');
      const after = validateProject(await mutate(structuredClone(before)));
      if (after.id !== before.id) throw new Error('不能更改工程 ID');
      after.revision = before.revision + 1; after.updatedAt = Date.now();
      await atomicJson(await this.path(projectId, `history/r${before.revision}.json`, true), before);
      await atomicJson(await this.path(projectId), after);
      const history = await this.path(projectId, 'history');
      const snapshots=(await readdir(history)).filter(name=>/^r\d+\.json$/.test(name)).sort((a,b)=>Number(b.slice(1,-5))-Number(a.slice(1,-5)));
      await Promise.all(snapshots.slice(50).map(file=>unlink(join(history,file))));
      return after;
    });
  }
  async save(input) {
    const candidate = validateProject(input);
    return this.update(candidate.id, candidate.revision, before => ({ ...candidate,
      // Asset ownership, generation receipts, and handoffs are service-owned.
      assets: before.assets, jobs: before.jobs, exports: before.exports }));
  }
  async copyMedia(source, target) {
    await copyFile(await within(this.root, source), await within(this.root, target, true), 1);
  }
}
