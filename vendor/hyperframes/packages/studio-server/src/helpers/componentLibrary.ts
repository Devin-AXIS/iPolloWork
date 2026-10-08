import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { BlockItem, RegistryVariable } from "@hyperframes/core/registry";
import { resolveVisualComponentCategory } from "@hyperframes/core/registry";

// Public disk contract, also read by iPolloWork's AI catalog. Each pack is an
// immutable, content-addressed registry root. A single rename publishes it.
export function componentLibraryRoot(): string {
  return resolve(process.env.HYPERFRAMES_COMPONENT_LIBRARY || join(homedir(), ".hyperframes", "component-library"));
}

export const COMPONENT_PACK_MAX_BYTES = 16 * 1024 * 1024;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
type ComponentPackEntry = { manifest: BlockItem; files: Record<string, string> };
export type ComponentPack = { format: "hyperframes:components"; version: 1; items: ComponentPackEntry[] };
export type LibraryComponent = { manifest: BlockItem; registryRoot: string };

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function fail(message: string): never { throw new Error(message); }
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function positive(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value > 0; }

export function safeComponentPath(root: string, path: string): string {
  if (!path || path.includes("\\") || !/^[a-zA-Z0-9._/-]+$/.test(path)
    || path.split("/").some(part => !part || part === "." || part === "..")) fail(`Unsafe component path: ${path}`);
  const target = resolve(root, path);
  if (!target.startsWith(resolve(root) + sep)) fail(`Unsafe component path: ${path}`);
  let parent = target;
  while (parent.startsWith(resolve(root) + sep)) {
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) fail(`Symbolic links are not allowed: ${path}`);
    parent = dirname(parent);
  }
  return target;
}

function isVariable(value: unknown): value is RegistryVariable {
  if (!object(value) || !text(value.id) || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value.id) || !text(value.label)) return false;
  if (value.description !== undefined && typeof value.description !== "string") return false;
  if (value.maxLength !== undefined && (!Number.isInteger(value.maxLength) || Number(value.maxLength) < 1)) return false;
  if (value.update !== undefined && !["live", "rebuild", "reload"].includes(String(value.update))) return false;
  if (value.type === "number") return typeof value.default === "number" && Number.isFinite(value.default)
    && [value.min, value.max, value.step].every(n => n === undefined || (typeof n === "number" && Number.isFinite(n)));
  if (value.type === "boolean") return typeof value.default === "boolean";
  if (typeof value.default !== "string") return false;
  if (value.type === "enum") return Array.isArray(value.options) && value.options.length > 0 && value.options.length <= 128
    && value.options.every(option => object(option) && text(option.value) && text(option.label))
    && value.options.some(option => object(option) && option.value === value.default);
  return ["string", "color", "image", "font"].includes(String(value.type));
}

function isManifest(value: unknown): value is BlockItem {
  if (!object(value) || value.type !== "hyperframes:block" || !text(value.name) || !NAME.test(value.name)
    || value.name.length > 80 || !text(value.title) || !text(value.description)) return false;
  if (!object(value.dimensions) || !positive(value.dimensions.width) || !positive(value.dimensions.height)
    || value.dimensions.width > 8192 || value.dimensions.height > 8192 || !positive(value.duration) || value.duration > 600) return false;
  if (value.preview !== undefined && (!object(value.preview) || [value.preview.poster, value.preview.video].some(item => item !== undefined && typeof item !== "string"))) return false;
  if (value.params !== undefined) return false; // Imported components use native variables only.
  const visual = value.visualComponent;
  if (!object(visual) || visual.version !== 1 || visual.themeMode !== "inherit"
    || !resolveVisualComponentCategory(visual.category) || !Array.isArray(visual.surfaces) || !visual.surfaces.includes("video")) return false;
  if (visual.ai !== undefined && (!object(visual.ai) || !Array.isArray(visual.ai.slots) || !visual.ai.slots.every(text))) return false;
  if (visual.data !== undefined) {
    const data = visual.data;
    if (!object(data) || data.version !== 1 || !text(data.rowId) || !["replace", "override"].includes(String(data.mode))
      || [data.minRows, data.maxRows].some(n => n !== undefined && (!Number.isInteger(n) || Number(n) < 0 || Number(n) > 1000))
      || (typeof data.minRows === "number" && typeof data.maxRows === "number" && data.minRows > data.maxRows)
      || !["category-value", "region-value", "point-value", "route-value", "series-value"].includes(String(data.kind))
      || !object(data.binding) || !text(data.binding.variable) || !["json", "key-value-list", "route-value-list", "label-detail-list"].includes(String(data.binding.encoding))
      || !Array.isArray(data.columns) || !data.columns.length || !data.columns.every(column => object(column) && text(column.id) && text(column.label)
        && (column.labelZh === undefined || typeof column.labelZh === "string")
        && (column.format === undefined || column.format === "image")
        && ["string", "number"].includes(String(column.type)) && ["id", "label", "value", "source", "target"].includes(String(column.role))
        && (column.options === undefined || (Array.isArray(column.options) && column.options.every(option => object(option) && text(option.value) && text(option.label)))))) return false;
  }
  if (!Array.isArray(value.files) || !value.files.length || value.files.length > 64
    || !value.files.every(file => object(file) && text(file.path) && text(file.target)
      && ["hyperframes:composition", "hyperframes:asset", "hyperframes:style", "hyperframes:timeline"].includes(String(file.type)))) return false;
  if (value.registryDependencies !== undefined && (!Array.isArray(value.registryDependencies) || value.registryDependencies.length)) return false;
  if (value.tags !== undefined && (!Array.isArray(value.tags) || !value.tags.every(text))) return false;
  return value.variables === undefined || (Array.isArray(value.variables) && value.variables.every(isVariable)
    && new Set(value.variables.map(variable => variable.id)).size === value.variables.length);
}

