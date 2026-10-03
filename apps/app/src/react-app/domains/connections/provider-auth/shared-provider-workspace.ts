import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

type ProviderWorkspace = {
  id: string;
  engineId?: string | null;
  workspaceType?: string | null;
};

/**
 * Provider configuration belongs to the app, not to the currently selected
 * agent engine. Prefer an OpenCode workspace as the control-plane mount. When
 * none exists, any mounted workspace still exposes the managed OpenCode
 * sidecar at `/opencode`; callers must use that endpoint with the OpenCode
 * model-runtime adapter rather than replacing the catalog with the project
 * engine's narrower provider directory.
 */
export function selectSharedProviderWorkspace<T extends ProviderWorkspace>(
  workspaces: readonly T[],
  selectedWorkspace: T | null | undefined,
): T | null {
  const openCodeWorkspaces = workspaces.filter(
    (workspace) => (workspace.engineId?.trim() || DEFAULT_ENGINE_ID) === DEFAULT_ENGINE_ID,
  );
  return openCodeWorkspaces.find((workspace) => workspace.workspaceType !== "remote")
    ?? openCodeWorkspaces[0]
    ?? selectedWorkspace
    ?? null;
}
