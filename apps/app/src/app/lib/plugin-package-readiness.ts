import type {
  iPolloWorkPluginAuthorizationState,
  iPolloWorkPluginPackageItem,
} from "./ipollowork-server";
import type { McpStatusMap } from "../types";

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
  const authorization = pluginPackageAuthorization(item, state, mcpStatuses);
  return !authorization.required || authorization.connected;
}
