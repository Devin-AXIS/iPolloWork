/** @jsxImportSource react */
import * as React from "react";
import { ChevronLeft, Cloud, Loader2, Package, RefreshCw, ShieldCheck } from "lucide-react";

import type { DenMarketplacePlugin } from "@/app/lib/den";
import type { iPolloWorkPluginPackageItem, iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { currentLocale, t } from "@/i18n";
import { resolveExtensionIconUrl } from "@/react-app/design-system/extension-icon-src";
import { useCloudSession } from "@/react-app/domains/settings/cloud/cloud-session-provider";
import { PluginPackageListItem } from "@/react-app/domains/settings/plugin-package-list-item";
import { readPluginPackageArchive } from "@/react-app/domains/settings/plugin-package-archive";
import { formatPluginPlatformError, localizePluginPackageManifest } from "@/react-app/domains/settings/plugin-platform-state";
import { SettingsListEmptyState, SettingsListSearchInput } from "@/react-app/domains/settings/settings-list";
import { SettingsNotice, SettingsPill } from "@/react-app/domains/settings/settings-section";

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

function archiveBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", archiveBuffer(bytes));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function actionLabel(item: DenMarketplacePlugin, installed: iPolloWorkPluginPackageItem | undefined) {
  if (installed?.version === item.version) return t("settings.marketplace.installed");
  if (installed) return t("plugin_platform.action.update");
  if (item.pointsCost > 0 && !item.acquired) {
    return t("settings.marketplace.buy_install", { points: item.pointsCost });
  }
  return t("plugin_platform.action.install");
}

export function CloudMarketplacesView({
  client,
  workspaceId,
  onOpenAccount,
  onInstalled,
  embedded = false,
  search: controlledSearch,
}: CloudMarketplacesViewProps) {
  const locale = currentLocale();
  const cloud = useCloudSession();
  const [items, setItems] = React.useState<DenMarketplacePlugin[]>([]);
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
      const [marketplaceItems, localPackages] = await Promise.all([
        cloud.client.listMarketplacePlugins(),
        client && workspaceId ? client.listPluginPackages(workspaceId) : Promise.resolve({ items: [] }),
      ]);
      setItems(marketplaceItems);
      setInstalled(Object.fromEntries(localPackages.items.map((item) => [item.pluginId, item])));
    } catch (cause) {
      setError(formatPluginPlatformError(cause, t("settings.marketplace.load_failed")));
    } finally {
      setLoading(false);
    }
  }, [client, cloud.client, cloud.isSignedIn, workspaceId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = React.useCallback(async (item: DenMarketplacePlugin) => {
    if (!client || !workspaceId || installed[item.pluginId]?.version === item.version) return;
    setBusyId(item.pluginId);
    setError(null);
    try {
      await cloud.client.acquireMarketplacePlugin(item.pluginId);
      const download = await cloud.client.downloadMarketplacePlugin(item.pluginId);
      if (download.digest && await sha256Hex(download.bytes) !== download.digest.toLowerCase()) {
        throw new Error(t("settings.marketplace.digest_mismatch"));
      }
      const file = new File([archiveBuffer(download.bytes)], download.fileName, { type: "application/zip" });
      const upload = await readPluginPackageArchive(file);
      await client.validatePluginPackageUpload(workspaceId, upload);
      await client.importPluginPackage(workspaceId, upload);
      await refresh();
      await onInstalled?.(item.pluginId);
    } catch (cause) {
      setError(formatPluginPlatformError(cause, t("settings.marketplace.install_failed")));
    } finally {
      setBusyId(null);
    }
  }, [client, cloud.client, installed, onInstalled, refresh, workspaceId]);

  const localizedItems = React.useMemo(() => items.map((item) => ({
    ...item,
    manifest: localizePluginPackageManifest(item.manifest, locale),
  })), [items, locale]);
  const filteredItems = React.useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return localizedItems;
    return localizedItems.filter((item) => [item.manifest.name, item.manifest.description, item.publisher, item.category]
      .some((value) => value.toLocaleLowerCase().includes(query)));
  }, [localizedItems, search]);
  const selected = localizedItems.find((item) => item.pluginId === selectedId) ?? null;
  const featuredItems = filteredItems.filter((item) => item.featured);
  const categorySections = MARKETPLACE_CATEGORY_IDS.map((categoryId) => ({
    categoryId,
    items: filteredItems.filter((item) => !item.featured && resolveMarketplaceCategory(item) === categoryId),
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
    const manifest = selected.manifest;
    const iconUrl = resolveExtensionIconUrl({ iconSrc: manifest.icon?.src, iconSlug: manifest.icon?.simpleIconSlug });
    const localPackage = installed[selected.pluginId];
    const resources = Object.entries(manifest.resources.reduce<Record<string, typeof manifest.resources>>((groups, resource) => {
      (groups[resource.type] ??= []).push(resource);
      return groups;
    }, {}));
    return (
      <section className="space-y-7">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md text-xs text-dls-secondary hover:text-dls-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          onClick={() => setSelectedId(null)}
        >
          <ChevronLeft size={15} />{t("settings.marketplace.back")}
        </button>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-dls-border bg-dls-surface text-dls-secondary">
              {iconUrl ? <img src={iconUrl} alt="" className="size-8 object-contain" /> : <Package size={24} />}
            </span>
            <div>
              <h2 className="text-xl font-semibold text-dls-text">{manifest.name}</h2>
              <p className="mt-1 max-w-[64ch] text-sm leading-6 text-dls-secondary">{manifest.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <SettingsPill>v{selected.version}</SettingsPill>
                <SettingsPill>{selected.publisher}</SettingsPill>
                <SettingsPill>{selected.pointsCost === 0 ? t("settings.marketplace.free") : `${selected.pointsCost} iPoints`}</SettingsPill>
              </div>
            </div>
          </div>
          <Button disabled={!client || !workspaceId || busyId !== null || localPackage?.version === selected.version} onClick={() => void install(selected)}>
            {busyId === selected.pluginId ? <Loader2 size={14} className="animate-spin" /> : null}
            {actionLabel(selected, localPackage)}
          </Button>
        </div>
        <div className="grid gap-5 border-t border-dls-border pt-6 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-dls-secondary">{t("settings.marketplace.capabilities")}</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {resources.map(([type, entries]) => (
                <div key={type} className="rounded-xl border border-dls-border bg-dls-hover/30 p-4">
                  <div className="text-xs font-semibold capitalize text-dls-text">{type}</div>
                  <div className="mt-2 space-y-1.5">{entries.map((resource) => <div key={resource.id} className="text-xs text-dls-secondary">{resource.label ?? resource.id}</div>)}</div>
                </div>
              ))}
            </div>
            {manifest.setup?.instructions ? <SettingsNotice className="mt-4">{manifest.setup.instructions}</SettingsNotice> : null}
          </div>
          <div className="space-y-3 rounded-xl border border-dls-border bg-dls-hover/30 p-4 text-xs text-dls-secondary">
            <div className="flex items-center gap-2 font-semibold text-dls-text"><ShieldCheck size={15} />{t("settings.marketplace.package_info")}</div>
            <div className="flex justify-between gap-3"><span>{t("settings.marketplace.size")}</span><span>{formatBytes(selected.size)}</span></div>
            <div className="flex justify-between gap-3"><span>{t("settings.marketplace.resources")}</span><span>{manifest.resources.length}</span></div>
            <div className="flex justify-between gap-3"><span>{t("settings.marketplace.permissions")}</span><span>{manifest.permissions?.length ?? 0}</span></div>
            <div className="break-all font-mono text-[10px]">{selected.digest}</div>
          </div>
        </div>
        {error ? <div role="alert" className="rounded-xl border border-red-6 bg-red-2 px-5 py-3 text-xs text-red-11">{error}</div> : null}
      </section>
    );
  }

  return (
    <section className="space-y-9">
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
          onInstall={install}
        />
      ))}

      {error ? <div role="alert" className="rounded-xl border border-red-6 bg-red-2 px-5 py-3 text-xs text-red-11">{error}</div> : null}
    </section>
  );
}

