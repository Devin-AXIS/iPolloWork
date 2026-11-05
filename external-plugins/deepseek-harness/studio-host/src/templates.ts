import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { resolve } from "node:path";
import {
  sortTemplatesForCatalog,
  templateManifestV1Schema,
  type TemplateCatalogItem,
  type TemplateManifestV1,
} from "../../../../packages/types/src/templates";
import { errorCode, inside, safeAssetPath, streamFile, StudioHttpError } from "./http";

export type BundledTemplate = {
  directory: string;
  manifest: TemplateManifestV1;
};

export async function loadBundledTemplates(
  templatesRoot: string,
  allows: (manifest: TemplateManifestV1) => boolean,
  limit = 100,
) {
  const templates: BundledTemplate[] = [];
  for (const name of await readdir(templatesRoot)) {
    if (templates.length >= limit) throw new StudioHttpError(500, "Template catalog exceeds its supported limit.");
    const directory = resolve(templatesRoot, name);
    const info = await stat(directory);
    if (!info.isDirectory()) continue;
    const parsed = templateManifestV1Schema.safeParse(JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8")));
    if (parsed.success && allows(parsed.data)) templates.push({ directory, manifest: parsed.data });
  }
  return templates;
}

export function templateCatalog(templates: readonly BundledTemplate[]): TemplateCatalogItem[] {
  const items = templates.map(({ manifest }): TemplateCatalogItem => ({
    manifest,
    sourceType: "bundled",
    installed: true,
    installedVersion: manifest.version,
    updateAvailable: false,
    verified: true,
  }));
  const byId = new Map(items.map((item) => [item.manifest.id, item]));
  return sortTemplatesForCatalog(items.map((item) => item.manifest))
    .map((manifest) => byId.get(manifest.id))
    .filter((item): item is TemplateCatalogItem => Boolean(item));
}

export function templateById(templates: readonly BundledTemplate[], templateId: string) {
  const template = templates.find((candidate) => candidate.manifest.id === templateId);
  if (!template) throw new StudioHttpError(404, "Template was not found in this Studio catalog.");
  return template;
}

export async function streamTemplateCover(res: ServerResponse, template: BundledTemplate) {
  const file = await realpath(resolve(template.directory, safeAssetPath(template.manifest.cover)));
  if (!inside(template.directory, file)) throw new StudioHttpError(403, "Template cover escaped its package.");
  const info = await stat(file);
  if (!info.isFile()) throw new StudioHttpError(404, "Template cover was not found.");
  streamFile(res, file, info, "public, max-age=86400");
}

export async function withOperationLock<Result>(
  operations: Map<string, Promise<void>>,
  key: string,
  operation: () => Promise<Result>,
) {
  const previous = operations.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const tail = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  const queued = previous.then(() => tail, () => tail);
  operations.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (operations.get(key) === queued) operations.delete(key);
  }
}

export async function applyBundledTemplate<Result>(input: {
  operations: Map<string, Promise<void>>;
  operationKey: string;
  template: BundledTemplate;
  projectsRoot: string;
  projectId: string;
  prepareStaged?: (directory: string) => Promise<void>;
  validateInstalled: () => Promise<Result>;
}) {
  const target = resolve(input.projectsRoot, input.projectId);
  if (!inside(input.projectsRoot, target)) throw new StudioHttpError(403, "Template target escaped the workspace.");
  const staged = resolve(input.projectsRoot, `.${input.projectId}.${randomUUID()}.staged`);
  const backup = resolve(input.projectsRoot, `.${input.projectId}.${randomUUID()}.replaced`);
  return withOperationLock(input.operations, input.operationKey, async () => {
    await mkdir(input.projectsRoot, { recursive: true });
    let movedCurrent = false;
    let installedNew = false;
    try {
      await cp(input.template.directory, staged, { recursive: true, errorOnExist: true });
      const stagedManifest = templateManifestV1Schema.parse(JSON.parse(await readFile(resolve(staged, "manifest.json"), "utf8")));
      if (
        stagedManifest.id !== input.template.manifest.id
        || stagedManifest.version !== input.template.manifest.version
      ) {
        throw new StudioHttpError(409, "Template changed while it was being applied.");
      }
      if (input.prepareStaged) await input.prepareStaged(staged);
      else await writeFile(resolve(staged, "brief.json"), "{}\n", "utf8");
      const current = await lstat(target).catch((error: unknown) => {
        if (errorCode(error) === "ENOENT") return null;
        throw error;
      });
      if (current) {
        if (!current.isDirectory() || current.isSymbolicLink()) {
          throw new StudioHttpError(409, "The current Studio project path is not replaceable.");
        }
        await rename(target, backup);
        movedCurrent = true;
      }
      await rename(staged, target);
      installedNew = true;
      const result = await input.validateInstalled();
      if (movedCurrent) await rm(backup, { recursive: true, force: true });
      return result;
    } catch (error) {
      await rm(staged, { recursive: true, force: true });
      if (installedNew) await rm(target, { recursive: true, force: true });
      if (movedCurrent) await rename(backup, target).catch(() => undefined);
      throw error;
    }
  });
}
