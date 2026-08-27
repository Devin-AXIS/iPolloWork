import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const routeStateSource = readFileSync(
  new URL("../src/react-app/shell/use-workspace-route-state.ts", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const sessionRouteSource = readFileSync(
  new URL("../src/react-app/shell/session-route.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const runtimeSource = readFileSync(
  new URL("../src/react-app/domains/session/sync/runtime-sync.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const sessionPageSource = readFileSync(
  new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const sessionSurfaceSource = readFileSync(
  new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const loadingOverlaySource = readFileSync(
  new URL("../src/react-app/shell/loading-overlay.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const firstRunLoaderSource = readFileSync(
  new URL("../src/react-app/domains/onboarding/first-run-loader.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const desktopConfigSource = readFileSync(
  new URL("../src/react-app/domains/cloud/desktop-config-provider.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");

describe("startup session loading", () => {
  test("opens a sessionless fresh composer instead of restoring or eagerly creating a session", () => {
    expect(routeStateSource).not.toContain("readLastSessionFor");
    expect(routeStateSource).toContain(
      "navigateToWorkspaceSession(selectedWorkspaceId, null, { replace: true });",
    );
    expect(sessionRouteSource).not.toContain("startupConversationPhase");
    expect(sessionRouteSource).toContain("const handleCreateTaskFromDraft = useCallback(");
    expect(sessionRouteSource).toMatch(
      /setPendingInitialProjectTask\(\{\s*workspaceId,\s*sessionId: null,\s*runtimeWorkspaceId: null,\s*clientUserMessageId: null,\s*draft,\s*\}\);/,
    );
    expect(sessionRouteSource).toContain(
      "pendingProjectSelectionRef",
    );
    expect(sessionRouteSource).not.toContain("const targetSessionId = remembered");
  });

  test("enters the first conversation with the free model and labels initial resource installation", () => {
    expect(sessionRouteSource).not.toContain("ProviderSelectionStep");
    expect(sessionRouteSource).not.toContain("providerStepCompleted");
    expect(sessionRouteSource).not.toContain("pendingProviderDraftRef");
    expect(firstRunLoaderSource).toContain('t("onboarding.installing_resources")');
    expect(firstRunLoaderSource).not.toContain("Preparing workspace");
  });

  test("reveals the create-project empty state after workspace discovery settles", () => {
    expect(sessionRouteSource).toContain("if (!loading && workspaces.length === 0)");
    expect(sessionRouteSource).toMatch(
      /if \(!loading && workspaces\.length === 0\) \{\s+dismissFirstRunLoader\(\);\s+return;/,
    );
  });

  test("subscribes to resources for only the selected session", () => {
    expect(runtimeSource).toContain(
      "trackWorkspaceSessionsSync(input, props.sessionId ? [props.sessionId] : [])",
    );
    expect(runtimeSource).not.toContain("activeSessionIds");
    expect(sessionRouteSource).not.toContain("activeSessionIds=");
    expect(routeStateSource).toContain("void selectedSessionsLoad.then(async () => {");
    expect(routeStateSource).toContain("for (const workspace of initialLoads.deferred)");
    expect(routeStateSource).toContain("await loadWorkspaceSessionsInBackground([workspace])");
    expect(routeStateSource).toContain("() => readSessionDirectoryCache()");
    expect(routeStateSource).toContain("writeSessionDirectoryCache(Object.fromEntries(");
    expect(routeStateSource).toContain("const cachedSessions = readSessionDirectoryCache()");
  });

  test("keeps the sidebar data mounted when only the selected project or task route changes", () => {
    expect(routeStateSource).toContain("const routeSelectionRef = useRef({ workspaceId: routeWorkspaceId, sessionId: selectedSessionId })");
    expect(routeStateSource).toContain("const requestedRouteSelection = routeSelectionRef.current");
    expect(routeStateSource).toContain("}, [loadWorkspaceSessionsInBackground, markBootRouteReady, workContextId]);");
    expect(routeStateSource).not.toContain("markBootRouteReady, routeWorkspaceId, selectedSessionId, workContextId");
  });

  test("destroys the old view and reuses the startup loading artwork while switching", () => {
    expect(sessionRouteSource).toContain(
      "destroyWorkspaceSessionResources(previous, previous.sessionId, {",
    );
    expect(sessionRouteSource).toContain("preserveInterruptedRun: true,");
    expect(sessionPageSource).toContain(
      'key={`${props.runtimeWorkspaceId}:${props.selectedSessionId}`}',
    );
    expect(sessionPageSource).toContain("<IPolloLoadingArtwork />");
    expect(sessionPageSource).toContain(
      "const templateEntrySurfaceReady = !templateSessionLoading",
    );
    expect(sessionPageSource).toContain("!templateEntrySurfaceReady,");
    expect(sessionPageSource).toContain(
      'className="absolute inset-0 z-40 flex items-center justify-center bg-dls-surface"',
    );
    expect(sessionPageSource).not.toContain(
      'className="fixed inset-0 z-[900] flex items-center justify-center bg-dls-surface"',
    );
    expect(sessionSurfaceSource).toContain("props.onLoadSettled?.(props.sessionId);");
    expect(loadingOverlaySource).toContain("export function IPollo" + "LoadingArtwork()");
  });

  test("does not render the new-task starter behind the startup skeleton", () => {
    expect(sessionPageSource).toContain(
      "mainWorkspaceView === null && !engineInstallGateActive && !engineStartupGateActive && showNewTaskStarter && !showStartupSkeleton && props.surface",
    );
  });

  test("invalidates pre-sleep requests and refreshes local and cloud state after desktop resume", () => {
    expect(routeStateSource).toContain("const refreshEpochRef = useRef(0)");
    expect(routeStateSource).toContain("const sessionLoadEpoch = refreshEpochRef.current");
    expect(routeStateSource).toContain("window.addEventListener(desktopResumeEvent, handleDesktopResume)");
    expect(routeStateSource).toContain('window.addEventListener("online", handleDesktopResume)');
    expect(routeStateSource).toContain("backgroundSessionLoadInFlight.current.clear()");
    expect(routeStateSource).toContain("if (!isCurrentRefresh()) return");
    expect(routeStateSource).toContain("if (!isCurrentSessionLoad()) return");
    expect(desktopConfigSource).toContain("window.addEventListener(desktopResumeEvent, handleDesktopResume)");
    expect(desktopConfigSource).toContain("void desktopConfigHandler()");
  });

  test("discovers sessions created in the selected project outside the current UI", () => {
    expect(routeStateSource).toContain("const SELECTED_WORKSPACE_SESSION_SYNC_INTERVAL_MS = 15_000;");
    expect(routeStateSource).toContain("await loadWorkspaceSessionsInBackground([selectedWorkspace]);");
    expect(routeStateSource).toContain('document.visibilityState === "hidden"');
    expect(routeStateSource).toContain("syncInFlight = true;");
    expect(routeStateSource).toContain("window.clearInterval(interval);");
  });

  test("trusts workspace-scoped session results instead of filtering by path aliases", () => {
    expect(routeStateSource).toContain("const items = fetchedItems;");
    expect(routeStateSource).toContain("const sessions = cachedSessions;");
    expect(routeStateSource).not.toContain("normalizeDirectoryPath(session?.directory ?? \"\") === workspaceRoot");
  });
});
