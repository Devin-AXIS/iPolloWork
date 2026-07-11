import type { iPolloWorkStore } from "./store";

export const selectActiveWorkspace = (state: iPolloWorkStore) =>
  state.workspaces.find(
    (workspace) => workspace.id === state.activeWorkspaceId,
  ) ?? null;

export const selectServerStatus = (state: iPolloWorkStore) => state.server.status;

export const selectServerUrl = (state: iPolloWorkStore) => state.server.url;

export const selectErrorBanner = (state: iPolloWorkStore) => state.errorBanner;
