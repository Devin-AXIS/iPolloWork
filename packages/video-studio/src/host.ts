import type { TemplateCatalogItem } from "@ipollowork/types/templates";

export type VideoStudioTemplateApplyResult = {
  port: number;
};

/** Stable host surface consumed by the shared iPolloWork Video Studio UI. */
export interface VideoStudioClient {
  readWorkspaceFile(workspaceId: string, path: string): Promise<{ content: string; updatedAt: number }>;
  writeWorkspaceFile(
    workspaceId: string,
    payload: { path: string; content: string; baseUpdatedAt?: number | null; force?: boolean },
  ): Promise<unknown>;
  listVideoStudioTemplates?(workspaceId: string): Promise<TemplateCatalogItem[]>;
  getVideoStudioTemplateCover?(
    workspaceId: string,
    templateId: string,
  ): Promise<{ data: ArrayBuffer; contentType: string | null }>;
  applyVideoStudioTemplate?(
    workspaceId: string,
    sessionId: string,
    templateId: string,
  ): Promise<VideoStudioTemplateApplyResult>;
}

/** The process lifecycle stays host-owned; the editor UI is shared. */
export interface VideoStudioRuntime {
  start(input: {
    workspaceRoot: string;
    sessionId: string;
    projectDirectory: string;
    port: number;
  }): Promise<{ ok: boolean; port?: number; reused?: boolean }>;
  stop(sessionId: string, options?: { keepWarm?: boolean }): Promise<{ ok: boolean }>;
}

export type VideoStudioFeatures = {
  voice: boolean;
  designSystem: boolean;
  templates: false | { title: string; description: string };
};

export const IPOLLOWORK_VIDEO_STUDIO_FEATURES: VideoStudioFeatures = {
  voice: true,
  designSystem: true,
  templates: false,
};

export type VideoStudioBranding = {
  title: string;
  byline: string;
  bylineUrl: string;
  repositoryUrl: string;
  onAskAi: () => void;
};
