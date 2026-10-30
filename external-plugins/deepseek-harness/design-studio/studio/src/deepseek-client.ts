import type {
  DesignStudioClient,
  DesignStudioStorageResult,
} from "../../../../../packages/design-studio/src/host";

declare global {
  interface Window {
    __IPOLLOWORK_DESIGN_STUDIO_TOKEN__?: string;
  }
}

const studioBoundary = window.location.pathname.indexOf("/studio/");
const API_ROOT = `${window.location.pathname.slice(0, studioBoundary)}/api`;

function token() {
  const value = window.__IPOLLOWORK_DESIGN_STUDIO_TOKEN__;
  if (!value || value === "__IPOLLOWORK_DESIGN_STUDIO_TOKEN_VALUE__") {
    throw new Error("Design Studio host token is unavailable.");
  }
  return value;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      "x-ipollowork-design-token": token(),
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => null);
    const message = detail && typeof detail === "object" ? Reflect.get(detail, "message") : null;
    throw new Error(typeof message === "string" ? message : `Design Studio request failed (${response.status}).`);
  }
  return response.json();
}

function query(values: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  return `?${params.toString()}`;
}

export const deepSeekDesignStudioClient: DesignStudioClient = {
  getTemplateSession: (workspaceId, sessionId) =>
    api(`/session${query({ workspaceId, sessionId })}`),
  listWorkspaceFiles: (workspaceId, prefix) =>
    api(`/files${query({ workspaceId, prefix })}`),
  readWorkspaceFile: (workspaceId, path) =>
    api(`/file${query({ workspaceId, path })}`),
  writeWorkspaceFile: (workspaceId, payload) =>
    api("/file", {
      method: "POST",
      body: JSON.stringify({ workspaceId, ...payload }),
    }),
  downloadWorkspaceFile: async (workspaceId, path) => {
    const response = await fetch(`${API_ROOT}/raw${query({ workspaceId, path })}`, {
      headers: { "x-ipollowork-design-token": token() },
    });
    if (!response.ok) {
      const detail: unknown = await response.json().catch(() => null);
      const message = detail && typeof detail === "object" ? Reflect.get(detail, "message") : null;
      throw new Error(typeof message === "string" ? message : `Could not read ${path}.`);
    }
    const disposition = response.headers.get("content-disposition");
    return {
      data: await response.arrayBuffer(),
      contentType: response.headers.get("content-type"),
      filename: /filename="([^"]+)"/.exec(disposition ?? "")?.[1] ?? null,
    };
  },
  callStorage: async (): Promise<DesignStudioStorageResult> => ({
    ok: false,
    error: "unsupported",
    message: "Publishing is owned by iPolloWork and is disabled in the DeepSeek Harness host.",
  }),
  listDesignStudioTemplates: (workspaceId) => api(`/templates${query({ workspaceId })}`),
  getDesignStudioTemplateCover: async (workspaceId, templateId) => {
    const response = await fetch(`${API_ROOT}/template-cover${query({ workspaceId, templateId })}`, {
      headers: { "x-ipollowork-design-token": token() },
    });
    if (!response.ok) throw new Error(`Could not load template cover (${response.status}).`);
    return { data: await response.arrayBuffer(), contentType: response.headers.get("content-type"), filename: null };
  },
  applyDesignStudioTemplate: (workspaceId, sessionId, templateId) => api("/template", {
    method: "POST",
    body: JSON.stringify({ workspaceId, sessionId, templateId }),
  }),
};
