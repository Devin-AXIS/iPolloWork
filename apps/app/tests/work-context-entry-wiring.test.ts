import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = readFileSync(resolve(import.meta.dir, "../src/react-app/shell/app-root.tsx"), "utf8");
const sidebar = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/sidebar/app-sidebar.tsx"),
  "utf8",
);
const enterpriseDialog = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/sidebar/enterprise-server-dialog.tsx"),
  "utf8",
);
const sessionRoute = readFileSync(
  resolve(import.meta.dir, "../src/react-app/shell/session-route.tsx"),
  "utf8",
);
const sessionPage = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/chat/session-page.tsx"),
  "utf8",
);
const routeState = readFileSync(
  resolve(import.meta.dir, "../src/react-app/shell/use-workspace-route-state.ts"),
  "utf8",
);
const workContext = readFileSync(
  resolve(import.meta.dir, "../src/app/lib/work-context.ts"),
  "utf8",
);
const cloudAccount = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/settings/cloud/cloud-account-section.tsx"),
  "utf8",
);
const legacyOrganizationWorkspaces = resolve(import.meta.dir, "../src/app/cloud/organization-workspaces.ts");

describe("personal and Enterprise chat entry wiring", () => {
  test("routes a completed account sign-in directly to chat", () => {
    expect(appRoot).toContain('navigate("/session", { replace: true })');
    expect(appRoot).not.toContain('path="/onboarding"');
    expect(appRoot).not.toContain("WorkContextEntryPage");
    expect(appRoot).not.toContain("denSessionUpdatedEvent");
  });

  test("keeps one enterprise join and switch entry in Account settings", () => {
    expect(sidebar).not.toContain("<EnterpriseServerDialog");
    expect(sidebar).not.toContain("setEnterpriseDialogOpen(true)");
    expect(enterpriseDialog).toContain("joinEnterpriseWithCode({");
    expect(enterpriseDialog).toContain("joinCode,");
    expect(enterpriseDialog).toContain("cloudToken: settings.authToken");
    expect(enterpriseDialog).toContain("props.onConnected(connection)");
    expect(enterpriseDialog).toContain("props.onOpenChange(false)");
    expect(cloudAccount).toContain("const workspaceId = connection");
    expect(cloudAccount).toContain('`#/workspace/${encodeURIComponent(workspaceId)}/session`');
    expect(cloudAccount).toContain("const personalWorkspaceId = await activatePersonalWorkContext()");
    expect(cloudAccount).toContain('`#/workspace/${encodeURIComponent(personalWorkspaceId)}/session`');
  });

  test("keeps all projects and sessions scoped to the active work context", () => {
    expect(routeState).toContain("filterWorkspacesForWorkContext(");
    expect(routeState).not.toContain("canonicalWorkspacesForWorkContext(");
    expect(routeState).not.toContain("pruneServerWorkspacesForWorkContext(");
    expect(routeState).toContain("workContextRef.current === requestedContextId");
    expect(sessionRoute).toContain("workContextId: activeWorkContextId");
    expect(sessionRoute).toContain("sessionsByWorkspaceId,");
    expect(sessionRoute).not.toContain("ChatSpace");
    expect(workContext).toContain('joinDesktopPath(homeDir, ".ipollowork", "work-contexts", connection.id)');
    expect(workContext).toContain("rememberProjectForWorkContext");
  });

  test("keeps market launches scoped while the starter catalog stays personal", () => {
    expect(sessionPage).toMatch(/template\.manifest\.id,\s+templateResourceScope,/);
    expect(sessionPage).toMatch(/props\.selectedSessionId,\s+undefined,\s+PERSONAL_WORK_CONTEXT_ID,/);
    expect(sessionPage).toContain("designTemplates={availableStarterTemplateCatalog}");
    expect(sessionRoute).toContain("templateScope ?? readActiveWorkContextId()");
    expect(sessionRoute).toContain("Template unavailable");
    expect(sessionRoute).toContain("deleteSession(endpoint.workspaceId, createdSessionId)");
  });

  test("restores lightweight project management without the legacy workspace UI", () => {
    expect(sidebar).not.toContain("function ProjectSwitcher");
    expect(sidebar).toContain('data-testid="project-row"');
    expect(sidebar).toContain('addTestId="new-project-button"');
    expect(sidebar).toContain("onSelectProject");
    expect(sessionRoute).toContain("createLocalWorkspace");
    expect(sessionRoute).toContain("deleteWorkspace");
    expect(sidebar).not.toContain("WorkspaceHeader");
    expect(sidebar).not.toContain("WorkspaceActionsMenu");
    expect(sidebar).not.toContain("onReorderWorkspaces");
    expect(sessionRoute).not.toContain('case "workspace.create"');
    expect(existsSync(legacyOrganizationWorkspaces)).toBe(false);
    expect(appRoot).not.toContain("CloudWorkspaceRouteSync");
  });
});
