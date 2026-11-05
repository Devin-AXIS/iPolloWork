import { getMcpServerName, isBuiltIniPolloWorkExtension, type McpDirectoryInfo } from "../../../app/constants";
import { evaluateEnablement, type EnablementContext } from "../../../app/enablement";
import type { EnablementResult } from "../../../app/extensions";
import type { DenExternalMcpConnection } from "../../../app/lib/den";
import type { McpServerEntry } from "../../../app/types";
import { t, type Language } from "../../../i18n";

export type ExtensionItemSource = "builtin" | "org-connection" | "mcp-connection" | "skill";
export type ExtensionInstallState = "available" | "installed" | "update_available";
export type ExtensionSetupState = "ready" | "needs_setup" | "partial";

export type ExtensionResourceItem = {
  id: string;
  type: string;
  title: string;
  path?: string;
};

export type ExtensionItem = {
  id: string;
  source: ExtensionItemSource;
  name: string;
  description: string | null;
  installState: ExtensionInstallState;
  setupState: ExtensionSetupState;
  active: boolean;
  enablement: { active: boolean; results: EnablementResult[] } | null;
  resources: ExtensionResourceItem[];
  builtInEntry?: McpDirectoryInfo;
  orgMcpConnection?: DenExternalMcpConnection;
  mcpEntry?: McpDirectoryInfo;
  skill?: { name: string; description?: string; path: string };
};

export type ExtensionItemBuildInput = {
  quickConnect: McpDirectoryInfo[];
  mcpServers: McpServerEntry[];
  installedSkills: Array<{ name: string; description?: string; path: string }>;
  pluginPackageSkillNames?: string[];
  pluginPackageMcpServerNames?: string[];
  orgMcpConnections?: DenExternalMcpConnection[];
  enablementContext: EnablementContext;
  isBuiltInConnected: (entry: McpDirectoryInfo) => boolean;
};

const HAN_TEXT_RE = /\p{Script=Han}/u;

export function skillDescriptionForLocale(description: string | undefined, locale: Language): string {
  const value = description?.trim();
  if (!value) return t("settings.extensions.skill_installed_description", locale);
  if (locale === "en" && HAN_TEXT_RE.test(value)) {
    return t("settings.extensions.skill_description_unavailable_english", locale);
  }
  return value;
}

export function isToggleControlledExtension(entry: McpDirectoryInfo) {
  return entry.extensionManifest?.enablement?.some((condition) => condition.type === "toggle-enabled") === true;
}

function setupStateFromEnablement(enablement: { active: boolean; results: EnablementResult[] } | null): ExtensionSetupState {
  if (!enablement || enablement.results.length === 0) return "needs_setup";
  if (enablement.active) return "ready";
  return enablement.results.some((result) => result.met) ? "partial" : "needs_setup";
}

export function isOrgMcpConnectionReady(connection: Pick<DenExternalMcpConnection, "credentialMode" | "connected" | "connectedForMe" | "needsReconnect">) {
  return connection.credentialMode === "shared" ? connection.connected : connection.connectedForMe && connection.needsReconnect !== true;
}

export function orgMcpConnectionDescription(connection: Pick<DenExternalMcpConnection, "credentialMode" | "connectedForMe" | "needsReconnect">) {
  if (connection.credentialMode === "shared") return "One org account managed by your organization — the AI acts as it.";
  if (connection.connectedForMe && connection.needsReconnect === true) return "Reconnect your account to grant newly requested permissions.";
  if (connection.connectedForMe) return "Connected with your own account.";
  return "Available from your organization. Connect your own account to use it.";
}

export function orgMcpConnectionActionLabel(connection: Pick<DenExternalMcpConnection, "credentialMode" | "connected" | "connectedForMe" | "needsReconnect">) {
  if (connection.credentialMode === "shared") return "Managed by your organization";
  if (connection.connectedForMe && connection.needsReconnect === true) return "Reconnect";
  if (connection.connectedForMe) return "Connected";
  return "Connect your account";
}

export function isOrgMcpConnectionItem(item: ExtensionItem): item is ExtensionItem & { orgMcpConnection: DenExternalMcpConnection } {
  return item.source === "org-connection" && Boolean(item.orgMcpConnection);
}

function normalizeProviderKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function normalizeProviderUrl(value: string | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return value.trim().replace(/\/+$/, "").toLowerCase();
  }
}

function orgConnectionMatchesQuickEntry(connection: DenExternalMcpConnection, entry: McpDirectoryInfo) {
  const entryUrl = normalizeProviderUrl(entry.url);
  const connectionUrl = normalizeProviderUrl(connection.url);
  if (entryUrl && connectionUrl && entryUrl === connectionUrl) return true;

  const entryKeys = [entry.serverName ?? "", entry.name].map(normalizeProviderKey).filter(Boolean);
  const connectionKey = normalizeProviderKey(connection.name);
  return entryKeys.some((key) => key && key === connectionKey);
}

function orgConnectionCanRender(connection: DenExternalMcpConnection) {
  return connection.credentialMode === "per_member" || connection.connected;
}

