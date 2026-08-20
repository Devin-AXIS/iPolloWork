import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";

type UiControlBridge = { baseUrl: string; token: string };

let cachedBridge: UiControlBridge | null = null;
let cachedBridgeAt = 0;

const BRIDGE_CACHE_MS = 2_000;
const BRIDGE_TIMEOUT_MS = 5_000;

function userAppDataDir(): string {
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support");
  if (platform() === "win32") return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

function discoveryPaths(): string[] {
  return [
    process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY?.trim(),
    join(userAppDataDir(), "com.differentai.ipollowork", "ipollowork-ui-control.json"),
    join(userAppDataDir(), "com.differentai.ipollowork.dev", "ipollowork-ui-control.json"),
  ].filter((path): path is string => Boolean(path));
}

async function discoverBridge(): Promise<UiControlBridge | null> {
  if (cachedBridge && Date.now() - cachedBridgeAt < BRIDGE_CACHE_MS) return cachedBridge;
  for (const candidate of discoveryPaths()) {
    try {
      const parsed: unknown = JSON.parse(await readFile(candidate, "utf8"));
      if (
        typeof parsed === "object"
        && parsed !== null
        && "baseUrl" in parsed
        && typeof parsed.baseUrl === "string"
        && "token" in parsed
        && typeof parsed.token === "string"
      ) {
        cachedBridge = { baseUrl: parsed.baseUrl, token: parsed.token };
        cachedBridgeAt = Date.now();
        return cachedBridge;
      }
    } catch {
      // A packaged and a development discovery file may coexist; try each.
    }
  }
  return null;
}

export async function uiControlRequest(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const bridge = await discoverBridge();
  if (!bridge) {
    return { ok: false, error: "iPolloWork UI bridge not available. The desktop app may not be running." };
  }
  try {
    const response = await fetch(`${bridge.baseUrl}${path}`, {
      method: options.method || "GET",
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${bridge.token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: text || `HTTP ${response.status}` };
    }
  } catch (error) {
    cachedBridge = null;
    cachedBridgeAt = 0;
    return {
      ok: false,
      error: `UI bridge unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
