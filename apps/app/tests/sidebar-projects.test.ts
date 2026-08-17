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

describe("sidebar projects", () => {
  test("renders named projects inside an independently collapsible all-projects section", () => {
    expect(sidebarSource).not.toContain("function ProjectSwitcher");
    expect(sidebarSource).not.toContain("selectedProjectSessionLists");
    expect(sidebarSource).toContain("const [projectsExpanded, setProjectsExpanded] = React.useState(true)");
    expect(sidebarSource).toContain("const namedProjects = props.projectSessionLists.filter((project) => !project.workspace.isDefault)");
    expect(sidebarSource).toContain("namedProjects.map((project)");
    expect(sidebarSource).toContain('toggleTestId="projects-section-toggle"');
    expect(sidebarSource).toContain('data-testid="project-row"');
    expect(sidebarSource).toContain('aria-current={isSelectedProject ? "page" : undefined}');
    expect(sidebarSource).toContain('aria-expanded={projectExpanded}');
    expect(sidebarSource).toContain("onSelectProject(workspace.id)");
    expect(sidebarSource).toContain("<ConversationList");
    expect(sidebarSource).not.toContain("group-data-open/project:rotate-90");
  });

  test("keeps new conversation primary and moves project creation to the projects header", () => {
    expect(sidebarSource).toContain('data-testid="new-conversation-and-project-actions"');
    expect(sidebarSource).toContain('addTestId="new-project-button"');
    expect(sidebarSource).toContain('t("session.new_task")');
    expect(sidebarSource).toContain('t("projects.create")');
  });

  test("renders the default workspace as a separate ungrouped conversation section", () => {
    expect(sidebarSource).toContain("const [ungroupedExpanded, setUngroupedExpanded] = React.useState(true)");
    expect(sidebarSource).toContain("const ungroupedProject = props.projectSessionLists.find((project) => project.workspace.isDefault)");
    expect(sidebarSource).toContain('data-testid="ungrouped-section"');
    expect(sidebarSource).toContain('toggleTestId="ungrouped-section-toggle"');
    expect(sidebarSource).toContain('label={t("projects.ungrouped")}');
    expect(sidebarSource).toContain("showProjectRow={false}");
    expect(sidebarSource).toContain("createUngroupedConversation");
  });

  test("reveals section toggles on hover and supports title double-click", () => {
    expect(sidebarSource).toContain("group-hover/section:opacity-100");
    expect(sidebarSource).toContain("group-focus-within/section:opacity-100");
    expect(sidebarSource).toContain("onDoubleClick={onToggle}");
    expect(sidebarSource).toContain("event.stopPropagation()");
  });

  test("manages project folders without restoring the legacy workspace UI", () => {
    expect(sidebarSource).toContain("onDoubleClick={() => setProjectExpanded((expanded) => !expanded)}");
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