type MarketplaceSectionProps = {
  title: string;
  items: DenMarketplacePlugin[];
  installed: Record<string, iPolloWorkPluginPackageItem>;
  busyId: string | null;
  client: iPolloWorkServerClient | null;
  workspaceId: string | null;
  onOpen: (pluginId: string) => void;
  onInstall: (item: DenMarketplacePlugin) => Promise<void>;
};

function MarketplaceSection(props: MarketplaceSectionProps) {
  return (
    <section>
      <h2 className="border-b border-dls-border pb-3 text-base font-semibold text-dls-text">{props.title}</h2>
      <div className="grid gap-x-8 sm:grid-cols-2">
        {props.items.map((item) => {
          const localPackage = props.installed[item.pluginId];
          return (
            <PluginPackageListItem
              key={item.pluginId}
              manifest={item.manifest}
              version={item.version}
              compact
              featured={item.featured}
              badge={item.pointsCost > 0
                ? <span className="rounded-full border border-dls-border px-2 py-0.5 text-[10px] text-dls-secondary">{item.pointsCost} iPoints</span>
                : null}
              status={localPackage ? (localPackage.version === item.version ? t("settings.marketplace.installed") : t("extensions.update_available")) : item.publisher}
              actionBusy={props.busyId === item.pluginId}
              actionDisabled={!props.client || !props.workspaceId || props.busyId !== null || localPackage?.version === item.version}
              actionLabel={<>{props.busyId === item.pluginId ? <Loader2 size={14} className="animate-spin" /> : null}{actionLabel(item, localPackage)}</>}
              onOpen={() => props.onOpen(item.pluginId)}
              onAction={() => void props.onInstall(item)}
            />
          );
        })}
      </div>
    </section>
  );
}
