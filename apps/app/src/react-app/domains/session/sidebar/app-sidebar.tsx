/** @jsxImportSource react */
import * as React from "react";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Cpu,
  Ellipsis,
  FolderOpen,
  LayoutTemplate,
  Loader2,
  Languages,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  SquarePen,
  Trash2,
  RefreshCw,
  RotateCcw,
  Settings,
  HelpCircle,
  Sparkles,
  ToolCase,
  ToyBrick,
  UserRound,
} from "lucide-react";
import { LazyMotion, domMax, m } from "motion/react";
import {
  CODEX_HARNESS_ENGINE_ID,
  DEEPSEEK_HARNESS_ENGINE_ID,
  DEFAULT_ENGINE_ID,
} from "@ipollowork/types/workspace";

import { getDisplaySessionTitle } from "../../../../app/lib/session-title";
import type { WorkContextId } from "../../../../app/lib/work-context";
import { IPolloWorkDenHelpLink } from "../../workspace/ipollowork-den-help-link";
import type {
  WorkspaceConnectionState,
  ProjectSessionList,
} from "../../../../app/types";
import {
  isRemoteConnectionErrorMessage,
  getWorkspaceTaskLoadErrorDisplay,
  isRemoteConnectionWorkspace,
  isMacPlatform,
} from "../../../../app/utils";
import { currentLocale, localeChangedEvent, setLocale, t, type Language } from "../../../../i18n";
import { DEFAULT_BRAND_LOGO_URL, useBrandAppName, useBrandLogoUrl } from "../../cloud/brand-theme";

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
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import type {
  SidebarContextValue,
  SidebarDragPayload,
  SidebarDropTarget,
  iPolloWorkSessionType,
  iPolloWorkTemplateId,
} from "./app-sidebar-provider";
import {
  MAX_SESSIONS_PREVIEW,
  buildSidebarArchivedSessions,
  buildSessionTreeState,
  buildSidebarLayoutView,
  flattenSessionRows,
  getRootSessions,
  isSessionArchived,
  isStreamingSessionStatus,
  visibleProjectSessionLists,
  workspaceLabel,
} from "./utils";
import { sessionLayoutKey, useSidebarLayoutStore } from "./sidebar-layout-store";
import type { FlattenedSessionRow, SidebarDisplaySession, SessionListItem, SessionTreeState } from "./utils";
import {
  usePinnedSessionIds,
  useSessionPinStore,
} from "./session-pin-store";
import { cn } from "@/lib/utils";
import { MarbleAvatar } from "../../../design-system/marble-avatar";
import { getSessionActivityStatusLabel, type SessionActivityStatus } from "../status/session-activity-store";
import { NotificationBell } from "../../../shell/notification-center";
import { useShellConfig } from "../../../shell/shell-config";
import { useActiveEnterpriseConnection } from "@/react-app/domains/enterprise/use-active-enterprise-connection";
import { NAVIGATION_ICON_STROKE_WIDTH, ProjectFolderIcon } from "@/components/navigation-icons";

const SIDEBAR_ICON_STROKE_WIDTH = NAVIGATION_ICON_STROKE_WIDTH;

interface SessionStatusIndicatorProps {
  className?: string;
  status?: string;
  isStreaming: boolean;
  isActive: boolean;
}

function workspaceEngineLabel(engineId?: string | null) {
  const resolvedEngineId = engineId?.trim() || DEFAULT_ENGINE_ID;
  if (resolvedEngineId === CODEX_HARNESS_ENGINE_ID) return t("projects.engine_codex");
  if (resolvedEngineId === DEEPSEEK_HARNESS_ENGINE_ID) return t("projects.engine_dsh");
  if (resolvedEngineId === DEFAULT_ENGINE_ID) return t("projects.engine_opencode");
  return resolvedEngineId;
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
  const store = useSessionPinStore;

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
            <Button
            variant="ghost"
            size="icon-sm"
            className={cn("size-6", className)}
              onClick={(event) => event.stopPropagation()}
              draggable={false}
              onDragStart={(event) => event.stopPropagation()}
          >
            <span className="flex size-4 items-center justify-center" aria-hidden="true">
              <Ellipsis className="size-3.5" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} />
            </span>
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
  projectSessionLists: ProjectSessionList[];
  workContextId?: string;
  selectedWorkspaceId: string;
  developerMode: boolean;
  selectedSessionId: string | null;
  showSessionActions?: boolean;
  sessionStatusById?: Record<string, string>;
  connectingWorkspaceId: string | null;
  workspaceConnectionStateById: Record<string, WorkspaceConnectionState>;
  newTaskDisabled: boolean;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onSelectProject: (workspaceId: string) => Promise<boolean> | boolean | void;
  onOpenCreateProject?: () => void;
  onCreateProjectBuilder?: (workspaceId: string) => void | Promise<void>;
  onOpenRenameProject: (workspaceId: string) => void;
  onRevealProject: (workspaceId: string) => void;
  onOpenDeleteProject: (workspaceId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onCreateTaskInWorkspace: (
    workspaceId: string,
    type?: iPolloWorkSessionType,
    templateId?: iPolloWorkTemplateId,
    templateScope?: WorkContextId,
  ) => Promise<string | null> | string | null | void;
  onOpenRenameSession?: (sessionId: string) => void;
  onOpenDeleteSession?: (sessionId: string) => void;
  onArchiveSession?: (sessionId: string, archived: boolean) => void;
  onRecoverWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onTestWorkspaceConnection: (workspaceId: string) => Promise<boolean> | boolean | void;
  onEditWorkspaceConnection: (workspaceId: string) => void;
  account: {
    loading: boolean;
    signedIn: boolean;
    name: string | null;
    email: string | null;
  };
  activePrimaryItem?: "template-market" | "schedule" | "extensions" | "plugin-workshop" | null;
  onOpenAccount: () => void;
  onOpenSettings: (route?: string) => void;
  onOpenHelp: () => void;
  onOpenTemplateMarket: () => void;
  onOpenSchedule: () => void;
  onOpenExtensions: () => void;
  onOpenPluginWorkshop: () => void;
  onSignIn: () => void;
  /** Opens the cross-session message search dialog (Cmd/Ctrl+Shift+F). */
  onOpenSessionSearch?: () => void;
  onStartResize?: React.PointerEventHandler<HTMLButtonElement>;
};

