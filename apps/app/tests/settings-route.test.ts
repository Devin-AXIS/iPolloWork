import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import { getCloudSettingsTabs, getGlobalSettingsTabs } from "../src/react-app/domains/settings/shell/settings-page";
import { parseSettingsPath } from "../src/react-app/shell/settings-route";

const settingsRouteSource = readFileSync(
  new URL("../src/react-app/shell/settings-route.tsx", import.meta.url),
  "utf8",
);
const settingsShellSource = readFileSync(
  new URL("../src/react-app/domains/settings/shell/settings-shell.tsx", import.meta.url),
  "utf8",
);
const settingsPanelSource = readFileSync(
  new URL("../src/react-app/domains/settings/shell/panel.tsx", import.meta.url),
  "utf8",
);
const settingsPageSource = readFileSync(
  new URL("../src/react-app/domains/settings/shell/settings-page.tsx", import.meta.url),
  "utf8",
);
const engineManagementSource = readFileSync(
  new URL("../src/react-app/domains/settings/pages/engine-management-view.tsx", import.meta.url),
  "utf8",
);
const environmentTableSource = readFileSync(
  new URL("../src/react-app/domains/settings/pages/environment-variable-table.tsx", import.meta.url),
  "utf8",
);
const settingsLayoutSource = readFileSync(
  new URL("../src/react-app/domains/settings/settings-layout.tsx", import.meta.url),
  "utf8",
);
const pluginPanelSource = readFileSync(
  new URL("../src/react-app/domains/settings/plugin-packages-panel.tsx", import.meta.url),
  "utf8",
);
const pluginListItemSource = readFileSync(
  new URL("../src/react-app/domains/settings/plugin-package-list-item.tsx", import.meta.url),
  "utf8",
);
const skillsViewSource = readFileSync(
  new URL("../src/react-app/domains/settings/pages/skills-view.tsx", import.meta.url),
  "utf8",
);
const modalStylesSource = readFileSync(
  new URL("../src/react-app/domains/workspace/modal-styles.ts", import.meta.url),
  "utf8",
);
const extensionsStoreSource = readFileSync(
  new URL("../src/react-app/domains/settings/state/extensions-store.ts", import.meta.url),
  "utf8",
);
const englishLocaleSource = readFileSync(
  new URL("../src/i18n/locales/en.ts", import.meta.url),
  "utf8",
);
const chineseLocaleSource = readFileSync(
  new URL("../src/i18n/locales/zh.ts", import.meta.url),
  "utf8",
);
const buttonSource = readFileSync(
  new URL("../src/components/ui/button.tsx", import.meta.url),
  "utf8",
);
const selectSource = readFileSync(
  new URL("../src/components/ui/select.tsx", import.meta.url),
  "utf8",
);
const selectMenuSource = readFileSync(
  new URL("../src/react-app/design-system/select-menu.tsx", import.meta.url),
  "utf8",
);
const inputSource = readFileSync(
  new URL("../src/components/ui/input.tsx", import.meta.url),
  "utf8",
);
const textareaSource = readFileSync(
  new URL("../src/components/ui/textarea.tsx", import.meta.url),
  "utf8",
);
const legacyTextInputSource = readFileSync(
  new URL("../src/react-app/design-system/text-input.tsx", import.meta.url),
  "utf8",
);
const appStylesSource = readFileSync(
  new URL("../src/app/index.css", import.meta.url),
  "utf8",
);

