import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { runtimeStorageDir } from "../runtime-storage.js";
import { sessionArtifactOwner } from "../session-artifacts.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";

// Bound decoded memory before handing untrusted images to the decoder.
const MAX_PIXELS = 16_777_216;
const MAX_BYTES = 25 * 1024 * 1024;
const SNAPSHOT_TTL = 7 * 24 * 60 * 60 * 1000;
const snapshotSchema = z.object({ sourcePath: z.string(), image: z.string(), mask: z.string() });
let processor: typeof import("sharp") | undefined;

async function imageProcessor() {
  try { return processor ??= (await import("sharp")).default; }
  catch {
    throw new ApiError(503, "image_processor_unavailable", "Selected-image editing needs the native image processor. Use the desktop app or Node-based server with optional dependencies enabled; a standalone Bun executable is not supported for this action.");
  }
}

function selectionDirectory(config: ServerConfig, workspace: WorkspaceInfo, sessionId: unknown) {
  const owner = sessionArtifactOwner(sessionId);
  const key = createHash("sha256").update(JSON.stringify([workspace.id, workspace.path, owner])).digest("hex");
  return join(runtimeStorageDir(config), "image-selections", key);
}

export async function saveImageSelection(config: ServerConfig, workspace: WorkspaceInfo, sessionId: unknown, sourcePath: string, image: Buffer, mask: Buffer) {
  const directory = selectionDirectory(config, workspace, sessionId);
  await mkdir(directory, { recursive: true });
  // Only remove our expired UUID records, never workspace/user image files.
  let usedBytes = 0;
  let count = 0;
  for (const entry of await readdir(directory)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(entry)) continue;
    const path = join(directory, entry);
    const info = await stat(path).catch(() => null);
    if (!info) continue;
    if (Date.now() - info.mtimeMs > SNAPSHOT_TTL) await unlink(path).catch(() => undefined);
    else { usedBytes += info.size; count++; }
  }
  const data = JSON.stringify({ sourcePath, image: image.toString("base64"), mask: mask.toString("base64") });
  if (image.length > MAX_BYTES || mask.length > MAX_BYTES || count >= 64 || usedBytes + data.length > 512 * 1024 * 1024) {
    throw new ApiError(413, "image_selection_capacity", "Image selection storage limit reached for this conversation");
  }
  const id = randomUUID();
  await writeFile(join(directory, `${id}.json`), data, { flag: "wx", mode: 0o600 });
  return id;
}

export async function loadImageSelection(config: ServerConfig, workspace: WorkspaceInfo, sessionId: unknown, id: string) {
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) throw new ApiError(400, "invalid_selection", "Invalid selection ID");
  const path = join(selectionDirectory(config, workspace, sessionId), `${id}.json`);
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile() || info.size > MAX_BYTES * 3 || Date.now() - info.mtimeMs > SNAPSHOT_TTL) {
    throw new ApiError(410, "image_selection_expired", "Image selection is unavailable for this conversation; attach it again");
  }
  const value = snapshotSchema.parse(JSON.parse(await readFile(path, "utf8")));
  return { sourcePath: value.sourcePath, image: Buffer.from(value.image, "base64"), mask: Buffer.from(value.mask, "base64") };
}

async function rgba(bytes: Buffer, label: string) {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new ApiError(413, "invalid_image", `${label} is empty or too large`);
  const sharp = await imageProcessor();
  try {
    const decoder = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "warning" });
    const metadata = await decoder.metadata();
    if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) {
      throw new Error("Unsupported image format");
    }
    return await decoder.rotate().toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    throw new ApiError(400, "invalid_image", `${label} must be a valid, single-frame PNG, JPEG or WebP within the pixel limit`);
  }
}

/** Preserve the source file's format when the user explicitly replaces it. */
export async function encodeImageReplacement(bytes: Buffer, format: "png" | "jpeg" | "webp") {
  const sharp = await imageProcessor();
  const decoded = await rgba(bytes, "Edited image");
  return sharp(decoded.data, { raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 } })
    .toFormat(format, format === "jpeg" ? { quality: 95 } : format === "webp" ? { lossless: true } : {})
    .toBuffer();
}

/** Distance to protected pixels, not to a bounding rectangle. O(width * height).
 * Feather inward only: holes and every unselected pixel remain untouched.
 */
