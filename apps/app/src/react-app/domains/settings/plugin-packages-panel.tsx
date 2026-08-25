/** @jsxImportSource react */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AppWindow,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  KeyRound,
  Loader2,
  Package,
  Plug,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { currentLocale, t } from "@/i18n";
import { CODEX_HARNESS_ENGINE_ID, DEEPSEEK_HARNESS_ENGINE_ID, DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";
import type {
  iPolloWorkPluginAuthorizationState,
  iPolloWorkBundledPluginPackageItem,
  iPolloWorkPluginPackageItem,
  iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import type { McpStatus, McpStatusMap } from "@/app/types";
import { pluginPackageAuthorization } from "@/app/lib/plugin-package-readiness";
import { resolveExtensionIconUrl } from "@/react-app/design-system/extension-icon-src";
import { notifyPluginUiContributionsChanged } from "@/react-app/plugin-ui/plugin-ui-contributions";
import { PluginAuthorizationDialog } from "@/components/plugin-authorization-dialog";
import { PluginPackageDetail } from "@/react-app/domains/settings/plugin-package-detail";
import { SettingsListSearchInput } from "@/react-app/domains/settings/settings-list";
import { SettingsSegmentedTabs } from "@/react-app/domains/settings/settings-segmented-tabs";
import {
  settingsPageDescriptionClass,
  settingsPageTitleClass,
  settingsSectionTitleClass,
  settingsStandardContentClass,
} from "@/react-app/domains/settings/shell/panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PluginPackageImportModal } from "./plugin-package-import-modal";
import { PluginPackageListItem } from "./plugin-package-list-item";
import {
  MARKETPLACE_CATEGORY_IDS,
  type MarketplaceCategoryFilter,
  type MarketplaceStatusFilter,
} from "./pages/cloud-marketplaces-view";
import {
  collectPluginPackageRelationships,
  derivePluginPrimaryAction,
  formatPluginPlatformError,
  localizePluginPackageManifest,
  pluginPackageEngineLimitations,
  pluginPackageEngineScope,
  type PluginPackageRelationships,
} from "./plugin-platform-state";

type PluginPackagesPanelProps = {
  client: iPolloWorkServerClient | null;
  workspaceId: string | null;
  selectedPluginId: string | null;
  onSelectPlugin: (pluginId: string | null) => void;
  onOpenUrl: (url: string) => void;
  mcpStatuses: McpStatusMap;
  onConnectMcp: (serverName: string) => Promise<McpStatus | null>;
  onLogoutMcpAuth: (serverName: string) => void;
  onRelationshipsChange: (relationships: PluginPackageRelationships) => void;
  marketplaceView: (
    search: string,
    filters: { category: MarketplaceCategoryFilter; status: MarketplaceStatusFilter },
    installedPackages: iPolloWorkPluginPackageItem[],
  ) => ReactNode;
};

export type PluginPackagesPanelHandle = {
  refresh: () => void;
  openImport: () => void;
};

type PluginAuthorizationEditor = {
  item: iPolloWorkPluginPackageItem;
  methodId: string;
};

type McpConnectionFeedback = {
  status: "connecting" | "connected" | "unavailable";
  error?: string;
};

const INSTALLED_TILE_WIDTH = 48;
const INSTALLED_TILE_GAP = 8;
const PLUGIN_PACKAGE_LOAD_RETRY_DELAY_MS = 300;

async function loadPluginPackageData<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    await new Promise((resolve) => window.setTimeout(resolve, PLUGIN_PACKAGE_LOAD_RETRY_DELAY_MS));
    return operation();
  }
}

