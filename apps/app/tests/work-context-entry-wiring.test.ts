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
const organizationServerDialog = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/settings/cloud/organization-server-affordance.tsx"),
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
  test("opens the sidebar sign-in entry through the live Cloud browser flow", () => {
    expect(sessionPage).toContain('buildDenAuthUrl(readDenSettings().baseUrl, "sign-in")');
    expect(sessionPage).toContain("tryOpenBrowserAuthUrl(url)");
    expect(sessionPage).toContain("if (!opened) openCloudAccount()");
    expect(sessionPage).toContain("onSignIn={openCloudSignIn}");
    expect(sessionPage).not.toContain("CloudSignInComingSoonDialog");
  });

  test("routes a completed account sign-in directly to chat", () => {
    expect(appRoot).toContain('navigate("/session", { replace: true })');
    expect(appRoot).toContain('path="/session/:sessionId?"');
    expect(appRoot).toContain('path="/workspace/:workspaceId/session/:sessionId?"');
    expect(appRoot).not.toContain('path="/workspace/:workspaceId/session"');
    expect(appRoot).not.toContain("sessionRouteKey");
    expect(appRoot.match(/<SessionRoute \/>/g)).toHaveLength(2);
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
    expect(enterpriseDialog).toContain("onConnected(connection)");
    expect(enterpriseDialog).toContain("onOpenChange(false)");
    expect(enterpriseDialog).toContain("if (!settings.authToken?.trim())");
    expect(enterpriseDialog).toContain("onSignInRequired()");
    expect(enterpriseDialog).toContain("window.addEventListener(denSessionUpdatedEvent, resumeJoin)");
    expect(enterpriseDialog).toContain('event.detail?.status === "success"');
    expect(enterpriseDialog).toContain('event.detail?.status !== "error"');
    expect(enterpriseDialog).toContain('t("enterprise_connection.signin_to_continue")');
    expect(cloudAccount).toContain("const workspaceId = connection");
    expect(cloudAccount).toContain('`#/workspace/${encodeURIComponent(workspaceId)}/session`');
    expect(cloudAccount).toContain("const personalWorkspaceId = await activatePersonalWorkContext()");
    expect(cloudAccount).toContain('`#/workspace/${encodeURIComponent(personalWorkspaceId)}/session`');
    expect(cloudAccount).toContain('data-testid="cloud-account-identity"');
    expect(cloudAccount).toContain('data-testid="cloud-workspaces"');
    expect(cloudAccount).toContain('data-testid="join-enterprise-workspace"');
    expect(cloudAccount).toContain('const { isSignedIn, user } = useCloudSession()');
    expect(cloudAccount).toContain('"enterprise_connection.local_personal_hint"');
    expect(cloudAccount).toContain('"enterprise_connection.local_personal"');
    expect(cloudAccount).toContain("{isSignedIn ? connections.map((connection) => {");
    expect(cloudAccount).toContain("onSignInRequired={onSignInRequired}");
    expect(cloudAccount).toContain('t("den.cloud_status", { status: statusLabel })');
    expect(cloudAccount).toContain('t("den.cloud_signed_in_desc")');
    expect(cloudAccount).toContain('t("enterprise_connection.enterprise_hint")');
    expect(cloudAccount).not.toContain("border-dashed");
    expect(cloudAccount.indexOf('data-testid="join-enterprise-workspace"')).toBeGreaterThan(
      cloudAccount.indexOf('t("enterprise_connection.personal")'),
    );
    expect(organizationServerDialog).toContain('DialogContent className="w-full max-w-md sm:max-w-md"');
    expect(organizationServerDialog).toContain("<DialogHeader>");
    expect(organizationServerDialog).toContain("<DialogFooter");
    expect(organizationServerDialog).toContain('className="mx-0 mb-0 border-0 bg-transparent p-0"');
  });

  test("keeps all projects and sessions scoped to the active work context", () => {
    expect(routeState).toContain("filterWorkspacesForWorkContext(");
    expect(routeState).not.toContain("canonicalWorkspacesForWorkContext(");
    expect(routeState).not.toContain("pruneServerWorkspacesForWorkContext(");
    expect(routeState).toContain("workContextRef.current === requestedContextId");
    expect(routeState).toContain("workspaceSetSelected(workspaceId)");
    expect(routeState).toContain("workspaceSetRuntimeActive(workspaceId)");
    expect(routeState).toContain("endpoint.client.activateWorkspace(endpoint.workspaceId, { persist: true })");
    expect(sessionRoute).toContain("workContextId: activeWorkContextId");
    expect(sessionRoute).toContain("sessionsByWorkspaceId,");
    expect(sessionRoute).not.toContain("ChatSpace");
    expect(workContext).toContain('joinDesktopPath(homeDir, ".ipollowork", "work-contexts", connection.id)');
    expect(workContext).toContain("rememberProjectForWorkContext");
  });

  test("keeps market launches scoped while the starter catalog stays personal", () => {
    expect(sessionPage).toContain('setPendingTemplateApplication({ item: template, origin: "market", resourceScope: templateResourceScope })');
    expect(sessionPage).toContain("resourceScope: application.resourceScope");
    expect(sessionPage).toContain('applyTemplateToCurrentSession(template, PERSONAL_WORK_CONTEXT_ID, "new-conversation")');
    expect(sessionPage).toContain("designTemplates={starterTemplateCatalog}");
    expect(sessionRoute).toContain("templateScope ?? readActiveWorkContextId()");
    expect(sessionRoute).toContain("Template unavailable");
    expect(sessionRoute).toContain("deleteSession(endpoint.workspaceId, createdSessionId)");
    expect(sessionRoute).toContain("templateApplication?.brief");
    expect(sessionRoute).toContain("application.resourceScope");
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
