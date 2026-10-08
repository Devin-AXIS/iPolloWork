import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  hyperframesStudioPort,
  hyperframesStudioUrl,
  shouldInjectVideoTaskContext,
  videoDeliveryRequirementsForPrompt,
  videoDeliveryIntentForPrompt,
  videoProjectDirectory,
  videoProjectId,
  videoProjectPath,
  videoPromptRequiresStoryboardReview,
  videoPromptRequestsFinishedVideo,
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
const videoAuthoringGuidance = [
  "ipollowork-video-studio/SKILL.md",
  ...["video.md", "video-storyboard.md", "video-compose.md", "video-voiceover.md", "video-soundtrack.md", "video-motion-principles.md", "video-acceptance.md"]
    .map(path => `ipollowork-video-studio/references/${path}`),
  ...["storyboard", "compose", "voiceover", "soundtrack"].map(stage => `ipollowork-video-${stage}/SKILL.md`),
].map(path => readFileSync(new URL(`../../../examples/plugin-packages/video-agent/skills/${path}`, import.meta.url), "utf8")).join("\n");

describe("HyperFrames Video Studio", () => {
  test("checks bundled video codecs without blocking on a cloud download", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain("void videoResourceInfo().then");
    expect(panelSource).not.toContain("videoResourceInstall");
    expect(panelSource).not.toContain('setStartupStage("downloading-resources")');
    expect(panelSource).not.toContain('data-testid="video-resource-download-progress"');
    expect(panelSource).toContain("if (!resourcesReady)");
  });

  test("shows avatar preparation failures instead of a waiting placeholder", () => {
    const source = readFileSync(
      new URL("../src/react-app/domains/session/video/video-avatar-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("if (job.message.trim()) return job.message;");
    expect(source).toContain('role={showProgress ? "status" : "alert"}');
    expect(source).toContain("{avatarJobStatusDetail(job)}");
    expect(source).not.toContain('job.status === "succeeded" ? "视频片段已生成" : "正在准备生成"');
  });

  test("preserves image launch context across workspace app resize and theme updates", () => {
    const source = readFileSync(
      new URL("../src/react-app/plugin-ui/workspace-app-frame.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("hostContextRef.current = { ...hostContextRef.current, ...patch }");
    expect(source).toContain("hostContextRef.current = hostContext");
    expect(source.match(/\.setHostContext\(/g)).toHaveLength(1);
    expect(source).toContain("bridgeRef.current.setHostContext(hostContextRef.current)");
    expect(source).toContain("updateHostContext({ theme: currentTheme() })");
    expect(source).toContain('updateHostContext({ displayMode: props.displayMode ?? "inline" })');
  });

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
      new URL(
        "../../../vendor/hyperframes/packages/studio/src/components/nle/PreviewPane.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(sessionPageSource).toContain("aiEditing={selectedSessionStatus");
    expect(sessionPageSource).toContain('selectedSessionStatus.type === "busy"');
    expect(sessionPageSource).toContain(
      "isStreamingSessionStatus(props.sidebar.sessionStatusById[props.selectedSessionId])",
    );
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
    expect(panelSource).toContain("type StudioVoiceSelectionTarget = {");
    expect(panelSource).toMatch(
      /setVoiceSelectionTarget\(\s*Number\.isInteger\(index\)\s*&&\s*index > 0\s*\?\s*\{/,
    );
    expect(panelSource).toContain('type: "ipollowork:video-studio-voice-selected"');
    expect(panelSource).toContain("selectionTarget={voiceSelectionTarget}");
    expect(panelSource).toContain(
      "selectRoleVoice: features.voice && isIPolloWorkServerClient(client)",
    );
    expect(panelSource).toContain('event.data.panel === "style"');
    expect(panelSource).toContain('event.data.panel === "avatar"');
    expect(panelSource).toContain('setStudioHostPanel("avatar")');
    expect(panelSource).toContain(
      "const [studioHostPanel, setStudioHostPanel] = React.useState<StudioHostPanel>(null)",
    );
    expect(panelSource).toContain('setStudioHostPanel("voice")');
    expect(panelSource).toContain('setStudioHostPanel("style")');
    expect(panelSource).toContain("setStudioHostPanel(null)");
    expect(panelSource).not.toContain("voicePanelOpen");
    expect(panelSource).not.toContain("designSystemOpen");
    expect(panelSource).not.toContain('aria-label={t("video.design_system")}');
    expect(panelSource).toContain('data-testid="video-style-tab-content"');
    expect(panelSource).toContain('testId="video-avatar-tab-content"');
    expect(panelSource).toContain("<VideoAvatarPanel");
    expect(panelSource).not.toContain("<DesignSystemInspectorShell");
    expect(panelSource).toContain("`${projectDirectory}/design-tokens.css`");
    expect(panelSource).toContain("ensureHtmlDesignSystemContract(current.content, theme.id)");
    expect(panelSource).toContain("buildTemplateTokenCss(theme)");
    expect(panelSource).toContain("next = replaceDesignTokenValue(next, name, value)");
    expect(panelSource).toContain("handleDesignTokenChanges({ [name]: value })");
    expect(panelSource).toContain('type: "ipollowork:studio-design-token-change"');
    expect(panelSource).not.toContain("variablesDisabled={!appliedDesignSystemId}");
    expect(panelSource).toContain('pickLocalImageFile("选择视频背景图片")');
    expect(panelSource).toContain("readLocalImageAsDataUrl(pickedPath)");
    expect(panelSource).toContain('"--ipw-bg-image": `url(\"${dataUrl}\")`');
    expect(panelSource).toContain(
      "onChooseBackgroundImage={() => void chooseDesignSystemBackgroundImage()}",
    );
    expect(registrySource).toContain("[data-composition-file][data-composition-id]");
    expect(panelSource).toContain("top-[90px]");
  });

  test("patches Video Studio theme tokens live without remounting the preview iframe", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );
    const previewPersistenceSource = readFileSync(
      new URL(
        "../../../vendor/hyperframes/packages/studio/src/hooks/usePreviewPersistence.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(panelSource).toContain("const syncStudioDesignTokens = React.useCallback");
    expect(panelSource).toContain(
      "syncStudioDesignTokens(parseDesignTokenValues(nextTokens), nextTokens)",
    );
    expect(panelSource).toContain("key={`${sessionId}:${revision}`}");
    expect(panelSource).not.toContain("key={`${sessionId}:${revision}:${studioHostPanel}`}");
    expect(previewPersistenceSource).toContain("parseHostDesignTokensMessage");
    expect(previewPersistenceSource).toContain("applyDesignTokensToPreview");
    expect(previewPersistenceSource).toContain(
      "doc.documentElement.style.setProperty(name, value)",
    );
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
    expect(registrySource).toContain(
      "calc(var(${storageName}) * var(--ipw-type-scale)) !important",
    );
    expect(registrySource).toContain("body :where(*):not(svg):not(svg *)");
    expect(registrySource).toContain(
      ".title, .title *, .headline, .headline *, .heading, .heading *",
    );
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
      new URL(
        "../../../vendor/hyperframes/packages/studio/src/hooks/useStudioUrlState.ts",
        import.meta.url,
      ),
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
    expect(desktopSource).not.toContain(
      "const current = document.querySelector('button[aria-label=\"Inspector\"]')",
    );
    expect(studioSource).toContain(
      'const loadStudioRightPanelModule = () => import("./components/StudioRightPanel")',
    );
    expect(studioSource).toContain("void loadStudioRightPanel()");
    expect(studioSource).toContain(
      "function RightPanelLoadingFallback({ width }: { width: number })",
    );
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
    expect(desktopSource.slice(advancedBranchStart, advancedBranchEnd)).toContain(
      "showToolbar(selected)",
    );
    expect(desktopSource.slice(advancedBranchStart, advancedBranchEnd)).not.toContain(
      "toolbar.style.display = 'none'",
    );

    expect(urlStateSource).toContain('window.addEventListener("ipollowork:studio-apply-selection"');
    expect(urlStateSource).toContain('setRightPanelTab("design")');
    expect(urlStateSource).toContain("setRightCollapsed(false)");
    expect(urlStateSource.indexOf('setRightPanelTab("design")')).toBeLessThan(
      urlStateSource.indexOf("applyUrlSelection(command.selection)"),
    );
  });

  test("deletes selected canvas elements optimistically and refreshes once after persistence", () => {
    const desktopSource = readFileSync(
      new URL("../../../apps/desktop/electron/main.mjs", import.meta.url),
      "utf8",
    );
    const lifecycleSource = readFileSync(
      new URL(
        "../../../vendor/hyperframes/packages/studio/src/hooks/useElementLifecycleOps.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const commitsSource = readFileSync(
      new URL(
        "../../../vendor/hyperframes/packages/studio/src/hooks/useDomEditCommits.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(lifecycleSource).toContain("function removeLivePreviewElement");
    expect(lifecycleSource).toContain("findElementForSelection(doc, selection, activeCompPath)");
    expect(lifecycleSource).toContain(
      "parent.insertBefore(element, nextSibling?.parentNode === parent ? nextSibling : null)",
    );
    expect(lifecycleSource).toContain("const requestPreviewRefresh = () => {");
    expect(lifecycleSource).toContain("if (!previewRefreshRequested && loadingShown)");
    expect(lifecycleSource).not.toContain("if (!liveRemoval) reloadPreview()");
    expect(lifecycleSource).not.toContain("forceReloadSdkSession?.();\n        reloadPreview();");
    expect(commitsSource).toContain("previewIframeRef,");
    const deleteFunctionStart = desktopSource.indexOf(
      "const deleteSelectedElement = async () => {",
    );
    const deleteFunctionEnd = desktopSource.indexOf(
      "const displayScale = () => {",
      deleteFunctionStart,
    );
    expect(deleteFunctionStart).toBeGreaterThan(-1);
    expect(deleteFunctionEnd).toBeGreaterThan(deleteFunctionStart);
    const deleteFunctionSource = desktopSource.slice(deleteFunctionStart, deleteFunctionEnd);
    expect(desktopSource).toContain("data-ipollowork-delete-pending");
    expect(deleteFunctionSource).toContain(
      "element.setAttribute('data-ipollowork-delete-pending', 'true')",
    );
    expect(deleteFunctionSource).toContain(
      "element.removeAttribute('data-ipollowork-delete-pending')",
    );
    expect(deleteFunctionSource).not.toContain(
      "postEditorMessage({ type: 'ipollowork:hyperframes:close-side-panels' });",
    );
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

    expect(panelSource).toMatch(
      /setStudioPanelWidth\([\s\S]*?MIN_STUDIO_PANEL_WIDTH[\s\S]*?MAX_STUDIO_PANEL_WIDTH[\s\S]*?event\.data\.width[\s\S]*?\);/,
    );
    expect(panelSource).toContain("embeddedWidth={studioPanelWidth}");
    expect(panelSource).toContain("style={{ width: studioPanelWidth }}");
    expect(voiceSource).toContain("width={inDialog ? undefined : embedded ? embeddedWidth : undefined}");
    expect(panelSource).toContain("top-[90px]");
    expect(voiceSource).toContain("top-[148px]");
    expect(panelSource).not.toContain("top-[82px]");
    expect(voiceSource).not.toContain("top-[82px]");
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
      new URL(
        "../../../vendor/hyperframes/packages/studio/src/components/StudioHeader.tsx",
        import.meta.url,
      ),
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

    expect(panelSource).toMatch(
      /const showStudioStartupOverlay\s*=\s*status === "starting" \|\| \(status === "ready" && !studioChromeReady\)/,
    );
    expect(panelSource).toContain("{showStudioStartupOverlay ? (");
    expect(panelSource).toContain("absolute inset-0 z-10 grid place-items-center");
    expect(panelSource).toContain(
      'data-loading-covered={showStudioStartupOverlay ? "true" : "false"}',
    );
    expect(panelSource).toContain("key={`${sessionId}:${revision}`}");
    expect(panelSource).not.toContain('studioChromeReady ? "opacity-100" : "opacity-0"');
    expect(panelSource.indexOf("setStudioChromeReady(true)")).toBeLessThan(
      panelSource.indexOf("scheduleStudioLocaleSync()"),
    );
  });

  test("debounces source saves and lazy-loads optional Studio panels", () => {
    const saveSource = readFileSync(
      new URL(
        "../../../vendor/hyperframes/packages/studio/src/hooks/useEditorSave.ts",
        import.meta.url,
      ),
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
      new URL(
        "../../../vendor/hyperframes/packages/studio/src/components/StudioHeader.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const queueSource = readFileSync(
      new URL(
        "../../../vendor/hyperframes/packages/studio/src/components/renders/RenderQueue.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(headerSource).toContain('setRightPanelTab("renders")');
    expect(headerSource).toContain("setRightCollapsed(false)");
    expect(headerSource).not.toContain("onExport?.()");
    expect(queueSource).toContain("if (exportBusy) return");
    expect(queueSource).toContain(
      "onStartRender(format, quality, outputResolution, fps, outputSize, captureSize)",
    );
  });

  test("hides properties and export actions while previewing", () => {
    const headerSource = readFileSync(
      new URL(
        "../../../vendor/hyperframes/packages/studio/src/components/StudioHeader.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(headerSource).toContain("{!previewMode && !scriptMode ? (");
    expect(headerSource.indexOf("{!previewMode ? (")).toBeLessThan(
      headerSource.indexOf("onClick={toggleProperties}"),
    );
    expect(headerSource.indexOf("{!previewMode ? (")).toBeLessThan(
      headerSource.indexOf("onClick={openExport}"),
    );
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
    const appStyles = readFileSync(new URL("../src/app/index.css", import.meta.url), "utf8");

    expect(sidePanelSource).toMatch(
      /<div className="[^"\n]*\bpx-2\b[^"\n]*\bmac:titlebar-drag\b[^"\n]*"/,
    );
    expect(artifactPanelSource).toContain("ps-4 mac:titlebar-drag");
    expect(sidebarSource).toContain(
      'SidebarHeader className="gap-3 px-2 pb-3 pt-1 mac:titlebar-drag"',
    );
    expect(appStyles).toContain("[data-titlebar-no-drag]");
    expect(appStyles).toContain('[role="tab"]');
    expect(appStyles).toContain("-webkit-app-region: no-drag;");
  });

  test("keeps Video Studio shell copy localized", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain("title: string;");
    expect(panelSource).toContain('type: "ipollowork:studio-host-context"');
    expect(panelSource).toContain("designSystem: appliedDesignSystemTheme");
    expect(panelSource).toContain("designSystemThemes: DESIGN_SYSTEM_THEMES.map");
    expect(panelSource).toContain('event.data?.type !== "ipollowork:video-studio-select-theme"');
    expect(panelSource).toContain("openDesignSystem: features.designSystem");
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
      new URL(
        "../../../vendor/hyperframes/packages/studio/src/components/StudioHeader.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(panelSource).not.toContain('<header className="flex h-11');
    expect(panelSource).toContain('event.data?.type !== "ipollowork:studio-host-action"');
    expect(studioHeaderSource).toContain(
      'className="hf-studio-header-utilities flex items-center gap-1"',
    );
    expect(studioHeaderSource).toContain('t("header.saveAsTemplate")');
    expect(studioHeaderSource).toContain(
      '<Save className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />',
    );
    expect(studioHeaderSource.indexOf('t("header.saveAsTemplate")')).toBeLessThan(
      studioHeaderSource.indexOf('t("header.inspector")'),
    );
  });

  test("keeps voice dropdowns aligned to their field edges", () => {
    const voicePanelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-voice-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(voicePanelSource.match(/<SelectContent align="start"/g)).toHaveLength(3);
    expect(voicePanelSource).not.toContain("alignItemWithTrigger");
  });

  test("defers remote voice inventory until the user opens My voices", () => {
    const voicePanelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-voice-panel.tsx", import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n");
    const initialLoadStart = voicePanelSource.indexOf(
      "  React.useEffect(() => {\n    let cancelled = false;\n    setLoading(true);",
    );
    const deferredLoadStart = voicePanelSource.indexOf(
      '  React.useEffect(() => {\n    if (activeTab !== "mine"',
    );
    const initialLoad = voicePanelSource.slice(initialLoadStart, deferredLoadStart);

    expect(initialLoadStart).toBeGreaterThan(-1);
    expect(deferredLoadStart).toBeGreaterThan(initialLoadStart);
    expect(initialLoad).not.toContain('callMedia("voice_list"');
    expect(initialLoad).not.toContain('callStorage("status"');
    expect(voicePanelSource).toContain('if (activeTab !== "mine"');
    expect(voicePanelSource).toContain("await loadCustomVoices();");
  });

  test("allows voice cloning without requiring separately configured object storage", () => {
    const voicePanelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-voice-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(voicePanelSource).not.toContain('callStorage("status"');
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
    expect(sessionPageSource).toContain(
      'rightWorkspaceExpanded && "invisible pointer-events-none"',
    );
    expect(sessionPageSource).toContain("onOpenSession={handleSidebarOpenSession}");
    expect(sessionPageSource).toContain(
      "onOpenSessionSearch={props.sidebar.onOpenSessionSearch ? handleSidebarOpenSessionSearch : undefined}",
    );
    expect(sessionPageSource).toContain(
      'left: shellConfig.sidebar && sidebarOpen ? `${effectiveLeftSidebarWidth}px` : "0"',
    );
    expect(sessionPageSource).toContain(
      "rightPanelExpanded && (!shellConfig.sidebar || !sidebarOpen)",
    );
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

    const restoreIndex = sessionPageSource.indexOf(
      "if (rightPanelExpanded) setRightPanelExpanded(false)",
    );
    const focusIndex = sessionPageSource.indexOf(
      'window.dispatchEvent(new Event("ipollowork:focusPrompt"))',
      restoreIndex,
    );
    expect(restoreIndex).toBeGreaterThan(-1);
    expect(focusIndex).toBeGreaterThan(restoreIndex);
    expect(sessionPageSource.slice(restoreIndex, focusIndex)).toContain(
      "window.requestAnimationFrame",
    );
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
    expect(sessionPageSource).not.toContain(
      'rightWorkspaceExpanded && "**:data-[slot=sidebar-gap]:!w-0"',
    );
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
      new URL(
        "../../../vendor/hyperframes/packages/studio/src/components/nle/PreviewTextSelectionToolbar.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const nativeAiPromptSource = readFileSync(
      new URL(
        "../../../vendor/hyperframes/packages/studio/src/components/editor/domEditingAgentPrompt.ts",
        import.meta.url,
      ),
      "utf8",
    );

    const deleteIndex = electronSource.indexOf('<button type="button" data-action="delete"');
    const advancedIndex = electronSource.indexOf('data-action="advanced"');
    const aiIndex = electronSource.indexOf('data-action="ai"');
    const nativeDeleteIndex = nativeToolbarSource.indexOf(
      'aria-label={tx("Delete selected element")}',
    );
    const nativeAdvancedIndex = nativeToolbarSource.indexOf(
      'aria-label={tx("Open Design properties")}',
    );
    const nativeAiIndex = nativeToolbarSource.indexOf(
      'aria-label={tx("Ask AI about selected element")}',
    );

    expect(deleteIndex).toBeGreaterThan(-1);
    expect(aiIndex).toBeGreaterThan(advancedIndex);
    expect(deleteIndex).toBeGreaterThan(aiIndex);
    expect(electronSource).toContain("/file-mutations/remove-element/");
    expect(electronSource).toContain("deleteSelectedElement");
    expect(electronSource).toContain("ipollowork:hyperframes:ask-ai-selection");
    expect(electronSource).toContain("selectedAiPayload");
    expect(electronSource).toContain(
      "const hfId = element.getAttribute('data-hf-id') || undefined",
    );
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
    const applyTheme =
      panelSource.match(
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
    expect(applyTheme).toContain(
      "if (themedHtml === current.content && nextTokens === currentTokenCss)",
    );
    expect(applyTheme.indexOf("await recordStudioHostEdit")).toBeGreaterThan(
      applyTheme.indexOf("await client.writeWorkspaceFile"),
    );
  });

  test("rebuilds the embedded Studio when its source is newer than the bundled UI", () => {
    const electronDevSource = readFileSync(
      new URL("../../../apps/desktop/scripts/electron-dev.mjs", import.meta.url),
      "utf8",
    );

    expect(electronDevSource).toContain(
      'const hyperframesStudioBuild = resolve(hyperframesRoot, "packages", "cli", "dist", "studio", "index.html")',
    );
    expect(electronDevSource).toContain("newestBuildInputTime > studioBuildTime");
    expect(electronDevSource).toContain('runSync(bunCmd, ["run", "build:local-studio"]');
  });

  test("opens the session project even when Electron inherits another working directory", () => {
    const electronSource = readFileSync(
      new URL("../../../apps/desktop/electron/main.mjs", import.meta.url),
      "utf8",
    );

    expect(electronSource).toContain(
      'spawnLocalHyperframes(["preview", projectPath, "--port", String(allocatedPort), "--no-open"], projectPath)',
    );
    expect(electronSource).toContain("reserveHyperframesPort(port, key)");
    expect(electronSource).not.toContain("stopStaleHyperframesPort(port, projectPath)");
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
      new URL(
        "../../../vendor/hyperframes/packages/studio/src/components/StudioHeader.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(tabStoreSource).toContain('type: "video"');
    expect(tabStoreSource).toContain(
      'tab.type === "artifact" || tab.type === "design" || tab.type === "video"',
    );
    expect(sessionPageSource).toContain("id: videoTabId");
    expect(sessionPageSource).toContain('type: "video"');
    expect(sessionPageSource).toContain(
      'setSidePanelState(props.selectedSessionId ?? sessionId, "panel")',
    );
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
      new URL(
        "../src/react-app/domains/session/plugin-workshop/plugin-workshop.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const serverClientSource = readFileSync(
      new URL("../src/app/lib/ipollowork-server.ts", import.meta.url),
      "utf8",
    );
    const selectedToolbarSource = workshopSource.slice(
      workshopSource.indexOf('data-testid="plugin-workshop-studio"'),
      workshopSource.indexOf(
        '<div className="relative min-h-0 flex-1',
        workshopSource.indexOf('data-testid="plugin-workshop-studio"'),
      ),
    );

    expect(sidebarSource).toContain("onOpenPluginWorkshop");
    expect(sessionPageSource).toContain("pluginWorkshopSystemInstruction");
    expect(sessionPageSource).toContain(
      'props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId, "work")',
    );
    expect(sessionPageSource).toContain("creationBaselinePluginIds");
    expect(sessionPageSource).toContain("onClick: openPluginWorkshop");
    expect(sessionPageSource).not.toContain("openPluginWorkshopInCurrentSession");
    expect(sessionPageSource).toContain("pluginWorkshopTabId(sessionId)");
    expect(sessionPageSource).toContain('type: "plugin-studio"');
    expect(sessionPageSource).toContain("autoOpenedPluginWorkshopSessionRef");
    expect(sessionPageSource).toContain("if (!props.selectedSessionKnown) return;");
    expect(sessionPageSource).toContain(
      'sessionPanelState.tabs.find((tab) => tab.type === "plugin-studio")',
    );
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
    expect(workshopSource).toContain(
      'const previewRuntimeKey = snapshot ? `${snapshot.project.directoryId}:${snapshot.revision}` : ""',
    );
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
    expect(
      findNewPluginWorkshopProjectId(null, ["session-plugin", "existing-plugin"], {
        preferredIds: new Set(["session-plugin"]),
      }),
    ).toBeNull();
    expect(
      findNewPluginWorkshopProjectId(
        new Set(["session-plugin", "existing-plugin"]),
        ["session-plugin", "existing-plugin"],
        { preferredIds: new Set(["session-plugin"]) },
      ),
    ).toBeNull();
    expect(
      findNewPluginWorkshopProjectId(new Set(["existing-plugin"]), [
        "new-plugin",
        "existing-plugin",
      ]),
    ).toBe("new-plugin");
    expect(
      findNewPluginWorkshopProjectId(
        new Set(["existing-plugin"]),
        ["plugin-a", "plugin-b", "existing-plugin"],
        {
          preferredIds: new Set(["plugin-b"]),
          claimedIds: new Set(["plugin-a"]),
          allowUnlinked: false,
        },
      ),
    ).toBe("plugin-b");
    expect(
      findNewPluginWorkshopProjectId(
        new Set(["existing-plugin"]),
        ["plugin-a", "existing-plugin"],
        { allowUnlinked: false },
      ),
    ).toBeNull();
    expect([
      ...pluginWorkshopProjectIdsFromPaths([
        "plugins/finance-board/ui/studio.html",
        "C:\\workspace\\plugins\\research.tools\\skills\\SKILL.md",
        "design/session/entry.html",
      ]),
    ]).toEqual(["finance-board", "research.tools"]);
  });

  test("scopes uninstalled plugin previews to the workshop conversation", () => {
    const instruction = pluginWorkshopSystemInstruction("finance-board");
    const workshopSource = readFileSync(
      new URL(
        "../src/react-app/domains/session/plugin-workshop/plugin-workshop.tsx",
        import.meta.url,
      ),
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
    expect(instruction).toContain('The user does not need to say "try the plugin"');
    expect(instruction).toContain("edit the selected project first");
    expect(instruction).toContain("developmentPreview.mode");
    expect(instruction).toContain("[hidden] { display: none !important; }");
    expect(instruction).toContain('hostContext["ai.ipollo/workspace"].developmentPreview');
    expect(instruction).toContain("Do not use ipollowork_extension_call for an uninstalled draft");
    expect(workshopSource).toContain("developmentPreview={developmentPreview}");
    expect(workshopSource).toContain('t("plugin_workshop.not_installed")');
    expect(workshopSource).toContain('t("plugin_workshop.selected_hint")');
    expect(workspaceAppSource).toContain("developmentPreview: pluginContext.developmentPreview");
    expect(workspaceAppSource).toContain(
      'data-development-preview={props.developmentPreview ? "plugin-workshop" : undefined}',
    );
    expect(workspaceAppSource).toContain("sameWorkspaceAppRuntimeResource");
    expect(workspaceAppSource).toContain("developmentPreviewRef.current");
    expect(workspaceAppSource).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(workspaceAppSource).not.toContain("key={props.developmentPreview?.revision}");
    expect(workshopSource).toContain("aiEditingRef.current ? 800 : 3_000");
    expect(workshopSource).not.toContain("[props.aiEditing, props.tab.pluginId, refreshSnapshot]");
    expect(
      workspaceAppSource.indexOf("const connection = bridge.connect(transport);"),
    ).toBeLessThan(
      workspaceAppSource.indexOf("iframe.srcdoc = withContentSecurityPolicy(resource);"),
    );
  });

  test("refreshes the selected Plugin Workshop target without duplicating its instruction", () => {
    const initial = mergePluginWorkshopInstruction(
      "Keep this capability context.",
      "finance-board",
    );
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
    expect(instruction).toContain(
      "Only a right-side selection changes this conversation to EDIT_SELECTED mode",
    );
    expect(instruction).toContain(
      "automatically select only the newly-created directory and open its Studio",
    );
    expect(instruction).not.toContain("automatic execution target for every normal user message");
  });

  test("edits a plugin only after it is selected in the right-side workshop", () => {
    const instruction = pluginWorkshopSystemInstruction("stock-analyst");

    expect(instruction).toContain("Project mode: EDIT_SELECTED");
    expect(instruction).toContain("explicitly selected plugins/stock-analyst/");
    expect(instruction).toContain("only plugin directory you may edit or upgrade");
    expect(instruction).toContain(
      "automatically run one representative request through the new Studio version",
    );
    expect(instruction).not.toContain("Project mode: CREATE_NEW");
  });

  test("keeps a collapsed-sidebar title clear of its expand button", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain("sidebarVisuallyCollapsed && shellConfig.sidebar");
    expect(sessionPageSource).toContain("ml-12 md:ml-10 mac:ml-28 mac:md:ml-[104px]");
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
    expect(sessionPageSource).not.toContain(
      "if (sidePanelOpen) {\n      autoCollapsedSidePanelRef.current = effectiveSidePanelView;",
    );
    expect(sessionPageSource).toContain(
      "if (sidebarOpen && userOpenedSidebarWhileNarrowRef.current) return;",
    );
    expect(sessionPageSource).toContain(
      "restoredPanel &&\n      !userOpenedSidebarWhileNarrowRef.current &&\n      !sidePanelOpen",
    );
    expect(sessionPageSource).toContain("onClick={openLeftSidebar}");
  });

  test("uses coordinated shell transitions for the left and right sidebars", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain("const SESSION_SHELL_TRANSITION_MS = 220");
    expect(sessionPageSource).toContain(
      'const SESSION_SHELL_TRANSITION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"',
    );
    expect(sessionPageSource).toContain("const sessionShellTransition =");
    expect(sessionPageSource).toContain("rightPanelTransitionStyle");
    expect(sessionPageSource).toContain('rightPanelResizing ? "none" : sessionShellTransition');
    expect(sessionPageSource).toContain("transition-[width,min-width,opacity]");
    expect(sessionPageSource).toContain("**:data-[slot=sidebar-container]:duration-[220ms]");
    expect(sessionPageSource).not.toContain(
      'rightWorkspaceExpanded && "**:data-[slot=sidebar-gap]:!w-0"',
    );
  });

  test("uses a low-contrast themed boundary beside Video Studio", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain("border-r border-border/40 dark:border-white/[0.055]");
    expect(sessionPageSource).not.toContain("border-[#EAEAEA]");
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

    expect(sessionPageSource).not.toContain(
      "if (panel) {\n      userOpenedSidebarWhileNarrowRef.current = false;",
    );
    expect(sessionPageSource).toContain(
      "const toggleCurrentSidePanel = useCallback((panel: SidePanelItem) => {\n    userOpenedSidebarWhileNarrowRef.current = false;",
    );
    expect(sessionPageSource).toContain(
      "userOpenedSidebarWhileNarrowRef.current = false;\n    userOpenedSidePanelWhileNarrowRef.current = true;",
    );
  });

  test("opens the native Studio on a hydrated first frame", () => {
    expect(hyperframesStudioUrl()).toBe(
      "http://localhost:3002/#project/video?v=1&t=0&tab=design&rc=1&tv=1",
    );
  });

  test("passes the app locale through the Studio hash route", () => {
    expect(hyperframesStudioUrl(3002, "video", "zh")).toBe(
      "http://localhost:3002/#project/video?v=1&t=0&tab=design&rc=1&tv=1&locale=zh",
    );
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
    expect(videoProjectPath("ses/current video", "/workspace/current/")).toBe(
      "/workspace/current/video/ses_current_video",
    );
    expect(videoProjectPath("ses/current video", "/")).toBe("/video/ses_current_video");
    expect(videoProjectPath("ses/current video", "C:\\workspace\\current\\")).toBe(
      "C:\\workspace\\current\\video\\ses_current_video",
    );
  });

  test("assigns a stable session-specific Studio port", () => {
    expect(hyperframesStudioPort("ses_video_a")).toBe(hyperframesStudioPort("ses_video_a"));
    expect(hyperframesStudioPort("ses_video_a")).not.toBe(hyperframesStudioPort("ses_video_b"));
    expect(
      hyperframesStudioUrl(hyperframesStudioPort("ses_video_a"), videoProjectId("ses_video_a")),
    ).toBe(
      `http://localhost:${hyperframesStudioPort("ses_video_a")}/#project/ses_video_a?v=1&t=0&tab=design&rc=1&tv=1`,
    );
  });

  test("keeps legacy Video Studio sessions on the video task contract", () => {
    expect(shouldInjectVideoTaskContext("video", "work")).toBe(true);
    expect(shouldInjectVideoTaskContext(null, "video")).toBe(true);
    expect(shouldInjectVideoTaskContext("design", "video")).toBe(false);
    expect(shouldInjectVideoTaskContext(null, "work")).toBe(false);
  });

  test("treats social publication and MP4 export as unfinished video delivery", () => {
    expect(videoDeliveryIntentForPrompt("给我做一个介绍 iPolloWork 的短视频，然后发布到抖音")).toBe("publish-douyin");
    expect(videoDeliveryIntentForPrompt("给我做一个介绍 iPolloWork 的短视频并发布到微信视频号")).toBe("publish-wechat-channels");
    expect(videoDeliveryIntentForPrompt("Create this video and publish it to WeChat Channels")).toBe("publish-wechat-channels");
    expect(videoDeliveryIntentForPrompt("请导出这个视频为 MP4")).toBe("export");
    expect(videoDeliveryIntentForPrompt("全程自动发布到抖音，不要手动导出")).toBe("publish-douyin");
    expect(videoDeliveryIntentForPrompt("只修改这个视频的标题，不要发布到抖音")).toBeNull();
    expect(videoDeliveryIntentForPrompt("只生成视频，不要发布到视频号")).toBeNull();
    expect(videoDeliveryIntentForPrompt("只做一个可编辑视频")).toBeNull();
    expect(videoDeliveryIntentForPrompt("只保存供内置播放的源文件，不需要MP4导出或发布。")).toBeNull();
    expect(videoDeliveryIntentForPrompt("不需要MP4导出或发布到抖音，只保存源文件。")).toBeNull();
    expect(videoDeliveryIntentForPrompt("Save editable source only, no need to export MP4 or publish to WeChat Channels.")).toBeNull();
    expect(videoDeliveryIntentForPrompt("不要发布到抖音，改为发布到视频号。")).toBe("publish-wechat-channels");
    expect(videoDeliveryIntentForPrompt("导出MP4，不要发布到抖音。")).toBe("export");
    const contract = videoTaskSystemContext("ses_video", "/workspace");
    expect(contract).toContain("your native plan, tools and subagents");
    expect(contract).not.toContain("The iPolloWork host");
    expect(contract).toContain("installed iPolloWork tools");
    expect(contract).not.toContain("Export directly with ipollowork_extension_call");
  });


  test("arms finished-video delivery for a plain conversation request", () => {
    expect(videoPromptRequestsFinishedVideo("请用 Video Studio 生成一条完整可编辑的中文概念讲解视频")).toBe(true);
    expect(videoPromptRequestsFinishedVideo("做一个 40 秒的讲解短片")).toBe(true);
    expect(videoPromptRequestsFinishedVideo("先给我看脚本，再生成视频")).toBe(false);
    expect(videoPromptRequestsFinishedVideo("只写分镜，暂时不要制作视频")).toBe(false);
    expect(videoPromptRequestsFinishedVideo("为什么视频效果不够好？")).toBe(false);
    const surfaceSource = readFileSync(new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url), "utf8");
    expect(surfaceSource).not.toContain("validatePendingVideoDelivery");
    const routeSource = readFileSync(new URL("../src/react-app/shell/session-route.tsx", import.meta.url), "utf8");
    expect(routeSource).toContain("requireStoryboardReview: requiresStoryboardReview");
  });

  test("injects the Video Studio contract before animation guidance", () => {
    const sessionRouteSource = readFileSync(
      new URL("../src/react-app/shell/session-route.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionRouteSource).toContain("shouldInjectVideoTaskContext(");
    expect(sessionRouteSource).toContain("videoTaskSystemContext(");
    expect(sessionRouteSource).toContain("text: draft.capability.instruction");
    expect(sessionRouteSource).not.toContain("capabilitySystemContext");
    expect(sessionRouteSource).toContain(
      "[projectSystemContext, envSystemContext, ...videoSystemContexts, ...designSystemContexts, ...authoringSystemContexts, languageSystemContext]",
    );
  });

  test("gives the agent the same session-scoped project as the Studio", () => {
    const contract = videoTaskSystemContext("ses/current video", "/workspace/current");
    expect(contract).toContain("/workspace/current/video/ses_current_video/index.html");
    expect(contract).toContain("prepared blank composition");
    expect(contract).toContain("Read ipollowork-video-studio once");
    expect(contract).toContain("Read the current entry before editing and immediately before replacement");
    expect(contract).toContain("merge user edits");
    expect(contract).toContain("Save a complete replacement atomically");
    expect(contract).toContain("Never create or inspect another session's project");
    expect(contract).toContain("do not install runtimes");
    expect(contract).toContain("stop Node processes");
    expect(contract).toContain("Use your native plan, tools and subagents");
    expect(contract).toContain("does not continue or repair the task after you stop");
    expect(contract).toContain("requirements");
    expect(contract.length).toBeLessThan(4800);
    for (const field of ["data-hf-studio", ".scene.clip", "data-ipw-beats", "data-ipw-caption", "data-ipw-bgm", "data-timeline-role"])
      expect(videoAuthoringGuidance).toContain(field);
  });

  test("continues explicit publication through the session-owned render API without manual export", () => {
    const contract = videoTaskSystemContext("ses_auto_publish", "C:/workspace");
    expect(contract).toContain("media/video_render_start");
    expect(contract).toContain("video_render_status");
    expect(contract).toContain('sourcePath:"video/ses_auto_publish/index.html"');
    expect(contract).toContain("never start a duplicate after a wait timeout");
    expect(contract).toContain("Export-only requests do not authorize publication");
    expect(contract).toContain("Never re-submit an uncertain publication");
    expect(contract).toContain("failed/cancelled render");
    expect(contract).toContain("account-specific browser job");
    const surfaceSource = readFileSync(new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url), "utf8");
  });

  test("surfaces a silent provider stall without automatically replaying tools", () => {
    const surfaceSource = readFileSync(
      new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url),
      "utf8",
    );

    expect(surfaceSource).toContain("const STALLED_SESSION_WARNING_MS = 90_000");
    expect(surfaceSource).toContain("if (!chatStreaming) return");
    expect(surfaceSource).not.toContain("if (!chatStreaming || activeToolLabel) return");
    expect(surfaceSource).toContain('kind: "stalled"');
    expect(surfaceSource).toContain('t("session.run_stalled")');
    expect(surfaceSource).toContain("latestAssistantMessageCompleted");
    expect(surfaceSource).toContain('t("session.run_ended_incomplete")');
    expect(surfaceSource).not.toContain("autoRetryStalledSession");
  });

  test("gives video agents the selected Studio voice without forcing narration", () => {
    const contract = videoTaskSystemContext("ses/current video", "/workspace/current", null, { includeVoiceover: true });
    expect(contract).toContain("Read ipollowork-video-voiceover once");
    expect(contract).toContain("/workspace/current/video/ses_current_video/voiceover.json");
    expect(contract).toContain("speech_synthesize_workspace_batch defaults");
    expect(contract).toContain("video/ses_current_video/assets");
    expect(contract).toContain("preserve explicit enabled=false");
    expect(contract).toContain("finish mounting the returned audio/captions");
    expect(contract.length).toBeLessThan(4800);
    for (const field of ["wordTimings", "captionElementsHtml", "audioElementHtml", "timelinePatch", "totalShiftSeconds", "voice_id", "voice_model", "data-ipw-narration-source", "data-ipw-narration-binding", "data-ipw-caption-text", "window.__timelines"])
      expect(videoAuthoringGuidance).toContain(field);
  });

  test("loads narration and caption guidance only for the current production stage", () => {
    const visualContract = videoTaskSystemContext("ses_video_a", "/workspace/current");
    const voiceContract = videoTaskSystemContext("ses_video_a", "/workspace/current", null, {
      includeVoiceover: true,
    });
    expect(visualContract).toContain("No voiceover Skill preload or new synthesis is needed for the current stage");
    expect(visualContract).toContain("Read ipollowork-video-studio once");
    expect(visualContract).not.toContain("ipollowork-video-compose");
    expect(visualContract).not.toContain("ipollowork-video-soundtrack");
    expect(visualContract).toContain("Video Studio's voice panel");
    expect(visualContract).not.toContain("speech_synthesize_workspace_batch");
    expect(voiceContract).toContain("speech_synthesize_workspace_batch");
    expect(voiceContract).toContain("When narration/caption production begins");
    expect(visualContract.length).toBeLessThan(voiceContract.length);
    expect(videoPromptRequestsVoiceoverContext("video-voice-reference", "")).toBe(true);
    expect(videoPromptRequestsVoiceoverContext("video-delivery-recovery", "")).toBe(false);
    expect(videoPromptRequestsVoiceoverContext(undefined, "请给这个视频添加旁白")).toBe(true);
    expect(videoPromptRequestsVoiceoverContext(undefined, "Make the second scene longer")).toBe(
      false,
    );
    const preservedNarration = { voiceover: true, captions: false };
    for (const prompt of ["Change only the theme", "只调整背景音乐", "换一个配乐，不要旁白", "只生成BGM，无需TTS", "保留现有旁白，只换音乐", "不改旁白，把背景改成蓝色", "Keep existing narration and change the theme", "先写含旁白的分镜", "Only plan the storyboard", "只给我规划"]) {
      expect(videoPromptRequestsVoiceoverContext(undefined, prompt, preservedNarration)).toBe(false);
    }
    for (const prompt of ["只修改分镜里的旁白声音", "Only dub the script"]) {
      expect(videoPromptRequiresStoryboardReview({ promptText: prompt })).toBe(false);
      expect(videoPromptRequestsVoiceoverContext(undefined, prompt, preservedNarration)).toBe(true);
    }
    expect(videoPromptRequiresStoryboardReview({ promptText: "先规划视频，然后继续制作成片" })).toBe(false);
    for (const prompt of ["Only plan the storyboard", "只给我规划"]) {
      expect(videoPromptRequiresStoryboardReview({ promptText: prompt })).toBe(true);
    }
    expect(videoPromptRequestsVoiceoverContext(undefined, "制作完整的视频", preservedNarration)).toBe(true);
    expect(videoPromptRequestsVoiceoverContext(undefined, "保留第一幕旁白，第三幕重新配音", preservedNarration)).toBe(true);
    expect(videoPromptRequestsVoiceoverContext("video-storyboard-regeneration", "", preservedNarration)).toBe(true);
    expect(videoPromptRequestsVoiceoverContext("video-storyboard-regeneration", "先写分镜，暂不制作视频", preservedNarration)).toBe(false);
    expect(videoPromptRequestsVoiceoverContext("video-voice-reference", "Only write the script first", preservedNarration)).toBe(false);
    expect(videoPromptRequestsVoiceoverContext(undefined, "只加字幕", { voiceover: false, captions: true })).toBe(true);
    expect(voiceContract).toContain("Caption-only work reuses existing audio/word timings without resynthesizing");
    const reviewContract = videoTaskSystemContext("ses_video_a", "/workspace/current", null, { includeVoiceover: true, requireStoryboardReview: true });
    expect(reviewContract).not.toContain("speech_synthesize_workspace_batch");
    expect(reviewContract).toContain("load ipollowork-video-storyboard");
  });

  test("parses requested media and final duration into an explicit delivery gate", () => {
    expect(videoDeliveryRequirementsForPrompt({ promptText: "生成视频，优先配方，实在不行说明原因再定制" }).recipesOnly).toBeUndefined();
    const recipeRequirements = videoDeliveryRequirementsForPrompt({ promptText: "生成一个概念讲解视频" });
    expect(recipeRequirements.recipesOnly).toBeUndefined();
    const recipeFirst = videoTaskSystemContext("ses_video_a", "/workspace/current", null, { deliveryRequirements: recipeRequirements });
    expect(recipeFirst).toContain("Read ipollowork-video-studio once");
    expect(videoAuthoringGuidance).toContain("custom_reason");
    const strictRequirements = videoDeliveryRequirementsForPrompt({ promptText: "生成视频，禁止定制图形，只用真实配方" });
    expect(strictRequirements.recipesOnly).toBe(true);
    expect(videoTaskSystemContext("ses_video_a", "/workspace/current", null, { deliveryRequirements: strictRequirements })).toContain("independently of HTML metadata");
    expect(requestedVideoDurationSeconds("最终视频总时长两分钟左右")).toBe(120);
    expect(requestedVideoDurationSeconds("make it about 90 seconds")).toBe(90);
    const originalBriefText = "制作一条约 35 秒的概念讲解视频";
    expect(videoDeliveryRequirementsForPrompt({
      promptText: "修复第 2 幕的 7 秒静止问题",
      originalBriefText,
    }).targetDurationSeconds).toBe(35);
    expect(videoDeliveryRequirementsForPrompt({
      promptText: "把视频总时长改成 25 秒",
      originalBriefText,
    }).targetDurationSeconds).toBe(25);
    const requirements = videoDeliveryRequirementsForPrompt({
      promptText: "请做配音字幕并加 BGM，最终视频总时长两分钟左右",
    });
    expect(requirements).toEqual({
      voiceover: true,
      captions: true,
      bgm: true,
      sfx: false,
      animationReferences: [],
      targetDurationSeconds: 120,
    });
    const contract = videoTaskSystemContext("ses_video_a", "/workspace/current", null, {
      includeVoiceover: true,
      deliveryRequirements: requirements,
    });
    expect(contract).toContain('"targetDurationSeconds":120');
    expect(contract).toContain(JSON.stringify(requirements));
    expect(
      videoDeliveryRequirementsForPrompt({ promptText: "制作一个产品介绍视频" }).voiceover,
    ).toBe(true);
    expect(
      videoDeliveryRequirementsForPrompt({ promptText: "制作一个产品介绍视频" }).animationReferences,
    ).toEqual([]);
    expect(
      videoDeliveryRequirementsForPrompt({ promptText: "制作一个静态视频，不要动画" }).animationReferences,
    ).toEqual([]);
    expect(videoDeliveryRequirementsForPrompt({ promptText: "制作视频，不要配音" }).voiceover).toBe(
      false,
    );
    expect(
      videoDeliveryRequirementsForPrompt({ promptText: "继续修改画面", voiceoverEnabled: false })
        .voiceover,
    ).toBe(false);
    expect(
      videoDeliveryRequirementsForPrompt({
        promptText: "制作一个产品介绍视频",
        voiceoverAvailable: false,
        voiceoverEnabled: false,
      }).voiceover,
    ).toBe(true);
    expect(
      videoDeliveryRequirementsForPrompt({
        promptText: "继续修改画面",
        voiceoverAvailable: false,
        voiceoverEnabled: false,
      }).voiceover,
    ).toBe(false);
    expect(
      videoDeliveryRequirementsForPrompt({
        promptText: "请给视频添加旁白",
        voiceoverAvailable: false,
      }).voiceover,
    ).toBe(true);
    expect(
      videoDeliveryRequirementsForPrompt({
        promptText: "制作一个产品介绍视频",
        voiceoverAvailable: true,
        voiceoverEnabled: false,
      }).voiceover,
    ).toBe(false);
  });

  test("uses an adaptive operation plan without forcing one video workflow", () => {
    const contract = videoTaskSystemContext("ses_video_a", "/workspace/current");
    expect(contract).toContain("it owns creative planning");
    expect(contract).toContain("targeted edits keep their requested scope");
    expect(contract).not.toContain("Adaptive execution contract");
  });

  test("lets the embedded script table save and regenerate through the active video session", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );
    const pageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );
    const tableSource = readFileSync(
      new URL(
        "../../../vendor/hyperframes/packages/studio/src/components/storyboard/StoryboardTable.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(tableSource).toContain('type: "ipollowork:video-studio-regenerate"');
    expect(tableSource).toContain('tx("Save and regenerate video")');
    expect(panelSource).toContain('event.data?.type !== "ipollowork:video-studio-regenerate"');
    expect(panelSource).toContain("void onRegenerateFromStoryboard?.()");
    expect(pageSource).toContain("createStoryboardRegenerationDraft(sourcePath)");
    expect(pageSource).toContain('capability: { id: "video-storyboard-regeneration", instruction }');
    expect(pageSource).toContain("onRegenerateVideoFromStoryboard={regenerateVideoFromStoryboard}");
    expect(videoPromptRequestsVoiceoverContext("video-storyboard-regeneration", "", { voiceover: true, captions: false })).toBe(true);
  });

  test("continues finished videos by default and pauses only for explicit script review", () => {
    const contract = videoTaskSystemContext("ses_video_a", "/workspace/current");
    expect(contract).toContain("Pause only when the user explicitly requests script review or script-only work");
    expect(videoPromptRequiresStoryboardReview({ promptText: "根据这份 PDF 做一个技术讲解视频" })).toBe(false);
    expect(videoPromptRequiresStoryboardReview({ promptText: "做一个产品视频", hasReferenceAttachments: true })).toBe(false);
    expect(videoPromptRequiresStoryboardReview({ promptText: "根据课件直接生成成片，无需确认脚本" })).toBe(false);
    expect(videoPromptRequiresStoryboardReview({ promptText: "脚本确认，继续生成" })).toBe(false);
    expect(videoPromptRequiresStoryboardReview({ promptText: "继续修改技术讲解视频的第三幕", hasReferenceAttachments: true })).toBe(false);
    expect(videoPromptRequiresStoryboardReview({ promptText: "先给我看脚本，再生成视频", hasReferenceAttachments: true })).toBe(true);
    expect(videoPromptRequiresStoryboardReview({ promptText: "只写分镜，暂时不要制作视频" })).toBe(true);
    const detailedStoryboard = "请先只制作一个6秒、16:9的工作助手宣传片分镜：一个想法变成清晰的下一步行动。三个场景，延续同一组原创可编辑图形。不要外部图片或视频，不要旁白、字幕、音乐和音效。先把原生分镜保存给我查看，不开始制作、不渲染、不导出。";
    expect(videoPromptRequiresStoryboardReview({ promptText: detailedStoryboard })).toBe(true);
    expect(videoPromptRequestsFinishedVideo(detailedStoryboard)).toBe(false);
    expect(videoPromptRequiresStoryboardReview({ promptText: "Save a detailed six-second storyboard for my review; do not start production." })).toBe(true);
    expect(videoPromptRequiresStoryboardReview({ promptText: "按已保存的分镜制作6秒可编辑视频，不渲染、不导出。" })).toBe(false);
    const reviewContract = videoTaskSystemContext("ses_review", "/workspace/current", null, { requireStoryboardReview: true });
    expect(reviewContract).toContain("Script review requested");
    expect(reviewContract).toContain("create or update only `/workspace/current/video/ses_review/STORYBOARD.md`");
    expect(reviewContract).toContain("Do not source or generate media");
  });

  test("music-only edits preserve script and narration without becoming storyboard review", () => {
    for (const promptText of [
      "只补现有音乐不重做脚本/旁白",
      "只补现有音乐，不重做脚本和旁白",
      "只补现有音乐，保持原有脚本和旁白不变",
      "只补现有音乐，保留原有旁白和脚本",
      "Please add music only; do not redo the script or narration.",
      "Add background music; preserve the script and existing narration.",
    ]) {
      const requirements = videoDeliveryRequirementsForPrompt({
        promptText, voiceoverAvailable: true, voiceoverEnabled: true,
      });
      expect(videoPromptRequiresStoryboardReview({ promptText })).toBe(false);
      expect(requirements).toMatchObject({ voiceover: true, bgm: true });
      expect(videoPromptRequestsVoiceoverContext(undefined, promptText, requirements)).toBe(false);
      const contract = videoTaskSystemContext("ses_music_edit", "/workspace/current", null, {
        deliveryRequirements: requirements,
        includeVoiceover: videoPromptRequestsVoiceoverContext(undefined, promptText, requirements),
        requireStoryboardReview: videoPromptRequiresStoryboardReview({ promptText }),
      });
      expect(contract).not.toContain("Script review requested");
      expect(contract).not.toContain("speech_synthesize_workspace_batch");
    }
  });

  test("preserved content does not suppress later script, speech or finished-video requests", () => {
    for (const promptText of [
      "不重做旁白，只写分镜，暂时不要制作视频",
      "保留原有旁白，先给我看脚本，确认后再制作视频",
      "Do not redo the narration; only write the script first",
    ]) {
      const requirements = videoDeliveryRequirementsForPrompt({ promptText });
      expect(videoPromptRequiresStoryboardReview({ promptText })).toBe(true);
      expect(requirements.bgm).toBe(false);
      expect(videoPromptRequestsVoiceoverContext(undefined, promptText, requirements)).toBe(false);
    }
    for (const promptText of [
      "保留脚本，只修改旁白声音",
      "不重做脚本/旁白，只补BGM，再给第三幕新增旁白",
      "Do not redo the script; add narration",
    ]) {
      const requirements = videoDeliveryRequirementsForPrompt({ promptText });
      expect(videoPromptRequiresStoryboardReview({ promptText })).toBe(false);
      expect(videoPromptRequestsVoiceoverContext(undefined, promptText, requirements)).toBe(true);
    }
    const promptText = "保留现有脚本，制作完整视频";
    const requirements = videoDeliveryRequirementsForPrompt({ promptText });
    expect(videoPromptRequiresStoryboardReview({ promptText })).toBe(false);
    expect(videoPromptRequestsFinishedVideo(promptText)).toBe(true);
    expect(requirements).toMatchObject({ voiceover: true, bgm: true });
    expect(videoPromptRequestsVoiceoverContext(undefined, promptText, requirements)).toBe(true);
  });

  test("negating planning-only work keeps production and its audio requirements active", () => {
    for (const promptText of [
      "Don't just plan; create the full video",
      "Don’t just plan; create the full video",
      "Do not only plan the storyboard; produce the video",
      "Never only plan; create a video",
      "不要只规划，请直接做视频",
      "不要只给我规划，请直接做视频",
      "不需要仅规划，请制作视频",
    ]) {
      expect(videoPromptRequiresStoryboardReview({ promptText })).toBe(false);
      expect(videoPromptRequestsFinishedVideo(promptText)).toBe(true);
      const requirements = videoDeliveryRequirementsForPrompt({ promptText });
      expect(requirements.bgm).toBe(true);
      expect(videoPromptRequestsVoiceoverContext(undefined, promptText, requirements)).toBe(true);
    }
    for (const promptText of [
      "Only plan the storyboard",
      "只给我规划",
      "Don't just plan the opening; only plan the storyboard for now",
      "不要只规划开场，只给我规划整份分镜",
      "Don't just plan; review the script before production",
      "不要只规划，先给我看脚本，确认后再制作视频",
      "Do not generate assets; only plan",
    ]) {
      expect(videoPromptRequiresStoryboardReview({ promptText })).toBe(true);
      expect(videoPromptRequestsFinishedVideo(promptText)).toBe(false);
      const requirements = videoDeliveryRequirementsForPrompt({ promptText });
      expect(requirements.bgm).toBe(false);
      expect(videoPromptRequestsVoiceoverContext(undefined, promptText, requirements)).toBe(false);
    }
  });

  test("connects the editable shot plan to real media and purposeful motion", () => {
    for (const field of ["asset_source", "asset_kind", "asset_origin", "asset_reference", "artifact_media_review", "generationPath", "recipe_intent", "custom_reason", "video_component_install", "spatial-camera-suite", "list_motion_presets", "mutate_motion"])
      expect(videoAuthoringGuidance).toContain(field);
    expect(videoTaskSystemContext("ses_workflow", "/workspace/current")).toContain("video/ses_workflow/index.html");
  });

  test("requires requested sound effects without treating disabled audio as required", () => {
    for (const promptText of [
      "补上配乐和转场音效",
      "Add background music and sound effects",
      "BGM + SFX",
    ]) {
      expect(videoDeliveryRequirementsForPrompt({ promptText })).toMatchObject({
        bgm: true,
        sfx: true,
      });
    }
    for (const promptText of [
      "不要配乐，不要音效",
      "without background music, no SFX",
      "继续修改标题",
    ]) {
      expect(videoDeliveryRequirementsForPrompt({ promptText })).toMatchObject({
        bgm: false,
        sfx: false,
      });
    }
    expect(
      videoDeliveryRequirementsForPrompt({ promptText: "不要背景音乐，保留音效" }),
    ).toMatchObject({ bgm: false, sfx: true });
    expect(videoDeliveryRequirementsForPrompt({ promptText: "加 BGM，改成不要 BGM" }).bgm).toBe(
      false,
    );
    expect(videoDeliveryRequirementsForPrompt({ promptText: "不要 BGM，还是加 BGM" }).bgm).toBe(
      true,
    );
  });

  test("preserves grouped media exclusions through the authoritative delivery requirements", () => {
    for (const promptText of [
      "不要旁白、字幕、音乐和音效",
      "保留原来确定的无旁白、无字幕、无音乐音效",
      "不要字幕、旁白、配乐和音效",
      "No narration, captions, music or sound effects",
    ]) expect(videoDeliveryRequirementsForPrompt({ promptText })).toMatchObject({
      voiceover: false, captions: false, bgm: false, sfx: false,
    });
    expect(videoDeliveryRequirementsForPrompt({
      promptText: "不要旁白、字幕、音乐和音效；改为添加字幕和音效",
    })).toMatchObject({ voiceover: false, captions: true, bgm: false, sfx: true });
    expect(videoDeliveryRequirementsForPrompt({
      promptText: "不要字幕和音效，但加旁白和配乐",
    })).toMatchObject({ voiceover: true, captions: false, bgm: true, sfx: false });
    expect(videoDeliveryRequirementsForPrompt({
      promptText: "No narration, captions, music or sound effects; add music later",
    })).toMatchObject({ voiceover: false, captions: false, bgm: true, sfx: false });
  });

  test("requires music for new finished videos without adding it to planning or local edits", () => {
    for (const promptText of [
      "做一支 12 秒、3 个镜头的 iPolloWork 产品介绍短片，有中文旁白。直接完成视频并保留可编辑脚本。",
      "制作一个产品介绍视频",
      "制作一个产品介绍视频，不要外部图片或视频生成",
      "Create a 20 second product explainer video with narration",
    ]) {
      const requirements = videoDeliveryRequirementsForPrompt({ promptText });
      expect(requirements.bgm).toBe(true);
      expect(videoTaskSystemContext("ses_music", "/workspace/current", null, { deliveryRequirements: requirements })).toContain('"bgm":true');
    }
    for (const promptText of [
      "制作宣传片，不要背景音乐",
      "制作宣传片，无背景音乐",
      "制作宣传片，不需要配乐",
      "Create a product video without any background music",
      "Create a product video, don't add background music",
      "做一个无声视频",
      "制作一个无音乐产品视频",
      "Make a music-free explainer video",
      "Create a silent product video",
      "Create a product video without music",
      "制作宣传片，先给我脚本和配乐规划",
      "Just plan the storyboard for a product video with music",
      "改一下产品介绍视频的标题",
      "Make the second scene longer",
      "继续修改画面",
    ]) expect(videoDeliveryRequirementsForPrompt({ promptText }).bgm).toBe(false);
    expect(videoAuthoringGuidance).toContain("music_prompt");
  });

  test("uses an imported video template as an adaptable visual and runtime seed", () => {
    const contract = videoTaskSystemContext("ses_video_a", "/workspace/current", {
      id: "personal.launch-film", title: "Launch Film", entry: "index.html",
      applyChecklist: ["Replace inherited copy", "Keep the visual language"],
    });
    expect(contract).toContain('"id":"personal.launch-film"');
    expect(contract).toContain('"title":"Launch Film"');
    expect(contract).toContain('"entry":"/workspace/current/video/ses_video_a/index.html"');
    expect(contract).toContain('"applyChecklist":["Replace inherited copy","Keep the visual language"]');
    expect(contract).toContain("sample scene counts and timings do not constrain the deliverable");
    expect(contract).toContain("merge user edits");
  });

  test("does not leave the project to search for missing template guidance", () => {
    const contract = videoTaskSystemContext("ses_video_a", "/workspace/current", {
      id: "personal.launch-film",
      title: "Launch Film",
      entry: "index.html",
      applyChecklist: [],
      layoutLibrary: "core-v1",
      authoringGuide: "references/video.md",
    });
    expect(contract).toContain("only if that exact project-local file exists");
    expect(contract).toContain("core-v1-video/catalog.md");
    expect(contract).not.toContain("core-v1-video.html");
    expect(contract).toContain("Never glob or search a parent directory");
    expect(contract).toContain("workspace-external path");
  });
});
