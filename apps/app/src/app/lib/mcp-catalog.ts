import { publicMcpCatalogSchema, type PublicMcp } from "@ipollowork/types/enterprise";
import { readDenSettings } from "./den";
import { desktopFetchViaMain } from "./desktop";
import { isDesktopRuntime } from "./runtime-env";

export async function listPublicMcp(signal: AbortSignal): Promise<PublicMcp[]> {
  const url = new URL("/api/v1/mcp/catalog", readDenSettings().baseUrl);
  const init: RequestInit = {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  };
  const response = isDesktopRuntime() ? await desktopFetchViaMain(url, init, 15000) : await fetch(url, init);
  if (!response.ok) throw new Error(`MCP catalog returned HTTP ${response.status}`);
  return publicMcpCatalogSchema.parse(await response.json()).items;
}
