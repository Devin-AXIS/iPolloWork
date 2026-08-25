import { describe, expect, test } from "bun:test";

import {
  MARKETPLACE_CATEGORY_IDS,
  resolveMarketplaceCategory,
  shouldShowMarketplaceRows,
} from "../src/react-app/domains/settings/pages/cloud-marketplaces-view";
import { resolveExtensionIconUrl } from "../src/react-app/design-system/extension-icon-src";

describe("Cloud marketplace row visibility", () => {
  test("requires a Cloud account but not an organization", () => {
    expect(shouldShowMarketplaceRows(false)).toBe(false);
    expect(shouldShowMarketplaceRows(true)).toBe(true);
  });

  test("installs Cloud artifacts only through the V2 package lifecycle", async () => {
    const source = await Bun.file(new URL("../src/react-app/domains/settings/pages/cloud-marketplaces-view.tsx", import.meta.url)).text();
    expect(source).toContain('listEnterpriseResources("extension")');
    expect(source).toContain("Promise.allSettled");
    expect(source).toContain('marketplaceResult.status === "rejected"');
    expect(source).toContain('localPackagesResult.status === "fulfilled"');
    expect(source).toContain("downloadEnterpriseResource(resource)");
    expect(source).toContain('readPluginPackageArchive(file, "install")');
    expect(source).toContain("validatePluginPackageUpload(workspaceId, upload)");
    expect(source).toContain("importPluginPackage(workspaceId, upload)");
    expect(source).toContain("<PluginPackageListItem");
    expect(source).toContain("<PluginPackageDetail");
    expect(source).toContain("onOpenInstalled");
    expect(source).not.toContain("activeOrganization");
    expect(source).not.toContain("DenOrgPlugin");
    expect(source).not.toContain("orgMcpConnections");
  });

  test("shares one detail page across marketplace and personal plugins", async () => {
    const marketplaceSource = await Bun.file(new URL("../src/react-app/domains/settings/pages/cloud-marketplaces-view.tsx", import.meta.url)).text();
    const personalSource = await Bun.file(new URL("../src/react-app/domains/settings/plugin-packages-panel.tsx", import.meta.url)).text();
    expect(marketplaceSource).toContain("<PluginPackageDetail");
    expect(personalSource).toContain("<PluginPackageDetail");
    expect(personalSource).toContain('t("plugin_platform.enable")');
    expect(personalSource).toContain('t("plugin_platform.status.needs_authorization")');
  });

  test("uses the canonical plugin library categories", () => {
    expect(MARKETPLACE_CATEGORY_IDS).toEqual([
      "ai-agents",
      "development-operations",
      "design-creative",
      "productivity-collaboration",
      "business-operations",
      "finance",
      "other",
    ]);
    expect(resolveMarketplaceCategory({ pluginId: "deepseek-harness", category: "Developer Tools", manifest: {} })).toBe("ai-agents");
    expect(resolveMarketplaceCategory({ pluginId: "figma", category: "Design & Development", manifest: {} })).toBe("design-creative");
    expect(resolveMarketplaceCategory({ pluginId: "linear", category: "Projects & Engineering", manifest: {} })).toBe("productivity-collaboration");
    expect(resolveMarketplaceCategory({ pluginId: "stripe", category: "Payments & Finance", manifest: {} })).toBe("finance");
    expect(resolveMarketplaceCategory({ pluginId: "unknown", category: "Uncategorized", manifest: {} })).toBe("other");
  });

  test("uses curated brand assets for featured plugins while preserving iPollo branding", () => {
    expect(resolveExtensionIconUrl({ pluginId: "figma", iconSlug: "figma" })).toBe("/ext-figma.svg");
    expect(resolveExtensionIconUrl({ pluginId: "context7", iconSlug: "semanticscholar" })).toBe("/ext-context7.svg");
    expect(resolveExtensionIconUrl({ pluginId: "design-agent", iconSrc: "ipollowork-mark.svg" })).toBe("ipollowork-mark.svg");
    expect(resolveExtensionIconUrl({ pluginId: "video-agent", iconSrc: "ipollowork-mark.svg" })).toBe("ipollowork-mark.svg");
    expect(resolveExtensionIconUrl({ pluginId: "custom-plugin", iconSlug: "example" })).toBe("https://cdn.simpleicons.org/example");
  });

  test("matches the Figma plugin library layout with functional source and marketplace filters", async () => {
    const panelSource = await Bun.file(new URL("../src/react-app/domains/settings/plugin-packages-panel.tsx", import.meta.url)).text();
    const marketplaceSource = await Bun.file(new URL("../src/react-app/domains/settings/pages/cloud-marketplaces-view.tsx", import.meta.url)).text();
    const listItemSource = await Bun.file(new URL("../src/react-app/domains/settings/plugin-package-list-item.tsx", import.meta.url)).text();
    const segmentedTabsSource = await Bun.file(new URL("../src/react-app/domains/settings/settings-segmented-tabs.tsx", import.meta.url)).text();
    const routeSource = await Bun.file(new URL("../src/react-app/shell/settings-route.tsx", import.meta.url)).text();
    const ipolloLogo = await Bun.file(new URL("../public/ipollowork-mark.svg", import.meta.url)).text();
    const englishLocale = await Bun.file(new URL("../src/i18n/locales/en.ts", import.meta.url)).text();
    const chineseLocale = await Bun.file(new URL("../src/i18n/locales/zh.ts", import.meta.url)).text();

    expect(panelSource).toContain('data-testid="plugin-library-heading" className={settingsPageTitleClass}');
    expect(panelSource).toContain('settingsSectionTitleClass,');
    expect(panelSource).toContain('data-testid="plugin-library-description" className={settingsPageDescriptionClass}');
    expect(panelSource).toContain('<h2 className={settingsSectionTitleClass}>');
    expect(panelSource).toContain('containerClassName="h-[34px] rounded-lg');
    expect(panelSource).toContain('t("plugin_library.installed_description")');
    expect(panelSource).not.toContain('t("plugin_library.manage")');
    expect(panelSource).toContain('data-testid="plugin-installed-expand"');
    expect(panelSource).toContain('data-testid="plugin-installed-overflow-thumbnails"');
    expect(panelSource).toContain('remainingInstalledItems.slice(0, 3)');
    expect(panelSource).toContain('new ResizeObserver(updatePreviewLimit)');
    expect(panelSource).toContain('onClick={() => setInstalledExpanded((current) => !current)}');
    expect(panelSource).toContain('aria-expanded={installedExpanded}');
    expect(panelSource).toContain('const INSTALLED_TILE_GAP = 8;');
    expect(panelSource).toContain('const INSTALLED_TILE_WIDTH = 48;');
    expect(panelSource).toContain('className={`flex w-full items-center gap-2');
    expect(panelSource).toContain('className="flex size-12 shrink-0 items-center justify-center');
    expect(panelSource).toContain('hover:border-[#1FBAC0]');
    expect(panelSource).toContain('border-2 border-transparent');
    expect(panelSource).toContain('<TooltipProvider delay={0}>');
    expect(panelSource).not.toContain('hover:w-[202px]');
    expect(panelSource).not.toContain('data-testid="plugin-installed-details"');
    expect(panelSource).toContain('pluginId: item.pluginId');
    expect(panelSource).not.toContain('data-testid="plugin-installed-status-card"');
    expect(segmentedTabsSource).toContain('inline-flex h-7 items-center gap-0.5');
    expect(segmentedTabsSource).toContain('h-7 items-center justify-center rounded-[8px] px-3');
    expect(segmentedTabsSource).toContain('bg-[#f3f3f4] text-[#161e24]');
    expect(segmentedTabsSource).toContain('hover:bg-[#f6f7fb] active:bg-[#e7e7e9] active:text-[#161e24]');
    expect(segmentedTabsSource).toContain('disabled:pointer-events-none disabled:opacity-50');
    expect(segmentedTabsSource).not.toContain('variant?:');
    expect(panelSource).not.toContain('variant="standalone"');
    expect(panelSource).toContain('useState<"marketplace" | "personal">("personal")');
    expect(panelSource.indexOf('{ value: "personal", label: t("plugin_library.personal") }'))
      .toBeLessThan(panelSource.indexOf('{ value: "marketplace", label: t("plugin_library.marketplace") }'));
    expect(routeSource).toContain('data-testid="plugin-library-navigation-actions"');
    expect(routeSource).toContain('showNotifications={route.tab !== "extensions"}');
    expect(routeSource).toContain('hideShellHeader={Boolean(route.pluginPackageId)}');
    expect(panelSource).toContain('MARKETPLACE_CATEGORY_IDS.map');
    expect(panelSource).toContain('props.marketplaceView(search, { category: marketplaceCategory, status: marketplaceStatus }, items)');
    expect(marketplaceSource).toContain('statusFilter === "installed"');
    expect(marketplaceSource).toContain('statusFilter === "update"');
    expect(marketplaceSource).toContain('categoryFilter !== "all"');
    expect(listItemSource).toContain('h-[74px]');
    expect(listItemSource).toContain('bg-transparent px-4 py-2 transition-colors hover:bg-[#f6f7fb]');
    expect(listItemSource).not.toContain('rounded-lg border border-dls-border bg-dls-surface px-4 py-2');
    expect(listItemSource).toContain('size-12 shrink-0');
    expect(listItemSource).toContain('rounded-[8px] bg-[#f3f3f4] text-dls-secondary');
    expect(listItemSource).toContain('data-testid="plugin-package-card-copy"');
    expect(listItemSource).toContain('flex min-w-0 flex-1 flex-col gap-1');
    expect(listItemSource).toContain('className="line-clamp-2 text-ui-caption');
    expect(listItemSource).not.toContain('{skills} Skills');
    expect(listItemSource).not.toContain('{mcps} MCP');
    expect(panelSource).toContain('grid gap-x-8 gap-y-2 lg:grid-cols-2');
    expect(marketplaceSource).toContain('mt-3 grid gap-x-8 gap-y-2 lg:grid-cols-2');
    expect(listItemSource).not.toContain('dark:bg-white/[0.06]');
    expect(listItemSource).toContain('text-ui-caption text-dls-secondary');
    expect(ipolloLogo).toContain('viewBox="0 0 281 298"');
    expect(ipolloLogo.match(/<path /g)).toHaveLength(3);
    expect(englishLocale).toContain('"plugin_library.marketplace": "Public"');
    expect(chineseLocale).toContain('"plugin_library.marketplace": "公开"');
  });

  test("keeps raw MCP management out of the primary plugin page", async () => {
    const extensionsSource = await Bun.file(new URL("../src/react-app/domains/settings/pages/extensions-view.tsx", import.meta.url)).text();
    const routeSource = await Bun.file(new URL("../src/react-app/shell/settings-route.tsx", import.meta.url)).text();
    expect(extensionsSource).toContain("pluginPackagesView");
    expect(extensionsSource).toContain("skillsView");
    expect(extensionsSource).not.toContain("mcpView");
    expect(extensionsSource).not.toContain("PluginsView");
    expect(routeSource).not.toContain("<McpView");
  });
});
