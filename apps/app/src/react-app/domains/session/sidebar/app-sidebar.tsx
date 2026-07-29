/** @jsxImportSource react */
import * as React from "react";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ChevronRight,
  FolderPlus,
  Loader2,
  Languages,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  RefreshCw,
  RotateCcw,
  Settings,
  HelpCircle,
  Tag,
  UserRound,
} from "lucide-react";
import { LazyMotion, Reorder, domMax, m, useDragControls } from "motion/react";

import { getDisplaySessionTitle } from "../../../../app/lib/session-title";
import { publicAssetUrl } from "../../../../app/lib/public-asset";
import type { WorkContextId } from "../../../../app/lib/work-context";
import { IPolloWorkDenHelpLink } from "../../workspace/ipollowork-den-help-link";
import type {
  WorkspaceConnectionState,
  WorkspaceSessionGroup,
} from "../../../../app/types";
import {
  isRemoteConnectionErrorMessage,
  getWorkspaceTaskLoadErrorDisplay,
  isRemoteConnectionWorkspace,
  isMacPlatform,
} from "../../../../app/utils";
import { currentLocale, setLocale, t, type Language } from "../../../../i18n";
import { useBrandAppName, useBrandLogoUrl } from "../../cloud/brand-theme";

import {
  Sidebar,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

import { SidebarContext, useSidebarContext } from "./app-sidebar-provider";
import type { SidebarContextValue, iPolloWorkSessionType, iPolloWorkTemplateId } from "./app-sidebar-provider";
import {
  MAX_SESSIONS_PREVIEW,
  buildSessionTreeState,
  flattenSessionRows,
  getRootSessions,
  isSessionArchived,
  isStreamingSessionStatus,
  partitionArchivedSessions,
} from "./utils";
import type { FlattenedSessionRow, SessionListItem, SessionTreeState } from "./utils";
import {
  useSessionManagementStore,
  usePinnedSessionIds,
  useSessionOrder,
  useWorkspaceGroups,
  type SessionGroupDefinition,
} from "./session-management-store";
import { cn } from "@/lib/utils";
import { MarbleAvatar } from "../../../design-system/marble-avatar";
import { getSessionActivityStatusLabel, type SessionActivityStatus } from "../status/session-activity-store";
import { NotificationBell } from "../../../shell/notification-center";
import { useActiveEnterpriseConnection } from "@/react-app/domains/enterprise/use-active-enterprise-connection";

interface SessionStatusIndicatorProps {
  className?: string;
  status?: string;
  isStreaming: boolean;
  isActive: boolean;
}

function SessionStatusIndicator({ className, status, isStreaming, isActive }: SessionStatusIndicatorProps) {
  const activityTitle = isSessionActivityStatus(status) && status !== "idle"
    ? getSessionActivityStatusLabel(status)
    : undefined;
  const title = activityTitle ?? (isStreaming ? t("workspace_list.session_streaming") : t("workspace_list.session_active"));

  if (isStreaming) {
    return (
      <span
        className={cn(
          "flex size-3.5 shrink-0 items-center justify-center",
          status === "waiting" && "text-sky-9",
          status === "error" && "text-red-9",
          className,
        )}
        title={title}
        aria-label={title}
      >
        <Loader2 className="size-3.5 animate-spin" />
      </span>
    );
  }

  if (isActive) {
    return (
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          status === "waiting" && "bg-sky-9",
          status === "error" && "bg-red-9",
          className,
        )}
        title={title}
        aria-label={title}
      />
    );
  }

  return null;
}

function useCanManageSession() {
  // Pin and group actions come from the Zustand store (always available).
  // Rename/delete/archive depend on wired callbacks but the menu should
  // always render so pin/group remain accessible.
  return true;
}

type SessionActionsProps = {
  className: string;
  sessionId: string;
  workspaceId: string;
  isPinned: boolean;
  isArchived: boolean;
};

type SessionMenuContentProps = {
  variant: "dropdown" | "context";
  sessionId: string;
  workspaceId: string;
  isPinned: boolean;
  isArchived: boolean;
};

