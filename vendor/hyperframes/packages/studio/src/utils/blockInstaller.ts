import type {
  BlockParam,
  RegistryItem,
  RegistryVariable,
  RegistryVisualComponent,
} from "@hyperframes/core/registry";
import type { TimelineElement } from "../player";
import {
  insertTimelineAssetIntoSource,
  resolveTimelineAssetCompositionSize,
} from "./timelineAssetDrop";
import { collectHtmlIds } from "./studioHelpers";
import { generateId } from "./generateId";
import { formatTimelineAttributeNumber } from "../player/components/timelineEditing";
import { saveProjectFilesWithHistory } from "./studioFileHistory";
import type { EditHistoryKind } from "./editHistory";
import { extendRootDurationInSource } from "./rootDuration";
import { readRootCompositionDuration } from "./rootDuration";
import { trackStudioEvent } from "./studioTelemetry";
import { readAttributeByTarget } from "./sourcePatcher";

export type BlockVariableValue = string | number | boolean;

export interface InstalledComponentParams {
  blockTitle: string;
  params: BlockParam[];
  variables: RegistryVariable[];
  variableValues: Record<string, BlockVariableValue>;
  visualComponent?: RegistryVisualComponent;
  hostCompositionPath: string;
  insertedElementId: string;
  returnTab: "components";
}

interface AddBlockOptions {
  projectId: string;
  blockName: string;
  activeCompPath: string | null;
  placement?: { start: number; track: number };
  visualPosition?: { left: number; top: number };
  currentTime?: number;
  timelineElements: TimelineElement[];
  readProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (entry: {
    label: string;
    kind: EditHistoryKind;
    coalesceKey?: string;
    files: Record<string, { before: string; after: string }>;
  }) => Promise<void>;
  markStudioWrite: () => void;
  refreshFileTree: () => Promise<void>;
  reloadPreview: () => void;
  showToast: (msg: string) => void;
}

function buildUniqueCompositionId(baseName: string, existingIds: Iterable<string>): string {
  const idSet = new Set(existingIds);
  if (!idSet.has(baseName)) return baseName;
  let i = 2;
  while (idSet.has(`${baseName}_${i}`)) i++;
  return `${baseName}_${i}`;
}

const DOCUMENT_BACKGROUND_RULE_RE =
  /(\b(?:html|body|:root)\b(?:\s*,\s*\b(?:html|body|:root)\b)*\s*\{)([^{}]*)(\})/gim;

function makeComponentDocumentBackgroundTransparent(source: string): string {
  return source.replace(
    DOCUMENT_BACKGROUND_RULE_RE,
    (_match, open: string, body: string, close: string) => {
      const transparentBody = body.replace(
        /\bbackground(?:-color)?\s*:\s*[^;]+;/gi,
        "background: transparent;",
      );
      return `${open}${transparentBody}${close}`;
    },
  );
}

export function normalizeBlockVariableValue(
  variable: RegistryVariable,
  value: BlockVariableValue,
): BlockVariableValue {
  if (variable.type === "number") {
    const parsed = typeof value === "number" ? value : Number(value);
    const finite = Number.isFinite(parsed) ? parsed : variable.default;
    return Math.min(variable.max ?? finite, Math.max(variable.min ?? finite, finite));
  }
  if (variable.type === "boolean") {
    return typeof value === "boolean" ? value : variable.default;
  }
  if (variable.type === "enum") {
    return typeof value === "string" && variable.options.some((option) => option.value === value)
      ? value
      : variable.default;
  }
  if (typeof value !== "string") return variable.default;
  if (variable.type === "color" && !/^#[0-9a-f]{6}$/i.test(value)) return variable.default;
  return variable.type === "string" && variable.maxLength
    ? value.slice(0, variable.maxLength)
    : value;
}

function normalizeRegistryPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function readComponentVariableValues(
  hostSource: string,
  insertedElementId: string,
  variables: RegistryVariable[],
): Record<string, BlockVariableValue> {
  const raw = readAttributeByTarget(hostSource, { id: insertedElementId }, "variable-values");
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const values: Record<string, BlockVariableValue> = {};
  for (const variable of variables) {
    const value: unknown = Reflect.get(parsed, variable.id);
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      continue;
    }
    values[variable.id] = normalizeBlockVariableValue(variable, value);
  }
  return values;
}

