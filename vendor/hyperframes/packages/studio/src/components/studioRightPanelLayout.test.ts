import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { flipScaleValue } from "./editor/propertyPanelFlatLayoutSection";

describe("Studio right panel layout", () => {
  it("offers six selectable HTML illustration capabilities", () => {
    const illustration = readFileSync(new URL("./sidebar/IllustrationTab.tsx", import.meta.url), "utf8");
    expect(illustration).toContain('id: "ian-xiaohei-illustrations"');
    expect(illustration).toContain('id: "html-infographic"');
    expect(illustration).toContain('id: "html-concept-explainer"');
    expect(illustration).toContain('id: "html-kinetic-typography"');
    expect(illustration).toContain('id: "html-svg-path"');
    expect(illustration).toContain('id: "html-3d-space"');
    expect(illustration).toContain("onChange={(event) =>");
    expect(illustration).not.toContain("disabled");
    expect(illustration).toContain("自包含 HTML 插画");
  });

  it("matches the Figma property-inspector group and timing states", () => {
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
    const studioStyles = readFileSync(new URL("../styles/studio.css", import.meta.url), "utf8");

    expect(header).toContain("min-h-[69px]");
    expect(header).toContain('aria-label={tx("Ask AI about selected element")}');
    expect(header).toContain("h-8 flex-shrink-0");
    expect(header).toContain("figmaAskAiSparkle.svg?url");
    expect(header).toContain("hf-property-ask-ai");
    expect(header).toContain("hf-property-ask-ai__label");
    expect(header).toContain("focus-visible:ring-[#54b2ff]/60");
    expect(primitives).toContain("flex h-12 w-full");
    expect(primitives).toContain('large ? "h-[34px] rounded-[6px] px-[10px]"');
    expect(primitives).toContain("px-[17px]");
    expect(primitives).toContain("text-[12px] font-medium text-[#2c2d2a]");
    expect(primitives).toContain("<ChevronRight size={16}");
    expect(primitives).toContain("<ChevronDown size={16}");
    expect(primitives).not.toContain("rotate-180 text-[#858a94]");
    expect(primitives).toContain("shadow-[inset_3px_0_0_#20bbc0]");
    expect(primitives).toContain("<ChevronDown size={16}");
    expect(selects).toContain('large ? "h-[34px] rounded-[6px] pl-2 pr-4"');
    expect(selects).toContain('role="listbox"');
    expect(selects).toContain("createPortal(");
    expect(colors).toContain("flex h-6 min-w-0");
    expect(studioStyles).toContain('.hf-text-icon-button[aria-pressed="true"]');
    expect(studioStyles).toContain("background-color: #171816 !important");
    expect(studioStyles).toContain("color: #ffffff !important");
    expect(studioStyles).toContain(
      ':root:not([data-ipollowork-theme="light"]) .hf-text-icon-button[aria-pressed="true"]',
    );
    expect(panel).toContain('data-testid="figma-property-inspector"');
    expect(panel).toContain('data-preserve-studio-selection="true"');
    expect(panel).toContain('data-flat-inspector-surface="true"');
    expect(panel).toContain('data-flat-group-content="true"');
    expect(panel).toContain("data-flat-group={group.id}");
    expect(panel).toContain("px-[17px] pb-[15px] pt-2");
    expect(panel).not.toContain('className="border-l-2 border-[#20bbc0] pl-2"');
    expect(panel).not.toContain("min-h-0 flex-1 overflow-y-auto border-b");

    const timing = readFileSync(
      new URL("./editor/propertyPanelFlatMotionSection.tsx", import.meta.url),
      "utf8",
    );
    expect(timing).toContain("flex h-[34px] min-w-0");
    expect(timing).toContain("rounded-[6px]");
    expect(timing).toContain("grid grid-cols-2 gap-2");
    expect(timing).toContain("text-[10px] font-normal text-[#878984]");
    expect(timing).toContain("text-[13px] font-normal text-[#242522]");
  });

  it("matches the expanded Figma Layout, Stroke, and Appearance controls", () => {
    const layout = readFileSync(
      new URL("./editor/propertyPanelFlatLayoutSection.tsx", import.meta.url),
      "utf8",
    );
    const styles = readFileSync(
      new URL("./editor/propertyPanelFlatStyleSections.tsx", import.meta.url),
      "utf8",
    );
    const colors = readFileSync(
      new URL("./editor/propertyPanelColor.tsx", import.meta.url),
      "utf8",
    );
    const keyframeDiamond = readFileSync(
      new URL("./editor/KeyframeDiamond.tsx", import.meta.url),
      "utf8",
    );
    const keyframeNavigation = readFileSync(
      new URL("./editor/KeyframeNavigation.tsx", import.meta.url),
      "utf8",
    );

    expect(layout).toContain('label={large ? "Rotation" : "Angle"}');
    expect(layout).toContain('className="hf-flat-responsive-grid grid grid-cols-2 gap-2"');
    expect(layout).toContain('className="grid h-[34px] grid-cols-3 gap-[5px]"');
    expect(layout).toContain("<RotateCw size={16}");
    expect(layout).toContain("<FlipHorizontal size={16}");
    expect(layout).toContain("<FlipVertical size={16}");
    expect(layout).toContain('aria-label="Flip horizontally"');
    expect(layout).toContain('aria-label="Flip vertically"');
    expect(layout).toContain('commitScaleFlip("scaleX")');
    expect(layout).toContain('commitScaleFlip("scaleY")');
    expect(layout).not.toContain("Flip horizontally (unavailable)");
    expect(layout).not.toContain("Flip vertically (unavailable)");
    expect(flipScaleValue(1)).toBe(-1);
    expect(flipScaleValue(-1.25)).toBe(1.25);
    expect(flipScaleValue(0)).toBe(-1);
    expect(flipScaleValue(undefined)).toBe(-1);
    expect(layout).not.toContain("style={{ opacity: hasKeyframesOnProp ? 1 : 0.3 }}");
    expect(keyframeDiamond).toContain('state === "active" ? "#3CE6AC" : "#858A94"');
    expect(keyframeDiamond).not.toContain("style={{ color, opacity }}");
    expect(keyframeNavigation.match(/stroke="#858A94"/g)).toHaveLength(2);

    expect(styles).toContain(
      'className="hf-flat-responsive-grid grid grid-cols-2 gap-x-3 gap-y-2"',
    );
    expect(styles).toContain('label="Width"');
    expect(styles).toContain('label="Radius"');
    expect(styles).toContain('label="Opacity"');
    expect(styles).toContain('label="Shadow"');
    expect(styles).toContain("SHADOW_INTENSITY");
    expect(colors).toContain('className="block size-5 rounded-[4px]');
    expect(colors).toContain('{ value: "hsb", label: "HSB" }');
    expect(colors).toContain('{ value: "rgb", label: "RGB" }');
    expect(colors).toContain('{ value: "hex", label: "HEX" }');
    expect(colors).toContain("toHexColor(draftColor).slice(1).toUpperCase()");
  });

  it("matches the expanded Figma Fill, Animation, Mask, and 3D Transform states", () => {
    const styles = readFileSync(
      new URL("./editor/propertyPanelFlatStyleSections.tsx", import.meta.url),
      "utf8",
    );
    const fill = readFileSync(new URL("./editor/propertyPanelFill.tsx", import.meta.url), "utf8");
    const mask = readFileSync(
      new URL("./editor/propertyPanelFlatMaskSection.tsx", import.meta.url),
      "utf8",
    );
    const animation = readFileSync(
      new URL("./editor/propertyPanelFlatMotionSection.tsx", import.meta.url),
      "utf8",
    );
    const transform = readFileSync(
      new URL("./editor/propertyPanel3dTransform.tsx", import.meta.url),
      "utf8",
    );

    expect(styles).toContain('key: "None"');
    expect(styles).toContain('label: "No fill"');
    expect(styles).toContain('key: "Gradient"');
    expect(styles).toContain('label: "Gradient"');
    expect(styles).toContain("grid grid-cols-4 gap-1");
    expect(styles).toContain("figmaFillNone.svg?url");
    expect(styles).toContain("figmaFillSolid.svg?url");
    expect(styles).toContain("figmaFillGradient.svg?url");
    expect(styles).toContain("figmaFillImage.svg?url");
    expect(styles).toContain("active ? activeIcon : icon");
    expect(styles).toContain("hover:bg-[#eceef2]");
    expect(styles).toContain("active:bg-[#e2e5ea]");
    expect(styles).toContain("disabled:opacity-40");
    expect(mask).toContain('label="Style"');
    expect(mask).toContain("figmaMaskInvert.svg?url");
    expect(mask).toContain('label="Rotation"');
    expect(mask).toContain('label="Feather"');
    expect(mask).toContain("buildMaskGeometry(");
    expect(fill).toContain('aria-label={tx("Close gradient editor")}');
    expect(fill).toContain('{ value: "hsb", label: "HSB" }');
    expect(fill).toContain('{ value: "rgb", label: "RGB" }');
    expect(fill).toContain('{ value: "hex", label: "HEX" }');
    expect(fill).toContain('aria-label={tx("Pick color from screen")}');
    expect(fill).toContain('className="grid grid-cols-6 gap-2"');
    expect(animation).toContain('aria-label={tx("Add animation")}');
    expect(animation).toContain("callbacks.onDeleteAnimation(animation.id)");
    expect(animation).toContain('kind === "position" ? "Start" : "Duration"');
    expect(transform).toContain("Drag to adjust the view");
    expect(transform).toContain('"Low Angle"');
    expect(transform).toContain("aria-expanded={presetOpen}");
    expect(transform).toContain('label: "Depth"');
    expect(transform).toContain('property: "z"');
    expect(transform).toContain('label: "Size"');
    expect(transform).toContain('property: "scale"');
  });

  it("keeps Layer controls aligned and makes dropdown hit areas reliable", () => {
    const primitives = readFileSync(
      new URL("./editor/propertyPanelFlatPrimitives.tsx", import.meta.url),
      "utf8",
    );
    const selects = readFileSync(
      new URL("./editor/propertyPanelFlatSelectRow.tsx", import.meta.url),
      "utf8",
    );
    const toggles = readFileSync(
      new URL("./editor/propertyPanelFlatToggle.tsx", import.meta.url),
      "utf8",
    );
    const fonts = readFileSync(new URL("./editor/propertyPanelFont.tsx", import.meta.url), "utf8");
    const textFields = readFileSync(
      new URL("./editor/propertyPanelSections.tsx", import.meta.url),
      "utf8",
    );
    const textSection = readFileSync(
      new URL("./editor/propertyPanelFlatTextSection.tsx", import.meta.url),
      "utf8",
    );

    expect(primitives).toContain("large = true");
    expect(primitives).toContain('className="text-[10px] font-normal text-[#858a94]"');
    expect(primitives).toContain("flex h-[34px] w-full");
    expect(selects).toContain("large = true");
    expect(selects).toContain("const selectedLabel");
    expect(selects).toContain('aria-haspopup="listbox"');
    expect(selects).toContain("hover:bg-[#f5f6f9]");
    expect(selects).not.toContain("appearance-none opacity-0");
    expect(toggles).toContain("flex h-[34px]");
    expect(fonts).toContain("relative flex h-[34px]");
    expect(textFields).toContain("min-h-[43px]");
    expect(textFields).toContain("border-[#99b8f2]");
    expect(textSection).toContain('data-flat-text-controls="true"');
    expect(textSection).toContain('aria-label="Text alignment"');
    expect(textSection).toContain('aria-label="List formatting"');
    expect(textSection).toContain('aria-label="Text formatting"');
    expect(textSection).toContain('<TextIconButton label="Bulleted list" disabled>');
    expect(textSection).toContain('"text-decoration-line"');
  });

  it("combines layers and design while unifying animation and scene catalog tabs", () => {
    const source = readFileSync(new URL("./StudioRightPanel.tsx", import.meta.url), "utf8");

    expect(source).toContain('label={t("right.design")}');
    expect(source).toContain('label={t("right.catalog")}');
    expect(source).toContain('page="animation"');
    expect(source).not.toContain("<LayersPanel />");
    expect(source).not.toContain("useInspectorSplitResize");
    expect(source).not.toContain('aria-label={t("right.resizePanes")}');
    expect(source).toContain("const propertyPanel = singleDomEditSelection ? (");
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
    expect(translations).toContain('"right.style": "主题"');
    expect(translations).not.toContain('"right.style": "风格"');
    expect(translations).toContain('"right.catalog": "动画"');
    expect(panel).toContain('label={t("right.voice")}');
    expect(panel).toContain('label={t("right.style")}');
    expect(panel).toContain('label={t("right.assets")}');
    expect(panel).toContain('label={t("right.illustration")}');
    expect(panel).toContain('tooltip={t("right.illustrationTooltip")}');
    expect(translations).toContain('"right.illustration": "Illustrations"');
    expect(translations).toContain('"right.illustration": "插画"');
    expect(panel).toContain('<IllustrationTab />');
    expect(panel).not.toContain('label={t("right.renders")}');
    expect(panel).not.toContain('label={t("right.effects")}');
    expect(panel).toContain('const exportDrawer = rightPanelTab === "renders"');
    expect(panel).toContain('rightPanelTab === "voice" || rightPanelTab === "style"');
    expect(panel).toContain("width: rightWidth");
    expect(panel).toContain("minWidth: MIN_RIGHT_PANEL_WIDTH");
    expect(panel).toContain("postHostPanel(rightPanelTab)");
    expect(panel).toContain("useEffect(() => () => closeHostPanel(), [closeHostPanel])");
    expect(tabButton).toContain('style={active ? { color: "#ffffff" } : undefined}');
    expect(tabButton).not.toContain("!text-white");
    expect(tabButton).toContain("text-current");
    expect(header).not.toContain('aria-disabled="true"');
    expect(header).toContain("onPreviewModeChange");
    expect(header).toContain("aria-selected={previewMode}");
    expect(app).toContain("previewOnly={previewMode}");
    expect(app).toContain("onToggleRecording: undefined");
    expect(app).toContain("const recordingToggle = undefined");
    expect(app).toContain("gestureOverlay={undefined}");
    expect(app).toContain("const StudioRightPanel = lazy(loadStudioRightPanel)");
    expect(app).toContain("window.requestIdleCallback");
    expect(app).toContain("module.preloadStudioPropertyPanel()");
    expect(shell).toContain("previewOnly ? (");
    expect(shell).toContain("<PreviewPane editingEnabled={false} />");
    expect(shell).toContain("!previewOnly && <StudioFeedbackBar />");
    expect(header).toContain(
      'import propertiesIconSrc from "../icons/studioHeaderProperties.svg?url"',
    );
    expect(header).toContain('import exportIconSrc from "../icons/studioHeaderExport.svg?url"');
    expect(header).toContain("hover:border-[var(--hf-panel-text-3)]");
    expect(header).toContain("hover:bg-[var(--hf-panel-hover)]");
    expect(header).toContain("hf-studio-header-export");
    expect(styles).toContain(".hf-studio-header-export {");
    expect(styles).toContain("color: #ffffff !important;");
    expect(styles).toContain("container-name: hf-flat-inspector");
    expect(styles).toContain("@container hf-flat-inspector (max-width: 340px)");
    expect(styles).toContain(".hf-flat-responsive-grid {");
    expect(styles).toContain(".hf-inspector-tabs-scroll {");
    expect(panel).toContain("hf-inspector-tabs-scroll");
    expect(panel).toContain("overflow-x-auto");
    expect(panel).toContain("absolute right-3 top-1/2");
    expect(panel).toContain("border-[0.5px] border-[var(--hf-studio-divider)]");
    expect(styles).toContain("--hf-studio-divider: rgba(255, 255, 255, 0.075)");
    expect(styles).toContain("--hf-studio-divider: #dfe3e8");
    expect(header).not.toContain('t("header.undo")');
    expect(header).not.toContain('t("header.capture")');
    expect(header).not.toContain("studio-toggle-fullscreen");
  });

  it("keeps the empty property inspector off playback hot paths", () => {
    const propertyPanel = readFileSync(
      new URL("./editor/PropertyPanel.tsx", import.meta.url),
      "utf8",
    );

    expect(propertyPanel).toContain("element ? s.currentTime : 0");
    expect(propertyPanel).toContain("element ? s.isPlaying : false");
    expect(propertyPanel).toContain("if (!isPlaying || !element) return;");
  });

  it("lazy mounts and destroys right-panel tab content", () => {
    const panel = readFileSync(new URL("./StudioRightPanel.tsx", import.meta.url), "utf8");

    expect(panel).toContain("const PropertyPanel = lazy(");
    expect(panel).toContain("export const preloadStudioPropertyPanel");
    expect(panel).toContain("const BlocksTab = lazy(");
    expect(panel).toContain("const AssetsTab = lazy(");
    expect(panel).toContain("const IllustrationTab = lazy(");
    expect(panel).toContain("<Suspense");
    expect(panel).toContain("key={rightPanelTab}");
    expect(panel).not.toContain('import { PropertyPanel } from "./editor/PropertyPanel"');
    expect(panel).not.toContain('import { BlocksTab,');
    expect(panel).toContain("const propertyPanel = singleDomEditSelection ? (");
    expect(panel).toContain("propertyPanelContent");
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
    const header = readFileSync(new URL("./StudioHeader.tsx", import.meta.url), "utf8");
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
    expect(toolbar).toContain("bg-[var(--hf-studio-toolbar-bg)]");
    expect(header).toContain("bg-[var(--hf-studio-header-bg)]");
    expect(styles).toContain(".hf-studio-properties-icon");
    expect(styles).toContain(".hf-timeline-toolbar-icon");
    expect(styles).toContain("--hf-timeline-clip-bg: #18181b");
    expect(styles).toContain("--hf-timeline-clip-bg: #f5f6f9");
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
    expect(toolbar).toContain("figmaToolbarUndo.svg?url");
    expect(toolbar).toContain("figmaToolbarRedo.svg?url");
    expect(toolbar).toContain("figmaToolbarFit.svg?url");
    expect(toolbar).toContain('data-testid="preview-fit-reset"');
    expect(toolbar).toContain("aria-busy={capturing}");
    expect(toolbar).toContain("animate-spin rounded-full");
    expect(toolbar).toContain("id={CANVAS_SNAP_TOOLBAR_SLOT_ID}");
    expect(toolbar).toContain("id={CANVAS_GRID_TOOLBAR_SLOT_ID}");
    expect(toolbar).toContain("id={SHORTCUTS_TOOLBAR_SLOT_ID}");
    expect(snapToolbar).toContain("createPortal(snapControls, toolbarSlots.snap)");
    expect(snapToolbar).toContain("createPortal(gridControl, toolbarSlots.grid)");
    expect(snapToolbar).not.toContain("Set motion destination");
    expect(shortcuts).toContain("createPortal(panel, toolbarSlot)");
    expect(preview).toContain('data-preview-zoom-controller="true"');
    expect(preview).toContain("PREVIEW_ZOOM_RESET_EVENT");
    expect(preview).not.toContain('data-testid="preview-reset-zoom"');
    const timeline = readFileSync(
      new URL("../player/components/Timeline.tsx", import.meta.url),
      "utf8",
    );
    const overlays = readFileSync(
      new URL("../player/components/TimelineOverlays.tsx", import.meta.url),
      "utf8",
    );
    expect(timeline).not.toContain("clipContextMenu");
    expect(overlays).not.toContain("ClipContextMenu");
  });

  it("keeps preview refresh loading local to the canvas", () => {
    const player = readFileSync(new URL("../player/components/Player.tsx", import.meta.url), "utf8");
    const preview = readFileSync(new URL("./nle/NLEPreview.tsx", import.meta.url), "utf8");
    const previewPane = readFileSync(new URL("./nle/PreviewPane.tsx", import.meta.url), "utf8");
    const nleContext = readFileSync(new URL("./nle/NLEContext.tsx", import.meta.url), "utf8");

    expect(player).toContain("const REFRESH_LOADING_OVERLAY_DELAY_MS = 220");
    expect(player).toContain("function shouldShowRefreshLoadingOverlay");
    expect(player).toContain("setCompositionLoading(true)");
    expect(player).toContain('data-testid="composition-refresh-loading-overlay"');
    expect(player).toContain("h-4 w-4 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-500");
    expect(player).toContain("Preparing preview…");
    expect(player).toContain("onCompositionLoadingChange?.(showCompositionOverlay || showAssetOverlay)");
    expect(player).not.toContain("onCompositionLoadingChange?.(showCompositionOverlay || showRefreshOverlay");
    expect(preview).toContain("refreshToken?: number");
    expect(preview).toContain("refreshToken={refreshToken}");
    expect(previewPane).toContain("refreshToken={refreshKey}");
    expect(nleContext).toContain("refreshKey?: number");
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
    expect(controls).toContain("figmaPlayerPlay.svg?url");
    expect(controls).toContain("figmaPlayerRepeat.svg?url");
    expect(controls).toContain("figmaPlayerVolume.svg?url");
    expect(controls).toContain("h-[52px]");
    expect(controls).toContain("bg-[#f5f6f9]");
    expect(controls).toContain("bg-[#20bbc0]");
    expect(controls).toContain("bg-[#858a94]");
    expect(controls.indexOf("<SpeedMenu")).toBeLessThan(controls.indexOf("<LoopButton"));
    expect(controls.indexOf("<LoopButton")).toBeLessThan(controls.indexOf("<MuteButton"));
    expect(controls).not.toContain("const FullscreenButton");
    expect(speedMenu).toContain("h-6 min-w-10");
    expect(speedMenu).toContain("whitespace-nowrap");
    expect(speedMenu).toContain("border-[#858a94]");
    expect(speedMenu).toContain("bg-[var(--hf-panel-bg)]");
    expect(speedMenu).toContain("bg-[var(--hf-panel-hover)]");
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
    expect(catalog).toContain(
      'scrollRoot.addEventListener("wheel", handleWheel, { passive: false })',
    );
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

  it("localizes asset import controls", () => {
    const assets = readFileSync(new URL("./sidebar/AssetsTab.tsx", import.meta.url), "utf8");
    const i18n = readFileSync(new URL("../i18n.tsx", import.meta.url), "utf8");

    expect(assets).toContain("useStudioI18n");
    expect(assets).toContain('t("assets.import")');
    expect(assets).toContain('t("assets.dropUpload")');
    expect(assets).toContain('t("assets.mediaTypes")');
    expect(assets).toContain('placeholder={t("assets.searchPlaceholder")}');
    expect(assets).not.toContain(">Import<");
    expect(assets).not.toContain("Drop files to upload");
    expect(i18n).toContain('"assets.import": "Import"');
    expect(i18n).toContain('"assets.import": "导入"');
  });
});
