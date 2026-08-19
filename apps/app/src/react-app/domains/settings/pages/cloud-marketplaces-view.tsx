/** @jsxImportSource react */
import * as React from "react";
import { Cloud, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

import type { iPolloWorkExtensionManifest } from "@/app/extensions";
import {
  downloadEnterpriseResource,
  listEnterpriseResources,
  type EnterpriseResource,
} from "@/app/lib/enterprise-connections";
import type { iPolloWorkPluginPackageItem, iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useCloudSession } from "@/react-app/domains/settings/cloud/cloud-session-provider";
import { PluginPackageDetail } from "@/react-app/domains/settings/plugin-package-detail";
import { PluginPackageListItem } from "@/react-app/domains/settings/plugin-package-list-item";
import { readPluginPackageArchive } from "@/app/lib/plugin-package-archive";
import { formatPluginPlatformError } from "@/react-app/domains/settings/plugin-platform-state";
import { SettingsListEmptyState, SettingsListSearchInput } from "@/react-app/domains/settings/settings-list";
import { SettingsNotice, SettingsPill } from "@/react-app/domains/settings/settings-section";
import { notifyPluginUiContributionsChanged } from "@/react-app/plugin-ui/plugin-ui-contributions";

export const MARKETPLACE_CATEGORY_IDS = [
  "ai-agents",
  "development-operations",
  "design-creative",
  "productivity-collaboration",
  "business-operations",
  "finance",
  "other",
] as const;

export type MarketplaceCategoryId = typeof MARKETPLACE_CATEGORY_IDS[number];

const categoryKeywords: Record<Exclude<MarketplaceCategoryId, "other">, string[]> = {
  "ai-agents": ["ai agent", "agent", "automation", "智能体", "代理", "自动化"],
  "development-operations": ["developer", "development", "devops", "observability", "engineering", "开发", "运维", "可观测", "工程"],
  "design-creative": ["design", "creative", "设计", "创作"],
  "productivity-collaboration": ["productivity", "collaboration", "knowledge", "project", "效率", "协作", "知识", "项目"],
  "business-operations": ["business", "operations", "marketing", "content", "sales", "商业", "运营", "内容", "销售"],
  finance: ["finance", "financial", "payment", "billing", "金融", "财务", "支付", "账单"],
};

const agentPluginIds = new Set(["deepseek-harness", "design-agent", "video-agent"]);
const categoryResolutionOrder: Exclude<MarketplaceCategoryId, "other">[] = [
  "ai-agents",
  "productivity-collaboration",
  "design-creative",
  "finance",
  "business-operations",
  "development-operations",
];

export type CloudMarketplacesViewProps = {
  client: iPolloWorkServerClient | null;
  workspaceId: string | null;
  onOpenAccount: () => void;
  onInstalled?: (pluginId: string) => void | Promise<void>;
  onOpenInstalled?: (pluginId: string) => void;
  embedded?: boolean;
  search?: string;
};

export function shouldShowMarketplaceRows(isSignedIn: boolean): boolean {
  return isSignedIn;
}

export function resolveMarketplaceCategory(item: {
  pluginId: string;
  category: string;
  manifest: { category?: string };
}): MarketplaceCategoryId {
  if (agentPluginIds.has(item.pluginId)) return "ai-agents";
  const category = `${item.category} ${item.manifest.category ?? ""}`.trim().toLocaleLowerCase();
  for (const categoryId of categoryResolutionOrder) {
    if (category === categoryId || categoryKeywords[categoryId].some((keyword) => category.includes(keyword))) {
      return categoryId;
    }
  }
  return "other";
}

function categoryLabel(categoryId: MarketplaceCategoryId): string {
  return t(`plugin_library.category.${categoryId}`);
}

function resourcePluginId(resource: EnterpriseResource): string {
  return resource.manifestId ?? resource.slug;
}

function resourceManifest(resource: EnterpriseResource): iPolloWorkExtensionManifest {
  return {
    schemaVersion: 2,
    id: resourcePluginId(resource),
    name: resource.name,
    description: resource.description,
    category: resource.category,
    source: {
      format: "ipollowork-extension-manifest",
      trusted: true,
      origin: "den",
      reference: resource.id,
    },
    resources: [],
  };
}

function actionLabel(resource: EnterpriseResource, installed: iPolloWorkPluginPackageItem | undefined) {
  if (installed?.version === resource.latestVersion?.version) return t("settings.marketplace.installed");
  if (installed) return t("plugin_platform.action.update");
  return t("plugin_platform.action.install");
}

export function CloudMarketplacesView({
  client,
  workspaceId,
  onOpenAccount,
  onInstalled,
  onOpenInstalled,
  embedded = false,
  search: controlledSearch,
}: CloudMarketplacesViewProps) {
  const cloud = useCloudSession();
  const [items, setItems] = React.useState<EnterpriseResource[]>([]);
  const [installed, setInstalled] = React.useState<Record<string, iPolloWorkPluginPackageItem>>({});
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [localSearch, setLocalSearch] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const search = controlledSearch ?? localSearch;

  const refresh = React.useCallback(async () => {
    if (!cloud.isSignedIn) {
      setItems([]);
      setInstalled({});
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [marketplaceResult, localPackagesResult] = await Promise.allSettled([
        listEnterpriseResources("extension"),
        client && workspaceId ? client.listPluginPackages(workspaceId) : Promise.resolve({ items: [] }),
      ]);
      if (marketplaceResult.status === "rejected") throw marketplaceResult.reason;
      setItems(marketplaceResult.value);
      if (localPackagesResult.status === "fulfilled") {
        setInstalled(Object.fromEntries(localPackagesResult.value.items.map((item) => [item.pluginId, item])));
      } else {
        setInstalled({});
        setError(formatPluginPlatformError(localPackagesResult.reason, t("plugin_platform.error.load")));
      }
    } catch (cause) {
      setError(formatPluginPlatformError(cause, t("settings.marketplace.load_failed")));
    } finally {
      setLoading(false);
    }
  }, [client, cloud.isSignedIn, workspaceId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = React.useCallback(async (resource: EnterpriseResource) => {
    const pluginId = resourcePluginId(resource);
    if (!client || !workspaceId || !resource.latestVersion || installed[pluginId]?.version === resource.latestVersion.version) return;
    setBusyId(resource.id);
    setError(null);
    try {
      const file = await downloadEnterpriseResource(resource);
      const upload = await readPluginPackageArchive(file, "install");
      await client.validatePluginPackageUpload(workspaceId, upload);
      await client.importPluginPackage(workspaceId, upload);
      await refresh();
      notifyPluginUiContributionsChanged();
      await onInstalled?.(pluginId);
    } catch (cause) {
      setError(formatPluginPlatformError(cause, t("settings.marketplace.install_failed")));
    } finally {
      setBusyId(null);
    }
  }, [client, installed, onInstalled, refresh, workspaceId]);

  const filteredItems = React.useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return items;
    return items.filter((item) => [item.name, item.description, item.enterpriseCategory, item.category]
      .some((value) => value.toLocaleLowerCase().includes(query)));
  }, [items, search]);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const featuredItems = filteredItems.filter((item) => item.featured);
  const categorySections = MARKETPLACE_CATEGORY_IDS.map((categoryId) => ({
    categoryId,
    items: filteredItems.filter((item) => !item.featured && resolveMarketplaceCategory({
      pluginId: resourcePluginId(item),
      category: item.category,
      manifest: {},
    }) === categoryId),
  })).filter((section) => section.items.length > 0);

  if (!shouldShowMarketplaceRows(cloud.isSignedIn)) {
    return (
      <div className="flex min-h-72 items-center justify-center px-6 py-12">
        <div className="max-w-sm text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-dls-border bg-dls-hover text-dls-text"><Cloud size={22} /></span>
          <h3 className="mt-4 text-sm font-semibold text-dls-text">{t("settings.marketplace.signin_title")}</h3>
          <p className="mt-2 text-xs leading-5 text-dls-secondary">{t("settings.marketplace.signin_hint")}</p>
          <Button className="mt-5" onClick={onOpenAccount}>{t("den.signin_button")}</Button>
        </div>
      </div>
    );
  }

  if (selected) {
    const pluginId = resourcePluginId(selected);
    const localPackage = installed[pluginId];
    return (
      <PluginPackageDetail
        name={selected.name}
        description={selected.description}
        onBack={() => setSelectedId(null)}
        action={(
          <Button disabled={!client || !workspaceId || !selected.latestVersion || busyId !== null || localPackage?.version === selected.latestVersion.version} onClick={() => void install(selected)}>
            {busyId === selected.id ? <Loader2 size={14} className="animate-spin" /> : null}
            {actionLabel(selected, localPackage)}
          </Button>
        )}
      >
        <div className="mb-6 flex flex-wrap gap-2">
          {selected.latestVersion ? <SettingsPill>v{selected.latestVersion.version}</SettingsPill> : null}
          <SettingsPill>{selected.enterpriseCategory}</SettingsPill>
          <SettingsPill>{t("settings.marketplace.free")}</SettingsPill>
        </div>
        <div className="border-t border-dls-border pt-6">
          <div className="max-w-sm space-y-3 rounded-xl border border-dls-border bg-dls-hover/30 p-4 text-xs text-dls-secondary">
            <div className="flex items-center gap-2 font-semibold text-dls-text"><ShieldCheck size={15} />{t("settings.marketplace.package_info")}</div>
            <div className="flex justify-between gap-3"><span>ID</span><span className="truncate">{pluginId}</span></div>
            <div className="flex justify-between gap-3"><span>{t("plugin_library.category.other")}</span><span>{selected.category}</span></div>
            {selected.latestVersion ? <div className="break-all font-mono text-[10px]">{selected.latestVersion.digest}</div> : null}
          </div>
        </div>
        {error ? <div role="alert" className="rounded-xl border border-red-6 bg-red-2 px-5 py-3 text-xs text-red-11">{error}</div> : null}
      </PluginPackageDetail>
    );
  }

  return (
    <section className="space-y-7">
      {!embedded ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-dls-text">{t("extensions.marketplace_title")}</h1>
              <p className="mt-1 text-sm text-dls-secondary">{t("extensions.marketplace_description")}</p>
            </div>
            <Button size="sm" variant="outline" disabled={loading || busyId !== null} onClick={() => void refresh()}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />{t("common.refresh")}
            </Button>
          </div>
          <SettingsListSearchInput value={localSearch} onChange={(event) => setLocalSearch(event.currentTarget.value)} placeholder={t("settings.marketplace.search")} />
        </>
      ) : null}

      {loading && items.length === 0 ? <SettingsNotice>{t("settings.marketplace.loading")}</SettingsNotice> : null}
      {!loading && filteredItems.length === 0 ? <SettingsListEmptyState>{search ? t("settings.marketplace.no_match") : t("settings.marketplace.empty")}</SettingsListEmptyState> : null}

      {featuredItems.length > 0 ? (
        <MarketplaceSection
          title={t("plugin_library.featured")}
          items={featuredItems}
          installed={installed}
          busyId={busyId}
          client={client}
          workspaceId={workspaceId}
          onOpen={setSelectedId}
          onOpenInstalled={onOpenInstalled}
          onInstall={install}
        />
      ) : null}

      {categorySections.map((section) => (
        <MarketplaceSection
          key={section.categoryId}
          title={categoryLabel(section.categoryId)}
          items={section.items}
          installed={installed}
          busyId={busyId}
          client={client}
          workspaceId={workspaceId}
          onOpen={setSelectedId}
          onOpenInstalled={onOpenInstalled}
          onInstall={install}
        />
      ))}

      {error ? <div role="alert" className="rounded-xl border border-red-6 bg-red-2 px-5 py-3 text-xs text-red-11">{error}</div> : null}
    </section>
  );
}

