import { randomUUID } from 'node:crypto';
import { open, realpath, stat, mkdir, copyFile, unlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname, basename } from 'node:path';

export const VIDEO_LIMIT = 512 * 1024 * 1024;
export const IMAGE_LIMIT = 10 * 1024 * 1024;
export const MEDIA_TYPES = { '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
export function fail(message, code = 'invalid_input') { throw Object.assign(new Error(message), { code }); }
export function within(root, path) {
  const part = relative(root, path);
  return part !== '' && part !== '..' && !part.startsWith('..\\') && !part.startsWith('../') && !isAbsolute(part);
}
export class Media {
  constructor(store, dataDir, workspaceRoot) { Object.assign(this, { store, dataDir, workspaceRoot }); }
  async register(id, name, extension) {
    const path = resolve(this.dataDir, 'assets', `${id}${extension}`);
    const info = await stat(path), mimeType = MEDIA_TYPES[extension];
    if (!mimeType || !info.isFile() || !info.size || info.size > (extension === '.mp4' ? VIDEO_LIMIT : IMAGE_LIMIT)) fail('文件格式或大小不符合本地素材限制');
    const handle = await open(path, 'r');
    const header = Buffer.alloc(32);
    try { await handle.read(header, 0, 32, 0); } finally { await handle.close(); }
    const valid = extension === '.mp4' ? header.toString('ascii', 4, 8) === 'ftyp'
      : extension === '.png' ? header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : extension === '.webp' ? header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'
      : header[0] === 255 && header[1] === 216 && header[2] === 255;
    if (!valid) fail('文件内容与扩展名不匹配');
    if (this.store.count('asset') >= 1000) fail('素材数量已达到本地上限');
    return this.store.put('asset', { id, name: basename(name).slice(0, 200), extension, mimeType,
      kind: extension === '.mp4' ? 'video' : 'image', size: info.size, createdAt: new Date().toISOString() });
  }
  async import(sourcePath) {
    if (typeof sourcePath !== 'string' || !sourcePath.trim() || sourcePath.length > 2000) fail('请提供工作区内素材路径');
    const root = await realpath(this.workspaceRoot), source = await realpath(resolve(root, sourcePath));
    if (!within(root, source)) fail('只能导入当前工作区内的素材');
    const extension = extname(source).toLowerCase(), info = await stat(source);
    if (!MEDIA_TYPES[extension] || !info.isFile() || info.size > (extension === '.mp4' ? VIDEO_LIMIT : IMAGE_LIMIT)) fail('素材格式或大小不符合限制');
    const id = randomUUID(), destination = resolve(this.dataDir, 'assets', `${id}${extension}`);
    await mkdir(resolve(this.dataDir, 'assets'), { recursive: true, mode: 0o700 });
    try { await copyFile(source, destination); return await this.register(id, basename(source), extension); }
    catch (error) { await unlink(destination).catch(() => {}); throw error; }
  }
  async path(id) {
    const asset = this.store.get('asset', id);
    if (!asset) fail('素材不存在');
    const root = await realpath(resolve(this.dataDir, 'assets'));
    const path = await realpath(resolve(root, `${asset.id}${asset.extension}`));
    if (!within(root, path)) fail('素材路径无效');
    return { asset, path };
  }
}
