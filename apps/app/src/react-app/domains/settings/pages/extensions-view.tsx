/** @jsxImportSource react */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Building2, Cpu, Loader2, Package, RefreshCw } from "lucide-react";

import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { readActiveWorkContextId, type WorkContextId } from "@/app/lib/work-context";
import {
  downloadEnterpriseResource,
  listEnterpriseResources,
  type EnterpriseResource,
} from "@/app/lib/enterprise-connections";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { useActiveEnterpriseConnection } from "@/react-app/domains/enterprise/use-active-enterprise-connection";
import { WorkResourceScopeSwitch } from "@/react-app/domains/enterprise/work-resource-scope-switch";
import { readPluginPackageArchive } from "@/react-app/domains/settings/plugin-package-archive";

import { PluginsView, type PluginsExtensionsStore } from "./plugins-view";

export type ExtensionsSection = "all" | "mcp" | "skills" | "plugins";

type SuggestedPlugin = {
  name: string;
  packageName: string;
  description: string;
  tags: string[];
  aliases?: string[];
  installMode?: "simple" | "guided";
  steps?: Array<{
    title: string;
    description: string;
    command?: string;
    url?: string;
    path?: string;
    note?: string;
  }>;
};

export type ExtensionsViewProps = {
  busy: boolean;
  selectedWorkspaceRoot: string;
  canEditPlugins: boolean;
  canUseGlobalScope: boolean;
  accessHint?: string | null;
  suggestedPlugins: SuggestedPlugin[];
  extensions: PluginsExtensionsStore;
  client: iPolloWorkServerClient | null;
  workspaceId: string | null;
  pluginPackagesView: ReactNode;
  skillsView: ReactNode;
  activeTab: "plugins" | "skills";
};