export function resolveInstalledComponentParams(input: {
  catalog: RegistryItem[];
  element: TimelineElement;
  hostCompositionPath: string;
  hostSource: string;
}): InstalledComponentParams | null {
  if (!input.element.compositionSrc) return null;
  const compositionSrc = normalizeRegistryPath(input.element.compositionSrc);
  const block = input.catalog.find(
    (item) =>
      item.visualComponent &&
      item.files.some((file) => normalizeRegistryPath(file.target) === compositionSrc),
  );
  if (!block) return null;

  const params = block.type === "hyperframes:block" ? (block.params ?? []) : [];
  const variables = block.variables ?? [];
  if (!params.length && !variables.length) return null;
  const insertedElementId = input.element.domId ?? input.element.id;

  return {
    blockTitle: block.title,
    params,
    variables,
    variableValues: readComponentVariableValues(input.hostSource, insertedElementId, variables),
    visualComponent: block.visualComponent,
    hostCompositionPath: input.hostCompositionPath,
    insertedElementId,
    returnTab: "components",
  };
}

export function injectRegistryVariableDeclarations(
  source: string,
  variables: RegistryVariable[],
): string {
  if (!variables.length || /\bdata-composition-variables\s*=/.test(source)) return source;

  const declarations = variables.map(({ update: _update, ...declaration }) => declaration);
  const serialized = JSON.stringify(declarations)
    .replaceAll("&", "&amp;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");

  return source.replace(/<html(?=[\s>])[^>]*>/i, (openTag) =>
    openTag.replace(/>$/, ` data-composition-variables='${serialized}'>`),
  );
}