function packageAuthorization(
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

function statusText(state: iPolloWorkPluginAuthorizationState | undefined, required: boolean, connected: boolean) {
  if (!required) return t("plugin_platform.status.installed");
  if (connected) return t("plugin_platform.status.connected");
  if (state?.flows.some((flow) => flow.status === "pending")) return t("plugin_platform.status.pending");
  if (state?.flows.some((flow) => flow.status === "expired")) return t("plugin_platform.status.expired");
  return t("plugin_platform.status.needs_authorization");
}

function engineName(engineId: string): string {
  if (engineId === CODEX_HARNESS_ENGINE_ID) return t("projects.engine_codex");
  if (engineId === DEEPSEEK_HARNESS_ENGINE_ID) return t("projects.engine_dsh");
  return engineId === DEFAULT_ENGINE_ID ? t("projects.engine_opencode") : engineId;
}

function engineScopeBadge(item: iPolloWorkPluginPackageItem | iPolloWorkBundledPluginPackageItem): ReactNode {
  const scope = pluginPackageEngineScope(item.manifest, item.engineCompatibility);
  if (scope.kind === "universal") {
    return <span className="inline-flex h-4 items-center rounded-full bg-blue-3 px-1.5 text-[10px] leading-none text-blue-11">{t("plugin_platform.engine_scope.universal")}</span>;
  }
  if (scope.kind === "multi-engine") {
    const engines = scope.engineIds.map(engineName).join(" / ");
    return <span className="inline-flex h-4 items-center rounded-full bg-violet-3 px-1.5 text-[10px] leading-none text-violet-11">{t("plugin_platform.engine_scope.multiple", { engines })}</span>;
  }
  const label = scope.engineId === "deepseek-harness"
    ? t("plugin_platform.engine_scope.harness")
    : scope.engineId === "opencode"
      ? t("plugin_platform.engine_scope.opencode")
      : t("plugin_platform.engine_scope.specific", { engine: engineName(scope.engineId) });
  return <span className="inline-flex h-4 items-center rounded-full bg-gray-3 px-1.5 text-[10px] leading-none text-gray-11">{label}</span>;
}

function pluginPackageBadges(
  item: iPolloWorkPluginPackageItem | iPolloWorkBundledPluginPackageItem,
  disabled = false,
): ReactNode {
  return (
    <>
      {engineScopeBadge(item)}
      {disabled ? <span className="rounded-full bg-amber-3 px-2 py-0.5 text-[10px] text-amber-11">{t("plugin_platform.status.disabled")}</span> : null}
    </>
  );
}

export const PluginPackagesPanel = forwardRef<PluginPackagesPanelHandle, PluginPackagesPanelProps>(function PluginPackagesPanel(props, ref) {
  const locale = currentLocale();
  const [items, setItems] = useState<iPolloWorkPluginPackageItem[]>([]);
  const [catalogItems, setCatalogItems] = useState<iPolloWorkBundledPluginPackageItem[]>([]);
  const [authorizations, setAuthorizations] = useState<Record<string, iPolloWorkPluginAuthorizationState>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [authorizationEditor, setAuthorizationEditor] = useState<PluginAuthorizationEditor | null>(null);
  const [mcpConnectionFeedbacks, setMcpConnectionFeedbacks] = useState<Record<string, McpConnectionFeedback>>({});
  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState<"marketplace" | "personal">("personal");
  const [search, setSearch] = useState("");
  const [marketplaceCategory, setMarketplaceCategory] = useState<MarketplaceCategoryFilter>("all");
  const [marketplaceStatus, setMarketplaceStatus] = useState<MarketplaceStatusFilter>("all");
  const [installedExpanded, setInstalledExpanded] = useState(false);
  const [installedPreviewLimit, setInstalledPreviewLimit] = useState(Number.MAX_SAFE_INTEGER);
  const installedPreviewRowRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const client = props.client;
    const workspaceId = props.workspaceId;
    if (!client || !workspaceId) {
      setItems([]);
      setCatalogItems([]);
      setAuthorizations({});
      setLoaded(true);
      return;
    }
    setError(null);
    try {
      const [packagesResult, catalogResult] = await Promise.allSettled([
        loadPluginPackageData(() => client.listPluginPackages(workspaceId)),
        loadPluginPackageData(() => client.listBundledPluginPackages(workspaceId)),
      ]);

      if (packagesResult.status === "fulfilled") {
        const response = packagesResult.value;
        setItems(response.items);
        notifyPluginUiContributionsChanged();
        const stateResults = await Promise.allSettled(response.items.map(async (item) => ({
          pluginId: item.pluginId,
          state: await client.getPluginAuthorization(workspaceId, item.pluginId),
        })));
        setAuthorizations((current) => Object.fromEntries(response.items.flatMap((item, index) => {
          const result = stateResults[index];
          if (result?.status === "fulfilled" && result.value.state) {
            return [[item.pluginId, result.value.state]];
          }
          const previous = current[item.pluginId];
          return previous ? [[item.pluginId, previous]] : [];
        })));
      }
      if (catalogResult.status === "fulfilled") setCatalogItems(catalogResult.value.items);

      const failedResult = [packagesResult, catalogResult].find((result) => result.status === "rejected");
      if (failedResult?.status === "rejected") {
        setError(formatPluginPlatformError(failedResult.reason, t("plugin_platform.error.load")));
      }
    } catch (cause) {
      setError(formatPluginPlatformError(cause, t("plugin_platform.error.load")));
    } finally {
      setLoaded(true);
    }
  }, [props.client, props.workspaceId]);

  useImperativeHandle(ref, () => ({
    refresh: () => void refresh(),
    openImport: () => setImportOpen(true),
  }), [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const availableCatalogItems = useMemo(
    () => catalogItems.filter((item) => item.installedVersion === null || item.updateAvailable),
    [catalogItems],
  );
  const relationships = useMemo(
    () => collectPluginPackageRelationships(items, catalogItems),
    [catalogItems, items],
  );
  const localizedItems = useMemo(() => items.map((sourceItem) => {
    const manifest = localizePluginPackageManifest(
      sourceItem.manifest,
      locale,
      catalogItems.find((catalogItem) => catalogItem.pluginId === sourceItem.pluginId)?.manifest.localization,
    );
    return { ...sourceItem, name: manifest.name, manifest };
  }), [catalogItems, items, locale]);
  const installedPreviewItems = installedExpanded
    ? localizedItems
    : localizedItems.slice(0, installedPreviewLimit);
  const remainingInstalledCount = Math.max(0, localizedItems.length - installedPreviewItems.length);
  const remainingInstalledItems = installedExpanded
    ? []
    : localizedItems.slice(installedPreviewItems.length);
  const filteredItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return localizedItems;
    return localizedItems.filter((item) => [item.name, item.manifest.description, item.manifest.category ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(query)));
  }, [localizedItems, search]);
  const filteredCatalogItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return availableCatalogItems.flatMap((item) => {
      const manifest = localizePluginPackageManifest(item.manifest, locale);
      if (query && ![manifest.name, manifest.description, manifest.category ?? ""]
        .some((value) => value.toLocaleLowerCase().includes(query))) return [];
      return [{ ...item, manifest }];
    });
  }, [availableCatalogItems, locale, search]);

  useEffect(() => {
    props.onRelationshipsChange(relationships);
  }, [props.onRelationshipsChange, relationships]);

  useEffect(() => {
    const row = installedPreviewRowRef.current;
    if (!row) return;

    const updatePreviewLimit = () => {
      const rowWidth = row.parentElement?.getBoundingClientRect().width ?? row.getBoundingClientRect().width;
      const nextLimit = Math.max(
        1,
        Math.floor((rowWidth + INSTALLED_TILE_GAP) / (INSTALLED_TILE_WIDTH + INSTALLED_TILE_GAP)),
      );
      setInstalledPreviewLimit((current) => current === nextLimit ? current : nextLimit);
    };

    updatePreviewLimit();
    const observer = new ResizeObserver(updatePreviewLimit);
    observer.observe(row);
    return () => observer.disconnect();
  }, [localizedItems.length]);

  const run = useCallback(async (key: string, operation: () => Promise<void>): Promise<boolean> => {
    setBusyKey(key);
    setError(null);
    try {
      await operation();
      return true;
    } catch (cause) {
      setError(formatPluginPlatformError(
        cause,
        t("plugin_platform.error.operation"),
        t("plugin_platform.error.conflict"),
      ));
      return false;
    } finally {
      setBusyKey(null);
    }
  }, []);

  const connectGuidedMcp = async (serverName: string, pluginName: string) => {
    setMcpConnectionFeedbacks((current) => ({
      ...current,
      [serverName]: { status: "connecting" },
    }));
    const completed = await run(`mcp:${serverName}`, async () => {
      const status = await props.onConnectMcp(serverName);
      setMcpConnectionFeedbacks((current) => ({
        ...current,
        [serverName]: status?.status === "connected"
          ? { status: "connected" }
          : {
              status: "unavailable",
              error: status?.status === "failed" || status?.status === "needs_client_registration"
                ? status.error
                : undefined,
            },
      }));
    });
    if (!completed) {
      setMcpConnectionFeedbacks((current) => ({
        ...current,
        [serverName]: {
          status: "unavailable",
          error: t("plugin_platform.desktop_mcp_unavailable", { name: pluginName }),
        },
      }));
    }
  };

  const installBundledPackage = (item: iPolloWorkBundledPluginPackageItem) => run(`catalog:${item.pluginId}`, async () => {
    if (!props.client || !props.workspaceId) return;
    await props.client.installBundledPluginPackage(props.workspaceId, item.pluginId);
    await refresh();
  });

  if (!props.client || !props.workspaceId) return null;

  const selectedSourceItem = items.find((item) => item.pluginId === props.selectedPluginId);
  if (props.selectedPluginId && !selectedSourceItem) {
    return (
      <section className={`${settingsStandardContentClass} py-2`}>
        <Button variant="ghost" size="sm" className="-ml-2 text-dls-secondary" onClick={() => props.onSelectPlugin(null)}>
          <ChevronLeft size={16} />
          {t("plugin_platform.back_to_plugins")}
        </Button>
        <div className="flex min-h-64 items-center justify-center text-ui-control leading-5 text-dls-secondary">
          {!loaded ? <Loader2 size={18} className="animate-spin" /> : error ?? t("plugin_platform.error.not_found")}
        </div>
      </section>
    );
  }
  if (selectedSourceItem) {
    const localizedManifest = localizePluginPackageManifest(
      selectedSourceItem.manifest,
      locale,
      catalogItems.find((catalogItem) => catalogItem.pluginId === selectedSourceItem.pluginId)?.manifest.localization,
    );
    const item = { ...selectedSourceItem, name: localizedManifest.name, manifest: localizedManifest };
    const auth = authorizations[item.pluginId];
    const methods = item.manifest.authorization?.methods ?? [];
    const authorization = pluginPackageAuthorization(item, auth, props.mcpStatuses);
    const connected = authorization.connected;
    const setupHelpUrl = item.manifest.contributions?.find((contribution) =>
      contribution.type === "setup-instructions"
        && contribution.location === "settings-detail"
        && contribution.ref?.startsWith("https://")
    )?.ref;
    const iconUrl = resolveExtensionIconUrl({
      pluginId: item.pluginId,
      iconSrc: item.manifest.icon?.src,
      iconSlug: item.manifest.icon?.simpleIconSlug,
    });
    const appResources = [
      ...item.manifest.resources.filter((resource) =>
        ["mcp", "provider", "local-service", "native-binary"].includes(resource.type)
      ),
      ...item.manifest.engineBindings?.flatMap((binding) => binding.capabilities.map((capability) => ({
        ...capability,
        type: `${binding.engine}/${capability.kind}`,
      }))) ?? [],
      ...item.manifest.contributions?.flatMap((contribution) => (
        contribution.type === "session-side-panel"
        && contribution.location === "session-right-pane"
        && contribution.ref
          ? [{
              id: contribution.ref,
              type: "workspace",
              label: contribution.label,
              description: contribution.description,
            }]
          : []
      )) ?? [],
    ];
    const skillResources = item.manifest.resources.filter((resource) => resource.type === "skill");
    const relatedSkillNames = item.manifest.relatedSkills ?? [];
    const otherResources = item.manifest.resources.filter((resource) =>
      !["mcp", "provider", "local-service", "native-binary", "skill"].includes(resource.type)
    );
    const publisher = item.manifest.package?.publisher?.name
      ?? item.manifest.source.reference
      ?? item.manifest.source.origin
      ?? t("plugin_platform.publisher_unknown");
    const category = item.manifest.category?.trim()
      || (item.pluginId === "figma" ? t("plugin_platform.category_design_development") : t("plugin_platform.default_category"));
    const engineLimitations = pluginPackageEngineLimitations(item.manifest, item.engineCompatibility);

    const toggleKey = `${item.pluginId}:toggle`;

    return (
      <PluginPackageDetail
        name={item.name}
        description={item.manifest.description}
        iconUrl={iconUrl}
        onBack={() => props.onSelectPlugin(null)}
        action={(
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-green-6 bg-green-2 px-3 py-1.5 text-xs font-medium text-green-11">
                <CheckCircle2 size={15} />
                {t("plugin_platform.status.installed")}
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-dls-secondary">
                {busyKey === toggleKey ? <Loader2 size={14} className="animate-spin" /> : null}
                <span>{t("plugin_platform.enable")}</span>
                <Switch
                  size="sm"
                  checked={item.enabled}
                  disabled={busyKey !== null}
                  aria-label={t("plugin_platform.enable")}
                  onCheckedChange={(checked) => void run(toggleKey, async () => {
                    await props.client?.setPluginPackageEnabled(props.workspaceId ?? "", item.pluginId, checked);
                    await refresh();
                  })}
                />
              </label>
            </div>
            {authorization.required && !connected ? (
              <div className="flex items-center gap-1.5 rounded-lg border border-amber-6 bg-amber-2 px-2.5 py-1.5 text-xs font-medium text-amber-11">
                <KeyRound size={13} />
                {t("plugin_platform.status.needs_authorization")}
              </div>
            ) : null}
          </div>
        )}
      >
        {engineLimitations.length > 0 ? (
          <div className="mt-6 rounded-2xl border border-amber-6 bg-amber-2/70 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-11">
              <ShieldCheck size={16} />
              {t("plugin_platform.engine.compatibility_title")}
            </div>
            <div className="mt-3 divide-y divide-amber-6/60">
              {engineLimitations.map((limitation) => (
                <div key={limitation.engineId} className="py-3 first:pt-0 last:pb-0">
                  <div className="text-xs font-semibold text-amber-11">
                    {t(limitation.status === "unsupported"
                      ? "plugin_platform.engine.unsupported_title"
                      : "plugin_platform.engine.partial_title", {
                      engine: engineName(limitation.engineId),
                    })}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-amber-11/90">
                    {limitation.capabilityLabels.length > 0
                      ? t("plugin_platform.engine.unavailable_features", {
                          capabilities: limitation.capabilityLabels.join(locale === "zh" ? "、" : ", "),
                        })
                      : limitation.nativeEngineOnly
                        ? t("plugin_platform.engine.ecosystem_description", { engine: engineName(limitation.engineId) })
                        : t("plugin_platform.engine.unavailable_description", { engine: engineName(limitation.engineId) })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {item.manifest.composer?.prompt ? (
            <div className="mt-8 rounded-2xl border border-violet-6/40 bg-gradient-to-r from-blue-3/70 via-violet-3/45 to-dls-hover p-6 sm:p-8">
              <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-dls-border/70 bg-dls-surface/85 px-4 py-3 shadow-sm backdrop-blur">
                <WandSparkles size={18} className="shrink-0 text-violet-11" />
                <p className="min-w-0 flex-1 text-sm font-medium leading-6 text-dls-text">{item.manifest.composer.prompt}</p>
                <ChevronRight size={17} className="shrink-0 text-dls-secondary" />
              </div>
            </div>
          ) : null}

        {appResources.length > 0 ? (
            <div className="mt-8">
              <h3 className="text-sm font-semibold text-dls-text">
                {t("plugin_platform.apps")} <span className="ml-1 font-normal text-dls-secondary">{appResources.length}</span>
              </h3>
              <div className="mt-3 divide-y divide-dls-border border-y border-dls-border">
                {appResources.map((resource) => (
                  <div key={resource.id} className="flex items-start gap-3 px-1 py-4">
                    <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-dls-border bg-dls-hover text-dls-secondary">
                      {resource.type === "mcp" ? <Plug size={17} /> : <AppWindow size={17} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-dls-text">{resource.label ?? resource.id}</div>
                      <p className="mt-1 text-xs leading-5 text-dls-secondary">{resource.description ?? resource.id}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {(authorization.connectionMcpResources.length > 0 || methods.length > 0) ? (
            <div className="mt-6 rounded-2xl border border-dls-border bg-dls-hover/25 p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-dls-text">
                <KeyRound size={16} />
                {t("plugin_platform.authorization")}
              </div>
              {methods.length > 0 && auth?.ready === true ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-green-6 bg-green-2 px-3 py-2 text-xs text-green-11">
                  <span>{t("plugin_platform.status.connected")}</span>
                  {auth?.connections[0] ? <Button size="sm" variant="ghost" onClick={() => void run(`${item.pluginId}:revoke`, async () => {
                    await props.client?.revokePluginAuthorization(props.workspaceId ?? "", item.pluginId, auth.connections[0]?.accountId ?? "default");
                    await refresh();
                  })}>{t("plugin_platform.revoke")}</Button> : null}
                </div>
              ) : null}
              {authorization.connectionMcpResources.length > 0 ? (
                <div className={`${methods.length > 0 && auth?.ready === true ? "mt-3 " : ""}space-y-3`}>
                  <p className="text-xs leading-5 text-dls-secondary">
                    {item.manifest.setup?.instructions?.trim() || t("plugin_platform.mcp_authorization_hint")}
                  </p>
                  {authorization.connectionMcpResources.map((resource) => {
                    const serverName = resource.mcpServerName;
                    if (!serverName) return null;
                    const mcpConnected = props.mcpStatuses[serverName]?.status === "connected";
                    const guidedSetup = resource.oauth !== true && Boolean(item.manifest.setup?.instructions?.trim());
                    const connectionFeedback = mcpConnectionFeedbacks[serverName];
                    const connectionBusy = busyKey === `mcp:${serverName}`;
                    const desktopMcpUnavailable = guidedSetup
                      && connectionFeedback?.status !== "connecting"
                      && (connectionFeedback?.status === "unavailable" || props.mcpStatuses[serverName]?.status === "failed");
                    return (
                      <div key={resource.id} className="rounded-xl border border-dls-border bg-dls-surface p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-dls-text">{resource.label ?? resource.id}</div>
                            <div className={`mt-1 text-xs ${mcpConnected ? "text-green-11" : "text-dls-secondary"}`}>
                              {mcpConnected
                                ? t("plugin_platform.status.connected")
                                : desktopMcpUnavailable
                                  ? t("plugin_platform.status.desktop_mcp_unavailable")
                                  : t("plugin_platform.status.needs_authorization")}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant={mcpConnected ? "outline" : "default"}
                              disabled={busyKey !== null}
                              onClick={() => {
                                if (mcpConnected && !guidedSetup) {
                                  props.onLogoutMcpAuth(serverName);
                                  return;
                                }
                                if (guidedSetup) {
                                  void connectGuidedMcp(serverName, item.name);
                                  return;
                                }
                                void props.onConnectMcp(serverName);
                              }}
                            >
                              {connectionBusy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                              {connectionBusy
                                ? t("plugin_platform.connecting")
                                : guidedSetup
                                  ? mcpConnected
                                    ? t("plugin_platform.check_status")
                                    : item.manifest.setup?.primaryCta ?? t("plugin_platform.connect_mcp", { name: item.name })
                                  : mcpConnected
                                    ? t("plugin_platform.revoke")
                                    : t("plugin_platform.connect_mcp", { name: item.name })}
                            </Button>
                            {guidedSetup && setupHelpUrl ? (
                              <Button size="sm" variant="outline" onClick={() => props.onOpenUrl(setupHelpUrl)}>
                                {item.manifest.setup?.secondaryCta ?? t("plugin_platform.info")}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        {guidedSetup && (connectionFeedback || desktopMcpUnavailable) ? (
                          <div
                            className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-5 ${mcpConnected || connectionFeedback?.status === "connected"
                              ? "border-green-6 bg-green-2 text-green-11"
                              : connectionFeedback?.status === "connecting"
                                ? "border-dls-border bg-dls-hover text-dls-secondary"
                                : "border-amber-6 bg-amber-2 text-amber-11"}`}
                            role="status"
                            title={connectionFeedback?.error}
                          >
                            {mcpConnected || connectionFeedback?.status === "connected"
                              ? t("plugin_platform.mcp_connected_detail", { name: item.name })
                              : connectionFeedback?.status === "connecting"
                                ? t("plugin_platform.connecting")
                                : t("plugin_platform.desktop_mcp_unavailable", { name: item.name })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {methods.length > 0 ? (
                <div className={`${authorization.connectionMcpResources.length > 0 || auth?.ready === true ? "mt-3 " : ""}space-y-3`}>
                  {methods.map((method) => (
                    <div key={method.id} className="rounded-xl border border-dls-border bg-dls-surface p-3">
                      <div className="text-xs font-semibold text-dls-text">{method.label}</div>
                      {method.description ? <p className="mt-1 text-xs leading-5 text-dls-secondary">{method.description}</p> : null}
                      {method.kind === "secret-form" ? (
                        <div className="mt-3">
                          <Button size="sm" variant={connected ? "outline" : "default"} disabled={busyKey !== null} onClick={() => setAuthorizationEditor({ item, methodId: method.id })}>
                            <KeyRound size={14} />
                            {t("plugin_platform.configure")}
                          </Button>
                        </div>
                      ) : (
                        <div className="mt-3">
                          <Button size="sm" disabled={busyKey !== null} onClick={() => setAuthorizationEditor({ item, methodId: method.id })}>
                            {t("plugin_platform.continue")}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {skillResources.length > 0 ? (
            <div className="mt-8">
              <h3 className="text-sm font-semibold text-dls-text">
                {t("plugin_platform.skills")} <span className="ml-1 font-normal text-dls-secondary">{skillResources.length}</span>
              </h3>
              <div className="mt-3 divide-y divide-dls-border border-y border-dls-border">
                {skillResources.map((resource) => {
                  const enabled = item.enabled && !item.disabledResourceIds.includes(resource.id);
                  const toggleKey = `${item.pluginId}:resource:${resource.id}`;
                  return (
                    <div key={resource.id} className="flex items-center gap-3 px-1 py-4">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-violet-6/50 bg-violet-3/40 text-violet-11">
                        <Sparkles size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-dls-text">{resource.label ?? resource.id}</div>
                        <p className="mt-1 truncate text-xs text-dls-secondary">{resource.description ?? resource.id}</p>
                      </div>
                      {busyKey === toggleKey ? <Loader2 size={15} className="animate-spin text-dls-secondary" /> : null}
                      <Switch
                        size="sm"
                        checked={enabled}
                        disabled={!item.enabled || busyKey !== null}
                        aria-label={t("plugin_platform.toggle_skill", { name: resource.label ?? resource.id })}
                        onCheckedChange={(checked) => void run(toggleKey, async () => {
                          await props.client?.setPluginPackageResourceEnabled(props.workspaceId ?? "", item.pluginId, resource.id, checked);
                          await refresh();
                        })}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {relatedSkillNames.length > 0 ? (
            <div className="mt-8">
              <h3 className="text-sm font-semibold text-dls-text">
                {t("plugin_platform.related_skills")} <span className="ml-1 font-normal text-dls-secondary">{relatedSkillNames.length}</span>
              </h3>
              <p className="mt-1 text-xs leading-5 text-dls-secondary">{t("plugin_platform.related_skills_description")}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {relatedSkillNames.map((skillName) => (
                  <div key={skillName} className="flex items-center gap-3 rounded-xl border border-dls-border px-3 py-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-violet-6/50 bg-violet-3/40 text-violet-11">
                      <Sparkles size={14} />
                    </div>
                    <div className="min-w-0 truncate font-mono text-xs text-dls-text">{skillName}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {otherResources.length > 0 ? (
            <div className="mt-8">
              <h3 className="text-sm font-semibold text-dls-text">
                {t("plugin_platform.more_capabilities")} <span className="ml-1 font-normal text-dls-secondary">{otherResources.length}</span>
              </h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {otherResources.map((resource) => (
                  <div key={resource.id} className="flex items-center gap-3 rounded-xl border border-dls-border px-3 py-3">
                    <div className="text-dls-secondary">
                      {resource.type === "agent" ? <Bot size={16} /> : resource.type === "file" ? <FileText size={16} /> : <ShieldCheck size={16} />}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-dls-text">{resource.label ?? resource.id}</div>
                      <div className="mt-0.5 text-[11px] text-dls-secondary">{resource.type}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-10">
            <h3 className="text-sm font-semibold text-dls-text">{t("plugin_platform.info")}</h3>
            <dl className="mt-3 divide-y divide-dls-border border-y border-dls-border text-sm">
              {[
                [t("plugin_platform.author"), publisher],
                [t("plugin_platform.category"), category],
                [t("plugin_platform.version"), `v${item.version}`],
                [t("plugin_platform.capabilities"), t("plugin_platform.capability_summary", {
                  apps: appResources.length,
                  skills: skillResources.length,
                  more: otherResources.length,
                })],
              ].map(([label, value]) => (
                <div key={label} className="grid gap-2 py-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <dt className="text-dls-secondary">{label}</dt>
                  <dd className="min-w-0 break-words font-medium text-dls-text">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="mt-8 flex flex-col gap-4 border-t border-dls-border pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-dls-text">{t("plugin_platform.uninstall")}</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-dls-secondary">
                {t("plugin_platform.uninstall_description")}
              </p>
            </div>
            <Button
              size="sm"
              variant="destructive"
              className="shrink-0"
              disabled={busyKey !== null}
              onClick={() => void run(`${item.pluginId}:remove`, async () => {
                await props.client?.uninstallPluginPackage(props.workspaceId ?? "", item.pluginId);
                props.onSelectPlugin(null);
                await refresh();
              })}
            >
              {busyKey === `${item.pluginId}:remove` ? <Loader2 size={14} className="animate-spin" /> : null}
              {t("plugin_platform.uninstall")}
            </Button>
          </div>

          <details className="mt-8 rounded-xl border border-dls-border px-4 py-3">
            <summary className="cursor-pointer text-xs font-medium text-dls-secondary">{t("plugin_platform.advanced")}</summary>
            {(item.manifest.permissions?.length ?? 0) > 0 ? (
              <ul className="mt-3 space-y-1.5 text-xs leading-5 text-dls-secondary">
                {item.manifest.permissions?.map((permission) => <li key={permission.id}>• {permission.reason}</li>)}
              </ul>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="w-full break-all font-mono text-[10px] text-dls-secondary">SHA-256 {item.integrity.sha256}</span>
              {item.previousVersion ? <Button size="sm" variant="outline" onClick={() => void run(`${item.pluginId}:rollback`, async () => {
                await props.client?.rollbackPluginPackage(props.workspaceId ?? "", item.pluginId);
                await refresh();
              })}>{t("plugin_platform.rollback")}</Button> : null}
            </div>
          </details>
        {error ? <div role="alert" className="mt-4 rounded-xl border border-red-6 bg-red-2 px-4 py-3 text-xs text-red-11">{error}</div> : null}
        <PluginAuthorizationDialog
          open={authorizationEditor !== null}
          item={authorizationEditor?.item ?? null}
          authorization={authorizationEditor ? authorizations[authorizationEditor.item.pluginId] : undefined}
          client={props.client}
          workspaceId={props.workspaceId}
          methodId={authorizationEditor?.methodId}
          onOpenChange={(open) => {
            if (!open) setAuthorizationEditor(null);
          }}
          onUpdated={refresh}
        />
      </PluginPackageDetail>
    );
  }

  return (
    <section className="w-full">
      <div className="space-y-4">
        <div className="max-w-lg">
          <h1 data-testid="plugin-library-heading" className={settingsPageTitleClass}>{t("plugin_library.title")}</h1>
          <p data-testid="plugin-library-description" className={settingsPageDescriptionClass}>{t("plugin_library.description")}</p>
        </div>
        <SettingsListSearchInput
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder={t("plugin_library.search")}
          aria-label={t("plugin_library.search")}
          containerClassName="h-[34px] rounded-lg border-transparent bg-[#f5f6f9] shadow-none hover:bg-[#f1f2f5] dark:bg-white/[0.06] dark:hover:bg-white/[0.09]"
        />
      </div>

      <section data-testid="plugin-library-installed" className="mt-8 space-y-3">
        <div className="border-b border-dls-border pb-2">
          <div>
            <h2 className={settingsSectionTitleClass}>{t("plugin_library.installed")}</h2>
            <p className={settingsPageDescriptionClass}>{t("plugin_library.installed_description")}</p>
          </div>
        </div>

        {localizedItems.length > 0 ? (
          <div className="flex flex-col gap-3">
            <TooltipProvider delay={0}>
              <div
                ref={installedPreviewRowRef}
                data-testid="plugin-installed-row"
                className={`flex w-full items-center gap-2 ${installedExpanded ? "flex-wrap" : "flex-nowrap"}`}
              >
                {installedPreviewItems.map((item) => {
                  const iconUrl = resolveExtensionIconUrl({
                    pluginId: item.pluginId,
                    iconSrc: item.manifest.icon?.src,
                    iconSlug: item.manifest.icon?.simpleIconSlug,
                  });
                  const authorization = packageAuthorization(item, authorizations[item.pluginId], props.mcpStatuses);
                  const status = statusText(
                    authorizations[item.pluginId],
                    authorization.required,
                    authorization.connected,
                  );
                  return (
                    <Tooltip key={item.pluginId}>
                      <TooltipTrigger
                        render={(
                          <button
                            data-testid="plugin-installed-tile"
                            type="button"
                            className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-transparent bg-[#f6f7fb] transition-colors hover:border-[#1FBAC0] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                            aria-label={t("plugin_library.open_plugin", { name: item.name })}
                            onClick={() => props.onSelectPlugin(item.pluginId)}
                          />
                        )}
                      >
                        {iconUrl ? <img src={iconUrl} alt="" className="size-7 object-contain" /> : <Package size={18} />}
                      </TooltipTrigger>
                      <TooltipContent data-testid="plugin-installed-tooltip">{item.name} · {status}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </TooltipProvider>
            {installedExpanded || remainingInstalledCount > 0 ? (
              <Button
                data-testid="plugin-installed-expand"
                data-remaining-count={remainingInstalledCount}
                data-expanded={installedExpanded}
                aria-expanded={installedExpanded}
                variant="ghost"
                size="sm"
                className="self-start text-dls-secondary"
                onClick={() => setInstalledExpanded((current) => !current)}
              >
                {!installedExpanded ? (
                  <span data-testid="plugin-installed-overflow-thumbnails" className="flex -space-x-1">
                    {remainingInstalledItems.slice(0, 3).map((item) => {
                      const iconUrl = resolveExtensionIconUrl({
                        pluginId: item.pluginId,
                        iconSrc: item.manifest.icon?.src,
                        iconSlug: item.manifest.icon?.simpleIconSlug,
                      });
                      return (
                        <span key={item.pluginId} className="flex size-6 items-center justify-center overflow-hidden rounded-md border border-dls-border bg-dls-surface">
                          {iconUrl ? <img src={iconUrl} alt="" className="size-4 object-contain" /> : <Package size={12} />}
                        </span>
                      );
                    })}
                  </span>
                ) : null}
                {installedExpanded
                  ? t("plugin_library.show_less")
                  : t("plugin_library.view_more", { count: remainingInstalledCount })}
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-ui-control leading-5 text-dls-secondary">{t("plugin_platform.empty_title")}</p>
        )}
      </section>

      <section data-testid="plugin-library-source" className="mt-8 space-y-3">
        <div className="border-b border-dls-border pb-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <SettingsSegmentedTabs
              value={source}
              ariaLabel={t("plugin_library.source_label")}
              items={[
                { value: "personal", label: t("plugin_library.personal") },
                { value: "marketplace", label: t("plugin_library.marketplace") },
              ]}
              onValueChange={setSource}
            />

            {source === "marketplace" ? (
              <div className="flex flex-wrap items-center gap-3">
                <Select value={marketplaceCategory} onValueChange={(value) => { if (value) setMarketplaceCategory(value); }}>
                  <SelectTrigger data-testid="plugin-category-filter" className="w-[132px]">
                    <SelectValue>
                      {marketplaceCategory === "all"
                        ? t("plugin_library.all_categories")
                        : t(`plugin_library.category.${marketplaceCategory}`)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="all">{t("plugin_library.all_categories")}</SelectItem>
                    {MARKETPLACE_CATEGORY_IDS.map((categoryId) => (
                      <SelectItem key={categoryId} value={categoryId}>{t(`plugin_library.category.${categoryId}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={marketplaceStatus} onValueChange={(value) => { if (value) setMarketplaceStatus(value); }}>
                  <SelectTrigger data-testid="plugin-status-filter" className="w-[132px]">
                    <SelectValue>
                      {marketplaceStatus === "all"
                        ? t("plugin_library.all_statuses")
                        : t(`plugin_library.status_${marketplaceStatus}`)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="all">{t("plugin_library.all_statuses")}</SelectItem>
                    <SelectItem value="available">{t("plugin_library.status_available")}</SelectItem>
                    <SelectItem value="installed">{t("plugin_library.status_installed")}</SelectItem>
                    <SelectItem value="update">{t("plugin_library.status_update")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          <p className="settings-description mt-2 text-ui-control leading-5 text-dls-secondary">
            {t(source === "marketplace" ? "plugin_library.marketplace_description" : "plugin_library.personal_description")}
          </p>
        </div>

        {source === "marketplace" ? (
          props.marketplaceView(search, { category: marketplaceCategory, status: marketplaceStatus }, items)
        ) : (filteredCatalogItems.length > 0 || filteredItems.length > 0) ? (
          <div className="grid gap-x-8 gap-y-2 lg:grid-cols-2">
            {filteredCatalogItems.map((item) => (
              <PluginPackageListItem
                key={`catalog:${item.pluginId}`}
                manifest={item.manifest}
                version={item.version}
                compact
                featured
                badge={pluginPackageBadges(item)}
                actionBusy={busyKey !== null}
                actionLabel={<>{busyKey === `catalog:${item.pluginId}` ? <Loader2 size={14} className="animate-spin" /> : null}{item.updateAvailable ? t("plugin_platform.action.update") : t("plugin_platform.action.install")}</>}
                onAction={() => void installBundledPackage(item)}
              />
            ))}
            {filteredItems.map((item) => {
              const auth = authorizations[item.pluginId];
              const authorization = packageAuthorization(item, auth, props.mcpStatuses);
              const connected = authorization.connected;
              const primaryAction = derivePluginPrimaryAction({
                installed: true,
                authorizationRequired: authorization.required,
                connected,
                updateAvailable: false,
                broken: !item.enabled,
              });
              return (
                <PluginPackageListItem
                  key={item.pluginId}
                  manifest={item.manifest}
                  version={item.version}
                  compact
                  badge={pluginPackageBadges(item, !item.enabled)}
                  status={<span className="inline-flex items-center gap-1.5">{connected || !authorization.required ? <CheckCircle2 size={13} className="text-green-9" /> : <KeyRound size={13} className="text-amber-9" />}{statusText(auth, authorization.required, connected)}</span>}
                  actionBusy={busyKey !== null}
                  actionLabel={t(primaryAction.labelKey)}
                  onOpen={() => props.onSelectPlugin(item.pluginId)}
                  onAction={() => {
                    if (primaryAction.kind === "repair") {
                      void run(`${item.pluginId}:enable`, async () => {
                        await props.client?.setPluginPackageEnabled(props.workspaceId ?? "", item.pluginId, true);
                        await refresh();
                      });
                      return;
                    }
                    props.onSelectPlugin(item.pluginId);
                  }}
                />
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-dls-border px-6 py-10 text-center text-ui-control leading-5 text-dls-secondary">
            {search ? t("settings.marketplace.no_match") : t("plugin_library.personal_empty")}
          </div>
        )}
      </section>

      {error ? <div role="alert" className="rounded-xl border border-red-6 bg-red-2 px-5 py-3 text-xs text-red-11">{error}</div> : null}
      <PluginPackageImportModal
        open={importOpen}
        client={props.client}
        workspaceId={props.workspaceId}
        onClose={() => setImportOpen(false)}
        onInstalled={async (pluginId) => {
          await refresh();
          props.onSelectPlugin(pluginId);
        }}
      />
    </section>
  );
});
