import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { resolveWithinRoot } from "../paths.js";
import { runtimeStorageDir } from "../runtime-storage.js";
import { recordSessionArtifact, sessionArtifactOwner } from "../session-artifacts.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { encodeImageReplacement } from "./image-selection.js";

// Receipts contain identity and hashes only. Images remain normal workspace
// artifacts, so closing the preview never loses a generated version.
const TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 25 * 1024 * 1024;
const receiptSchema = z.object({
  sourcePath: z.string(), resultPath: z.string(),
  sourceHash: z.string(), resultHash: z.string(),
  mode: z.enum(["overwrite", "copy"]).optional(),
  replacementHash: z.string().optional(),
  completed: z.boolean().optional(),
});
const activeSaves = new Set<string>();
export const imageRevision = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function receiptDirectory(config: ServerConfig, workspace: WorkspaceInfo, sessionId: unknown) {
  const owner = sessionArtifactOwner(sessionId);
  const key = imageRevision(Buffer.from(JSON.stringify([workspace.id, workspace.path, owner])));
  return join(runtimeStorageDir(config), "image-edit-results", key);
}

async function workspaceImage(workspace: WorkspaceInfo, path: string) {
  // Resolve an existing file, including symlink ancestry, before every mutation.
  if (!path || isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..")) {
    throw new ApiError(400, "invalid_path", "Image path must be workspace-relative");
  }
  const absolute = await realpath(await resolveWithinRoot(workspace.path, path));
  const info = await stat(absolute);
  if (!info.isFile() || !info.size || info.size > MAX_BYTES) throw new ApiError(400, "invalid_image", "Image is empty or too large");
  const bytes = await readFile(absolute);
  if (bytes.length > MAX_BYTES) throw new ApiError(413, "invalid_image", "Image is too large");
  return { absolute, bytes, hash: imageRevision(bytes) };
}

export async function validateImageEditSource(workspace: WorkspaceInfo, sourcePath: string, revision: unknown) {
  const source = await workspaceImage(workspace, sourcePath);
  if (typeof revision !== "string" || revision !== source.hash) {
    throw new ApiError(409, "image_source_changed", "原图已发生变化，请重新打开图片后再编辑。");
  }
  return source.hash;
}

