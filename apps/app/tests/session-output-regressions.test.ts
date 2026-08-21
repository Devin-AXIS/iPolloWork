import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { formatProcessDuration } from "../src/components/chat/utils";

describe("session output issue regressions", () => {
  test("empty projects hide task controls and render the no-task state", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );
    const chineseLocaleSource = readFileSync(
      new URL("../src/i18n/locales/zh.ts", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain("const showProjectNoTasksState = Boolean(");
    expect(sessionPageSource).toContain("const hasSelectedTask = Boolean(props.selectedSessionId && props.selectedSessionKnown);");
    expect(sessionPageSource).toContain("&& !props.selectedSessionId");
    expect(sessionPageSource).toContain('selectedWorkspaceProject?.status === "ready"');
    expect(sessionPageSource).toContain("selectedWorkspaceProject.sessions.length === 0");
    expect(sessionPageSource).toContain("{mainHeaderHidden && !showProjectNoTasksState ? (");
    expect(sessionPageSource).toContain(") : hasSelectedTask ? (");
    expect(sessionPageSource).toContain('{t("workspace.no_tasks")}');
    expect(chineseLocaleSource).toContain('"workspace.no_tasks": "没有任务"');

    const sessionRouteSource = readFileSync(
      new URL("../src/react-app/shell/session-route.tsx", import.meta.url),
      "utf8",
    );
    expect(sessionRouteSource).toContain("selectedSessionKnown={selectedSessionKnown}");
  });

  test("shows the active workspace engine beside the session composer", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );
    const sessionRouteSource = readFileSync(
      new URL("../src/react-app/shell/session-route.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain("function ProjectEngineBadge");
    expect(sessionPageSource).toContain("data-engine-id={isDeepSeekHarness ? DEEPSEEK_HARNESS_ENGINE_ID : DEFAULT_ENGINE_ID}");
    expect(sessionPageSource).toContain('t(isDeepSeekHarness ? "projects.engine_dsh" : "projects.engine_opencode")');
    expect(sessionPageSource).toContain("composerEndAccessory={(");
    expect(sessionPageSource).toContain('testId="session-composer-engine-badge"');
    expect(sessionPageSource).not.toContain("SessionEngineBadge");
    expect(sessionPageSource).not.toContain('className="pointer-events-none hidden md:flex md:justify-self-center"');
    expect(sessionRouteSource).toContain("engineId: activeEngineId");
  });

  test("process duration uses a compact clock format", () => {
    expect(formatProcessDuration(8_400)).toBe("00:08");
    expect(formatProcessDuration(83_000)).toBe("01:23");
    expect(formatProcessDuration(3_723_000)).toBe("1:02:03");
  });

  test("session header offers full-session Markdown export", () => {
    const source = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("buildSessionMarkdown");
    expect(source).toContain("sessionMarkdownFilename");
    expect(source).toContain('t("session.export_markdown")');
    expect(source).toContain("downloadTextAsFile(");
    expect(source).toContain("sessionId={props.selectedSessionId ?? undefined}");
  });

  test("DeepSeek Harness sessions expose archive instead of permanent delete", () => {
    const routeSource = readFileSync(
      new URL("../src/react-app/shell/session-route.tsx", import.meta.url),
      "utf8",
    );
    const sidebarSource = readFileSync(
      new URL("../src/react-app/domains/session/sidebar/app-sidebar.tsx", import.meta.url),
      "utf8",
    );
    const deleteBinding = routeSource.slice(
      routeSource.indexOf("onDeleteSession={"),
      routeSource.indexOf("onArchiveSession={"),
    );

    expect(deleteBinding).toContain("activeEngineId !== DEEPSEEK_HARNESS_ENGINE_ID");
    expect(routeSource).toContain("onArchiveSession={conversation ? handleArchiveSession : undefined}");
    expect(sidebarSource).toContain('t("session_management.archive_session")');
  });

  test("template brief keeps the reference upload entry hidden", () => {
    const source = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const TEMPLATE_REFERENCE_UPLOAD_VISIBLE = false;");
    expect(source).toContain("{TEMPLATE_REFERENCE_UPLOAD_VISIBLE ? <div");
    expect(source).toContain('className="flex min-h-0 w-full flex-1 items-center justify-center overflow-auto px-6 py-10"');
    expect(source).toContain('className="mx-auto w-full max-w-xl overflow-hidden');
    expect(source).toContain('className="mt-2 placeholder:text-muted-foreground/70"');
  });

  test("output files can seed a follow-up revision prompt", () => {
    const source = readFileSync(
      new URL("../src/components/chat/artifact.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("buildReviseFilePrompt");
    expect(source).toContain("useComposerStateStore");
    expect(source).toContain('t("session.outputs.revise_file")');
    expect(source).toContain('new Event("ipollowork:focusPrompt")');
  });

  test("multiple generated file cards use a visible horizontal overflow rail", () => {
    const source = readFileSync(
      new URL("../src/components/chat/artifact.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('compact ? "w-full" : "w-[17rem] flex-none snap-start"');
    expect(source).toContain("overflow-x-auto overscroll-x-contain pb-2 [scrollbar-gutter:stable]");
    expect(source).not.toContain("no-scrollbar flex min-w-0 flex-nowrap gap-2 overflow-x-auto");
  });

  test("generated file links open in the internal right panel by default", () => {
    const source = readFileSync(
      new URL("../src/components/markdown/markdown.tsx", import.meta.url),
      "utf8",
    );
    const clickHandler = source.slice(
      source.indexOf('const link = event.target.closest("a[data-ipollowork-link-href]")'),
      source.indexOf('const button = event.target.closest("[data-ipollowork-image-toggle]")'),
    );

    expect(clickHandler).toContain("onOpenTarget(target);");
    expect(clickHandler).not.toContain("external: true");
  });

  test("HTML files use persisted surface metadata and still offer explicit viewer overrides", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );
    const menuSource = readFileSync(
      new URL("../src/components/markdown/link-action-menu.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain("resolveOpenTargetTemplateSurface(target, sourceId)");
    expect(sessionPageSource).toContain('if (templateSurface === "design")');
    expect(sessionPageSource).toContain("openCurrentVideoStudio();");
    expect(sessionPageSource).toContain('options?.viewer === "design"');
    expect(sessionPageSource).toContain('options?.viewer === "preview"');
    expect(sessionPageSource).toContain('options?.viewer === "video"');
    expect(sessionPageSource).toContain("openArtifactTargetInPanel(target, sourceId, options?.auto)");
    expect(menuSource).toContain('handleOpenWithViewer("design")');
    expect(menuSource).toContain('handleOpenWithViewer("preview")');
    expect(menuSource).toContain('handleOpenWithViewer("video")');
    expect(menuSource).toContain('"link_action.open_recommended"');
  });

  test("generated video files open the session Video Studio from the message list", () => {
    const messageListSource = readFileSync(
      new URL("../src/components/chat/message-list.tsx", import.meta.url),
      "utf8",
    );
    const messageListProviderSource = readFileSync(
      new URL("../src/components/chat/message-list-provider.tsx", import.meta.url),
      "utf8",
    );
    const sessionSurfaceSource = readFileSync(
      new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url),
      "utf8",
    );
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(messageListProviderSource).toContain("onOpenVideoStudio?: () => void");
    expect(messageListSource).toContain("onOpenVideoStudio={onOpenVideoStudio}");
    expect(sessionSurfaceSource).toContain("onOpenVideoStudio={props.onOpenVideoStudio}");
    expect(sessionPageSource).toContain("onOpenVideoStudio={openCurrentVideoStudio}");
    expect(sessionPageSource).toContain("const prioritizeRightPanel = useCallback(() => {");
    expect(sessionPageSource).toContain("if (!options?.auto) prioritizeRightPanel();");
    expect(sessionPageSource).toContain("openCurrentVideoStudio({ auto: true });");
  });

  test("expanded HTML panels avoid the macOS window controls", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );
    const sidePanelSource = readFileSync(
      new URL("../src/react-app/domains/session/panel/side-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain(
      "titlebarInset={rightPanelExpanded && (!shellConfig.sidebar || !sidebarOpen)}",
    );
    expect(sidePanelSource).toContain('titlebarInset && "mac:pl-20"');
  });

  test("latest-turn output label only renders for the latest artifact assistant message", () => {
    const source = readFileSync(
      new URL("../src/components/chat/message-list.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("showLatestArtifactsTitle={item.message.id === latestAssistantMessageId}");
    expect(source).toContain("const isLatestAssistantGroup = items.some");
    expect(source).toContain("artifactFiles={isLatestAssistantGroup ? artifactFiles : undefined}");
    expect(source).toContain('title={showLatestArtifactsTitle ? t("session.outputs.latest_turn") : undefined}');
    expect(source).toContain('status === "submitted" || status === "streaming" || status === "retrying"');
    expect(source).toContain("{!isStreaming ? (");
  });

  test("keeps the assistant process in progress while shared session activity is still active", () => {
    const source = readFileSync(
      new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('if (liveStatus.type === "busy" || activityRunActive)');
    expect(source).toContain("}, [activityRunActive, liveStatus, sending]);");
  });

  test("the final assistant result enters from the left after a live run", () => {
    const source = readFileSync(
      new URL("../src/components/chat/message-list.tsx", import.meta.url),
      "utf8",
    );
    const resultEntry = source.slice(
      source.indexOf('data-assistant-result="true"'),
      source.indexOf("message={resultData.item.message}"),
    );

    expect(source).toContain("const resultEnteredAfterLiveRun = !isLiveGroup && previousLiveGroupRef.current");
    expect(resultEntry).toContain("slide-in-from-left-2");
    expect(resultEntry).not.toContain("slide-in-from-right");
    expect(resultEntry).toContain("motion-reduce:animate-none");
  });

  test("video and presentation sessions show only scoped openable outputs", () => {
    const artifactSource = readFileSync(
      new URL("../src/components/chat/artifact.tsx", import.meta.url),
      "utf8",
    );
    const messageListSource = readFileSync(
      new URL("../src/components/chat/message-list.tsx", import.meta.url),
      "utf8",
    );
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(artifactSource).toContain("canOpenArtifactInContext(artifact, artifactContext)");
    expect(artifactSource).toContain("selectArtifactContextOutputs(artifacts, artifactContext)");
    expect(messageListSource).toContain("artifactFiles={artifactFiles}");
    expect(sessionPageSource).toContain(".listWorkspaceFiles(workspaceId, artifactDirectory)");
    expect(sessionPageSource).toContain('selectedTemplate?.category === "slides"');
    expect(sessionPageSource).toContain('target.preview === "html"');
    expect(sessionPageSource).toContain("artifactPathMatchesTarget(target.value, currentVideoEntryPath)");
    expect(sessionPageSource).toContain('target.preview === "slides"');
    expect(sessionPageSource).toContain("openCurrentVideoStudio();");
  });

  test("artifact catalog refresh is scoped to the output directory rather than message streaming", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );
    const effectStart = sessionPageSource.indexOf(".listWorkspaceFiles(workspaceId, artifactDirectory)");
    expect(effectStart).toBeGreaterThan(0);
    const dependencyStart = sessionPageSource.indexOf("  }, [", effectStart);
    const dependencyEnd = sessionPageSource.indexOf("  ]);", dependencyStart);
    const dependencies = sessionPageSource.slice(dependencyStart, dependencyEnd);

    expect(dependencies).toContain("artifactDirectory");
    expect(dependencies).toContain("artifactScopeKey");
    expect(dependencies).not.toContain("conversationMessages");
  });

  test("template covers expose a retryable failure placeholder", () => {
    const marketSource = readFileSync(
      new URL("../src/react-app/domains/session/templates/template-market-dialog.tsx", import.meta.url),
      "utf8",
    );
    const starterSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    for (const source of [marketSource, starterSource]) {
      expect(source).toContain("TEMPLATE_COVER_TIMEOUT_MS");
      expect(source).toContain("setFailed(true)");
      expect(source).toContain("setRetry((value) => value + 1)");
      expect(source).toContain('t("template_market.cover_failed")');
      expect(source).toContain('t("template_market.retry_cover")');
      expect(source).toContain("window.clearTimeout(timeout)");
    }
  });

  test("template market exposes compact discovery controls, import details, and installed enterprise actions", () => {
    const source = readFileSync(
      new URL("../src/react-app/domains/session/templates/template-market-dialog.tsx", import.meta.url),
      "utf8",
    );
    const sessionSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const PRIMARY_CATEGORIES = CATEGORIES.slice(0, 4)");
    expect(source).toContain("const MORE_CATEGORIES = CATEGORIES.slice(4)");
    expect(source).toContain('type MyTemplateCollection = "all" | "favorites" | "mine"');
    expect(source).toContain('font-[\'PingFang_SC\',sans-serif] text-xs font-medium text-foreground');
    expect(source).toContain("{pendingImport.name} - {(pendingImport.size / 1024).toFixed(1)} KB");
    expect(source).toContain('enterpriseMode && view === "explore"');
    expect(source).toContain("<WorkResourceScopeSwitch");
    expect(sessionSource).toContain('listTemplates(props.runtimeWorkspaceId, "personal")');
    expect(sessionSource).toContain('listEnterpriseResources("template")');
    expect(sessionSource).toContain("item.sourceType === \"local\" && item.installed");
    expect(sessionSource).toContain("requestId !== templateCatalogRequestIdRef.current");
    expect(source).toContain("enterpriseTemplateInstallations");
    expect(source).toContain("resource.manifestId");
    expect(source).toContain("return <TemplateCard template={installedTemplate}");
    expect(source).toContain("primaryAction={action} primaryLabel={label} sourceLabel={sourceLabel}");
  });

  test("enterprise extensions reflect local package installation versions", () => {
    const source = readFileSync(
      new URL("../src/react-app/domains/settings/pages/extensions-view.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("listPluginPackages(props.workspaceId)");
    expect(source).toContain("installedEnterpriseExtensionVersions.get(resource.manifestId ?? resource.slug)");
    expect(source).toContain('t("plugin_platform.status.installed")');
    expect(source).toContain("currentVersionInstalled || !resource.latestVersion");
  });
});
