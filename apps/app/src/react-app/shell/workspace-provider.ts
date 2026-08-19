import * as React from "react";

import type { ProviderListQueryInput } from "@/react-app/infra/provider-list-query";

type WorkspaceContextValue = {
  client: unknown | null;
  engineId?: string | null;
  opencodeBaseUrl: string;
  selectedWorkspaceRoot: string;
  modelCatalogSources: readonly ProviderListQueryInput[];
};

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

type WorkspaceProviderProps = {
  client: unknown | null;
  engineId?: string | null;
  opencodeBaseUrl?: string;
  selectedWorkspaceRoot: string;
  modelCatalogSources?: readonly ProviderListQueryInput[];
  children: React.ReactNode;
};

export function WorkspaceProvider({
  client,
  engineId,
  opencodeBaseUrl = "",
  selectedWorkspaceRoot,
  modelCatalogSources = [],
  children,
}: WorkspaceProviderProps) {
  const value = React.useMemo(
    () => ({ client, engineId, opencodeBaseUrl, selectedWorkspaceRoot, modelCatalogSources }),
    [client, engineId, modelCatalogSources, opencodeBaseUrl, selectedWorkspaceRoot],
  );

  return React.createElement(WorkspaceContext.Provider, { value }, children);
}

export function useWorkspace() {
  const context = React.use(WorkspaceContext);

  if (!context) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }

  return context;
}
