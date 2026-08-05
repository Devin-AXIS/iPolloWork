import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Studio right panel layout", () => {
  it("uses the compact Figma property-inspector control density", () => {
    const panel = readFileSync(new URL("./editor/PropertyPanelFlat.tsx", import.meta.url), "utf8");
    const header = readFileSync(
      new URL("./editor/PropertyPanelFlatHeader.tsx", import.meta.url),
      "utf8",
    );
    const primitives = readFileSync(
      new URL("./editor/propertyPanelFlatPrimitives.tsx", import.meta.url),
      "utf8",
    );
    const selects = readFileSync(
      new URL("./editor/propertyPanelFlatSelectRow.tsx", import.meta.url),
      "utf8",
    );
    const colors = readFileSync(
      new URL("./editor/propertyPanelColor.tsx", import.meta.url),
      "utf8",
    );

    expect(header).toContain("min-h-12");
    expect(primitives).toContain("flex h-9 w-full");
    expect(primitives).toContain("flex h-6 min-w-0");
    expect(primitives).toContain("shadow-[inset_2px_0_0_#20bbc0]");
    expect(selects).toContain("flex h-6 min-w-0");
    expect(colors).toContain("flex h-6 min-w-0");
    expect(panel).toContain('data-testid="figma-property-inspector"');
    expect(panel).toContain('data-preserve-studio-selection="true"');
    expect(panel).toContain('data-flat-inspector-surface="true"');
    expect(panel).toContain('data-flat-group-content="true"');
    expect(panel).toContain('data-flat-group={group.id}');
    expect(panel).not.toContain("min-h-0 flex-1 overflow-y-auto border-b");
  });

  it("combines layers and design while unifying animation and scene catalog tabs", () => {
    const source = readFileSync(new URL("./StudioRightPanel.tsx", import.meta.url), "utf8");

    expect(source).toContain('label={t("right.design")}');
    expect(source).toContain('label={t("right.catalog")}');
    expect(source).toContain('page="animation"');
    expect(source).not.toContain("<LayersPanel />");
    expect(source).not.toContain("useInspectorSplitResize");
    expect(source).not.toContain('aria-label={t("right.resizePanes")}');
    expect(source).toContain("{propertyPanel}");
    expect(source).not.toContain('label={t("right.effects")}');
    expect(source).not.toContain('page="scene"');
    expect(source).not.toContain("<PreviewFullscreenButton />");
    expect(source).not.toContain('label={t("right.layers")}');
    expect(source).not.toContain('label={t("right.slideshow")}');
    expect(source).not.toContain('label={t("right.variables")}');
  });

  it("uses property tabs and keeps export in its own drawer", () => {
    const translations = readFileSync(new URL("../i18n.tsx", import.meta.url), "utf8");
    const header = readFileSync(new URL("./StudioHeader.tsx", import.meta.url), "utf8");
    const panel = readFileSync(new URL("./StudioRightPanel.tsx", import.meta.url), "utf8");
    const tabButton = readFileSync(new URL("./PanelTabButton.tsx", import.meta.url), "utf8");
    const shell = readFileSync(new URL("./EditorShell.tsx", import.meta.url), "utf8");
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../styles/studio.css", import.meta.url), "utf8");

    expect(translations).toContain('"header.inspector": "Properties"');
    expect(translations).toContain('"header.inspector": "属性"');
    expect(translations).toContain('"right.renders": "Export"');
    expect(translations).toContain('"right.catalog": "Animation"');
    expect(translations).toContain('"right.catalog": "动画"');
    expect(panel).toContain('label={t("right.voice")}');
    expect(panel).toContain('label={t("right.style")}');
    expect(panel).toContain('label={t("right.assets")}');
    expect(panel).not.toContain('label={t("right.renders")}');
    expect(panel).not.toContain('label={t("right.effects")}');
    expect(panel).toContain('const exportDrawer = rightPanelTab === "renders"');
    expect(panel).toContain('rightPanelTab === "voice" || rightPanelTab === "style"');
    expect(panel).toContain("width: rightWidth");
    expect(panel).toContain("postHostPanel(rightPanelTab)");
    expect(panel).toContain('useEffect(() => () => closeHostPanel(), [closeHostPanel])');
    expect(tabButton).toContain('style={active ? { color: "#ffffff" } : undefined}');
    expect(tabButton).not.toContain("!text-white");
    expect(tabButton).toContain("text-current");
    expect(header).not.toContain('aria-disabled="true"');
    expect(header).toContain("onPreviewModeChange");
    expect(header).toContain("aria-selected={previewMode}");
    expect(app).toContain("previewOnly={previewMode}");
    expect(app).toContain("domEditSession.clearDomSelection()");
    expect(shell).toContain("previewOnly ? (");
    expect(shell).toContain("<PreviewPane editingEnabled={false} />");
    expect(shell).toContain("!previewOnly && <StudioFeedbackBar />");
    expect(header).toContain('import propertiesIconSrc from "../icons/studioHeaderProperties.svg?url"');
    expect(header).toContain('import exportIconSrc from "../icons/studioHeaderExport.svg?url"');
    expect(header).toContain("hover:border-[#62666e]");
    expect(header).toContain("active:bg-[#ededeb]");
    expect(header).toContain("hf-studio-header-export");
    expect(styles).toContain(".hf-studio-header-export {");
    expect(styles).toContain("color: #ffffff !important;");
    expect(header).not.toContain('t("header.undo")');
    expect(header).not.toContain('t("header.capture")');
    expect(header).not.toContain("studio-toggle-fullscreen");
  });

  it("uses the timeline gutter as the single layer hierarchy surface", () => {
    const layout = readFileSync(
      new URL("../player/components/timelineLayout.ts", import.meta.url),
      "utf8",
    );
    const layerHeader = readFileSync(
      new URL("../player/components/TimelineLayerHeader.tsx", import.meta.url),
      "utf8",
    );
    const toolbar = readFileSync(new URL("./TimelineToolbar.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../styles/studio.css", import.meta.url), "utf8");

    expect(layout).toContain("export const LAYER_HEADER_W = 255");
    expect(layout).toContain("export const TRACK_H = 47");
    expect(layout).toContain("export const RULER_H = 32");
    expect(layout).toContain("export const TRACKS_TOP_PAD = 0");
    expect(layerHeader).toContain("data-layer-depth={depth}");
    expect(layerHeader).toContain("depth * 19");
    expect(layerHeader).toContain("timelineChevronDown.svg?url");
    expect(layerHeader).toContain("figmaTimelineContainer.svg?url");
    expect(layerHeader).toContain("figmaTimelineImage.svg?url");
    expect(layerHeader).toContain("figmaTimelineEffect.svg?url");
    expect(layerHeader).toContain("figmaTimelineText.svg?url");
    expect(layerHeader).toContain("figmaTimelineLock.svg?url");
    expect(layerHeader).toContain("figmaTimelineEye.svg?url");
    expect(layerHeader).toContain("aria-expanded={expanded}");
    expect(layerHeader).toContain("onToggleExpanded(first)");
    expect(layerHeader).toContain("hf-timeline-layer-header__caret-spacer");
    expect(layerHeader.indexOf('className="hf-timeline-layer-header__caret"')).toBeLessThan(
      layerHeader.indexOf('className="hf-timeline-layer-header__select"'),
    );
    expect(layerHeader).not.toContain("<CaretDown");
    expect(layerHeader).not.toContain("<CaretRight");
    expect(layerHeader).toContain("hf-timeline-layer-header__status");
    expect(layerHeader).toContain("hf-timeline-layer-header__visibility");
    expect(layerHeader).toContain("hf-timeline-layer-header__reorder");
    expect(toolbar).toContain("hf-timeline-toolbar");
    expect(styles).toContain(".hf-timeline-layer-header.is-selected");
    expect(styles).toContain("background-color: #20bbc0 !important");
    expect(styles).toContain(".hf-timeline-ruler-label");
  });

  it("uses the Figma timeline toolbar as the single editing-control surface", () => {
    const toolbar = readFileSync(new URL("./TimelineToolbar.tsx", import.meta.url), "utf8");
    const snapToolbar = readFileSync(new URL("./editor/SnapToolbar.tsx", import.meta.url), "utf8");
    const shortcuts = readFileSync(
      new URL("../player/components/ShortcutsPanel.tsx", import.meta.url),
      "utf8",
    );
    const preview = readFileSync(new URL("./nle/NLEPreview.tsx", import.meta.url), "utf8");

    expect(toolbar).toContain('data-testid="figma-timeline-toolbar"');
    expect(toolbar).toContain('data-preserve-studio-selection="true"');
    expect(toolbar).toContain('aria-busy={pendingAction === "split"}');
    expect(toolbar).toContain('aria-busy={pendingAction === "keyframe"}');
    expect(toolbar).toContain('aria-busy={pendingAction === "delete"}');
    expect(toolbar).toContain('figmaToolbarUndo.svg?url');
    expect(toolbar).toContain('figmaToolbarRedo.svg?url');
    expect(toolbar).toContain('figmaToolbarFit.svg?url');
    expect(toolbar).toContain('data-testid="preview-fit-reset"');
    expect(toolbar).toContain('aria-busy={capturing}');
    expect(toolbar).toContain('animate-spin rounded-full');
    expect(toolbar).toContain('id={CANVAS_SNAP_TOOLBAR_SLOT_ID}');
    expect(toolbar).toContain('id={CANVAS_GRID_TOOLBAR_SLOT_ID}');
    expect(toolbar).toContain('id={SHORTCUTS_TOOLBAR_SLOT_ID}');
    expect(snapToolbar).toContain("createPortal(snapControls, toolbarSlots.snap)");
    expect(snapToolbar).toContain("createPortal(gridControl, toolbarSlots.grid)");
    expect(snapToolbar).not.toContain("Set motion destination");
    expect(shortcuts).toContain("createPortal(panel, toolbarSlot)");
    expect(preview).toContain('data-preview-zoom-controller="true"');
    expect(preview).toContain("PREVIEW_ZOOM_RESET_EVENT");
    expect(preview).not.toContain('data-testid="preview-reset-zoom"');
    const timeline = readFileSync(new URL("../player/components/Timeline.tsx", import.meta.url), "utf8");
    const overlays = readFileSync(
      new URL("../player/components/TimelineOverlays.tsx", import.meta.url),
      "utf8",
    );
    expect(timeline).not.toContain("clipContextMenu");
    expect(overlays).not.toContain("ClipContextMenu");
  });

  it("matches the Figma playback bar while preserving the existing controls", () => {
    const controls = readFileSync(
      new URL("../player/components/PlayerControls.tsx", import.meta.url),
      "utf8",
    );
    const speedMenu = readFileSync(
      new URL("../player/components/SpeedMenu.tsx", import.meta.url),
      "utf8",
    );

    expect(controls).toContain('data-testid="figma-player-controls"');
    expect(controls).toContain('figmaPlayerPlay.svg?url');
    expect(controls).toContain('figmaPlayerRepeat.svg?url');
    expect(controls).toContain('figmaPlayerVolume.svg?url');
    expect(controls).toContain('h-[52px]');
    expect(controls).toContain('bg-[#f5f6f9]');
    expect(controls).toContain('bg-[#20bbc0]');
    expect(controls).toContain('bg-[#858a94]');
    expect(controls.indexOf("<SpeedMenu")).toBeLessThan(controls.indexOf("<LoopButton"));
    expect(controls.indexOf("<LoopButton")).toBeLessThan(controls.indexOf("<MuteButton"));
    expect(controls).not.toContain("const FullscreenButton");
    expect(speedMenu).toContain('h-6 min-w-10');
    expect(speedMenu).toContain('whitespace-nowrap');
    expect(speedMenu).toContain('border-[#858a94]');
    expect(speedMenu).toContain('bg-[var(--hf-panel-bg)]');
    expect(speedMenu).toContain('bg-[var(--hf-panel-hover)]');
  });

  it("keeps search and category filters above one density-controlled scroll region", () => {
    const catalog = readFileSync(new URL("./sidebar/BlocksTab.tsx", import.meta.url), "utf8");
    const overlay = readFileSync(new URL("./nle/PreviewOverlays.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../styles/studio.css", import.meta.url), "utf8");

    expect(catalog).toContain("flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden");
    expect(catalog).toContain('data-testid="block-catalog-search"');
    expect(catalog).toContain("Search animation…");
    expect(catalog).toContain('aria-label={locale === "zh" ? "动画分类" : "Animation category"}');
    expect(catalog).toContain('locale === "zh" ? "全部动画" : "All animations"');
    expect(catalog).toContain('const ALL_SECTIONS_FILTER = "all" as const');
    expect(catalog).toContain("showSectionHeaders");
    expect(catalog).toContain("hf-block-catalog-scroll min-h-0 min-w-0 flex-1 overscroll-contain");
    expect(catalog).toContain("DEFAULT_CATALOG_COLUMN_COUNT: CatalogColumnCount = 2");
    expect(catalog).toContain('1: "grid-cols-1"');
    expect(catalog).toContain('4: "grid-cols-4"');
    expect(catalog).toContain("data-catalog-columns={columnCount}");
    expect(catalog).toContain('scrollRoot.addEventListener("wheel", handleWheel, { passive: false })');
    expect(catalog).toContain("new IntersectionObserver");
    expect(catalog).toContain('{ root: scrollRoot, rootMargin: "240px 0px", threshold: 0 }');
    expect(catalog).toContain("setTimeout(startPreview, 60)");
    expect(catalog).toContain("PREVIEW_CLEAR_DELAY_MS = 140");
    expect(catalog).toContain("onPreviewBlock={emitPreviewBlock}");
    expect(catalog).toContain("compositionUrl: compositionPlaybackUrl");
    expect(overlay).toContain("poster={blockPreview.posterUrl}");
    expect(overlay).toContain('preload="auto"');
    expect(overlay).toContain("onCanPlay={() => setVideoReady(true)}");
    expect(catalog).toContain("tabIndex={0}");
    expect(catalog).toContain('data-testid="block-catalog-card"');
    expect(catalog).toContain("collapsedSections");
    expect(catalog).toContain("CaretDown");
    expect(catalog).toContain("CaretRight");
    expect(catalog).toContain('weight="regular"');
    expect(catalog).toContain("FunnelSimple");
    expect(catalog).toContain("handleAdd();");
    expect(catalog).toContain('"Ask AI"');
    expect(catalog).not.toContain("grid-rows-[minmax(0,1fr)_minmax(0,1fr)]");
    expect(catalog).not.toContain("rounded-xl border border-neutral-800/80 bg-neutral-950/45");
    expect(styles).toContain(".hf-block-catalog-scroll {");
    expect(styles).toContain("overflow-y: scroll;");
    expect(styles).toContain("scrollbar-gutter: stable;");
    expect(styles).toContain("scrollbar-width: thin;");
    expect(styles).toContain(':root[data-ipollowork-theme="light"] .hf-block-catalog-scroll');
  });
});
