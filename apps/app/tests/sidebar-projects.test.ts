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
  test("renders every project as a first-level sidebar folder", () => {
    expect(sidebarSource).not.toContain("function ProjectSwitcher");
    expect(sidebarSource).not.toContain("selectedProjectSessionLists");
    expect(sidebarSource).toContain("props.projectSessionLists.map((project)");
    expect(sidebarSource).toContain('data-testid="project-row"');
    expect(sidebarSource).toContain('aria-current={isSelectedProject ? "page" : undefined}');
    expect(sidebarSource).toContain('aria-expanded={projectExpanded}');
    expect(sidebarSource).toContain("onSelectProject(workspace.id)");
    expect(sidebarSource).toContain("<ConversationList");
    expect(sidebarSource).not.toContain("group-data-open/project:rotate-90");
  });

  test("keeps new conversation primary with a compact adjacent project action", () => {
    expect(sidebarSource).toContain('data-testid="new-conversation-and-project-actions"');
    expect(sidebarSource).toContain('data-testid="new-project-button"');
    expect(sidebarSource).toContain('t("session.new_task")');
    expect(sidebarSource).toContain('t("projects.create")');
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
    expect(sessionPageSource).toContain("props.sidebar.onCreateProject({ name, folderPath })");
    expect(sidebarSource).not.toContain("WorkspaceHeader");
    expect(sidebarSource).not.toContain("WorkspaceActionsMenu");
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
