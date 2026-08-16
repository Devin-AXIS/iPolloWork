import * as React from "react";

import type { Client } from "@/app/types";

type WorkspaceContextValue = {
  client: Client | null;
  engineId?: string | null;
  opencodeBaseUrl: string;
  selectedWorkspaceRoot: string;
};

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

type WorkspaceProviderProps = {
  client: Client | null;
  engineId?: string | null;
  opencodeBaseUrl?: string;
  selectedWorkspaceRoot: string;
  children: React.ReactNode;
};

export function WorkspaceProvider({
  client,
  engineId,
  opencodeBaseUrl = "",
  selectedWorkspaceRoot,
  children,
}: WorkspaceProviderProps) {
  const value = React.useMemo(
    () => ({ client, engineId, opencodeBaseUrl, selectedWorkspaceRoot }),
    [client, engineId, opencodeBaseUrl, selectedWorkspaceRoot],
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
