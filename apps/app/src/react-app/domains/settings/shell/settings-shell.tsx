/** @jsxImportSource react */
import type * as React from "react";
import { ChevronDown, PanelsTopLeft, X } from "lucide-react";

import { Button, ButtonStyleScopeProvider } from "@/components/ui/button";
import { SelectStyleScopeProvider } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarInset,
  SidebarProvider,
  SidebarToggleIcon,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { t } from "../../../../i18n";
import { NotificationBell } from "../../../shell/notification-center";
import type { SettingsTab } from "../../../../app/types";
import {
  SettingsPage,
  SettingsBetaBadge,
  SettingsSidebar,
  getCloudSettingsTabs,
  getGlobalSettingsTabs,
  getSettingsTabLabel,
  getWorkspaceSettingsTabs,
  isSettingsTabBeta,
  SettingsTabIcon,
} from "./settings-page";
import { useFeatureFlagsPreferences } from "../state/feature-flags-preferences";

type SettingsPageFrameProps = Omit<React.ComponentProps<typeof SettingsPage>, "children">;

export type SettingsShellProps = SettingsPageFrameProps & {
  headerStatus?: string;
  busyHint?: string | null;
  onClose: () => void;
  headerTitle?: React.ReactNode;
  headerActions?: React.ReactNode;
  showNotifications?: boolean;
  children: React.ReactNode;
  modalSlot?: React.ReactNode;
  footer?: React.ReactNode;
  compact?: boolean;
  hideShellHeader?: boolean;
  hideCloseButton?: boolean;
};

function SettingsControlStyleScope({ children }: { children: React.ReactNode }) {
  return (
    <SelectStyleScopeProvider value="settings">
      <ButtonStyleScopeProvider value="settings">{children}</ButtonStyleScopeProvider>
    </SelectStyleScopeProvider>
  );
}

function EmbeddedSidebarRestoreTrigger() {
  const { state } = useSidebar();
  if (state !== "collapsed") return null;

  return (
    <SidebarTrigger
      data-testid="embedded-sidebar-restore"
      className="size-8 shrink-0 rounded-lg border-none text-muted-foreground hover:bg-muted hover:text-foreground mac:ml-16 mac:titlebar-no-drag"
      icon={<SidebarToggleIcon />}
      aria-label={t("sidebar.expand")}
      title={t("sidebar.expand")}
    />
  );
}

