/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Package, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type {
  iPolloWorkPluginAuthorizationFlow,
  iPolloWorkPluginAuthorizationState,
  iPolloWorkBundledPluginPackageItem,
  iPolloWorkPluginPackageItem,
  iPolloWorkPluginPackagePreview,
  iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import type { iPolloWorkPluginAuthorizationMethod } from "@/app/extensions";
import { derivePluginPrimaryAction, enqueuePluginFieldValue, formatPluginPlatformError } from "./plugin-platform-state";

type PluginPackagesPanelProps = {
  client: iPolloWorkServerClient | null;
  workspaceId: string | null;
  onOpenUrl: (url: string) => void;
  onConnectFigma: () => void;
};

function methodKey(pluginId: string, methodId: string, fieldId: string) {
  return `${pluginId}\u0000${methodId}\u0000${fieldId}`;
}

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
  const [packageRoot, setPackageRoot] = useState("");
  const [preview, setPreview] = useState<iPolloWorkPluginPackagePreview | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [flows, setFlows] = useState<Record<string, iPolloWorkPluginAuthorizationFlow>>({});

  const refresh = useCallback(async () => {
    if (!props.client || !props.workspaceId) {
      setItems([]);
      setCatalogItems([]);
      setAuthorizations({});
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

  const run = useCallback(async (key: string, operation: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(formatPluginPlatformError(cause, t("plugin_platform.error.operation")));
    } finally {
      setBusyKey(null);
    }
  }, []);

  const validateLocalPackage = () => run("validate", async () => {
    if (!props.client || !props.workspaceId || !packageRoot.trim()) return;
    const result = await props.client.validatePluginPackage(props.workspaceId, packageRoot.trim());
    setPreview(result.preview);
  });

  const installLocalPackage = () => run("install", async () => {
    if (!props.client || !props.workspaceId || !packageRoot.trim()) return;
    const installed = preview ? items.find((item) => item.pluginId === preview.manifest.id) : undefined;
    if (installed) await props.client.updatePluginPackage(props.workspaceId, installed.pluginId, packageRoot.trim());
    else await props.client.installPluginPackage(props.workspaceId, packageRoot.trim());
    setPreview(null);
    setPackageRoot("");
    await refresh();
  });

  const installBundledPackage = (item: iPolloWorkBundledPluginPackageItem) => run(`catalog:${item.pluginId}`, async () => {
    if (!props.client || !props.workspaceId) return;
    await props.client.installBundledPluginPackage(props.workspaceId, item.pluginId);
    await refresh();
  });

  const saveSecret = (item: iPolloWorkPluginPackageItem, method: Extract<iPolloWorkPluginAuthorizationMethod, { kind: "secret-form" }>) => run(`${item.pluginId}:${method.id}`, async () => {
    if (!props.client || !props.workspaceId) return;
    const fieldValues = Object.fromEntries(method.fields.map((field) => [field.id, values[methodKey(item.pluginId, method.id, field.id)] ?? ""]));
    await props.client.savePluginAuthorization(props.workspaceId, item.pluginId, method.id, fieldValues);
    await refresh();
  });

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
        <Button size="sm" variant="outline" disabled={busyKey !== null} onClick={() => void refresh()}>
          <RefreshCw size={14} />
          {t("common.refresh")}
        </Button>
      </div>

      <div className="divide-y divide-dls-border">
        {availableCatalogItems.map((item) => (
          <div key={`catalog:${item.pluginId}`} className="flex flex-col gap-4 bg-blue-2/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-blue-6 bg-dls-surface text-blue-11">
                <Sparkles size={18} />
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
          </div>
        ))}
        {items.map((item) => {
          const auth = authorizations[item.pluginId];
          const methods = item.manifest.authorization?.methods ?? [];
          const hasPluginAuthorization = methods.length > 0;
          const connected = hasPluginAuthorization && auth?.ready === true;
          const hasFigmaMcp = item.manifest.resources.some((resource) =>
            resource.type === "mcp" && resource.mcpServerName === "figma"
          );
          const flow = flows[item.pluginId];
          const primaryAction = derivePluginPrimaryAction({
            installed: true,
            authorizationRequired: auth?.required === true,
            connected,
            updateAvailable: false,
            broken: !item.enabled,
          });
          return (
            <details key={item.pluginId} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-dls-text">{item.name}</span>
                    <span className="rounded-full border border-dls-border px-2 py-0.5 font-mono text-[10px] text-dls-secondary">v{item.version}</span>
                    {!item.enabled ? <span className="rounded-full bg-amber-3 px-2 py-0.5 text-[10px] text-amber-11">{t("plugin_platform.status.disabled")}</span> : null}
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-dls-secondary">{item.manifest.description}</p>
                  <p className="mt-1 text-[11px] text-dls-secondary">
                    {item.manifest.package?.publisher?.name ?? item.manifest.source.reference ?? item.manifest.source.origin ?? t("plugin_platform.publisher_unknown")}
                    {" · "}{item.integrity.status === "verified" ? t("plugin_platform.integrity_verified") : t("plugin_platform.integrity_unsigned")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  {connected || !hasPluginAuthorization ? <CheckCircle2 size={15} className="text-green-9" /> : <KeyRound size={15} className="text-amber-9" />}
                  <span className={connected || !hasPluginAuthorization ? "text-green-11" : "text-dls-secondary"}>{statusText(auth, hasPluginAuthorization)}</span>
                  <Button
                    size="sm"
                    disabled={busyKey !== null}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (primaryAction.kind === "repair") {
                        void run(`${item.pluginId}:enable`, async () => {
                          await props.client?.setPluginPackageEnabled(props.workspaceId ?? "", item.pluginId, true);
                          await refresh();
                        });
                        return;
                      }
                      const details = event.currentTarget.closest("details");
                      if (details) details.open = true;
                    }}
                  >
                    {t(primaryAction.labelKey)}
                  </Button>
                </div>
              </summary>

              <div className="mt-4 grid gap-4 border-t border-dls-border pt-4 lg:grid-cols-[1fr_1.2fr]">
                <div className="space-y-4">
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-dls-text"><ShieldCheck size={14} />{t("plugin_platform.included")}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {item.manifest.resources.map((resource) => (
                        <span key={resource.id} className="rounded-full border border-dls-border bg-dls-hover px-2 py-1 text-[11px] text-dls-secondary">
                          {resource.label ?? resource.id} · {resource.type}
                        </span>
                      ))}
                    </div>
                  </div>
                  {(item.manifest.permissions?.length ?? 0) > 0 ? (
                    <div>
                      <div className="mb-2 text-xs font-semibold text-dls-text">{t("plugin_platform.permissions")}</div>
                      <ul className="space-y-1.5 text-xs text-dls-secondary">
                        {item.manifest.permissions?.map((permission) => <li key={permission.id}>• {permission.reason}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  <details className="rounded-xl border border-dls-border px-3 py-2">
                    <summary className="cursor-pointer text-xs font-medium text-dls-secondary">{t("plugin_platform.advanced")}</summary>
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
                      <Button size="sm" variant="destructive" onClick={() => void run(`${item.pluginId}:remove`, async () => {
                        await props.client?.uninstallPluginPackage(props.workspaceId ?? "", item.pluginId);
                        await refresh();
                      })}>{t("plugin_platform.uninstall")}</Button>
                    </div>
                  </details>
                </div>

                <div className="rounded-xl border border-dls-border bg-dls-hover/30 p-4">
                  <div className="mb-3 text-xs font-semibold text-dls-text">{t("plugin_platform.authorization")}</div>
                  {connected ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-green-6 bg-green-2 px-3 py-2 text-xs text-green-11">
                      <span>{t("plugin_platform.status.connected")}</span>
                      {auth?.connections[0] ? <Button size="sm" variant="ghost" onClick={() => void run(`${item.pluginId}:revoke`, async () => {
                        await props.client?.revokePluginAuthorization(props.workspaceId ?? "", item.pluginId, auth.connections[0]?.accountId ?? "default");
                        await refresh();
                      })}>{t("plugin_platform.revoke")}</Button> : null}
                    </div>
                  ) : methods.length === 0 ? (
                    <div className="space-y-3">
                      <p className="text-xs text-dls-secondary">
                        {hasFigmaMcp ? t("plugin_platform.mcp_authorization_hint") : t("plugin_platform.no_authorization")}
                      </p>
                      {hasFigmaMcp ? (
                        <Button size="sm" disabled={busyKey !== null} onClick={props.onConnectFigma}>
                          <KeyRound size={14} />
                          {t("plugin_platform.connect_figma")}
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {methods.map((method) => (
                        <div key={method.id} className="rounded-lg border border-dls-border bg-dls-surface p-3">
                          <div className="text-xs font-semibold text-dls-text">{method.label}</div>
                          {method.description ? <p className="mt-1 text-xs text-dls-secondary">{method.description}</p> : null}
                          {method.kind === "secret-form" ? (
                            <div className="mt-3 space-y-2">
                              {method.fields.map((field) => (
                                <label key={field.id} className="block text-xs text-dls-secondary">
                                  <span className="mb-1 block">{field.label}</span>
                                  <input
                                    type={field.secret === false ? "text" : "password"}
                                    value={values[methodKey(item.pluginId, method.id, field.id)] ?? ""}
                                    placeholder={field.placeholder}
                                    onChange={(event) => enqueuePluginFieldValue(
                                      setValues,
                                      methodKey(item.pluginId, method.id, field.id),
                                      event.currentTarget.value,
                                    )}
                                    className="h-9 w-full rounded-lg border border-dls-border bg-dls-surface px-3 text-sm text-dls-text outline-none transition focus:border-blue-8 focus:ring-2 focus:ring-blue-5/30"
                                  />
                                </label>
                              ))}
                              <Button size="sm" disabled={busyKey === `${item.pluginId}:${method.id}`} onClick={() => void saveSecret(item, method)}>
                                {busyKey === `${item.pluginId}:${method.id}` ? <Loader2 size={14} className="animate-spin" /> : null}
                                {t("plugin_platform.connect")}
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
              </div>
            </details>
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

      <details className="border-t border-dls-border bg-dls-hover/20 px-5 py-3">
        <summary className="cursor-pointer text-xs font-medium text-dls-secondary">{t("plugin_platform.developer_install")}</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input
            value={packageRoot}
            onChange={(event) => { setPackageRoot(event.currentTarget.value); setPreview(null); }}
            placeholder={t("plugin_platform.package_root_placeholder")}
            className="h-9 rounded-lg border border-dls-border bg-dls-surface px-3 font-mono text-xs text-dls-text outline-none transition focus:border-blue-8 focus:ring-2 focus:ring-blue-5/30"
          />
          <Button size="sm" variant="outline" disabled={!packageRoot.trim() || busyKey !== null} onClick={() => void validateLocalPackage()}>{t("plugin_platform.validate")}</Button>
          <Button size="sm" disabled={!preview || busyKey !== null} onClick={() => void installLocalPackage()}>
            {preview && items.some((item) => item.pluginId === preview.manifest.id) ? t("plugin_platform.action.update") : t("plugin_platform.action.install")}
          </Button>
        </div>
        {preview ? <p className="mt-2 text-xs text-green-11">{t("plugin_platform.validation_ready", { name: preview.manifest.name, version: preview.manifest.package?.version ?? "" })}</p> : null}
      </details>

      {error ? <div role="alert" className="border-t border-red-6 bg-red-2 px-5 py-3 text-xs text-red-11">{error}</div> : null}
    </section>
  );
}
