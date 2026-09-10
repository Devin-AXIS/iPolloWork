import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, extname, resolve, sep } from "node:path";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function field(input, key) {
  return text(Reflect.get(input, key));
}

function selectionBounds(input) {
  const value = Reflect.get(input, "selectionBounds");
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("selectionBounds must be an object");
  const left = Reflect.get(value, "left");
  const top = Reflect.get(value, "top");
  const right = Reflect.get(value, "right");
  const bottom = Reflect.get(value, "bottom");
  if (
    typeof left !== "number" || !Number.isFinite(left)
    || typeof top !== "number" || !Number.isFinite(top)
    || typeof right !== "number" || !Number.isFinite(right)
    || typeof bottom !== "number" || !Number.isFinite(bottom)
    || left < 0 || top < 0 || right > 1 || bottom > 1
    || left >= right || top >= bottom
  ) {
    throw new Error("selectionBounds must contain normalized left, top, right, and bottom values");
  }
  return { left, top, right, bottom };
}

function requiredField(input, key, maxLength) {
  const value = field(input, key);
  if (!value) throw new Error(`${key} is required`);
  if (value.length > maxLength) throw new Error(`${key} is too long`);
  return value;
}

function imageMimeType(path) {
  switch (extname(path).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    default: throw new Error("Only PNG, JPEG, WebP, and SVG images are supported");
  }
}

function safeWorkspaceFile(root, sourcePath) {
  const relativePath = sourcePath.trim().replaceAll("\\", "/");
  if (!relativePath || relativePath.startsWith("/") || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("sourcePath must be a safe path inside the active workspace");
  }
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, relativePath);
  if (!absolutePath.startsWith(`${absoluteRoot}${sep}`)) throw new Error("sourcePath must stay inside the active workspace");
  return { absolutePath, relativePath };
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "image";
}

function promptWithVariables(input) {
  const prompt = requiredField(input, "prompt", 8_000);
  const variables = [
    ["Style", field(input, "style")],
    ["Camera", field(input, "camera")],
    ["Lighting", field(input, "lighting")],
  ].filter((entry) => entry[1] && entry[1] !== "auto");
  return variables.length ? `${prompt}\n\n${variables.map(([label, value]) => `${label}: ${value}`).join(". ")}.` : prompt;
}

function hostResult(value) {
  if (!isRecord(value)) throw new Error("Image provider returned an invalid result");
  const result = Reflect.get(value, "result");
  if (!isRecord(result)) throw new Error("Image provider returned an invalid result");
  return result;
}

export default async function createImageStudioService(runtime) {
  const generationPath = sourcePath => resolve(runtime.storage.dataDir, `${createHash("sha256").update(sourcePath).digest("hex")}.generation.json`);
  async function loadImage(sourcePath) {
    const source = safeWorkspaceFile(runtime.workspace.root, sourcePath);
    const bytes = await readFile(source.absolutePath);
    if (!bytes.length || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Image is empty or too large");
    const mimeType = imageMimeType(source.relativePath);
    let generation = null;
    try {
      const metadataPath = generationPath(source.relativePath);
      if ((await stat(metadataPath)).size < 64000) {
        const record = JSON.parse(await readFile(metadataPath, "utf8"));
        if (isRecord(record) && typeof record.prompt === "string" && typeof record.model === "string" && record.revision === createHash("sha256").update(bytes).digest("hex")) generation = record;
      }
    } catch { /* Imported and older images may not have generation metadata. */ }
    return {
      generation,
      path: source.relativePath,
      name: basename(source.relativePath),
      mimeType,
      bytes: bytes.byteLength,
      revision: createHash("sha256").update(bytes).digest("hex"),
      dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    };
  }

  async function callProvider(reference, args) {
    const result = hostResult(await runtime.host.callAction(reference, args));
    const path = text(Reflect.get(result, "path"));
    if (!path) throw new Error("Image provider did not return a workspace path");
    const image = await loadImage(path);
    const generation = text(args.prompt) ? { revision: image.revision, model: text(result.model), prompt: text(args.prompt), createdAt: new Date().toISOString(), size: text(args.size), quality: text(args.quality), sourcePath: text(args.sourcePath) } : image.generation;
    if (generation) await writeFile(generationPath(image.path), JSON.stringify(generation), { flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
    return {
      ...result,
      ...image,
      generation,
      provider: text(Reflect.get(result, "provider")),
      model: text(Reflect.get(result, "model")),
    };
  }

  return {
    actions: {
      status: async () => {
        const result = hostResult(await runtime.host.callAction("openai-image-generation/status", {}));
        return {
          ...result,
          ready: Reflect.get(result, "configured") === true,
          pluginVersion: runtime.plugin.version,
        };
      },

      "load-image": async (input) => loadImage(requiredField(input, "sourcePath", 1_000)),
      "capture-selection": async (input) => hostResult(await runtime.host.callAction(
        "openai-image-generation/selection_capture",
        {
          sourcePath: requiredField(input, "sourcePath", 1_000),
          sourceDataUrl: requiredField(input, "sourceDataUrl", MAX_IMAGE_BYTES * 2),
          maskDataUrl: requiredField(input, "maskDataUrl", MAX_IMAGE_BYTES * 2),
        },
      )),

      "import-image": async (input) => {
        const dataUrl = requiredField(input, "dataUrl", MAX_IMAGE_BYTES * 2);
        const match = IMAGE_DATA_URL.exec(dataUrl);
        if (!match?.[1] || !match[2]) throw new Error("dataUrl must contain a PNG, JPEG, or WebP image");
        const bytes = Buffer.from(match[2], "base64");
        if (!bytes.length || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Image is empty or too large");
        const extension = match[1] === "image/jpeg" ? "jpg" : match[1].slice("image/".length);
        const filename = `${slug(requiredField(input, "filename", 180).replace(/\.[^.]+$/, ""))}-${Date.now()}.${extension}`;
        const target = safeWorkspaceFile(runtime.workspace.root, `artifacts/image-studio/${filename}`);
        await mkdir(dirname(target.absolutePath), { recursive: true });
        const temporary = `${target.absolutePath}.partial`;
        await writeFile(temporary, bytes);
        await rename(temporary, target.absolutePath);
        return loadImage(target.relativePath);
      },

      "generate-image": async (input) => callProvider(
        "openai-image-generation/image_generate",
        {
          prompt: promptWithVariables(input),
          model: field(input, "model") || undefined,
          filename: field(input, "filename") || undefined,
          quality: field(input, "quality") || "auto",
          size: field(input, "size") || "auto",
        },
      ),

      "edit-image": async (input) => callProvider(
        "openai-image-generation/image_edit",
        {
          sourcePath: requiredField(input, "sourcePath", 1_000),
          reviewResult: Reflect.get(input, "reviewResult"),
          sourceRevision: field(input, "sourceRevision") || undefined,
          prompt: promptWithVariables(input),
          model: field(input, "model") || undefined,
          maskDataUrl: field(input, "maskDataUrl") || undefined,
          selectionId: field(input, "selectionId") || undefined,
          selectionBlend: field(input, "selectionBlend") || undefined,
          selectionBounds: selectionBounds(input),
          filename: field(input, "filename") || undefined,
          quality: field(input, "quality") || "auto",
          size: field(input, "size") || "auto",
        },
      ),
      "save-edit": async (input) => callProvider("openai-image-generation/image_edit_save", {
        editId: requiredField(input, "editId", 36),
        mode: requiredField(input, "mode", 16),
      }),
    },
  };
}
