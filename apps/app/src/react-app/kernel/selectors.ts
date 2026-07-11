import type { iPolloWalkStore } from "./store";

export const selectActiveWorkspace = (state: iPolloWalkStore) =>
  state.workspaces.find(
    (workspace) => workspace.id === state.activeWorkspaceId,
  ) ?? null;

export const selectServerStatus = (state: iPolloWalkStore) => state.server.status;

export const selectServerUrl = (state: iPolloWalkStore) => state.server.url;

export const selectErrorBanner = (state: iPolloWalkStore) => state.errorBanner;
