import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
  });

  test("scopes workspaces and therefore all sessions to the active work context", () => {
    expect(routeState).toContain("filterWorkspacesForWorkContext(");
    expect(routeState).toContain("workContextRef.current !== requestedContextId");
    expect(sessionRoute).toContain("workContextId: activeWorkContextId");
    expect(sessionRoute).toContain("sessionsByWorkspaceId,");
    expect(sessionRoute).not.toContain("ChatSpace");
    expect(workContext).toContain('joinDesktopPath(homeDir, ".ipollowork", "work-contexts", connection.id)');
    expect(workContext).toContain("rememberWorkspaceForWorkContext(contextId, workspaceId)");
  });
});
