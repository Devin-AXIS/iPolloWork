import { z } from "zod";

const connectStateResponseSchema = z.object({
  ok: z.literal(true),
  schemaVersion: z.number(),
  connectEnabled: z.boolean(),
  cloudMcpPresent: z.boolean(),
  googleWorkspace: z.object({
    legacyConfigured: z.boolean(),
  }).passthrough(),
}).passthrough();

export type iPolloWorkExtensionConnectState = {
  connectEnabled: boolean;
  cloudMcpPresent: boolean;
  googleWorkspace: {
    legacyConfigured: boolean;
  };
};

type iPolloWorkFetch = (url: string, init?: RequestInit) => Promise<Response>;
type Clock = () => number;
type CachediPolloWorkExtensionDiscoveryInstruction = {
  at: number;
  instruction: string;
};

export const IPOLLOWORK_EXTENSION_DISCOVERY_INSTRUCTION =
  "If the user asks for something you cannot do with obvious built-in tools, check iPolloWork extensions before saying the capability is unavailable. Use ipollowork_extension_list_actions to inspect available extension actions, then call the matching action with ipollowork_extension_call.";

export const IPOLLOWORK_CLOUD_CONNECTION_INSTRUCTION =
  "The iPolloWork Cloud connection is active. For email (Gmail), calendar, Google Drive, and org-connected services such as Notion, Linear, Slack, etc., FIRST call ipollowork-cloud_search_capabilities with 2-4 keyword variants, then call ipollowork-cloud_execute_capability with an exact returned name. Do not claim these are unavailable without searching. iPolloWork extensions (ipollowork_extension_list_actions / ipollowork_extension_call) remain available for other local actions such as image generation, but do NOT use them for Google Workspace, and never direct the user to Settings > Extensions for Google Workspace; use Settings > Connect. A successful search proves iPolloWork Cloud itself is authorized, so never tell the user to reconnect iPolloWork Cloud because a downstream connector failed. If a result has kind connection_status, name connectionStatus.connectionName and relay connectionStatus.action exactly: use Your Connections for the member, the organization Connections dashboard for an org admin, or the provider admin console for a provider-side failure. After the requested human fixes that connector, search again in the same task. Do not try browser_* or ipollowork_ui_* workarounds or repeat the same call unchanged; results are live, not cached, so unchanged retries return the same error.";

export const IPOLLOWORK_CONNECT_GOOGLE_WORKSPACE_DISCONNECTED_INSTRUCTION =
  `${IPOLLOWORK_EXTENSION_DISCOVERY_INSTRUCTION} Google Workspace is not connected on this device; if the user asks for email, calendar, or Google Drive, tell them to connect their account in Settings > Connect (never Settings > Extensions).`;

const CONNECT_STATE_CACHE_MS = 15_000;
let cachediPolloWorkExtensionDiscoveryInstruction: CachediPolloWorkExtensionDiscoveryInstruction | null = null;

function serverUrl(): string {
  return String(process.env.IPOLLOWORK_SERVER_URL || "").replace(/\/$/, "");
}

function serverToken(): string {
  return String(process.env.IPOLLOWORK_SERVER_TOKEN || "");
}

function requireiPolloWorkServer(): { url: string; token: string } {
  const url = serverUrl();
  const token = serverToken();
  if (!url || !token) {
    throw new Error("iPolloWork extension tools are only available when OpenCode is launched by iPolloWork.");
  }
  return { url, token };
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return { message: text };
  }
}

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    const message = Reflect.get(payload, "message");
    if (typeof message === "string" && message) return message;
    const code = Reflect.get(payload, "code");
    if (typeof code === "string" && code) return code;
  }
  return fallback;
}

async function fetchiPolloWorkConnectState(fetcher: iPolloWorkFetch): Promise<iPolloWorkExtensionConnectState> {
  const { url, token } = requireiPolloWorkServer();
  const response = await fetcher(`${url}/experimental/connect/state`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await parseResponse(response);
  if (!response.ok) throw new Error(errorMessage(payload, "iPolloWork connect state request failed"));
  const parsed = connectStateResponseSchema.parse(payload);
  return {
    connectEnabled: parsed.connectEnabled,
    cloudMcpPresent: parsed.cloudMcpPresent,
    googleWorkspace: {
      legacyConfigured: parsed.googleWorkspace.legacyConfigured,
    },
  };
}

export function composeiPolloWorkExtensionDiscoveryInstruction(state: iPolloWorkExtensionConnectState | null): string {
  if (!state || !state.connectEnabled || state.googleWorkspace.legacyConfigured) {
    return IPOLLOWORK_EXTENSION_DISCOVERY_INSTRUCTION;
  }
  return state.cloudMcpPresent
    ? IPOLLOWORK_CLOUD_CONNECTION_INSTRUCTION
    : IPOLLOWORK_CONNECT_GOOGLE_WORKSPACE_DISCONNECTED_INSTRUCTION;
}

export function resetiPolloWorkExtensionDiscoveryInstructionCacheForTests(): void {
  cachediPolloWorkExtensionDiscoveryInstruction = null;
}

export async function resolveiPolloWorkExtensionDiscoveryInstruction(
  fetcher: iPolloWorkFetch = fetch,
  now: Clock = Date.now,
): Promise<string> {
  const currentTime = now();
  if (
    cachediPolloWorkExtensionDiscoveryInstruction &&
    currentTime - cachediPolloWorkExtensionDiscoveryInstruction.at < CONNECT_STATE_CACHE_MS
  ) {
    return cachediPolloWorkExtensionDiscoveryInstruction.instruction;
  }

  let instruction = IPOLLOWORK_EXTENSION_DISCOVERY_INSTRUCTION;
  try {
    instruction = composeiPolloWorkExtensionDiscoveryInstruction(await fetchiPolloWorkConnectState(fetcher));
  } catch {
    instruction = IPOLLOWORK_EXTENSION_DISCOVERY_INSTRUCTION;
  }

  cachediPolloWorkExtensionDiscoveryInstruction = { at: currentTime, instruction };
  return instruction;
}
