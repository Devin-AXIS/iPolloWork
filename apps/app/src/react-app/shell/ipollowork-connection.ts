import {
  isLoopbackiPolloWorkServerUrl,
  normalizeiPolloWorkServerUrl,
  readiPolloWorkServerSettings,
} from "../../app/lib/ipollowork-server";
import { ipolloworkServerInfo, type iPolloWorkServerInfo } from "../../app/lib/desktop";
import { isDesktopRuntime } from "../../app/utils";

export type iPolloWorkConnectionSource = "desktop-runtime" | "stored-settings" | "empty";

export type ResolvediPolloWorkConnection = {
  normalizedBaseUrl: string;
  resolvedToken: string;
  resolvedHostToken: string;
  hostInfo: iPolloWorkServerInfo | null;
  source: iPolloWorkConnectionSource;
};

function hasUsableConnection(url: string, token: string) {
  return url.trim().length > 0 && token.trim().length > 0;
}

/**
 * Resolve the iPolloWork server connection for routes that consume the server API.
 *
 * Local desktop-hosted servers expose ephemeral loopback ports and freshly
 * minted tokens on every boot, so live runtime info is the source of truth
 * there. Stored settings remain the fallback for remote/manual server
 * connections and for desktop cases where the runtime bridge is unavailable.
 */
export async function resolveiPolloWorkConnection(): Promise<ResolvediPolloWorkConnection> {
  let staleDesktopRuntimeBaseUrl = "";

  if (isDesktopRuntime()) {
    try {
      const info = await ipolloworkServerInfo() as iPolloWorkServerInfo;
      const normalizedBaseUrl =
        normalizeiPolloWorkServerUrl(info.baseUrl ?? info.connectUrl ?? info.lanUrl ?? info.mdnsUrl ?? "") ??
        "";
      const resolvedToken = info.ownerToken?.trim() || info.clientToken?.trim() || "";
      if (info.running === true && hasUsableConnection(normalizedBaseUrl, resolvedToken)) {
        return {
          normalizedBaseUrl,
          resolvedToken,
          resolvedHostToken: info.hostToken?.trim() || "",
          hostInfo: info,
          source: "desktop-runtime",
        };
      }
      staleDesktopRuntimeBaseUrl = normalizedBaseUrl;
    } catch {
      // Fall through to stored settings for remote/manual connections.
    }
  }

  const settings = readiPolloWorkServerSettings();
  const normalizedBaseUrl = normalizeiPolloWorkServerUrl(settings.urlOverride ?? "") ?? "";
  const resolvedToken = settings.token?.trim() ?? "";
  const resolvedHostToken =
    normalizedBaseUrl && isLoopbackiPolloWorkServerUrl(normalizedBaseUrl)
      ? settings.hostToken?.trim() ?? ""
      : "";
  const storedConnectionIsStaleDesktopRuntime = Boolean(
    isDesktopRuntime() &&
      staleDesktopRuntimeBaseUrl &&
      normalizedBaseUrl === staleDesktopRuntimeBaseUrl,
  );
  const source =
    !storedConnectionIsStaleDesktopRuntime && hasUsableConnection(normalizedBaseUrl, resolvedToken)
      ? "stored-settings"
      : "empty";

  return {
    normalizedBaseUrl: source === "empty" ? "" : normalizedBaseUrl,
    resolvedToken: source === "empty" ? "" : resolvedToken,
    resolvedHostToken: source === "empty" ? "" : resolvedHostToken,
    hostInfo: null,
    source,
  };
}