type SidebarSectionHeaderProps = {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  toggleTestId: string;
  onAdd?: () => void;
  addLabel?: string;
  addTestId?: string;
};

function SidebarSectionHeader({
  label,
  expanded,
  onToggle,
  toggleTestId,
  onAdd,
  addLabel,
  addTestId,
}: SidebarSectionHeaderProps) {
  return (
    <div className="group/section flex h-8 shrink-0 items-center gap-1 px-4">
      <button
        type="button"
        onClick={onToggle}
        className="flex h-8 min-w-0 flex-1 select-none items-center gap-2 rounded-md text-left text-sm font-medium text-muted-foreground transition-colors hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:outline-hidden"
        aria-label={label}
        aria-expanded={expanded}
        data-testid={toggleTestId}
      >
        <span className="min-w-0 truncate">{label}</span>
        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm opacity-0 transition-[opacity,transform] group-hover/section:opacity-100 group-focus-within/section:opacity-100">
          <ChevronDown
            className={cn("size-3.5 transition-transform duration-200", !expanded && "-rotate-90")}
            strokeWidth={SIDEBAR_ICON_STROKE_WIDTH}
          />
        </span>
      </button>
      {onAdd && addLabel ? (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:outline-hidden"
          aria-label={addLabel}
          title={addLabel}
          data-testid={addTestId}
        >
          <Plus className="size-3.5" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

const primarySidebarActionClassName = "h-8 gap-2 rounded-[8px] px-2 py-0 text-sm font-normal leading-4 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground disabled:opacity-40 focus-visible:ring-1 [&_[data-sidebar-primary-icon]]:text-muted-foreground [&_[data-sidebar-primary-icon]]:transition-colors hover:[&_[data-sidebar-primary-icon]]:text-sidebar-accent-foreground data-active:[&_[data-sidebar-primary-icon]]:text-sidebar-accent-foreground";

function useSessionTree(
  sessions: ProjectSessionList["sessions"],
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
  const layout = useSidebarLayoutStore();
  const contextId = props.workContextId?.trim() || "personal";
  const [expandedSessionIds, setExpandedSessionIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [language, setLanguage] = React.useState<Language>(() => currentLocale());
  const [projectsExpanded, setProjectsExpanded] = React.useState(true);
  const [archivedExpanded, setArchivedExpanded] = React.useState(false);
  const sourceProjects = React.useMemo(
    () => visibleProjectSessionLists(props.projectSessionLists),
    [props.projectSessionLists],
  );
  const namedProjects = React.useMemo(
    () => buildSidebarLayoutView(props.projectSessionLists, layout, contextId),
    [contextId, layout, props.projectSessionLists],
  );
  const archivedSessions = React.useMemo(
    () => buildSidebarArchivedSessions(props.projectSessionLists),
    [props.projectSessionLists],
  );
  const sourceProjectBySessionKey = React.useMemo(() => {
    const result: Record<string, string> = {};
    for (const project of sourceProjects) {
      for (const session of project.sessions) {
        result[sessionLayoutKey(project.workspace.id, session.id)] = project.workspace.id;
      }
    }
    return result;
  }, [sourceProjects]);
  const sessionKeys = React.useMemo(() => Object.keys(sourceProjectBySessionKey), [sourceProjectBySessionKey]);
  const [draggingItem, setDraggingItem] = React.useState<SidebarDragPayload | null>(null);
  const [dropTarget, setDropTarget] = React.useState<SidebarDropTarget>(null);
  const selectedProject = namedProjects.find((project) => project.workspace.id === props.selectedWorkspaceId)
    ?? namedProjects[0];
  const primarySidebarActionClass = cn(
    primarySidebarActionClassName,
    language === "zh" && "font-medium",
  );
  const switchLanguage = React.useCallback((nextLanguage: Language) => {
    setLanguage(nextLanguage);
    setLocale(nextLanguage);
  }, []);

  React.useEffect(() => {
    layout.prune({
      contextId,
      projectIds: sourceProjects.map((project) => project.workspace.id),
      sessionKeys,
      sourceProjectBySessionKey,
    });
  }, [contextId, layout, sessionKeys, sourceProjectBySessionKey, sourceProjects]);

  const handleDragStart = React.useCallback((payload: SidebarDragPayload) => {
    setDraggingItem(payload);
  }, []);

  const handleDragEnd = React.useCallback(() => {
    setDraggingItem(null);
    setDropTarget(null);
  }, []);

  const handleDragOver = React.useCallback((target: Exclude<SidebarDropTarget, null>, event: React.DragEvent<HTMLElement>) => {
    const current = draggingItem;
    if (!current) return;
    const allowed = current.kind === "project"
      ? target.kind === "project" && current.id !== target.id
      : target.kind === "project" || (target.kind === "session" && current.key !== target.key);
    if (!allowed) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(target);
  }, [draggingItem]);

  const handleDrop = React.useCallback((target: Exclude<SidebarDropTarget, null>, event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    const current = draggingItem;
    if (!current) return;
    if (current.kind === "project" && target.kind === "project") {
      layout.reorderProjects(contextId, current.id, target.id);
    } else if (current.kind === "session" && target.kind === "project") {
      layout.moveSession(current.key, target.id);
    } else if (current.kind === "session" && target.kind === "session") {
      const targetProject = namedProjects.find((project) => project.sessions.some((session) => (
        sessionLayoutKey(session.sourceWorkspaceId, session.id) === target.key
      )));
      if (targetProject) {
        layout.moveSession(current.key, targetProject.workspace.id);
        layout.reorderSessions(targetProject.workspace.id, current.key, target.key);
      }
    }
    handleDragEnd();
  }, [contextId, draggingItem, handleDragEnd, layout, namedProjects]);

  React.useEffect(() => {
    const syncLanguage = () => setLanguage(currentLocale());
    window.addEventListener(localeChangedEvent, syncLanguage);
    return () => window.removeEventListener(localeChangedEvent, syncLanguage);
  }, []);

  const createConversationInSelectedProject = React.useCallback(async () => {
    if (!selectedProject) {
      window.dispatchEvent(new Event("ipollowork:focusPrompt"));
      return;
    }
    const workspaceId = selectedProject.workspace.id;
    if (props.selectedWorkspaceId !== workspaceId) {
      const selected = await props.onSelectProject(workspaceId);
      if (selected === false) return;
    }
    await props.onCreateTaskInWorkspace(workspaceId);
  }, [
    props.onCreateTaskInWorkspace,
    props.onSelectProject,
    props.selectedWorkspaceId,
    selectedProject,
  ]);

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

  React.useEffect(() => {
    const workspaceId = props.selectedWorkspaceId.trim();
    if (!workspaceId) return;

    const project = props.projectSessionLists.find(
      (entry) => entry.workspace.id === workspaceId,
    );
    if (!project?.sessions.length) return;

    const selectedId = props.selectedSessionId?.trim() ?? "";
    const selectedIndex = selectedId
      ? project.sessions.findIndex((session) => session.id === selectedId)
      : -1;
    const start = selectedIndex >= 0 ? Math.max(0, selectedIndex - 2) : 0;
    const end = selectedIndex >= 0
      ? Math.min(project.sessions.length, selectedIndex + 3)
      : Math.min(project.sessions.length, 4);

    project.sessions.slice(start, end).forEach((session) => {
      props.onPrefetchSession?.(workspaceId, session.id);
    });
  }, [
    props.onPrefetchSession,
    props.selectedSessionId,
    props.selectedWorkspaceId,
    props.projectSessionLists,
  ]);

  const contextValue: SidebarContextValue = {
    selectedWorkspaceId: props.selectedWorkspaceId,
    selectedSessionId: props.selectedSessionId,
    language,
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
    onRecoverWorkspace: props.onRecoverWorkspace,
    onTestWorkspaceConnection: props.onTestWorkspaceConnection,
    onEditWorkspaceConnection: props.onEditWorkspaceConnection,
    toggleSessionExpanded,
    expandedSessionIds,
    draggingItem,
    dropTarget,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
  };

  const brandLogoUrl = useBrandLogoUrl();
  const brandAppName = useBrandAppName();
  const { config: shellConfig } = useShellConfig();
  const effectiveBrandLogoUrl = activeEnterprise
    ? activeEnterprise.logoUrl ?? DEFAULT_BRAND_LOGO_URL
    : brandLogoUrl ?? shellConfig.brandLogoDataUrl ?? DEFAULT_BRAND_LOGO_URL;
  const effectiveBrandAppName = activeEnterprise?.name ?? brandAppName;
  return (
    <SidebarContext.Provider value={contextValue}>
      <Sidebar
        collapsible="offcanvas"
        className="bg-sidebar mac:bg-sidebar/15 mac:backdrop-blur-2xl mac:backdrop-saturate-150 mac:**:data-[sidebar=sidebar]:bg-transparent"
      >
        <SidebarHeader className="gap-3 px-2 pb-3 pt-1 mac:titlebar-drag">
          <div className="flex w-full justify-end px-3">
            <SidebarTrigger
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted active:bg-muted"
              aria-label={t("sidebar.collapse")}
              title={t("sidebar.collapse")}
            />
          </div>
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 px-3">
            <div className="flex min-w-0 items-center gap-2">
              <img
                src={effectiveBrandLogoUrl}
                alt={`${effectiveBrandAppName} logo`}
                className="size-6 shrink-0 rounded-full object-cover"
                data-testid="brand-logo"
              />
              <span
                className="truncate text-sm font-semibold"
                data-testid="brand-app-name"
                title={effectiveBrandAppName}
              >
                {effectiveBrandAppName}
              </span>
            </div>
            {props.onOpenSessionSearch ? (
              <button
                type="button"
                onClick={props.onOpenSessionSearch}
                aria-label={t("workspace_list.search_sessions")}
                aria-keyshortcuts={isMacPlatform() ? "Meta+Shift+F" : "Control+Shift+F"}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent mac:hover:bg-black/5 mac:active:bg-black/5 dark:mac:hover:bg-white/10 dark:mac:active:bg-white/10"
              >
                <Search className="size-4" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <SidebarMenu className="gap-1">
            <SidebarMenuItem data-testid="new-conversation-and-project-actions">
              <div className="min-w-0">
                <SidebarMenuButton
                  className={primarySidebarActionClass}
                  disabled={props.newTaskDisabled || !props.selectedWorkspaceId}
                  aria-label={t("session.new_task")}
                  aria-keyshortcuts={isMacPlatform() ? "Meta+N" : "Control+N"}
                  onClick={() => void createConversationInSelectedProject()}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true" data-sidebar-primary-icon>
                    <SquarePen className="size-4" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} />
                  </span>
                  <span className="flex-1 truncate">{t("session.new_task")}</span>
                </SidebarMenuButton>
              </div>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={props.onOpenTemplateMarket}
                isActive={props.activePrimaryItem === "template-market"}
                className={primarySidebarActionClass}
              >
                <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true" data-sidebar-primary-icon>
                  <LayoutTemplate className="size-4" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} />
                </span>
                <span className="flex-1 truncate">{t("template_market.title")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={props.onOpenSchedule}
                isActive={props.activePrimaryItem === "schedule"}
                className={primarySidebarActionClass}
              >
                <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true" data-sidebar-primary-icon>
                  <CalendarDays className="!size-[15px]" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} />
                </span>
                <span className="flex-1 truncate">{t("work.global_title")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={props.onOpenExtensions}
                isActive={props.activePrimaryItem === "extensions"}
                className={primarySidebarActionClass}
              >
                <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true" data-sidebar-primary-icon>
                  <ToyBrick className="!size-[17px]" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} />
                </span>
                <span className="flex-1 truncate">{t("settings.tab_extensions")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={props.onOpenPluginWorkshop}
                isActive={props.activePrimaryItem === "plugin-workshop"}
                className={primarySidebarActionClass}
              >
                <span className="grid size-4 shrink-0 place-items-center" aria-hidden="true" data-sidebar-primary-icon>
                  <ToolCase className="size-4" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} />
                </span>
                <span className="flex-1 truncate">{t("plugin_workshop.title")}</span>
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
            <Collapsible open={projectsExpanded} onOpenChange={setProjectsExpanded} data-testid="projects-section">
              <SidebarSectionHeader
                label={t("projects.title")}
                expanded={projectsExpanded}
                onToggle={() => setProjectsExpanded((expanded) => !expanded)}
                toggleTestId="projects-section-toggle"
                onAdd={props.onOpenCreateProject}
                addLabel={t("projects.create")}
                addTestId="new-project-button"
              />
              <CollapsibleContent>
                {namedProjects.map((project) => (
                  <ProjectSidebarContent
                    key={project.workspace.id}
                    project={project}
                    className="py-0"
                    onCreateProjectBuilder={props.onCreateProjectBuilder}
                    onOpenRenameProject={props.onOpenRenameProject}
                    onRevealProject={props.onRevealProject}
                    onOpenDeleteProject={props.onOpenDeleteProject}
                  />
                ))}
              </CollapsibleContent>
            </Collapsible>
            {archivedSessions.length > 0 ? (
              <ArchivedSessionsSection
                sessions={archivedSessions}
                sessionStatusById={props.sessionStatusById}
                expanded={archivedExpanded}
                onToggle={() => setArchivedExpanded((value) => !value)}
              />
            ) : null}
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
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden mac:hover:bg-black/5 mac:active:bg-black/5 dark:mac:hover:bg-white/10 dark:mac:active:bg-white/10"
                  aria-label={t("status.settings")}
                  title={t("status.settings")}
                >
                  <Ellipsis className="size-4" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} />
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
              <NotificationBell className="shrink-0 rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
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

type ProjectSidebarContentProps = {
  className: string;
  project: ProjectSessionList;
  showProjectRow?: boolean;
  onCreateProjectBuilder?: (workspaceId: string) => void | Promise<void>;
  onOpenRenameProject: (workspaceId: string) => void;
  onRevealProject: (workspaceId: string) => void;
  onOpenDeleteProject: (workspaceId: string) => void;
};

function ProjectSidebarContent({
  className,
  project,
  showProjectRow = true,
  onCreateProjectBuilder,
  onOpenRenameProject,
  onRevealProject,
  onOpenDeleteProject,
}: ProjectSidebarContentProps) {
  const ctx = useSidebarContext();
  const workspace = project.workspace;
  const isCurrentProject = ctx.selectedWorkspaceId === workspace.id;
  const isSelectedProject = isCurrentProject && !ctx.selectedSessionId;
  const [projectExpanded, setProjectExpanded] = React.useState(true);
  const tree = useSessionTree(project.sessions, ctx.sessionStatusById);

  React.useEffect(() => {
    if (isCurrentProject) setProjectExpanded(true);
  }, [isCurrentProject]);

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
  const taskLoadError = getWorkspaceTaskLoadErrorDisplay(workspace, project.error);
  const connectionIssueMessage = connectionState.status === "error"
    ? connectionState.message?.trim() || taskLoadError.message
    : project.error?.trim() || taskLoadError.message;
  const showRemoteConnectionIssue =
    (isRemoteWorkspace || isRemoteConnectionErrorMessage(connectionIssueMessage)) &&
    Boolean(connectionIssueMessage) &&
    (connectionState.status === "error" || project.status === "error");
  const pinnedIds = usePinnedSessionIds();

  const projectRootSessions = getRootSessions(project.sessions);
  const projectStatuses = project.sessions.map((session) => ctx.sessionStatusById?.[session.id]);
  const projectStreamingStatus = projectStatuses.find(isStreamingSessionStatus);
  const projectActivityStatus = projectStreamingStatus ?? projectStatuses.find((status) => status && status !== "idle");
  const projectIsStreaming = Boolean(projectStreamingStatus)
    || projectRootSessions.some((session) => tree.streamingIds.has(session.id));
  const projectIsActive = Boolean(projectActivityStatus)
    || projectRootSessions.some((session) => tree.activeIds.has(session.id));
  const [sessionPreviewCount, setSessionPreviewCount] = React.useState(MAX_SESSIONS_PREVIEW);
  const sessionRows = flattenSessionRows(
    project.sessions,
    sessionPreviewCount,
    tree,
    ctx.expandedSessionIds,
    forcedExpandedSessionIds,
    pinnedIds,
  );
  const remainingSessionCount = Math.max(0, projectRootSessions.length - sessionPreviewCount);
  const [creatingConversation, setCreatingConversation] = React.useState(false);
  const createConversationInProject = async () => {
    if (creatingConversation) return;
    setCreatingConversation(true);
    try {
      // A project-level plus always opens that project's sessionless starter.
      // Selecting the project first can navigate to a remembered session and
      // race the starter navigation, leaving the previous engine mounted.
      await ctx.onCreateTaskInWorkspace(workspace.id);
    } finally {
      setCreatingConversation(false);
    }
  };

  return (
    <SidebarGroup className={cn(className, "px-2")}>
      <SidebarGroupContent>
        <Collapsible open={projectExpanded} onOpenChange={setProjectExpanded} className="group/project">
          {showProjectRow ? <SidebarMenu>
            <SidebarMenuItem
              className={cn(
                "group/project-row relative h-8 cursor-grab active:cursor-grabbing",
                ctx.dropTarget?.kind === "project" && ctx.dropTarget.id === workspace.id && "rounded-lg bg-sidebar-accent/70",
              )}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", JSON.stringify({ kind: "project", id: workspace.id }));
                ctx.onDragStart({ kind: "project", id: workspace.id });
              }}
              onDragOver={(event) => ctx.onDragOver({ kind: "project", id: workspace.id }, event)}
              onDrop={(event) => ctx.onDrop({ kind: "project", id: workspace.id }, event)}
              onDragEnd={ctx.onDragEnd}
              data-drop-target={ctx.dropTarget?.kind === "project" && ctx.dropTarget.id === workspace.id ? "true" : undefined}
            >
              <button
                type="button"
                onClick={() => setProjectExpanded((expanded) => !expanded)}
                className={cn(
                  "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 pe-16 text-left text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:outline-hidden mac:hover:bg-black/5 dark:mac:hover:bg-white/10",
                  isSelectedProject && "bg-sidebar-accent font-medium text-sidebar-accent-foreground mac:bg-black/5 dark:mac:bg-white/10",
                )}
                data-testid="project-row"
                data-project-id={workspace.id}
                data-selected={isSelectedProject ? "true" : "false"}
                aria-expanded={projectExpanded}
              >
                <span
                  className={cn(
                    "relative size-4 shrink-0 text-muted-foreground transition-colors group-hover/project-row:text-sidebar-accent-foreground",
                    isSelectedProject && "text-sidebar-accent-foreground",
                  )}
                  aria-hidden="true"
                >
                  {projectExpanded ? (
                    <FolderOpen className="!size-[15.5px]" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} />
                  ) : (
                    <ProjectFolderIcon />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">{workspaceLabel(workspace)}</span>
              </button>
              {!projectExpanded ? (
                <SessionStatusIndicator
                  className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 opacity-100 transition-opacity group-hover/project-row:opacity-0 group-focus-within/project-row:opacity-0"
                  status={projectActivityStatus}
                  isStreaming={projectIsStreaming}
                  isActive={projectIsActive}
                />
              ) : null}
              <div className="absolute end-0.5 top-0.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/project-row:opacity-100 group-focus-within/project-row:opacity-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 rounded-md text-muted-foreground hover:text-sidebar-foreground"
                  onClick={() => void createConversationInProject()}
                  disabled={isConnectionActionBusy || creatingConversation}
                  aria-busy={creatingConversation}
                  aria-label={t("projects.new_conversation", { project: workspaceLabel(workspace) })}
                  title={t("projects.new_conversation", { project: workspaceLabel(workspace) })}
                  data-testid="project-new-conversation-button"
                  data-project-id={workspace.id}
                >
                  {creatingConversation ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <span className="flex size-4 items-center justify-center" aria-hidden="true">
                      <Plus className="size-3.5" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} />
                    </span>
                  )}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 rounded-md text-muted-foreground hover:text-sidebar-foreground data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-foreground"
                        aria-label={t("projects.actions")}
                        title={t("projects.actions")}
                        data-testid="project-actions-menu"
                        data-project-id={workspace.id}
                        draggable={false}
                        onDragStart={(event) => event.stopPropagation()}
                      >
                        <span className="flex size-4 items-center justify-center" aria-hidden="true">
                          <Ellipsis className="size-3.5" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} />
                        </span>
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" side="bottom" sideOffset={4} className="w-52">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel
                        data-testid="project-engine-menu-info"
                        className="flex items-center gap-2.5 font-normal"
                      >
                        <Cpu className="size-4" aria-hidden="true" />
                        <span className="truncate">{workspaceEngineLabel(workspace.engineId)}</span>
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onOpenRenameProject(workspace.id)}>
                      <Pencil className="size-4" />
                      {t("projects.rename")}
                    </DropdownMenuItem>
                    {onCreateProjectBuilder ? (
                      <DropdownMenuItem
                        data-testid="project-builder-open"
                        onClick={() => void onCreateProjectBuilder(workspace.id)}
                      >
                        <Sparkles className="size-4" />
                        {t("project_builder.open")}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onClick={() => onRevealProject(workspace.id)}
                      disabled={workspace.workspaceType === "remote"}
                    >
                      <FolderOpen className="size-4" />
                      {t("projects.show_in_folder")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => onOpenDeleteProject(workspace.id)}
                    >
                      <Trash2 className="size-4" />
                      {t("projects.remove")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </SidebarMenuItem>
          </SidebarMenu> : null}
          <CollapsibleContent>
            <SidebarMenuSub className="mt-[2px] translate-x-0 gap-1 pb-2">
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
              ) : project.status === "loading" && project.sessions.length === 0 && !isSelectedProject ? (
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton aria-disabled className="text-muted-foreground text-xs truncate">
                    <span className="truncate">{t("workspace.loading_tasks")}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ) : project.status !== "error" ? (
                <>
                  <ConversationList
                    sessionRows={sessionRows}
                    pinnedIds={pinnedIds}
                    tree={tree}
                    workspaceId={workspace.id}
                    forcedExpandedSessionIds={forcedExpandedSessionIds}
                    remainingCount={remainingSessionCount}
                    onShowMore={() => setSessionPreviewCount((count) => count + MAX_SESSIONS_PREVIEW)}
                  />
                </>
              ) : (
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton
                    aria-disabled
                    className={cn("text-xs", taskLoadError.tone === "offline" ? "text-amber-600" : "text-destructive")}
                  >
                    <span className="truncate">{taskLoadError.message}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )}
            </SidebarMenuSub>
          </CollapsibleContent>
        </Collapsible>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function ConversationList({ sessionRows, pinnedIds, tree, workspaceId, forcedExpandedSessionIds, remainingCount, onShowMore }: {
  sessionRows: FlattenedSessionRow[];
  pinnedIds: Set<string>;
  tree: SessionTreeState;
  workspaceId: string;
  forcedExpandedSessionIds: Set<string>;
  remainingCount: number;
  onShowMore: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {sessionRows.map((row) => (
        <SessionMenuItem
          key={row.session.id}
          session={row.session}
          depth={row.depth}
          tree={tree}
          workspaceId={workspaceId}
          forcedExpandedSessionIds={forcedExpandedSessionIds}
          isPinned={pinnedIds.has(row.session.id)}
        />
      ))}
      {remainingCount > 0 ? (
        <SidebarMenuSubItem>
          <SidebarMenuSubButton
            className="text-muted-foreground text-xs"
            onClick={onShowMore}
          >
            <span className="truncate">
              {t("workspace_list.show_more", { count: Math.min(MAX_SESSIONS_PREVIEW, remainingCount) })}
            </span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ) : null}
    </div>
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
  session: SessionListItem & Partial<Pick<SidebarDisplaySession, "sourceWorkspaceId" | "sidebarWorkspaceId">>;
  depth: number;
  tree: SessionTreeState;
  workspaceId: string;
  forcedExpandedSessionIds: Set<string>;
  isPinned?: boolean;
};

function SessionMenuItem({
  session,
  tree,
  workspaceId,
  forcedExpandedSessionIds,
  depth,
  isPinned = false,
}: SessionMenuItemProps) {
  const ctx = useSidebarContext();
  const isSelected = ctx.selectedSessionId === session.id;
  const sourceWorkspaceId = session.sourceWorkspaceId?.trim() || workspaceId;
  const sessionKey = sessionLayoutKey(sourceWorkspaceId, session.id);
  const displayTitle = getDisplaySessionTitle(session.title);
  const hasChildren = (tree.descendantCountBySessionId.get(session.id) ?? 0) > 0;
  const isExpanded = ctx.expandedSessionIds.has(session.id) || forcedExpandedSessionIds.has(session.id);
  const sessionActivityStatus = ctx.sessionStatusById?.[session.id];
  const isSessionActive = tree.activeIds.has(session.id)
    || Boolean(sessionActivityStatus && sessionActivityStatus !== "idle");
  const isSessionStreaming = tree.streamingIds.has(session.id) || isStreamingSessionStatus(sessionActivityStatus);
  const isArchived = isSessionArchived(session);
  const rowPadding = depth > 0 ? "ps-[68px]" : "ps-8";
  const trailingActionPosition = "right-1";
  const nestedActionPosition = "right-8";
  const sessionFontWeight = ctx.language === "zh" ? "font-medium" : "font-normal";

  const openSession = () => {
    ctx.onOpenSession(sourceWorkspaceId, session.id);
  };

  const prefetchSession = () => {
    if (sourceWorkspaceId !== ctx.selectedWorkspaceId) {
      return;
    }

    ctx.onPrefetchSession?.(sourceWorkspaceId, session.id);
  };

  const dragStart = (event: React.DragEvent<HTMLElement>) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", JSON.stringify({
      kind: "session",
      key: sessionKey,
      sourceWorkspaceId,
      sessionId: session.id,
    }));
    ctx.onDragStart({ kind: "session", key: sessionKey, sourceWorkspaceId, sessionId: session.id });
  };
  const dragOver = (event: React.DragEvent<HTMLElement>) => {
    event.stopPropagation();
    ctx.onDragOver({ kind: "session", key: sessionKey }, event);
  };
  const drop = (event: React.DragEvent<HTMLElement>) => {
    event.stopPropagation();
    ctx.onDrop({ kind: "session", key: sessionKey }, event);
  };

  const item = hasChildren ? (
    <Collapsible
      open={isExpanded}
      onOpenChange={() => ctx.toggleSessionExpanded(session.id)}
      className="group/session-collapsible"
    >
      <SidebarMenuSubItem
        draggable
        onDragStart={dragStart}
        onDragOver={dragOver}
        onDrop={drop}
        onDragEnd={ctx.onDragEnd}
        data-drop-target={ctx.dropTarget?.kind === "session" && ctx.dropTarget.key === sessionKey ? "true" : undefined}
        className={cn(ctx.dropTarget?.kind === "session" && ctx.dropTarget.key === sessionKey && "rounded-lg bg-sidebar-accent/70")}
        style={{ cursor: "grab" }}
      >
        <SessionContextMenu sessionId={session.id} workspaceId={sourceWorkspaceId} isPinned={isPinned} isArchived={isArchived}>
          <CollapsibleTrigger
            render={
              <SidebarMenuSubButton
                className={cn("relative h-8 translate-x-0 rounded-[8px] pe-8 text-sm leading-4", sessionFontWeight, rowPadding)}
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
                <span className={cn("absolute top-1/2 flex size-6 -translate-y-1/2 items-center justify-center", trailingActionPosition)}>
                  <ChevronRight className="size-4 text-muted-foreground transition-transform duration-200 group-data-open/session-collapsible:rotate-90 hover:text-foreground" />
                </span>
              </SidebarMenuSubButton>
            }
          />
        </SessionContextMenu>
        <SessionActions
          sessionId={session.id}
          workspaceId={sourceWorkspaceId}
          isPinned={isPinned}
          isArchived={isArchived}
          className={cn("absolute top-1/2 -translate-y-1/2 opacity-0 group-hover/menu-sub-item:opacity-100 data-popup-open:opacity-100", nestedActionPosition)}
        />
        <SessionStatusIndicator className="absolute right-9 top-1/2 -translate-y-1/2 opacity-0 group-hover/menu-sub-item:opacity-0 group-has-data-popup-open/menu-sub-item:opacity-0 pointer-events-none select-none" status={sessionActivityStatus} isStreaming={isSessionStreaming} isActive={isSessionActive} />
      </SidebarMenuSubItem>
    </Collapsible>
  ) : (
    <SidebarMenuSubItem
      draggable
      onDragStart={dragStart}
      onDragOver={dragOver}
      onDrop={drop}
      onDragEnd={ctx.onDragEnd}
      data-drop-target={ctx.dropTarget?.kind === "session" && ctx.dropTarget.key === sessionKey ? "true" : undefined}
      className={cn(ctx.dropTarget?.kind === "session" && ctx.dropTarget.key === sessionKey && "rounded-lg bg-sidebar-accent/70")}
      style={{ cursor: "grab" }}
    >
      <SessionContextMenu sessionId={session.id} workspaceId={sourceWorkspaceId} isPinned={isPinned} isArchived={isArchived}>
        <SidebarMenuSubButton
          isActive={isSelected}
          onClick={openSession}
          onPointerEnter={prefetchSession}
          onFocus={prefetchSession}
          className={cn("h-8 translate-x-0 rounded-[8px] pe-8 text-sm leading-4 transition-[padding] duration-75 group-hover/menu-sub-item:pe-8 group-has-data-popup-open/menu-sub-item:pe-8", sessionFontWeight, rowPadding)}
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
        workspaceId={sourceWorkspaceId}
        isPinned={isPinned}
        isArchived={isArchived}
        className={cn("absolute top-1/2 -translate-y-1/2 opacity-0 group-hover/menu-sub-item:opacity-100 data-popup-open:opacity-100", trailingActionPosition)}
      />
      <SessionStatusIndicator
        className="absolute right-3 top-1/2 -translate-y-1/2 opacity-100 group-hover/menu-sub-item:opacity-0 group-has-data-popup-open/menu-sub-item:opacity-0 pointer-events-none select-none"
        status={sessionActivityStatus}
        isStreaming={isSessionStreaming}
        isActive={isSessionActive}
      />
    </SidebarMenuSubItem>
  );

  return item;
}

type ArchivedSessionsSectionProps = {
  sessions: SidebarDisplaySession[];
  sessionStatusById?: Record<string, string>;
  expanded: boolean;
  onToggle: () => void;
};

function ArchivedSessionsSection({
  sessions,
  sessionStatusById,
  expanded,
  onToggle,
}: ArchivedSessionsSectionProps) {
  const pinned = usePinnedSessionIds();
  const forcedExpandedSessionIds = React.useMemo(() => new Set<string>(), []);
  const tree = React.useMemo(
    () => buildSessionTreeState(sessions, sessionStatusById),
    [sessionStatusById, sessions],
  );
  return (
    <SidebarGroup className="group/archived px-2">
      <SidebarGroupContent>
        <Collapsible open={expanded} onOpenChange={onToggle} className="group/archived-content">
          <CollapsibleTrigger
            render={
              <button
                type="button"
                className="group/separator flex h-8 w-full cursor-pointer items-center gap-1.5 rounded px-2 text-left transition-colors hover:bg-sidebar-accent/50"
              >
                <Archive className="size-3 shrink-0 text-muted-foreground" />
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("session_management.archived_label")}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground/70">{sessions.length}</span>
                <ChevronRight className="ml-auto size-3.5 text-muted-foreground transition-transform duration-200 group-data-open/archived-content:rotate-90" />
              </button>
            }
          />
          <CollapsibleContent>
            <SidebarMenuSub className="mt-[2px] translate-x-0 gap-1 pb-2">
              {sessions.map((session) => (
                <SessionMenuItem
                  key={session.id}
                  session={session}
                  depth={0}
                  tree={tree}
                  workspaceId={session.sourceWorkspaceId}
                  forcedExpandedSessionIds={forcedExpandedSessionIds}
                  isPinned={pinned.has(session.id)}
                />
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </Collapsible>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
