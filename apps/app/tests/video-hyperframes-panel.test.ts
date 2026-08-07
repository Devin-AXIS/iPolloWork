import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  hyperframesStudioPort,
  hyperframesStudioUrl,
  shouldInjectVideoTaskContext,
  videoCompositionHasVoiceover,
  videoProjectDirectory,
  videoProjectId,
  videoProjectPath,
  videoPromptRequestsVoiceoverContext,
  videoTaskSystemContext,
} from "../src/react-app/domains/session/video/video-project";
import {
  parseVideoIllustrationDisplayMetadata,
  parseVideoIllustrationReference,
  videoIllustrationReferenceInstruction,
} from "../src/react-app/domains/session/video/video-illustration";

describe("HyperFrames Video Studio", () => {
  test("passes the Ian illustration skill through the composer and asset-library contract", () => {
    const reference = parseVideoIllustrationReference({
      id: "ian-xiaohei-illustrations",
      label: "Ian 小黑正文插画",
      repository: "helloianneo/ian-xiaohei-illustrations",
    });
    expect(reference).not.toBeNull();
    if (!reference) throw new Error("Expected a valid illustration reference");
    const instruction = videoIllustrationReferenceInstruction(reference);
    expect(instruction).toContain("helloianneo/ian-xiaohei-illustrations");
    expect(instruction).toContain("self-contained HTML file");
    expect(instruction).toContain("existing workspace file-reading and HTML-authoring capability");
    expect(instruction).not.toContain("ipollowork_extension_call");
    expect(instruction).not.toContain("extensionId openai-image-generation");
    expect(instruction).toContain("current video project's index.html");
    expect(instruction).toContain("assets/video-illustrations/");
    expect(instruction).toContain("插画已生成并放入素材库");
    expect(instruction).toContain("read the file back");
    expect(parseVideoIllustrationDisplayMetadata(instruction)).toEqual(reference);

    const panelSource = readFileSync(new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url), "utf8");
    const surfaceSource = readFileSync(new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url), "utf8");
    expect(panelSource).toContain('ipollowork:hyperframes:illustration-reference');
    expect(surfaceSource).toContain('ipollowork:add-illustration-reference');
    expect(surfaceSource).toContain("Every selected reference is a required deliverable");
    expect(surfaceSource).toContain("data-ipw-animation-reference");
    expect(surfaceSource).toContain("requirements.animationReferences");
    expect(surfaceSource).toContain("AI 插画已添加到对话框");
  });

  test("maps all six illustration choices to offline self-contained HTML contracts", () => {
    const profiles = [
      ["ian-xiaohei-illustrations", "helloianneo/ian-xiaohei-illustrations", "ian-xiaohei-illustrations"],
      ["html-infographic", "openai/visualize", "visualize"],
      ["html-concept-explainer", "ipollowork/faceless-explainer", "faceless-explainer + hyperframes-core"],
      ["html-kinetic-typography", "heygen-com/hyperframes", "hyperframes-animation"],
      ["html-svg-path", "heygen-com/hyperframes", "hyperframes-keyframes"],
      ["html-3d-space", "heygen-com/hyperframes", "hyperframes-keyframes"],
    ];

    for (const [id, repository, skill] of profiles) {
      const reference = parseVideoIllustrationReference({ id, label: id, repository });
      expect(reference).not.toBeNull();
      if (!reference) throw new Error(`Expected ${id} to be a valid illustration profile`);
      const instruction = videoIllustrationReferenceInstruction(reference);
      expect(instruction).toContain(skill);
      expect(instruction).toContain("exactly one self-contained HTML file");
      expect(instruction).toContain("editable HTML/CSS/inline SVG");
      expect(instruction).toContain("no CDN, remote font, network request");
      expect(instruction).toContain("1600x900");
      expect(instruction).toContain("complete composition must be visible and meaningful on its first frame");
      expect(instruction).toContain("prefers-reduced-motion: reduce");
      expect(instruction).toContain("assets/video-illustrations/");
    }

    expect(parseVideoIllustrationReference({ id: "unknown", label: "Unknown", repository: "unknown" })).toBeNull();
  });
  test("reuses the embedded Design system inspector for the active video composition", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );
    const registrySource = readFileSync(
      new URL("../src/react-app/domains/session/design/design-system-registry.ts", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain("<DesignSystemDrawer");
    expect(panelSource).toContain("embedded");
    expect(panelSource).toContain('event.data?.type !== "ipollowork:video-studio-panel"');
    expect(panelSource).toContain('event.data.panel === "style"');
    expect(panelSource).toContain('const [studioHostPanel, setStudioHostPanel] = React.useState<StudioHostPanel>(null)');
    expect(panelSource).toContain('setStudioHostPanel("voice")');
    expect(panelSource).toContain('setStudioHostPanel("style")');
    expect(panelSource).toContain('setStudioHostPanel(null)');
    expect(panelSource).not.toContain("voicePanelOpen");
    expect(panelSource).not.toContain("designSystemOpen");
    expect(panelSource).not.toContain('aria-label={t("video.design_system")}');
    expect(panelSource).toContain('data-testid="video-style-tab-content"');
    expect(panelSource).not.toContain("<DesignSystemInspectorShell");
    expect(panelSource).toContain('`${projectDirectory}/design-tokens.css`');
    expect(panelSource).toContain("ensureHtmlDesignSystemContract(current.content, theme.id)");
    expect(panelSource).toContain("buildTemplateTokenCss(theme)");
    expect(panelSource).toContain("next = replaceDesignTokenValue(next, name, value)");
    expect(panelSource).toContain("handleDesignTokenChanges({ [name]: value })");
    expect(panelSource).toContain('type: "ipollowork:studio-design-token-change"');
    expect(panelSource).not.toContain("variablesDisabled={!appliedDesignSystemId}");
    expect(panelSource).not.toContain("onChooseBackgroundImage=");
    expect(registrySource).toContain("[data-composition-id], .composition, .scene.clip");
    expect(panelSource).toContain("top-[90px]");
  });

  test("patches Video Studio theme tokens live without remounting the preview iframe", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );
    const previewPersistenceSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/hooks/usePreviewPersistence.ts", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain("const syncStudioDesignTokens = React.useCallback");
    expect(panelSource).toContain("syncStudioDesignTokens(parseDesignTokenValues(nextTokens))");
    expect(panelSource).toContain('key={`${sessionId}:${revision}`}');
    expect(panelSource).not.toContain("key={`${sessionId}:${revision}:${studioHostPanel}`}");
    expect(previewPersistenceSource).toContain("parseHostDesignTokensMessage");
    expect(previewPersistenceSource).toContain("applyDesignTokensToPreview");
    expect(previewPersistenceSource).toContain("doc.documentElement.style.setProperty(name, value)");
    expect(previewPersistenceSource).toContain("domEditSaveTimestampRef.current = Date.now()");
  });

  test("scales legacy video typography tokens and common text classes through the theme bridge", () => {
    const registrySource = readFileSync(
      new URL("../src/react-app/domains/session/design/design-system-registry.ts", import.meta.url),
      "utf8",
    );

    expect(registrySource).toContain("function templateTokenAliasLine");
    expect(registrySource).toContain("/^--text-[A-Za-z0-9_-]+$/.test(name)");
    expect(registrySource).toContain("calc(var(${storageName}) * var(--ipw-type-scale)) !important");
    expect(registrySource).toContain(".title, .headline, .hero-title, .section-title, .card-title");
    expect(registrySource).toContain(".body, .copy, .caption, .meta, .label, .metric, .stat, .badge");
    expect(registrySource).toContain(".title, .headline, .hero-title, .section-title, .card-title, .body, .copy, .caption, .meta");
    expect(registrySource).not.toContain(":where(div, span)");
  });

  test("keeps the quick toolbar visible and opens properties without hash-driven canvas resync", () => {
    const desktopSource = readFileSync(
      new URL("../../../apps/desktop/electron/main.mjs", import.meta.url),
      "utf8",
    );
    const urlStateSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/hooks/useStudioUrlState.ts", import.meta.url),
      "utf8",
    );
    const studioSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/App.tsx", import.meta.url),
      "utf8",
    );

    expect(desktopSource).toContain("window.__ipolloworkSimpleVideoListener !== 15");
    expect(desktopSource).toContain("new CustomEvent('ipollowork:studio-apply-selection'");
    expect(desktopSource).toContain("applyCanvasSelectionLive(target, { revealPanel: true })");
    expect(desktopSource).not.toContain("const current = document.querySelector('button[aria-label=\"Inspector\"]')");
    expect(studioSource).toContain("const loadStudioRightPanel = () => import(\"./components/StudioRightPanel\")");
    expect(studioSource).toContain("void loadStudioRightPanel()");
    expect(studioSource).toContain("function RightPanelLoadingFallback({ width }: { width: number })");
    expect(studioSource).toContain('t("right.openingProperties")');
    expect(studioSource).toContain("style={{ width }}");
    expect(studioSource).toContain("Suspense fallback={<RightPanelLoadingFallback width={panelLayout.rightWidth} />}");

    const advancedBranchStart = desktopSource.indexOf("} else if (action === 'advanced') {");
    const advancedBranchEnd = desktopSource.indexOf("postEditorMessage({\n            type: 'ipollowork:hyperframes:open-advanced'", advancedBranchStart);
    expect(advancedBranchStart).toBeGreaterThan(-1);
    expect(advancedBranchEnd).toBeGreaterThan(advancedBranchStart);
    expect(desktopSource.slice(advancedBranchStart, advancedBranchEnd)).toContain("showToolbar(selected)");
    expect(desktopSource.slice(advancedBranchStart, advancedBranchEnd)).not.toContain("toolbar.style.display = 'none'");

    expect(urlStateSource).toContain('window.addEventListener("ipollowork:studio-apply-selection"');
    expect(urlStateSource).toContain("setRightPanelTab(\"design\")");
    expect(urlStateSource).toContain("setRightCollapsed(false)");
    expect(urlStateSource.indexOf("setRightPanelTab(\"design\")")).toBeLessThan(urlStateSource.indexOf("applyUrlSelection(command.selection)"));
  });

  test("deletes selected canvas elements in place without forcing a full preview reload", () => {
    const desktopSource = readFileSync(
      new URL("../../../apps/desktop/electron/main.mjs", import.meta.url),
      "utf8",
    );
    const lifecycleSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/hooks/useElementLifecycleOps.ts", import.meta.url),
      "utf8",
    );
    const commitsSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/hooks/useDomEditCommits.ts", import.meta.url),
      "utf8",
    );

    expect(lifecycleSource).toContain("function removeLivePreviewElement");
    expect(lifecycleSource).toContain("findElementForSelection(doc, selection, activeCompPath)");
    expect(lifecycleSource).toContain("parent.insertBefore(element, nextSibling?.parentNode === parent ? nextSibling : null)");
    expect(lifecycleSource).toContain("if (!liveRemoval) reloadPreview()");
    expect(lifecycleSource).not.toContain("forceReloadSdkSession?.();\n        reloadPreview();");
    expect(commitsSource).toContain("previewIframeRef,");
    const deleteFunctionStart = desktopSource.indexOf("const deleteSelectedElement = async () => {");
    const deleteFunctionEnd = desktopSource.indexOf("const displayScale = () => {", deleteFunctionStart);
    expect(deleteFunctionStart).toBeGreaterThan(-1);
    expect(deleteFunctionEnd).toBeGreaterThan(deleteFunctionStart);
    const deleteFunctionSource = desktopSource.slice(deleteFunctionStart, deleteFunctionEnd);
    expect(desktopSource).toContain("data-ipollowork-delete-pending");
    expect(deleteFunctionSource).toContain("element.setAttribute('data-ipollowork-delete-pending', 'true')");
    expect(deleteFunctionSource).toContain("element.removeAttribute('data-ipollowork-delete-pending')");
    expect(deleteFunctionSource).not.toContain("postEditorMessage({ type: 'ipollowork:hyperframes:close-side-panels' });");
  });

  test("commits embedded theme reset tokens as a single batch", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );
    const drawerSource = readFileSync(
      new URL("../src/react-app/domains/session/design/design-system-drawer.tsx", import.meta.url),
      "utf8",
    );

    expect(drawerSource).toContain("onTokenChangeMany?: (values: DesignTokenValues) => void");
    expect(drawerSource).toContain("if (onTokenChangeMany) {");
    expect(drawerSource).toContain("onTokenChangeMany(next)");
    expect(panelSource).toContain("const handleDesignTokenChanges = React.useCallback");
    expect(panelSource).toContain("for (const [name, value] of Object.entries(values))");
    expect(panelSource).toContain("syncStudioDesignTokens(values)");
    expect(panelSource).toContain("onTokenChangeMany={handleDesignTokenChanges}");
  });

  test("keeps embedded voice and style content aligned with the resizable Studio drawer", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );
    const voiceSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-voice-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain("setStudioPanelWidth(Math.max(MIN_STUDIO_PANEL_WIDTH, Math.min(MAX_STUDIO_PANEL_WIDTH, event.data.width)))");
    expect(panelSource).toContain("embeddedWidth={studioPanelWidth}");
    expect(panelSource).toContain("style={{ width: studioPanelWidth }}");
    expect(voiceSource).toContain("style={embedded ? { width: embeddedWidth } : undefined}");
    expect(panelSource).toContain('top-[90px]');
    expect(voiceSource).toContain('top-[90px]');
    expect(panelSource).not.toContain('top-[82px]');
    expect(voiceSource).not.toContain('top-[82px]');
    expect(voiceSource).not.toContain("flex w-[400px]");
  });

  test("keeps a visible fullscreen control in the iPolloWork Video Studio header", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain('aria-label={t("video.toggle_fullscreen")}');
    expect(panelSource.match(/aria-label=\{t\("video\.toggle_fullscreen"\)\}/g)).toHaveLength(1);
    expect(panelSource).toContain("onExpandedChange?.(!expanded)");
    expect(panelSource).not.toContain("requestFullscreen()");
    expect(panelSource).not.toContain("document.exitFullscreen()");
  });

  test("reloads the embedded Studio reliably and waits for its readiness signal", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );
    const studioSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/App.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain("const reloadStudio = React.useCallback");
    expect(panelSource).toContain("setRevision((value) => value + 1)");
    expect(panelSource).toContain("}, [revision]);");
    expect(panelSource).toContain("setStudioHostPanel(null);");
    expect(panelSource).toContain('onClick={reloadStudio} aria-label={t("video.reload")}');
    expect(panelSource).toContain('event.data?.type !== "ipollowork:studio-ready"');
    expect(panelSource).not.toContain('<TooltipContent>{t("video.reload")}</TooltipContent>');
    expect(panelSource).not.toContain('type: "ipollowork:studio-refresh-preview"');
    expect(studioSource).not.toContain('event.data?.type !== "ipollowork:studio-refresh-preview"');
    expect(studioSource).toContain('type: "ipollowork:studio-ready"');
  });

  test("covers the video canvas with startup loading without remounting or hiding the iframe", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain("const showStudioStartupOverlay = status === \"starting\" || (status === \"ready\" && !studioChromeReady)");
    expect(panelSource).toContain("{showStudioStartupOverlay ? (");
    expect(panelSource).toContain("absolute inset-0 z-10 grid place-items-center");
    expect(panelSource).toContain('data-loading-covered={showStudioStartupOverlay ? "true" : "false"}');
    expect(panelSource).toContain('key={`${sessionId}:${revision}`}');
    expect(panelSource).not.toContain("studioChromeReady ? \"opacity-100\" : \"opacity-0\"");
    expect(panelSource.indexOf("setStudioChromeReady(true)")).toBeLessThan(
      panelSource.indexOf("scheduleStudioLocaleSync()"),
    );
  });

  test("debounces source saves and lazy-loads optional Studio panels", () => {
    const saveSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/hooks/useEditorSave.ts", import.meta.url),
      "utf8",
    );
    const studioSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/App.tsx", import.meta.url),
      "utf8",
    );

    expect(saveSource).toContain("}, 350)");
    expect(saveSource).toContain("saveChainRef.current.catch");
    expect(saveSource).toContain("addStudioPendingEditFlushListener");
    expect(studioSource).toContain("const StudioRightPanel = lazy");
    expect(studioSource).not.toContain("await renderQueue.startRender(undefined)");
    expect(studioSource).not.toContain("revealOnError: true");
  });

  test("opens export settings before the user explicitly starts a render", () => {
    const headerSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/components/StudioHeader.tsx", import.meta.url),
      "utf8",
    );
    const queueSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/components/renders/RenderQueue.tsx", import.meta.url),
      "utf8",
    );

    expect(headerSource).toContain('setRightPanelTab("renders")');
    expect(headerSource).toContain("setRightCollapsed(false)");
    expect(headerSource).not.toContain("onExport?.()");
    expect(queueSource).toContain("if (exportBusy) return");
    expect(queueSource).toContain("onStartRender(format, quality, outputResolution, fps, outputSize, captureSize)");
  });

  test("hides properties and export actions while previewing", () => {
    const headerSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/components/StudioHeader.tsx", import.meta.url),
      "utf8",
    );

    expect(headerSource).toContain("{!previewMode ? (");
    expect(headerSource.indexOf("{!previewMode ? (")).toBeLessThan(headerSource.indexOf("onClick={toggleProperties}"));
    expect(headerSource.indexOf("{!previewMode ? (")).toBeLessThan(headerSource.indexOf("onClick={openExport}"));
  });

  test("keeps desktop panel titlebars draggable without swallowing control input", () => {
    const videoPanelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );
    const sidePanelSource = readFileSync(
      new URL("../src/react-app/domains/session/panel/side-panel.tsx", import.meta.url),
      "utf8",
    );
    const artifactPanelSource = readFileSync(
      new URL("../src/react-app/domains/session/artifacts/artifact-panel.tsx", import.meta.url),
      "utf8",
    );
    const sidebarSource = readFileSync(
      new URL("../src/react-app/domains/session/sidebar/app-sidebar.tsx", import.meta.url),
      "utf8",
    );
    const appStyles = readFileSync(
      new URL("../src/app/index.css", import.meta.url),
      "utf8",
    );

    expect(videoPanelSource).toContain("mac:titlebar-drag");
    expect(sidePanelSource).toContain("px-2 mac:titlebar-drag");
    expect(artifactPanelSource).toContain("ps-4 mac:titlebar-drag");
    expect(sidebarSource).toContain('SidebarHeader className="gap-4 px-2 pb-8 pt-1 mac:titlebar-drag"');
    expect(appStyles).toContain('[data-titlebar-no-drag]');
    expect(appStyles).toContain("[role=\"tab\"]");
    expect(appStyles).toContain("-webkit-app-region: no-drag;");
  });

  test("keeps Video Studio shell copy localized", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain('t("video.title")');
    expect(panelSource).toContain("studioStartupTitleKey");
    expect(panelSource).toContain('t("video.status_failed")');
    expect(panelSource).toContain('t("video.failed_to_start")');
    expect(panelSource).not.toContain(">Video Studio<");
    expect(panelSource).not.toContain("Reload Video Studio");
    expect(panelSource).not.toContain("HyperFrames Studio failed to start</p>");
  });

  test("keeps voice dropdowns aligned to their field edges", () => {
    const voicePanelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-voice-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(voicePanelSource.match(/<SelectContent align="start">/g)).toHaveLength(2);
    expect(voicePanelSource).not.toContain("alignItemWithTrigger");
  });

  test("defers remote voice inventory until the user opens My voices", () => {
    const voicePanelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-voice-panel.tsx", import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n");
    const initialLoadStart = voicePanelSource.indexOf("  React.useEffect(() => {\n    let cancelled = false;");
    const deferredLoadStart = voicePanelSource.indexOf("  React.useEffect(() => {\n    if (activeTab !== \"mine\"");
    const initialLoad = voicePanelSource.slice(initialLoadStart, deferredLoadStart);

    expect(initialLoadStart).toBeGreaterThan(-1);
    expect(deferredLoadStart).toBeGreaterThan(initialLoadStart);
    expect(initialLoad).not.toContain('callMedia("voice_list"');
    expect(initialLoad).not.toContain('callStorage("status"');
    expect(voicePanelSource).toContain('if (activeTab !== "mine"');
    expect(voicePanelSource).toContain("Promise.allSettled([");
  });

  test("allows voice cloning without requiring separately configured object storage", () => {
    const voicePanelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-voice-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(voicePanelSource).toContain("将使用百炼免费临时存储");
    expect(voicePanelSource).toContain("disabled={cloning}");
    expect(voicePanelSource).not.toContain("disabled={!storageReady || cloning}");
    expect(voicePanelSource).not.toContain("!mediaReady || !storageReady");
  });

  test("keeps the application sidebar visible while Video Studio is expanded", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n");

    expect(sessionPageSource).toContain("videoStudioExpanded");
    expect(sessionPageSource).toContain('rightWorkspaceExpanded && "invisible pointer-events-none"');
    expect(sessionPageSource).toContain("onOpenSession={handleSidebarOpenSession}");
    expect(sessionPageSource).toContain("onOpenSessionSearch={props.sidebar.onOpenSessionSearch ? handleSidebarOpenSessionSearch : undefined}");
    expect(sessionPageSource).toContain('left: shellConfig.sidebar && sidebarOpen ? `${effectiveLeftSidebarWidth}px` : "0"');
    expect(sessionPageSource).toContain('videoStudioExpanded && (!shellConfig.sidebar || !sidebarOpen) && "mac:[&_header]:!pl-20"');
    expect(sessionPageSource).toContain(
      "!rightWorkspaceExpanded &&\n      (showWorkspaceSetupEmptyState",
    );
    expect(sessionPageSource).not.toContain("mac:peer-data-[state=collapsed]:[&_header]:pl-28");
    expect(sessionPageSource).toContain("onExpandedChange={setVideoStudioExpanded}");
  });

  test("restores expanded work surfaces before focusing an AI annotation", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    const restoreIndex = sessionPageSource.indexOf("if (rightPanelExpanded) setRightPanelExpanded(false)");
    const focusIndex = sessionPageSource.indexOf('window.dispatchEvent(new Event("ipollowork:focusPrompt"))', restoreIndex);
    expect(restoreIndex).toBeGreaterThan(-1);
    expect(focusIndex).toBeGreaterThan(restoreIndex);
    expect(sessionPageSource.slice(restoreIndex, focusIndex)).toContain("window.requestAnimationFrame");
    expect(sessionPageSource).not.toContain('panel.resize("100%")');
  });

  test("keeps the outer workspace layout independent from resizable panel registration", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).not.toContain('orientation="horizontal"');
    expect(sessionPageSource).toContain('aria-label="Resize right panel"');
    expect(sessionPageSource).toContain("onPointerDown={startRightPanelResize}");
    expect(sessionPageSource).toContain("setBrowserPanelWidth(nextWidth)");
    expect(sessionPageSource).toContain("width: sidePanelOpen ? effectiveBrowserPanelWidth : 0");
  });

  test("freezes resizable panel feedback while Design or Video Studio is expanded", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain("const rightWorkspaceExpanded = rightPanelExpanded || videoStudioExpanded");
    expect(sessionPageSource).toContain(
      '(!sidePanelOpen || rightWorkspaceExpanded) && "pointer-events-none',
    );
    expect(sessionPageSource).not.toContain("disabled={!sidePanelOpen || rightWorkspaceExpanded}");
    expect(sessionPageSource).not.toContain('rightWorkspaceExpanded && "**:data-[slot=sidebar-gap]:!w-0"');
    expect(sessionPageSource).toContain("setVideoStudioExpanded(false)");
    expect(sessionPageSource).toContain(
      "if (event.button !== 0 || !sidePanelOpen || rightWorkspaceExpanded) return",
    );
  });

  test("renders confirmation dialogs above expanded work surfaces", () => {
    const alertDialogSource = readFileSync(
      new URL("../src/components/ui/alert-dialog.tsx", import.meta.url),
      "utf8",
    );

    expect(alertDialogSource).toContain("fixed inset-0 isolate z-[80]");
    expect(alertDialogSource).toContain("top-1/2 left-1/2 z-[80]");
  });

  test("wires Video Studio selected-element toolbar actions in Design order", () => {
    const electronSource = readFileSync(
      new URL("../../../apps/desktop/electron/main.mjs", import.meta.url),
      "utf8",
    );
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );
    const nativeToolbarSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/components/nle/PreviewTextSelectionToolbar.tsx", import.meta.url),
      "utf8",
    );
    const nativeAiPromptSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/components/editor/domEditingAgentPrompt.ts", import.meta.url),
      "utf8",
    );

    const deleteIndex = electronSource.indexOf('<button type="button" data-action="delete"');
    const advancedIndex = electronSource.indexOf('data-action="advanced"');
    const aiIndex = electronSource.indexOf('data-action="ai"');
    const nativeDeleteIndex = nativeToolbarSource.indexOf('aria-label="Delete selected element"');
    const nativeAdvancedIndex = nativeToolbarSource.indexOf('aria-label="Open Design properties"');
    const nativeAiIndex = nativeToolbarSource.indexOf('aria-label="Ask AI about selected element"');

    expect(deleteIndex).toBeGreaterThan(-1);
    expect(aiIndex).toBeGreaterThan(advancedIndex);
    expect(deleteIndex).toBeGreaterThan(aiIndex);
    expect(electronSource).toContain("/file-mutations/remove-element/");
    expect(electronSource).toContain("deleteSelectedElement");
    expect(electronSource).toContain("ipollowork:hyperframes:ask-ai-selection");
    expect(electronSource).toContain("selectedAiPayload");
    expect(electronSource).toContain("hfId: element.getAttribute('data-hf-id')");
    expect(panelSource).toContain("onAskAi?: (context: DesignAiSelectionContext) => void");
    expect(panelSource).toContain("event.source !== studioFrameRef.current?.contentWindow");
    expect(panelSource).toContain('event.data?.type !== "ipollowork:hyperframes:ask-ai-selection"');
    expect(panelSource).toContain("resolveVideoAiSelectionTarget(event.data.target)");
    expect(panelSource).toContain("onExpandedChange?.(false)");
    expect(panelSource).toContain("video-ai-${crypto.randomUUID()}");
    expect(sessionPageSource).toContain("onAskAi={handleDesignAskAi}");
    expect(nativeToolbarSource).toContain("handleDomEditElementDelete");
    expect(nativeToolbarSource).toContain("postVideoAiSelectionToHost(activeSelection)");
    expect(nativeAiPromptSource).toContain("window.parent?.postMessage");
    expect(nativeAiPromptSource).toContain("ipollowork:hyperframes:ask-ai-selection");
    expect(nativeAiPromptSource).toContain("hfId: selection.hfId");
    expect(nativeDeleteIndex).toBeGreaterThan(-1);
    expect(nativeAiIndex).toBeGreaterThan(nativeAdvancedIndex);
    expect(nativeDeleteIndex).toBeGreaterThan(nativeAiIndex);
    expect(nativeToolbarSource).toContain("hf-preview-text-toolbar__icon-button");
    expect(nativeToolbarSource).toContain("hf-preview-text-toolbar__delete-button");
    expect(nativeToolbarSource).toContain("onClick={deleteSelectedElement}");
    expect(nativeToolbarSource).not.toContain("deleteConfirmationOpen");
    expect(panelSource).not.toContain("ipollowork:video-studio-clear-selection");
    expect(electronSource).toContain("ipollowork:hyperframes:clear-selection");
    expect(electronSource).toContain("finishEditing();");
    expect(electronSource).toContain("hideToolbar();");
    expect(electronSource).toContain('button[data-action="delete"]{color:#dc2626}');
    expect(electronSource).not.toContain("window.confirm('Delete selected element?')");
  });

  test("records host-applied video themes in Studio undo history", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );
    const studioSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/App.tsx", import.meta.url),
      "utf8",
    );
    const applyTheme = panelSource.match(
      /const handleApplyDesignSystem = React\.useCallback\([\s\S]*?\n  \}, \[/,
    )?.[0] ?? "";

    expect(panelSource).toContain("ipollowork:studio-record-host-edit");
    expect(panelSource).toContain("ipollowork:studio-history-ready");
    expect(panelSource).toContain("ipollowork:studio-history-recorded");
    expect(panelSource).toContain('"index.html": {');
    expect(panelSource).toContain('"design-tokens.css": {');
    expect(panelSource).toContain("ipollowork:studio-history-action");
    expect(panelSource).toContain("ipollowork:studio-history-applied");
    expect(panelSource).toContain("!studioHistoryReady");
    expect(studioSource).toContain("useIPolloWorkHostHistoryBridge({");
    expect(studioSource).toContain("loaded: editHistory.loaded");
    expect(applyTheme).toContain("if (themedHtml === current.content && nextTokens === currentTokenCss)");
    expect(applyTheme.indexOf("await recordStudioHostEdit")).toBeGreaterThan(
      applyTheme.indexOf("await client.writeWorkspaceFile"),
    );
  });

  test("rebuilds the embedded Studio when its source is newer than the bundled UI", () => {
    const electronDevSource = readFileSync(
      new URL("../../../apps/desktop/scripts/electron-dev.mjs", import.meta.url),
      "utf8",
    );

    expect(electronDevSource).toContain('const hyperframesStudioBuild = resolve(hyperframesRoot, "packages", "cli", "dist", "studio", "index.html")');
    expect(electronDevSource).toContain("newestMtimeMs(studioSourceRoot) > studioBuildTime");
    expect(electronDevSource).toContain('runSync(bunCmd, ["run", "build:local-studio"]');
  });

  test("opens the session project even when Electron inherits another working directory", () => {
    const electronSource = readFileSync(
      new URL("../../../apps/desktop/electron/main.mjs", import.meta.url),
      "utf8",
    );

    expect(electronSource).toContain(
      'spawnLocalHyperframes(["preview", projectPath, "--port", String(port), "--no-open"], projectPath)',
    );
    expect(electronSource).toContain("runningProjectName === expectedProjectName");
  });

  test("prevents automatic browser activity from replacing Video Studio", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain("if (isVideoSession && activeSidePanel !== \"panel\")");
    expect(sessionPageSource).toContain("void browser.hide?.()");
    expect(sessionPageSource).toContain("if (isVideoSession && options?.auto) return;");
    expect(sessionPageSource).toContain("if (!isVideoSession) setCurrentSidePanel(\"panel\")");
  });

  test("keeps a collapsed-sidebar title clear of its expand button", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain('sidebarVisuallyCollapsed && shellConfig.sidebar ? "!pl-16 mac:!pl-32" : ""');
  });

  test("preserves the right panel state without leaving a blank condensed gutter", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n");

    const openLeftStart = sessionPageSource.indexOf("const openLeftSidebar = useCallback(() => {");
    const openLeftEnd = sessionPageSource.indexOf("useEffect(() => {", openLeftStart);
    const openLeftSidebar = sessionPageSource.slice(openLeftStart, openLeftEnd);

    expect(sessionPageSource).toContain("const openLeftSidebar = useCallback(() => {");
    expect(sessionPageSource).not.toContain("RIGHT_PANEL_CONDENSED_WIDTH");
    expect(sessionPageSource).not.toContain("minimumVisibleRightPanelWidth");
    expect(sessionPageSource).toContain("availableRightPanelWidth = Math.max(");
    expect(openLeftSidebar).not.toContain("closeRightPane");
    expect(openLeftSidebar).not.toContain("autoCollapsedSidePanelRef.current");
    expect(sessionPageSource).not.toContain("if (sidePanelOpen) {\n      autoCollapsedSidePanelRef.current = effectiveSidePanelView;");
    expect(sessionPageSource).toContain("if (sidebarOpen && userOpenedSidebarWhileNarrowRef.current) return;");
    expect(sessionPageSource).toContain("restoredPanel &&\n      !userOpenedSidebarWhileNarrowRef.current &&\n      !sidePanelOpen");
    expect(sessionPageSource).toContain("onClick={openLeftSidebar}");
  });

  test("uses coordinated shell transitions for the left and right sidebars", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain("const SESSION_SHELL_TRANSITION_MS = 220");
    expect(sessionPageSource).toContain('const SESSION_SHELL_TRANSITION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"');
    expect(sessionPageSource).toContain("const sessionShellTransition =");
    expect(sessionPageSource).toContain("rightPanelTransitionStyle");
    expect(sessionPageSource).toContain("rightPanelResizing ? \"none\" : sessionShellTransition");
    expect(sessionPageSource).toContain("transition-[width,min-width,opacity]");
    expect(sessionPageSource).toContain("**:data-[slot=sidebar-container]:duration-[220ms]");
    expect(sessionPageSource).not.toContain('rightWorkspaceExpanded && "**:data-[slot=sidebar-gap]:!w-0"');
  });

  test("uses a low-contrast themed boundary beside Video Studio", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain("border-r border-border/40 dark:border-white/[0.055]");
    expect(sessionPageSource).not.toContain('border-[#EAEAEA]');
  });

  test("batches right-panel drag updates and cleans up the interaction", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    const resizeStart = sessionPageSource.indexOf("const startRightPanelResize");
    const resizeEnd = sessionPageSource.indexOf("const handleDesignAskAi", resizeStart);
    const resizeInteraction = sessionPageSource.slice(resizeStart, resizeEnd);

    expect(resizeStart).toBeGreaterThan(-1);
    expect(resizeEnd).toBeGreaterThan(resizeStart);
    expect(resizeInteraction).toContain("window.requestAnimationFrame(applyPendingWidth)");
    expect(resizeInteraction).toContain("window.cancelAnimationFrame(frameId)");
    expect(resizeInteraction).toContain('window.removeEventListener("pointermove", handleMove)');
    expect(resizeInteraction).toContain('window.removeEventListener("pointercancel", handleStop)');
    expect(resizeInteraction).toContain('rightPanel.style.pointerEvents = "none"');
  });

  test("lets the latest right-panel action take priority in a narrow window", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n");

    expect(sessionPageSource).not.toContain("if (panel) {\n      userOpenedSidebarWhileNarrowRef.current = false;");
    expect(sessionPageSource).toContain("const toggleCurrentSidePanel = useCallback((panel: SidePanelItem) => {\n    userOpenedSidebarWhileNarrowRef.current = false;");
    expect(sessionPageSource).toContain("userOpenedSidebarWhileNarrowRef.current = false;\n    userOpenedSidePanelWhileNarrowRef.current = true;");
  });

  test("opens the native Studio on a hydrated first frame", () => {
    expect(hyperframesStudioUrl()).toBe("http://localhost:3002/#project/video?v=1&t=0&tab=design&rc=1&tv=1");
  });

  test("passes the app locale through the Studio hash route", () => {
    expect(hyperframesStudioUrl(3002, "video", "zh")).toBe("http://localhost:3002/#project/video?v=1&t=0&tab=design&rc=1&tv=1&locale=zh");
  });

  test("isolates each video task in a shell-safe project directory", () => {
    expect(videoProjectId("ses/current video")).toBe("ses_current_video");
    expect(videoProjectDirectory("ses_current-video")).toBe("video/ses_current-video");
    expect(videoProjectDirectory("ses/current video")).toBe("video/ses_current_video");
    expect(videoProjectPath("ses/current video", "/workspace/current/")).toBe("/workspace/current/video/ses_current_video");
    expect(videoProjectPath("ses/current video", "/")).toBe("/video/ses_current_video");
    expect(videoProjectPath("ses/current video", "C:\\workspace\\current\\")).toBe("C:\\workspace\\current\\video\\ses_current_video");
  });

  test("assigns a stable session-specific Studio port", () => {
    expect(hyperframesStudioPort("ses_video_a")).toBe(hyperframesStudioPort("ses_video_a"));
    expect(hyperframesStudioPort("ses_video_a")).not.toBe(hyperframesStudioPort("ses_video_b"));
    expect(hyperframesStudioUrl(hyperframesStudioPort("ses_video_a"), videoProjectId("ses_video_a"))).toBe(
      `http://localhost:${hyperframesStudioPort("ses_video_a")}/#project/ses_video_a?v=1&t=0&tab=design&rc=1&tv=1`,
    );
  });

  test("keeps legacy Video Studio sessions on the video task contract", () => {
    expect(shouldInjectVideoTaskContext("video", "work")).toBe(true);
    expect(shouldInjectVideoTaskContext(null, "video")).toBe(true);
    expect(shouldInjectVideoTaskContext("design", "video")).toBe(false);
    expect(shouldInjectVideoTaskContext(null, "work")).toBe(false);
  });

  test("injects the Video Studio contract before animation guidance", () => {
    const sessionRouteSource = readFileSync(
      new URL("../src/react-app/shell/session-route.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionRouteSource).toContain("shouldInjectVideoTaskContext(");
    expect(sessionRouteSource).toContain("videoTaskSystemContext(");
    expect(sessionRouteSource).toContain("draft.capability?.instruction");
    expect(sessionRouteSource).toContain("[envSystemContext, videoSystemContext, designSystemContext, authoringSystemContext, capabilitySystemContext]");
  });

  test("gives the agent the same session-scoped project as the Studio", () => {
    const contract = videoTaskSystemContext("ses/current video", "/workspace/current");
    expect(contract).toContain("/workspace/current/video/ses_current_video/index.html");
    expect(contract).toContain("prepared blank composition");
    expect(contract).toContain("Never run npm/pnpm/yarn install");
    expect(contract).toContain("Batch compatible HTML/CSS/JS changes into one complete edit or write");
    expect(contract).toContain("Never create or inspect another `video/`/`videos/` project");
    expect(contract).toContain("Never stop all Node processes");
    expect(contract).toContain("not an HTML/JSON response saved with a media extension");
    expect(contract).toContain("Use `/media-use` to resolve BGM");
    expect(contract).toContain("verify its response type and local file signature");
    expect(contract).toContain("never run `npx hyperframes check`");
    expect(contract).toContain("never use legacy `.frame` millisecond timelines");
    expect(contract).toContain("seconds-based `data-start`");
    expect(contract).toContain("Root `data-duration` must cover the last scene/audio/clip");
    expect(contract).toContain("Delivery requirements contract");
    expect(contract).toContain('data-ipw-caption="true"');
    expect(contract).toContain('data-ipw-bgm="true"');
    expect(contract).toContain("animationReferences");
    expect(contract).toContain("unresolved earlier requests");
    expect(contract).toContain("If valid, stop using tools and answer immediately");
    expect(contract).toContain("do not follow it with browser/screenshot/eval calls");
    expect(contract).toContain("manual tag counting, parser scripts, file rereads, or extra shell validation");
    expect(contract).toContain("at most 20 seconds");
    expect(contract).toContain("on timeout abandon it without retrying");
    expect(contract).toContain("Never start either auxiliary operation after validation");
    expect(contract).toContain("authoritative completion gate");
    expect(contract).toContain("assets/ipollowork-logo.svg?v=20260729");
    expect(contract).toContain("top-left/bottom-right placement");
    expect(contract).toContain("and local fallback");
  });

  test("gives video agents the selected Studio voice without forcing narration", () => {
    const contract = videoTaskSystemContext("ses/current video", "/workspace/current", null, { includeVoiceover: true });
    expect(contract).toContain("/workspace/current/video/ses_current_video/voiceover.json");
    expect(contract).toContain("ipollowork_extension_call");
    expect(contract).toContain("speech_synthesize_workspace_batch");
    expect(contract).toContain("built into the installed desktop application");
    expect(contract).toContain("Never check for, install, authenticate, or recommend HeyGen/HyperFrames CLI");
    expect(contract).toContain("never ask the user to run an auth/login command");
    expect(contract).toContain("ipollowork_extension_list_actions");
    expect(contract).toContain("do not replace it with user setup instructions or an external CLI");
    expect(contract).toContain("Never use generic `speech_synthesize`");
    expect(contract).toContain("voiceId");
    expect(contract).toContain("assets/voiceover-<revision>-<scene>.mp3");
    expect(contract).toContain("directly under the root composition");
    expect(contract).toContain("immutable");
    expect(contract).toContain("compositionPath");
    expect(contract).toContain("audioElementHtml");
    expect(contract).toContain("timelinePatch");
    expect(contract).toContain("cumulative shifts");
    expect(contract).toContain("Keep narrated text visible");
    expect(contract).toContain("voiceover_timeline_validate");
    expect(contract).toContain("fix all reported issues together");
    expect(contract).toContain('data-ipw-voiceover="true"');
    expect(contract).toContain('data-ipw-narration-source="true"');
    expect(contract).toContain("existing headings, body copy, names, dates, metrics, labels");
    expect(contract).toContain("targetDurationSeconds");
    expect(contract).toContain("Never overlap");
    expect(contract).toContain("root duration");
    expect(contract).toContain("GSAP");
    expect(contract).toContain("requirements.captions: true");
    expect(contract).toContain("another provider");
  });

  test("loads the expensive voiceover contract only when the prompt or composition needs it", () => {
    const visualContract = videoTaskSystemContext("ses_video_a", "/workspace/current");
    const voiceContract = videoTaskSystemContext("ses_video_a", "/workspace/current", null, { includeVoiceover: true });
    expect(visualContract).toContain("Narration is opt-in for performance");
    expect(visualContract).not.toContain("speech_synthesize_workspace_batch");
    expect(voiceContract).toContain("speech_synthesize_workspace_batch");
    expect(visualContract.length).toBeLessThan(voiceContract.length);
    expect(videoPromptRequestsVoiceoverContext("video-voice-reference", "")).toBe(true);
    expect(videoPromptRequestsVoiceoverContext(undefined, "请给这个视频添加旁白")).toBe(true);
    expect(videoPromptRequestsVoiceoverContext(undefined, "Make the second scene longer")).toBe(false);
    expect(videoCompositionHasVoiceover('<audio data-ipw-voiceover="true" src="assets/voiceover-a.mp3"></audio>')).toBe(true);
    expect(videoCompositionHasVoiceover('<main data-composition-id="main"></main>')).toBe(false);
  });

  test("uses an adaptive operation plan without forcing one video workflow", () => {
    const contract = videoTaskSystemContext("ses_video_a", "/workspace/current");
    expect(contract).toContain("Adaptive execution contract");
    expect(contract).toContain("update-element");
    expect(contract).toContain("freeform-patch");
    expect(contract).toContain("For a small local edit, patch only that element");
    expect(contract).toContain("structural, multi-scene, or narrated edit");
  });

  test("keeps an imported video template as the agent's editing source", () => {
    const contract = videoTaskSystemContext("ses_video_a", "/workspace/current", {
      id: "personal.launch-film",
      title: "Launch Film",
      entry: "index.html",
      applyChecklist: ["Replace inherited copy", "Keep the visual language"],
    });
    expect(contract).toContain("source is template `Launch Film`");
    expect(contract).toContain("edit it rather than starting over");
    expect(contract).toContain("preserve the composition id");
    expect(contract).toContain("Replace inherited copy; Keep the visual language");
  });
});
