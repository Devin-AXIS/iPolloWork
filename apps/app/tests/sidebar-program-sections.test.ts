import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const sidebarSource = readFileSync(
  new URL("../src/react-app/domains/session/sidebar/app-sidebar.tsx", import.meta.url),
  "utf8",
);
const storeSource = readFileSync(
  new URL("../src/react-app/domains/session/sidebar/session-management-store.ts", import.meta.url),
  "utf8",
);
const sessionPageSource = readFileSync(
  new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
  "utf8",
);

describe("sidebar Program and Ungrouped sections", () => {
  test("uses the exported Figma assets and labels", () => {
    expect(sidebarSource).toContain("sidebar-icon/figma-folder-closed.svg");
    expect(sidebarSource).toContain("sidebar-icon/figma-section-chevron-down.svg");
    expect(sidebarSource).toContain("sidebar-icon/figma-section-${name}.svg");
    expect(sidebarSource).toContain('<SidebarSectionIcon name="plus" />');
    expect(sidebarSource).toContain('<SidebarSectionIcon name="ellipsis" />');
    expect(sidebarSource).toContain('label={t("session_management.program")}');
    expect(sidebarSource).toContain('label={t("session_management.ungrouped")}');
  });

  test("keeps ungrouped sessions only in Ungrouped", () => {
    expect(sidebarSource).toContain("ungroupedRows.push(row)");
    expect(sidebarSource).toContain("{ungroupedRows.length > 0 ? (");
    expect(sidebarSource).toContain('rootIndent="recent"');
    expect(sidebarSource).not.toContain('label={t("session_management.recently")}');
  });

  test("orders grouped, ungrouped, and child conversations by most recent activity", () => {
    expect(sidebarSource).toContain("const compareByMostRecent");
    expect(sidebarSource).toContain("right.session.time?.updated ?? right.session.time?.created");
    expect(sidebarSource).toContain("rootRowsByGroup.values()) rows.sort(compareByMostRecent)");
    expect(sidebarSource).toContain("childrenByParent.values()) rows.sort(compareByMostRecent)");
    expect(sidebarSource).toContain("ungroupedRows.sort(compareByMostRecent)");
  });

  test("keeps rename and delete in the group's more menu", () => {
    expect(sidebarSource).toContain('t("session_management.group_actions"');
    expect(sidebarSource).toContain('t("session_management.rename_group")');
    expect(sidebarSource).toContain('t("session_management.remove_group")');
  });

  test("creates a conversation in the current group from the unified plus action", () => {
    expect(sidebarSource).toContain('aria-label={t("session_management.new_conversation_in_group"');
    expect(sidebarSource).toContain('<SidebarSectionIcon name="plus" />');
    expect(sidebarSource).toContain('Promise.resolve(ctx.onCreateTaskInWorkspace(workspaceId, "work")).then((sessionId) =>');
    expect(sidebarSource).toContain("assignGroup(workspaceId, sessionId, group.id)");
  });

  test("keeps global new conversations and template launches in the active project group", () => {
    expect(storeSource).toContain("activeGroupByWorkspace: Record<string, string>;");
    expect(storeSource).toContain("setActiveGroup: (workspaceId: string, groupId: string | null) => void;");
    expect(sidebarSource).toContain("const activeSessionGroupId = useActiveWorkspaceGroupId(props.selectedWorkspaceId)");
    expect(sidebarSource).toContain("isActive={activeSessionGroupId === group.id}");
    expect(sidebarSource).toContain("setActiveGroup(workspaceId, group.id)");
    expect(sidebarSource).toContain('props.onCreateTaskInWorkspace(props.selectedWorkspaceId, "work", undefined, undefined, activeSessionGroupId)');
    expect(sessionPageSource).toContain("const activeSessionGroupId = useActiveWorkspaceGroupId(props.selectedWorkspaceId)");
    expect(sessionPageSource).toContain("templateResourceScope,\n            activeSessionGroupId,");
    expect(sessionPageSource).toContain("props.sidebar.onCreateTemplateAuthoring(props.selectedWorkspaceId, input, activeSessionGroupId)");
  });

  test("reveals section and conversation actions only during interaction", () => {
    expect(sidebarSource).toContain("group-hover/section-header:opacity-100");
    expect(sidebarSource).toContain("group-focus-within/section-header:opacity-100");
    expect(sidebarSource).toContain("group-hover/session-group-row:opacity-100");
    expect(sidebarSource).toContain("opacity-0 group-hover/menu-sub-item:opacity-100");
    expect(sidebarSource).not.toContain("actionsAlwaysVisible");
  });

  test("reveals Program and Ungrouped disclosure icons only during interaction", () => {
    expect(sidebarSource).toContain("opacity-0 transition-[transform,opacity] group-hover/section-header:opacity-100");
    expect(sidebarSource).toContain("group-focus-within/section-header:opacity-100");
  });

  test("adds four-pixel horizontal padding to Ungrouped conversation controls", () => {
    expect(sidebarSource).toContain('rootIndent === "recent" ? "ps-1"');
    expect(sidebarSource).toContain('rootIndent === "recent" ? "right-1"');
  });

  test("matches the 32-pixel folder row and four-pixel conversation gap", () => {
    expect(sidebarSource).toContain('group/session-group-row flex h-8 w-full items-center justify-between rounded-[8px] px-1');
    expect(sidebarSource).toContain('className="group/session-group flex flex-col gap-1"');
    expect(sidebarSource).toContain('<CollapsibleContent className="flex flex-col gap-1">');
    expect(sidebarSource).toContain('className="flex h-8 shrink-0 items-center gap-1 opacity-0');
  });

  test("supports renaming and safely removing projects", () => {
    expect(storeSource).toContain("renameGroup: (workspaceId, groupId, label) =>");
    expect(storeSource).toContain("sessionGroupSyncHandler?.renameGroup(workspaceId, groupId, nextLabel)");
    expect(sessionPageSource).toContain('title={t("session_management.remove_group_title")}');
    expect(sessionPageSource).toContain("removeGroup(removeGroupTarget.workspaceId, removeGroupTarget.groupId)");
  });

  test("renders the selected workspace history instead of the first workspace", () => {
    expect(sidebarSource).toContain("const sidebarWorkspaceSessionGroups = React.useMemo");
    expect(sidebarSource).toContain("entry.workspace.id === props.selectedWorkspaceId");
    expect(sidebarSource).toContain("{sidebarWorkspaceSessionGroups.map((group) => (");
    expect(sidebarSource).not.toContain("{props.workspaceSessionGroups.slice(0, 1).map((group) => (");
  });
});
