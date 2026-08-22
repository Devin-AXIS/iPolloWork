import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve, sep } from "node:path";

type ImageStudioRuntime = {
  plugin: Readonly<{ id: string; version: string }>;
  workspace: Readonly<{ root: string }>;
  host: Readonly<{
    callAction(reference: string, args: Record<string, unknown>): Promise<unknown>;
  }>;
};

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function field(input: Record<string, unknown>, key: string): string {
  return text(Reflect.get(input, key));
}

function selectionBounds(input: Record<string, unknown>): Record<string, number> | undefined {
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

function requiredField(input: Record<string, unknown>, key: string, maxLength: number): string {
  const value = field(input, key);
  if (!value) throw new Error(`${key} is required`);
  if (value.length > maxLength) throw new Error(`${key} is too long`);
  return value;
}

function imageMimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    default: throw new Error("Only PNG, JPEG, and WebP images are supported");
  }
}

function safeWorkspaceFile(root: string, sourcePath: string): { absolutePath: string; relativePath: string } {
  const relativePath = sourcePath.trim().replaceAll("\\", "/");
  if (!relativePath || relativePath.startsWith("/") || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("sourcePath must be a safe path inside the active workspace");
  }
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, relativePath);
  if (!absolutePath.startsWith(`${absoluteRoot}${sep}`)) throw new Error("sourcePath must stay inside the active workspace");
  return { absolutePath, relativePath };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "image";
}

function promptWithVariables(input: Record<string, unknown>): string {
  const prompt = requiredField(input, "prompt", 8_000);
  const variables = [
    ["Style", field(input, "style")],
    ["Camera", field(input, "camera")],
    ["Lighting", field(input, "lighting")],
  ].filter((entry) => entry[1] && entry[1] !== "auto");
  return variables.length ? `${prompt}\n\n${variables.map(([label, value]) => `${label}: ${value}`).join(". ")}.` : prompt;
}

function hostResult(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Image provider returned an invalid result");
  const result = Reflect.get(value, "result");
  if (!isRecord(result)) throw new Error("Image provider returned an invalid result");
  return result;
}

export default async function createImageStudioService(runtime: ImageStudioRuntime) {
  async function loadImage(sourcePath: string) {
    const source = safeWorkspaceFile(runtime.workspace.root, sourcePath);
    const bytes = await readFile(source.absolutePath);
    if (!bytes.length || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Image is empty or too large");
    const mimeType = imageMimeType(source.relativePath);
    return {
      path: source.relativePath,
      name: basename(source.relativePath),
      mimeType,
      bytes: bytes.byteLength,
      dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    };
  }

  async function callProvider(reference: string, args: Record<string, unknown>) {
    const result = hostResult(await runtime.host.callAction(reference, args));
    const path = text(Reflect.get(result, "path"));
    if (!path) throw new Error("Image provider did not return a workspace path");
    return {
      ...await loadImage(path),
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

      "load-image": async (input: Record<string, unknown>) => loadImage(requiredField(input, "sourcePath", 1_000)),

      "import-image": async (input: Record<string, unknown>) => {
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

      "generate-image": async (input: Record<string, unknown>) => callProvider(
        "openai-image-generation/image_generate",
        {
          prompt: promptWithVariables(input),
          model: field(input, "model") || undefined,
          filename: field(input, "filename") || undefined,
          quality: field(input, "quality") || "auto",
          size: field(input, "size") || "auto",
        },
      ),

      "edit-image": async (input: Record<string, unknown>) => callProvider(
        "openai-image-generation/image_edit",
        {
          sourcePath: requiredField(input, "sourcePath", 1_000),
          prompt: promptWithVariables(input),
          model: field(input, "model") || undefined,
          maskDataUrl: field(input, "maskDataUrl") || undefined,
          selectionBounds: selectionBounds(input),
          filename: field(input, "filename") || undefined,
          quality: field(input, "quality") || "auto",
          size: field(input, "size") || "auto",
        },
      ),
    },
  };
}