export function ExtensionsView(props: ExtensionsViewProps) {
  const activeEnterprise = useActiveEnterpriseConnection();
  const [resourceScope, setResourceScope] = useState<WorkContextId>(() => readActiveWorkContextId());
  const [enterpriseResources, setEnterpriseResources] = useState<EnterpriseResource[]>([]);
  const [installedEnterpriseExtensionVersions, setInstalledEnterpriseExtensionVersions] = useState<Map<string, string>>(new Map());
  const [enterpriseLoading, setEnterpriseLoading] = useState(false);
  const [enterpriseError, setEnterpriseError] = useState<string | null>(null);
  const [enterpriseBusyId, setEnterpriseBusyId] = useState<string | null>(null);
  const [enterpriseRefreshRevision, setEnterpriseRefreshRevision] = useState(0);
  const pluginCount = useMemo(() => props.extensions.pluginList().length, [props.extensions]);

  useEffect(() => {
    setResourceScope(readActiveWorkContextId());
  }, [activeEnterprise?.id]);

  useEffect(() => {
    if (!activeEnterprise || resourceScope === "personal") {
      setEnterpriseResources([]);
      setInstalledEnterpriseExtensionVersions(new Map());
      setEnterpriseError(null);
      return;
    }
    let current = true;
    setEnterpriseLoading(true);
    setEnterpriseResources([]);
    setInstalledEnterpriseExtensionVersions(new Map());
    setEnterpriseError(null);
    const installedPackages = props.client && props.workspaceId
      ? props.client.listPluginPackages(props.workspaceId).catch(() => ({ items: [] }))
      : Promise.resolve({ items: [] });
    void Promise.all([
      listEnterpriseResources("extension"),
      installedPackages,
    ]).then(([items, packages]) => {
      if (!current) return;
      setEnterpriseResources(items);
      setInstalledEnterpriseExtensionVersions(new Map(packages.items.map((item) => [item.pluginId, item.version])));
    }).catch(() => {
      if (current) setEnterpriseError(t("enterprise_connection.enterprise_resources_error"));
    }).finally(() => {
      if (current) setEnterpriseLoading(false);
    });
    return () => { current = false; };
  }, [activeEnterprise, enterpriseRefreshRevision, props.client, props.workspaceId, resourceScope]);

  const installEnterpriseExtension = async (resource: EnterpriseResource) => {
    if (!activeEnterprise || !props.client || !props.workspaceId || !resource.latestVersion) return;
    setEnterpriseBusyId(resource.id);
    try {
      const file = await downloadEnterpriseResource(resource);
      const upload = await readPluginPackageArchive(file);
      await props.client.validatePluginPackageUpload(props.workspaceId, upload);
      const result = await props.client.importPluginPackage(props.workspaceId, upload);
      setInstalledEnterpriseExtensionVersions((versions) => new Map(versions).set(result.result.pluginId, result.result.version));
      toast.success(`${resource.name} v${result.result.version}`);
      await props.extensions.refreshPlugins();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message === "desktop_binary_fetch_requires_restart"
        ? t("enterprise_connection.desktop_restart_required")
        : message || t("enterprise_connection.enterprise_resources_error"));
    } finally {
      setEnterpriseBusyId(null);
    }
  };

  return (
    <section className="mx-auto w-full max-w-[1280px] animate-in space-y-5 fade-in duration-300">
      {activeEnterprise ? (
        <div className="flex justify-end">
          <div className="flex items-center gap-2">
            <WorkResourceScopeSwitch enterprise={activeEnterprise} value={resourceScope} onChange={setResourceScope} />
            {resourceScope !== "personal" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("common.refresh")}
                title={t("common.refresh")}
                onClick={() => setEnterpriseRefreshRevision((revision) => revision + 1)}
              >
                <RefreshCw size={15} />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {resourceScope !== "personal" ? (
        enterpriseLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-36 animate-pulse rounded-2xl bg-dls-hover" />)}
          </div>
        ) : enterpriseError ? (
          <div role="alert" className="rounded-xl border border-red-6 bg-red-2 px-4 py-3 text-sm text-red-11">{enterpriseError}</div>
        ) : enterpriseResources.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {enterpriseResources.map((resource) => {
              const installedVersion = installedEnterpriseExtensionVersions.get(resource.manifestId ?? resource.slug);
              const currentVersionInstalled = Boolean(installedVersion && installedVersion === resource.latestVersion?.version);
              const actionLabel = currentVersionInstalled
                ? t("plugin_platform.status.installed")
                : installedVersion ? t("template_market.update") : t("enterprise_connection.install_from_enterprise");
              return (
                <article key={resource.id} className="rounded-2xl border border-dls-border bg-dls-surface p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Package size={17} /></div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-dls-text">{resource.name}</h3>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-dls-secondary">{resource.description}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="truncate text-[11px] text-dls-secondary">{resource.enterpriseCategory}{resource.latestVersion ? ` · v${resource.latestVersion.version}` : ""}</span>
                    <Button variant={currentVersionInstalled ? "outline" : "default"} size="sm" disabled={currentVersionInstalled || !resource.latestVersion || enterpriseBusyId !== null || !props.client || !props.workspaceId} onClick={() => void installEnterpriseExtension(resource)}>
                      {enterpriseBusyId === resource.id ? <Loader2 size={14} className="animate-spin" /> : null}{actionLabel}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-dls-border px-5 py-10 text-center text-sm text-dls-secondary">
            <Building2 className="mx-auto mb-3 size-5" />{t("enterprise_connection.enterprise_extensions_empty")}
          </div>
        )
      ) : props.activeTab === "skills" ? props.skillsView : (
        <div className="space-y-8">
          {props.pluginPackagesView}
          {pluginCount > 0 ? (
            <details className="group border-t border-dls-border pt-5">
              <summary className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-2 text-sm font-medium text-dls-secondary transition-colors hover:text-dls-text">
                <Cpu size={14} />
                <span>{t("settings.extensions.opencode_plugins")}</span>
                <span className="text-[11px] text-dls-secondary">({pluginCount})</span>
              </summary>
              <div className="mt-3">
                <PluginsView
                  extensions={props.extensions}
                  busy={props.busy}
                  selectedWorkspaceRoot={props.selectedWorkspaceRoot}
                  canEditPlugins={props.canEditPlugins}
                  canUseGlobalScope={props.canUseGlobalScope}
                  accessHint={props.accessHint}
                  suggestedPlugins={props.suggestedPlugins}
                />
              </div>
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
}
