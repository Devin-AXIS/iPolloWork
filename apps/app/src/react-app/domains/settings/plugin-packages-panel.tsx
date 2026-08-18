/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  WandSparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { currentLocale, t } from "@/i18n";
import type {
  iPolloWorkPluginAuthorizationFlow,
  iPolloWorkPluginAuthorizationState,
  iPolloWorkBundledPluginPackageItem,
  iPolloWorkPluginPackageItem,
  iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import type { iPolloWorkPluginAuthorizationMethod } from "@/app/extensions";
import type { McpStatus, McpStatusMap } from "@/app/types";
import { resolveExtensionIconUrl } from "@/react-app/design-system/extension-icon-src";
import { notifyPluginUiContributionsChanged } from "@/react-app/plugin-ui/plugin-ui-contributions";
import { AuthorizationFormDialog } from "@/react-app/domains/settings/authorization-form-dialog";
import { PluginPackageDetail } from "@/react-app/domains/settings/plugin-package-detail";
import { SettingsListSearchInput } from "@/react-app/domains/settings/settings-list";
import { SettingsSegmentedTabs } from "@/react-app/domains/settings/settings-segmented-tabs";
import { PluginPackageImportModal } from "./plugin-package-import-modal";
import { PluginPackageListItem } from "./plugin-package-list-item";
import {
  collectPluginPackageRelationships,
  derivePluginPrimaryAction,
  formatPluginPlatformError,
  localizePluginPackageManifest,
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
  marketplaceView: (search: string) => ReactNode;
};

type SecretAuthorizationEditor = {
  item: iPolloWorkPluginPackageItem;
  method: Extract<iPolloWorkPluginAuthorizationMethod, { kind: "secret-form" }>;
  values: Record<string, string>;
};

type McpConnectionFeedback = {
  status: "connecting" | "connected" | "unavailable";
  error?: string;
};

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

export function PluginPackagesPanel(props: PluginPackagesPanelProps) {
  const locale = currentLocale();
  const [items, setItems] = useState<iPolloWorkPluginPackageItem[]>([]);
  const [catalogItems, setCatalogItems] = useState<iPolloWorkBundledPluginPackageItem[]>([]);
  const [authorizations, setAuthorizations] = useState<Record<string, iPolloWorkPluginAuthorizationState>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [flows, setFlows] = useState<Record<string, iPolloWorkPluginAuthorizationFlow>>({});
  const [secretEditor, setSecretEditor] = useState<SecretAuthorizationEditor | null>(null);
  const [mcpConnectionFeedbacks, setMcpConnectionFeedbacks] = useState<Record<string, McpConnectionFeedback>>({});
  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState<"marketplace" | "personal">("personal");
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    if (!props.client || !props.workspaceId) {
      setItems([]);
      setCatalogItems([]);
      setAuthorizations({});
      setLoaded(true);
      return;
    }
    setError(null);
    try {
      const [response, catalog] = await Promise.all([
        props.client.listPluginPackages(props.workspaceId),
        props.client.listBundledPluginPackages(props.workspaceId),
      ]);
      setItems(response.items);
      notifyPluginUiContributionsChanged();
      setCatalogItems(catalog.items);
      const states = await Promise.all(response.items.map(async (item) => ({
        pluginId: item.pluginId,
        state: await props.client?.getPluginAuthorization(props.workspaceId ?? "", item.pluginId),
      })));
      setAuthorizations(Object.fromEntries(states.flatMap((entry) => entry.state ? [[entry.pluginId, entry.state]] : [])));
      const connectedPluginIds = new Set(states.filter((entry) => entry.state?.ready === true).map((entry) => entry.pluginId));
      setFlows((current) => Object.fromEntries(Object.entries(current).filter(([pluginId]) => !connectedPluginIds.has(pluginId))));
    } catch (cause) {
      setError(formatPluginPlatformError(cause, t("plugin_platform.error.load")));
    } finally {
      setLoaded(true);
    }
  }, [props.client, props.workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (Object.keys(flows).length === 0) return;
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [flows, refresh]);

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

  const saveSecret = (editor: SecretAuthorizationEditor) => run(`${editor.item.pluginId}:${editor.method.id}`, async () => {
    if (!props.client || !props.workspaceId) return;
    const fieldValues = Object.fromEntries(editor.method.fields.map((field) => [field.id, editor.values[field.id] ?? ""]));
    await props.client.savePluginAuthorization(props.workspaceId, editor.item.pluginId, editor.method.id, fieldValues);
    await refresh();
  });

  const openSecretEditor = (item: iPolloWorkPluginPackageItem, method: Extract<iPolloWorkPluginAuthorizationMethod, { kind: "secret-form" }>) => {
    setError(null);
    setSecretEditor({ item, method, values: {} });
  };

  const startAuthorization = (item: iPolloWorkPluginPackageItem, method: Exclude<iPolloWorkPluginAuthorizationMethod, { kind: "secret-form" }>) => run(`${item.pluginId}:${method.id}`, async () => {
    if (!props.client || !props.workspaceId) return;
    const result = await props.client.startPluginAuthorization(props.workspaceId, item.pluginId, method.id);
    setFlows((current) => ({ ...current, [item.pluginId]: result.flow }));
    const url = result.flow.authorizationUrl ?? result.flow.verificationUrl;
    if (url) props.onOpenUrl(url);
  });

  const pollDevice = (item: iPolloWorkPluginPackageItem, flow: iPolloWorkPluginAuthorizationFlow) => run(`${item.pluginId}:poll`, async () => {
    if (!props.client || !props.workspaceId) return;
    const result = await props.client.pollPluginDeviceAuthorization(props.workspaceId, item.pluginId, flow.flowId);
    if (result.status.status === "connected") {
      setFlows((current) => Object.fromEntries(Object.entries(current).filter(([pluginId]) => pluginId !== item.pluginId)));
      await refresh();
    }
  });

  const cancelFlow = (item: iPolloWorkPluginPackageItem, flow: iPolloWorkPluginAuthorizationFlow) => run(`${item.pluginId}:cancel`, async () => {
    if (!props.client || !props.workspaceId) return;
    await props.client.cancelPluginAuthorization(props.workspaceId, item.pluginId, flow.flowId);
    setFlows((current) => Object.fromEntries(Object.entries(current).filter(([pluginId]) => pluginId !== item.pluginId)));
    await refresh();
  });

  if (!props.client || !props.workspaceId) return null;

  const selectedSourceItem = items.find((item) => item.pluginId === props.selectedPluginId);
  if (props.selectedPluginId && !selectedSourceItem) {
    return (
      <section className="w-full max-w-4xl py-2">
        <Button variant="ghost" size="sm" className="-ml-2 text-dls-secondary" onClick={() => props.onSelectPlugin(null)}>
          <ChevronLeft size={16} />
          {t("plugin_platform.back_to_plugins")}
        </Button>
        <div className="flex min-h-64 items-center justify-center text-sm text-dls-secondary">
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
    const authorization = packageAuthorization(item, auth, props.mcpStatuses);
    const connected = authorization.connected;
    const flow = flows[item.pluginId];
    const setupHelpUrl = item.manifest.contributions?.find((contribution) =>
      contribution.type === "setup-instructions"
        && contribution.location === "settings-detail"
        && contribution.ref?.startsWith("https://")
    )?.ref;
    const iconUrl = resolveExtensionIconUrl({
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
                          <Button size="sm" variant={connected ? "outline" : "default"} disabled={busyKey !== null} onClick={() => openSecretEditor(item, method)}>
                            <KeyRound size={14} />
                            {t("plugin_platform.configure")}
                          </Button>
                        </div>
                      ) : (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Button size="sm" disabled={busyKey === `${item.pluginId}:${method.id}`} onClick={() => void startAuthorization(item, method)}>
                            {busyKey === `${item.pluginId}:${method.id}` ? <Loader2 size={14} className="animate-spin" /> : null}
                            {t("plugin_platform.continue")}
                          </Button>
                          {flow?.kind === "device-code" && flow.methodId === method.id ? (
                            <>
                              <span className="rounded-md bg-dls-hover px-2 py-1 font-mono text-xs text-dls-text">{flow.userCode}</span>
                              <Button size="sm" variant="outline" onClick={() => void pollDevice(item, flow)}>{t("plugin_platform.check_status")}</Button>
                              <Button size="sm" variant="ghost" onClick={() => void cancelFlow(item, flow)}>{t("plugin_platform.cancel")}</Button>
                            </>
                          ) : null}
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
        {secretEditor ? (
          <AuthorizationFormDialog
            open
            title={secretEditor.method.label}
            description={secretEditor.method.description}
            fields={secretEditor.method.fields.map((field) => ({
              id: field.id,
              label: field.label,
              placeholder: field.placeholder,
              secret: field.secret,
            }))}
            values={secretEditor.values}
            saving={busyKey === `${secretEditor.item.pluginId}:${secretEditor.method.id}`}
            error={error}
            cancelLabel={t("plugin_platform.cancel")}
            savedLabel={t("settings.authorization.value_saved")}
            submitLabel={t("plugin_platform.connect")}
            savingLabel={t("settings.authorization.saving")}
            onValuesChange={(values) => setSecretEditor((current) => current ? { ...current, values } : current)}
            onClose={() => {
              if (busyKey === null) setSecretEditor(null);
            }}
            onSubmit={() => void (async () => {
              if (await saveSecret(secretEditor)) setSecretEditor(null);
            })()}
          />
        ) : null}
      </PluginPackageDetail>
    );
  }

  return (
    <section className="space-y-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-dls-text">{t("plugin_library.title")}</h1>
          <p className="mt-1 text-sm text-dls-secondary">{t("plugin_library.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busyKey !== null}
            aria-label={t("common.refresh")}
            title={t("common.refresh")}
            onClick={() => void refresh()}
          >
            <RefreshCw size={15} />
          </Button>
          <Button size="sm" disabled={busyKey !== null} onClick={() => setImportOpen(true)}>
            <Upload size={14} />
            {t("plugin_library.add")}
          </Button>
        </div>
      </div>

      <SettingsListSearchInput
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
        placeholder={t("plugin_library.search")}
        aria-label={t("plugin_library.search")}
      />

      <div>
        <div className="border-b border-dls-border pb-2">
          <h2 className="text-sm font-semibold text-dls-text">{t("plugin_library.installed")}</h2>
        </div>
        {localizedItems.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-3">
            {localizedItems.map((item) => {
              const iconUrl = resolveExtensionIconUrl({
                iconSrc: item.manifest.icon?.src,
                iconSlug: item.manifest.icon?.simpleIconSlug,
              });
              return (
                <button
                  key={item.pluginId}
                  type="button"
                  className="group flex size-9 items-center justify-center overflow-hidden rounded-lg border border-dls-border bg-dls-surface text-dls-secondary shadow-sm transition hover:-translate-y-0.5 hover:border-dls-secondary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  title={item.name}
                  aria-label={t("plugin_library.open_plugin", { name: item.name })}
                  onClick={() => props.onSelectPlugin(item.pluginId)}
                >
                  {iconUrl ? <img src={iconUrl} alt="" className="size-5 object-contain" /> : <Package size={16} />}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="pt-4 text-sm text-dls-secondary">{t("plugin_platform.empty_title")}</p>
        )}
      </div>

      <div>
        <div className="border-b border-dls-border pb-2">
          <SettingsSegmentedTabs
            value={source}
            ariaLabel={t("plugin_library.source_label")}
            items={[
              { value: "personal", label: t("plugin_library.personal") },
              { value: "marketplace", label: t("plugin_library.marketplace") },
            ]}
            onValueChange={setSource}
          />
        </div>

        {source === "marketplace" ? (
          <div className="pt-5">{props.marketplaceView(search)}</div>
        ) : (
          <div className="pt-5">
            <div className="mb-2">
              <h2 className="text-sm font-semibold text-dls-text">{t("plugin_library.personal_title")}</h2>
              <p className="mt-1 text-xs text-dls-secondary">{t("plugin_library.personal_description")}</p>
            </div>
            {(filteredCatalogItems.length > 0 || filteredItems.length > 0) ? (
              <div className="grid gap-x-8 lg:grid-cols-2">
                {filteredCatalogItems.map((item) => (
                  <PluginPackageListItem
                    key={`catalog:${item.pluginId}`}
                    manifest={item.manifest}
                    version={item.version}
                    compact
                    featured
                    badge={<span className="rounded-full bg-blue-3 px-2 py-0.5 text-[10px] text-blue-11">{t("plugin_platform.official_bundle")}</span>}
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
                      badge={!item.enabled ? <span className="rounded-full bg-amber-3 px-2 py-0.5 text-[10px] text-amber-11">{t("plugin_platform.status.disabled")}</span> : null}
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
              <div className="rounded-2xl border border-dashed border-dls-border px-6 py-10 text-center text-sm text-dls-secondary">
                {search ? t("settings.marketplace.no_match") : t("plugin_library.personal_empty")}
              </div>
            )}
          </div>
        )}
      </div>

      {error ? <div role="alert" className="rounded-xl border border-red-6 bg-red-2 px-5 py-3 text-xs text-red-11">{error}</div> : null}
      <PluginPackageImportModal
        open={importOpen}
        client={props.client}
        workspaceId={props.workspaceId}
        installedPluginIds={items.map((item) => item.pluginId)}
        onClose={() => setImportOpen(false)}
        onInstalled={async (pluginId) => {
          await refresh();
          props.onSelectPlugin(pluginId);
        }}
      />
    </section>
  );
}
