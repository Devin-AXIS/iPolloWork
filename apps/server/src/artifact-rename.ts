import { link, unlink, readFile, writeFile, readdir, stat, lstat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "./errors.js";
import { resolveWithinRoot } from "./paths.js";
import { recordArtifactRename, sessionArtifactOwner } from "./session-artifacts.js";
import { renameTemplateEntry } from "./templates.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

const locks = new Set<string>();
const inputSchema = z.object({ path: z.string().min(1), name: z.string().trim().min(1).max(180), sessionId: z.string() });

export function rewriteArtifactReferences(text: string, file: string, from: string, to: string, root: string) {
  return text.replace(/(["'`(])([^"'`\r\n)]+)(["'`)])/g, (match, start: string, value: string, end: string) => {
    const boundary = value.search(/[?#]/);
    const path = boundary < 0 ? value : value.slice(0, boundary), suffix = boundary < 0 ? "" : value.slice(boundary);
    if (!path || /^[a-z]+:/i.test(path)) return match;
    let decoded: string; try { decoded = decodeURIComponent(path); } catch { return match; }
    const local = resolve(dirname(file), decoded), workspace = resolve(root, decoded);
    if (local !== from && workspace !== from) return match;
    let next = local === from ? relative(dirname(file), to).replaceAll("\\", "/") : relative(root, to).replaceAll("\\", "/");
    if (path.startsWith("./") && !next.startsWith(".")) next = `./${next}`;
    if (path.includes("%")) next = encodeURI(next);
    return `${start}${next}${suffix}${end}`;
  });
}

export async function renameArtifact(config: ServerConfig, workspace: WorkspaceInfo, input: unknown) {
  const args = inputSchema.parse(input); sessionArtifactOwner(args.sessionId);
  if (config.readOnly) throw new ApiError(403, "read_only", "工作区为只读。");
  if (/[\\/:*?"<>|\x00-\x1f]/.test(args.name) || /[. ]$/.test(args.name) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(args.name)) throw new ApiError(400, "invalid_name", "文件名包含不可用字符。");
  const from = await resolveWithinRoot(workspace.path, args.path);
  const oldPath = relative(workspace.path, from).replaceAll("\\", "/");
  // Until every Studio runtime consumes the renamed entry, refuse rather than
  // silently break a project that still resolves its canonical filename.
  if (/^(?:video|design)\/[^/]+\/(?:index|entry)\.html$/i.test(oldPath)) throw new ApiError(409, "studio_entry_rename_pending", "工程入口的真实重命名尚未完成兼容，已保留原文件。");
  if (!(await lstat(from)).isFile()) throw new ApiError(400, "not_file", "只能重命名普通文件，不能重命名目录或符号链接。");
  if (extname(from).toLowerCase() !== extname(args.name).toLowerCase()) throw new ApiError(400, "invalid_extension", "请保留原文件扩展名。");
  const to = join(dirname(from), args.name);
  if (from === to) return { path: args.path };
  if (await stat(to).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; })) throw new ApiError(409, "file_exists", "同名文件已存在，请换一个名称。");
  if (locks.has(workspace.path)) throw new ApiError(409, "rename_busy", "工作区正在重命名文件，请稍后重试。");
  locks.add(workspace.path);
  const edits: Array<{ path: string; before: string; after: string }> = [];
  const applied: typeof edits = [];
  let linked = false, removed = false, metadata = false;
  const newPath = relative(workspace.path, to).replaceAll("\\", "/");
  try {
    let count = 0, bytes = 0;
    const walk = async (directory: string): Promise<void> => {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        if (++count > 10000) throw new ApiError(409, "rename_scan_limit", "工程文件过多，无法安全检查全部引用，未执行重命名。");
        if (item.isSymbolicLink()) continue;
        if (item.name.startsWith(".") || item.name === "node_modules") continue;
        const path = join(directory, item.name);
        if (item.isDirectory()) { await walk(path); continue; }
        if (!/\.(html?|css|[cm]?jsx?|tsx?|json|md)$/i.test(item.name)) continue;
        const info = await stat(path); bytes += info.size;
        if (info.size > 5_000_000 || bytes > 40_000_000) throw new ApiError(409, "rename_scan_limit", "引用检查超过安全大小限制，未执行重命名。");
        await resolveWithinRoot(workspace.path, path);
        const before = await readFile(path, "utf8"), after = rewriteArtifactReferences(before, path, from, to, workspace.path);
        if (before !== after) edits.push({ path, before, after });
      }
    };
    await walk(workspace.path);
    // Exclusive destination creation prevents overwriting another file in a race.
    await link(from, to); linked = true;
    for (const edit of edits) {
      if (await readFile(edit.path, "utf8") !== edit.before) throw new ApiError(409, "file_changed", "引用文件已被修改，请重试。");
      await writeFile(edit.path, edit.after); applied.push(edit);
    }
    await renameTemplateEntry(config, workspace, oldPath, newPath); metadata = true;
    await unlink(from); removed = true;
    const info = await stat(to);
    await recordArtifactRename(config, workspace.id, oldPath, newPath, {sessionId:args.sessionId,size:info.size,updatedAt:info.mtimeMs});
    return { path: newPath, updatedReferences: edits.length };
  } catch (error) {
    if (removed) await link(to, from);
    if (metadata) await renameTemplateEntry(config, workspace, newPath, oldPath);
    for (const edit of applied.reverse()) await writeFile(edit.path, edit.before);
    if (linked) await unlink(to);
    throw error;
  } finally { locks.delete(workspace.path); }
}
