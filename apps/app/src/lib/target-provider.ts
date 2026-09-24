import * as React from "react";

import type { OpenTarget } from "@/react-app/domains/session/artifacts/open-target";

export type OpenTargetOptions = {
  auto?: boolean;
  external?: boolean;
  reveal?: boolean;
  viewer?: "design" | "image-studio" | "preview" | "video";
};

type OpenTargetHandler = (target: OpenTarget, options?: OpenTargetOptions) => void;
export type WorkspaceThumbnailLoader = (path: string) => Promise<{ blob: Blob; detail: string }>;
export type WorkspaceImageLoader = (path: string) => Promise<Blob>;

type OpenTargetContextValue = {
  openTargets: OpenTarget[];
  onOpenTarget: OpenTargetHandler | undefined;
  loadWorkspaceImage?: WorkspaceImageLoader;
  loadWorkspaceThumbnail?: WorkspaceThumbnailLoader;
};

type OpenTargetProviderProps = {
  children: React.ReactNode;
  openTargets?: OpenTarget[] | undefined;
  onOpenTarget?: OpenTargetHandler | undefined;
  loadWorkspaceImage?: WorkspaceImageLoader;
  loadWorkspaceThumbnail?: WorkspaceThumbnailLoader;
};

const EMPTY_OPEN_TARGETS: OpenTarget[] = [];

const OpenTargetContext = React.createContext<OpenTargetContextValue>({
  openTargets: EMPTY_OPEN_TARGETS,
  onOpenTarget: undefined,
});

export function OpenTargetProvider({
  children,
  openTargets = EMPTY_OPEN_TARGETS,
  onOpenTarget,
  loadWorkspaceImage,
  loadWorkspaceThumbnail,
}: OpenTargetProviderProps) {
  const value = React.useMemo(
    () => ({
      openTargets,
      onOpenTarget,
      loadWorkspaceImage,
      loadWorkspaceThumbnail,
    }),
    [openTargets, onOpenTarget, loadWorkspaceImage, loadWorkspaceThumbnail],
  );

  return React.createElement(OpenTargetContext.Provider, { value }, children);
}

export function useOpenTargets() {
  return React.useContext(OpenTargetContext);
}
