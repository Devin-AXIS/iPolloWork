import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

type ProviderWorkspace = {
  id: string;
  engineId?: string | null;
  workspaceType?: string | null;
};

/**
 * Provider configuration belongs to the app, not to the currently selected
 * agent engine. OpenCode remains the provider control plane because it exposes
 * the complete provider/auth catalog; DSH consumes the same selected model and
 * mirrors supported credentials at its runtime boundary.
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