function inwardFeather(mask: Buffer, width: number, height: number) {
  const distance = new Uint16Array(width * height);
  const far = Math.min(65_534, width + height);
  let protectedPixels = 0;
  for (let i = 0; i < distance.length; i++) {
    distance[i] = mask[i * 4 + 3] === 255 ? 0 : far;
    if (!distance[i]) protectedPixels++;
  }
  if (!protectedPixels) return null; // Whole-image edit has no internal seam.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x) distance[i] = Math.min(distance[i], distance[i - 1] + 1);
    if (y) distance[i] = Math.min(distance[i], distance[i - width] + 1);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (x + 1 < width) distance[i] = Math.min(distance[i], distance[i + 1] + 1);
    if (y + 1 < height) distance[i] = Math.min(distance[i], distance[i + width] + 1);
  }
  // Choose a band per connected region, so a small island beside a large
  // selection does not disappear. Typed buffers keep work and memory bounded.
  const radii = new Uint8Array(distance.length);
  const queue = new Uint32Array(distance.length - protectedPixels);
  for (let start = 0; start < distance.length; start++) {
    if (!distance[start] || radii[start]) continue;
    let end = 1, depth = 0;
    queue[0] = start;
    radii[start] = 255;
    const visit = (i: number) => {
      if (!distance[i] || radii[i]) return;
      radii[i] = 255;
      queue[end++] = i;
    };
    for (let head = 0; head < end; head++) {
      const i = queue[head];
      depth = Math.max(depth, distance[i]);
      if (i % width) visit(i - 1);
      if (i % width + 1 < width) visit(i + 1);
      if (i >= width) visit(i - width);
      if (i + width < distance.length) visit(i + width);
    }
    const radius = Math.max(1, Math.min(64, Math.floor(depth * 0.65)));
    for (let head = 0; head < end; head++) radii[queue[head]] = radius;
  }
  return { distance, radii };
}

/** One authoritative mask path for native-mask and reference-image providers. */
export async function prepareImageSelection(image: Buffer, mask: Buffer, blend: "strict" | "natural" = "strict") {
  const sharp = await imageProcessor();
  const source = await rgba(image, "Source image");
  const selection = await rgba(mask, "Selection mask");
  const { width, height } = source.info;
  if (selection.info.width !== width || selection.info.height !== height) {
    throw new ApiError(400, "invalid_mask", "Selection mask dimensions must match the source image");
  }
  const guide = Buffer.alloc(width * height * 4);
  let selected = false;
  for (let offset = 0; offset < guide.length; offset += 4) {
    const weight = 255 - selection.data[offset + 3];
    selected ||= weight > 0;
    guide[offset] = guide[offset + 1] = guide[offset + 2] = weight;
    guide[offset + 3] = 255;
  }
  if (!selected) throw new ApiError(400, "empty_selection", "Select an image region before editing");
  const feather = blend === "natural" ? inwardFeather(selection.data, width, height) : null;
  const raw = { width, height, channels: 4 as const };
  return {
    image: await sharp(source.data, { raw }).png().toBuffer(),
    mask: await sharp(selection.data, { raw }).png().toBuffer(),
    guide: await sharp(guide, { raw }).png().toBuffer(),
    async composite(generated: Buffer): Promise<Buffer> {
      const decoded = await rgba(generated, "Generated image");
      const edited = decoded.info.width === width && decoded.info.height === height
        ? decoded.data
        : await sharp(decoded.data, { raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 } })
          .resize(width, height, { fit: "fill" }).raw().toBuffer();
      const output = Buffer.from(source.data);
      for (let offset = 0; offset < output.length; offset += 4) {
        let weight = (255 - selection.data[offset + 3]) / 255;
        const radius = feather?.radii[offset / 4] ?? 0;
        if (weight && feather && radius >= 2) {
          const t = Math.max(0, Math.min(1, (feather.distance[offset / 4] - 1) / radius));
          weight = Math.min(weight, t * t * (3 - 2 * t));
        }
        if (!weight) continue; // Preserve every unselected RGBA byte exactly.
        const sourceAlpha = source.data[offset + 3] / 255;
        const editedAlpha = edited[offset + 3] / 255;
        const alpha = sourceAlpha * (1 - weight) + editedAlpha * weight;
        for (let channel = 0; channel < 3; channel++) {
          output[offset + channel] = alpha
            ? Math.round((source.data[offset + channel] * sourceAlpha * (1 - weight) + edited[offset + channel] * editedAlpha * weight) / alpha)
            : edited[offset + channel];
        }
        output[offset + 3] = Math.round(alpha * 255);
      }
      return sharp(output, { raw }).png().toBuffer();
    },
  };
}