function SessionMenuContent({ variant, sessionId, workspaceId, isPinned, isArchived }: SessionMenuContentProps) {
  const ctx = useSidebarContext();
  const { groups, assignments } = useWorkspaceGroups(workspaceId);
  const store = useSessionManagementStore;
  const assignedGroupId = assignments[sessionId] ?? null;

  if (variant === "dropdown") {
    return (
      <>
        <DropdownMenuItem onClick={() => store.getState().togglePin(sessionId)}>
          {isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          {isPinned ? t("session_management.unpin_session") : t("session_management.pin_session")}
        </DropdownMenuItem>
        {ctx.onOpenRenameSession ? (
          <DropdownMenuItem onClick={() => ctx.onOpenRenameSession?.(sessionId)}>
            <Pencil className="size-4" />
            {t("workspace_list.rename_session")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Tag className="size-4" />
            {t("session_management.move_to_group")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            {groups.length === 0 ? (
              <DropdownMenuItem onClick={() => ctx.onOpenCreateGroupModal?.(workspaceId)}>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {t("session_management.no_groups_yet")}
                </span>
                <span className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-foreground">
                  <Plus className="size-3.5" />
                </span>
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem
                  onClick={() => store.getState().assignGroup(workspaceId, sessionId, null)}
                  disabled={!assignedGroupId}
                >
                  {t("session_management.no_group")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {groups.map((group) => (
                  <DropdownMenuItem
                    key={group.id}
                    onClick={() => store.getState().assignGroup(workspaceId, sessionId, group.id)}
                    disabled={assignedGroupId === group.id}
                  >
                    {group.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => ctx.onOpenCreateGroupModal?.(workspaceId)}>
                  <FolderPlus className="size-4" />
                  {t("session_management.new_group")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {ctx.onArchiveSession ? (
          <DropdownMenuItem onClick={() => ctx.onArchiveSession?.(sessionId, !isArchived)}>
            {isArchived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
            {isArchived ? t("session_management.unarchive_session") : t("session_management.archive_session")}
          </DropdownMenuItem>
        ) : null}
        {ctx.onOpenDeleteSession ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => ctx.onOpenDeleteSession?.(sessionId)}>
              <Trash2 className="size-4" />
              {t("workspace_list.delete_session")}
            </DropdownMenuItem>
          </>
        ) : null}
      </>
    );
  }

  return (
    <>
      <ContextMenuItem onClick={() => store.getState().togglePin(sessionId)}>
        {isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        {isPinned ? t("session_management.unpin_session") : t("session_management.pin_session")}
      </ContextMenuItem>
      {ctx.onOpenRenameSession ? (
        <ContextMenuItem onClick={() => ctx.onOpenRenameSession?.(sessionId)}>
          <Pencil className="size-4" />
          {t("workspace_list.rename_session")}
        </ContextMenuItem>
      ) : null}
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Tag className="mr-2 size-4" />
          {t("session_management.move_to_group")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {groups.length === 0 ? (
            <ContextMenuItem onClick={() => ctx.onOpenCreateGroupModal?.(workspaceId)}>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {t("session_management.no_groups_yet")}
              </span>
              <span className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-foreground">
                <Plus className="size-3.5" />
              </span>
            </ContextMenuItem>
          ) : (
            <>
              <ContextMenuItem
                onClick={() => store.getState().assignGroup(workspaceId, sessionId, null)}
                disabled={!assignedGroupId}
              >
                {t("session_management.no_group")}
              </ContextMenuItem>
              <ContextMenuSeparator />
              {groups.map((group) => (
                <ContextMenuItem
                  key={group.id}
                  onClick={() => store.getState().assignGroup(workspaceId, sessionId, group.id)}
                  disabled={assignedGroupId === group.id}
                >
                  {group.label}
                </ContextMenuItem>
              ))}
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => ctx.onOpenCreateGroupModal?.(workspaceId)}>
                <FolderPlus className="size-4" />
                {t("session_management.new_group")}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {ctx.onArchiveSession ? (
        <ContextMenuItem onClick={() => ctx.onArchiveSession?.(sessionId, !isArchived)}>
          {isArchived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
          {isArchived ? t("session_management.unarchive_session") : t("session_management.archive_session")}
        </ContextMenuItem>
      ) : null}
      {ctx.onOpenDeleteSession ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => ctx.onOpenDeleteSession?.(sessionId)}>
            <Trash2 className="size-4" />
            {t("workspace_list.delete_session")}
          </ContextMenuItem>
        </>
      ) : null}
    </>
  );
}

function SessionActions({ className, sessionId, workspaceId, isPinned, isArchived }: SessionActionsProps) {
  if (!useCanManageSession()) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="size-6 text-muted-foreground"
        render={
          <Button variant="ghost" size="icon-sm" className={cn("size-6", className)}>
            <MoreHorizontal className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" side="bottom" sideOffset={4} alignOffset={-4} className="w-56">
        <SessionMenuContent
          variant="dropdown"
          sessionId={sessionId}
          workspaceId={workspaceId}
          isPinned={isPinned}
          isArchived={isArchived}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type SessionContextMenuProps = {
  children: React.ReactElement;
  sessionId: string;
  workspaceId: string;
  isPinned: boolean;
  isArchived: boolean;
};

function SessionContextMenu({ children, sessionId, workspaceId, isPinned, isArchived }: SessionContextMenuProps) {
  if (!useCanManageSession()) return children;

  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="w-56">
        <SessionMenuContent
          variant="context"
          sessionId={sessionId}
          workspaceId={workspaceId}
          isPinned={isPinned}
          isArchived={isArchived}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function RemoteConnectionIssueCard(props: {
  message: string;
  tone: "error" | "offline";
  canRecover: boolean;
  busy: boolean;
  onRecover: () => void;
  onTest: () => void;
  onEdit: () => void;
}) {
  const isOffline = props.tone === "offline";

  return (
    <SidebarMenuSubItem>
      <div
        className={cn(
          "w-full rounded-[15px] border border-red-7/35 bg-red-1/40 px-3 py-3 text-left",
          isOffline && "border-amber-7/35 bg-amber-2/45",
        )}
      >
        <div className="flex items-start gap-2.5">
          <div
            className={cn(
              "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-3/60 text-red-11",
              isOffline && "bg-amber-3/60 text-amber-11",
            )}
          >
            <AlertCircle size={14} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-dls-text">
              {t("workspace_list.remote_worker_unavailable")}
            </div>
            <div className="mt-1 text-[11px] leading-5 text-gray-10">
              {t("workspace_list.remote_worker_unavailable_hint")}
            </div>
            <div
              className={cn(
                "mt-2 rounded-lg border border-red-7/25 bg-red-1/40 px-2 py-1.5 text-[11px] leading-4 text-red-11 whitespace-pre-wrap wrap-anywhere",
                isOffline && "border-amber-7/25 bg-amber-1/40 text-amber-11",
              )}
              title={props.message}
            >
              {props.message}
            </div>
            <IPolloWorkDenHelpLink />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {props.canRecover ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 rounded-lg px-2 text-[11px]"
                  onClick={props.onRecover}
                  disabled={props.busy}
                >
                  <RotateCcw size={12} />
                  {t("workspace_list.recover")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 rounded-lg px-2 text-[11px]"
                onClick={props.onTest}
                disabled={props.busy}
              >
                <RefreshCw size={12} />
                {t("workspace_list.test_connection")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 rounded-lg px-2 text-[11px]"
                onClick={props.onEdit}
                disabled={props.busy}
              >
                <Settings size={12} />
                {t("common.edit")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </SidebarMenuSubItem>
  );
}

export type AppSidebarProps = {
  workspaceSessionGroups: WorkspaceSessionGroup[];
  showInitialLoading?: boolean;
  selectedWorkspaceId: string;
  developerMode: boolean;
  selectedSessionId: string | null;
  showSessionActions?: boolean;
  sessionStatusById?: Record<string, string>;
  connectingWorkspaceId: string | null;
  workspaceConnectionStateById: Record<string, WorkspaceConnectionState>;
  newTaskDisabled: boolean;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onCreateTaskInWorkspace: (
    workspaceId: string,
    type?: iPolloWorkSessionType,
    templateId?: iPolloWorkTemplateId,
    templateScope?: WorkContextId,
  ) => void;
  onOpenRenameSession?: (sessionId: string) => void;
  onOpenDeleteSession?: (sessionId: string) => void;
  onArchiveSession?: (sessionId: string, archived: boolean) => void;
  onOpenCreateGroupModal?: (workspaceId: string) => void;
  onRecoverWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onTestWorkspaceConnection: (workspaceId: string) => Promise<boolean> | boolean | void;
  onEditWorkspaceConnection: (workspaceId: string) => void;
  account: {
    loading: boolean;
    signedIn: boolean;
    name: string | null;
    email: string | null;
  };
  activePrimaryItem?: "template-market" | "extensions" | null;
  onOpenAccount: () => void;
  onOpenSettings: (route?: string) => void;
  onOpenHelp: () => void;
  onOpenTemplateMarket: () => void;
  onOpenExtensions: () => void;
  onSignIn: () => void;
  /** Opens the cross-session message search dialog (Cmd/Ctrl+Shift+F). */
  onOpenSessionSearch?: () => void;
  onStartResize?: React.PointerEventHandler<HTMLButtonElement>;
};

function useSessionTree(
  sessions: WorkspaceSessionGroup["sessions"],
  sessionStatusById: Record<string, string> | undefined,
) {
  return React.useMemo(
    () => buildSessionTreeState(sessions, sessionStatusById),
    [sessions, sessionStatusById],
  );
}

function isSessionActivityStatus(status: string | undefined): status is SessionActivityStatus {
  return status === "idle" || status === "thinking" || status === "responding" || status === "error" || status === "compacting" || status === "waiting";
}

export function AppSidebar(props: AppSidebarProps) {
  const activeEnterprise = useActiveEnterpriseConnection();
  const [previewCountByWorkspaceId, setPreviewCountByWorkspaceId] = React.useState<Record<string, number>>({});
  const [expandedSessionIds, setExpandedSessionIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [language, setLanguage] = React.useState<Language>(() => currentLocale());
  const switchLanguage = React.useCallback((nextLanguage: Language) => {
    setLanguage(nextLanguage);
    setLocale(nextLanguage);
  }, []);

  const toggleSessionExpanded = React.useCallback((sessionId: string) => {
    const id = sessionId.trim();
    if (!id) return;
    setExpandedSessionIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const previewCount = (workspaceId: string) =>
    previewCountByWorkspaceId[workspaceId] ?? MAX_SESSIONS_PREVIEW;

  const showMoreSessions = (workspaceId: string, totalRoots: number) => {
    setPreviewCountByWorkspaceId((current) => ({
      ...current,
      [workspaceId]: Math.min((current[workspaceId] ?? MAX_SESSIONS_PREVIEW) + MAX_SESSIONS_PREVIEW, totalRoots),
    }));
  };

  React.useEffect(() => {
    const workspaceId = props.selectedWorkspaceId.trim();
    if (!workspaceId) return;

    const group = props.workspaceSessionGroups.find(
      (entry) => entry.workspace.id === workspaceId,
    );
    if (!group?.sessions.length) return;

    const selectedId = props.selectedSessionId?.trim() ?? "";
    const selectedIndex = selectedId
      ? group.sessions.findIndex((session) => session.id === selectedId)
      : -1;
    const start = selectedIndex >= 0 ? Math.max(0, selectedIndex - 2) : 0;
    const end = selectedIndex >= 0
      ? Math.min(group.sessions.length, selectedIndex + 3)
      : Math.min(group.sessions.length, 4);

    group.sessions.slice(start, end).forEach((session) => {
      props.onPrefetchSession?.(workspaceId, session.id);
    });
  }, [
    props.onPrefetchSession,
    props.selectedSessionId,
    props.selectedWorkspaceId,
    props.workspaceSessionGroups,
  ]);

  const contextValue: SidebarContextValue = {
    selectedWorkspaceId: props.selectedWorkspaceId,
    selectedSessionId: props.selectedSessionId,
    developerMode: props.developerMode,
    showSessionActions: props.showSessionActions,
    sessionStatusById: props.sessionStatusById,
    newTaskDisabled: props.newTaskDisabled,
    connectingWorkspaceId: props.connectingWorkspaceId,
    workspaceConnectionStateById: props.workspaceConnectionStateById,
    onOpenSession: props.onOpenSession,
    onPrefetchSession: props.onPrefetchSession,
    onCreateTaskInWorkspace: props.onCreateTaskInWorkspace,
    onOpenRenameSession: props.onOpenRenameSession,
    onOpenDeleteSession: props.onOpenDeleteSession,
    onArchiveSession: props.onArchiveSession,
    onOpenCreateGroupModal: props.onOpenCreateGroupModal,
    onRecoverWorkspace: props.onRecoverWorkspace,
    onTestWorkspaceConnection: props.onTestWorkspaceConnection,
    onEditWorkspaceConnection: props.onEditWorkspaceConnection,
    toggleSessionExpanded,
    expandedSessionIds,
  };

  const brandLogoUrl = useBrandLogoUrl();
  const brandAppName = useBrandAppName();

  return (
    <SidebarContext.Provider value={contextValue}>
      <Sidebar
        collapsible="offcanvas"
        className="bg-sidebar mac:**:data-[sidebar=sidebar]:bg-transparent"
      >
        <SidebarHeader className="gap-4 px-2 pb-6 pt-1 mac:titlebar-drag">
          <div className="flex w-full justify-end px-3">
            <SidebarTrigger
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent active:bg-sidebar-accent mac:hover:bg-black/5 mac:active:bg-black/5 dark:mac:hover:bg-white/10 dark:mac:active:bg-white/10"
              icon={<img src={publicAssetUrl("sidebar-left-expand.svg")} alt="" className="h-3 w-4 shrink-0" />}
              aria-label={t("sidebar.collapse")}
              title={t("sidebar.collapse")}
            />
          </div>
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 px-3">
            {brandLogoUrl ? (
              <img
                src={brandLogoUrl}
                alt={`${brandAppName} logo`}
                className="max-h-9 w-auto max-w-[140px] object-contain object-left"
                data-testid="brand-logo"
              />
            ) : (
              <span className="truncate text-sm font-semibold" data-testid="brand-app-name">
                {brandAppName}
              </span>
            )}
            {props.onOpenSessionSearch ? (
              <button
                type="button"
                onClick={props.onOpenSessionSearch}
                aria-label={t("workspace_list.search_sessions")}
                aria-keyshortcuts={isMacPlatform() ? "Meta+Shift+F" : "Control+Shift+F"}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent active:bg-sidebar-accent mac:hover:bg-black/5 mac:active:bg-black/5 dark:mac:hover:bg-white/10 dark:mac:active:bg-white/10"
              >
                <img src={publicAssetUrl("sidebar-icon/search.svg")} alt="" className="size-6" />
              </button>
            ) : null}
          </div>
          <SidebarMenu className="gap-[6px]">
            <SidebarMenuItem>
              <SidebarMenuButton
                className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                disabled={props.newTaskDisabled || !props.selectedWorkspaceId}
                aria-label={t("session.new_task")}
                aria-keyshortcuts={isMacPlatform() ? "Meta+N" : "Control+N"}
                onClick={() => props.onCreateTaskInWorkspace(props.selectedWorkspaceId, "work")}
              >
                <img src={publicAssetUrl("sidebar-icon/edit.svg")} alt="" className="size-[22px] shrink-0 -me-1.5" />
                <span className="flex-1 truncate text-sm font-medium leading-none tracking-normal">{t("session.new_task")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={props.onOpenTemplateMarket}
                isActive={props.activePrimaryItem === "template-market"}
                className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <img src={publicAssetUrl("sidebar-icon/doc-plus.svg")} alt="" className="size-[22px] shrink-0 -translate-x-0.5 -me-1.5" />
                <span className="flex-1 truncate text-sm font-medium leading-none tracking-normal">{t("template_market.title")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={props.onOpenExtensions}
                isActive={props.activePrimaryItem === "extensions"}
                className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <img src={publicAssetUrl("sidebar-icon/plugin.svg")} alt="" className="size-[22px] shrink-0 -translate-x-0.5 -me-1.5" />
                <span className="flex-1 truncate text-sm font-medium leading-none tracking-normal">{t("settings.tab_extensions")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <LazyMotion features={domMax}>
          <m.div
            layoutScroll
            data-slot="sidebar-content"
            data-sidebar="content"
            className="no-scrollbar flex min-h-0 flex-1 flex-col gap-px overflow-auto [--radius:var(--radius-xl)] group-data-[collapsible=icon]:overflow-hidden"
          >
            {props.workspaceSessionGroups.slice(0, 1).map((group) => (
              <WorkspaceSidebarGroup
                key={group.workspace.id}
                group={group}
                className="mac:pt-0"
                showInitialLoading={props.showInitialLoading}
                previewCount={previewCount(group.workspace.id)}
                showMoreSessions={showMoreSessions}
              />
            ))}
          </m.div>
        </LazyMotion>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
              {props.account.loading ? (
                <SidebarMenuButton disabled className="h-9 rounded-lg px-2">
                  <Loader2 className="size-3.5 animate-spin" />
                  <span className="truncate text-xs">{t("den.checking_session")}</span>
                </SidebarMenuButton>
              ) : props.account.signedIn ? (
                <SidebarMenuButton
                  onClick={props.onOpenAccount}
                  className="h-9 gap-2 rounded-lg px-2"
                  aria-label={activeEnterprise?.name || props.account.name || props.account.email || t("settings.tab_cloud_account")}
                >
                  <MarbleAvatar seed={activeEnterprise?.id || props.account.email || props.account.name || "ipollowork"} className="size-5 shrink-0 rounded-full" />
                  <span className="min-w-0 flex-1 truncate text-left text-xs font-medium">
                    {activeEnterprise?.shortName || props.account.name || props.account.email}
                  </span>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton
                  onClick={props.onSignIn}
                  className="h-9 gap-2 rounded-lg px-2"
                  aria-label={t("den.signin_title")}
                >
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground">
                    <UserRound className="size-3" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left text-xs font-medium">{t("den.signin_button")}</span>
                </SidebarMenuButton>
              )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden mac:hover:bg-black/5 mac:active:bg-black/5 dark:mac:hover:bg-white/10 dark:mac:active:bg-white/10"
                  aria-label={t("status.settings")}
                  title={t("status.settings")}
                >
                  <Settings className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end" className="w-44 min-w-44">
                  <DropdownMenuItem onClick={() => props.onOpenSettings("/settings/general")}>
                    <Settings className="size-4" />
                    {t("status.settings")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={props.onOpenHelp}>
                    <HelpCircle className="size-4" />
                    {t("help.title")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Languages className="size-4" />
                      {t("settings.language")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-40 min-w-40">
                      <DropdownMenuRadioGroup
                        value={language}
                        onValueChange={(value) => {
                          if (value === "zh" || value === "en") switchLanguage(value);
                        }}
                      >
                        <DropdownMenuRadioItem value="zh">中文</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
              <NotificationBell className="shrink-0 rounded-lg text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail
          aria-label={props.onStartResize ? t("session.resize_workspace_column") : undefined}
          title={props.onStartResize ? t("session.resize_workspace_column") : undefined}
          onClick={props.onStartResize ? (event) => {
            event.preventDefault();
          } : undefined}
          onPointerDown={props.onStartResize}
        />
      </Sidebar>
    </SidebarContext.Provider>
  );
}

type WorkspaceSidebarGroupProps = {
  className: string;
  group: WorkspaceSessionGroup;
  showInitialLoading?: boolean;
  previewCount: number;
  showMoreSessions: (workspaceId: string, totalRoots: number) => void;
};

function WorkspaceSidebarGroup({
  className,
  group,
  showInitialLoading,
  previewCount,
  showMoreSessions,
}: WorkspaceSidebarGroupProps) {
  const ctx = useSidebarContext();
  const workspace = group.workspace;
  const tree = useSessionTree(group.sessions, ctx.sessionStatusById);

  const forcedExpandedSessionIds = React.useMemo(
    () => new Set(
      ctx.selectedSessionId
        ? tree.ancestorIdsBySessionId.get(ctx.selectedSessionId) ?? []
        : [],
    ),
    [ctx.selectedSessionId, tree.ancestorIdsBySessionId],
  );

  const isConnecting = ctx.connectingWorkspaceId === workspace.id;
  const connectionState: WorkspaceConnectionState = ctx.workspaceConnectionStateById[workspace.id] ?? {
    status: "idle",
    message: null,
  };
  const isConnectionActionBusy = isConnecting || connectionState.status === "connecting";
  const isRemoteWorkspace = isRemoteConnectionWorkspace(workspace);
  const canRecover = isRemoteWorkspace && connectionState.status === "error";
  const taskLoadError = getWorkspaceTaskLoadErrorDisplay(workspace, group.error);
  const connectionIssueMessage = connectionState.status === "error"
    ? connectionState.message?.trim() || taskLoadError.message
    : group.error?.trim() || taskLoadError.message;
  const showRemoteConnectionIssue =
    (isRemoteWorkspace || isRemoteConnectionErrorMessage(connectionIssueMessage)) &&
    Boolean(connectionIssueMessage) &&
    (connectionState.status === "error" || group.status === "error");
  const pinnedIds = usePinnedSessionIds();
  const orderIds = useSessionOrder(workspace.id);
  const { groups: wsGroups, assignments: wsAssignments } = useWorkspaceGroups(workspace.id);
  const store = useSessionManagementStore;

  const { active: activeSessions, archived: archivedSessions } = React.useMemo(
    () => partitionArchivedSessions(group.sessions),
    [group.sessions],
  );
  const sessionRows = flattenSessionRows(
    group.sessions,
    wsGroups.length > 0 ? Number.MAX_SAFE_INTEGER : previewCount,
    tree,
    ctx.expandedSessionIds,
    forcedExpandedSessionIds,
    pinnedIds,
    orderIds,
  );
  const visibleRootIds = React.useMemo(
    () => sessionRows.flatMap((row) => (row.depth === 0 ? [row.session.id] : [])),
    [sessionRows],
  );
  const activeRootCount = React.useMemo(
    () => getRootSessions(activeSessions).length,
    [activeSessions],
  );
  const [archivedExpanded, setArchivedExpanded] = React.useState(false);
  const remainingRootSessions = Math.max(0, activeRootCount - previewCount);
  const showMoreLabel = remainingRootSessions > 0
    ? t("workspace_list.show_more", {
      count: Math.min(MAX_SESSIONS_PREVIEW, remainingRootSessions),
    })
    : t("workspace_list.show_more_fallback");

  return (
    <SidebarGroup className={className}>
      <SidebarGroupContent>
        <SidebarMenu>
          <Collapsible render={<SidebarMenuItem />} open className="group/collapsible">
            <CollapsibleContent>
              <SidebarMenuSub>
                {showRemoteConnectionIssue ? (
                  <RemoteConnectionIssueCard
                    message={connectionIssueMessage}
                    tone={taskLoadError.tone}
                    canRecover={canRecover}
                    busy={isConnectionActionBusy}
                    onRecover={() => {
                      void Promise.resolve(ctx.onRecoverWorkspace(workspace.id));
                    }}
                    onTest={() => {
                      void Promise.resolve(ctx.onTestWorkspaceConnection(workspace.id));
                    }}
                    onEdit={() => {
                      ctx.onEditWorkspaceConnection(workspace.id);
                    }}
                  />
                ) : showInitialLoading || (group.status === "loading" && group.sessions.length === 0) ? (
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton aria-disabled className="text-muted-foreground text-xs truncate">
                      <span className="truncate">{t("workspace.loading_tasks")}</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ) : activeSessions.length > 0 || archivedSessions.length > 0 ? (
                  <>
                    {wsGroups.length > 0 ? (
                      <GroupedSessionList
                        sessionRows={sessionRows}
                        groups={wsGroups}
                        assignments={wsAssignments}
                        pinnedIds={pinnedIds}
                        tree={tree}
                        workspaceId={workspace.id}
                        forcedExpandedSessionIds={forcedExpandedSessionIds}
                        store={store}
                      />
                    ) : (
                      <Reorder.Group
                        as="div"
                        axis="y"
                        values={visibleRootIds}
                        onReorder={(ids) => {
                          const visible = new Set(ids);
                          const allRootIds = getRootSessions(activeSessions).map((s) => s.id);
                          const full = [...ids, ...allRootIds.filter((id) => !visible.has(id))];
                          store.getState().reorderSessions(workspace.id, full);
                        }}
                        className="flex flex-col gap-[6px]"
                      >
                        {sessionRows.map((row) => (
                          <SessionMenuItem
                            key={row.session.id}
                            session={row.session}
                            depth={row.depth}
                            tree={tree}
                            workspaceId={workspace.id}
                            forcedExpandedSessionIds={forcedExpandedSessionIds}
                            isPinned={pinnedIds.has(row.session.id)}
                            draggable={row.depth === 0}
                          />
                        ))}
                      </Reorder.Group>
                    )}
                    {wsGroups.length === 0 && activeRootCount > previewCount ? (
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton
                          className="text-muted-foreground text-xs"
                          onClick={() => showMoreSessions(workspace.id, activeRootCount)}
                        >
                          <span className="flex min-w-0 items-center gap-1">
                            <span className="truncate">{showMoreLabel}</span>
                            <span aria-hidden className="shrink-0">⋅</span>
                            <span
                              role="button"
                              tabIndex={0}
                              className="shrink-0 hover:text-foreground"
                              onClick={(event) => {
                                event.stopPropagation();
                                ctx.onOpenCreateGroupModal?.(workspace.id);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") return;
                                event.preventDefault();
                                event.stopPropagation();
                                ctx.onOpenCreateGroupModal?.(workspace.id);
                              }}
                            >
                              {t("session_management.create_group")}
                            </span>
                          </span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ) : null}
                    {archivedSessions.length > 0 ? (
                      <ArchivedSessionsSection
                        sessions={archivedSessions}
                        tree={tree}
                        workspaceId={workspace.id}
                        forcedExpandedSessionIds={forcedExpandedSessionIds}
                        expanded={archivedExpanded}
                        onToggle={() => setArchivedExpanded((value) => !value)}
                      />
                    ) : null}
                  </>
                ) : group.status === "error" ? (
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      aria-disabled
                      className={cn("text-xs", taskLoadError.tone === "offline" ? "text-amber-600" : "text-destructive")}
                    >
                      <span className="truncate">{taskLoadError.message}</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ) : (
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      className="text-muted-foreground text-xs"
                      onClick={() => ctx.onCreateTaskInWorkspace(workspace.id)}
                      aria-disabled={ctx.newTaskDisabled}
                    >
                      <span className="truncate">
                        {isRemoteWorkspace && connectionState.status === "connected"
                          ? connectionState.message?.trim() || t("workspace.connected_no_tasks")
                          : t("workspace.no_tasks")}
                      </span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                )}
              </SidebarMenuSub>
            </CollapsibleContent>
          </Collapsible>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

const SESSION_DRAG_TYPE = "application/x-ipollowork-session-id";
const UNGROUPED_GROUP_ID = "__ipollowork_ungrouped";

function SessionGroupSeparator({ label, count, expanded, onToggle, onRemove, onTitlePointerDown }: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  onTitlePointerDown?: React.PointerEventHandler<HTMLSpanElement>;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="group/separator flex w-full items-center gap-1.5 rounded px-2 pb-1 pt-2.5 text-left transition-colors first:pt-1 hover:bg-sidebar-accent/50"
      aria-expanded={expanded}
    >
      <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-200", expanded && "rotate-90")} />
      <span
        className="min-w-0 flex-1 cursor-grab touch-none truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground active:cursor-grabbing"
        onPointerDown={onTitlePointerDown}
      >
        {label}
      </span>
      <span className="text-[10px] tabular-nums text-muted-foreground/70">{count}</span>
      {onRemove ? (
        <span
          role="button"
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
          className="ml-auto size-4 shrink-0 text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover/separator:opacity-100"
          aria-label={t("session_management.remove_group")}
        >
          <Trash2 className="size-3" />
        </span>
      ) : null}
    </button>
  );
}

/** Drop zone wrapping a group's header + sessions. Dropping a session anywhere in the zone assigns it to this group. */
function GroupDropZone({ groupId, workspaceId, children }: {
  groupId: string | null;
  workspaceId: string;
  children: React.ReactNode;
}) {
  const [dragOver, setDragOver] = React.useState(false);
  const store = useSessionManagementStore;

  return (
    <div
      className={cn(
        "rounded transition-colors",
        dragOver && "bg-accent/40 ring-1 ring-accent/60",
      )}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(SESSION_DRAG_TYPE)) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        // Only clear when leaving this container, not when entering a child.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDragOver(false);
        }
      }}
      onDrop={(e) => {
        setDragOver(false);
        const sessionId = e.dataTransfer.getData(SESSION_DRAG_TYPE);
        if (sessionId) {
          store.getState().assignGroup(workspaceId, sessionId, groupId);
        }
      }}
    >
      {children}
    </div>
  );
}

/** Renders sessions partitioned by group. Empty groups always show. Ungrouped sessions render at the end. */
function GroupedSessionList({ sessionRows, groups, assignments, pinnedIds, tree, workspaceId, forcedExpandedSessionIds, store }: {
  sessionRows: FlattenedSessionRow[];
  groups: SessionGroupDefinition[];
  assignments: Record<string, string>;
  pinnedIds: Set<string>;
  tree: SessionTreeState;
  workspaceId: string;
  forcedExpandedSessionIds: Set<string>;
  store: typeof useSessionManagementStore;
}) {
  const [previewCountByGroup, setPreviewCountByGroup] = React.useState<Record<string, number>>({});

  const groupPreviewCount = (groupId: string) =>
    previewCountByGroup[groupId] ?? MAX_SESSIONS_PREVIEW;

  const showMoreInGroup = React.useCallback((groupId: string, totalCount: number) => {
    setPreviewCountByGroup((current) => ({
      ...current,
      [groupId]: Math.min(
        (current[groupId] ?? MAX_SESSIONS_PREVIEW) + MAX_SESSIONS_PREVIEW,
        totalCount,
      ),
    }));
  }, []);

  // Partition root rows into per-group buckets + ungrouped.
  const rootRowsByGroup = new Map<string, FlattenedSessionRow[]>();
  const ungroupedRows: FlattenedSessionRow[] = [];
  // Child rows follow their parent regardless of group.
  const childrenByParent = new Map<string, FlattenedSessionRow[]>();
  const rowIndexById = new Map(sessionRows.map((row, index) => [row.session.id, index]));

  for (const row of sessionRows) {
    if (row.depth > 0) {
      const rowIndex = rowIndexById.get(row.session.id);
      if (rowIndex === undefined) continue;
      let parentId: string | null = null;
      for (let j = rowIndex - 1; j >= 0; j--) {
        if (sessionRows[j].depth < row.depth) { parentId = sessionRows[j].session.id; break; }
      }
      if (parentId) {
        const kids = childrenByParent.get(parentId) ?? [];
        kids.push(row);
        childrenByParent.set(parentId, kids);
      }
      continue;
    }
    const groupId = assignments[row.session.id];
    if (groupId && groups.some((g) => g.id === groupId)) {
      const bucket = rootRowsByGroup.get(groupId) ?? [];
      bucket.push(row);
      rootRowsByGroup.set(groupId, bucket);
    } else {
      ungroupedRows.push(row);
    }
  }

  const renderRow = (row: FlattenedSessionRow) => (
    <React.Fragment key={row.session.id}>
      <SessionMenuItem
        session={row.session}
        depth={row.depth}
        tree={tree}
        workspaceId={workspaceId}
        forcedExpandedSessionIds={forcedExpandedSessionIds}
        isPinned={pinnedIds.has(row.session.id)}
      />
      {(childrenByParent.get(row.session.id) ?? []).map(renderRow)}
    </React.Fragment>
  );

  const renderGroup = (group: SessionGroupDefinition) => {
    const rows = rootRowsByGroup.get(group.id) ?? [];
    const expanded = !(store.getState().groupsByWorkspace[workspaceId]?.collapsedGroupIds ?? []).includes(group.id);
    const limit = groupPreviewCount(group.id);

    return (
      <SessionGroupSection
        key={group.id}
        group={group}
        rows={rows}
        expanded={expanded}
        workspaceId={workspaceId}
        store={store}
        renderRow={renderRow}
        previewCount={limit}
        onShowMore={() => showMoreInGroup(group.id, rows.length)}
      />
    );
  };

  const ungroupedExpanded = !(store.getState().groupsByWorkspace[workspaceId]?.collapsedGroupIds ?? []).includes(UNGROUPED_GROUP_ID);
  const ungroupedLimit = groupPreviewCount(UNGROUPED_GROUP_ID);
  const visibleUngroupedRows = ungroupedRows.slice(0, ungroupedLimit);
  const ungroupedRemaining = Math.max(0, ungroupedRows.length - ungroupedLimit);
  const visibleUngroupedRootIds = visibleUngroupedRows.map((r) => r.session.id);

  return (
    <>
      <Reorder.Group
        as="div"
        axis="y"
        values={groups.map((group) => group.id)}
        onReorder={(ids) => store.getState().reorderGroups(workspaceId, ids)}
        className="flex flex-col"
      >
        {groups.map(renderGroup)}
      </Reorder.Group>
      {ungroupedRows.length > 0 ? (
        <GroupDropZone groupId={null} workspaceId={workspaceId}>
          <Collapsible
            open={ungroupedExpanded}
            onOpenChange={() => store.getState().toggleGroupExpanded(workspaceId, UNGROUPED_GROUP_ID)}
          >
            <SessionGroupSeparator
              label={t("session_management.ungrouped")}
              count={ungroupedRows.length}
              expanded={ungroupedExpanded}
              onToggle={() => store.getState().toggleGroupExpanded(workspaceId, UNGROUPED_GROUP_ID)}
            />
            <CollapsibleContent>
              <Reorder.Group
                as="div"
                axis="y"
                values={visibleUngroupedRootIds}
                onReorder={(ids) => {
                  const allRootIds = sessionRows.filter((r) => r.depth === 0).map((r) => r.session.id);
                  const ungroupedSet = new Set(ungroupedRows.map((r) => r.session.id));
                  const visibleSet = new Set(ids);
                  const fullUngrouped = [...ids, ...ungroupedRows.map((r) => r.session.id).filter((id) => !visibleSet.has(id))];
                  let ui = 0;
                  const full = allRootIds.map((id) => ungroupedSet.has(id) ? fullUngrouped[ui++] : id);
                  store.getState().reorderSessions(workspaceId, full);
                }}
                className="flex flex-col gap-[6px]"
              >
                {visibleUngroupedRows.map((row) => (
                  <React.Fragment key={row.session.id}>
                    <SessionMenuItem
                      session={row.session}
                      depth={row.depth}
                      tree={tree}
                      workspaceId={workspaceId}
                      forcedExpandedSessionIds={forcedExpandedSessionIds}
                      isPinned={pinnedIds.has(row.session.id)}
                      draggable={row.depth === 0}
                    />
                    {(childrenByParent.get(row.session.id) ?? []).map(renderRow)}
                  </React.Fragment>
                ))}
              </Reorder.Group>
              {ungroupedRemaining > 0 ? (
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton
                    className="text-muted-foreground text-xs"
                    onClick={() => showMoreInGroup(UNGROUPED_GROUP_ID, ungroupedRows.length)}
                  >
                    <span className="truncate">
                      {t("workspace_list.show_more", { count: Math.min(MAX_SESSIONS_PREVIEW, ungroupedRemaining) })}
                    </span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ) : null}
            </CollapsibleContent>
          </Collapsible>
        </GroupDropZone>
      ) : null}
    </>
  );
}

function SessionGroupSection({ group, rows, expanded, workspaceId, store, renderRow, previewCount, onShowMore }: {
  group: SessionGroupDefinition;
  rows: FlattenedSessionRow[];
  expanded: boolean;
  workspaceId: string;
  store: typeof useSessionManagementStore;
  renderRow: (row: FlattenedSessionRow) => React.ReactNode;
  previewCount: number;
  onShowMore: () => void;
}) {
  const dragControls = useDragControls();
  const visibleRows = rows.slice(0, previewCount);
  const remaining = Math.max(0, rows.length - previewCount);

  return (
    <Reorder.Item
      as="div"
      value={group.id}
      id={group.id}
      layout="position"
      dragElastic={0}
      dragListener={false}
      dragControls={dragControls}
      transformTemplate={(_latest, generated) => generated.replace(/ ?scale[XY]?\([^)]*\)/g, "")}
    >
      <GroupDropZone groupId={group.id} workspaceId={workspaceId}>
        <Collapsible
          open={expanded}
          onOpenChange={() => store.getState().toggleGroupExpanded(workspaceId, group.id)}
          className="group/session-group"
        >
          <SessionGroupSeparator
            label={group.label}
            count={rows.length}
            expanded={expanded}
            onToggle={() => store.getState().toggleGroupExpanded(workspaceId, group.id)}
            onRemove={() => store.getState().removeGroup(workspaceId, group.id)}
            onTitlePointerDown={(event) => dragControls.start(event)}
          />
          <CollapsibleContent>
            {visibleRows.length > 0
              ? (
                <>
                  {visibleRows.map(renderRow)}
                  {remaining > 0 ? (
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        className="text-muted-foreground text-xs"
                        onClick={onShowMore}
                      >
                        <span className="truncate">
                          {t("workspace_list.show_more", { count: Math.min(MAX_SESSIONS_PREVIEW, remaining) })}
                        </span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ) : null}
                </>
              )
              : (
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton aria-disabled className="text-muted-foreground text-xs italic">
                    <span className="truncate">{t("session_management.empty_group")}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )}
          </CollapsibleContent>
        </Collapsible>
      </GroupDropZone>
    </Reorder.Item>
  );
}

function PinnedIndicator({ isPinned }: { isPinned: boolean }) {
  if (!isPinned) return null;
  return (
    <Pin
      className="size-3 shrink-0 text-muted-foreground/70"
      aria-label={t("session_management.pinned")}
    />
  );
}

type SessionMenuItemProps = {
  session: SessionListItem;
  depth: number;
  tree: SessionTreeState;
  workspaceId: string;
  forcedExpandedSessionIds: Set<string>;
  isPinned?: boolean;
  draggable?: boolean;
};

function SessionMenuItem({
  session,
  tree,
  workspaceId,
  forcedExpandedSessionIds,
  depth,
  isPinned = false,
  draggable = false,
}: SessionMenuItemProps) {
  const ctx = useSidebarContext();
  const isSelected = ctx.selectedSessionId === session.id;
  const displayTitle = getDisplaySessionTitle(session.title);
  const hasChildren = (tree.descendantCountBySessionId.get(session.id) ?? 0) > 0;
  const isExpanded = ctx.expandedSessionIds.has(session.id) || forcedExpandedSessionIds.has(session.id);
  const sessionActivityStatus = ctx.sessionStatusById?.[session.id];
  const isSessionActive = tree.activeIds.has(session.id);
  const isSessionStreaming = tree.streamingIds.has(session.id) || isStreamingSessionStatus(sessionActivityStatus);
  const isArchived = isSessionArchived(session);

  const openSession = () => {
    ctx.onOpenSession(workspaceId, session.id);
  };

  const prefetchSession = () => {
    if (workspaceId !== ctx.selectedWorkspaceId) {
      return;
    }

    ctx.onPrefetchSession?.(workspaceId, session.id);
  };

  const dragProps = depth === 0 ? {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(SESSION_DRAG_TYPE, session.id);
      e.dataTransfer.effectAllowed = "move";
    },
  } : {};

  const item = hasChildren ? (
    <Collapsible
      open={isExpanded}
      onOpenChange={() => ctx.toggleSessionExpanded(session.id)}
      className="group/session-collapsible"
    >
      <SidebarMenuSubItem {...dragProps}>
        <SessionContextMenu sessionId={session.id} workspaceId={workspaceId} isPinned={isPinned} isArchived={isArchived}>
          <CollapsibleTrigger
            render={
              <SidebarMenuSubButton
                className={cn("relative ps-8", depth > 0 && "ps-12")}
                isActive={isSelected}
                onClick={openSession}
                onPointerEnter={prefetchSession}
                onFocus={prefetchSession}
              >
                <PinnedIndicator isPinned={isPinned} />
                <span
                  className={cn("min-w-0 flex-1 truncate transition-[padding] duration-75 group-hover/menu-sub-item:pe-12 group-has-data-popup-open/menu-sub-item:pe-12 pe-4", isSessionStreaming || isSessionActive && "pe-12")}
                  title={displayTitle}
                >
                  {displayTitle}
                </span>
                <span className="flex items-center justify-center size-6 absolute right-2 top-1/2 -translate-y-1/2">
                  <ChevronRight className="size-4 text-muted-foreground transition-transform duration-200 group-data-open/session-collapsible:rotate-90 hover:text-foreground" />
                </span>
              </SidebarMenuSubButton>
            }
          />
        </SessionContextMenu>
        <SessionActions
          sessionId={session.id}
          workspaceId={workspaceId}
          isPinned={isPinned}
          isArchived={isArchived}
          className="absolute right-9 top-1/2 -translate-y-1/2 opacity-0 group-hover/menu-sub-item:opacity-100 data-popup-open:opacity-100"
        />
        <SessionStatusIndicator className="absolute right-9 top-1/2 -translate-y-1/2 opacity-0 group-hover/menu-sub-item:opacity-0 group-has-data-popup-open/menu-sub-item:opacity-0 pointer-events-none select-none" status={sessionActivityStatus} isStreaming={isSessionStreaming} isActive={isSessionActive} />
      </SidebarMenuSubItem>
    </Collapsible>
  ) : (
    <SidebarMenuSubItem {...dragProps}>
      <SessionContextMenu sessionId={session.id} workspaceId={workspaceId} isPinned={isPinned} isArchived={isArchived}>
        <SidebarMenuSubButton
          isActive={isSelected}
          onClick={openSession}
          onPointerEnter={prefetchSession}
          onFocus={prefetchSession}
          className={cn("ps-8 transition-[padding] duration-75 group-hover/menu-sub-item:pe-8 group-has-data-popup-open/menu-sub-item:pe-8", depth > 0 && "ps-12")}
        >
          <PinnedIndicator isPinned={isPinned} />
          <span
            className={cn("min-w-0 flex-1 truncate pe-4 transition-[padding] duration-75 group-hover/menu-sub-item:pe-8 group-has-data-popup-open/menu-sub-item:pe-8", isSessionStreaming || isSessionActive && "pe-8")}
            title={displayTitle}
          >
            {displayTitle}
          </span>
        </SidebarMenuSubButton>
      </SessionContextMenu>
      <SessionActions
        sessionId={session.id}
        workspaceId={workspaceId}
        isPinned={isPinned}
        isArchived={isArchived}
        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/menu-sub-item:opacity-100 data-popup-open:opacity-100"
      />
      <SessionStatusIndicator className="absolute right-3 top-1/2 -translate-y-1/2 opacity-100 group-hover/menu-sub-item:opacity-0 group-has-data-popup-open/menu-sub-item:opacity-0 pointer-events-none select-none" status={sessionActivityStatus} isStreaming={isSessionStreaming} isActive={isSessionActive} />
    </SidebarMenuSubItem>
  );

  if (!draggable) return item;

  return (
    <Reorder.Item
      as="div"
      value={session.id}
      id={session.id}
      layout="position"
      dragElastic={0}
      transformTemplate={(_latest, generated) => generated.replace(/ ?scale[XY]?\([^)]*\)/g, "")}
    >
      {item}
    </Reorder.Item>
  );
}

type ArchivedSessionsSectionProps = {
  sessions: SessionListItem[];
  tree: SessionTreeState;
  workspaceId: string;
  forcedExpandedSessionIds: Set<string>;
  expanded: boolean;
  onToggle: () => void;
};

function ArchivedSessionsSection({
  sessions,
  tree,
  workspaceId,
  forcedExpandedSessionIds,
  expanded,
  onToggle,
}: ArchivedSessionsSectionProps) {
  const pinned = usePinnedSessionIds();
  return (
    <Collapsible open={expanded} onOpenChange={onToggle} className="group/archived">
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className="group/separator flex w-full cursor-pointer items-center gap-1.5 px-2 pb-1 pt-2.5 rounded transition-colors hover:bg-sidebar-accent/50"
          >
            <Archive className="size-3 shrink-0 text-muted-foreground" />
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("session_management.archived_label")}
            </span>
            <span className="text-[10px] tabular-nums text-muted-foreground/70">{sessions.length}</span>
            <ChevronRight className="ml-auto size-3.5 text-muted-foreground transition-transform duration-200 group-data-open/archived:rotate-90" />
          </button>
        }
      />
      <CollapsibleContent>
        {sessions.map((session) => (
          <SessionMenuItem
            key={session.id}
            session={session}
            depth={0}
            tree={tree}
            workspaceId={workspaceId}
            forcedExpandedSessionIds={forcedExpandedSessionIds}
            isPinned={pinned.has(session.id)}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
