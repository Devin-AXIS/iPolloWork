/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { t } from "@/i18n";
import type {
  iPolloWorkPluginAuthorizationFlow,
  iPolloWorkPluginAuthorizationState,
  iPolloWorkBundledPluginPackageItem,
  iPolloWorkPluginPackageItem,
  iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import type { iPolloWorkPluginAuthorizationMethod } from "@/app/extensions";
import { resolveExtensionIconUrl } from "@/react-app/design-system/extension-icon-src";
import { AuthorizationFormDialog } from "@/react-app/domains/settings/authorization-form-dialog";
import { PluginPackageImportModal } from "./plugin-package-import-modal";
import { derivePluginPrimaryAction, formatPluginPlatformError } from "./plugin-platform-state";

type PluginPackagesPanelProps = {
  client: iPolloWorkServerClient | null;
  workspaceId: string | null;
  selectedPluginId: string | null;
  onSelectPlugin: (pluginId: string | null) => void;
  onOpenUrl: (url: string) => void;
  onConnectFigma: () => void;
};

type SecretAuthorizationEditor = {
  item: iPolloWorkPluginPackageItem;
  method: Extract<iPolloWorkPluginAuthorizationMethod, { kind: "secret-form" }>;
  values: Record<string, string>;
};

function statusText(state: iPolloWorkPluginAuthorizationState | undefined, hasPluginAuthorization: boolean) {
  if (!hasPluginAuthorization) return t("plugin_platform.status.installed");
  if (state?.ready) return t("plugin_platform.status.connected");
  if (state?.flows.some((flow) => flow.status === "pending")) return t("plugin_platform.status.pending");
  if (state?.flows.some((flow) => flow.status === "expired")) return t("plugin_platform.status.expired");
  return state?.required ? t("plugin_platform.status.needs_authorization") : t("plugin_platform.status.ready");
}

export function PluginPackagesPanel(props: PluginPackagesPanelProps) {
  const [items, setItems] = useState<iPolloWorkPluginPackageItem[]>([]);
  const [catalogItems, setCatalogItems] = useState<iPolloWorkBundledPluginPackageItem[]>([]);
  const [authorizations, setAuthorizations] = useState<Record<string, iPolloWorkPluginAuthorizationState>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [flows, setFlows] = useState<Record<string, iPolloWorkPluginAuthorizationFlow>>({});
  const [secretEditor, setSecretEditor] = useState<SecretAuthorizationEditor | null>(null);
  const [loaded, setLoaded] = useState(false);

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

  const installedCount = items.length;
  const availableCatalogItems = catalogItems.filter((item) => item.installedVersion === null || item.updateAvailable);
  const connectedCount = useMemo(
    () => items.filter((item) =>
      (item.manifest.authorization?.methods?.length ?? 0) > 0 && authorizations[item.pluginId]?.ready === true
    ).length,
    [authorizations, items],
  );

  const run = useCallback(async (key: string, operation: () => Promise<void>): Promise<boolean> => {
    setBusyKey(key);
    setError(null);
    try {
      await operation();
      return true;
    } catch (cause) {
      setError(formatPluginPlatformError(cause, t("plugin_platform.error.operation")));
      return false;
    } finally {
      setBusyKey(null);
    }
  }, []);

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

  const selectedItem = items.find((item) => item.pluginId === props.selectedPluginId);
  if (props.selectedPluginId && !selectedItem) {
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
  if (selectedItem) {
    const item = selectedItem;
    const auth = authorizations[item.pluginId];
    const methods = item.manifest.authorization?.methods ?? [];
    const hasPluginAuthorization = methods.length > 0;
    const connected = hasPluginAuthorization && auth?.ready === true;
    const hasFigmaMcp = item.manifest.resources.some((resource) =>
      resource.type === "mcp" && resource.mcpServerName === "figma"
    );
    const flow = flows[item.pluginId];
    const iconUrl = resolveExtensionIconUrl({
      iconSrc: item.manifest.icon?.src,
      iconSlug: item.manifest.icon?.simpleIconSlug,
    });
    const appResources = item.manifest.resources.filter((resource) =>
      ["mcp", "opencode-plugin", "provider", "local-service", "native-binary"].includes(resource.type)
    );
    const skillResources = item.manifest.resources.filter((resource) => resource.type === "skill");
    const otherResources = item.manifest.resources.filter((resource) =>
      !["mcp", "opencode-plugin", "provider", "local-service", "native-binary", "skill"].includes(resource.type)
    );
    const publisher = item.manifest.package?.publisher?.name
      ?? item.manifest.source.reference
      ?? item.manifest.source.origin
      ?? t("plugin_platform.publisher_unknown");
    const category = item.manifest.category?.trim()
      || (item.pluginId === "figma" ? t("plugin_platform.category_design_development") : t("plugin_platform.default_category"));

    return (
      <section className="w-full max-w-4xl">
        <div className="pb-7 sm:pb-9">
          <nav className="mb-10 flex items-center gap-2 text-sm" aria-label={t("plugin_platform.breadcrumb_plugins")}>
            <button
              type="button"
              className="rounded-md px-1 py-0.5 text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text"
              onClick={() => props.onSelectPlugin(null)}
            >
              {t("plugin_platform.breadcrumb_plugins")}
            </button>
            <ChevronRight size={15} className="text-dls-secondary/70" />
            <span className="font-medium text-dls-text">{item.name}</span>
          </nav>

          <div className="mb-8">
            <div className="relative mb-5 flex size-16 items-center justify-center overflow-hidden rounded-2xl border border-dls-border bg-dls-surface shadow-sm">
              {iconUrl ? <img src={iconUrl} alt="" className="size-9 object-contain" /> : <Package size={28} className="text-dls-secondary" />}
            </div>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-2xl font-semibold tracking-tight text-dls-text">{item.name}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-dls-secondary">{item.manifest.description}</p>
              </div>
              {item.enabled ? (
                <div className="flex shrink-0 items-center gap-2 rounded-full border border-green-6 bg-green-2 px-3 py-1.5 text-xs font-medium text-green-11">
                  <CheckCircle2 size={15} />
                  {t("plugin_platform.status.installed")}
                </div>
              ) : (
                <Button size="sm" disabled={busyKey !== null} onClick={() => void run(`${item.pluginId}:enable`, async () => {
                  await props.client?.setPluginPackageEnabled(props.workspaceId ?? "", item.pluginId, true);
                  await refresh();
                })}>
                  {busyKey === `${item.pluginId}:enable` ? <Loader2 size={14} className="animate-spin" /> : null}
                  {t("plugin_platform.action.repair")}
                </Button>
              )}
            </div>
          </div>

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

          {(hasFigmaMcp || methods.length > 0) ? (
            <div className="mt-6 rounded-2xl border border-dls-border bg-dls-hover/25 p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-dls-text">
                <KeyRound size={16} />
                {t("plugin_platform.authorization")}
              </div>
              {connected ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-green-6 bg-green-2 px-3 py-2 text-xs text-green-11">
                  <span>{t("plugin_platform.status.connected")}</span>
                  {auth?.connections[0] ? <Button size="sm" variant="ghost" onClick={() => void run(`${item.pluginId}:revoke`, async () => {
                    await props.client?.revokePluginAuthorization(props.workspaceId ?? "", item.pluginId, auth.connections[0]?.accountId ?? "default");
                    await refresh();
                  })}>{t("plugin_platform.revoke")}</Button> : null}
                </div>
              ) : null}
              {methods.length === 0 ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs leading-5 text-dls-secondary">{t("plugin_platform.mcp_authorization_hint")}</p>
                  <Button size="sm" className="shrink-0" disabled={busyKey !== null} onClick={props.onConnectFigma}>
                    <KeyRound size={14} />
                    {t("plugin_platform.connect_figma")}
                  </Button>
                </div>
              ) : (
                <div className={`${connected ? "mt-3 " : ""}space-y-3`}>
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
              )}
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
              <Button size="sm" variant="outline" onClick={() => void run(`${item.pluginId}:toggle`, async () => {
                await props.client?.setPluginPackageEnabled(props.workspaceId ?? "", item.pluginId, !item.enabled);
                await refresh();
              })}>{item.enabled ? t("plugin_platform.disable") : t("plugin_platform.enable")}</Button>
              {item.previousVersion ? <Button size="sm" variant="outline" onClick={() => void run(`${item.pluginId}:rollback`, async () => {
                await props.client?.rollbackPluginPackage(props.workspaceId ?? "", item.pluginId);
                await refresh();
              })}>{t("plugin_platform.rollback")}</Button> : null}
            </div>
          </details>
        </div>
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
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-dls-border bg-dls-surface shadow-sm">
      <div className="flex flex-col gap-3 border-b border-dls-border bg-dls-hover/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border border-dls-border bg-dls-surface text-dls-text">
            <Package size={19} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-dls-text">{t("plugin_platform.title")}</h2>
            <p className="mt-0.5 text-xs text-dls-secondary">
              {t("plugin_platform.summary", { installed: installedCount, connected: connectedCount })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={busyKey !== null} onClick={() => void refresh()}>
            <RefreshCw size={14} />
            {t("common.refresh")}
          </Button>
          <Button size="sm" disabled={busyKey !== null} onClick={() => setImportOpen(true)}>
            <Upload size={14} />
            {t("plugin_platform.import_button")}
          </Button>
        </div>
      </div>

      <div className="divide-y divide-dls-border">
        {availableCatalogItems.map((item) => {
          const iconUrl = resolveExtensionIconUrl({
            iconSrc: item.manifest.icon?.src,
            iconSlug: item.manifest.icon?.simpleIconSlug,
          });
          return <div key={`catalog:${item.pluginId}`} className="flex flex-col gap-4 bg-blue-2/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-blue-6 bg-dls-surface text-blue-11">
                {iconUrl ? <img src={iconUrl} alt="" className="size-5 object-contain" /> : <Sparkles size={18} />}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-dls-text">{item.name}</span>
                  <span className="rounded-full border border-dls-border px-2 py-0.5 font-mono text-[10px] text-dls-secondary">v{item.version}</span>
                  <span className="rounded-full bg-blue-3 px-2 py-0.5 text-[10px] text-blue-11">{t("plugin_platform.official_bundle")}</span>
                </div>
                <p className="mt-1 text-xs text-dls-secondary">{item.manifest.description}</p>
                <p className="mt-1 text-[11px] text-dls-secondary">
                  {t("plugin_platform.bundle_contents", {
                    skills: item.manifest.resources.filter((resource) => resource.type === "skill").length,
                    mcps: item.manifest.resources.filter((resource) => resource.type === "mcp").length,
                  })}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              disabled={busyKey !== null}
              onClick={() => void installBundledPackage(item)}
            >
              {busyKey === `catalog:${item.pluginId}` ? <Loader2 size={14} className="animate-spin" /> : null}
              {item.updateAvailable ? t("plugin_platform.action.update") : t("plugin_platform.action.install")}
            </Button>
          </div>;
        })}
        {items.map((item) => {
          const auth = authorizations[item.pluginId];
          const hasPluginAuthorization = (item.manifest.authorization?.methods?.length ?? 0) > 0;
          const connected = hasPluginAuthorization && auth?.ready === true;
          const primaryAction = derivePluginPrimaryAction({
            installed: true,
            authorizationRequired: auth?.required === true,
            connected,
            updateAvailable: false,
            broken: !item.enabled,
          });
          const iconUrl = resolveExtensionIconUrl({
            iconSrc: item.manifest.icon?.src,
            iconSlug: item.manifest.icon?.simpleIconSlug,
          });
          return (
            <div key={item.pluginId} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
                  {iconUrl ? <img src={iconUrl} alt="" className="size-6 object-contain" /> : <Package size={19} className="text-dls-secondary" />}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-dls-text">{item.name}</span>
                    <span className="text-[11px] text-dls-secondary">v{item.version}</span>
                    {!item.enabled ? <span className="rounded-full bg-amber-3 px-2 py-0.5 text-[10px] text-amber-11">{t("plugin_platform.status.disabled")}</span> : null}
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-dls-secondary">{item.manifest.description}</p>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-dls-secondary">
                    {connected || !hasPluginAuthorization ? <CheckCircle2 size={13} className="text-green-9" /> : <KeyRound size={13} className="text-amber-9" />}
                    <span>{statusText(auth, hasPluginAuthorization)}</span>
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                className="shrink-0"
                disabled={busyKey !== null}
                onClick={() => {
                  if (primaryAction.kind === "repair") {
                    void run(`${item.pluginId}:enable`, async () => {
                      await props.client?.setPluginPackageEnabled(props.workspaceId ?? "", item.pluginId, true);
                      await refresh();
                    });
                    return;
                  }
                  props.onSelectPlugin(item.pluginId);
                }}
              >
                {t(primaryAction.labelKey)}
              </Button>
            </div>
          );
        })}

        {items.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <Package size={24} className="mx-auto text-dls-secondary/60" />
            <p className="mt-2 text-sm font-medium text-dls-text">{t("plugin_platform.empty_title")}</p>
            <p className="mt-1 text-xs text-dls-secondary">{t("plugin_platform.empty_description")}</p>
          </div>
        ) : null}
      </div>

      {error ? <div role="alert" className="border-t border-red-6 bg-red-2 px-5 py-3 text-xs text-red-11">{error}</div> : null}
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
