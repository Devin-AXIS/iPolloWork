import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  hyperframesStudioPort,
  hyperframesStudioUrl,
  shouldInjectVideoTaskContext,
  videoCompositionHasVoiceover,
  videoDeliveryRequirementsForPrompt,
  videoProjectDirectory,
  videoProjectId,
  videoProjectPath,
  videoPromptRequestsVoiceoverContext,
  requestedVideoDurationSeconds,
  videoTaskSystemContext,
} from "../src/react-app/domains/session/video/video-project";
import {
  findNewPluginWorkshopProjectId,
  mergePluginWorkshopInstruction,
  nextPluginWorkshopLabel,
  pluginWorkshopProjectIdsFromPaths,
  pluginWorkshopSystemInstruction,
  pluginWorkshopTabId,
} from "../src/react-app/domains/session/plugin-workshop/plugin-workshop-contract";
describe("HyperFrames Video Studio", () => {
  test("shows a live warning while the current session AI is editing the video", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );
    const previewSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/components/nle/PreviewPane.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain("aiEditing={isStreamingSessionStatus(");
    expect(panelSource).toContain('type: "ipollowork:studio-ai-editing"');
    expect(panelSource).toContain("active: aiEditing");
    expect(previewSource).toContain('data-testid="studio-ai-editing-status"');
    expect(previewSource).toContain('t("preview.aiEditingWarning")');
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
    expect(panelSource).toContain("pickLocalImageFile(\"选择视频背景图片\")");
    expect(panelSource).toContain("readLocalImageAsDataUrl(pickedPath)");
    expect(panelSource).toContain('"--ipw-bg-image": `url(\"${dataUrl}\")`');
    expect(panelSource).toContain("onChooseBackgroundImage={() => void chooseDesignSystemBackgroundImage()}");
    expect(registrySource).toContain("[data-composition-file][data-composition-id]");
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
    expect(panelSource).toContain("syncStudioDesignTokens(parseDesignTokenValues(nextTokens), nextTokens)");
    expect(panelSource).toContain('key={`${sessionId}:${revision}`}');
    expect(panelSource).not.toContain("key={`${sessionId}:${revision}:${studioHostPanel}`}");
    expect(previewPersistenceSource).toContain("parseHostDesignTokensMessage");
    expect(previewPersistenceSource).toContain("applyDesignTokensToPreview");
    expect(previewPersistenceSource).toContain("doc.documentElement.style.setProperty(name, value)");
    expect(previewPersistenceSource).toContain("cssSource?: string");
    expect(previewPersistenceSource).toContain("style[data-ipw-live-design-tokens]");
    expect(previewPersistenceSource).toContain("domEditSaveTimestampRef.current = Date.now()");
  });

  test("bridges global video theme tokens without overriding scene geometry", () => {
    const registrySource = readFileSync(
      new URL("../src/react-app/domains/session/design/design-system-registry.ts", import.meta.url),
      "utf8",
    );

    expect(registrySource).toContain("function templateTokenAliasLine");
    expect(registrySource).toContain("/^--(?:text|font-size|fs)-[A-Za-z0-9_-]+$/.test(name)");
    expect(registrySource).toContain("calc(var(${storageName}) * var(--ipw-type-scale)) !important");
    expect(registrySource).toContain("body :where(*):not(svg):not(svg *)");
    expect(registrySource).toContain(".title, .title *, .headline, .headline *, .heading, .heading *");
    expect(registrySource).toContain("buildStableTokenBridgeCss");
    expect(registrySource).toContain("--page-padding: var(--ipw-page-padding)");
    expect(registrySource).toContain("--duration-normal: var(--ipw-motion-duration)");
    expect(registrySource).toContain("box-shadow: var(--ipw-card-shadow) !important");
    expect(registrySource).toContain("--ipw-motion-duration");
    expect(registrySource).not.toContain('[class*="-card"]');
    expect(registrySource).not.toContain("[data-composition-id] > section");
  });

  test("hides the theme-level motion control while preserving motion token compatibility", () => {
    const drawerSource = readFileSync(
      new URL("../src/react-app/domains/session/design/design-system-drawer.tsx", import.meta.url),
      "utf8",
    );
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(drawerSource).not.toContain("MOTION_OPTION_DEFS");
    expect(drawerSource).not.toContain('PanelSection title={t("design_system.embedded.motion")}');
    expect(drawerSource).not.toContain("const [motion, setMotion] = React.useState");
    expect(drawerSource).toContain('"--ipw-motion-style": "none"');
    expect(drawerSource).toContain('"--ipw-motion-duration": "0ms"');
    expect(panelSource).toContain("ensureVideoTokenBridge");
    expect(panelSource).toContain("buildStableTokenBridgeCss");
    expect(panelSource).toContain('replaceDesignTokenValue(source, "--ipw-type-scale", "1")');
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
    expect(desktopSource).toContain("window.__ipolloworkSimpleVideoListener !== 16");
    expect(desktopSource).toContain("new CustomEvent('ipollowork:studio-apply-selection'");
    expect(desktopSource).toContain("hfId: target.hfId || undefined");
    expect(desktopSource).toContain("'[data-hf-id=\"' + CSS.escape(hfId) + '\"]'");
    expect(desktopSource).toContain("applyCanvasSelectionLive(target, { revealPanel: true })");
    expect(desktopSource).not.toContain("const current = document.querySelector('button[aria-label=\"Inspector\"]')");
    expect(studioSource).toContain("const loadStudioRightPanelModule = () => import(\"./components/StudioRightPanel\")");
    expect(studioSource).toContain("void loadStudioRightPanel()");
    expect(studioSource).toContain("function RightPanelLoadingFallback({ width }: { width: number })");
    expect(studioSource).toContain('t("right.openingProperties")');
    expect(studioSource).toContain("style={{ width }}");
    expect(studioSource).toMatch(
      /<Suspense\s+fallback=\{<RightPanelLoadingFallback width=\{panelLayout\.rightWidth\} \/>\}/,
    );

    const advancedBranchStart = desktopSource.indexOf("} else if (action === 'advanced') {");
    const advancedBranchEnd = desktopSource.indexOf(
      "type: 'ipollowork:hyperframes:open-advanced'",
      advancedBranchStart,
    );
    expect(advancedBranchStart).toBeGreaterThan(-1);
    expect(advancedBranchEnd).toBeGreaterThan(advancedBranchStart);
    expect(desktopSource.slice(advancedBranchStart, advancedBranchEnd)).toContain("showToolbar(selected)");
    expect(desktopSource.slice(advancedBranchStart, advancedBranchEnd)).not.toContain("toolbar.style.display = 'none'");

    expect(urlStateSource).toContain('window.addEventListener("ipollowork:studio-apply-selection"');
    expect(urlStateSource).toContain("setRightPanelTab(\"design\")");
    expect(urlStateSource).toContain("setRightCollapsed(false)");
    expect(urlStateSource.indexOf("setRightPanelTab(\"design\")")).toBeLessThan(urlStateSource.indexOf("applyUrlSelection(command.selection)"));
  });

  test("deletes selected canvas elements optimistically and refreshes once after persistence", () => {
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
    expect(lifecycleSource).toContain("const requestPreviewRefresh = () => {");
    expect(lifecycleSource).toContain("if (!previewRefreshRequested && loadingShown)");
    expect(lifecycleSource).not.toContain("if (!liveRemoval) reloadPreview()");
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
    expect(drawerSource).toContain('"--ipw-bg-mode": selectedTheme ? "solid" : "none"');
    expect(drawerSource).toContain('"--ipw-bg-image": "none"');
    expect(panelSource).toContain("const handleDesignTokenChanges = React.useCallback");
    expect(panelSource).toContain("for (const [name, value] of Object.entries(values))");
    expect(panelSource).toContain("syncStudioDesignTokens(values, next)");
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
    expect(voiceSource).toContain("width={embedded ? embeddedWidth : undefined}");
    expect(panelSource).toContain('top-[90px]');
    expect(voiceSource).toContain('top-[90px]');
    expect(panelSource).not.toContain('top-[82px]');
    expect(voiceSource).not.toContain('top-[82px]');
    expect(voiceSource).not.toContain("flex w-[400px]");
  });

  test("keeps fullscreen control in the unified right-panel header", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );
    const sidePanelSource = readFileSync(
      new URL("../src/react-app/domains/session/panel/side-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).not.toContain('aria-label={t("video.toggle_fullscreen")}');
    expect(sidePanelSource).toContain("onClick={() => onExpandedChange(!expanded)}");
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
    const studioHeaderSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/components/StudioHeader.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain("const reloadStudio = React.useCallback");
    expect(panelSource).toContain("setRevision((value) => value + 1)");
    expect(panelSource).toContain("}, [revision]);");
    expect(panelSource).toContain("setStudioHostPanel(null);");
    expect(panelSource).toContain('event.data.action === "reload"');
    expect(studioHeaderSource).toContain('requestHostAction("reload")');
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

    expect(sidePanelSource).toContain("px-2 mac:titlebar-drag");
    expect(artifactPanelSource).toContain("ps-4 mac:titlebar-drag");
    expect(sidebarSource).toContain('SidebarHeader className="gap-3 px-2 pb-3 pt-1 mac:titlebar-drag"');
    expect(appStyles).toContain('[data-titlebar-no-drag]');
    expect(appStyles).toContain("[role=\"tab\"]");
    expect(appStyles).toContain("-webkit-app-region: no-drag;");
  });

  test("keeps Video Studio shell copy localized", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain("title: string;");
    expect(panelSource).toContain('type: "ipollowork:studio-host-context"');
    expect(panelSource).toContain("studioStartupTitleKey");
    expect(panelSource).toContain('t("video.failed_to_start")');
    expect(panelSource).not.toContain(">Video Studio<");
    expect(panelSource).not.toContain("Reload Video Studio");
    expect(panelSource).not.toContain("HyperFrames Studio failed to start</p>");
  });

  test("removes the duplicate Video Studio row and places host actions before Properties", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );
    const studioHeaderSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/components/StudioHeader.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).not.toContain('<header className="flex h-11');
    expect(panelSource).toContain('event.data?.type !== "ipollowork:studio-host-action"');
    expect(studioHeaderSource).toContain('className="hf-studio-header-utilities flex items-center gap-1"');
    expect(studioHeaderSource).toContain('t("header.saveAsTemplate")');
    expect(studioHeaderSource).toContain('<FloppyDisk className="h-4 w-4" weight="regular" aria-hidden="true" />');
    expect(studioHeaderSource.indexOf('t("header.saveAsTemplate")')).toBeLessThan(
      studioHeaderSource.indexOf('t("header.inspector")'),
    );
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

    expect(voicePanelSource).toContain('t("video.voice.temp_storage_help")');
    expect(voicePanelSource).toContain("disabled={cloning}");
    expect(voicePanelSource).not.toContain("disabled={!storageReady || cloning}");
    expect(voicePanelSource).not.toContain("!mediaReady || !storageReady");
  });

  test("keeps the application sidebar visible while the unified right panel is expanded", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n");

    expect(sessionPageSource).toContain("const rightWorkspaceExpanded = rightPanelExpanded");
    expect(sessionPageSource).toContain('rightWorkspaceExpanded && "invisible pointer-events-none"');
    expect(sessionPageSource).toContain("onOpenSession={handleSidebarOpenSession}");
    expect(sessionPageSource).toContain("onOpenSessionSearch={props.sidebar.onOpenSessionSearch ? handleSidebarOpenSessionSearch : undefined}");
    expect(sessionPageSource).toContain('left: shellConfig.sidebar && sidebarOpen ? `${effectiveLeftSidebarWidth}px` : "0"');
    expect(sessionPageSource).toContain('rightPanelExpanded && (!shellConfig.sidebar || !sidebarOpen)');
    expect(sessionPageSource).toContain(
      "!rightWorkspaceExpanded &&\n      (showWorkspaceSetupEmptyState",
    );
    expect(sessionPageSource).not.toContain("mac:peer-data-[state=collapsed]:[&_header]:pl-28");
    expect(sessionPageSource).toContain("onExpandedChange={setRightPanelExpandedState}");
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

  test("freezes resizable panel feedback while the unified work surface is expanded", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain("const rightWorkspaceExpanded = rightPanelExpanded");
    expect(sessionPageSource).toContain(
      '(!sidePanelOpen || rightWorkspaceExpanded) && "pointer-events-none',
    );
    expect(sessionPageSource).not.toContain("disabled={!sidePanelOpen || rightWorkspaceExpanded}");
    expect(sessionPageSource).not.toContain('rightWorkspaceExpanded && "**:data-[slot=sidebar-gap]:!w-0"');
    expect(sessionPageSource).toContain(
      "if (event.button !== 0 || !sidePanelOpen || rightWorkspaceExpanded) return",
    );
  });

  test("renders confirmation dialogs above expanded work surfaces", () => {
    const alertDialogSource = readFileSync(
      new URL("../src/components/ui/alert-dialog.tsx", import.meta.url),
      "utf8",
    );
    const dialogSource = readFileSync(
      new URL("../src/components/ui/dialog.tsx", import.meta.url),
      "utf8",
    );

    expect(alertDialogSource).toContain("fixed inset-0 isolate z-[80]");
    expect(alertDialogSource).toContain("top-1/2 left-1/2 z-[80]");
    expect(dialogSource).toContain("fixed inset-0 isolate z-[80]");
    expect(dialogSource).toContain("top-1/2 start-1/2 z-[80]");
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
    const nativeDeleteIndex = nativeToolbarSource.indexOf('aria-label={tx("Delete selected element")}');
    const nativeAdvancedIndex = nativeToolbarSource.indexOf('aria-label={tx("Open Design properties")}');
    const nativeAiIndex = nativeToolbarSource.indexOf('aria-label={tx("Ask AI about selected element")}');

    expect(deleteIndex).toBeGreaterThan(-1);
    expect(aiIndex).toBeGreaterThan(advancedIndex);
    expect(deleteIndex).toBeGreaterThan(aiIndex);
    expect(electronSource).toContain("/file-mutations/remove-element/");
    expect(electronSource).toContain("deleteSelectedElement");
    expect(electronSource).toContain("ipollowork:hyperframes:ask-ai-selection");
    expect(electronSource).toContain("selectedAiPayload");
    expect(electronSource).toContain("const hfId = element.getAttribute('data-hf-id') || undefined");
    expect(panelSource).toContain("onAskAi?: (context: DesignAiSelectionContext) => void");
    expect(panelSource).toContain("event.source !== studioFrameRef.current?.contentWindow");
    expect(panelSource).toContain('event.data?.type !== "ipollowork:hyperframes:ask-ai-selection"');
    expect(panelSource).toContain("resolveVideoAiSelectionTarget(event.data.target)");
    expect(panelSource).toContain("event.data.semanticContext.slice(0, 20_000)");
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
    expect(electronDevSource).toContain("newestBuildInputTime > studioBuildTime");
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

  test("keeps Video Studio in the unified right-panel tab strip with browser, design, and files", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );
    const sidePanelSource = readFileSync(
      new URL("../src/react-app/domains/session/panel/side-panel.tsx", import.meta.url),
      "utf8",
    );
    const tabStoreSource = readFileSync(
      new URL("../src/react-app/domains/session/panel/panel-tab-store.ts", import.meta.url),
      "utf8",
    );
    const videoPanelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );
    const studioHeaderSource = readFileSync(
      new URL("../../../vendor/hyperframes/packages/studio/src/components/StudioHeader.tsx", import.meta.url),
      "utf8",
    );

    expect(tabStoreSource).toContain('type: "video"');
    expect(tabStoreSource).toContain('tab.type === "artifact" || tab.type === "design" || tab.type === "video"');
    expect(sessionPageSource).toContain('id: videoTabId');
    expect(sessionPageSource).toContain('type: "video"');
    expect(sessionPageSource).toContain('setSidePanelState(props.selectedSessionId ?? sessionId, "panel")');
    expect(sidePanelSource).toContain('activeTab?.type === "video"');
    expect(sidePanelSource).toContain("<VideoPanel");
    expect(sidePanelSource).toContain("title={activeTab.label}");
    expect(videoPanelSource).toContain('type: "ipollowork:studio-host-context"');
    expect(studioHeaderSource).toContain('event.data?.type !== "ipollowork:studio-host-context"');
    expect(sessionPageSource).not.toContain("void browser.hide?.()");
    expect(sessionPageSource).toContain("if (isVideoSession && options?.auto) return;");
    expect(sessionPageSource).toContain('setCurrentSidePanel("panel")');
  });

  test("keeps Plugin Workshop in the shared conversation and right-panel tab flow", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );
    const sidebarSource = readFileSync(
      new URL("../src/react-app/domains/session/sidebar/app-sidebar.tsx", import.meta.url),
      "utf8",
    );
    const sidePanelSource = readFileSync(
      new URL("../src/react-app/domains/session/panel/side-panel.tsx", import.meta.url),
      "utf8",
    );
    const tabStoreSource = readFileSync(
      new URL("../src/react-app/domains/session/panel/panel-tab-store.ts", import.meta.url),
      "utf8",
    );
    const workshopSource = readFileSync(
      new URL("../src/react-app/domains/session/plugin-workshop/plugin-workshop.tsx", import.meta.url),
      "utf8",
    );
    const serverClientSource = readFileSync(
      new URL("../src/app/lib/ipollowork-server.ts", import.meta.url),
      "utf8",
    );
    const selectedToolbarSource = workshopSource.slice(
      workshopSource.indexOf('data-testid="plugin-workshop-studio"'),
      workshopSource.indexOf('<div className="relative min-h-0 flex-1', workshopSource.indexOf('data-testid="plugin-workshop-studio"')),
    );

    expect(sidebarSource).toContain("onOpenPluginWorkshop");
    expect(sessionPageSource).toContain("pluginWorkshopSystemInstruction");
    expect(sessionPageSource).toContain('props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId, "work")');
    expect(sessionPageSource).toContain("creationBaselinePluginIds");
    expect(sessionPageSource).toContain("onClick: openPluginWorkshop");
    expect(sessionPageSource).not.toContain("openPluginWorkshopInCurrentSession");
    expect(sessionPageSource).toContain("pluginWorkshopTabId(sessionId)");
    expect(sessionPageSource).toContain('type: "plugin-studio"');
    expect(sessionPageSource).toContain("autoOpenedPluginWorkshopSessionRef");
    expect(sessionPageSource).toContain("if (!props.selectedSessionKnown) return;");
    expect(sessionPageSource).toContain('sessionPanelState.tabs.find((tab) => tab.type === "plugin-studio")');
    expect(sessionPageSource).toContain('setSidePanelState(sessionId, "panel")');
    expect(tabStoreSource).toContain('type: "plugin-studio"');
    expect(tabStoreSource).toContain('tab.type === "plugin-studio"');
    expect(tabStoreSource).toContain("creationBaselinePluginIds");
    expect(sidePanelSource).toContain("<PluginWorkshopPanel");
    expect(workshopSource).toContain("<WorkspaceAppFrame");
    expect(workshopSource).toContain("exportPluginWorkshopProject");
    expect(workshopSource).toContain("importPluginWorkshopProject");
    expect(workshopSource).toContain("plugin_workshop_project_exists");
    expect(workshopSource).toContain("<ConfirmModal");
    expect(workshopSource).toContain('confirmLabel={t("plugin_workshop.overwrite_confirm")}');
    expect(workshopSource).toContain('cancelLabel={t("plugin_workshop.overwrite_cancel")}');
    expect(serverClientSource).toContain('options?.overwrite ? "?overwrite=true" : ""');
    expect(workshopSource).toContain("snapshotRequestGenerationRef.current += 1");
    expect(workshopSource).toContain("requestGeneration !== snapshotRequestGenerationRef.current");
    expect(workshopSource).toContain('const previewRuntimeKey = snapshot ? `${snapshot.project.directoryId}:${snapshot.revision}` : ""');
    expect(workshopSource).toContain("key={previewRuntimeKey}");
    expect(workshopSource).toContain("validatePluginPackageUpload");
    expect(workshopSource).toContain("importPluginPackage");
    expect(workshopSource).toContain("bundle.preparation.localizedUrls");
    expect(workshopSource).toContain("AI_REPAIR_DEBOUNCE_MS = 600");
    expect(workshopSource).toContain("repairRequestLockedRef.current");
    expect(workshopSource).toContain("disabled={repairRequestLocked || props.aiEditing}");
    expect(workshopSource).toContain('t("plugin_workshop.blank_description")');
    expect(workshopSource).toContain('t("plugin_workshop.import_source")');
    expect(workshopSource).toContain('readPluginPackageArchive(file, "source"');
    expect(workshopSource).toContain("accept={PLUGIN_SOURCE_ARCHIVE_EXTENSION}");
    expect(workshopSource).toContain('t("plugin_workshop.select_plugin")');
    expect(selectedToolbarSource).not.toContain('t("plugin_workshop.import_source")');
    expect(selectedToolbarSource).toContain('t("plugin_workshop.export")');
    expect(workshopSource).toContain('exportProject("install")');
    expect(workshopSource).toContain('exportProject("source")');
    expect(workshopSource).toContain('t("plugin_workshop.package_hint")');
    expect(workshopSource).toContain('t("plugin_workshop.source_hint")');
    expect(selectedToolbarSource).toContain('t("plugin_workshop.install")');
  });

  test("opens independent Plugin Workshop tabs without selecting an old project", () => {
    expect(pluginWorkshopTabId("session-a")).toBe("plugin-workshop:session-a");
    expect(pluginWorkshopTabId("session-b")).toBe("plugin-workshop:session-b");
    expect(nextPluginWorkshopLabel(["插件工坊 1", "插件工坊 3"], "插件工坊")).toBe("插件工坊 2");
    expect(findNewPluginWorkshopProjectId(null, ["existing-plugin"])).toBeNull();
    expect(findNewPluginWorkshopProjectId(null, ["session-plugin", "existing-plugin"], {
      preferredIds: new Set(["session-plugin"]),
    })).toBeNull();
    expect(findNewPluginWorkshopProjectId(
      new Set(["session-plugin", "existing-plugin"]),
      ["session-plugin", "existing-plugin"],
      { preferredIds: new Set(["session-plugin"]) },
    )).toBeNull();
    expect(findNewPluginWorkshopProjectId(new Set(["existing-plugin"]), ["new-plugin", "existing-plugin"]))
      .toBe("new-plugin");
    expect(findNewPluginWorkshopProjectId(
      new Set(["existing-plugin"]),
      ["plugin-a", "plugin-b", "existing-plugin"],
      {
        preferredIds: new Set(["plugin-b"]),
        claimedIds: new Set(["plugin-a"]),
        allowUnlinked: false,
      },
    )).toBe("plugin-b");
    expect(findNewPluginWorkshopProjectId(
      new Set(["existing-plugin"]),
      ["plugin-a", "existing-plugin"],
      { allowUnlinked: false },
    )).toBeNull();
    expect([...pluginWorkshopProjectIdsFromPaths([
      "plugins/finance-board/ui/studio.html",
      "C:\\workspace\\plugins\\research.tools\\skills\\SKILL.md",
      "design/session/entry.html",
    ])]).toEqual(["finance-board", "research.tools"]);
  });

  test("scopes uninstalled plugin previews to the workshop conversation", () => {
    const instruction = pluginWorkshopSystemInstruction("finance-board");
    const workshopSource = readFileSync(
      new URL("../src/react-app/domains/session/plugin-workshop/plugin-workshop.tsx", import.meta.url),
      "utf8",
    );
    const workspaceAppSource = readFileSync(
      new URL("../src/react-app/plugin-ui/workspace-app-frame.tsx", import.meta.url),
      "utf8",
    );

    expect(instruction).toContain("development preview only in this Plugin Workshop conversation");
    expect(instruction).toContain("uninstalled development trial");
    expect(instruction).toContain("installation is not required");
    expect(instruction).toContain("ipollowork_workspace_app");
    expect(instruction).toContain("operation=list_tools");
    expect(instruction).toContain("operation=call_tool");
    expect(instruction).toContain("automatic execution target for every normal user message");
    expect(instruction).toContain("The user does not need to say \"try the plugin\"");
    expect(instruction).toContain("edit the selected project first");
    expect(instruction).toContain("developmentPreview.mode");
    expect(instruction).toContain("[hidden] { display: none !important; }");
    expect(instruction).toContain('hostContext["ai.ipollo/workspace"].developmentPreview');
    expect(instruction).toContain("Do not use ipollowork_extension_call for an uninstalled draft");
    expect(workshopSource).toContain("developmentPreview={developmentPreview}");
    expect(workshopSource).toContain('t("plugin_workshop.not_installed")');
    expect(workshopSource).toContain('t("plugin_workshop.selected_hint")');
    expect(workspaceAppSource).toContain("developmentPreview: pluginContext.developmentPreview");
    expect(workspaceAppSource).toContain('data-development-preview={props.developmentPreview ? "plugin-workshop" : undefined}');
    expect(workspaceAppSource).toContain("sameWorkspaceAppRuntimeResource");
    expect(workspaceAppSource).toContain("developmentPreviewRef.current");
    expect(workspaceAppSource).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(workspaceAppSource).not.toContain('key={props.developmentPreview?.revision}');
    expect(workshopSource).toContain("aiEditingRef.current ? 800 : 3_000");
    expect(workshopSource).not.toContain("[props.aiEditing, props.tab.pluginId, refreshSnapshot]");
    expect(workspaceAppSource.indexOf("const connection = bridge.connect(transport);")).toBeLessThan(
      workspaceAppSource.indexOf("iframe.srcdoc = withContentSecurityPolicy(resource);"),
    );
  });

  test("refreshes the selected Plugin Workshop target without duplicating its instruction", () => {
    const initial = mergePluginWorkshopInstruction("Keep this capability context.", "finance-board");
    const refreshed = mergePluginWorkshopInstruction(initial, "ai-data-insights");

    expect(refreshed).toContain("Keep this capability context.");
    expect(refreshed).toContain("plugins/ai-data-insights/");
    expect(refreshed).not.toContain("plugins/finance-board/");
    expect(refreshed.match(/# iPolloWork Plugin Workshop/g)).toHaveLength(1);
  });

  test("does not auto-invoke an unrelated plugin before the workshop selects one", () => {
    const instruction = pluginWorkshopSystemInstruction();

    expect(instruction).toContain("Project mode: CREATE_NEW");
    expect(instruction).toContain("No plugin is selected yet");
    expect(instruction).toContain("Treat every existing plugins/* directory as protected");
    expect(instruction).toContain("Only a right-side selection changes this conversation to EDIT_SELECTED mode");
    expect(instruction).toContain("automatically select only the newly-created directory and open its Studio");
    expect(instruction).not.toContain("automatic execution target for every normal user message");
  });

  test("edits a plugin only after it is selected in the right-side workshop", () => {
    const instruction = pluginWorkshopSystemInstruction("stock-analyst");

    expect(instruction).toContain("Project mode: EDIT_SELECTED");
    expect(instruction).toContain("explicitly selected plugins/stock-analyst/");
    expect(instruction).toContain("only plugin directory you may edit or upgrade");
    expect(instruction).toContain("automatically run one representative request through the new Studio version");
    expect(instruction).not.toContain("Project mode: CREATE_NEW");
  });

  test("keeps a collapsed-sidebar title clear of its expand button", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain('sidebarVisuallyCollapsed && shellConfig.sidebar');
    expect(sessionPageSource).toContain('ml-12 md:ml-10 mac:ml-28 mac:md:ml-[104px]');
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

  test("cache-busts the Studio document when its iframe revision changes", () => {
    expect(hyperframesStudioUrl(3002, "video", "zh", "light", 3)).toBe(
      "http://localhost:3002/?ipwReload=3#project/video?v=1&t=0&tab=design&rc=1&tv=1&locale=zh&ipolloworkTheme=light",
    );
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
    expect(sessionRouteSource).toContain("[projectSystemContext, envSystemContext, ...videoSystemContexts, ...designSystemContexts, ...authoringSystemContexts, capabilitySystemContext, languageSystemContext]");
  });

  test("gives the agent the same session-scoped project as the Studio", () => {
    const contract = videoTaskSystemContext("ses/current video", "/workspace/current");
    expect(contract).toContain("/workspace/current/video/ses_current_video/index.html");
    expect(contract).toContain("prepared blank composition");
    expect(contract).toContain("At the start of every edit turn");
    expect(contract).toContain("Studio manual edits are user-owned source state");
    expect(contract).toContain("data-hf-studio-*");
    expect(contract).toContain("never regenerate from an earlier response or cached HTML snapshot");
    expect(contract).toContain("Never run npm/pnpm/yarn install");
    expect(contract).toContain("Batch compatible HTML/CSS/JS changes into one complete edit or write");
    expect(contract).toContain("use at most two read-only inspection calls before the first mutation or media action");
    expect(contract).toContain("A plan, outline, proposed scene list, or sentence such as 'let me structure' is never task completion");
    expect(contract).toContain("perform the requested edits in the same run");
    expect(contract).toContain("Prefer a smaller complete valid result over an ambitious plan that is never applied");
    expect(contract).toContain("Never create or inspect another `video/`/`videos/` project");
    expect(contract).toContain("Never stop all Node processes");
    expect(contract).toContain("not an HTML/JSON response saved with a media extension");
    expect(contract).toContain("Use `/media-use` to resolve BGM");
    expect(contract).toContain("verify its response type and local file signature");
    expect(contract).toContain("never run `npx hyperframes check`");
    expect(contract).toContain("never use legacy `.frame` millisecond timelines");
    expect(contract).toContain("A 1080×1920 portrait project stays 9:16");
    expect(contract).toContain("never rewrite it to 1920×1080");
    expect(contract).toContain("seconds-based `data-start`");
    expect(contract).toContain("Root `data-duration` must cover the last scene/audio/clip");
    expect(contract).toContain("Delivery requirements contract");
    expect(contract).toContain('data-ipw-caption="true"');
    expect(contract).toContain("Default captions are transparent text overlays in the bottom safe area");
    expect(contract).toContain('data-ipw-caption-style="transparent-bottom"');
    expect(contract).toContain("position:absolute;inset:auto 5% 5%;height:auto");
    expect(contract).toContain('data-ipw-caption-text="true"');
    expect(contract).toContain("do not add padding-backed color, a pill, card, band, or backdrop");
    expect(contract).toContain("unless the user explicitly asks");
    expect(contract).toContain('captionStyle: "transparent-bottom"');
    expect(contract).toContain('captionStyle: "custom"');
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

  test("surfaces a silent provider stall without automatically replaying tools", () => {
    const surfaceSource = readFileSync(
      new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url),
      "utf8",
    );

    expect(surfaceSource).toContain("const STALLED_SESSION_WARNING_MS = 90_000");
    expect(surfaceSource).toContain("if (!chatStreaming || activeToolLabel) return");
    expect(surfaceSource).toContain('kind: "stalled"');
    expect(surfaceSource).toContain('t("session.run_stalled")');
    expect(surfaceSource).toContain("latestAssistantMessageCompleted");
    expect(surfaceSource).toContain('t("session.run_ended_incomplete")');
    expect(surfaceSource).not.toContain("autoRetryStalledSession");
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
    expect(contract).toContain("never write narration to the workspace-root assets directory");
    expect(contract).toContain("directly under the root composition");
    expect(contract).toContain("immutable");
    expect(contract).toContain("compositionPath");
    expect(contract).toContain("audioElementHtml");
    expect(contract).toContain("timelinePatch");
    expect(contract).toContain("cumulative shifts");
    expect(contract).toContain("Keep narrated text visible");
    expect(contract).toContain("voiceover_timeline_validate");
    expect(contract).toContain("not complete when synthesis returns");
    expect(contract).toContain("Never use cross-session search/read to recover this task");
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

  test("parses requested media and final duration into an explicit delivery gate", () => {
    expect(requestedVideoDurationSeconds("最终视频总时长两分钟左右")).toBe(120);
    expect(requestedVideoDurationSeconds("make it about 90 seconds")).toBe(90);
    const requirements = videoDeliveryRequirementsForPrompt({
      promptText: "请做配音字幕并加 BGM，最终视频总时长两分钟左右",
    });
    expect(requirements).toEqual({
      voiceover: true,
      captions: true,
      bgm: true,
      animationReferences: [],
      targetDurationSeconds: 120,
    });
    const contract = videoTaskSystemContext("ses_video_a", "/workspace/current", null, {
      includeVoiceover: true,
      deliveryRequirements: requirements,
    });
    expect(contract).toContain('"targetDurationSeconds":120');
    expect(contract).toContain("preserve them exactly in the validator call");
  });

  test("uses an adaptive operation plan without forcing one video workflow", () => {
    const contract = videoTaskSystemContext("ses_video_a", "/workspace/current");
    expect(contract).toContain("Adaptive execution contract");
    expect(contract).toContain("update-element");
    expect(contract).toContain("freeform-patch");
    expect(contract).toContain("For a small local edit, patch only that element");
    expect(contract).toContain("structural, multi-scene, or narrated edit");
  });

  test("uses an imported video template as an adaptable visual and runtime seed", () => {
    const contract = videoTaskSystemContext("ses_video_a", "/workspace/current", {
      id: "personal.launch-film",
      title: "Launch Film",
      entry: "index.html",
      applyChecklist: ["Replace inherited copy", "Keep the visual language"],
    });
    expect(contract).toContain("source is template `Launch Film`");
    expect(contract).toContain("editable visual and runtime seed");
    expect(contract).toContain("let the content determine scene count, order, and timing");
    expect(contract).toContain("quality and export guidance, not a requirement to retain sample structure");
    expect(contract).toContain("preserve the root composition contract");
    expect(contract).toContain("At the start of every edit turn, re-read the current entry from disk");
    expect(contract).toContain("Replace inherited copy; Keep the visual language");
  });
});