export async function addBlockToProject(opts: AddBlockOptions): Promise<{
  block: RegistryItem;
  compositionPath: string;
  hostCompositionPath: string;
  insertedStart: number;
  insertedElementId: string;
} | null> {
  const startedAt = performance.now();
  let registryInstallMs = 0;
  let hostPatchMs = 0;
  let persistMs = 0;
  const {
    projectId,
    blockName,
    activeCompPath,
    placement,
    visualPosition,
    timelineElements,
    readProjectFile,
    writeProjectFile,
    recordEdit,
    markStudioWrite,
    refreshFileTree,
    reloadPreview,
    showToast,
  } = opts;

  try {
    // Installing a registry item writes its composition file before the host
    // composition is patched. Mark both phases as one Studio-owned mutation so
    // the file watcher does not start a stale intermediate preview reload.
    markStudioWrite();
    const registryInstallStartedAt = performance.now();
    const res = await fetch(`/api/projects/${projectId}/registry/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockName }),
    });
    registryInstallMs = performance.now() - registryInstallStartedAt;

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Install failed" }));
      showToast((err as { error?: string }).error || "Failed to install block");
      return null;
    }

    const { written, block } = (await res.json()) as {
      written: string[];
      block: RegistryItem;
    };

    const compositionFile = written.find((f) => f.endsWith(".html")) ?? written[0];
    if (!compositionFile) {
      showToast("Installed but no composition file was written");
      return null;
    }

    if (block.visualComponent) {
      const compContent = await readProjectFile(compositionFile);
      const declaredContent = injectRegistryVariableDeclarations(
        compContent,
        block.variables ?? [],
      );
      const normalizedContent = makeComponentDocumentBackgroundTransparent(declaredContent);
      if (normalizedContent !== compContent) {
        await writeProjectFile(compositionFile, normalizedContent);
      }
    }

    let insertedStart = opts.currentTime ?? 0;
    let insertedElementId = block.name;
    {
      const hostPatchStartedAt = performance.now();
      const targetPath = activeCompPath || "index.html";
      const originalContent = await readProjectFile(targetPath);
      const existingIds = collectHtmlIds(originalContent);
      const compId = buildUniqueCompositionId(block.name, existingIds);
      insertedElementId = compId;

      const resolvedTargetPath = targetPath || "index.html";
      const relevantElements = timelineElements.filter(
        (te) => (te.sourceFile || activeCompPath || "index.html") === resolvedTargetPath,
      );

      const { width: hostWidth, height: hostHeight } =
        resolveTimelineAssetCompositionSize(originalContent);
      const hostDims = { left: 0, top: 0, width: hostWidth, height: hostHeight };

      const currentTime = opts.currentTime ?? 0;
      const blockDuration =
        "duration" in block ? (block as { duration: number }).duration : undefined;
      const duration =
        blockDuration ??
        relevantElements.reduce(
          (max, te) => Math.max(max, (te.start ?? 0) + (te.duration ?? 0)),
          10,
        );
      const rootDuration = readRootCompositionDuration(originalContent) ?? 0;
      const start = Number(
        formatTimelineAttributeNumber(placement?.start ?? Math.max(0, currentTime)),
      );
      insertedStart = start;
      const track =
        placement?.track ??
        (relevantElements.length > 0 ? Math.max(...relevantElements.map((te) => te.track)) + 1 : 1);

      // Timeline discovery already resolves authored and computed z-indexes.
      // Reusing that snapshot avoids a synchronous getComputedStyle() walk over
      // every node in the preview iframe, which can force a full style/layout
      // flush while the editor and catalog previews are busy.
      const zIndex =
        relevantElements.reduce((highest, element) => Math.max(highest, element.zIndex ?? 0), 0) +
        1;

      const geometry = hostDims;
      const width = geometry.width;
      const height = geometry.height;

      const left = visualPosition ? Math.round(visualPosition.left) : geometry.left;
      const top = visualPosition ? Math.round(visualPosition.top) : geometry.top;

      const subCompHtml = [
        `<div`,
        // A stable id (+ hf-id) is what authored sub-comps carry; without it the
        // timeline can't dedup the host and renders duplicate clips that multiply
        // on every interaction. Matches the authored-comp shape.
        `  id="${compId}"`,
        `  data-hf-id="hf-${generateId()}"`,
        `  data-composition-id="${compId}"`,
        `  data-composition-src="${compositionFile}"`,
        `  data-start="${formatTimelineAttributeNumber(start)}"`,
        `  data-duration="${formatTimelineAttributeNumber(duration)}"`,
        `  data-track-index="${track}"`,
        `  data-width="${width}"`,
        `  data-height="${height}"`,
        `  style="position: absolute; left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px; z-index: ${zIndex}"`,
        `></div>`,
      ].join("\n");

      let patchedContent = insertTimelineAssetIntoSource(originalContent, subCompHtml);
      const originalContentEnd = relevantElements.reduce(
        (end, element) => Math.max(end, element.start + element.duration),
        rootDuration,
      );
      patchedContent = extendRootDurationInSource(
        patchedContent,
        Math.max(start + duration, originalContentEnd),
      );
      hostPatchMs = performance.now() - hostPatchStartedAt;

      markStudioWrite();
      const persistStartedAt = performance.now();
      await saveProjectFilesWithHistory({
        projectId,
        label: `Add component: ${block.title}`,
        kind: "timeline",
        files: { [targetPath]: patchedContent },
        readFile: async () => originalContent,
        writeFile: writeProjectFile,
        recordEdit,
      });
      persistMs = performance.now() - persistStartedAt;
    }

    reloadPreview();
    // The watcher also refreshes the tree. Keep this explicit fallback for
    // environments where watching is unavailable, but do not hold insertion
    // completion or preview selection behind a full project-tree scan.
    void refreshFileTree().catch(() => {
      trackStudioEvent("block_install_file_tree_refresh_failed", {
        block_name: blockName,
      });
    });

    trackStudioEvent("block_install_timing", {
      block_name: blockName,
      registry_install_ms: Math.round(registryInstallMs),
      host_patch_ms: Math.round(hostPatchMs),
      persist_ms: Math.round(persistMs),
      total_ms: Math.round(performance.now() - startedAt),
      timeline_element_count: timelineElements.length,
    });

    return {
      block,
      compositionPath: compositionFile,
      hostCompositionPath: activeCompPath || "index.html",
      insertedStart,
      insertedElementId,
    };
  } catch (error) {
    trackStudioEvent("block_install_failed", {
      block_name: blockName,
      total_ms: Math.round(performance.now() - startedAt),
      error_message: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : "Failed to add block";
    showToast(message);
    return null;
  }
}
