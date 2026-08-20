import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import { buildSessionTreeState } from "../src/react-app/domains/session/sidebar/utils";

const sidebarSource = readFileSync(
  new URL("../src/react-app/domains/session/sidebar/app-sidebar.tsx", import.meta.url),
  "utf8",
);
const pinStoreSource = readFileSync(
  new URL("../src/react-app/domains/session/sidebar/session-pin-store.ts", import.meta.url),
  "utf8",
);
const sessionPageSource = readFileSync(
  new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
  "utf8",
);
const sessionRouteSource = readFileSync(
  new URL("../src/react-app/shell/session-route.tsx", import.meta.url),
  "utf8",
);
const starterSource = readFileSync(
  new URL("../src/components/chat/new-conversation-starter.tsx", import.meta.url),
  "utf8",
);
const composerSource = readFileSync(
  new URL("../src/react-app/domains/session/surface/composer/composer.tsx", import.meta.url),
  "utf8",
);
const sessionSurfaceSource = readFileSync(
  new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url),
  "utf8",
);
const composerEditorSource = readFileSync(
  new URL("../src/react-app/domains/session/surface/composer/editor.tsx", import.meta.url),
  "utf8",
);
const appStyleSource = readFileSync(
  new URL("../src/app/index.css", import.meta.url),
  "utf8",
);
const englishLocaleSource = readFileSync(
  new URL("../src/i18n/locales/en.ts", import.meta.url),
  "utf8",
);
const chineseLocaleSource = readFileSync(
  new URL("../src/i18n/locales/zh.ts", import.meta.url),
  "utf8",
);