describe("settings route parsing", () => {
  test("binds provider auth directly to the derived shared client", () => {
    expect(settingsRouteSource).toContain(
      "routeStateRef.current.providerClient = sharedProviderClient;",
    );
    expect(settingsRouteSource).not.toContain("activeProviderClient");
  });

  test("refreshes the account provider directory when AI settings becomes visible", () => {
    expect(settingsRouteSource).toContain('if (route.tab !== "ai" || !sharedProviderClient) return;');
    expect(settingsRouteSource).not.toContain("setProviders([]);");
  });

  test("redirects the settings root to preferences while keeping the overview route available", () => {
    expect(parseSettingsPath("/settings")).toEqual({ tab: "preferences", redirectPath: "preferences" });
    expect(parseSettingsPath("/settings/general")).toEqual({ tab: "general", redirectPath: null });
  });

  test("recognizes the Connect settings tab", () => {
    expect(parseSettingsPath("/settings/connect")).toEqual({ tab: "connect", redirectPath: null });
    expect(parseSettingsPath("/workspace/workspace_1/settings/connect")).toEqual({
      tab: "connect",
      redirectPath: null,
    });
  });

  test("hides Connect from persistent settings navigation", () => {
    expect(getCloudSettingsTabs(false)).toEqual(["cloud-account"]);
    expect(getCloudSettingsTabs(true)).toEqual(["cloud-account", "memory"]);
  });

  test("recognizes the Authorization Center settings tab", () => {
    expect(parseSettingsPath("/settings/authorizations")).toEqual({
      tab: "authorizations",
      redirectPath: null,
    });
    expect(parseSettingsPath("/workspace/workspace_1/settings/authorizations")).toEqual({
      tab: "authorizations",
      redirectPath: null,
    });
  });

  test("exposes a global engine manager without turning engines into workspace settings", () => {
    expect(parseSettingsPath("/settings/engines")).toEqual({ tab: "engines", redirectPath: null });
    expect(getGlobalSettingsTabs(false)).toContain("engines");
    expect(settingsRouteSource).toContain("<EngineManagementView anyActiveRuns=");
    expect(engineManagementSource).toContain('data-testid="engine-package-row"');
    expect(engineManagementSource).toContain('t("settings.engine_manager.data_retained")');
    expect(engineManagementSource).toContain('case "desktop-client"');
    expect(engineManagementSource).toContain('t("settings.engine_manager.external_desktop_client_notice")');
    expect(engineManagementSource).toContain("engine.canUninstall");
    expect(englishLocaleSource).toContain('"settings.engine_manager.source_desktop_client": "Provided by Codex client"');
    expect(chineseLocaleSource).toContain('"settings.engine_manager.source_desktop_client": "由 Codex 客户端提供"');
  });

  test("recognizes an installed plugin detail as its own extensions route", () => {
    expect(parseSettingsPath("/workspace/workspace_1/settings/extensions/plugin/figma")).toEqual({
      tab: "extensions",
      redirectPath: null,
      extensionsSection: "all",
      pluginPackageId: "figma",
    });
  });

  test("keeps the plugin and skill library tabs addressable", () => {
    expect(parseSettingsPath("/settings/extensions")).toEqual({
      tab: "extensions",
      redirectPath: null,
      extensionsSection: "all",
    });
    expect(parseSettingsPath("/settings/extensions/skills")).toEqual({
      tab: "extensions",
      redirectPath: null,
      extensionsSection: "skills",
    });
  });

  test("returns to the task that opened settings", () => {
    expect(settingsRouteSource).toContain("workspaceSessionRoute(selectedWorkspaceId, navigationSessionId)");
  });

  test("uses a white settings workspace in light mode and preserves the dark theme", () => {
    expect(settingsShellSource.match(/bg-white dark:bg-background/g)).toHaveLength(2);
    expect(settingsShellSource).not.toContain("mac:bg-background/80");
  });

  test("keeps settings navigation boundaries divider-free", () => {
    expect(settingsShellSource).not.toMatch(/<header[^>]*border-b border-dls-border/);
    expect(settingsPageSource).toContain('<Sidebar className="!border-e-0');
  });

  test("aligns navigation icons and shares the Extensions artwork", () => {
    expect(settingsPageSource).toContain("export function SettingsTabIcon");
    expect(settingsPageSource).toContain('className="size-4! [&_*]:[vector-effect:non-scaling-stroke]" strokeWidth={1}');
    expect(settingsPageSource).toContain('alt="" className="size-[15px] dark:invert"');
    expect(settingsPageSource).toContain('publicAssetUrl("sidebar-icon/toy-brick.svg")');
    expect(settingsPageSource.match(/<SettingsTabIcon tab=\{tab\} \/>/g)).toHaveLength(3);
    expect(settingsShellSource).toContain('<SettingsTabIcon tab={props.activeTab} />');
    expect(settingsShellSource).toContain('<SettingsTabIcon tab={tab} />');
  });

  test("hides the redundant close action from embedded Extensions only", () => {
    expect(settingsRouteSource).toContain('hideCloseButton={props.embedded && route.tab === "extensions"}');
    expect(settingsShellSource).toContain('{props.hideCloseButton ? null : (');
    expect(settingsShellSource).toContain('data-testid="embedded-sidebar-restore"');
    expect(settingsShellSource).toContain('state !== "collapsed"');
  });

  test("uses the shared settings typography hierarchy", () => {
    expect(settingsPanelSource).toContain('export const settingsPageTitleClass = "text-2xl font-semibold leading-8 text-dls-text";');
    expect(settingsPanelSource).toContain('export const settingsPageDescriptionClass = "settings-description mt-1.5 text-ui-control leading-5 text-dls-secondary";');
    expect(settingsPanelSource).toContain('export const settingsSectionTitleClass = "text-ui-body font-semibold text-dls-text";');
    expect(settingsPanelSource).toContain("cn(settingsPageTitleClass, props.className)");
    expect(pluginPanelSource).toContain('className={settingsPageTitleClass}');
    expect(pluginPanelSource).toContain('className={settingsPageDescriptionClass}');
    expect(skillsViewSource).toContain('className={`${settingsPageDescriptionClass} max-w-[714px]`}');
    expect(settingsPanelSource).toContain('"settings-description text-ui-control leading-5 text-muted-foreground"');
    expect(settingsLayoutSource).toContain('"flex items-center gap-2 text-ui-body font-semibold text-foreground"');
    expect(settingsLayoutSource).toContain('"settings-description text-ui-control leading-5 text-muted-foreground"');
    expect(settingsShellSource).toContain('"truncate text-ui-body font-semibold text-dls-text"');
    expect(appStylesSource).toContain('html:lang(zh) .settings-description');
    expect(appStylesSource).toContain('font-weight: 500;');
    expect(`${settingsPanelSource}\n${settingsShellSource}\n${pluginPanelSource}\n${pluginListItemSource}`.replace('text-2xl font-semibold leading-8 text-dls-text', '')).not.toMatch(/text-(?:xl|2xl|3xl)|text-\[(?:15|2\d)px\]/);
  });

  test("uses a centered responsive settings safe area", () => {
    expect(settingsPanelSource).toContain("px-8 py-4 md:py-6 lg:py-8 min-[1600px]:px-12 min-[1920px]:px-16");
    expect(settingsPanelSource).toContain('data-settings-safe-area className="mx-auto flex w-full max-w-[1280px] flex-col items-center gap-6 md:gap-8 [&>*]:w-full"');
    expect(settingsShellSource).toContain('data-settings-header-safe-area className="mx-auto flex h-full w-full max-w-[1280px] items-center justify-between"');
    expect(settingsPanelSource).toContain('export const settingsStandardContentClass = "mx-auto w-full max-w-[960px]";');
    expect(settingsLayoutSource).toContain('cn(settingsStandardContentClass, "@container/settings flex flex-col gap-y-6"');
    expect(pluginPanelSource).toContain('<section className="w-full">');
    expect(settingsShellSource).toContain("px-8 min-[1600px]:px-12 min-[1920px]:px-16 mac:titlebar-drag");
    expect(settingsPanelSource).not.toMatch(/\bp-4\b|md:p-6|lg:p-8/);
  });

  test("uses the compact button size throughout settings", () => {
    expect(settingsRouteSource.match(/<Button size="default"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(pluginPanelSource).not.toContain('t("plugin_library.manage")');
    expect(pluginPanelSource).toContain('data-testid="plugin-installed-expand"');
    expect(pluginPanelSource).toMatch(/data-testid="plugin-installed-expand"[\s\S]*?variant="ghost"[\s\S]*?size="sm"/);
    expect(pluginListItemSource).toContain('<Button size="sm" variant="outline" className="shrink-0"');
    expect(settingsShellSource.match(/data-settings-close=""/g)).toHaveLength(2);
    expect(settingsShellSource).toContain('className="inline-flex size-7');
    expect(settingsShellSource).toContain('<ButtonStyleScopeProvider value="settings">{children}</ButtonStyleScopeProvider>');
    expect(buttonSource).toContain('"gap-[6px] rounded-[8px] text-[13px] font-medium');
    expect(buttonSource).toContain('const settingsCompactButtonSize = "h-7 px-2');
    expect(buttonSource).toContain('const settingsCompactIconButtonSize = "size-7');
    expect(buttonSource.match(/: settingsCompactButtonSize/g)).toHaveLength(4);
    expect(buttonSource.match(/: settingsCompactIconButtonSize/g)).toHaveLength(4);
    expect(buttonSource).toContain('bg-transparent shadow-none before:shadow-none');
    expect(buttonSource).toContain('dark:bg-transparent dark:before:shadow-none');
    expect(buttonSource).toContain('hover:bg-foreground/[0.06] active:bg-foreground/[0.12]');
    expect(buttonSource).toContain('aria-pressed:bg-foreground/[0.08]');
    expect(`${settingsRouteSource}\n${pluginPanelSource}\n${pluginListItemSource}`).not.toMatch(/size="sm"[^>]*className="[^"]*h-9/);
  });

  test("uses the design-panel select states throughout settings", () => {
    expect(settingsShellSource).toContain('<SelectStyleScopeProvider value="settings">');
    expect(selectSource).toContain('type SelectStyleScope = "default" | "settings"');
    expect(selectSource).toContain('h-[34px] w-fit items-center justify-between');
    expect(selectSource).toContain('w-max min-w-(--anchor-width) max-w-[min(320px,var(--available-width))]');
    expect(selectSource).toContain('menuDensityClassNames.compact.content');
    expect(selectSource).toContain('menuDensityClassNames.compact.item');
    expect(selectSource).toContain('menuSurfaceClassName');
    expect(selectSource).toContain('styleScope === "settings" && "text-[#1FBAC0]"');
    expect(selectMenuSource).toContain('h-[34px] w-full items-center justify-between');
    expect(selectMenuSource).toContain('menuDensityClassNames.compact.content');
    expect(selectMenuSource).toContain('menuDensityClassNames.compact.item');
    expect(selectMenuSource).toContain('menuSurfaceClassName');
    expect(selectMenuSource).toContain('text-[#1FBAC0]');
    expect(skillsViewSource).toContain('data-testid="skills-status-filter"');
    expect(skillsViewSource).not.toContain('<select\n              data-testid="skills-status-filter"');
  });

  test("keeps installed plugin previews compact and collapsible", () => {
    expect(pluginPanelSource).toContain('const INSTALLED_TILE_GAP = 8;');
    expect(pluginPanelSource).toContain('className={`flex w-full items-center gap-2');
    expect(pluginPanelSource).toContain('const INSTALLED_TILE_WIDTH = 48;');
    expect(pluginPanelSource).toContain('className="flex size-12 shrink-0 items-center justify-center');
    expect(pluginPanelSource.match(/data-testid="plugin-library-(?:installed|source)" className="mt-8 space-y-3"/g)).toHaveLength(2);
    expect(skillsViewSource.match(/<div className="space-y-3">\s*<div data-testid="skills-(?:installed|cloud|hub)-section"/g)).toHaveLength(3);
    expect(pluginPanelSource).toContain('hover:border-[#1FBAC0]');
    expect(pluginPanelSource).toContain('border-2 border-transparent');
    expect(pluginPanelSource).toContain('<TooltipProvider delay={0}>');
    expect(pluginPanelSource).toContain('data-testid="plugin-installed-tooltip"');
    expect(pluginListItemSource).toContain('className="line-clamp-2 text-ui-caption');
    expect(pluginPanelSource).not.toContain('data-testid="plugin-installed-hover-card"');
    expect(pluginPanelSource).not.toContain('hover:w-[202px]');
    expect(pluginPanelSource).toContain('aria-expanded={installedExpanded}');
    expect(pluginPanelSource).toContain('setInstalledExpanded((current) => !current)');
    expect(englishLocaleSource).toContain('"plugin_library.show_less": "Collapse"');
    expect(chineseLocaleSource).toContain('"plugin_library.show_less": "收起"');
  });

  test("matches the Figma skills library hierarchy and responsive card layout", () => {
    expect(settingsRouteSource).toContain('data-testid="skills-library-navigation-actions"');
    expect(skillsViewSource).toContain('data-testid="skills-library-search"');
    expect(skillsViewSource).toContain('data-testid="skills-library-source"');
    expect(skillsViewSource).toContain('<SettingsSegmentedTabs');
    expect(skillsViewSource).toContain('ariaLabel={t("skills.source_label")}');
    expect(skillsViewSource).toContain('data-testid="skills-status-filter"');
    expect(skillsViewSource).toContain('data-testid="skills-installed-section"');
    expect(skillsViewSource).toContain('data-testid="skills-cloud-section"');
    expect(skillsViewSource).toContain('data-testid="skills-hub-section"');
    expect(skillsViewSource).toContain('data-testid="skills-hub-header-actions"');
    expect(skillsViewSource).toContain('data-testid="skills-installed-grid" className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-x-8"');
    expect(skillsViewSource).toContain('data-testid="skill-library-card"');
    expect(skillsViewSource).toContain('hover:bg-[#f6f7fb]');
    expect(skillsViewSource).not.toContain('aria-label={t("skills.uninstall")}');
    expect(skillsViewSource).toContain('data-testid="skill-editor-actions"');
    expect(skillsViewSource).toContain('data-testid="skill-editor-uninstall"');
    expect(skillsViewSource).toContain('data-testid="skill-editor-save"');
    expect(skillsViewSource).not.toContain('t("skills.cloud_refresh")');
    expect(skillsViewSource).toContain('data-testid="skills-cloud-error"');
    expect(skillsViewSource).toContain('data-testid="skills-hub-error"');
    expect(skillsViewSource.match(/className={modalNoticeErrorClass}/g)).toHaveLength(3);
    expect(skillsViewSource).not.toContain('t("skills.refresh_hub")');
    expect(modalStylesSource).toContain('flex min-h-9 items-center rounded-[8px] bg-red-2/60');
    expect(modalStylesSource).toContain('text-[#E5484D] dark:bg-red-2/20');
    expect(skillsViewSource).toContain('void extensions.refreshCloudOrgSkills({ force: true });');
  });

  test("shows a localized team skills error instead of a raw request failure", () => {
    expect(extensionsStoreSource).toContain('cloudOrgSkillsStatus: t("skills.cloud_org_load_failed")');
    expect(chineseLocaleSource).toContain('"skills.cloud_org_load_failed": "团队 Skill 暂时无法加载，请稍后重试。"');
    expect(englishLocaleSource).toContain('"skills.cloud_org_load_failed": "Team skills are temporarily unavailable. Please try again later."');
  });

  test("keeps hub empty states neutral and localizes actual loading failures", () => {
    expect(extensionsStoreSource).toContain('hubSkillsStatus: t("skills.hub_load_failed")');
    expect(extensionsStoreSource).not.toContain('hubSkillsStatus: "No hub skills found."');
    expect(extensionsStoreSource).not.toContain('hubSkillsStatus: error instanceof Error ? error.message');
    expect(chineseLocaleSource).toContain('"skills.hub_load_failed": "技能中心暂时无法加载，请稍后重试。"');
    expect(englishLocaleSource).toContain('"skills.hub_load_failed": "Skill Hub is temporarily unavailable. Please try again later."');
    expect(chineseLocaleSource).toContain('"skills.no_hub_repo_selected": "未选择 Hub 仓库。添加 GitHub 仓库后即可浏览 Skills。"');
    expect(chineseLocaleSource).toContain('"skills.no_hub_skills": "暂无可用的 Hub Skills。"');
  });

  test("uses 8px corners for settings controls and tables", () => {
    expect(settingsShellSource.match(/data-settings-shell/g)).toHaveLength(2);
    expect(appStylesSource).toContain('[data-settings-shell] :where(');
    expect(appStylesSource).toContain('border-radius: 8px !important;');
    expect(environmentTableSource).toContain('className={cn("w-full rounded-[8px] p-0"');
  });

  test("keeps text-entry surfaces flat while preserving focus feedback", () => {
    expect(`${inputSource}\n${textareaSource}`).not.toMatch(/shadow-xs\/5|before:shadow/);
    expect(legacyTextInputSource).not.toContain("shadow-sm");
    expect(appStylesSource.match(/\.ow-input(?:\s|:focus)[^{]*\{[^}]*\}/g)?.join("\n")).not.toContain("box-shadow");
    expect(inputSource).toContain("focus-visible:ring-3");
    expect(textareaSource).toContain("focus-visible:ring-3");
    expect(legacyTextInputSource).toContain("focus:ring-2");
    expect(appStylesSource).toContain("outline: 3px solid rgba(var(--dls-accent-rgb), 0.08);");
  });
});