async function writeReceipt(path: string, receipt: z.infer<typeof receiptSchema>) {
  const temporary = path + "." + randomUUID() + ".partial";
  try {
    await writeFile(temporary, JSON.stringify(receipt), { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

export async function rememberImageEditResult(
  config: ServerConfig, workspace: WorkspaceInfo, sessionId: unknown,
  sourcePath: string, sourceHash: string, resultPath: string, resultBytes: Buffer,
) {
  const directory = receiptDirectory(config, workspace, sessionId);
  await mkdir(directory, { recursive: true });
  let count = 0;
  for (const entry of await readdir(directory)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(entry)) continue;
    const path = join(directory, entry);
    const info = await stat(path);
    if (Date.now() - info.mtimeMs > TTL) await unlink(path);
    else count++;
  }
  if (count >= 512) throw new ApiError(413, "image_edit_capacity", "Too many image edit reviews in this conversation");
  const id = randomUUID();
  const source = await realpath(await resolveWithinRoot(workspace.path, sourcePath));
  const normalizedSource = relative(await realpath(workspace.path), source).replaceAll("\\", "/");
  await writeReceipt(join(directory, id + ".json"), {
    sourcePath: normalizedSource, sourceHash, resultPath, resultHash: imageRevision(resultBytes),
  });
  await recordSessionArtifact(config, workspace, sessionArtifactOwner(sessionId), normalizedSource);
  return { editId: id, originalPath: normalizedSource };
}

export async function saveImageEditResult(config: ServerConfig, workspace: WorkspaceInfo, sessionId: unknown, editId: unknown, mode: unknown) {
  const owner = sessionArtifactOwner(sessionId);
  if (typeof editId !== "string" || !z.uuid().safeParse(editId).success || (mode !== "overwrite" && mode !== "copy")) {
    throw new ApiError(400, "invalid_image_save", "A valid editId and overwrite or copy mode are required");
  }
  const receiptPath = join(receiptDirectory(config, workspace, owner), editId + ".json");
  const info = await stat(receiptPath).catch(() => null);
  if (!info?.isFile() || info.size > 16_384 || Date.now() - info.mtimeMs > TTL) {
    throw new ApiError(410, "image_edit_expired", "编辑记录已过期或不属于当前会话；已生成的副本仍保留在产出目录。");
  }
  let receipt = receiptSchema.parse(JSON.parse(await readFile(receiptPath, "utf8")));
  const key = JSON.stringify([await realpath(workspace.path), process.platform === "win32" ? receipt.sourcePath.toLowerCase() : receipt.sourcePath]);
  if (activeSaves.has(key)) throw new ApiError(409, "image_save_busy", "正在保存这张图片，请稍后重试。");
  activeSaves.add(key);
  try {
    receipt = receiptSchema.parse(JSON.parse(await readFile(receiptPath, "utf8")));
    if (receipt.mode && receipt.mode !== mode) {
      const canKeepCopy = mode === "copy" && !receipt.completed
        && (await workspaceImage(workspace, receipt.sourcePath)).hash !== receipt.replacementHash;
      if (!canKeepCopy) throw new ApiError(409, "image_edit_finalized", "这版图片已经选择了保存方式，请重新打开图片继续编辑。");
    }
    const path = mode === "copy" ? receipt.resultPath : receipt.sourcePath;
    if (receipt.completed) return { path, saveMode: mode };
    const result = await workspaceImage(workspace, receipt.resultPath).catch(error => {
      if (error.code === "ENOENT" && receipt.mode === "overwrite" && receipt.replacementHash) return null;
      throw error;
    });
    if (result && result.hash !== receipt.resultHash) throw new ApiError(409, "image_result_changed", "编辑副本已发生变化，未执行覆盖或删除。");
    if (mode === "copy") {
      if (!result) throw new ApiError(410, "image_edit_expired", "Edited copy is unavailable");
      await recordSessionArtifact(config, workspace, owner, receipt.resultPath);
      await writeReceipt(receiptPath, { ...receipt, mode, completed: true });
      return { path, saveMode: mode };
    }
    const source = await workspaceImage(workspace, receipt.sourcePath);
    if (source.hash !== receipt.sourceHash && source.hash !== receipt.replacementHash) {
      throw new ApiError(409, "image_source_changed", "原图已被其他操作修改，未覆盖；请保留副本，或重新打开原图后编辑。");
    }
    if (!receipt.replacementHash || source.hash !== receipt.replacementHash) {
      if (!result) throw new ApiError(410, "image_edit_expired", "Edited copy is unavailable");
      const extension = extname(receipt.sourcePath).toLowerCase();
      const format = extension === ".png" ? "png" : [".jpg", ".jpeg"].includes(extension) ? "jpeg" : extension === ".webp" ? "webp" : null;
      if (!format) throw new ApiError(400, "invalid_image", "Only PNG, JPEG and WebP images can be replaced");
      const replacement = await encodeImageReplacement(result.bytes, format);
      receipt.mode = mode;
      receipt.replacementHash = imageRevision(replacement);
      await writeReceipt(receiptPath, receipt); // Durable retry identity before replacing bytes.
      const temporary = join(dirname(source.absolute), "." + randomUUID() + ".image-edit.partial");
      try {
        await writeFile(temporary, replacement, { flag: "wx" });
        if ((await workspaceImage(workspace, receipt.sourcePath)).hash !== source.hash) {
          throw new ApiError(409, "image_source_changed", "原图在保存期间发生变化，未覆盖；编辑副本仍然保留。");
        }
        await rename(temporary, source.absolute);
      } finally {
        await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
      }
    }
    // Upsert the original and remove the preview's row together. If a later
    // step fails, the receipt lets a retry finish without another model call.
    await recordSessionArtifact(config, workspace, owner, receipt.sourcePath, receipt.resultPath);
    if (result) {
      const latest = await workspaceImage(workspace, receipt.resultPath);
      if (latest.hash !== receipt.resultHash) throw new ApiError(409, "image_result_changed", "副本已发生变化，未删除；原图已保存。");
      await unlink(latest.absolute);
    }
    await writeReceipt(receiptPath, { ...receipt, completed: true });
    return { path, saveMode: mode };
  } finally {
    activeSaves.delete(key);
  }
}