type MarketplaceSectionProps = {
  title: string;
  items: EnterpriseResource[];
  installed: Record<string, iPolloWorkPluginPackageItem>;
  busyId: string | null;
  client: iPolloWorkServerClient | null;
  workspaceId: string | null;
  onOpen: (resourceId: string) => void;
  onOpenInstalled?: (pluginId: string) => void;
  onInstall: (item: EnterpriseResource) => Promise<void>;
};

function MarketplaceSection(props: MarketplaceSectionProps) {
  return (
    <section>
      <h2 className="border-b border-dls-border pb-2 text-sm font-semibold text-dls-text">{props.title}</h2>
      <div className="grid gap-x-8 lg:grid-cols-2">
        {props.items.map((item) => {
          const pluginId = resourcePluginId(item);
          const localPackage = props.installed[pluginId];
          const manifest = resourceManifest(item);
          return (
            <PluginPackageListItem
              key={item.id}
              manifest={manifest}
              version={item.latestVersion?.version ?? "-"}
              compact
              featured={item.featured}
              status={localPackage ? (localPackage.version === item.latestVersion?.version ? t("settings.marketplace.installed") : t("extensions.update_available")) : item.enterpriseCategory}
              actionBusy={props.busyId === item.id}
              actionDisabled={!props.client || !props.workspaceId || !item.latestVersion || props.busyId !== null || localPackage?.version === item.latestVersion.version}
              actionLabel={<>{props.busyId === item.id ? <Loader2 size={14} className="animate-spin" /> : null}{actionLabel(item, localPackage)}</>}
              onOpen={() => localPackage && props.onOpenInstalled
                ? props.onOpenInstalled(pluginId)
                : props.onOpen(item.id)}
              onAction={() => void props.onInstall(item)}
            />
          );
        })}
      </div>
    </section>
  );
}