describe("sidebar projects", () => {
  test("renders named projects inside an independently collapsible all-projects section", () => {
    expect(sidebarSource).not.toContain("function ProjectSwitcher");
    expect(sidebarSource).not.toContain("selectedProjectSessionLists");
    expect(sidebarSource).toContain("const [projectsExpanded, setProjectsExpanded] = React.useState(true)");
    expect(sidebarSource).toContain("const namedProjects = props.projectSessionLists.filter((project) => !project.workspace.isDefault)");
    expect(sidebarSource).toContain("namedProjects.map((project)");
    expect(sidebarSource).toContain('toggleTestId="projects-section-toggle"');
    expect(sidebarSource).toContain('data-testid="project-row"');
    expect(sidebarSource).toContain('data-selected={isSelectedProject ? "true" : "false"}');
    expect(sidebarSource).toContain('aria-pressed={isSelectedProject}');
    expect(sidebarSource).toContain('aria-expanded={projectExpanded}');
    expect(sidebarSource).toContain("const isSelectedProject = isCurrentProject && !ctx.selectedSessionId;");
    expect(sidebarSource).toContain("if (isCurrentProject) setProjectExpanded(true);");
    expect(sidebarSource).toContain('isSelectedProject && "bg-sidebar-accent font-medium text-sidebar-accent-foreground mac:bg-black/5 dark:mac:bg-white/10"');
    expect(sidebarSource).toContain('<SidebarMenuSub className="mt-[2px] translate-x-0 gap-1 pb-2">');
    expect(sessionRouteSource).toContain("const rememberedSessionId = readLastSessionFor(workspaceId);");
    expect(sessionRouteSource).toContain("?? rememberedSessionId");
    expect(sessionRouteSource).toContain("navigateToWorkspaceSession(workspaceId, targetSessionId);");
    expect(sidebarSource).toContain("onSelectProject(workspace.id)");
    expect(sidebarSource).toContain("<ConversationList");
    expect(sidebarSource).not.toContain("group-data-open/project:rotate-90");
  });

  test("keeps new conversation primary and moves project creation to the projects header", () => {
    expect(sidebarSource).toContain('data-testid="new-conversation-and-project-actions"');
    expect(sidebarSource).toContain('addTestId="new-project-button"');
    expect(sidebarSource).toContain('t("session.new_task")');
    expect(sidebarSource).toContain('t("projects.create")');
    expect(sidebarSource.match(/className="flex size-4 shrink-0 items-center justify-center"/g)).toHaveLength(4);
    expect(sidebarSource).toContain('primarySidebarActionClassName = "h-8 gap-2 rounded-[8px] px-2');
    expect(sidebarSource).toContain('<SidebarMenu className="gap-1">');
  });

  test("hides the default workspace and renders only named projects", () => {
    expect(sidebarSource).toContain("const namedProjects = props.projectSessionLists.filter((project) => !project.workspace.isDefault)");
    expect(sidebarSource).not.toContain("ungroupedExpanded");
    expect(sidebarSource).not.toContain("ungroupedProject");
    expect(sidebarSource).not.toContain('data-testid="ungrouped-section"');
    expect(sidebarSource).not.toContain('label={t("projects.ungrouped")}');
    expect(sidebarSource).not.toContain("createUngroupedConversation");
  });

  test("creates the first project and task with OpenCode only after the starter is submitted", () => {
    expect(sessionPageSource).toContain('data-testid="initial-project-task-starter"');
    expect(sessionPageSource).toContain("showInitialProjectTaskStarter");
    expect(sessionPageSource).toContain("props.sidebar.onCreateInitialProjectTask");
    expect(sessionPageSource).toContain('testId="initial-project-engine-badge"');
    expect(sessionPageSource).not.toContain('data-testid="initial-project-engine-dialog"');
    expect(sessionPageSource).toContain("await onSubmit(composerDraft)");
    expect(sessionPageSource).toContain('engineId={engineId ?? DEFAULT_ENGINE_ID}');
    expect(sessionPageSource).toContain("<ProjectEngineOptions");
    expect(composerSource).toContain("endAccessory?: ReactNode");
    expect(composerSource).toContain('inlineAppearance?: "default" | "engine-selected"');
    expect(sessionPageSource).not.toContain('inlineAppearance="engine-selected"');
    expect(sessionPageSource).toContain('testId="session-composer-engine-badge"');
    expect(sessionPageSource).not.toContain('testId="session-engine-badge"');
    expect(sessionSurfaceSource).toContain("composerEndAccessory?: ReactNode");
    expect(sessionSurfaceSource).toContain("endAccessory={props.composerEndAccessory}");
    expect(composerSource).toContain("{props.endAccessory}");
    expect(sessionRouteSource).toContain("const handleCreateInitialProjectTask = useCallback(");
    expect(sessionRouteSource).toContain("engineId: DEFAULT_ENGINE_ID");
    expect(sessionRouteSource).not.toMatch(/handleCreateInitialProjectTask[\s\S]{0,500}selectedWorkspace\?\.engineId/);
    expect(sessionRouteSource).toContain('name: t("session.untitled")');
    expect(sessionRouteSource).toContain("surfaceProps.onSendDraft(pending.draft, pending.sessionId)");
    expect(sessionPageSource).toContain("selectedProjectHasNoTasks");
    expect(sessionPageSource).toContain("props.sidebar.onCreateInitialProjectTask(");
    expect(sessionPageSource).toContain("promptTemplates={conversationTemplates}");
    expect(sessionPageSource).toContain("templates={availableStarterTemplateCatalog}");
    expect(sessionPageSource).toContain("getTemplateCover={getStarterTemplateCover}");
    expect(sessionPageSource).toContain("onRequestTemplates={() => void refreshStarterTemplateCatalog()}");
    expect(sessionRouteSource).toContain("const handleCreateInitialProjectTask = useCallback(async (draft: ComposerDraft, workspaceId?: string)");
    expect(sessionRouteSource).toContain("navigateToWorkspaceSession(workspaceId, latestSession.id, { replace: true });");
    expect(sessionRouteSource).toMatch(
      /!loading[\s\S]*selectedWorkspaceId[\s\S]*!workspaces\.some\(\(workspace\) => !workspace\.isDefault\)[\s\S]*dismissFirstRunLoader\(\)/,
    );
  });

  test("matches the project-first starter design in both themes", () => {
    expect(starterSource).toContain('className="mt-8 flex h-[42px] w-fit max-w-full items-center gap-2 rounded-full bg-muted p-1"');
    expect(starterSource).toContain('"relative isolate inline-flex h-9 w-[92px]');
    expect(starterSource).toContain('? "text-foreground"');
    expect(starterSource).toContain('data-testid="new-conversation-mode-indicator"');
    expect(starterSource).not.toContain('{t("new_conversation.subtitle")}');
    expect(starterSource).toContain('return t("new_conversation.placeholder")');
    expect(appStyleSource).toContain("--dls-active: var(--slate-4)");
    expect(composerEditorSource).toContain('text-[15px] leading-6 text-[color:var(--new-conversation-placeholder)]');
    expect(composerEditorSource).toContain('data-testid="composer-placeholder"');
    expect(englishLocaleSource).toContain('"new_conversation.placeholder": "Choose a direction, or describe the work in your own words."');
    expect(chineseLocaleSource).toContain('"new_conversation.placeholder": "选择一个方向，或直接描述你要推进的工作。"');
    expect(chineseLocaleSource).toContain('"projects.choose_engine": "选择项目引擎"');
    expect(chineseLocaleSource).toContain('"projects.default_engine": "项目引擎"');
    expect(chineseLocaleSource).toContain('"projects.engine_running": "引擎运行中"');
    expect(englishLocaleSource).toContain('"projects.engine_running": "Engine running"');
    expect(englishLocaleSource).toContain('"session.new_task": "New task"');
    expect(chineseLocaleSource).toContain('"session.new_task": "新建任务"');
    expect(englishLocaleSource).toContain('"session.default_title": "New task"');
    expect(chineseLocaleSource).toContain('"session.default_title": "新任务"');
  });

  test("reveals section toggles on hover and supports single-click on the full header", () => {
    expect(sidebarSource).toContain("group-hover/section:opacity-100");
    expect(sidebarSource).toContain("group-focus-within/section:opacity-100");
    expect(sidebarSource).toContain('type="button"');
    expect(sidebarSource).toContain("onClick={onToggle}");
    expect(sidebarSource).toContain('aria-expanded={expanded}');
    expect(sidebarSource).not.toContain("onDoubleClick={onToggle}");
  });

  test("manages project folders without restoring the legacy workspace UI", () => {
    expect(sidebarSource).toMatch(/if \(isSelectedProject\)[\s\S]*setProjectExpanded\(\(expanded\) => !expanded\);/);
    expect(sidebarSource).not.toContain("onDoubleClick={() => setProjectExpanded");
    expect(sidebarSource).toContain('data-testid="project-new-conversation-button"');
    expect(sidebarSource).toContain("const createConversationInProject = async () =>");
    expect(sidebarSource).toMatch(/await onSelectProject\(workspace\.id\);[\s\S]*await ctx\.onCreateTaskInWorkspace\(workspace\.id\);/);
    expect(sidebarSource).toContain('disabled={showInitialLoading || isConnectionActionBusy}');
    expect(sessionRouteSource).not.toContain("retryingWorkspaceIds.includes(workspaceId)");
    expect(sidebarSource).toContain('t("projects.rename")');
    expect(sidebarSource).toContain('t("projects.show_in_folder")');
    expect(sessionPageSource).toContain("pickDirectory({ title: t(\"projects.choose_folder\") })");
    expect(sessionPageSource).toContain("props.sidebar.onCreateProject({ name, folderPath, engineId: createProjectEngineId })");
    expect(sidebarSource).not.toContain("WorkspaceHeader");
    expect(sidebarSource).not.toContain("WorkspaceActionsMenu");
  });

  test("rejects an existing project folder with a visible message", () => {
    expect(sessionRouteSource).toContain("normalizeDirectoryPath(requestedFolderPath)");
    expect(sessionRouteSource).toMatch(
      /const existingProject = workspaces\.find[\s\S]*throw new Error\(t\("projects\.folder_already_in_use"\)\)/,
    );
    expect(sessionRouteSource).not.toContain("await selectProject(existingProject.id)");
    expect(sessionPageSource).toContain('{createProjectError ? <p role="alert"');
  });

  test("creates a managed local project when no source folder is selected", () => {
    expect(sessionPageSource).toContain("if (!name) return;");
    expect(sessionPageSource).toContain('disabled={createProjectBusy || !createProjectName.trim()}');
    expect(sessionRouteSource).toContain("folderPath: folderPath || undefined");
    expect(sessionRouteSource).toContain('if (!folderPath) throw new Error(t("projects.create_failed"));');
    expect(sessionRouteSource).not.toContain('if (!name || !requestedFolderPath)');
  });

  test("matches the project creation design with localized, theme-aware controls", () => {
    expect(sessionPageSource).toContain('data-testid="create-project-dialog"');
    expect(sessionPageSource).not.toContain('showCloseButton={false}');
    expect(sessionPageSource).toContain('data-testid="project-folder-picker"');
    expect(sessionPageSource).toContain('data-testid="project-engine-option"');
    expect(sessionPageSource).toContain('max-w-[516px]');
    expect(sessionPageSource).toContain('t("projects.engine_locked_notice")');
    expect(sessionPageSource).toContain('props.onOpenProviderAuth?.("deepseek-official")');
    expect(sessionPageSource).toContain('t("projects.configure_deepseek_key")');
    expect(sessionPageSource).toContain("<RadioGroup");
    expect(sessionPageSource).toContain("projectEngineSelectedIcon");
    expect(sessionPageSource).toContain("projectEngineOpenCodeIcon");
    expect(sessionPageSource).toContain("projectEngineDeepSeekIcon");
    expect(sessionPageSource).toContain('data-state={selected ? "selected" : "default"}');
    expect(sessionPageSource).toContain("grid w-full grid-cols-1 gap-4 sm:grid-cols-2");
    expect(sessionPageSource).toContain("min-h-[120px]");
    expect(sessionPageSource).toContain('iconClassName: "h-6 w-[19px] dark:invert"');
    expect(sessionPageSource).toContain('iconClassName: "h-6 w-[33px]"');
    expect(sessionPageSource).toContain("hover:bg-dls-canvas");
    expect(sessionPageSource).toContain("hover:bg-dls-surface-muted focus-visible:bg-dls-surface-muted");
    expect(sessionPageSource).toContain('t("projects.engine_running")');
    expect(sessionPageSource).toContain("has-focus-visible:ring-3 has-focus-visible:ring-ring/30");
    expect(sessionPageSource).not.toContain("focus-within:ring-3");
    expect(sessionPageSource).toContain('<DialogDescription className="text-[13px] leading-5">');
    expect(sessionPageSource).toContain('className="block text-[13px] font-medium leading-5 text-foreground"');
    expect(sessionPageSource).toContain('className="text-xs leading-[22px] text-muted-foreground"');
    expect(sessionPageSource).toContain('text-[11px] leading-4 text-muted-foreground');
    expect(appStyleSource).toContain("--project-dialog-accent: #1fbac0");
    expect(appStyleSource).toContain("--project-dialog-option-border: #e7e7e8");
    expect(sessionPageSource).toContain('data-testid="project-name-icon"');
    expect(sessionPageSource).toContain('className="pointer-events-none absolute start-3 top-1/2 z-10 flex size-6');
    expect(sessionPageSource).toContain('className="flex h-10 w-full items-center gap-3 rounded-lg border border-border bg-background px-3');
    expect(sessionPageSource).toContain('data-testid="project-folder-icon"');
    expect(sessionPageSource).toContain('className="flex size-6 shrink-0 items-center justify-center"');
    expect(sessionPageSource).toContain('placeholder-shown:text-[13px] placeholder-shown:leading-5 placeholder:text-slate-9 focus-visible:ring-0! has-focus-visible:ring-0! dark:placeholder:text-slate-11');
    expect(sessionPageSource).toContain('data-testid="project-folder-label"');
    expect(sessionPageSource).toContain('? "text-sm leading-[22px] text-foreground"');
    expect(sessionPageSource).toContain(': "text-[13px] leading-5 text-slate-9 dark:text-slate-11"');
    expect(sessionPageSource).not.toContain('h-[141px]');
    expect(sessionPageSource).not.toContain('border-dashed');
    expect(sessionPageSource).toContain('createProjectFolder || t("projects.choose_folder")');
    expect(englishLocaleSource).not.toContain('"projects.add_folder"');
    expect(chineseLocaleSource).not.toContain('"projects.add_folder"');
    expect(englishLocaleSource).toContain('"projects.name_example": "For example: iPolloWork"');
    expect(chineseLocaleSource).toContain('"projects.name_example": "例如：iPolloWork"');
    expect(existsSync(new URL("../src/react-app/domains/session/chat/assets/project-engine-selected.svg", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../src/react-app/domains/session/chat/assets/project-engine-unselected.svg", import.meta.url))).toBe(true);
  });

  test("keeps header actions right-aligned and exposes the current project", () => {
    expect(sessionPageSource).toContain('data-testid="session-header-project"');
    expect(sessionPageSource).toContain("<ProjectHeaderButton projectName={selectedProjectName} />");
    expect(sessionPageSource).toContain('publicAssetUrl("sidebar-icon/figma-folder-closed.svg")');
    expect(sessionPageSource).toContain('className="h-auto w-3.5 dark:invert"');
    expect(sessionPageSource).toContain('<TooltipContent side="bottom" align="start">{projectName}</TooltipContent>');
    expect(sessionPageSource).toContain("(showWorkspaceSetupEmptyState || props.selectedSessionId)");
    expect(sessionPageSource).toContain('data-testid="session-header-actions"');
    expect(sessionPageSource).toContain("md:col-start-3 md:justify-self-end");
  });

  test("shows nested conversation activity on a collapsed project", () => {
    const tree = buildSessionTreeState(
      [
        { id: "root", title: "Root" },
        { id: "child", title: "Child", parentID: "root" },
      ],
      { child: "responding" },
    );

    expect(tree.activeIds.has("root")).toBe(true);
    expect(tree.streamingIds.has("root")).toBe(true);
    expect(sidebarSource).toContain("!projectExpanded ? (");
    expect(sidebarSource).toContain("isStreaming={projectIsStreaming}");
    expect(sidebarSource).toContain("isActive={projectIsActive}");
  });

  test("renders conversations directly under each project", () => {
    expect(sidebarSource).toContain("function ConversationList");
    expect(sidebarSource).toContain("flattenSessionRows(");
    expect(sidebarSource).toContain("remainingSessionCount");
    expect(sidebarSource).toContain('<SidebarMenuSub className="mt-[2px] translate-x-0 gap-1 pb-2">');
    expect(sidebarSource).toContain('const rowPadding = depth > 0 ? "ps-[68px]" : "ps-8";');
    expect(sidebarSource).not.toContain("GroupedSessionList");
  });

  test("keeps only the independent pin preference store", () => {
    expect(pinStoreSource).toContain('name: "ipollowork.react.sessionPins"');
    expect(pinStoreSource).toContain("togglePin");
    expect(existsSync(new URL("../src/react-app/domains/session/sidebar/session-management-store.ts", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../src/react-app/shell/use-session-group-sync.ts", import.meta.url))).toBe(false);
  });

  test("contains no session-group product or API surface", () => {
    const combined = `${sidebarSource}\n${sessionPageSource}`;
    expect(combined).not.toContain("SessionGroup");
    expect(combined).not.toContain("session-groups");
    expect(combined).not.toContain("groupsByWorkspace");
    expect(combined).not.toContain("onOpenCreateGroupModal");
  });
});
