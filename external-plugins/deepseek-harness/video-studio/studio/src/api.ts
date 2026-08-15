import type { TemplateCatalogItem } from "@ipollowork/types/templates";
import type { VideoStudioSelection } from "@ipollowork/video-studio";

declare global {
  interface Window {
    __IPOLLOWORK_VIDEO_STUDIO_TOKEN__?: string;
  }
}

export type VideoRuntimeSession = {
  projectId: string;
  projectDirectory: string;
  port: number;
  studioUrl: string;
  hyperframesVersion: string;
  reused: boolean;
  templateId: string | null;
};

const studioBoundary = window.location.pathname.indexOf("/studio/");
const API_ROOT = `${window.location.pathname.slice(0, studioBoundary)}/api`;

function token() {
  const value = window.__IPOLLOWORK_VIDEO_STUDIO_TOKEN__;
  if (!value || value === "__IPOLLOWORK_VIDEO_STUDIO_TOKEN_VALUE__") {
    throw new Error("iVideo host token is unavailable.");
  }
  return value;
}

function query(values: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  return `?${params.toString()}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      "x-ipollowork-video-token": token(),
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => null);
    const message = detail && typeof detail === "object" ? Reflect.get(detail, "message") : null;
    throw new Error(typeof message === "string" ? message : `iVideo request failed (${response.status}).`);
  }
  return response.json();
}

export const deepSeekVideoApi = {
  session: (workspaceId: string, sessionId: string, viewId: string) =>
    api<VideoRuntimeSession>(`/session${query({ workspaceId, sessionId, viewId })}`),
  selection: (workspaceId: string, sessionId: string, viewId: string) =>
    api<{ selection: VideoStudioSelection | null }>(`/selection${query({ workspaceId, sessionId, viewId })}`),
  templates: (workspaceId: string) =>
    api<TemplateCatalogItem[]>(`/templates${query({ workspaceId })}`),
  templateCover: async (workspaceId: string, templateId: string) => {
    const response = await fetch(`${API_ROOT}/template-cover${query({ workspaceId, templateId })}`, {
      headers: { "x-ipollowork-video-token": token() },
    });
    if (!response.ok) throw new Error(`Could not load the iVideo template cover (${response.status}).`);
    return { data: await response.arrayBuffer(), contentType: response.headers.get("content-type") };
  },
  applyTemplate: (workspaceId: string, sessionId: string, viewId: string, templateId: string) =>
    api<VideoRuntimeSession>("/template", {
      method: "POST",
      body: JSON.stringify({ workspaceId, sessionId, viewId, templateId }),
    }),
  release: (workspaceId: string, sessionId: string, viewId: string) =>
    api<{ ok: true }>("/release", {
      method: "POST",
      keepalive: true,
      body: JSON.stringify({ workspaceId, sessionId, viewId }),
    }),
};