export function parseComponentPack(raw: unknown): ComponentPack {
  if (!object(raw) || raw.format !== "hyperframes:components" || raw.version !== 1 || !Array.isArray(raw.items)
    || raw.items.length < 1 || raw.items.length > 32) fail("Choose a HyperFrames component pack (.hfcomponent.json), not a standalone HTML page.");
  const names = new Set<string>();
  const items: ComponentPackEntry[] = raw.items.map(entry => {
    if (!object(entry) || !isManifest(entry.manifest) || !object(entry.files)) fail("Invalid component manifest, variables or theme contract.");
    const manifest = entry.manifest;
    if (names.has(manifest.name)) fail(`Duplicate component: ${manifest.name}`);
    names.add(manifest.name);
    const files: Record<string, string> = {};
    const targets = new Set<string>();
    for (const file of manifest.files) {
      safeComponentPath("/component", file.path);
      safeComponentPath("/project", file.target);
      if (!file.target.startsWith(`compositions/${manifest.name}/`) || targets.has(file.target)) fail(`Component files must have unique targets inside compositions/${manifest.name}/`);
      targets.add(file.target);
      const content = entry.files[file.path];
      if (typeof content !== "string" || !/\.(?:html|js|mjs|css|svg|json|txt)$/i.test(file.path)) fail(`Missing or unsupported component file: ${file.path}`);
      files[file.path] = content;
    }
    if (Object.keys(entry.files).length !== manifest.files.length) fail("Unlisted or duplicate component files.");
    const primary = manifest.files.find(file => file.type === "hyperframes:composition" && file.path.endsWith(".html"));
    if (!primary || !files[primary.path]?.includes(`data-composition-id="${manifest.name}"`)) fail("Component HTML must declare its native composition id.");
    return { manifest, files };
  });
  const pack: ComponentPack = { format: "hyperframes:components", version: 1, items };
  if (Buffer.byteLength(JSON.stringify(pack)) > COMPONENT_PACK_MAX_BYTES) fail("Component pack exceeds 16 MB.");
  return pack;
}

export function listLibraryComponents(root = componentLibraryRoot()): LibraryComponent[] {
  if (!existsSync(root)) return [];
  const items: LibraryComponent[] = [];
  for (const pack of readdirSync(root, { withFileTypes: true })) {
    if (!pack.isDirectory() || !/^[a-f0-9]{64}$/.test(pack.name)) continue;
    const registryRoot = join(root, pack.name);
    const blocks = join(registryRoot, "blocks");
    if (!existsSync(blocks) || lstatSync(blocks).isSymbolicLink()) continue;
    for (const entry of readdirSync(blocks, { withFileTypes: true })) {
      if (!entry.isDirectory() || !NAME.test(entry.name)) continue;
      try {
        const path = safeComponentPath(blocks, `${entry.name}/registry-item.json`);
        const manifest: unknown = JSON.parse(readFileSync(path, "utf8"));
        if (isManifest(manifest) && manifest.name === entry.name) items.push({ manifest, registryRoot });
      } catch { /* A broken optional package must not hide the rest of the library. */ }
    }
  }
  return items;
}

export function importComponentPack(pack: ComponentPack, builtInNames: string[], root = componentLibraryRoot()): BlockItem[] {
  const payload = JSON.stringify(pack);
  const hash = createHash("sha256").update(payload).digest("hex");
  const destination = join(root, hash);
  const collisions = new Set([...builtInNames, ...listLibraryComponents(root).filter(item => item.registryRoot !== destination).map(item => item.manifest.name)]);
  for (const { manifest } of pack.items) if (collisions.has(manifest.name)) fail(`Component already exists: ${manifest.name}. Rename the imported component; existing videos are preserved.`);
  if (existsSync(destination)) return pack.items.map(item => item.manifest);
  mkdirSync(root, { recursive: true });
  if (lstatSync(root).isSymbolicLink()) fail("Component library must not be a symbolic link.");
  const staging = mkdtempSync(join(root, ".import-"));
  try {
    for (const { manifest, files } of pack.items) {
      const itemRoot = join(staging, "blocks", manifest.name);
      mkdirSync(itemRoot, { recursive: true });
      for (const [path, content] of Object.entries(files)) {
        const target = safeComponentPath(itemRoot, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, { flag: "wx" });
      }
      writeFileSync(join(itemRoot, "registry-item.json"), JSON.stringify(manifest), { flag: "wx" });
    }
    // Atomic publication: readers never see half an imported pack.
    renameSync(staging, destination);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return pack.items.map(item => item.manifest);
}

export function installLibraryComponent(component: LibraryComponent, projectDir: string): string[] {
  const itemRoot = join(component.registryRoot, "blocks", component.manifest.name);
  const files = component.manifest.files.map(file => ({
    target: safeComponentPath(projectDir, file.target),
    content: readFileSync(safeComponentPath(itemRoot, file.path), "utf8"),
  }));
  // Never silently change the source of an existing instance.
  for (const file of files) if (file.target.endsWith(".html") && existsSync(file.target)
    && !readFileSync(file.target, "utf8").includes(`data-composition-id="${component.manifest.name}"`)) fail("This project already has a different file at the component path. It was preserved.");
  for (const file of files) if (!existsSync(file.target)) {
    mkdirSync(dirname(file.target), { recursive: true });
    writeFileSync(file.target, file.content, { flag: "wx" });
  }
  return files.map(file => file.target.slice(resolve(projectDir).length + 1));
}
