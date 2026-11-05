import type {
  iPolloWorkPluginAuthorizationState,
  iPolloWorkPluginPackageItem,
} from "./ipollowork-server";
import type { McpStatusMap } from "../types";
import type { PluginEngineCompatibility } from "@ipollowork/types/plugins";

export function activePluginEngineCompatibility(item: {
  activeEngineId?: string;
  engineCompatibility?: readonly PluginEngineCompatibility[];
}): PluginEngineCompatibility | undefined {
  if (!item.activeEngineId) return undefined;
  return item.engineCompatibility?.find((entry) => entry.engineId === item.activeEngineId);
}

export function pluginPackageAuthorization(
  item: iPolloWorkPluginPackageItem,
  state: iPolloWorkPluginAuthorizationState | undefined,
  mcpStatuses: McpStatusMap,
) {
  const pluginAuthorizationRequired = (item.manifest.authorization?.methods?.length ?? 0) > 0;
  const hasGuidedSetup = Boolean(item.manifest.setup?.instructions?.trim());
  const connectionMcpResources = item.manifest.resources.filter((resource) =>
    resource.type === "mcp"
      && Boolean(resource.mcpServerName)
      && (resource.oauth === true || hasGuidedSetup)
  );
  const required = pluginAuthorizationRequired || connectionMcpResources.length > 0;
  const pluginReady = !pluginAuthorizationRequired || state?.ready === true;
  const mcpReady = connectionMcpResources.every((resource) =>
    resource.mcpServerName ? mcpStatuses[resource.mcpServerName]?.status === "connected" : false
  );

  return { required, connected: required && pluginReady && mcpReady, connectionMcpResources };
}

export function isPluginPackageReady(
  item: iPolloWorkPluginPackageItem,
  state: iPolloWorkPluginAuthorizationState | undefined,
  mcpStatuses: McpStatusMap,
) {
  if (!item.enabled) return false;
  if (activePluginEngineCompatibility(item)?.status === "unsupported") return false;
  const authorization = pluginPackageAuthorization(item, state, mcpStatuses);
  return !authorization.required || authorization.connected;
}

export function isDelegatableExternalAgent(item: Pick<
  iPolloWorkPluginPackageItem,
  "activeEngineId" | "disabledResourceIds" | "enabled" | "engineCompatibility" | "manifest" | "pluginId"
>) {
  return item.enabled
    && item.pluginId !== item.activeEngineId
    && activePluginEngineCompatibility(item)?.status !== "unsupported"
    && Boolean(item.manifest.composer?.prompt.trim())
    && item.manifest.resources.some((resource) =>
      resource.provides?.includes("service:external-subagent") === true
      && !item.disabledResourceIds.includes(resource.id)
    );
}
