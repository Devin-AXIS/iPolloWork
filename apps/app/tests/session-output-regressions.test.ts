import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildWorkspaceFileTree, filterWorkspaceFileTree } from "../src/components/chat/artifact";
import { formatProcessDuration, getAssistantProcessState } from "../src/components/chat/utils";

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
    expect(sessionPageSource).not.toContain("{mainHeaderHidden && !showProjectNoTasksState ? (");
    expect(sessionPageSource).toContain(") : hasSelectedTask ? (");
    expect(sessionPageSource).toContain('{t("workspace.no_tasks")}');
    expect(sessionPageSource).not.toContain("[border-bottom-width:0.5px] dark:border-white/[0.06] dark:bg-background/72");
    expect(sessionPageSource).not.toContain("shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]");
    expect(chineseLocaleSource).toContain('"workspace.no_tasks": "没有任务"');

    const sessionRouteSource = readFileSync(
      new URL("../src/react-app/shell/session-route.tsx", import.meta.url),
      "utf8",
    );
    expect(sessionRouteSource).toContain("selectedSessionKnown={selectedSessionKnown}");
  });

  test("moves engine metadata to project actions and shows context health in the composer", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );
    const sidebarSource = readFileSync(
      new URL("../src/react-app/domains/session/sidebar/app-sidebar.tsx", import.meta.url),
      "utf8",
    );
    const sessionRouteSource = readFileSync(
      new URL("../src/react-app/shell/session-route.tsx", import.meta.url),
      "utf8",
    );
    const composerSource = readFileSync(
      new URL("../src/react-app/domains/session/surface/composer/composer.tsx", import.meta.url),
      "utf8",
    );
    const conversationEngineSource = readFileSync(
      new URL("../src/react-app/domains/session/engine/conversation-engine.ts", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).not.toContain("function ProjectEngineBadge");
    expect(sessionPageSource).not.toContain("composerEndAccessory={(");
    expect(sessionPageSource).not.toContain('testId="session-composer-engine-badge"');
    expect(sidebarSource).toContain("function workspaceEngineLabel");
    expect(sidebarSource).toContain('data-testid="project-engine-menu-info"');
    expect(sidebarSource).toContain('<span className="truncate">{workspaceEngineLabel(workspace.engineId)}</span>');
    expect(sessionPageSource).not.toContain("SessionEngineBadge");
    expect(composerSource).toContain('data-testid="composer-context-health"');
    expect(conversationEngineSource).toContain("CONTEXT_COMPRESSION_WARNING_PERCENT = 80");
    expect(composerSource).toContain('t("composer.context_compression_warning")');
    expect(sessionPageSource).not.toContain('className="pointer-events-none hidden md:flex md:justify-self-center"');
    expect(sessionRouteSource).toContain("modelContextWindow: selectedModelContextWindow");
  });

  test("switches task files between the full workspace tree and key outputs", () => {
    const artifactSource = readFileSync(
      new URL("../src/components/chat/artifact.tsx", import.meta.url),
      "utf8",
    );
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );
    const messageListSource = readFileSync(
      new URL("../src/components/chat/message-list.tsx", import.meta.url),
      "utf8",
    );
    const tree = buildWorkspaceFileTree([
      { path: "design/session-1/entry.html", kind: "file", size: 120, mtimeMs: 1, revision: "a" },
      { path: "design/session-1/export/deck.pptx", kind: "file", size: 220, mtimeMs: 2, revision: "b" },
      { path: "src/main.tsx", kind: "file", size: 320, mtimeMs: 3, revision: "c" },
    ]);

    expect(tree.map((node) => node.name)).toEqual(["design", "src"]);
    expect(filterWorkspaceFileTree(tree, "deck")).toEqual([
      expect.objectContaining({
        name: "design",
        children: [expect.objectContaining({ name: "session-1" })],
      }),
    ]);
    expect(artifactSource).toContain('data-testid="conversation-files-mode-directory"');
    expect(artifactSource).toContain('data-testid="conversation-files-mode-outputs"');
    expect(artifactSource).toContain("client.listWorkspaceFiles(workspaceId)");
    expect(artifactSource).toContain("htmlArtifactFilenameFromTitle(sessionTitle)");
    expect(artifactSource).toContain("minmax(220px,1fr)");
    expect(artifactSource).toContain("min-h-[76px]");
    expect(sessionPageSource).toContain("workspaceRoot={props.selectedWorkspaceRoot}");
    expect(sessionPageSource).toContain("sessionTitle={selectedSessionTitle}");
    expect(messageListSource).toContain("sessionTitle={sessionTitle}");
  });

  test("process duration uses a compact clock format", () => {
    expect(formatProcessDuration(8_400)).toBe("00:08");
    expect(formatProcessDuration(83_000)).toBe("01:23");
    expect(formatProcessDuration(3_723_000)).toBe("1:02:03");
  });

  test("assistant process state does not report failed turns as completed", () => {
    expect(getAssistantProcessState(true, true)).toBe("streaming");
    expect(getAssistantProcessState(false, true)).toBe("failed");
    expect(getAssistantProcessState(false, false)).toBe("completed");
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

  test("template application uses one shared dialog with supplemental references", () => {
    const source = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("function TemplateApplyDialog(");
    expect(source).toContain('data-testid="template-apply-dialog"');
    expect(source).not.toContain('t("templates.brief.required_information")');
    expect(source).not.toContain('t("templates.brief.required_progress")');
    expect(source).not.toContain(">{config.label}</p>");
    expect(source).not.toContain('t("common.optional_parens")');
    expect(source).toContain('!field.optional ? <span className="text-destructive" aria-hidden="true"> *</span> : null');
    expect(source).toContain("required={!field.optional}");
    expect(source).toContain("showCloseButton={false}");
    expect(source).toContain("max-w-[800px]");
    expect(source).toContain('className="flex flex-col gap-1.5 text-ui-body font-semibold leading-5 text-foreground"');
    expect(source).toContain('t("templates.brief.destination_description")');
    expect(source).toContain('<SelectContent positionerClassName="z-[90]">');
    expect(source).toContain('mode === "current-conversation" ? t("templates.brief.apply_current") : config.submitLabel');
    expect(source).toContain('t("templates.brief.supplemental_information")');
    expect(source).toContain("REFERENCE_FILE_ACCEPT");
    expect(source).toContain('t("templates.brief.upload_file")');
    expect(source).toContain('t("templates.brief.reference_supported_formats")');
    expect(source).not.toContain('t("templates.brief.reference_description")');
    expect(source).toContain('mode === "market" && projects && selectedProjectId && onProjectChange');
    expect(source).toContain('data-testid="template-conflict-dialog"');
    expect(source).toContain('t("templates.brief.conflict_description_generic")');
    expect(source).toContain('newTaskRequired={pendingTemplateApplication.origin === "conversation-conflict"}');
    expect(source).not.toContain('t("templates.brief.choose_project_file")');
    expect(source).not.toContain('t("templates.brief.add_link")');
    expect(source).not.toContain('t("templates.brief.use_current_conversation")');
    expect(source).not.toContain("TEMPLATE_REFERENCE_UPLOAD_VISIBLE");
    expect(source).not.toContain("function TemplateBriefDialog(");
    expect(source).not.toContain("import { ReferenceUploadPanel }");
    expect(source).not.toContain("<ReferenceUploadPanel");
    expect(source).not.toContain('t("templates.brief.reference_label")');
  });

  test("design and video composers keep the existing attachment entry", () => {
    const source = readFileSync(
      new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url),
      "utf8",
    );
    const initialProjectSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );
    const composerSource = readFileSync(
      new URL("../src/react-app/domains/session/surface/composer/composer.tsx", import.meta.url),
      "utf8",
    );
    const sessionPromptSource = readFileSync(
      new URL("../src/react-app/shell/session-prompt.ts", import.meta.url),
      "utf8",
    );
    const messageListSource = readFileSync(
      new URL("../src/components/chat/message-list.tsx", import.meta.url),
      "utf8",
    );
    const sessionSurfaceSource = readFileSync(
      new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("onAttachFiles={handleAttachFiles}");
    expect(source).toContain("onUseTemplate={props.onMaterializeTemplate");
    expect(source).toContain(": props.onCreateSession");
    expect(initialProjectSource).toContain("onAttachFiles={attachFiles}");
    expect(initialProjectSource).not.toContain("function TemplateReferenceAgentPanel");
    expect(initialProjectSource).not.toContain("<TemplateReferenceAgentPanel");
    expect(initialProjectSource).toContain("templateAssistantWait");
    expect(initialProjectSource).toContain("assistantWaitLabel=");
    expect(initialProjectSource).toContain('t("templates.brief.reference_agent_processing_label"');
    expect(messageListSource).toContain("assistantWaitLabel?: string");
    expect(messageListSource).toContain("liveActionLabel ?? assistantWaitLabel");
    expect(sessionSurfaceSource).toContain("assistantWaitLabel?: string");
    expect(initialProjectSource).not.toContain("attachmentRequiresNativeModelSupport");
    expect(initialProjectSource).not.toContain("modelSafeAttachments");
    expect(initialProjectSource).toContain("ingestReferenceFile(item.file)");
    expect(initialProjectSource).toContain("inferTemplateBriefFromIngestions(");
    expect(initialProjectSource).toContain("buildTemplateReferenceSubmitPayload(references)");
    expect(initialProjectSource).toContain("referencePayload.contextPack.promptText.trim()");
    expect(sessionPromptSource).toContain("Use these workspace-relative paths");
    expect(initialProjectSource).toContain("referenceFiles: references.map");
    expect(composerSource).toContain('import { flushSync } from "react-dom";');
    expect(composerSource).toContain("maxAttachmentBytes?: number;");
    expect(composerSource).toContain("const maxAttachmentBytes = props.maxAttachmentBytes ?? MAX_ATTACHMENT_BYTES;");
    expect(composerSource).toContain('t("composer.plus_attach_files")');
    expect(composerSource).toContain("props.onAttachFiles(accepted)");
    expect(composerSource).toContain("flushSync(() => {");
    expect(composerSource).toMatch(/setToolMenuOpen\(false\);\r?\n\s+setDelegationMenuOpen\(false\);/);
    expect(composerSource).toContain("input?.click();");
    expect(composerSource).toContain('window.addEventListener("pointermove", handlePointerMove);');
    expect(composerSource).toMatch(/setPlusMenuSection\(null\);\r?\n\s+setToolMenuOpen\(false\);\r?\n\s+setDelegationMenuOpen\(false\);/);
  });

  test("starter template strip is clipped to the workspace column", () => {
    const source = readFileSync(
      new URL("../src/components/chat/new-conversation-starter.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('data-testid="new-conversation-template-strip"');
    expect(source).toContain("min-w-0 overflow-hidden rounded-xl");
    expect(source).toContain("flex min-w-0 snap-x snap-mandatory");
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
      source.indexOf('const link = event.target.closest("[data-ipollowork-link-href]")'),
      source.indexOf('const button = event.target.closest("[data-ipollowork-image-toggle]")'),
    );
    const fileLinkRenderer = source.slice(
      source.indexOf("if (isFilePath)"),
      source.indexOf('return `<a href="${safe}"', source.indexOf("if (isFilePath)")),
    );

    expect(clickHandler).toContain("onOpenTarget(target);");
    expect(clickHandler).toContain("event.preventDefault();");
    expect(clickHandler).not.toContain("external: true");
    expect(fileLinkRenderer).toContain('<button type="button" data-ipollowork-link-href=');
    expect(fileLinkRenderer).not.toContain('target="_blank"');
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