export function SettingsShell(props: SettingsShellProps) {
  const activePluginPage = props.pluginPages?.find((page) => page.id === props.activePluginPageId);
  const title = activePluginPage?.label ?? getSettingsTabLabel(props.activeTab);

  if (props.compact) {
    return (
      <SettingsControlStyleScope>
        <div data-settings-shell data-settings-compact className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white dark:bg-background">
          <header className="flex h-11 shrink-0 items-center justify-between gap-2 px-3 mac:titlebar-drag">
            <div className="flex min-w-0 items-center gap-2 mac:titlebar-no-drag">
              <EmbeddedSidebarRestoreTrigger />
              {props.headerTitle ?? (
                <SettingsSectionMenu
                  activeTab={props.activeTab}
                  developerMode={props.developerMode}
                  onSelectTab={props.onSelectTab}
                  pluginPages={props.pluginPages}
                  activePluginPageId={props.activePluginPageId}
                  onSelectPluginPage={props.onSelectPluginPage}
                />
              )}
            </div>
            <div className={`flex shrink-0 items-center gap-1 mac:titlebar-no-drag ${props.hideCloseButton ? "pr-10" : ""}`}>
              {props.headerActions}
              {props.hideCloseButton ? null : (
                <button
                  type="button"
                  data-settings-close=""
                  className="inline-flex size-7 shrink-0 appearance-none items-center justify-center rounded-lg border-0 bg-transparent p-0 text-gray-10 shadow-none outline-none ring-0 transition-colors hover:bg-foreground/[0.06] hover:text-dls-text hover:shadow-none"
                  onClick={props.onClose}
                  title={t("dashboard.close_settings")}
                  aria-label={t("dashboard.close_settings")}
                >
                  <X size={17} />
                </button>
              )}
            </div>
          </header>

          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col">
              <SettingsPage {...props}>{props.children}</SettingsPage>

              {props.modalSlot}
            </div>

            {props.footer}
          </main>
        </div>
      </SettingsControlStyleScope>
    );
  }

  return (
    <SettingsControlStyleScope>
      <div data-settings-shell className="flex h-dvh min-h-screen w-full overflow-hidden">
        <SidebarProvider open={true} className="relative min-h-0 flex-1">
          <SettingsSidebar
            activeTab={props.activeTab}
            onSelectTab={props.onSelectTab}
            developerMode={props.developerMode}
            pluginPages={props.pluginPages}
            activePluginPageId={props.activePluginPageId}
            onSelectPluginPage={props.onSelectPluginPage}
            onClose={props.onClose}
          />
          <SidebarInset className="min-h-0 overflow-hidden bg-white dark:bg-background mac:[&_header]:transition-[padding-left] mac:[&_header]:duration-200 mac:[&_header]:ease-linear mac:peer-data-[state=collapsed]:[&_header]:pl-16 [&_header]:pl-8 min-[1600px]:[&_header]:pl-12 min-[1920px]:[&_header]:pl-16">
            <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {!props.hideShellHeader ? (
                <header data-testid="settings-shell-header" className="h-10 shrink-0 px-8 min-[1600px]:px-12 min-[1920px]:px-16 mac:titlebar-drag">
                  <div data-settings-header-safe-area className="mx-auto flex h-full w-full max-w-[1280px] items-center justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <SidebarTrigger className="mac:titlebar-no-drag md:hidden" />
                      {props.headerTitle ?? <h1 className="truncate text-ui-body font-semibold text-dls-text">{title}</h1>}
                      {props.developerMode && props.headerStatus ? (
                        <span className="hidden text-ui-compact text-dls-secondary lg:inline">
                          {props.headerStatus}
                        </span>
                      ) : null}
                      {props.busyHint ? (
                        <span className="hidden text-ui-compact text-dls-secondary lg:inline">
                          {props.busyHint}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-10 mac:titlebar-no-drag">
                      {props.headerActions}
                      {props.showNotifications === false ? null : <NotificationBell />}
                      <button
                        type="button"
                        data-settings-close=""
                        className="inline-flex size-7 items-center justify-center rounded-lg border-0 bg-transparent p-0 text-gray-10 transition-colors hover:bg-foreground/[0.06] hover:text-dls-text md:hidden"
                        onClick={props.onClose}
                        title={t("dashboard.close_settings")}
                        aria-label={t("dashboard.close_settings")}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                </header>
              ) : null}

              <div className="flex min-h-0 flex-1 flex-col">
                <SettingsPage {...props}>{props.children}</SettingsPage>

                {props.modalSlot}
              </div>

              {props.footer}
            </main>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </SettingsControlStyleScope>
  );
}

function SettingsSectionMenu(props: Pick<SettingsPageFrameProps, "activeTab" | "developerMode" | "onSelectTab" | "pluginPages" | "activePluginPageId" | "onSelectPluginPage">) {
  const { memoryEnabled } = useFeatureFlagsPreferences();
  const sections: Array<{ label: string | null; tabs: SettingsTab[] }> = [
    { label: t("settings.group_workspace"), tabs: getWorkspaceSettingsTabs() },
    { label: t("settings.group_global"), tabs: getGlobalSettingsTabs(props.developerMode) },
    { label: t("settings.group_cloud"), tabs: getCloudSettingsTabs(memoryEnabled) },
  ];
  const activePluginPage = props.pluginPages?.find((page) => page.id === props.activePluginPageId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button variant="outline" size="sm" className="min-w-0 max-w-46 justify-start gap-2">
            {activePluginPage ? (
              activePluginPage.iconSrc
                ? <img src={activePluginPage.iconSrc} alt="" className="size-4 rounded-sm object-contain" />
                : <PanelsTopLeft className="size-4 shrink-0" />
            ) : <SettingsTabIcon tab={props.activeTab} />}
            <span className="truncate">{activePluginPage?.label ?? getSettingsTabLabel(props.activeTab)}</span>
            {!activePluginPage && isSettingsTabBeta(props.activeTab) ? <SettingsBetaBadge /> : null}
            <ChevronDown className="ml-auto size-4 shrink-0" />
          </Button>
        )}
      />
      <DropdownMenuContent className="w-64">
        {sections.map((section, index) => (
          <DropdownMenuGroup key={section.label ?? "root"}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            {section.label ? <DropdownMenuLabel>{section.label}</DropdownMenuLabel> : null}
            {section.tabs.map((tab) => {
              return (
                <DropdownMenuItem
                  key={tab}
                  onClick={() => props.onSelectTab(tab)}
                  className={!props.activePluginPageId && props.activeTab === tab ? "bg-foreground/10 text-accent-foreground" : undefined}
                >
                  <SettingsTabIcon tab={tab} />
                  <span>{getSettingsTabLabel(tab)}</span>
                  {isSettingsTabBeta(tab) ? <SettingsBetaBadge className="ml-auto" /> : null}
                </DropdownMenuItem>
              );
            })}
            {index === 0 ? props.pluginPages?.map((page) => (
              <DropdownMenuItem
                key={page.id}
                onClick={() => props.onSelectPluginPage?.(page.id)}
                className={props.activePluginPageId === page.id ? "bg-foreground/10 text-accent-foreground" : undefined}
              >
                {page.iconSrc ? <img src={page.iconSrc} alt="" className="size-4 rounded-sm object-contain" /> : <PanelsTopLeft />}
                <span>{page.label}</span>
              </DropdownMenuItem>
            )) : null}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
