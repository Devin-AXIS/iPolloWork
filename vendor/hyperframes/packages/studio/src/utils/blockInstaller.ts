import type { RegistryItem } from "@hyperframes/core/registry";
import type { TimelineElement } from "../player";
import {
  fitTimelineAssetGeometry,
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
import { applyPatchByTarget } from "./sourcePatcher";
import { trackStudioEvent } from "./studioTelemetry";

export type EffectInsertIntent = "playhead" | "opening" | "ending" | "transition";

interface AddBlockOptions {
  projectId: string;
  blockName: string;
  activeCompPath: string | null;
  placement?: { start: number; track: number };
  visualPosition?: { left: number; top: number };
  currentTime?: number;
  effectIntent?: EffectInsertIntent;
  selectedElementId?: string | null;
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

interface EffectPlacement {
  start: number;
  track: number;
  shiftExistingBy: number;
}

function elementKey(element: TimelineElement): string {
  return element.key ?? element.id;
}

function rootTimelineElements(elements: TimelineElement[], targetPath: string): TimelineElement[] {
  return elements.filter(
    (element) =>
      (element.sourceFile || targetPath) === targetPath &&
      element.expandedParentStart == null &&
      Number.isFinite(element.start) &&
      Number.isFinite(element.duration) &&
      element.duration > 0,
  );
}

function uniqueSortedStarts(elements: TimelineElement[]): number[] {
  return [...new Set(elements.map((element) => Number(element.start.toFixed(4))))].sort(
    (a, b) => a - b,
  );
}

function buildElementPatchTarget(element: TimelineElement) {
  if (element.domId) {
    return {
      id: element.domId,
      hfId: element.hfId,
      selector: element.selector,
      selectorIndex: element.selectorIndex,
    };
  }
  if (element.hfId) {
    return {
      hfId: element.hfId,
      selector: element.selector,
      selectorIndex: element.selectorIndex,
    };
  }
  if (element.selector) {
    return { selector: element.selector, selectorIndex: element.selectorIndex };
  }
  if (/^[A-Za-z][\w:-]*$/.test(element.id)) return { id: element.id };
  return null;
}

export function resolveEffectPlacement(input: {
  intent: EffectInsertIntent;
  duration: number;
  currentTime: number;
  rootDuration: number;
  targetPath: string;
  timelineElements: TimelineElement[];
  selectedElementId?: string | null;
}): EffectPlacement | null {
  const elements = rootTimelineElements(input.timelineElements, input.targetPath);
  const highestTrack = elements.reduce(
    (highest, element) => Math.max(highest, element.authoredTrack ?? element.track),
    0,
  );
  const contentEnd = elements.reduce(
    (end, element) => Math.max(end, element.start + element.duration),
    input.rootDuration,
  );

  if (input.intent === "opening") {
    return { start: 0, track: 0, shiftExistingBy: input.duration };
  }
  if (input.intent === "ending") {
    return { start: contentEnd, track: 0, shiftExistingBy: 0 };
  }
  if (input.intent === "playhead") {
    return { start: Math.max(0, input.currentTime), track: highestTrack + 1, shiftExistingBy: 0 };
  }

  if (elements.length < 2) return null;
  const selected = input.selectedElementId
    ? elements.find((element) => elementKey(element) === input.selectedElementId)
    : undefined;
  const starts = uniqueSortedStarts(elements).filter((start) => start > 0.001);
  const selectedEnd = selected ? selected.start + selected.duration : undefined;
  const selectedNextStart = selected
    ? (starts.find((start) => start >= (selectedEnd ?? 0) - 0.05) ??
      starts.find((start) => start > selected.start + 0.001))
    : undefined;
  const boundary =
    selectedNextStart ??
    starts.reduce<number | undefined>((closest, start) => {
      if (closest == null) return start;
      return Math.abs(start - input.currentTime) < Math.abs(closest - input.currentTime)
        ? start
        : closest;
    }, undefined);
  if (boundary == null) return null;
  return {
    start: Math.max(0, boundary - input.duration / 2),
    track: highestTrack + 1,
    shiftExistingBy: 0,
  };
}

export function shiftTimelineContentInSource(
  source: string,
  elements: TimelineElement[],
  targetPath: string,
  amount: number,
): string {
  if (!(amount > 0)) return source;
  let patched = source;
  const visited = new Set<string>();
  for (const element of rootTimelineElements(elements, targetPath)) {
    const target = buildElementPatchTarget(element);
    if (!target) continue;
    const targetKey = JSON.stringify(target);
    if (visited.has(targetKey)) continue;
    visited.add(targetKey);
    patched = applyPatchByTarget(patched, target, {
      type: "attribute",
      property: "start",
      value: formatTimelineAttributeNumber(element.start + amount),
    });
    if (element.timingSource === "implicit") {
      patched = applyPatchByTarget(patched, target, {
        type: "attribute",
        property: "duration",
        value: formatTimelineAttributeNumber(element.duration),
      });
      patched = applyPatchByTarget(patched, target, {
        type: "attribute",
        property: "hf-preserve-flow",
        value: "1",
      });
    }
  }
  return patched;
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

export async function addBlockToProject(opts: AddBlockOptions): Promise<{
  block: RegistryItem;
  compositionPath: string;
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

    if (block.type === "hyperframes:component") {
      const compContent = await readProjectFile(compositionFile);
      const transparentContent = makeComponentDocumentBackgroundTransparent(compContent);
      if (transparentContent !== compContent) {
        await writeProjectFile(compositionFile, transparentContent);
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

      const isBlock = block.type === "hyperframes:block";
      const isEndingEffect = isBlock && block.librarySection === "ending-effect";
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
      const effectPlacement = placement
        ? null
        : resolveEffectPlacement({
            intent: opts.effectIntent ?? "playhead",
            duration,
            currentTime,
            rootDuration,
            targetPath: resolvedTargetPath,
            timelineElements: relevantElements,
            selectedElementId: opts.selectedElementId,
          });
      if (!placement && !effectPlacement) {
        showToast(
          "Select a timeline clip that has another clip after it, then insert the transition",
        );
        return null;
      }
      const start = Number(
        formatTimelineAttributeNumber(placement?.start ?? effectPlacement?.start ?? currentTime),
      );
      insertedStart = start;
      const track =
        placement?.track ??
        effectPlacement?.track ??
        (isBlock
          ? 0
          : relevantElements.length > 0
            ? Math.max(...relevantElements.map((te) => te.track)) + 1
            : 1);

      // Timeline discovery already resolves authored and computed z-indexes.
      // Reusing that snapshot avoids a synchronous getComputedStyle() walk over
      // every node in the preview iframe, which can force a full style/layout
      // flush while the editor and catalog previews are busy.
      const zIndex =
        relevantElements.reduce((highest, element) => Math.max(highest, element.zIndex ?? 0), 0) +
        1;

      const geometry = isEndingEffect
        ? fitTimelineAssetGeometry(block.dimensions, hostDims)
        : hostDims;
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
        ...(isEndingEffect
          ? [`  data-hf-edit-as-unit=""`, `  data-hf-content-fit="contain"`]
          : []),
        `  style="position: absolute; left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px; z-index: ${zIndex}"`,
        `></div>`,
      ].join("\n");

      const shiftExistingBy = effectPlacement?.shiftExistingBy ?? 0;
      const shiftedContent = shiftTimelineContentInSource(
        originalContent,
        relevantElements,
        resolvedTargetPath,
        shiftExistingBy,
      );
      let patchedContent = insertTimelineAssetIntoSource(shiftedContent, subCompHtml);
      const originalContentEnd = relevantElements.reduce(
        (end, element) => Math.max(end, element.start + element.duration),
        rootDuration,
      );
      patchedContent = extendRootDurationInSource(
        patchedContent,
        Math.max(start + duration, originalContentEnd + shiftExistingBy),
      );
      hostPatchMs = performance.now() - hostPatchStartedAt;

      markStudioWrite();
      const persistStartedAt = performance.now();
      await saveProjectFilesWithHistory({
        projectId,
        label: `Add ${isBlock ? "block" : "component"}: ${block.title}`,
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
      effect_intent: opts.effectIntent ?? "playhead",
      registry_install_ms: Math.round(registryInstallMs),
      host_patch_ms: Math.round(hostPatchMs),
      persist_ms: Math.round(persistMs),
      total_ms: Math.round(performance.now() - startedAt),
      timeline_element_count: timelineElements.length,
    });

    return { block, compositionPath: compositionFile, insertedStart, insertedElementId };
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
