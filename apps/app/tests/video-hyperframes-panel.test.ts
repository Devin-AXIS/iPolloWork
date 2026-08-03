import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { hyperframesStudioPort, hyperframesStudioUrl, shouldInjectVideoTaskContext, videoProjectDirectory, videoProjectId, videoProjectPath, videoTaskSystemContext } from "../src/react-app/domains/session/video/video-project";

describe("HyperFrames Video Studio", () => {
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
    expect(panelSource).not.toContain('aria-label={t("video.design_system")}');
    expect(panelSource).toContain('data-testid="video-style-tab-content"');
    expect(panelSource).not.toContain("<DesignSystemInspectorShell");
    expect(panelSource).toContain('`${projectDirectory}/design-tokens.css`');
    expect(panelSource).toContain("ensureHtmlDesignSystemContract(current.content, theme.id)");
    expect(panelSource).toContain("buildTemplateTokenCss(theme)");
    expect(panelSource).toContain("replaceDesignTokenValue(designTokenSourceRef.current, name, value)");
    expect(panelSource).not.toContain("variablesDisabled={!appliedDesignSystemId}");
    expect(panelSource).not.toContain("onChooseBackgroundImage=");
    expect(registrySource).toContain("[data-composition-id], .composition, .scene.clip");
  });

  test("keeps a visible fullscreen control in the iPolloWork Video Studio header", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain('aria-label={t("video.toggle_fullscreen")}');
    expect(panelSource).toContain("onExpandedChange?.(!expanded)");
    expect(panelSource).not.toContain("requestFullscreen()");
    expect(panelSource).not.toContain("document.exitFullscreen()");
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
    expect(sidebarSource).toContain('SidebarHeader className="gap-4 px-2 pb-6 pt-1 mac:titlebar-drag"');
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

  test("keeps the application sidebar visible while Video Studio is expanded", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain("videoStudioExpanded");
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
    expect(sessionPageSource).toContain('rightWorkspaceExpanded && "**:data-[slot=sidebar-gap]:!w-0"');
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

    const deleteIndex = electronSource.indexOf('data-action="delete"');
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
    expect(nativeToolbarSource).toContain("window.parent?.postMessage");
    expect(nativeToolbarSource).toContain("ipollowork:hyperframes:ask-ai-selection");
    expect(nativeToolbarSource).toContain("hfId: activeSelection.hfId");
    expect(nativeDeleteIndex).toBeGreaterThan(-1);
    expect(nativeAiIndex).toBeGreaterThan(nativeAdvancedIndex);
    expect(nativeDeleteIndex).toBeGreaterThan(nativeAiIndex);
    expect(nativeToolbarSource).toContain("hf-preview-text-toolbar__icon-button");
    expect(nativeToolbarSource).toContain("deleteConfirmationOpen");
    expect(electronSource).toContain("window.confirm('Delete selected element?')");
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

  test("opens the left sidebar in one action when the right panel occupies a narrow window", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain("const openLeftSidebar = useCallback(() => {");
    expect(sessionPageSource).toContain("closeRightPane({ preserveAutoCollapse: true });");
    expect(sessionPageSource).toContain("onClick={openLeftSidebar}");
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
    expect(sessionRouteSource).toContain("[envSystemContext, videoSystemContext, designSystemContext, capabilitySystemContext]");
  });

  test("gives the agent the same session-scoped project as the Studio", () => {
    const contract = videoTaskSystemContext("ses/current video", "/workspace/current");
    expect(contract).toContain("/workspace/current/video/ses_current_video/index.html");
    expect(contract).toContain("HyperFrames skill is installed automatically");
    expect(contract).toContain("opens after the project brief is confirmed");
    expect(contract).toContain("exact writable path");
    expect(contract).toContain("Never create, inspect, render, validate, preview, or report a `videos/` directory");
    expect(contract).toContain("A rendered MP4 or narration outside the exact path above");
    expect(contract).toContain("Do not run `npx hyperframes preview`");
    expect(contract).toContain("Never stop all Node processes");
    expect(contract).toContain("Do not restart, replace, or health-check the embedded Studio server");
    expect(contract).toContain("Never add example clips");
    expect(contract).toContain("another conversation's project");
    expect(contract).toContain("npx hyperframes check");
    expect(contract).toContain("never leave two `.scene` windows overlapping");
    expect(contract).toContain("seconds-based `data-start`");
    expect(contract).toContain('Do not use legacy `class="frame"` sections');
    expect(contract).toContain("root composition `data-duration` must be the real HyperFrames timeline duration");
    expect(contract).toContain("assets/ipollowork-logo.svg?v=20260729");
    expect(contract).toContain("current transparent-background SVG");
    expect(contract).toContain("top-left or bottom-right placement");
    expect(contract).toContain("local error fallback");
    expect(contract).toContain("Never redraw, inline, or regenerate an older iPolloWork logo");
  });

  test("gives video agents the selected Studio voice without forcing narration", () => {
    const contract = videoTaskSystemContext("ses/current video", "/workspace/current");
    expect(contract).toContain("/workspace/current/video/ses_current_video/voiceover.json");
    expect(contract).toContain("ipollowork_extension_list_actions");
    expect(contract).toContain("ipollowork_extension_call");
    expect(contract).toContain("speech_synthesize_workspace_file");
    expect(contract).toContain("Never call generic `speech_synthesize`");
    expect(contract).toContain("voiceId");
    expect(contract).toContain("assets/voiceover-<unique-revision>.mp3");
    expect(contract).toContain("direct child of the root composition");
    expect(contract).toContain("immutable filename");
    expect(contract).toContain("actual `durationSeconds`");
    expect(contract).toContain("sceneDuration");
    expect(contract).toContain("compositionPath");
    expect(contract).toContain("audioElementHtml");
    expect(contract).toContain("timelinePatch");
    expect(contract).toContain("shiftFollowingBySeconds");
    expect(contract).toContain("cumulative shift");
    expect(contract).toContain("remain visibly present for the entire narration window");
    expect(contract).toContain("must not animate out");
    expect(contract).toContain("voiceover_timeline_validate");
    expect(contract).toContain("Do not finish the task while `valid` is false");
    expect(contract).toContain("fix every reported issue and run both checks again");
    expect(contract).toContain('data-ipw-voiceover="true"');
    expect(contract).toContain("data-ipw-scene-id");
    expect(contract).toContain("data-ipw-narration-text");
    expect(contract).toContain("do not hand-author a different narration tag");
    expect(contract).toContain("Never create a single `assets/voiceover.mp3`");
    expect(contract).toContain("voiceover.src = ...");
    expect(contract).toContain("voiceover_*.mp3");
    expect(contract).toContain("a JavaScript array such as");
    expect(contract).toContain("assets/vo_*.mp3");
    expect(contract).toContain("data-ipw-scene-text");
    expect(contract).toContain("same scene's visible text");
    expect(contract).toContain("exact scene start");
    expect(contract).toContain("visible text verbatim in the same order");
    expect(contract).toContain("must be identical");
    expect(contract).toContain("must never overlap");
    expect(contract).toContain("extend that same visual scene");
    expect(contract).toContain("root `data-duration`");
    expect(contract).toContain("GSAP");
    expect(contract).toContain("Decide whether narration helps the confirmed brief");
    expect(contract).toContain("Do not use an unrelated TTS provider");
  });

  test("keeps an imported video template as the agent's editing source", () => {
    const contract = videoTaskSystemContext("ses_video_a", "/workspace/current", {
      id: "personal.launch-film",
      title: "Launch Film",
      entry: "index.html",
      applyChecklist: ["Replace inherited copy", "Keep the visual language"],
    });
    expect(contract).toContain("created from the `Launch Film` video template");
    expect(contract).toContain("do not start a blank project");
    expect(contract).toContain("Apply the user's request by editing this template");
    expect(contract).toContain("Replace inherited copy; Keep the visual language");
  });
});
