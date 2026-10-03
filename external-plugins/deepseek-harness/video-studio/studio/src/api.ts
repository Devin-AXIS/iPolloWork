import type {
  VideoStudioClient,
  VideoStudioRuntime,
  VideoStudioTemplateApplyResult,
} from "@ipollowork/video-studio";

declare global {
  interface Window {
    __IPOLLOWORK_VIDEO_STUDIO_TOKEN__?: string;
  }
}

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

export function createDeepSeekVideoStudioHost(scope: {
  workspaceId: string;
  sessionId: string;
  viewId: string;
}): { client: VideoStudioClient; runtime: VideoStudioRuntime } {
  const session = () => api<VideoStudioTemplateApplyResult & { reused: boolean }>(`/session${query(scope)}`);
  const client: VideoStudioClient = {
    readWorkspaceFile: (_workspaceId, path) => api(`/file${query({ workspaceId: scope.workspaceId, sessionId: scope.sessionId, path })}`),
    writeWorkspaceFile: (_workspaceId, payload) => api("/file", {
      method: "POST",
      body: JSON.stringify({ workspaceId: scope.workspaceId, sessionId: scope.sessionId, ...payload }),
    }),
    listVideoStudioTemplates: () => api(`/templates${query({ workspaceId: scope.workspaceId })}`),
    getVideoStudioTemplateCover: async (_workspaceId, templateId) => {
      const response = await fetch(`${API_ROOT}/template-cover${query({ workspaceId: scope.workspaceId, templateId })}`, {
        headers: { "x-ipollowork-video-token": token() },
      });
      if (!response.ok) throw new Error(`Could not load the iVideo template cover (${response.status}).`);
      return { data: await response.arrayBuffer(), contentType: response.headers.get("content-type") };
    },
    applyVideoStudioTemplate: (_workspaceId, _sessionId, templateId) => api("/template", {
      method: "POST",
      body: JSON.stringify({ ...scope, templateId }),
    }),
  };
  const runtime: VideoStudioRuntime = {
    start: async () => {
      const active = await session();
      return { ok: true, port: active.port, reused: active.reused };
    },
    stop: async () => {
      await api("/release", {
        method: "POST",
        keepalive: true,
        body: JSON.stringify(scope),
      });
      return { ok: true };
    },
  };
  return { client, runtime };
}
