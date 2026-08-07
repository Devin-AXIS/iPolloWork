import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePreviewAssetPayload } from "./usePreviewBlockDrop";
import { buildTimelineAssetInsertHtml, getTimelineAssetKind } from "../../utils/timelineAssetDrop";
import { resolveTimelineSelectionSeekTime } from "../../utils/studioHelpers";

describe("preview editing interactions", () => {
  it("selects canvas elements on one click and opens their inspector", () => {
    const source = readFileSync(
      new URL("../../hooks/usePreviewInteraction.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("applyDomSelection(resolvedSelection)");
    expect(source).toContain("applyDomSelection(nextSelection, { additive: true })");
    expect(source).not.toContain("DOUBLE_CLICK_MS");
    expect(source).not.toContain("isDoubleClick");
    expect(source).not.toContain("cycleRef");
    expect(source).not.toContain("resolveAllDomSelectionsFromPreviewPoint");
    expect(source).toContain("Every click resolves the deepest authored child");
    expect(source).not.toContain("exitPreviewFullscreenForInspector");
  });

  it("clears the active element when the user clicks blank preview canvas", () => {
    const source = readFileSync(
      new URL("../../hooks/usePreviewInteraction.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("if (!resolvedSelection)");
    expect(source).toContain("updateDomEditHoverSelection(null)");
    expect(source).toContain("applyDomSelection(null, { revealPanel: false })");
    expect(source).toContain("const resolvedSelection = nextSelection");
    expect(source).not.toContain("nextSelection ?? options?.hoverSelection");

    const selectionSource = readFileSync(
      new URL("../../hooks/useDomSelection.ts", import.meta.url),
      "utf8",
    );
    expect(selectionSource).toContain(
      "if (!additive) applyDomSelection(null, { revealPanel: false })",
    );
  });

  it("clears canvas and inspector selection when the user clicks an empty timeline lane", () => {
    const source = readFileSync(
      new URL("../../player/components/useTimelineRangeSelection.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("if (!marquee.active)");
    expect(source).toContain("store.setSelectedElementId(null)");
    expect(source).toContain("onSelectElement?.(null)");
  });

  it("keeps a timeline clip selected after its pointer-down and click sequence", () => {
    const source = readFileSync(
      new URL("../../player/components/TimelineLanes.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("setSelectedElementId(elementKey)");
    expect(source).toContain("onSelectElement?.(el)");
    expect(source).not.toContain("selectedElementId === elementKey && !hadMultiSelection");
    expect(source).not.toContain("onSelectElement?.(nextElement)");
  });

  it("keeps the selected element while the user interacts outside the preview surface", () => {
    const source = readFileSync(new URL("./PreviewPane.tsx", import.meta.url), "utf8");

    expect(source).not.toContain('document.addEventListener("pointerdown"');
    expect(source).not.toContain("clearSelectedElement");
    expect(source).not.toContain("ipollowork:video-studio-clear-selection");
  });

  it("accepts project assets and animations on the video preview", () => {
    const previewDropSource = readFileSync(
      new URL("./usePreviewBlockDrop.ts", import.meta.url),
      "utf8",
    );
    const editorShellSource = readFileSync(new URL("../EditorShell.tsx", import.meta.url), "utf8");
    const assetCardSource = readFileSync(
      new URL("../sidebar/AssetCard.tsx", import.meta.url),
      "utf8",
    );
    const catalogSource = readFileSync(
      new URL("../sidebar/BlocksTab.tsx", import.meta.url),
      "utf8",
    );
    const previewOverlaySource = readFileSync(
      new URL("./PreviewOverlays.tsx", import.meta.url),
      "utf8",
    );

    expect(parsePreviewAssetPayload('{"path":"assets/cover.png"}')).toBe("assets/cover.png");
    expect(parsePreviewAssetPayload('{"path":42}')).toBeNull();
    expect(parsePreviewAssetPayload("not-json")).toBeNull();
    expect(previewDropSource).toContain("TIMELINE_ASSET_MIME");
    expect(previewDropSource).toContain("TIMELINE_BLOCK_MIME");
    expect(previewDropSource).toContain("onAssetDrop(assetPath)");
    expect(previewDropSource).toContain("onBlockDrop(block.name");
    expect(editorShellSource).toContain("useAddAssetAtPlayhead(onAssetDrop)");
    expect(editorShellSource).toContain("onPreviewAssetDrop={handlePreviewAssetDrop}");
    expect(editorShellSource).toContain("onPreviewBlockDrop={onPreviewBlockDrop}");
    expect(assetCardSource).toContain("setData(TIMELINE_ASSET_MIME");
    expect(assetCardSource).toContain("HtmlIllustrationPreview");
    expect(catalogSource).toContain("setData(TIMELINE_BLOCK_MIME");
    expect(previewOverlaySource).toContain(
      "const showComposition = Boolean(blockPreview.compositionUrl)",
    );
    expect(previewOverlaySource.indexOf("showComposition ? (")).toBeLessThan(
      previewOverlaySource.indexOf("showVideo ? ("),
    );
  });

  it("reveals only selections that are visible at the paused playhead", () => {
    const sessionSource = readFileSync(
      new URL("../../hooks/useDomEditSession.ts", import.meta.url),
      "utf8",
    );
    const layersSource = readFileSync(
      new URL("../editor/LayersPanel.tsx", import.meta.url),
      "utf8",
    );
    const revealSource = readFileSync(
      new URL("../editor/useLayerRevealOverride.ts", import.meta.url),
      "utf8",
    );

    expect(sessionSource).toContain("useTimelineSelectionPreviewSync({");
    expect(sessionSource).toContain("useLayerRevealOverride({");
    expect(sessionSource).toContain("currentTime,");
    expect(sessionSource).toContain("!isElementVisibleForOverlay(element)");
    expect(sessionSource).toContain("scheduleReveal(element, 0)");
    expect(revealSource).toContain("restore the runtime-authored visibility at the new");
    expect(revealSource).toContain("currentTime, restoreReveal");
    expect(layersSource).not.toContain("useLayerRevealOverride");
  });

  it("keeps off-frame timeline properties without drawing an invisible canvas selection", () => {
    const selectionSource = readFileSync(
      new URL("../../hooks/useDomSelection.ts", import.meta.url),
      "utf8",
    );
    const syncSource = readFileSync(
      new URL("../../hooks/useTimelineSelectionPreviewSync.ts", import.meta.url),
      "utf8",
    );

    const overlayRectsSource = readFileSync(
      new URL("../editor/useDomEditOverlayRects.ts", import.meta.url),
      "utf8",
    );
    expect(selectionSource).not.toContain("isElementComputedVisible(targetElement)");
    expect(selectionSource).not.toContain("playerState.requestSeek(inspectionTime)");
    expect(selectionSource).toContain("Property selection is independent from current-frame visibility");
    expect(selectionSource).toContain("applyDomSelection(selection)");
    expect(selectionSource).toContain("skipSourceProbe: true");
    expect(overlayRectsSource).toContain("isElementVisibleForOverlay(el)");
    expect(selectionSource).toContain("preserveTimelineSelection: true");
    expect(selectionSource).toContain("Generated compositions can contain detached nodes");
    expect(selectionSource).toContain("selection must remain usable");
    expect(syncSource).toContain("const visibleIds = resolved.map");
    expect(syncSource).toContain("preserveTimelineSelection: true");
    expect(syncSource).not.toContain("if (selections.length < resolvableCount) return");
  });

  it("resolves an explicit grouped timeline child instead of its wrapper", () => {
    const selectionSource = readFileSync(
      new URL("../../hooks/useDomSelection.ts", import.meta.url),
      "utf8",
    );
    expect(selectionSource).toContain(
      'targetElement.closest<HTMLElement>("[data-hf-group]")',
    );
    expect(selectionSource).toContain("activeGroupElement: owningGroup");
    expect(selectionSource).toContain(
      'const owningGroup = target.closest<HTMLElement>("[data-hf-group]")',
    );
  });

  it("uses the same resolved DOM host for timeline rows and their editable child trees", () => {
    const source = readFileSync(
      new URL("../../player/hooks/useTimelineSyncCallbacks.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const resolvedClipHosts = new Map<ClipManifestClip, Element>()");
    expect(source).toContain("findTimelineDomNodeForClip(iframeDoc, clip, index, usedHostElements)");
    expect(source).toContain("const hostEl = resolvedClipHosts.get(clip) ?? null");
    expect(source).not.toContain("const hostEl = iframeDoc.getElementById(clip.id)");
  });

  it("authors resizable geometry for visual assets dragged from the library", () => {
    const source = readFileSync(
      new URL("../../utils/timelineAssetDrop.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("width: ${geometry.width}px");
    expect(source).toContain("height: ${geometry.height}px");
    expect(source).toContain('id="${input.id}" data-hf-id="${input.hfId}"');
    expect(source).toContain('input.kind === "html"');
    expect(source).toContain("pointer-events: none; position: absolute");
    expect(getTimelineAssetKind("assets/video-illustrations/idea.html")).toBe("html");
    const htmlAsset = buildTimelineAssetInsertHtml({
      id: "idea",
      hfId: "hf-idea",
      assetPath: "assets/video-illustrations/idea.html",
      kind: "html",
      start: 0,
      duration: 5,
      track: 0,
      zIndex: 2,
      geometry: { left: 120, top: 80, width: 480, height: 270 },
    });
    expect(htmlAsset).toContain("<iframe");
    expect(htmlAsset).toContain("left: 120px");
    expect(htmlAsset).toContain("width: 480px");
    expect(htmlAsset).toContain('data-hf-lock-aspect-ratio="16:9"');
    expect(htmlAsset).toContain('data-hf-asset-kind="html"');
    expect(htmlAsset).toContain('width="1600" height="900"');
    expect(htmlAsset).toContain("new ResizeObserver(r)");
    expect(htmlAsset).toContain("p.clientWidth/1600");
  });

  it("uploads OS files dropped anywhere in the right-side assets area", () => {
    const assetsSource = readFileSync(new URL("../sidebar/AssetsTab.tsx", import.meta.url), "utf8");

    expect(assetsSource).toContain('e.dataTransfer.types.includes("Files")');
    expect(assetsSource).toContain("onImport?.(e.dataTransfer.files)");
    expect(assetsSource).toContain("Drop files to upload");
    expect(assetsSource).toContain('title={tx("Source selection is not available yet")}');
    expect(assetsSource).toContain("disabled");
    expect(assetsSource).toContain("Project 01");
    expect(assetsSource).toContain("bg-[#171816] text-[#ffffff]");
    expect(assetsSource).not.toContain("bg-[#2c2d2a] text-white");
    expect(assetsSource).toContain("flex h-full min-h-0 flex-1 flex-col overflow-hidden");
    expect(assetsSource).toContain('data-testid="assets-virtual-scroll"');
    expect(assetsSource).toContain('className="min-h-0 flex-1 overflow-y-auto overscroll-contain"');
    expect(assetsSource).toContain("new IntersectionObserver");
    expect(assetsSource).toContain("window.setInterval(refreshVisibleAssets, 2500)");
    expect(assetsSource).toContain("figmaAssetsImport.svg?url");
    expect(assetsSource).toContain("figmaAssetsSearch.svg?url");
    expect(assetsSource).toContain("<select");
    expect(assetsSource).toContain('className="flex h-[34px] w-auto flex-none');
    expect(assetsSource).toContain("new IntersectionObserver");
    expect(assetsSource).toContain("ASSET_VIRTUAL_OVERSCAN_PX");
    expect(assetsSource).toContain("visible ? (");
    expect(assetsSource).toContain("type MediaCategory, CATEGORY_LABELS, getCategory, FILTER_ORDER");
    expect(assetsSource).toContain("tx(CATEGORY_LABELS[cat])");
    expect(assetsSource).not.toContain("const categoryLabels:");
    expect(assetsSource).toContain("CaretDown");
    expect(assetsSource).not.toContain("timelineChevronDown.svg?url");
    expect(assetsSource).toContain("e.stopPropagation()");
    expect(assetsSource).not.toContain("grid-cols-[minmax(0,194px)_104px]");
  });

  it("keeps OS file uploads inside the assets panel without a global drag mask", () => {
    const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
    const overlaysSource = readFileSync(new URL("../StudioOverlays.tsx", import.meta.url), "utf8");
    const contextSource = readFileSync(
      new URL("../../hooks/useStudioContextValue.ts", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain("preventUnhandledFileDrop");
    expect(appSource).not.toContain("useGlobalFileDrop");
    expect(overlaysSource).not.toContain("StudioGlobalDragOverlay");
    expect(contextSource).not.toContain("useDragOverlay");
  });

  it("drives the floating toolbar from the selected DOM element", () => {
    const source = readFileSync(
      new URL("./PreviewTextSelectionToolbar.tsx", import.meta.url),
      "utf8",
    );
    const styleSource = readFileSync(new URL("../../styles/studio.css", import.meta.url), "utf8");

    expect(source).toContain("activeSelection?.element");
    expect(source).toContain("isTextLeafElement");
    expect(source).toContain("showTextControls");
    expect(source).toContain("!isElementVisibleForOverlay(element)");
    expect(source).toContain('aria-label={tx("Open Design properties")}');
    expect(source).toContain("applyDomSelection(activeSelection, { revealPanel: true })");
    expect(source).not.toContain('addEventListener("selectionchange"');
    expect(source).not.toContain("beginDragSelection");
    expect(source).not.toContain("TextSelectionDrag");
    expect(styleSource).toMatch(
      /\.hf-preview-text-toolbar__input\s*\{[\s\S]*?color:\s*#18181b;/,
    );
  });

  it("hides inline rich-text actions from the selected-element toolbar", () => {
    const source = readFileSync(
      new URL("./PreviewTextSelectionToolbar.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain('onClick={() => applyFormat("bold")}');
    expect(source).not.toContain('onClick={() => applyFormat("italic")}');
    expect(source).not.toContain('onClick={() => applyFormat("strike")}');
    expect(source).not.toContain('onClick={() => applyFormat("code")}');
    expect(source).not.toContain('onClick={() => applyFormat("link")}');
  });

  it("deletes the selected element directly from a destructive toolbar action", () => {
    const toolbarSource = readFileSync(
      new URL("./PreviewTextSelectionToolbar.tsx", import.meta.url),
      "utf8",
    );
    const styleSource = readFileSync(new URL("../../styles/studio.css", import.meta.url), "utf8");

    expect(toolbarSource).toContain("onClick={deleteSelectedElement}");
    expect(toolbarSource).toContain("hf-preview-text-toolbar__delete-button");
    expect(toolbarSource).not.toContain("deleteConfirmationOpen");
    expect(toolbarSource).not.toContain('role="alertdialog"');
    expect(styleSource).toContain(".hf-preview-text-toolbar__delete-button");
    expect(styleSource).toContain("color: #dc2626");
    expect(styleSource).not.toContain("hf-preview-text-toolbar__delete-confirmation");
  });

  it("keeps the element toolbar attached while the selected element is dragged", () => {
    const toolbarSource = readFileSync(
      new URL("./PreviewTextSelectionToolbar.tsx", import.meta.url),
      "utf8",
    );
    const chromeSource = readFileSync(
      new URL("../editor/DomEditSelectionChrome.tsx", import.meta.url),
      "utf8",
    );

    expect(toolbarSource).toContain("requestAnimationFrame(refreshPosition)");
    expect(toolbarSource).toContain("cancelAnimationFrame(frameId)");
    expect(chromeSource).toContain('touchAction: "none"');
    expect(chromeSource).toContain('userSelect: "none"');
    expect(chromeSource).toContain("if (e.button !== 0)");
  });
});