export function buildExtensionItems(input: ExtensionItemBuildInput) {
  const builtInItems = input.quickConnect.filter(isBuiltIniPolloWorkExtension).map((entry): ExtensionItem => {
    const enablement = entry.extensionManifest?.enablement
      ? evaluateEnablement(entry.extensionManifest.enablement, input.enablementContext)
      : null;
    const active = enablement?.active ?? input.isBuiltInConnected(entry);
    return {
      id: `builtin:${entry.id ?? entry.serverName ?? entry.name}`,
      source: "builtin",
      name: entry.name,
      description: entry.description,
      installState: active ? "installed" : "available",
      setupState: enablement ? setupStateFromEnablement(enablement) : active ? "ready" : "needs_setup",
      active,
      enablement,
      resources: entry.extensionManifest?.resources.map((resource) => ({
        id: resource.id,
        type: resource.type,
        title: resource.label ?? resource.id,
        path: resource.path,
      })) ?? [],
      builtInEntry: entry,
    };
  });

  const orgMcpConnectionItems = (input.orgMcpConnections ?? []).flatMap((connection): ExtensionItem[] => {
    if (!orgConnectionCanRender(connection)) return [];
    const ready = isOrgMcpConnectionReady(connection);
    return [{
      id: `org-mcp:${connection.id}`,
      source: "org-connection",
      name: connection.name,
      description: orgMcpConnectionDescription(connection),
      installState: ready ? "installed" : "available",
      setupState: ready ? "ready" : "needs_setup",
      active: ready,
      enablement: null,
      resources: [{ id: connection.id, type: "mcp", title: connection.name }],
      orgMcpConnection: connection,
    }];
  });

  const renderableOrgConnections = orgMcpConnectionItems.flatMap((item) => item.orgMcpConnection ? [item.orgMcpConnection] : []);
  const hasRenderableOrgEquivalent = (entry: McpDirectoryInfo) => {
    if (entry.type !== "remote") return false;
    if (input.mcpServers.some((server) => server.name === getMcpServerName(entry))) return false;
    return renderableOrgConnections.some((connection) => orgConnectionMatchesQuickEntry(connection, entry));
  };

  const groupedSkillNames = new Set<string>();
  input.pluginPackageSkillNames?.forEach((value) => groupedSkillNames.add(value));
  const pluginPackageMcpServerNames = new Set(input.pluginPackageMcpServerNames ?? []);

  const standaloneMcpEntries = input.quickConnect.filter((entry) => {
    if (isBuiltIniPolloWorkExtension(entry)) return false;
    const serverName = getMcpServerName(entry);
    if (pluginPackageMcpServerNames.has(serverName)) return false;
    return input.mcpServers.some((server) => server.name === serverName);
  });

  const standaloneSkillItems = input.installedSkills.filter((skill) => {
    if (groupedSkillNames.has(skill.name)) return false;
    return true;
  }).map((skill): ExtensionItem => ({
    id: `skill:${skill.name}`,
    source: "skill",
    name: skill.name,
    description: skill.description ?? null,
    installState: "installed",
    setupState: "ready",
    active: true,
    enablement: null,
    resources: [{ id: skill.name, type: "skill", title: skill.name, path: skill.path }],
    skill,
  }));

  return {
    // Org-managed MCP connections are beta, so keep them last in unified lists.
    items: [...builtInItems, ...standaloneMcpEntries.map((entry): ExtensionItem => ({
      id: `mcp:${getMcpServerName(entry)}`,
      source: "mcp-connection",
      name: entry.name,
      description: entry.description,
      installState: "installed",
      setupState: "ready",
      active: true,
      enablement: null,
      resources: [{ id: getMcpServerName(entry), type: "mcp", title: entry.name }],
      mcpEntry: entry,
    })), ...standaloneSkillItems, ...orgMcpConnectionItems],
    builtInItems,
    orgMcpConnectionItems,
    installedMcpEntries: [
      ...builtInItems.flatMap((item) => item.active && item.builtInEntry ? [item.builtInEntry] : []),
      ...standaloneMcpEntries,
    ],
    // The MCP quick-connect surface ("Available apps · One-click connect")
    // needs unconfigured directory entries too — otherwise Notion, Linear,
    // iPolloWork Cloud Control, etc. are undiscoverable for anyone who is not
    // signed in to cloud (regression from #2008, which narrowed the section
    // to installed entries only).
    quickConnectEntries: [
      ...builtInItems.flatMap((item) => item.active && item.builtInEntry ? [item.builtInEntry] : []),
      ...standaloneMcpEntries,
      ...input.quickConnect.filter((entry) => {
        if (isBuiltIniPolloWorkExtension(entry)) return false;
        if (entry.pluginPackageId) return false;
        const serverName = getMcpServerName(entry);
        if (hasRenderableOrgEquivalent(entry)) return false;
        return !input.mcpServers.some((server) => server.name === serverName);
      }),
    ],
    installedSkills: standaloneSkillItems.flatMap((item) => item.skill ? [item.skill] : []),
  };
}
