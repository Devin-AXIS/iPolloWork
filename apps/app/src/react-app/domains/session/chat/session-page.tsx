/** @jsxImportSource react */
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { useNavigate } from "react-router-dom";
import { Code2, Ellipsis, Eye, FileText, Film, FolderOpen, Globe, Image, LoaderCircle, Mic2, Palette, PanelRightClose, PanelRightOpen, Pencil, Presentation, Search, Settings2, Trash2, Upload, X, Zap } from "lucide-react";
import { MAX_TEMPLATE_PACKAGE_BYTES, TEMPLATE_PACKAGE_FILE_ACCEPT, isPptxCompatibleTemplate, type PptxCompatibility, type TemplateCatalogItem, type TemplateCategory, type TemplateManifestV1, type TemplateSessionSnapshot, type TemplateSessionState, type TemplateValidationReport } from "@ipollowork/types/templates";

import { currentLocale, t } from "../../../../i18n";
import { downloadTextAsFile } from "@/app/lib/download";
import { publicAssetUrl } from "../../../../app/lib/public-asset";
import { IPOLLOWORK_EXTENSION_CATALOG } from "../../../../app/constants";
import { type iPolloWorkServerClient, type iPolloWorkServerStatus } from "../../../../app/lib/ipollowork-server";
import {
  PERSONAL_WORK_CONTEXT_ID,
  readActiveWorkContextId,
  type WorkContextId,
} from "@/app/lib/work-context";
import {
  downloadEnterpriseResource,
  listEnterpriseResources,
  type EnterpriseResource,
} from "@/app/lib/enterprise-connections";
import { getDisplaySessionTitle } from "../../../../app/lib/session-title";
import type { BootPhase } from "../../../../app/lib/startup-boot";
import { openDesktopPath, pickDirectory, revealDesktopItemInDir, saveFile, type WorkspaceInfo } from "../../../../app/lib/desktop";
import type {
  ComposerDraft,
  ProviderListItem,
  TodoItem,
  WorkspaceConnectionState,
  ProjectSessionList,
} from "../../../../app/types";
import type { ConversationPermission, ConversationQuestion } from "../engine/conversation-engine";
import { ConversationOutputPanel, ConversationOutputTrigger } from "@/components/chat/artifact";
import { buildSessionMarkdown, sessionMarkdownFilename } from "@/components/chat/utils";
import {
  type ArtifactInteractionContext,
  artifactDirectoryPath,
  artifactPathIsWithinDirectory,
  artifactPathMatchesTarget,
  getArtifactsFromMessages,
} from "@/lib/artifacts";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import { useDenAuth } from "../../cloud/den-auth-provider";
import { CloudSignInComingSoonDialog } from "../../cloud/cloud-signin-coming-soon-dialog";
import ProviderAuthModal, { type ProviderAuthModalProps } from "../../connections/provider-auth/provider-auth-modal";
import { RenameSessionModal } from "../modals/rename-session-modal";
import { AppSidebar } from "../sidebar/app-sidebar";
import type { iPolloWorkSessionType, iPolloWorkTemplateId } from "../sidebar/app-sidebar-provider";
import { readSessionType, sessionTypeForTemplate, setSessionType } from "../sidebar/session-type";
import { SessionSurface, type SessionSurfaceProps } from "../surface/session-surface";
import { replaceDesignSelectionToken } from "../surface/composer/composer-draft";
import { getComposerDraft, useComposerStateStore } from "../surface/composer-state-store";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { OwDotTicker } from "../../../shell/dot-ticker";
import { IPolloLoadingArtwork } from "../../../shell/loading-overlay";
import { useReactRenderWatchdog } from "../../../shell/react-render-watchdog";
import { useShellConfig } from "../../../shell/shell-config";
import { type SidePanelItem, useUiStateStore } from "../../../shell/ui-state-store";
import { workspaceSettingsRoute } from "../../../shell/workspace-routes";

import { isElectronRuntime } from "../../../../app/utils";
import { isCollectibleArtifactTarget, isLocalhostBrowserTarget, isOpenableFileTarget, type OpenTarget } from "../artifacts/open-target";
import type { OpenTargetOptions } from "@/lib/target-provider";
import { VoicePanel } from "../voice/voice-panel";
import { DesignPanel } from "../design/design-panel";
import { designAiSelectionToken, type DesignAiSelectionContext } from "@ipollowork/design-studio";
import { useDesignAiSelectionStore } from "../design/design-ai-selection-store";
import { waitForTemplateEntrySurface } from "../templates/template-entry-route";
import { loadTemplateSession } from "../templates/template-session-probe";
import { TemplateSaveDialog, type TemplateSaveInput, type TemplateSaveMode } from "../templates/template-save-dialog";
import { videoProjectEntryPath } from "../video/video-project";
import { isStreamingSessionStatus } from "../sidebar/utils";
import {
  TEMPLATE_BRIEF_REFERENCE_ACCEPT,
  templateBriefConfigFor,
  templateBriefPrompt,
  type TemplateBrief,
} from "../templates/template-brief";
import {
  canSendOriginalReference,
  ingestReferenceFile,
  isReferenceFile,
} from "../references/ingestion";
import { inferTemplateBriefFromIngestions } from "../references/brief-autofill";
import {
  buildTemplateReferenceSubmitPayload,
  revokeTemplateReferenceAttachmentPreviews,
} from "../references/template-reference-submit";
import type { TemplateReferenceItem } from "../references/types";
export {
  buildTemplateReferenceSubmitPayload,
  revokeTemplateReferenceAttachmentPreviews,
} from "../references/template-reference-submit";
import { TemplateMarketDialog } from "../templates/template-market-dialog";
import { shouldRefreshTemplateCatalogOnOpen } from "../templates/template-market-refresh";
import { savePromptTemplate } from "@/react-app/domains/session/templates/prompt-template-store";
import { SidePanel, type SidePanelLauncherItem } from "../panel/side-panel";
import { TerminalDock } from "../terminal/terminal-dock";
import { useActivePanelTab, usePanelTabStore, useSessionPanelState } from "../panel/panel-tab-store";
import { useWorkspaceShellLayout } from "../../../shell/workspace-shell-layout";
import { useControlAction, type iPolloWorkControlAction } from "../../../shell/control/control-provider";
import { getExtensionId, isiPolloWorkExtensionEnabled, IPOLLOWORK_EXTENSION_STATE_CHANGED } from "../../settings/extension-state";
import { cn } from "@/lib/utils";
import { useActiveEnterpriseConnection } from "@/react-app/domains/enterprise/use-active-enterprise-connection";

const STARTUP_SKELETON_ROWS = [
  { id: "intro", titleWidth: "42%", bodyWidth: "88%" },
  { id: "middle", titleWidth: "56%", bodyWidth: "88%" },
  { id: "final", titleWidth: "36%", bodyWidth: "74%" },
];
const GLOBAL_VOICE_SIDE_PANEL_KEY = "__ipollowork_voice__";
const EMPTY_TRANSCRIPT_TARGETS: OpenTarget[] = [];
const MAIN_WORKSPACE_MIN_WIDTH = 480;
const AUTO_COLLAPSE_WORKSPACE_WIDTH = 480;
const AUTO_RESTORE_WORKSPACE_WIDTH = 600;
const MIN_DESIGN_PANEL_WIDTH = 420;
const MIN_RIGHT_PANEL_WIDTH = 320;
const NARROW_LAYOUT_WIDTH = 960;
const VIDEO_PANEL_DEFAULT_WIDTH = 1120;
const SESSION_SHELL_TRANSITION_MS = 220;
const SESSION_SHELL_TRANSITION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const TEMPLATE_REFERENCE_UPLOAD_VISIBLE = false;
type SessionPanelView = SidePanelItem | "launcher";
type TemplateSessionData = {
  sessionId: string;
  authoring?: boolean;
  state: TemplateSessionState;
  manifest: TemplateManifestV1;
  hasBrief: boolean;
};

export type SessionPageHistoryControls = {
  canUndo: boolean;
  canRedo: boolean;
  busyAction: "undo" | "redo" | null;
  onUndo: () => void | Promise<void>;
  onRedo: () => void | Promise<void>;
};

export type SessionPageSidebarProps = {
  projectSessionLists: ProjectSessionList[];
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  developerMode: boolean;
  sessionStatusById: Record<string, string>;
  connectingWorkspaceId: string | null;
  workspaceConnectionStateById: Record<string, WorkspaceConnectionState>;
  newTaskDisabled: boolean;
  sidebarHydratedFromCache: boolean;
  startupPhase: BootPhase;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onSelectProject: (workspaceId: string) => Promise<boolean> | boolean | void;
  onCreateProject: (input: { name: string; folderPath: string }) => Promise<void> | void;
  onRenameProject: (workspaceId: string, name: string) => Promise<void> | void;
  onRevealProject: (workspaceId: string) => Promise<void> | void;
  onDeleteProject: (workspaceId: string) => Promise<void> | void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onCreateTaskInWorkspace: (
    workspaceId: string,
    type?: iPolloWorkSessionType,
    templateId?: iPolloWorkTemplateId,
    templateScope?: WorkContextId,
  ) => Promise<string | null> | string | null | void;
  onCreateTaskWithPrompt?: (workspaceId: string, prompt: string) => void;
  onCreateTemplateAuthoring: (
    workspaceId: string,
    input: { category: TemplateCategory; pptxCompatibility?: PptxCompatibility },
  ) => Promise<string | null> | string | null | void;
  onRecoverWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onTestWorkspaceConnection: (workspaceId: string) => Promise<boolean> | boolean | void;
  onEditWorkspaceConnection: (workspaceId: string) => void;
  /** Opens the cross-session message search dialog (Cmd/Ctrl+Shift+F). */
  onOpenSessionSearch?: () => void;
};

export type SessionPageSurfaceProps = Omit<
  SessionSurfaceProps,
  "client" | "workspaceId" | "sessionId" | "opencodeBaseUrl" | "ipolloworkToken"
>;

export type SessionPageProps = {
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  selectedWorkspaceDisplay: {
    id?: string;
    name?: string;
    displayName?: string;
    workspaceType?: WorkspaceInfo["workspaceType"];
  };
  selectedWorkspaceRoot: string;
  selectedWorkspaceError?: string | null;
  runtimeWorkspaceId: string | null;
  /**
   * Pre-built OpenCode SDK base URL for the selected workspace's owning
   * server. The parent route resolves this through `resolveWorkspaceEndpoint`
   * so we never compose `<baseUrl>/workspace/<id>/opencode` here.
   */
  opencodeBaseUrl?: string | null;
  workspaces: WorkspaceInfo[];
  clientConnected: boolean;
  ipolloworkServerStatus: iPolloWorkServerStatus;
  ipolloworkServerClient: iPolloWorkServerClient | null;
  environmentClient?: iPolloWorkServerClient | null;
  ipolloworkServerToken?: string | null;
  developerMode: boolean;
  headerStatus: string;
  busyHint: string | null;
  startupPhase: BootPhase;
  providerConnectedIds: string[];
  hasUsableModel?: boolean;
  providers?: ProviderListItem[];
  mcpConnectedCount: number;
  onOpenSettings: (route?: string) => void;
  onOpenHelp: () => void;
  sidebar: SessionPageSidebarProps;
  surface?: SessionPageSurfaceProps | null;
  history?: SessionPageHistoryControls | null;
  todos: TodoItem[];
  sessionLoadingById: (sessionId: string | null) => boolean;
  providerAuthModal?: ProviderAuthModalProps | null;
  activePermission?: ConversationPermission | null;
  permissionReplyBusy?: boolean;
  respondPermission?: (requestID: string, reply: "once" | "always" | "reject") => void;
  safeStringify?: (value: unknown) => string;
  activeQuestion?: ConversationQuestion | null;
  questionReplyBusy?: boolean;
  respondQuestion?: (requestID: string, answers: string[][]) => void;
  notFoundMessage?: string | null;
  onOpenProviderAuth?: () => void;
  onRenameSession?: (sessionId: string, title: string) => Promise<void> | void;
  onDeleteSession?: (sessionId: string) => Promise<void> | void;
  onArchiveSession?: (sessionId: string, archived: boolean) => Promise<void> | void;
  onAccessibleTargetsChange?: (targets: OpenTarget[]) => void;
  /** Settings content rendered inside the right pane when the settings rail icon is active. */
  settingsSlot?: React.ReactNode;
  terminalOpen?: boolean;
  onTerminalOpenChange?: (open: boolean) => void;
};

function getSidebarInitialLoading(props: SessionPageSidebarProps) {
  if (props.projectSessionLists.some((project) => project.sessions.length > 0)) {
    return false;
  }
  if (props.sidebarHydratedFromCache) return false;
  if (
    props.startupPhase !== "sessionIndexReady" &&
    props.startupPhase !== "firstSessionReady" &&
    props.startupPhase !== "ready"
  ) {
    return true;
  }
  return props.projectSessionLists.some(
    (project) => project.status === "loading" || project.status === "idle",
  );
}

function sessionTitleForId(projects: ProjectSessionList[], id: string | null | undefined) {
  if (!id) return "";
  const sessionsById = new Map(projects.flatMap((project) => project.sessions.map((session) => [session.id, session] as const)));
  const match = sessionsById.get(id);
  return match ? getDisplaySessionTitle(match.title) : "";
}

function isTrackableAccessibleTarget(target: OpenTarget) {
  return isOpenableFileTarget(target) || isLocalhostBrowserTarget(target);
}

function absoluteWorkspacePath(root: string | null | undefined, value: string) {
  const target = value.trim();
  if (!target) return "";
  if (/^file:\/\//i.test(target)) {
    try {
      const pathname = new URL(target).pathname;
      return /^\/[a-zA-Z]:/.test(pathname) ? pathname.slice(1) : pathname;
    } catch {
      return target.replace(/^file:\/\//i, "");
    }
  }
  if (target.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(target)) return target;
  const cleanRoot = root?.trim().replace(/[/\\]+$/, "") ?? "";
  const cleanTarget = target.replace(/^[.][\\/]/, "");
  return cleanRoot ? `${cleanRoot}/${cleanTarget}` : cleanTarget;
}

function hiddenAccessibleTargetsStorageKey(workspaceId: string | null | undefined, sessionId: string | null | undefined) {
  if (!workspaceId || !sessionId) return null;
  return `ipollowork.session.hiddenAccessibleTargets.v1:${workspaceId}:${sessionId}`;
}

function readHiddenAccessibleTargetIds(workspaceId: string | null | undefined, sessionId: string | null | undefined): Set<string> {
  const key = hiddenAccessibleTargetsStorageKey(workspaceId, sessionId);
  if (!key || typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0));
  } catch {
    return new Set();
  }
}

function writeHiddenAccessibleTargetIds(workspaceId: string | null | undefined, sessionId: string | null | undefined, ids: Set<string>) {
  const key = hiddenAccessibleTargetsStorageKey(workspaceId, sessionId);
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore storage failures
  }
}

function controlObjectArg(args: unknown) {
  return args && typeof args === "object" && !Array.isArray(args) ? args : null;
}

function controlStringArg(args: unknown, key: string) {
  const object = controlObjectArg(args);
  const value = object ? Reflect.get(object, key) : null;
  return typeof value === "string" ? value.trim() : "";
}

const TEMPLATE_COVER_TIMEOUT_MS = 12_000;

function sessionMessageToPromptText(message: UIMessage) {
  const header = message.role === "user" ? "You" : message.role === "assistant" ? "iPolloWork" : message.role;
  const body = message.parts
    .flatMap((part) => {
      if (part.type === "text") return [part.text];
      if (part.type === "reasoning") return [part.text];
      if (part.type === "dynamic-tool") return [`[tool:${part.toolName}] ${part.state}`];
      return [];
    })
    .join("\n\n");
  return `${header}\n${body}`.trim();
}

function TemplateCover({ client, workspaceId, template, className, alt = "" }: { client: iPolloWorkServerClient; workspaceId: string; template: TemplateCatalogItem; className?: string; alt?: string }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const timeout = window.setTimeout(() => {
      if (active) setFailed(true);
    }, TEMPLATE_COVER_TIMEOUT_MS);
    setSrc("");
    setFailed(false);
    void client.getTemplateCover(workspaceId, template.manifest.id).then(({ data, contentType }) => {
      if (!active) return;
      window.clearTimeout(timeout);
      objectUrl = URL.createObjectURL(new Blob([data], { type: contentType ?? "image/svg+xml" }));
      setSrc(objectUrl);
    }).catch(() => {
      window.clearTimeout(timeout);
      if (active) setFailed(true);
    });
    return () => { active = false; window.clearTimeout(timeout); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [client, retry, template.installedVersion, template.manifest.id, template.manifest.version, workspaceId]);
  if (failed) {
    return (
      <div className={cn("grid h-28 w-full place-items-center bg-dls-hover p-4 text-center", className)}>
        <div className="max-w-full">
          <p className="truncate text-xs font-medium text-dls-text">{template.manifest.title}</p>
          <p className="mt-1 text-[11px] text-dls-secondary">{t("template_market.cover_failed")}</p>
          <button type="button" className="mt-3 rounded-lg border border-dls-border px-2 py-1 text-[11px] text-dls-text hover:bg-dls-surface" onClick={(event) => { event.stopPropagation(); setRetry((value) => value + 1); }}>
            {t("template_market.retry_cover")}
          </button>
        </div>
      </div>
    );
  }
  return src ? <img src={src} alt={alt} className={cn("h-28 w-full object-cover", className)} /> : <div className={cn("h-28 animate-pulse bg-dls-hover", className)} />;
}

function DesignStarter({ client, workspaceId, templates, loading, busyId, error, onRefresh, onChoose, onInstall, onUninstall, onImport }: {
  client: iPolloWorkServerClient;
  workspaceId: string;
  templates: TemplateCatalogItem[];
  loading: boolean;
  busyId: string | null;
  error: string | null;
  onRefresh: () => void;
  onChoose: (templateId: iPolloWorkTemplateId) => void;
  onInstall: (templateId: string) => void;
  onUninstall: (templateId: string) => void;
  onImport: (file: File, category?: TemplateManifestV1["category"]) => Promise<boolean>;
}) {
  const [category, setCategory] = useState<"website" | "slides" | "poster" | null>(null);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<TemplateCatalogItem | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const categories = [
    { id: "website" as const, labelKey: "templates.starter.category.website", detailKey: "templates.starter.category.website_detail", Icon: Globe },
    { id: "slides" as const, labelKey: "templates.starter.category.slides", detailKey: "templates.starter.category.slides_detail", Icon: Presentation },
    { id: "poster" as const, labelKey: "templates.starter.category.poster", detailKey: "templates.starter.category.poster_detail", Icon: Image },
  ];
  return (<>
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-3xl">
        <div className="mb-7 text-center"><div className="mx-auto mb-3 grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary"><Palette className="size-5" /></div><h2 className="text-lg font-semibold">{t("templates.starter.title")}</h2><p className="mt-1 text-sm text-dls-secondary">{t("templates.starter.subtitle")}</p></div>
        {loading ? <div className="flex items-center justify-center py-14 text-sm text-dls-secondary"><LoaderCircle className="mr-2 size-4 animate-spin" />{t("templates.starter.loading")}</div> : error ? <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5 text-center text-sm"><p>{error}</p><button type="button" onClick={onRefresh} className="mt-3 text-xs font-medium text-primary">{t("template_market.retry")}</button></div> : !category ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {categories.map(({ id, labelKey, detailKey, Icon }) => <button key={id} type="button" onClick={() => setCategory(id)} className="group rounded-2xl border border-dls-border bg-dls-surface p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"><Icon className="mb-7 size-4 text-dls-secondary group-hover:text-primary" /><div className="text-sm font-semibold">{t(labelKey)}</div><div className="mt-1 text-xs leading-5 text-dls-secondary">{t(detailKey)}</div></button>)}
          </div>
        ) : (() => {
          const serverCategory = category === "website" ? "site" : category;
          const visible = templates.filter((item) => item.manifest.category === serverCategory);
          const selectedCategory = categories.find((item) => item.id === category);
          return <div>
            <div className="mb-3 flex items-center justify-between"><button type="button" className="text-xs text-dls-secondary hover:text-dls-text" onClick={() => setCategory(null)}>← {t("templates.starter.back_to_categories")}</button><button type="button" disabled={busyId !== null} onClick={() => importRef.current?.click()} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-dls-border px-2 text-[11px] font-medium text-dls-secondary transition hover:bg-dls-hover hover:text-dls-text disabled:opacity-50"><Upload className="size-3" />{t("template_market.import_package")}</button><input ref={importRef} type="file" accept={TEMPLATE_PACKAGE_FILE_ACCEPT} className="hidden" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) setPendingImport(file); event.currentTarget.value = ""; }} /></div>
            {pendingImport ? <div className="mb-3 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3"><div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Upload className="size-3.5" /></div><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{pendingImport.name}</div><div className="text-[10px] text-dls-secondary">{(pendingImport.size / 1024).toFixed(1)} KB / {t("templates.starter.file_type", { type: selectedCategory ? t(selectedCategory.labelKey) : "" })}</div></div><button type="button" disabled={busyId !== null} onClick={() => setPendingImport(null)} className="text-[11px] text-dls-secondary hover:text-dls-text disabled:opacity-50">{t("common.cancel")}</button><button type="button" disabled={busyId !== null} onClick={async () => { if (await onImport(pendingImport, serverCategory)) setPendingImport(null); }} className="inline-flex h-7 items-center rounded-lg bg-primary px-2.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50">{busyId === "import" ? <LoaderCircle className="mr-1.5 size-3 animate-spin" /> : null}{t("template_market.install")}</button></div> : null}
            {visible.length ? <div className="grid gap-3 sm:grid-cols-2">{visible.map((item) => <article key={item.manifest.id} className="group relative overflow-hidden rounded-2xl border border-dls-border bg-dls-surface transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"><button type="button" className="block w-full text-left" onClick={() => setPreviewTemplate(item)} aria-label={t("template_market.preview_aria", { title: item.manifest.title })}><TemplateCover client={client} workspaceId={workspaceId} template={item} alt={t("template_market.cover_alt", { title: item.manifest.title })} /></button><div className="p-4"><div className="flex items-start justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{item.manifest.title}{isPptxCompatibleTemplate(item.manifest) ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">{t("template_market.pptx_compatible")}</span> : null}{item.sourceType === "local" ? <span className="rounded bg-dls-hover px-1.5 py-0.5 text-[9px] font-medium text-dls-secondary">{t("new_conversation.templates.local")}</span> : null}{item.updateAvailable ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">{t("template_market.update")}</span> : null}</div><div className="mt-1 line-clamp-2 text-xs leading-5 text-dls-secondary">{item.manifest.description}</div><div className="mt-1 text-[10px] text-dls-secondary/75">{item.manifest.source.name}</div></div><details className="relative"><summary className="grid size-7 cursor-pointer list-none place-items-center rounded-lg text-dls-secondary hover:bg-dls-hover"><Ellipsis className="size-4" /></summary><div className="absolute right-0 top-8 z-20 w-36 rounded-xl border border-dls-border bg-dls-surface p-1 text-xs shadow-xl"><div className="px-2 py-1.5 text-[10px] text-dls-secondary">{item.manifest.source.license}</div>{item.installed ? <button type="button" onClick={() => onUninstall(item.manifest.id)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-dls-hover">{t("template_market.uninstall_template")}</button> : null}{item.updateAvailable ? <button type="button" onClick={() => onInstall(item.manifest.id)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-dls-hover">{t("template_market.update_template")}</button> : null}</div></details></div><div className="mt-4 flex items-center gap-2"><button type="button" onClick={() => setPreviewTemplate(item)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dls-border px-3 text-xs font-medium text-dls-text transition hover:bg-dls-hover"><Eye className="size-3.5" />{t("template_market.preview")}</button><button type="button" disabled={busyId !== null} onClick={() => item.updateAvailable || !item.installed ? onInstall(item.manifest.id) : onChoose(item.manifest.id)} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">{busyId === item.manifest.id ? <LoaderCircle className="mr-1.5 size-3 animate-spin" /> : null}{item.updateAvailable ? t("template_market.update") : item.installed ? t("template_market.use_template") : t("template_market.install")}</button></div></div></article>)}</div> : <div className="rounded-2xl border border-dls-border bg-dls-surface p-6 text-center"><p className="text-sm font-medium">{t("templates.starter.empty_title")}</p><p className="mt-1 text-xs text-dls-secondary">{t("templates.starter.empty_description")}</p></div>}
          </div>;
        })()}
      </div>
    </div>
    <Dialog open={Boolean(previewTemplate)} onOpenChange={(open) => { if (!open) setPreviewTemplate(null); }}><DialogContent className="max-w-[960px] gap-0 overflow-hidden p-0 sm:max-w-[960px]">{previewTemplate ? <><div className="aspect-video overflow-hidden bg-dls-hover"><TemplateCover client={client} workspaceId={workspaceId} template={previewTemplate} className="h-full" alt={t("template_market.preview_alt", { title: previewTemplate.manifest.title })} /></div><div className="relative z-10 flex flex-col gap-5 border-t border-dls-border bg-dls-surface px-6 pb-5 pt-8 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0 flex-1"><div className="flex min-h-7 items-center"><DialogTitle className="text-lg">{previewTemplate.manifest.title}</DialogTitle></div><DialogDescription className="mt-2 line-clamp-2 max-w-2xl text-xs leading-5">{previewTemplate.manifest.description}</DialogDescription><p className="mt-2 text-[10px] text-dls-secondary">{previewTemplate.manifest.source.name} / {previewTemplate.manifest.source.license}</p></div><div className="flex shrink-0 gap-2"><Button variant="outline" size="sm" className="rounded-xl" onClick={() => setPreviewTemplate(null)}>{t("common.back")}</Button><Button size="sm" className="rounded-xl" disabled={busyId !== null} onClick={() => { setPreviewTemplate(null); if (previewTemplate.updateAvailable || !previewTemplate.installed) onInstall(previewTemplate.manifest.id); else onChoose(previewTemplate.manifest.id); }}>{busyId === previewTemplate.manifest.id ? <LoaderCircle className="size-3.5 animate-spin" /> : null}{previewTemplate.updateAvailable ? t("template_market.update_template") : previewTemplate.installed ? t("template_market.use_template") : t("template_market.install_template")}</Button></div></div></> : null}</DialogContent></Dialog>
  </>);
}

function TemplateBriefCard({ template, onSubmit, onClose }: { template: TemplateManifestV1; onSubmit: (brief: TemplateBrief, references: TemplateReferenceItem[]) => void; onClose: () => void | Promise<void> }) {
  const config = templateBriefConfigFor(template);
  const [brief, setBrief] = useState<TemplateBrief>({ title: "", audience: "", details: "" });
  const [references, setReferences] = useState<TemplateReferenceItem[]>([]);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const referencesRef = useRef<TemplateReferenceItem[]>([]);

  const updateReferences = (updater: (current: TemplateReferenceItem[]) => TemplateReferenceItem[]) => {
    const next = updater(referencesRef.current);
    referencesRef.current = next;
    setReferences(next);
  };

  const applyReferenceBriefAutofill = (inferred: TemplateBrief) => {
    if (!inferred.title && !inferred.audience && !inferred.details) return;
    setBrief((current) => ({
      title: current.title.trim() ? current.title : inferred.title,
      audience: current.audience.trim() ? current.audience : inferred.audience,
      details: current.details.trim() ? current.details : inferred.details,
    }));
    toast.success(t("templates.brief.reference_autofilled"));
  };

  const addReferenceFiles = async (files: File[]) => {
    if (!files.length) return;
    const unsupported = files.filter((file) => !isReferenceFile(file));
    const supported = files.filter((file) => isReferenceFile(file));
    if (unsupported.length) {
      toast.warning(
        unsupported.length === 1
          ? t("templates.brief.reference_unsupported_one", { name: unsupported[0]?.name ?? "" })
          : t("templates.brief.reference_unsupported_many", { count: unsupported.length }),
        { description: t("templates.brief.reference_supported_formats") },
      );
    }
    if (!supported.length) return;
    setReferenceBusy(true);
    const pending = supported.map((file) => ({
      id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      status: "parsing" as const,
      sendOriginal: false,
    }));
    updateReferences((current) => [...current, ...pending]);

    try {
      const results = await Promise.all(pending.map(async (item): Promise<TemplateReferenceItem> => {
        try {
          const ingestion = await ingestReferenceFile(item.file);
          const status: TemplateReferenceItem["status"] = ingestion.quality === "high" || ingestion.quality === "medium" ? "ready" : ingestion.quality === "low" ? "weak" : "failed";
          return { ...item, mimeType: ingestion.mimeType, status, ingestion };
        } catch (error) {
          toast.warning(t("templates.brief.reference_status_failed"), {
            description: error instanceof Error ? error.message : item.fileName,
          });
          return { ...item, status: "failed" };
        }
      }));
      const activeResults = results.filter((result) => referencesRef.current.some((reference) => reference.id === result.id));
      updateReferences((current) => current.map((item) => activeResults.find((result) => result.id === item.id) ?? item));
      applyReferenceBriefAutofill(inferTemplateBriefFromIngestions(
        activeResults.flatMap((result) => result.ingestion ? [result.ingestion] : []),
      ));
    } finally {
      setReferenceBusy(false);
    }
  };

  const removeReference = (id: string) => {
    updateReferences((current) => current.filter((item) => item.id !== id));
  };

  return <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-6 py-10">
    <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-dls-border bg-dls-surface shadow-[var(--dls-card-shadow)]">
      <div className={cn("relative p-5 pr-14", template.surface === "video" ? "bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-white" : "bg-gradient-to-br from-stone-100 via-orange-50 to-white")}>
        <Button type="button" variant="ghost" size="icon-sm" className={cn("absolute right-4 top-4 rounded-full", template.surface === "video" ? "text-white/70 hover:text-white" : "text-dls-secondary hover:text-dls-text")} aria-label={t("common.close")} onClick={() => void onClose()}><X className="size-4" /></Button>
        <p className={cn("text-xs font-medium", template.surface === "video" ? "text-indigo-200" : "text-dls-secondary")}>{template.title} / {config.label}</p>
        <h2 className="mt-1 text-lg font-semibold">{config.heading}</h2>
        <p className={cn("mt-1 text-sm", template.surface === "video" ? "text-white/65" : "text-dls-secondary")}>{config.description}</p>
      </div>
      <div className="space-y-4 p-5">
        {config.fields.map((field) => <label key={field.key} className="block text-sm font-medium">{field.label}{field.optional ? <span className="ml-1 text-xs font-normal text-dls-secondary">{t("common.optional_parens")}</span> : null}<Input value={brief[field.key]} onChange={(event) => { const value = event.currentTarget.value; setBrief((current) => ({ ...current, [field.key]: value })); }} placeholder={field.placeholder} className="mt-2" /></label>)}
        {TEMPLATE_REFERENCE_UPLOAD_VISIBLE ? <div className="rounded-xl border border-dls-border bg-dls-canvas/45 p-3">
          <div className="flex items-start justify-between gap-3">
            <div><div className="text-sm font-medium">{t("templates.brief.reference_label")}<span className="ml-1 text-xs font-normal text-dls-secondary">{t("common.optional_parens")}</span></div><p className="mt-1 text-xs leading-5 text-dls-secondary">{t("templates.brief.reference_description")}</p></div>
            <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 rounded-lg px-2.5 text-xs" disabled={referenceBusy} onClick={() => referenceInputRef.current?.click()}>{referenceBusy ? <LoaderCircle className="size-3 animate-spin" /> : <Upload className="size-3" />}{t("templates.brief.reference_upload")}</Button>
            <input ref={referenceInputRef} type="file" multiple accept={TEMPLATE_BRIEF_REFERENCE_ACCEPT} className="hidden" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void addReferenceFiles(files); }} />
          </div>
          {references.length ? <div className="mt-3 grid gap-2">{references.map((reference) => <div key={reference.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-dls-border bg-dls-surface px-2.5 py-2">
            <FileText className="size-3.5 shrink-0 text-dls-secondary" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{reference.fileName}</div>
              <div className="text-[10px] text-dls-secondary">{reference.status === "parsing" ? t("templates.brief.reference_status_parsing") : reference.status === "ready" ? t("templates.brief.reference_status_ready", { quality: reference.ingestion?.quality ?? "high" }) : reference.status === "weak" ? t("templates.brief.reference_status_weak") : t("templates.brief.reference_status_failed")}</div>
              {reference.ingestion?.warnings[0] ? <div className="truncate text-[10px] text-dls-secondary" title={reference.ingestion.warnings[0]}>{reference.ingestion?.warnings[0]}</div> : null}
            </div>
            <Button type="button" variant={reference.sendOriginal ? "secondary" : "ghost"} size="sm" className="h-7 shrink-0 rounded-lg px-2 text-[10px]" disabled={reference.status === "parsing" || !canSendOriginalReference(reference.file)} onClick={() => updateReferences((current) => current.map((item) => item.id === reference.id ? { ...item, sendOriginal: !item.sendOriginal } : item))}>{reference.sendOriginal ? t("templates.brief.reference_send_original_on") : t("templates.brief.reference_send_original_off")}</Button>
            <Button type="button" variant="ghost" size="icon-sm" className="size-7 shrink-0 rounded-lg text-dls-secondary hover:text-dls-text" aria-label={t("templates.brief.reference_remove", { name: reference.fileName })} onClick={() => removeReference(reference.id)}><X className="size-3.5" /></Button>
          </div>)}</div> : null}
        </div> : null}
        <Button className="w-full" disabled={!brief.title.trim() || !brief.audience.trim() || referenceBusy} onClick={() => onSubmit({ title: brief.title.trim(), audience: brief.audience.trim(), details: brief.details.trim() }, references)}>{config.submitLabel}</Button>
      </div>
    </div>
  </div>;
}

export function SessionPage(props: SessionPageProps) {
  const locale = currentLocale();
  const { config: shellConfig } = useShellConfig();
  const navigate = useNavigate();
  const denAuth = useDenAuth();
  const activeEnterprise = useActiveEnterpriseConnection();
  const sidebarOpen = useUiStateStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStateStore((state) => state.setSidebarOpen);
  const sessionSidePanel = useUiStateStore((state) => (
    props.selectedSessionId ? state.sidePanelState[props.selectedSessionId] ?? null : null
  ));
  const voiceSidePanelOpen = useUiStateStore((state) => state.sidePanelState[GLOBAL_VOICE_SIDE_PANEL_KEY] === "voice");
  const setSidePanelState = useUiStateStore((state) => state.setSidePanelState);
  const toggleSidePanelState = useUiStateStore((state) => state.toggleSidePanelState);
  const openTab = usePanelTabStore((state) => state.openTab);
  const closeTab = usePanelTabStore((state) => state.closeTab);
  const selectTab = usePanelTabStore((state) => state.selectTab);
  const transcriptTargets = usePanelTabStore((state) => (
    props.selectedSessionId ? state.transcriptArtifactTargets[props.selectedSessionId] ?? EMPTY_TRANSCRIPT_TARGETS : EMPTY_TRANSCRIPT_TARGETS
  ));
  const sessionPanelState = useSessionPanelState(props.selectedSessionId ?? "");
  const activePanelTab = useActivePanelTab(props.selectedSessionId ?? "");
  const [hiddenTargetRevision, setHiddenTargetRevision] = useState(0);
  const [, setExtensionStateVersion] = useState(0);
  const hiddenAccessibleTargetIds = useMemo(
    () => readHiddenAccessibleTargetIds(props.selectedWorkspaceId, props.selectedSessionId),
    [props.selectedSessionId, props.selectedWorkspaceId, hiddenTargetRevision],
  );
  const accessibleTargets = useMemo(
    () => transcriptTargets.filter((target) => isTrackableAccessibleTarget(target) && !hiddenAccessibleTargetIds.has(target.id)),
    [hiddenAccessibleTargetIds, transcriptTargets],
  );
  const artifactFileTargets = useMemo(() => accessibleTargets.filter(isCollectibleArtifactTarget), [accessibleTargets]);
  const artifactTargetCount = artifactFileTargets.length;
  const hasArtifactTargets = artifactTargetCount > 0;
  const activeSidePanel = voiceSidePanelOpen ? "voice" : sessionSidePanel;
  const selectedSessionTitle = useMemo(
    () => sessionTitleForId(props.sidebar.projectSessionLists, props.selectedSessionId),
    [props.selectedSessionId, props.sidebar.projectSessionLists],
  );
  const [templateSessionRevision, setTemplateSessionRevision] = useState(0);
  const [templateCatalog, setTemplateCatalog] = useState<TemplateCatalogItem[]>([]);
  const [templateResourceScope, setTemplateResourceScope] = useState<WorkContextId>(() => readActiveWorkContextId());
  const [enterpriseTemplateResources, setEnterpriseTemplateResources] = useState<EnterpriseResource[]>([]);
  const [templateCatalogLoading, setTemplateCatalogLoading] = useState(false);
  const [templateCatalogError, setTemplateCatalogError] = useState<string | null>(null);
  const [templateBusyId, setTemplateBusyId] = useState<string | null>(null);
  const templateCatalogRequestIdRef = useRef(0);
  const [starterTemplateCatalog, setStarterTemplateCatalog] = useState<TemplateCatalogItem[]>([]);
  const [starterTemplateCatalogLoading, setStarterTemplateCatalogLoading] = useState(false);
  const starterTemplateCatalogRequestIdRef = useRef(0);
  const templateImportInFlightRef = useRef(false);
  const [templateMarketOpen, setTemplateMarketOpen] = useState(false);
  const previousTemplateMarketOpenRef = useRef(false);
  const [cloudSignInComingSoonOpen, setCloudSignInComingSoonOpen] = useState(false);
  const [templateSessionData, setTemplateSessionData] = useState<TemplateSessionData | null>(null);
  const [templateSessionLoading, setTemplateSessionLoading] = useState(false);
  const [templateSaveOpen, setTemplateSaveOpen] = useState(false);
  const [templateValidationReport, setTemplateValidationReport] = useState<TemplateValidationReport | null>(null);
  const [templateValidationBusy, setTemplateValidationBusy] = useState(false);
  const [templateSaveMode, setTemplateSaveMode] = useState<TemplateSaveMode | null>(null);
  const changeTemplateResourceScope = useCallback((scope: WorkContextId) => {
    templateCatalogRequestIdRef.current += 1;
    setTemplateResourceScope(scope);
    setTemplateCatalog([]);
    setEnterpriseTemplateResources([]);
    setTemplateCatalogLoading(false);
    setTemplateCatalogError(null);
  }, []);
  useEffect(() => {
    changeTemplateResourceScope(readActiveWorkContextId());
  }, [activeEnterprise?.id, changeTemplateResourceScope]);
  const [sessionTypeRevision, setSessionTypeRevision] = useState(0);
  const selectedSessionType = useMemo(() => (
    props.selectedSessionId && typeof window !== "undefined"
      ? readSessionType(props.selectedSessionId)
      : null
  ), [props.selectedSessionId, sessionTypeRevision]);
  const isDesignSession = selectedSessionType === "design";
  const isVideoSession = selectedSessionType === "video";
  const currentVideoEntryPath = props.selectedSessionId && isVideoSession
    ? videoProjectEntryPath(props.selectedSessionId)
    : undefined;
  const currentTemplateSessionData = templateSessionData?.sessionId === props.selectedSessionId
    ? templateSessionData
    : null;
  const hasTemplateSession = Boolean(currentTemplateSessionData);
  const hasTemplateBrief = currentTemplateSessionData?.hasBrief === true;
  const selectedTemplate = currentTemplateSessionData?.manifest ?? null;
  const designTemplateEntryPath = currentTemplateSessionData?.manifest.surface === "design"
    ? currentTemplateSessionData.state.entry
    : undefined;
  const isPresentationSession = selectedTemplate?.category === "slides";
  const artifactContext = useMemo<ArtifactInteractionContext | undefined>(() => {
    if (currentVideoEntryPath) {
      return { kind: "video", entryPath: currentVideoEntryPath };
    }
    if (isPresentationSession && designTemplateEntryPath) {
      return { kind: "presentation", entryPath: designTemplateEntryPath };
    }
    return undefined;
  }, [currentVideoEntryPath, designTemplateEntryPath, isPresentationSession]);
  const artifactDirectory = artifactContext
    ? artifactDirectoryPath(artifactContext.entryPath)
    : "";
  const artifactScopeKey = props.selectedSessionId && artifactDirectory
    ? `${props.selectedSessionId}:${artifactDirectory}`
    : "";
  const templateEntryPathForArtifacts = isPresentationSession
    ? undefined
    : designTemplateEntryPath;
  const [artifactCatalogState, setArtifactCatalogState] = useState<{
    scopeKey: string
    files: string[]
  }>({ scopeKey: "", files: [] });
  const [conversationMessageState, setConversationMessageState] = useState<{ sessionId: string | null; messages: UIMessage[] }>({
    sessionId: null,
    messages: [],
  });
  const [dismissedTemplateBriefSessionIds, setDismissedTemplateBriefSessionIds] = useState<Set<string>>(() => new Set());
  const handleConversationMessagesChange = useCallback((sessionId: string, messages: UIMessage[]) => {
    setConversationMessageState({ sessionId, messages });
  }, []);
  const conversationMessages = conversationMessageState.sessionId === props.selectedSessionId
    ? conversationMessageState.messages
    : [];
  useEffect(() => {
    if (!artifactScopeKey || !artifactDirectory || !props.ipolloworkServerClient || !props.runtimeWorkspaceId) {
      return;
    }

    let active = true;
    const client = props.ipolloworkServerClient;
    const workspaceId = props.runtimeWorkspaceId;
    const scopeKey = artifactScopeKey;
    const timeout = window.setTimeout(() => {
      void client
        .listWorkspaceFiles(workspaceId, artifactDirectory)
        .then((entries) => {
          if (!active) return;
          setArtifactCatalogState({
            scopeKey,
            files: entries
              .filter((entry) => entry.kind === "file")
              .map((entry) => entry.path),
          });
        })
        .catch(() => {
          if (active) setArtifactCatalogState({ scopeKey, files: [] });
        });
    }, 150);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    artifactDirectory,
    artifactScopeKey,
    props.ipolloworkServerClient,
    props.runtimeWorkspaceId,
  ]);
  const artifactFiles = useMemo(
    () => artifactContext && artifactCatalogState.scopeKey === artifactScopeKey
      ? artifactCatalogState.files
      : undefined,
    [artifactCatalogState, artifactContext, artifactScopeKey],
  );
  const videoOutput = useMemo(() => (
    currentVideoEntryPath
      ? getArtifactsFromMessages(conversationMessages, accessibleTargets, { includeTargetFallbacks: true })
        .find((artifact) => artifactPathMatchesTarget(artifact.path, currentVideoEntryPath)) ?? null
      : null
  ), [accessibleTargets, conversationMessages, currentVideoEntryPath]);
  const autoCollapsedSidebarRef = useRef(false);
  const autoCollapsedSidePanelRef = useRef<SessionPanelView | null>(null);
  const lastRightPanelViewRef = useRef<SessionPanelView>("launcher");
  const userOpenedSidebarWhileNarrowRef = useRef(false);
  const userOpenedSidePanelWhileNarrowRef = useRef(false);
  const prioritizeRightPanel = useCallback(() => {
    userOpenedSidebarWhileNarrowRef.current = false;
    userOpenedSidePanelWhileNarrowRef.current = true;
    autoCollapsedSidePanelRef.current = null;
  }, []);
  const autoOpenedDesignTemplateRef = useRef<string | null>(null);
  const autoOpenedVideoTemplateRef = useRef<string | null>(null);
  const autoOpenedVideoOutputRef = useRef<string | null>(null);
  const templateBriefDismissed = Boolean(
    props.selectedSessionId && dismissedTemplateBriefSessionIds.has(props.selectedSessionId),
  );
  const activateVideoStudio = useCallback((sessionId: string) => {
    // Mark the agent turn as a video task so it receives the session-owned
    // project contract. The Studio itself opens only after an output exists.
    setSessionType(sessionId, "video");
    setSessionTypeRevision((value) => value + 1);
  }, []);
  const openCurrentVideoStudio = useCallback((options?: { auto?: boolean }) => {
    if (!props.selectedSessionId) return;
    if (!options?.auto) prioritizeRightPanel();
    const videoTabId = `video:${props.selectedSessionId}`;
    openTab(props.selectedSessionId, {
      id: videoTabId,
      type: "video",
      label: selectedSessionTitle || t("video.title"),
      sessionId: props.selectedSessionId,
    });
    setSidePanelState(props.selectedSessionId, "panel");
  }, [openTab, prioritizeRightPanel, props.selectedSessionId, selectedSessionTitle, setSidePanelState]);
  const refreshTemplateCatalog = useCallback(async () => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId) return;
    const requestId = ++templateCatalogRequestIdRef.current;
    setTemplateCatalogLoading(true);
    setTemplateCatalogError(null);
    try {
      if (templateResourceScope === "personal") {
        const localCatalog = await props.ipolloworkServerClient.listTemplates(props.runtimeWorkspaceId, "personal");
        if (requestId !== templateCatalogRequestIdRef.current) return;
        setTemplateCatalog(localCatalog.items);
        setEnterpriseTemplateResources([]);
      } else if (activeEnterprise) {
        const [enterpriseResources, installedCatalog] = await Promise.all([
          listEnterpriseResources(activeEnterprise, "template"),
          props.ipolloworkServerClient.listTemplates(props.runtimeWorkspaceId, templateResourceScope),
        ]);
        if (requestId !== templateCatalogRequestIdRef.current) return;
        setTemplateCatalog(installedCatalog.items.filter((item) => item.sourceType === "local" && item.installed));
        setEnterpriseTemplateResources(enterpriseResources);
      } else {
        setTemplateCatalog([]);
        setEnterpriseTemplateResources([]);
      }
    }
    catch (error) {
      if (requestId === templateCatalogRequestIdRef.current) {
        setTemplateCatalogError(error instanceof Error ? error.message : t("templates.error_load"));
      }
    }
    finally {
      if (requestId === templateCatalogRequestIdRef.current) setTemplateCatalogLoading(false);
    }
  }, [activeEnterprise, props.ipolloworkServerClient, props.runtimeWorkspaceId, templateResourceScope]);
  const refreshStarterTemplateCatalog = useCallback(async () => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId) return;
    const requestId = ++starterTemplateCatalogRequestIdRef.current;
    setStarterTemplateCatalogLoading(true);
    try {
      const catalog = await props.ipolloworkServerClient.listTemplates(
        props.runtimeWorkspaceId,
        PERSONAL_WORK_CONTEXT_ID,
      );
      if (requestId === starterTemplateCatalogRequestIdRef.current) {
        setStarterTemplateCatalog(catalog.items);
      }
    } catch (error) {
      if (requestId === starterTemplateCatalogRequestIdRef.current) {
        toast.error(error instanceof Error ? error.message : t("templates.error_load"));
      }
    } finally {
      if (requestId === starterTemplateCatalogRequestIdRef.current) {
        setStarterTemplateCatalogLoading(false);
      }
    }
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId]);
  const getTemplateCover = useCallback((templateId: string) => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId) {
      return Promise.reject(new Error("Template cover is unavailable."));
    }
    return props.ipolloworkServerClient.getTemplateCover(props.runtimeWorkspaceId, templateId, templateResourceScope);
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId, templateResourceScope]);
  const validateCurrentTemplate = useCallback(async () => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId || !props.selectedSessionId) return null;
    setTemplateValidationBusy(true);
    try {
      const report = await props.ipolloworkServerClient.validateTemplateFromSession(props.runtimeWorkspaceId, props.selectedSessionId);
      setTemplateValidationReport(report);
      return report;
    } catch (error) {
      const report: TemplateValidationReport = {
        ready: false,
        surface: currentTemplateSessionData?.manifest.surface ?? "design",
        entry: currentTemplateSessionData?.manifest.entry ?? "",
        manifest: null,
        issues: [{ code: "template_validation_failed", severity: "error", message: error instanceof Error ? error.message : t("template_authoring.needs_attention") }],
      };
      setTemplateValidationReport(report);
      return report;
    } finally {
      setTemplateValidationBusy(false);
    }
  }, [currentTemplateSessionData, props.ipolloworkServerClient, props.runtimeWorkspaceId, props.selectedSessionId]);
  const openTemplateSave = useCallback(() => {
    if (!currentTemplateSessionData || props.selectedWorkspaceDisplay.workspaceType !== "local") return;
    setTemplateSaveOpen(true);
    setTemplateValidationReport(null);
    void validateCurrentTemplate();
  }, [currentTemplateSessionData, props.selectedWorkspaceDisplay.workspaceType, validateCurrentTemplate]);
  const repairCurrentTemplate = useCallback(() => {
    if (!props.selectedSessionId || !templateValidationReport) return;
    const visible = t("template_authoring.fix_message");
    props.surface?.onSendDraft({
      mode: "prompt",
      parts: [
        { type: "text", text: visible },
        { type: "text", text: `Fix the current template without changing its category or surface. Resolve every server validation issue below, update manifest.json and the validation checklist, then validate again.\n\n${JSON.stringify(templateValidationReport.issues, null, 2)}`, synthetic: true },
      ],
      attachments: [],
      text: visible,
      resolvedText: visible,
    }, props.selectedSessionId);
    setTemplateSaveOpen(false);
  }, [props.selectedSessionId, props.surface, templateValidationReport]);
  const saveTemplatePackageFile = useCallback((packageFile: { filename: string | null; data: ArrayBuffer }) => {
    if (!packageFile.filename) throw new Error(t("template_market.export_filename_missing"));
    return saveFile({
      title: t("template_market.export_package"),
      defaultPath: packageFile.filename,
      filters: [{ name: "iPolloWork Template", extensions: ["ipwp"] }],
    }, packageFile.data);
  }, []);
  const exportPersonalTemplateFile = useCallback(async (templateId: string) => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId) throw new Error(t("template_market.export_unavailable"));
    const packageFile = await props.ipolloworkServerClient.exportTemplatePackage(props.runtimeWorkspaceId, templateId, "personal");
    return saveTemplatePackageFile(packageFile);
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId, saveTemplatePackageFile]);
  const saveCurrentTemplate = useCallback(async (input: TemplateSaveInput) => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId || !props.selectedSessionId || !currentTemplateSessionData) return;
    setTemplateSaveMode(input.mode);
    try {
      const templateRequest = {
        sessionId: props.selectedSessionId,
        category: currentTemplateSessionData.manifest.category,
        title: input.title,
        description: input.description,
        subcategory: currentTemplateSessionData.manifest.subcategory,
        style: currentTemplateSessionData.manifest.style,
        tags: currentTemplateSessionData.manifest.tags,
      };
      if (input.mode === "export") {
        const packageFile = await props.ipolloworkServerClient.exportTemplateFromSession(props.runtimeWorkspaceId, templateRequest);
        const filePath = await saveTemplatePackageFile(packageFile);
        if (!filePath) return;
        setTemplateSaveOpen(false);
        toast.success(t("template_market.exported"));
        return;
      }
      await props.ipolloworkServerClient.saveTemplateFromSession(props.runtimeWorkspaceId, templateRequest, "personal");
      const personalCatalog = await props.ipolloworkServerClient.listTemplates(props.runtimeWorkspaceId, "personal");
      setTemplateCatalog(personalCatalog.items);
      setTemplateResourceScope("personal");
      setTemplateSaveOpen(false);
      toast.success(t("template_authoring.saved"), {
        description: t("template_authoring.saved_description"),
        action: { label: t("template_authoring.view_template"), onClick: () => setTemplateMarketOpen(true) },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("template_authoring.needs_attention"));
      await validateCurrentTemplate();
    } finally {
      setTemplateSaveMode(null);
    }
  }, [currentTemplateSessionData, props.ipolloworkServerClient, props.runtimeWorkspaceId, props.selectedSessionId, saveTemplatePackageFile, validateCurrentTemplate]);
  useEffect(() => {
    setTemplateSessionData(null);
    setTemplateSaveOpen(false);
    setTemplateValidationReport(null);
  }, [props.selectedSessionId]);
  useEffect(() => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId || !props.selectedSessionId) {
      setTemplateSessionData(null);
      setTemplateSessionLoading(false);
      return;
    }
    let active = true;
    const client = props.ipolloworkServerClient;
    const workspaceId = props.runtimeWorkspaceId;
    const sessionId = props.selectedSessionId;
    setTemplateSessionLoading(true);
    void (async () => {
      const result = await loadTemplateSession({
        client,
        workspaceId,
        sessionId,
        knownSessionType: selectedSessionType,
      });
      if (!result) {
        if (active) setTemplateSessionData(null);
        if (active) setTemplateSessionLoading(false);
        return;
      }
      try {
        const materializedType = sessionTypeForTemplate(result.manifest);
        if (materializedType !== selectedSessionType) {
          setSessionType(sessionId, materializedType);
          setSessionTypeRevision((value) => value + 1);
        }
        if (materializedType !== "design" && materializedType !== "video") {
          if (active) setTemplateSessionData(null);
          return;
        }
        let hasBrief = false;
        try { const brief = JSON.parse((await client.readWorkspaceFile(workspaceId, result.state.briefPath)).content); hasBrief = Boolean(brief && typeof brief === "object" && Object.keys(brief).length); } catch { hasBrief = false; }
        if (active) setTemplateSessionData({ ...result, hasBrief });
      } catch { if (active) setTemplateSessionData(null); }
      finally { if (active) setTemplateSessionLoading(false); }
    })();
    void refreshTemplateCatalog();
    return () => { active = false; };
  }, [templateSessionRevision, props.ipolloworkServerClient, props.runtimeWorkspaceId, props.selectedSessionId, refreshTemplateCatalog, selectedSessionType]);
  const chooseDesignTemplate = useCallback(async (templateId: iPolloWorkTemplateId) => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId || !props.selectedSessionId) return;
    try {
      setTemplateBusyId(templateId);
      const result = await props.ipolloworkServerClient.materializeTemplate(props.runtimeWorkspaceId, templateId, props.selectedSessionId, undefined, templateResourceScope);
      setSessionType(props.selectedSessionId, sessionTypeForTemplate(result.manifest));
      setTemplateSessionData({ sessionId: props.selectedSessionId, ...result, hasBrief: false });
      setDismissedTemplateBriefSessionIds((current) => {
        const next = new Set(current);
        next.delete(props.selectedSessionId!);
        return next;
      });
      setSessionTypeRevision((value) => value + 1);
      setTemplateSessionRevision((value) => value + 1);
      openTab(props.selectedSessionId, {
        id: `design:${props.selectedSessionId}:${encodeURIComponent(result.state.entry)}`,
        type: "design",
        label: result.state.entry.split("/").filter(Boolean).pop() || "Design",
        sessionId: props.selectedSessionId,
        path: result.state.entry,
      });
      setSidePanelState(props.selectedSessionId, "panel");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create this template.");
    } finally { setTemplateBusyId(null); }
  }, [openTab, props.ipolloworkServerClient, props.runtimeWorkspaceId, props.selectedSessionId, setSidePanelState, templateResourceScope]);
  const installDesignTemplate = useCallback(async (templateId: string) => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId) return;
    setTemplateBusyId(templateId);
    try { await props.ipolloworkServerClient.installTemplate(props.runtimeWorkspaceId, templateId, templateResourceScope); await refreshTemplateCatalog(); }
    catch (error) { toast.error(error instanceof Error ? error.message : t("templates.error_install")); }
    finally { setTemplateBusyId(null); }
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId, refreshTemplateCatalog, templateResourceScope]);
  const uninstallDesignTemplate = useCallback(async (templateId: string) => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId) return;
    if (!window.confirm(t("templates.confirm_uninstall"))) return;
    setTemplateBusyId(templateId);
    try { await props.ipolloworkServerClient.uninstallTemplate(props.runtimeWorkspaceId, templateId, templateResourceScope); await refreshTemplateCatalog(); }
    catch (error) { toast.error(error instanceof Error ? error.message : t("templates.error_uninstall")); }
    finally { setTemplateBusyId(null); }
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId, refreshTemplateCatalog, templateResourceScope]);
  const installStarterTemplate = useCallback(async (templateId: string) => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId) return;
    setTemplateBusyId(templateId);
    try {
      await props.ipolloworkServerClient.installTemplate(
        props.runtimeWorkspaceId,
        templateId,
        PERSONAL_WORK_CONTEXT_ID,
      );
      await refreshStarterTemplateCatalog();
      if (templateResourceScope === PERSONAL_WORK_CONTEXT_ID) await refreshTemplateCatalog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("templates.error_install"));
    } finally {
      setTemplateBusyId(null);
    }
  }, [
    props.ipolloworkServerClient,
    props.runtimeWorkspaceId,
    refreshStarterTemplateCatalog,
    refreshTemplateCatalog,
    templateResourceScope,
  ]);
  const exportPersonalTemplate = useCallback(async (template: TemplateCatalogItem) => {
    setTemplateBusyId(`export:${template.manifest.id}`);
    try {
      const filePath = await exportPersonalTemplateFile(template.manifest.id);
      if (filePath) toast.success(t("template_market.exported"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("template_market.export_failed"));
    } finally {
      setTemplateBusyId(null);
    }
  }, [exportPersonalTemplateFile]);
  const importDesignTemplate = useCallback(async (file: File, category?: TemplateManifestV1["category"]): Promise<boolean> => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId || templateImportInFlightRef.current) return false;
    if (file.size > MAX_TEMPLATE_PACKAGE_BYTES) {
      toast.error(t("templates.error_package_too_large"));
      return false;
    }
    templateImportInFlightRef.current = true;
    setTemplateBusyId("import");
    try {
      const result = await props.ipolloworkServerClient.importTemplate(props.runtimeWorkspaceId, file, category, templateResourceScope);
      toast.success(t("templates.toast_installed", { title: result.item.manifest.title }));
      await refreshTemplateCatalog();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("templates.error_invalid_package"));
      return false;
    } finally {
      templateImportInFlightRef.current = false;
      setTemplateBusyId(null);
    }
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId, refreshTemplateCatalog, templateResourceScope]);
  const installEnterpriseTemplate = useCallback(async (resource: EnterpriseResource) => {
    if (!activeEnterprise || templateResourceScope === "personal") return;
    setTemplateBusyId(resource.id);
    try {
      const file = await downloadEnterpriseResource(activeEnterprise, resource);
      await importDesignTemplate(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message === "desktop_binary_fetch_requires_restart"
        ? t("enterprise_connection.desktop_restart_required")
        : message || t("enterprise_connection.enterprise_resources_error"));
    } finally {
      setTemplateBusyId(null);
    }
  }, [activeEnterprise, importDesignTemplate, templateResourceScope]);
  const submitTemplateBrief = useCallback(async (brief: TemplateBrief, references: TemplateReferenceItem[]) => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId || !props.selectedSessionId) return;
    const templateSession = currentTemplateSessionData;
    if (!templateSession) return;
    const { manifest: template, state } = templateSession;
    let referencePayload: Awaited<ReturnType<typeof buildTemplateReferenceSubmitPayload>> | undefined;
    try {
      referencePayload = await buildTemplateReferenceSubmitPayload(references);
      await props.ipolloworkServerClient.writeWorkspaceFile(props.runtimeWorkspaceId, {
      path: state.briefPath,
      content: JSON.stringify({
        templateId: template.id,
        template: template.title,
        category: template.category,
        surface: template.surface,
        pptxCompatibility: template.pptxCompatibility,
        sourcePath: state.entry,
        applyChecklist: template.applyChecklist,
        referenceFiles: references.map((reference) => ({
          name: reference.fileName,
          mimeType: reference.mimeType,
          size: reference.size,
          quality: reference.ingestion?.quality ?? "failed",
          sourceMode: reference.ingestion?.sourceMode ?? "memory",
          sentOriginal: reference.sendOriginal && canSendOriginalReference(reference.file),
        })),
        ...brief,
      }, null, 2),
      baseUpdatedAt: null,
      });
      setTemplateSessionData((current) => current?.sessionId === props.selectedSessionId ? { ...current, hasBrief: true } : current);
      setTemplateSessionRevision((value) => value + 1);
      setDismissedTemplateBriefSessionIds((current) => {
        if (!props.selectedSessionId || !current.has(props.selectedSessionId)) return current;
        const next = new Set(current);
        next.delete(props.selectedSessionId);
        return next;
      });
      const prompt = templateBriefPrompt({ template, entryPath: state.entry, briefPath: state.briefPath });
      const referencePrompt = referencePayload.contextPack.promptText.trim();
      const visibleTemplateMessage = t("templates.applied", { title: template.title });
      props.surface?.onSendDraft({
        mode: "prompt",
        parts: [
          { type: "text", text: visibleTemplateMessage },
          { type: "text", text: prompt, synthetic: true },
          ...(referencePrompt ? [{ type: "text" as const, text: referencePrompt, synthetic: true }] : []),
        ],
        attachments: referencePayload.attachments,
        text: visibleTemplateMessage,
        resolvedText: visibleTemplateMessage,
      }, props.selectedSessionId);
    } catch (error) {
      toast.error(t("templates.brief.submit_failed"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      if (referencePayload) revokeTemplateReferenceAttachmentPreviews(referencePayload.attachments);
    }
  }, [currentTemplateSessionData, props.ipolloworkServerClient, props.runtimeWorkspaceId, props.selectedSessionId, props.surface]);
  const closeTemplateBrief = useCallback(async () => {
    const sessionId = props.selectedSessionId;
    if (!sessionId) return;
    const emptyGeneratedTemplateSession = !currentTemplateSessionData?.hasBrief && conversationMessages.length === 0;
    if (emptyGeneratedTemplateSession && props.onDeleteSession) {
      try {
        await props.onDeleteSession(sessionId);
        setTemplateSessionData(null);
        setDismissedTemplateBriefSessionIds((current) => {
          const next = new Set(current);
          next.delete(sessionId);
          return next;
        });
        return;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not delete this empty session.");
      }
    }
    setDismissedTemplateBriefSessionIds((current) => {
      const next = new Set(current);
      next.add(sessionId);
      return next;
    });
  }, [conversationMessages.length, currentTemplateSessionData?.hasBrief, props.onDeleteSession, props.selectedSessionId]);
  const [sessionPanelView, setSessionPanelView] = useState<SessionPanelView | null>(null);
  const effectiveSidePanelView = activeSidePanel ?? sessionPanelView;
  const sidePanelOpen = effectiveSidePanelView !== null;
  const panelRailActive = activeSidePanel === "panel";
  const designRailActive = activeSidePanel === "design";
  const videoRailActive = panelRailActive && activePanelTab?.type === "video";
  const extensionsRailActive = activeSidePanel === "extensions";
  const voiceRailActive = activeSidePanel === "voice";
  useEffect(() => {
    if (activeSidePanel === "video") openCurrentVideoStudio({ auto: true });
  }, [activeSidePanel, openCurrentVideoStudio]);
  useEffect(() => {
    if (!props.selectedSessionId) return;
    if (isVideoSession) {
      setSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, null);
      return;
    }
  }, [isVideoSession, props.selectedSessionId, setSidePanelState]);
  useEffect(() => {
    if (!props.selectedSessionId || !isVideoSession || !videoOutput) return;
    const status = props.sidebar.sessionStatusById[props.selectedSessionId] ?? "idle";
    if (status !== "idle") return;
    const outputKey = `${props.selectedSessionId}:${videoOutput.messageId}:${videoOutput.path}`;
    if (autoOpenedVideoOutputRef.current === outputKey) return;
    autoOpenedVideoOutputRef.current = outputKey;
    openCurrentVideoStudio({ auto: true });
  }, [isVideoSession, openCurrentVideoStudio, props.selectedSessionId, props.sidebar.sessionStatusById, videoOutput]);
  useEffect(() => {
    const autoOpenTemplateProject = currentTemplateSessionData?.authoring === true
      || currentTemplateSessionData?.manifest.id.startsWith("personal.") === true;
    if (!props.selectedSessionId || !isVideoSession || !autoOpenTemplateProject) return;
    const templateKey = `${props.selectedSessionId}:${currentTemplateSessionData.state.entry}`;
    if (autoOpenedVideoTemplateRef.current === templateKey) return;
    autoOpenedVideoTemplateRef.current = templateKey;
    openCurrentVideoStudio({ auto: true });
  }, [currentTemplateSessionData, isVideoSession, openCurrentVideoStudio, props.selectedSessionId]);
  useEffect(() => {
    autoOpenedVideoOutputRef.current = null;
    autoOpenedVideoTemplateRef.current = null;
  }, [props.selectedSessionId]);
  const voiceExtension = useMemo(
    () => IPOLLOWORK_EXTENSION_CATALOG.find((entry) => getExtensionId(entry) === "ipollowork-voice") ?? null,
    [],
  );
  const voiceExtensionEnabled = voiceExtension ? isiPolloWorkExtensionEnabled(voiceExtension) : false;
  const openCloudSignIn = useCallback(() => {
    setCloudSignInComingSoonOpen(true);
  }, []);
  const openCloudAccount = useCallback(() => {
    navigate(props.selectedWorkspaceId
      ? workspaceSettingsRoute(props.selectedWorkspaceId, "cloud-account")
      : "/settings/cloud-account");
  }, [navigate, props.selectedWorkspaceId]);

  useReactRenderWatchdog("SessionPage", {
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    clientConnected: props.clientConnected,
    startupPhase: props.startupPhase,
    hasSurface: Boolean(props.surface),
    workspaceCount: props.workspaces.length,
  });

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectName, setCreateProjectName] = useState("");
  const [createProjectFolder, setCreateProjectFolder] = useState("");
  const [createProjectBusy, setCreateProjectBusy] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);
  const [renameProjectId, setRenameProjectId] = useState<string | null>(null);
  const [renameProjectName, setRenameProjectName] = useState("");
  const [renameProjectBusy, setRenameProjectBusy] = useState(false);
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);
  const [deleteProjectBusy, setDeleteProjectBusy] = useState(false);
  const [mainWorkspaceView, setMainWorkspaceView] = useState<"extensions" | null>(null);
  const preserveSidePanelOnPanelOpenRef = useRef(false);

  const setCurrentSidePanel = useCallback((panel: SidePanelItem | null) => {
    if (panel === "design" && props.selectedSessionId) {
      const entryPath = designTemplateEntryPath?.replaceAll("\\", "/").trim() || "";
      const designTabId = entryPath
        ? `design:${props.selectedSessionId}:${encodeURIComponent(entryPath)}`
        : `design:${props.selectedSessionId}:entry`;
      const existing = sessionPanelState.tabs.find((tab) => tab.id === designTabId);
      if (!existing) {
        openTab(props.selectedSessionId, {
          id: designTabId,
          type: "design",
          label: entryPath.split("/").filter(Boolean).pop() || "Design",
          sessionId: props.selectedSessionId,
          path: entryPath || undefined,
        });
      } else {
        selectTab(props.selectedSessionId, designTabId);
      }
      panel = "panel";
    }
    if (panel) {
      userOpenedSidePanelWhileNarrowRef.current = true;
      autoCollapsedSidePanelRef.current = null;
    }
    if (panel) setMainWorkspaceView(null);
    setSessionPanelView(null);
    setSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, panel === "voice" ? "voice" : null);
    if (panel === "voice") return;
    setSidePanelState(props.selectedSessionId, panel);
  }, [designTemplateEntryPath, openTab, props.selectedSessionId, selectTab, sessionPanelState.tabs, setSidePanelState]);

  const openDesignTab = useCallback((path?: string) => {
    if (!props.selectedSessionId) return;
    const normalizedPath = path?.replaceAll("\\", "/").trim() || designTemplateEntryPath?.replaceAll("\\", "/").trim() || "";
    if (!normalizedPath) {
      setCurrentSidePanel("panel");
      return;
    }
    const designTabId = normalizedPath
      ? `design:${props.selectedSessionId}:${encodeURIComponent(normalizedPath)}`
      : `design:${props.selectedSessionId}:entry`;
    const label = normalizedPath.split("/").filter(Boolean).pop() || "Design";
    const existing = sessionPanelState.tabs.find((tab) => tab.id === designTabId);
    if (!existing) {
      openTab(props.selectedSessionId, {
        id: designTabId,
        type: "design",
        label,
        sessionId: props.selectedSessionId,
        path: normalizedPath || undefined,
      });
    } else {
      selectTab(props.selectedSessionId, designTabId);
    }
    setCurrentSidePanel("panel");
  }, [designTemplateEntryPath, openTab, props.selectedSessionId, selectTab, sessionPanelState.tabs, setCurrentSidePanel]);

  useEffect(() => {
    if (!props.selectedSessionId || !designTemplateEntryPath) return;
    const templateKey = `${props.selectedSessionId}:${designTemplateEntryPath}`;
    if (autoOpenedDesignTemplateRef.current === templateKey) return;
    autoOpenedDesignTemplateRef.current = templateKey;
    openDesignTab(designTemplateEntryPath);
  }, [designTemplateEntryPath, openDesignTab, props.selectedSessionId]);

  const toggleCurrentSidePanel = useCallback((panel: SidePanelItem) => {
    userOpenedSidebarWhileNarrowRef.current = false;
    setMainWorkspaceView(null);
    setSessionPanelView(null);
    if (panel === "voice") {
      userOpenedSidePanelWhileNarrowRef.current = true;
      autoCollapsedSidePanelRef.current = null;
      toggleSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, "voice");
      return;
    }
    userOpenedSidePanelWhileNarrowRef.current = true;
    autoCollapsedSidePanelRef.current = null;
    setSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, null);
    toggleSidePanelState(props.selectedSessionId, panel);
  }, [props.selectedSessionId, setSidePanelState, toggleSidePanelState]);

  // When the agent calls a built-in browser tool, the main process opens
  // the WebContentsView and sends panel-opened; when hide_browser is called
  // it sends panel-closed. Without this listener the React UI never knows
  // the panel opened and doesn't render the unified panel chrome.
  useEffect(() => {
    if (!isElectronRuntime()) return;
    const browser = (window as Window).__IPOLLOWORK_ELECTRON__?.browser;
    if (!browser) return;
    const unsubOpen = browser.onPanelOpened?.(() => {
      if (preserveSidePanelOnPanelOpenRef.current) {
        preserveSidePanelOnPanelOpenRef.current = false;
        return;
      }
      setCurrentSidePanel("panel");
    });
    const unsubClose = browser.onPanelClosed?.(() => {
      const remainingTabs = props.selectedSessionId
        ? usePanelTabStore.getState().sessions[props.selectedSessionId]?.tabs ?? []
        : [];
      if (remainingTabs.some((tab) => tab.type !== "browser")) {
        return;
      }
      if (remainingTabs.some((tab) => tab.type === "browser")) {
        return;
      }
      setCurrentSidePanel(null);
    });
    return () => { unsubOpen?.(); unsubClose?.(); };
  }, [props.selectedSessionId, setCurrentSidePanel]);
  const {
    leftSidebarResizing,
    leftSidebarWidth,
    rightSidebarExpandedWidth: browserPanelWidth,
    setRightSidebarExpandedWidth: setBrowserPanelWidth,
    startLeftSidebarResize,
  } = useWorkspaceShellLayout({
    expandedRightWidth: 520,
    minRightWidth: MIN_RIGHT_PANEL_WIDTH,
  });
  const [browserPanelDefaultWidth, setBrowserPanelDefaultWidth] = useState(browserPanelWidth);
  const [rightPanelManuallyResized, setRightPanelManuallyResized] = useState(false);
  const [rightPanelResizing, setRightPanelResizing] = useState(false);
  const rightPanelElementRef = useRef<HTMLElement>(null);
  const [rightPanelExpanded, setRightPanelExpanded] = useState(false);
  const rightWorkspaceExpanded = rightPanelExpanded;
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === "undefined" ? MAIN_WORKSPACE_MIN_WIDTH : window.innerWidth
  ));
  const narrowLayout = viewportWidth < NARROW_LAYOUT_WIDTH;
  const effectiveLeftSidebarWidth = narrowLayout ? Math.min(leftSidebarWidth, 200) : leftSidebarWidth;
  const designTabActive = effectiveSidePanelView === "panel" && activePanelTab?.type === "design";
  const videoTabActive = effectiveSidePanelView === "panel" && activePanelTab?.type === "video";
  const desiredRightPanelWidth = designTabActive || effectiveSidePanelView === "design"
    ? MIN_DESIGN_PANEL_WIDTH
    : MIN_RIGHT_PANEL_WIDTH;
  const visibleLeftSidebarWidth = shellConfig.sidebar && sidebarOpen ? effectiveLeftSidebarWidth : 0;
  const workspaceWidthAfterLeftSidebar = Math.max(0, viewportWidth - visibleLeftSidebarWidth);
  const mainWorkspaceMinWidth = Math.min(
    MAIN_WORKSPACE_MIN_WIDTH,
    workspaceWidthAfterLeftSidebar,
  );
  const availableRightPanelWidth = Math.max(
    0,
    workspaceWidthAfterLeftSidebar - mainWorkspaceMinWidth,
  );
  const effectiveRightPanelMinWidth = Math.min(availableRightPanelWidth, desiredRightPanelWidth);
  const preferredVideoPanelWidth = rightPanelManuallyResized
    ? browserPanelDefaultWidth
    : Math.max(browserPanelDefaultWidth, VIDEO_PANEL_DEFAULT_WIDTH);
  const preferredBrowserPanelWidth = videoTabActive
    ? preferredVideoPanelWidth
    : effectiveSidePanelView === "launcher"
      ? 320
      : effectiveSidePanelView === "outputs"
        ? Math.max(browserPanelDefaultWidth, 360)
        : effectiveSidePanelView === "extensions" || effectiveSidePanelView === "design" || designTabActive
          ? Math.max(browserPanelDefaultWidth, 480)
          : browserPanelDefaultWidth;
  const requestedBrowserPanelWidth = narrowLayout
    ? Math.max(effectiveRightPanelMinWidth, Math.min(preferredBrowserPanelWidth, 180))
    : Math.max(effectiveRightPanelMinWidth, preferredBrowserPanelWidth);
  const effectiveBrowserPanelWidth = Math.min(
    availableRightPanelWidth,
    requestedBrowserPanelWidth,
  );
  const sidebarProviderStyle: CSSProperties & Record<"--sidebar-width", string> = {
    "--sidebar-width": `${effectiveLeftSidebarWidth}px`,
  };
  const sessionShellTransition = [
    `width ${SESSION_SHELL_TRANSITION_MS}ms ${SESSION_SHELL_TRANSITION_EASING}`,
    `min-width ${SESSION_SHELL_TRANSITION_MS}ms ${SESSION_SHELL_TRANSITION_EASING}`,
    `opacity ${Math.round(SESSION_SHELL_TRANSITION_MS * 0.75)}ms ease-out`,
  ].join(", ");
  const rightPanelTransitionStyle: CSSProperties = {
    transition: rightPanelResizing ? "none" : sessionShellTransition,
    opacity: sidePanelOpen ? 1 : 0,
  };
  const availableMainWorkspaceWidth = viewportWidth
    - (shellConfig.sidebar && sidebarOpen ? effectiveLeftSidebarWidth : 0)
    - (sidePanelOpen ? effectiveBrowserPanelWidth : 0);
  const requestedMainWorkspaceWidth = viewportWidth
    - visibleLeftSidebarWidth
    - (sidePanelOpen ? requestedBrowserPanelWidth : 0);
  const expandedMainWorkspaceWidth = viewportWidth
    - (shellConfig.sidebar ? effectiveLeftSidebarWidth : 0)
    - (sidePanelOpen ? effectiveBrowserPanelWidth : 0);
  const expandedRightPanelWorkspaceWidth = viewportWidth
    - visibleLeftSidebarWidth
    - (autoCollapsedSidePanelRef.current ? effectiveBrowserPanelWidth : 0);
  const sidebarVisuallyCollapsed = !sidebarOpen;
  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  useEffect(() => {
    if (!shellConfig.sidebar) return;
    if (
      requestedMainWorkspaceWidth < AUTO_COLLAPSE_WORKSPACE_WIDTH &&
      sidebarOpen &&
      !userOpenedSidebarWhileNarrowRef.current
    ) {
      autoCollapsedSidebarRef.current = true;
      setSidebarOpen(false);
      return;
    }
    if (
      autoCollapsedSidebarRef.current &&
      !sidebarOpen &&
      expandedMainWorkspaceWidth >= AUTO_RESTORE_WORKSPACE_WIDTH
    ) {
      autoCollapsedSidebarRef.current = false;
      userOpenedSidebarWhileNarrowRef.current = false;
      setSidebarOpen(true);
    }
  }, [
    requestedMainWorkspaceWidth,
    expandedMainWorkspaceWidth,
    setSidebarOpen,
    shellConfig.sidebar,
    sidebarOpen,
    sidePanelOpen,
  ]);
  useEffect(() => {
    if (sidePanelOpen) return;
    setBrowserPanelDefaultWidth(browserPanelWidth);
  }, [sidePanelOpen, browserPanelWidth]);
  useEffect(() => {
    if (effectiveSidePanelView) {
      lastRightPanelViewRef.current = effectiveSidePanelView;
    }
    setRightPanelManuallyResized(false);
  }, [effectiveSidePanelView]);
  const handleSidebarOpenChange = useCallback((open: boolean) => {
    if (open) {
      userOpenedSidebarWhileNarrowRef.current = true;
      autoCollapsedSidebarRef.current = false;
    } else {
      userOpenedSidebarWhileNarrowRef.current = false;
    }
    setSidebarOpen(open);
  }, [setSidebarOpen]);
  useEffect(() => {
    props.onAccessibleTargetsChange?.(accessibleTargets);
  }, [accessibleTargets, props.onAccessibleTargetsChange]);
  const setRightPanelExpandedState = useCallback((expanded: boolean) => {
    if (expanded) {
      setRightPanelExpanded(true);
      return;
    }
    setRightPanelExpanded(false);
  }, []);
  const closeExpandedWorkSurface = useCallback(() => {
    if (rightPanelExpanded) setRightPanelExpanded(false);
  }, [rightPanelExpanded]);
  const handleSidebarOpenSession = useCallback((workspaceId: string, sessionId: string) => {
    closeExpandedWorkSurface();
    props.sidebar.onOpenSession(workspaceId, sessionId);
  }, [closeExpandedWorkSurface, props.sidebar.onOpenSession]);
  const handleSidebarOpenSessionSearch = useCallback(() => {
    closeExpandedWorkSurface();
    props.sidebar.onOpenSessionSearch?.();
  }, [closeExpandedWorkSurface, props.sidebar.onOpenSessionSearch]);
  const startRightPanelResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !sidePanelOpen || rightWorkspaceExpanded) return;
    setRightPanelResizing(true);
    const workspaceWidth = viewportWidth - visibleLeftSidebarWidth;
    const maximumWidth = Math.max(
      effectiveRightPanelMinWidth,
      Math.min(
        workspaceWidth - mainWorkspaceMinWidth,
        workspaceWidth * (videoTabActive ? 0.82 : 0.7),
      ),
    );
    let nextWidth = effectiveBrowserPanelWidth;
    let frameId: number | null = null;
    const resizeHandle = event.currentTarget;
    const rightPanel = rightPanelElementRef.current;
    const applyPendingWidth = () => {
      frameId = null;
      if (rightPanel) rightPanel.style.width = `${nextWidth}px`;
    };
    const handleMove = (moveEvent: PointerEvent) => {
      nextWidth = Math.round(Math.min(maximumWidth, Math.max(
        effectiveRightPanelMinWidth,
        window.innerWidth - moveEvent.clientX,
      )));
      if (frameId === null) frameId = window.requestAnimationFrame(applyPendingWidth);
    };
    const handleStop = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        applyPendingWidth();
      }
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleStop);
      window.removeEventListener("pointercancel", handleStop);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      rightPanel?.style.removeProperty("will-change");
      rightPanel?.style.removeProperty("pointer-events");
      setRightPanelResizing(false);
      if (resizeHandle.hasPointerCapture(event.pointerId)) {
        resizeHandle.releasePointerCapture(event.pointerId);
      }
      setBrowserPanelWidth(nextWidth);
      setBrowserPanelDefaultWidth(nextWidth);
      setRightPanelManuallyResized(true);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleStop);
    window.addEventListener("pointercancel", handleStop);
    resizeHandle.setPointerCapture(event.pointerId);
    if (rightPanel) {
      rightPanel.style.willChange = "width";
      rightPanel.style.pointerEvents = "none";
    }
    Object.assign(document.body.style, { cursor: "ew-resize", userSelect: "none" });
    event.preventDefault();
  }, [
    effectiveBrowserPanelWidth,
    effectiveRightPanelMinWidth,
    mainWorkspaceMinWidth,
    rightWorkspaceExpanded,
    setBrowserPanelWidth,
    setRightPanelManuallyResized,
    sidePanelOpen,
    videoTabActive,
    viewportWidth,
    visibleLeftSidebarWidth,
  ]);
  const handleDesignAskAi = useCallback((context: DesignAiSelectionContext) => {
    useDesignAiSelectionStore.getState().createContext(context);
    const composerStore = useComposerStateStore.getState();
    composerStore.setDraft(
      context.sessionId,
      replaceDesignSelectionToken(
        getComposerDraft(composerStore, context.sessionId),
        designAiSelectionToken(context.id),
      ),
    );
    if (rightPanelExpanded) setRightPanelExpanded(false);
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("ipollowork:focusPrompt"));
    });
  }, [rightPanelExpanded]);
  const browserUrlForTarget = useCallback((target: OpenTarget) => {
    if (/^wss?:\/\//i.test(target.value)) return target.value.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");
    return target.value;
  }, []);
  const downloadOpenTarget = useCallback(async (target: OpenTarget) => {
    if (target.kind !== "file" || !props.ipolloworkServerClient || !props.runtimeWorkspaceId) {
      return;
    }

    const result = await props.ipolloworkServerClient.downloadWorkspaceFile(props.runtimeWorkspaceId, target.value);
    const url = URL.createObjectURL(new Blob([result.data], { type: result.contentType ?? "application/octet-stream" }));
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = target.name;
    anchor.click();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId]);
  const resolveOpenTargetTemplateSurface = useCallback(async (target: OpenTarget, sourceSessionId: string | null | undefined) => {
    if (
      !sourceSessionId
      || sourceSessionId !== props.selectedSessionId
      || target.kind !== "file"
      || !props.ipolloworkServerClient
      || !props.runtimeWorkspaceId
    ) {
      return null;
    }

    const binding = templateSessionData?.sessionId === sourceSessionId
      ? Promise.resolve({ surface: templateSessionData.manifest.surface, entry: templateSessionData.state.entry })
      : props.ipolloworkServerClient
        .getTemplateSession(props.runtimeWorkspaceId, sourceSessionId)
        .then((session) => ({ surface: session.manifest.surface, entry: session.state.entry }))
        .catch(() => null);

    return waitForTemplateEntrySurface(target, binding);
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId, props.selectedSessionId, templateSessionData]);
  const openTarget = useCallback(async (target: OpenTarget, options?: OpenTargetOptions, sourceSessionId?: string) => {
    // SessionSurface automatically previews newly discovered targets after an
    // agent finishes. Video tasks already have a dedicated preview surface.
    if (isVideoSession && options?.auto) return;
    if (target.kind === "url" || target.preview === "browser") {
      const url = browserUrlForTarget(target);
      if (isElectronRuntime()) {
        if (!options?.auto) prioritizeRightPanel();
        preserveSidePanelOnPanelOpenRef.current = true;
        setCurrentSidePanel("panel");
        void window.__IPOLLOWORK_ELECTRON__?.browser?.createTab?.(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      return;
    }
    if (options?.external && target.kind === "file" && props.selectedWorkspaceDisplay.workspaceType !== "remote") {
      const path = absoluteWorkspacePath(props.selectedWorkspaceRoot, target.value);
      if (path && isElectronRuntime()) {
        void (async () => {
          try {
            if (options.reveal) {
              await revealDesktopItemInDir(path);
            } else {
              await openDesktopPath(path);
            }
          } catch {
            await revealDesktopItemInDir(path).catch(() => undefined);
          }
        })();
      }
      return;
    }

    if (isVideoSession && target.kind === "file" && target.preview === "html") {
      if (currentVideoEntryPath && artifactPathMatchesTarget(target.value, currentVideoEntryPath)) {
        openCurrentVideoStudio();
      }
      return;
    }

    if (artifactContext?.kind === "presentation" && target.kind === "file") {
      const presentationDirectory = artifactDirectoryPath(artifactContext.entryPath);
      const isPresentationEntry = artifactPathMatchesTarget(target.value, artifactContext.entryPath);
      const isPresentationFile = target.preview === "slides"
        && artifactPathIsWithinDirectory(target.value, presentationDirectory);
      if (!isPresentationEntry && !isPresentationFile) return;
    }

    const sourceId = sourceSessionId ?? props.selectedSessionId;
    const templateSurface = await resolveOpenTargetTemplateSurface(target, sourceId);
    if (templateSurface) {
      if (!options?.auto) prioritizeRightPanel();
      if (templateSurface === "design") {
        openDesignTab(target.value);
      } else {
        setCurrentSidePanel(templateSurface);
      }
      return;
    }

    if (target.kind === "file" && target.preview === "html") {
      if (!options?.auto) prioritizeRightPanel();
      openDesignTab(target.value);
      return;
    }

    if (!isCollectibleArtifactTarget(target)) {
      if (isOpenableFileTarget(target)) {
        if (props.selectedWorkspaceDisplay.workspaceType === "remote") {
          void downloadOpenTarget(target).catch(() => undefined);
        } else if (isElectronRuntime()) {
          void openDesktopPath(absoluteWorkspacePath(props.selectedWorkspaceRoot, target.value)).catch(() => undefined);
        }
      }
      return;
    }

    const sessionId = sourceId;
    if (!sessionId) return;
    if (options?.auto && activePanelTab?.id === target.id) return;
    if (!options?.auto) prioritizeRightPanel();
    openTab(sessionId, {
      id: target.id,
      type: "artifact",
      label: target.name,
      preview: target.preview,
    });
    preserveSidePanelOnPanelOpenRef.current = true;
    setCurrentSidePanel("panel");
  }, [activePanelTab?.id, artifactContext, browserUrlForTarget, currentVideoEntryPath, downloadOpenTarget, isVideoSession, openCurrentVideoStudio, openDesignTab, openTab, prioritizeRightPanel, props.selectedSessionId, props.selectedWorkspaceDisplay.workspaceType, props.selectedWorkspaceRoot, resolveOpenTargetTemplateSurface, setCurrentSidePanel]);
  const closeRightPane = useCallback((options?: { preserveAutoCollapse?: boolean }) => {
    if (!options?.preserveAutoCollapse) {
      userOpenedSidePanelWhileNarrowRef.current = false;
      autoCollapsedSidePanelRef.current = null;
    }
    setRightPanelExpanded(false);
    setSessionPanelView(null);
    setCurrentSidePanel(null);
  }, [setCurrentSidePanel]);
  const openLeftSidebar = useCallback(() => {
    userOpenedSidebarWhileNarrowRef.current = true;
    autoCollapsedSidebarRef.current = false;
    setSidebarOpen(true);
  }, [setSidebarOpen]);
  useEffect(() => {
    if (sidebarOpen && userOpenedSidebarWhileNarrowRef.current) return;
    if (
      (
        sidebarOpen
          ? requestedMainWorkspaceWidth < AUTO_COLLAPSE_WORKSPACE_WIDTH
          : availableMainWorkspaceWidth < AUTO_COLLAPSE_WORKSPACE_WIDTH
      ) &&
      sidePanelOpen &&
      (
        (sidebarOpen && userOpenedSidebarWhileNarrowRef.current) ||
        (!sidebarOpen && !userOpenedSidePanelWhileNarrowRef.current)
      )
    ) {
      autoCollapsedSidePanelRef.current = effectiveSidePanelView;
      closeRightPane({ preserveAutoCollapse: true });
      return;
    }
    const restoredPanel = autoCollapsedSidePanelRef.current;
    if (
      restoredPanel &&
      !userOpenedSidebarWhileNarrowRef.current &&
      !sidePanelOpen &&
      expandedRightPanelWorkspaceWidth >= AUTO_RESTORE_WORKSPACE_WIDTH
    ) {
      autoCollapsedSidePanelRef.current = null;
      userOpenedSidePanelWhileNarrowRef.current = false;
      if (restoredPanel === "launcher") {
        setSessionPanelView("launcher");
      } else {
        setCurrentSidePanel(restoredPanel);
      }
    }
  }, [
    availableMainWorkspaceWidth,
    closeRightPane,
    effectiveSidePanelView,
    expandedRightPanelWorkspaceWidth,
    requestedMainWorkspaceWidth,
    setCurrentSidePanel,
    sidebarOpen,
    sidePanelOpen,
  ]);
  const openBrowserRailPane = useCallback(() => {
    // Opening the browser pane should land on a usable page, not an empty
    // panel that forces the user to click "+". If no browser tab exists yet,
    // create one (defaults to the new-tab URL in the main process).
    const opening = !panelRailActive;
    if (opening && isElectronRuntime()) {
      const hasBrowserTab = sessionPanelState.tabs.some((tab) => tab.type === "browser");
      if (!hasBrowserTab) {
        preserveSidePanelOnPanelOpenRef.current = true;
        void window.__IPOLLOWORK_ELECTRON__?.browser?.createTab?.();
      }
    }
    toggleCurrentSidePanel("panel");
  }, [panelRailActive, sessionPanelState.tabs, toggleCurrentSidePanel]);
  const addBrowserPanelTab = useCallback(() => {
    userOpenedSidebarWhileNarrowRef.current = false;
    if (isElectronRuntime()) {
      preserveSidePanelOnPanelOpenRef.current = true;
      void window.__IPOLLOWORK_ELECTRON__?.browser?.createTab?.();
    }
    setCurrentSidePanel("panel");
  }, [setCurrentSidePanel]);
  const toggleRightPanel = useCallback(() => {
    if (sidePanelOpen) {
      if (effectiveSidePanelView) {
        lastRightPanelViewRef.current = effectiveSidePanelView;
      }
      closeRightPane();
      return;
    }
    userOpenedSidebarWhileNarrowRef.current = false;
    userOpenedSidePanelWhileNarrowRef.current = true;
    autoCollapsedSidePanelRef.current = null;
    const restoredPanel = lastRightPanelViewRef.current;
    if (restoredPanel === "launcher") {
      setSessionPanelView("launcher");
      return;
    }
    setCurrentSidePanel(restoredPanel);
  }, [closeRightPane, effectiveSidePanelView, setCurrentSidePanel, sidePanelOpen]);
  const openDesignRailPane = useCallback(() => {
    userOpenedSidebarWhileNarrowRef.current = false;
    openDesignTab();
  }, [openDesignTab]);
  const showDesignRailPane = useCallback(() => {
    openDesignRailPane();
  }, [openDesignRailPane]);
  const openVideoRailPane = useCallback(() => {
    userOpenedSidebarWhileNarrowRef.current = false;
    if (videoRailActive) {
      closeRightPane();
      return;
    }
    openCurrentVideoStudio();
  }, [closeRightPane, openCurrentVideoStudio, videoRailActive]);
  const showVideoRailPane = useCallback(() => {
    userOpenedSidebarWhileNarrowRef.current = false;
    openCurrentVideoStudio();
  }, [openCurrentVideoStudio]);
  const seedDesignHtmlControlAction = useMemo<iPolloWorkControlAction | null>(() => {
    if (!import.meta.env.DEV) return null;

    return {
      id: "eval.design.seed_html",
      label: "Seed a local HTML design",
      description: "Materialize a deterministic local website template in the Design space.",
      sideEffect: "mutation",
      disabled: !props.ipolloworkServerClient || !props.runtimeWorkspaceId || !props.selectedSessionId || props.selectedWorkspaceDisplay.workspaceType === "remote",
      execute: async () => {
        if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId || !props.selectedSessionId) {
          return { ok: false, error: "Workspace client is not ready." };
        }

        await props.ipolloworkServerClient.installTemplate(props.runtimeWorkspaceId, "ipollowork.saas-landing");
        const materialized = await props.ipolloworkServerClient.materializeTemplate(
          props.runtimeWorkspaceId,
          "ipollowork.saas-landing",
          props.selectedSessionId,
        );
        const path = materialized.state.entry;
        const content = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>iPolloWork Design Demo</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #f5f3ff; color: #1f1636; }
      main { width: min(680px, calc(100% - 48px)); padding: 48px; border-radius: 28px; background: white; box-shadow: 0 24px 70px rgba(76, 29, 149, .14); }
      img { display: block; width: 100%; height: 180px; margin-bottom: 28px; border-radius: 20px; object-fit: cover; }
      h1 { margin: 0 0 16px; font-size: 44px; line-height: 1.05; }
      p { color: #655b76; font-size: 18px; line-height: 1.6; }
      a { display: inline-block; margin-top: 12px; padding: 12px 18px; border-radius: 999px; background: #7c3aed; color: white; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <img src="https://images.unsplash.com/photo-1558655146-d09347e92766?auto=format&amp;fit=crop&amp;w=1200&amp;q=80" alt="Colorful design materials on a desk" />
      <h1>Design directly in iPolloWork</h1>
      <p>Select this heading, link, or any presentation detail and make it yours.</p>
      <a href="https://ipollowork.so">Explore iPolloWork</a>
    </main>
  </body>
</html>`;
        const existing = await props.ipolloworkServerClient.readWorkspaceFile(props.runtimeWorkspaceId, path).catch(() => null);
        await props.ipolloworkServerClient.writeWorkspaceFile(props.runtimeWorkspaceId, {
          path,
          content,
          baseUpdatedAt: existing?.updatedAt ?? null,
        });
        setSessionType(props.selectedSessionId, sessionTypeForTemplate(materialized.manifest));
        setTemplateSessionData({ sessionId: props.selectedSessionId, ...materialized, hasBrief: false });
        setSessionTypeRevision((value) => value + 1);
        setTemplateSessionRevision((value) => value + 1);
        setCurrentSidePanel("design");
        return { ok: true, path };
      },
    };
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId, props.selectedSessionId, props.selectedWorkspaceDisplay.workspaceType, setCurrentSidePanel]);
  const seedDesignDeckControlAction = useMemo<iPolloWorkControlAction | null>(() => {
    if (!import.meta.env.DEV) return null;

    return {
      id: "eval.design.seed_deck",
      label: "Seed a local slide deck",
      description: "Materialize a deterministic local slide template in the Design space.",
      sideEffect: "mutation",
      disabled: !props.ipolloworkServerClient || !props.runtimeWorkspaceId || !props.selectedSessionId || props.selectedWorkspaceDisplay.workspaceType === "remote",
      execute: async () => {
        if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId || !props.selectedSessionId) {
          return { ok: false, error: "Workspace client is not ready." };
        }

        // The runtime always opens the current session's materialized template.
        // Keep the visual fixture on that same production path rather than
        // creating a workspace-global HTML file that users cannot select.
        await props.ipolloworkServerClient.installTemplate(props.runtimeWorkspaceId, "ipollowork.pitch-deck");
        const materialized = await props.ipolloworkServerClient.materializeTemplate(
          props.runtimeWorkspaceId,
          "ipollowork.pitch-deck",
          props.selectedSessionId,
        );
        const path = materialized.state.entry;
        const content = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>iPolloWork Slide Editing Demo</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #111827; color: #f8fafc; }
      main { width: min(760px, calc(100% - 48px)); }
      .slide { display: none; min-height: 390px; padding: 52px; border-radius: 28px; background: linear-gradient(135deg, #312e81, #0f172a); box-sizing: border-box; }
      .slide.is-active { display: block; }
      .eyebrow { color: #c4b5fd; font-size: 14px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
      h1 { max-width: 620px; margin: 72px 0 16px; font-size: 54px; line-height: 1.02; letter-spacing: -.04em; }
      p { max-width: 560px; color: #cbd5e1; font-size: 19px; line-height: 1.6; }
      .deck-controls { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding-top: 16px; }
      .counter { margin-right: auto; color: #94a3b8; font-size: 13px; }
      button { width: 38px; height: 34px; border: 0; border-radius: 10px; background: #f8fafc; color: #111827; font-size: 18px; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <section class="slide is-active" data-title="Cover"><p class="eyebrow">01 / 03</p><h1>Native slide controls stay usable.</h1><p>Open edit mode without losing the current page.</p></section>
      <section class="slide" data-title="Edit second slide"><p class="eyebrow">02 / 03</p><h1>Edit this second slide directly.</h1><p>Continue to the next page without closing the editor.</p></section>
      <section class="slide" data-title="Finish"><p class="eyebrow">03 / 03</p><h1>Keep refining every page.</h1><p>One deck, one visual editing flow.</p></section>
      <div class="deck-controls"><span class="counter">1 / 3</span><button type="button" data-action="prev" aria-label="Previous slide">←</button><button type="button" data-action="next" aria-label="Next slide">→</button></div>
    </main>
    <script>
      (() => {
        const slides = [...document.querySelectorAll('.slide')];
        const counter = document.querySelector('.counter');
        let index = 0;
        const show = (next) => {
          index = (next + slides.length) % slides.length;
          slides.forEach((slide, slideIndex) => {
            slide.classList.toggle('is-active', slideIndex === index);
            slide.setAttribute('aria-hidden', String(slideIndex !== index));
          });
          counter.textContent = \`\${index + 1} / \${slides.length}\`;
          history.replaceState(null, '', \`#\${index + 1}\`);
        };
        document.querySelector('[data-action="prev"]').addEventListener('click', () => show(index - 1));
        document.querySelector('[data-action="next"]').addEventListener('click', () => show(index + 1));
        show(0);
      })();
    </script>
  </body>
</html>`;
        const existing = await props.ipolloworkServerClient.readWorkspaceFile(props.runtimeWorkspaceId, path).catch(() => null);
        await props.ipolloworkServerClient.writeWorkspaceFile(props.runtimeWorkspaceId, {
          path,
          content,
          baseUpdatedAt: existing?.updatedAt ?? null,
        });
        setSessionType(props.selectedSessionId, sessionTypeForTemplate(materialized.manifest));
        setTemplateSessionData({ sessionId: props.selectedSessionId, ...materialized, hasBrief: false });
        setSessionTypeRevision((value) => value + 1);
        setTemplateSessionRevision((value) => value + 1);
        setCurrentSidePanel("design");
        return { ok: true, path };
      },
    };
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId, props.selectedSessionId, props.selectedWorkspaceDisplay.workspaceType, setCurrentSidePanel]);
  useControlAction(seedDesignHtmlControlAction);
  useControlAction(seedDesignDeckControlAction);
  const openBrowserUrlControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "browser.open_url",
    label: "Open URL in built-in browser",
    description: "Create or select an iPolloWork built-in browser tab, navigate it to a URL, and return the CDP handle for browser automation.",
    sideEffect: "navigation",
    requiresArgs: true,
    args: [
      { name: "url", type: "string", required: true, description: "The website URL to open." },
      { name: "provider", type: "string", description: "Browser provider. Use builtin or auto. External is reserved for future support." },
    ],
    previewArgs: { url: "https://example.com", provider: "builtin" },
    disabled: !isElectronRuntime(),
    execute: async (args) => {
      const url = controlStringArg(args, "url");
      if (!url) return { ok: false, error: "Missing URL." };
      const provider = controlStringArg(args, "provider") || "builtin";
      if (provider !== "auto" && provider !== "builtin") {
        return { ok: false, error: `Browser provider is not available yet: ${provider}` };
      }
      setCurrentSidePanel("panel");
      const result = await window.__IPOLLOWORK_ELECTRON__?.browser?.openUrl?.(url, provider);
      return result;
    },
  }), [setCurrentSidePanel]);
  useControlAction(openBrowserUrlControlAction);
  const setBrowserProxyControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "browser.set_proxy",
    label: "Set built-in browser proxy",
    description: "Route all built-in browser traffic through an HTTP/SOCKS proxy (e.g. to browse from another location). Applies to every built-in browser tab until cleared. Pass an empty proxy to restore system network settings.",
    sideEffect: "mutation",
    args: [
      { name: "proxy", type: "string", description: "Proxy URL like http://user:pass@host:8080 or socks5://host:1080, env:NAME to use the IPOLLOWORK_BROWSER_PROXY_NAME environment variable, or empty to clear." },
    ],
    previewArgs: { proxy: "env:DE" },
    disabled: !isElectronRuntime(),
    execute: async (args) => {
      const proxy = controlStringArg(args, "proxy") || "";
      const setProxy = window.__IPOLLOWORK_ELECTRON__?.browser?.setProxy;
      if (!setProxy) return { ok: false, error: "Built-in browser is not available." };
      return setProxy(proxy);
    },
  }), []);
  useControlAction(setBrowserProxyControlAction);
  const openArtifactRailPane = useCallback(() => {
    if (!hasArtifactTargets || !props.selectedSessionId) return;
    const activeTab = sessionPanelState.tabs.find((tab) => tab.id === sessionPanelState.activeTabId);
    const artifactTargetIds = new Set(artifactFileTargets.map((target) => target.id));
    const artifactTab = sessionPanelState.tabs.find((tab) => (
      tab.type === "artifact" && artifactTargetIds.has(tab.id)
    ));
    const firstArtifact = artifactFileTargets[0];
    if (panelRailActive && activeTab?.type === "artifact") {
      toggleCurrentSidePanel("panel");
      return;
    }
    if (!panelRailActive) {
      preserveSidePanelOnPanelOpenRef.current = true;
    }
    if (artifactTab) {
      selectTab(props.selectedSessionId, artifactTab.id);
    } else if (firstArtifact) {
      openTab(props.selectedSessionId, {
        id: firstArtifact.id,
        type: "artifact",
        label: firstArtifact.name,
        preview: firstArtifact.preview,
        target: firstArtifact,
      });
    }
    if (!panelRailActive) {
      toggleCurrentSidePanel("panel");
    }
  }, [artifactFileTargets, hasArtifactTargets, openTab, panelRailActive, props.selectedSessionId, selectTab, sessionPanelState, toggleCurrentSidePanel]);
  const showArtifactRailPane = useCallback(() => {
    userOpenedSidebarWhileNarrowRef.current = false;
    if (!hasArtifactTargets || !props.selectedSessionId) return;
    const artifactTargetIds = new Set(artifactFileTargets.map((target) => target.id));
    const artifactTab = sessionPanelState.tabs.find((tab) => (
      tab.type === "artifact" && artifactTargetIds.has(tab.id)
    ));
    const firstArtifact = artifactFileTargets[0];

    if (artifactTab) {
      selectTab(props.selectedSessionId, artifactTab.id);
    } else if (firstArtifact) {
      openTab(props.selectedSessionId, {
        id: firstArtifact.id,
        type: "artifact",
        label: firstArtifact.name,
        preview: firstArtifact.preview,
        target: firstArtifact,
      });
    }

    setCurrentSidePanel("panel");
  }, [artifactFileTargets, hasArtifactTargets, openTab, props.selectedSessionId, selectTab, sessionPanelState.tabs, setCurrentSidePanel]);
  const openExtensionsRailPane = useCallback(() => {
    setCurrentSidePanel(null);
    setMainWorkspaceView("extensions");
  }, [setCurrentSidePanel]);
  const openVoiceRailPane = useCallback(() => {
    toggleCurrentSidePanel("voice");
  }, [toggleCurrentSidePanel]);
  const sidePanelLauncherItems = useMemo<SidePanelLauncherItem[]>(() => [
    {
      id: "web",
      label: t("session.side_panel.web"),
      shortcut: "⌘T",
      iconSrc: publicAssetUrl("sidebar-entry-web.svg"),
      active: panelRailActive && activePanelTab?.type === "browser",
      onClick: addBrowserPanelTab,
      disabled: !isElectronRuntime(),
    },
    {
      id: "design",
      label: "Design",
      iconSrc: publicAssetUrl("sidebar-entry-code.svg"),
      active: panelRailActive && activePanelTab?.type === "design",
      onClick: showDesignRailPane,
      disabled: !props.selectedSessionId || props.selectedWorkspaceDisplay.workspaceType === "remote",
    },
    {
      id: "files",
      label: t("session.side_panel.files"),
      shortcut: "⌘P",
      iconSrc: publicAssetUrl("sidebar-entry-file.svg"),
      active: panelRailActive && activePanelTab?.type === "artifact",
      onClick: showArtifactRailPane,
      disabled: !hasArtifactTargets,
    },
    {
      id: "video",
      label: t("session.side_panel.video"),
      iconSrc: publicAssetUrl("sidebar-entry-video.svg"),
      active: videoRailActive,
      onClick: showVideoRailPane,
      disabled: !props.selectedSessionId || props.selectedWorkspaceDisplay.workspaceType === "remote",
    },
  ], [activePanelTab?.type, addBrowserPanelTab, hasArtifactTargets, locale, panelRailActive, props.selectedSessionId, props.selectedWorkspaceDisplay.workspaceType, showArtifactRailPane, showDesignRailPane, showVideoRailPane, videoRailActive]);
  const removeAccessibleTarget = useCallback((target: OpenTarget) => {
    const nextHiddenIds = new Set(hiddenAccessibleTargetIds);
    nextHiddenIds.add(target.id);
    writeHiddenAccessibleTargetIds(props.selectedWorkspaceId, props.selectedSessionId, nextHiddenIds);
    setHiddenTargetRevision((value) => value + 1);
    if (props.selectedSessionId) {
      closeTab(props.selectedSessionId, target.id);
    }
  }, [closeTab, hiddenAccessibleTargetIds, props.selectedSessionId, props.selectedWorkspaceId]);
  useEffect(() => {
    const open = (event: Event) => {
      const requested = (event as CustomEvent<OpenTarget>).detail;
      const target = accessibleTargets.find((item) => item.id === requested?.id || item.value === requested?.value) ?? (
        requested?.kind && requested?.value ? requested : null
      );
      if (target) openTarget(target);
    };
    const hide = (event: Event) => {
      const requested = (event as CustomEvent<OpenTarget>).detail;
      const target = accessibleTargets.find((item) => item.id === requested?.id || item.value === requested?.value);
      if (target) removeAccessibleTarget(target);
    };
    window.addEventListener("ipollowork-open-accessible-target", open);
    window.addEventListener("ipollowork-hide-accessible-target", hide);
    return () => {
      window.removeEventListener("ipollowork-open-accessible-target", open);
      window.removeEventListener("ipollowork-hide-accessible-target", hide);
    };
  }, [accessibleTargets, openTarget, removeAccessibleTarget]);
  useEffect(() => {
    const handler = () => setCurrentSidePanel(null);
    window.addEventListener("ipollowork-close-right-pane", handler);
    return () => window.removeEventListener("ipollowork-close-right-pane", handler);
  }, [setCurrentSidePanel]);
  useEffect(() => {
    const refresh = () => setExtensionStateVersion((value) => value + 1);
    window.addEventListener(IPOLLOWORK_EXTENSION_STATE_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(IPOLLOWORK_EXTENSION_STATE_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  useEffect(() => {
    if (activeSidePanel === "voice" && !voiceExtensionEnabled) {
      setCurrentSidePanel(null);
    }
  }, [activeSidePanel, setCurrentSidePanel, voiceExtensionEnabled]);

  const openVoicePanelControlAction = useMemo<iPolloWorkControlAction | null>(() => (
    voiceExtensionEnabled ? {
      id: "voice.panel.open",
      label: "Open Voice Mode",
      description: "Open the sticky Voice Mode right-side panel.",
      sideEffect: "none",
      execute: () => {
        setCurrentSidePanel("voice");
        return { open: true };
      },
    } : null
  ), [setCurrentSidePanel, voiceExtensionEnabled]);
  useControlAction(openVoicePanelControlAction);

  const closeVoicePanelControlAction = useMemo<iPolloWorkControlAction | null>(() => (
    voiceExtensionEnabled && activeSidePanel === "voice" ? {
      id: "voice.panel.close",
      label: "Close Voice Mode",
      description: "Close the Voice Mode right-side panel.",
      sideEffect: "none",
      execute: () => {
        setCurrentSidePanel(null);
        return { open: false };
      },
    } : null
  ), [activeSidePanel, setCurrentSidePanel, voiceExtensionEnabled]);
  useControlAction(closeVoicePanelControlAction);
  const [showDelayedSessionLoadingState, setShowDelayedSessionLoadingState] = useState(false);
  const [settledSessionId, setSettledSessionId] = useState<string | null>(null);
  const handleSessionLoadSettled = useCallback((sessionId: string) => {
    setSettledSessionId(sessionId);
  }, []);

  const canSavePromptTemplate = Boolean(props.selectedSessionId && conversationMessages.some((message) => message.role === "user"));
  const exportSessionMarkdown = useCallback(() => {
    if (!props.selectedSessionId || conversationMessages.length === 0) return;
    const title = selectedSessionTitle || t("session.default_title");
    downloadTextAsFile(
      sessionMarkdownFilename(title),
      buildSessionMarkdown(title, conversationMessages),
      "text/markdown;charset=utf-8",
    );
  }, [conversationMessages, props.selectedSessionId, selectedSessionTitle]);
  const saveCurrentTaskAsPromptTemplate = useCallback(() => {
    if (!props.selectedSessionId || !canSavePromptTemplate) return;
    const firstUserMessage = conversationMessages.find((message) => message.role === "user");
    const firstGoal = firstUserMessage ? sessionMessageToPromptText(firstUserMessage).replace(/^You\s*/i, "").trim() : "";
    const recentContext = conversationMessages.slice(-6).map(sessionMessageToPromptText).join("\n\n").trim();
    const title = selectedSessionTitle || t("session.default_title");
    const prompt = [
      firstGoal ? `Goal:\n${firstGoal}` : "",
      recentContext ? `Reference context from the previous successful task:\n${recentContext}` : "",
      "Please repeat this workflow for the new task. Ask for any missing inputs before making changes.",
    ].filter(Boolean).join("\n\n");
    try {
      savePromptTemplate({ title, prompt });
      toast.success(t("prompt_templates.toast_saved", { title }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("prompt_templates.error_save"));
    }
  }, [canSavePromptTemplate, conversationMessages, props.selectedSessionId, selectedSessionTitle]);
  const sessionActionTitle = useMemo(
    () => sessionTitleForId(props.sidebar.projectSessionLists, sessionActionId),
    [props.sidebar.projectSessionLists, sessionActionId],
  );
  const showWorkspaceSetupEmptyState = props.workspaces.length === 0 && !props.selectedSessionId;
  const showNewConversationChrome = !props.selectedSessionId && !showWorkspaceSetupEmptyState;
  const showStartupSkeleton =
    !props.selectedSessionId &&
    !props.clientConnected &&
    props.startupPhase !== "sessionIndexReady" &&
    props.startupPhase !== "firstSessionReady" &&
    props.startupPhase !== "ready";
  const showSessionLoadingState =
    Boolean(props.selectedSessionId) && props.sessionLoadingById(props.selectedSessionId) && !showWorkspaceSetupEmptyState;
  const sidebarInitialLoading = useMemo(() => getSidebarInitialLoading(props.sidebar), [props.sidebar]);
  // Derive the main-pane error from the same data the sidebar uses so the two
  // panes can never disagree. We check (in priority order):
  // 1. selectedWorkspaceError (errorsByWorkspaceId[selectedWorkspaceId])
  // 2. workspaceConnectionStateById[selectedWorkspaceId].message (covers test/recover paths)
  // 3. Project load errors from the same source the sidebar reads.
  const selectedWorkspaceConnectionMessage = (() => {
    const state = props.sidebar.workspaceConnectionStateById[props.selectedWorkspaceId];
    if (state?.status === "error") return state.message?.trim() ?? "";
    return "";
  })();
  const selectedWorkspaceProjectError = (() => {
    const project = props.sidebar.projectSessionLists.find(
      (item) => item.workspace.id === props.selectedWorkspaceId,
    );
    return project?.error?.trim() ?? "";
  })();
  const selectedWorkspaceErrorMessage =
    props.selectedWorkspaceError?.trim() ||
    selectedWorkspaceConnectionMessage ||
    selectedWorkspaceProjectError ||
    "";
  const showSelectedWorkspaceError = Boolean(selectedWorkspaceErrorMessage);
  const selectedWorkspaceErrorTitle =
    props.selectedWorkspaceDisplay.workspaceType === "remote"
      ? "Remote workspace unavailable"
      : "OpenCode unavailable";

  const reactSessionBaseUrl = props.opencodeBaseUrl?.trim() ?? "";
  const reactSessionToken =
    props.ipolloworkServerToken?.trim() ||
    props.ipolloworkServerClient?.token?.trim() ||
    "";
  const canRenderReactSurface = Boolean(
    props.selectedSessionId &&
      props.runtimeWorkspaceId &&
      props.ipolloworkServerClient &&
      reactSessionBaseUrl &&
      reactSessionToken &&
      props.surface,
  );
  // Template sessions can render their brief/starter before SessionSurface is
  // mounted. Treat that visible entry surface as settled; otherwise the
  // SessionSurface-only callback leaves the conversation overlay up forever.
  const templateEntrySurfaceReady = !templateSessionLoading && (
    Boolean(currentTemplateSessionData) || isDesignSession
  );
  const showBrandedSessionLoading = Boolean(
    canRenderReactSurface &&
      props.selectedSessionId &&
      settledSessionId !== props.selectedSessionId &&
      !templateEntrySurfaceReady,
  );
  const showHeaderMenu = Boolean(
    props.selectedSessionId || props.developerMode,
  );
  const selectedSessionIsDefaultTitle = selectedSessionTitle === t("session.default_title");
  const showMainHeaderTitle = Boolean(
    !rightWorkspaceExpanded &&
      (showWorkspaceSetupEmptyState || (props.selectedSessionId && !selectedSessionIsDefaultTitle)),
  );
  const showMainHeaderMenu = showHeaderMenu && showMainHeaderTitle;
  const mainHeaderHidden = mainWorkspaceView === "extensions" || (showNewConversationChrome && !sidebarVisuallyCollapsed);
  const visibleWorkspaceWidth = viewportWidth - (shellConfig.sidebar && sidebarOpen ? effectiveLeftSidebarWidth : 0);
  const floatingRightPanelToggleOffset = sidePanelOpen
    ? Math.min(effectiveBrowserPanelWidth, Math.max(0, visibleWorkspaceWidth - 40)) + 8
    : 8;

  useEffect(() => {
    if (!showSessionLoadingState) {
      setShowDelayedSessionLoadingState(false);
      return;
    }
    const id = window.setTimeout(() => {
      setShowDelayedSessionLoadingState(true);
    }, 1000);
    return () => window.clearTimeout(id);
  }, [showSessionLoadingState]);

  useEffect(() => {
    setRenameOpen(false);
    setDeleteOpen(false);
    setRenameBusy(false);
    setDeleteBusy(false);
    setSessionActionId(null);
    setMainWorkspaceView(null);
  }, [props.selectedSessionId]);

  const openRenameModal = (sessionId: string) => {
    if (!props.onRenameSession) return;
    setSessionActionId(sessionId);
    setRenameTitle(sessionTitleForId(props.sidebar.projectSessionLists, sessionId));
    setRenameOpen(true);
  };

  const submitRename = async () => {
    const sessionId = sessionActionId;
    const nextTitle = renameTitle.trim();
    if (!sessionId || !props.onRenameSession || !nextTitle || nextTitle === sessionActionTitle.trim()) return;
    setRenameBusy(true);
    try {
      await props.onRenameSession(sessionId, nextTitle);
      setRenameOpen(false);
    } finally {
      setRenameBusy(false);
    }
  };

  const confirmDelete = async () => {
    const sessionId = sessionActionId;
    if (!sessionId || !props.onDeleteSession) return;
    setDeleteBusy(true);
    try {
      await props.onDeleteSession(sessionId);
      setDeleteOpen(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  const openRenameProject = (workspaceId: string) => {
    const project = props.workspaces.find((workspace) => workspace.id === workspaceId);
    if (!project) return;
    setRenameProjectId(workspaceId);
    setRenameProjectName(project.displayName?.trim() || project.name?.trim() || "");
  };

  const pickProjectFolder = async () => {
    const selected = await pickDirectory({ title: t("projects.choose_folder") });
    if (typeof selected !== "string" || !selected.trim()) return;
    const folderPath = selected.trim();
    setCreateProjectFolder(folderPath);
    if (!createProjectName.trim()) {
      const folderName = folderPath.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? "";
      setCreateProjectName(folderName);
    }
  };

  const submitCreateProject = async () => {
    const name = createProjectName.trim();
    const folderPath = createProjectFolder.trim();
    if (!name || !folderPath) return;
    setCreateProjectBusy(true);
    setCreateProjectError(null);
    try {
      await props.sidebar.onCreateProject({ name, folderPath });
      setCreateProjectOpen(false);
    } catch (error) {
      setCreateProjectError(error instanceof Error ? error.message : t("app.unknown_error"));
    } finally {
      setCreateProjectBusy(false);
    }
  };

  const submitRenameProject = async () => {
    const workspaceId = renameProjectId;
    const name = renameProjectName.trim();
    if (!workspaceId || !name) return;
    setRenameProjectBusy(true);
    try {
      await props.sidebar.onRenameProject(workspaceId, name);
      setRenameProjectId(null);
    } finally {
      setRenameProjectBusy(false);
    }
  };

  const confirmDeleteProject = async () => {
    const workspaceId = deleteProjectId;
    if (!workspaceId) return;
    setDeleteProjectBusy(true);
    try {
      await props.sidebar.onDeleteProject(workspaceId);
      setDeleteProjectId(null);
    } finally {
      setDeleteProjectBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top,rgba(74,111,255,0.12),transparent_42%),var(--app-bg,#0b1020)] text-dls-text mac:bg-transparent">
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={handleSidebarOpenChange}
        className={cn(
          "relative min-h-0 flex-1 mac:bg-transparent **:data-[slot=sidebar-container]:duration-[220ms] **:data-[slot=sidebar-gap]:duration-[220ms] **:data-[slot=sidebar-container]:ease-[cubic-bezier(0.22,1,0.36,1)] **:data-[slot=sidebar-gap]:ease-[cubic-bezier(0.22,1,0.36,1)]",
          leftSidebarResizing &&
            "**:data-[slot=sidebar-container]:transition-none **:data-[slot=sidebar-gap]:transition-none",
          !shellConfig.sidebar && "**:data-[slot=sidebar-container]:hidden **:data-[slot=sidebar-gap]:hidden",
        )}
        style={sidebarProviderStyle}
      >
        <AppSidebar
          projectSessionLists={props.sidebar.projectSessionLists}
          selectedWorkspaceId={props.sidebar.selectedWorkspaceId}
          developerMode={props.sidebar.developerMode}
          selectedSessionId={props.sidebar.selectedSessionId}
          showInitialLoading={sidebarInitialLoading}
          showSessionActions={Boolean(props.onRenameSession || props.onDeleteSession || props.onArchiveSession)}
          sessionStatusById={props.sidebar.sessionStatusById}
          connectingWorkspaceId={props.sidebar.connectingWorkspaceId}
          workspaceConnectionStateById={props.sidebar.workspaceConnectionStateById}
          newTaskDisabled={props.sidebar.newTaskDisabled}
          onOpenSession={handleSidebarOpenSession}
          onSelectProject={props.sidebar.onSelectProject}
          onOpenCreateProject={isElectronRuntime() ? () => {
            setCreateProjectName("");
            setCreateProjectFolder("");
            setCreateProjectError(null);
            setCreateProjectOpen(true);
          } : undefined}
          onOpenRenameProject={openRenameProject}
          onRevealProject={(workspaceId) => void props.sidebar.onRevealProject(workspaceId)}
          onOpenDeleteProject={setDeleteProjectId}
          onPrefetchSession={props.sidebar.onPrefetchSession}
          onCreateTaskInWorkspace={props.sidebar.onCreateTaskInWorkspace}
          onOpenRenameSession={props.onRenameSession ? openRenameModal : undefined}
          onOpenDeleteSession={props.onDeleteSession ? (sessionId) => {
            setSessionActionId(sessionId);
            setDeleteOpen(true);
          } : undefined}
          onArchiveSession={props.onArchiveSession ? (sessionId, archived) => {
            void props.onArchiveSession?.(sessionId, archived);
          } : undefined}
          onRecoverWorkspace={props.sidebar.onRecoverWorkspace}
          onTestWorkspaceConnection={props.sidebar.onTestWorkspaceConnection}
          onEditWorkspaceConnection={props.sidebar.onEditWorkspaceConnection}
          account={{
            loading: denAuth.status === "checking",
            signedIn: denAuth.isSignedIn,
            name: denAuth.user?.name ?? null,
            email: denAuth.user?.email ?? null,
          }}
          activePrimaryItem={templateMarketOpen ? "template-market" : mainWorkspaceView === "extensions" ? "extensions" : null}
          onOpenAccount={openCloudAccount}
          onOpenSettings={props.onOpenSettings}
          onOpenHelp={props.onOpenHelp}
          onOpenTemplateMarket={() => setTemplateMarketOpen(true)}
          onOpenExtensions={openExtensionsRailPane}
          onSignIn={openCloudSignIn}
          onOpenSessionSearch={props.sidebar.onOpenSessionSearch ? handleSidebarOpenSessionSearch : undefined}
          onStartResize={startLeftSidebarResize}
        />
        <SidebarInset className="relative min-h-0 overflow-hidden bg-background mac:bg-background/80">
          <div className="flex min-h-0 flex-1">
          <div className="relative flex min-h-0 flex-1">
            {mainHeaderHidden ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="absolute top-2 z-50 rounded-lg bg-background/80 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted hover:text-foreground mac:titlebar-no-drag"
                      style={{ right: floatingRightPanelToggleOffset }}
                      aria-label={sidePanelOpen ? t("session.right_panel_close") : t("session.right_panel_open")}
                      title={sidePanelOpen ? t("session.right_panel_close") : t("session.right_panel_open")}
                      aria-pressed={sidePanelOpen}
                      disabled={!props.selectedSessionId && !sidePanelOpen}
                      onClick={toggleRightPanel}
                    >
                      <img
                        src={publicAssetUrl(sidePanelOpen ? "sidebar-right-open.svg" : "sidebar-right-closed.svg")}
                        alt=""
                        className="h-3 w-4 shrink-0 dark:invert"
                      />
                    </Button>
                  }
                />
                <TooltipContent>{sidePanelOpen ? t("session.right_panel_close") : t("session.right_panel_open")}</TooltipContent>
              </Tooltip>
            ) : null}
            <div
              className={cn(
                "min-w-0 flex-1 transition-[width,min-width,opacity]",
                rightWorkspaceExpanded && "invisible pointer-events-none",
              )}
              style={{
                minWidth: rightWorkspaceExpanded ? 0 : mainWorkspaceMinWidth,
                transition: sessionShellTransition,
              }}
            >
              <main className="flex h-full min-w-0 flex-col overflow-hidden border-r border-border/40 dark:border-white/[0.055]">
          <header className={cn(
            "relative z-10 h-10 shrink-0 items-center justify-between border-b border-border px-4 [border-bottom-width:0.5px] md:px-6 mac:titlebar-drag mac:backdrop-blur-2xl mac:backdrop-saturate-150 @container/titlebar",
            mainHeaderHidden ? "hidden" : "flex",
            sidebarVisuallyCollapsed && shellConfig.sidebar ? "!pl-16 mac:!pl-32" : "",
          )}>
            {shellConfig.sidebar && sidebarVisuallyCollapsed ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute left-6 top-1/2 z-20 size-8 -translate-y-1/2 rounded-lg border-none text-muted-foreground hover:bg-muted hover:text-foreground mac:left-20 mac:titlebar-no-drag"
                aria-label={t("sidebar.expand")}
                title={t("sidebar.expand")}
                onClick={openLeftSidebar}
                style={{ WebkitAppRegion: "no-drag", pointerEvents: "auto" } as CSSProperties}
              >
                <img src={publicAssetUrl("sidebar-left-expand.svg")} alt="" className="h-3 w-4 shrink-0 dark:invert" />
              </Button>
            ) : null}
            <div className="flex min-w-0 items-center gap-1">
              {showMainHeaderTitle ? (
                <h1 className="truncate text-[14px] font-medium text-dls-text">
                  {showWorkspaceSetupEmptyState
                    ? t("workspace.empty_state_body")
                    : selectedSessionTitle || t("session.default_title")}
                </h1>
              ) : null}
              {showMainHeaderMenu ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="rounded-lg text-[#8A8A8A] hover:bg-muted hover:text-[#8A8A8A] mac:titlebar-no-drag"
                        aria-label={t("session.palette_title_actions")}
                        title={t("session.palette_title_actions")}
                      >
                        <Ellipsis className="size-4" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="start" className="w-48">
                    {props.selectedSessionId ? (
                      <DropdownMenuItem disabled={!canSavePromptTemplate} onClick={saveCurrentTaskAsPromptTemplate}>
                        <FileText className="size-4" />
                        {t("prompt_templates.save_task")}
                      </DropdownMenuItem>
                    ) : null}
                    {props.selectedSessionId ? (
                      <DropdownMenuItem disabled={conversationMessages.length === 0} onClick={exportSessionMarkdown}>
                        <FileText className="size-4" />
                        {t("session.export_markdown")}
                      </DropdownMenuItem>
                    ) : null}
                    {props.selectedSessionId && (props.onRenameSession || props.onDeleteSession || props.developerMode) ? <DropdownMenuSeparator /> : null}
                    {props.selectedSessionId && props.onRenameSession ? (
                      <DropdownMenuItem onClick={() => openRenameModal(props.selectedSessionId!)}>
                        <Pencil className="size-4" />
                        {t("workspace_list.rename_session")}
                      </DropdownMenuItem>
                    ) : null}
                    {props.selectedSessionId && props.onDeleteSession ? (
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => {
                          setSessionActionId(props.selectedSessionId!);
                          setDeleteOpen(true);
                        }}
                      >
                        <Trash2 className="size-4" />
                        {t("workspace_list.delete_session")}
                      </DropdownMenuItem>
                    ) : null}
                    {props.developerMode ? (
                      <>
                        {props.selectedSessionId && (props.onRenameSession || props.onDeleteSession) ? <DropdownMenuSeparator /> : null}
                        <DropdownMenuItem
                          onClick={() => {
                            try {
                              window.localStorage.removeItem("ipollowork.acknowledgedProviders");
                              window.localStorage.removeItem("ipollowork.orgOnboardingSeen");
                            } catch {
                              // Browser storage may be unavailable in hardened runtimes.
                            }
                          }}
                        >
                          Reset notifications
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>

            <div className="flex items-center gap-1.5 text-gray-10 mac:titlebar-no-drag">
              <ConversationOutputTrigger
                active={activeSidePanel === "outputs"}
                disabled={!conversationMessages.length && !designTemplateEntryPath}
                onClick={() => toggleCurrentSidePanel("outputs")}
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={sidePanelOpen ? t("session.right_panel_close") : t("session.right_panel_open")}
                      title={sidePanelOpen ? t("session.right_panel_close") : t("session.right_panel_open")}
                      aria-pressed={sidePanelOpen}
                      disabled={!props.selectedSessionId && !sidePanelOpen}
                      onClick={toggleRightPanel}
                    >
                      <img
                        src={publicAssetUrl(sidePanelOpen ? "sidebar-right-open.svg" : "sidebar-right-closed.svg")}
                        alt=""
                        className="h-3 w-4 shrink-0 dark:invert"
                      />
                    </Button>
                  }
                />
                <TooltipContent>{sidePanelOpen ? t("session.right_panel_close") : t("session.right_panel_open")}</TooltipContent>
              </Tooltip>
            </div>
          </header>

          <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1 overflow-hidden">
            <ResizablePanel minSize="180px" className="min-h-0">
            <div className="relative h-full min-w-0 overflow-hidden bg-dls-surface mac:bg-dls-surface/85 mac:backdrop-blur-2xl mac:backdrop-saturate-150">
              {showBrandedSessionLoading ? (
                <div
                  className="absolute inset-0 z-40 flex items-center justify-center bg-dls-surface"
                  aria-live="polite"
                  aria-busy={true}
                  role="status"
                  data-testid="session-loading-animation"
                >
                  <IPolloLoadingArtwork />
                  <span className="sr-only">{t("session.loading_detail")}</span>
                </div>
              ) : null}

              {mainWorkspaceView === "extensions" && props.settingsSlot ? (
                <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
                  {props.settingsSlot}
                </div>
              ) : showStartupSkeleton ? (
                <div className="px-6 py-14" role="status" aria-live="polite">
                  <div className="mx-auto max-w-2xl space-y-6">
                    <div className="space-y-2">
                      <div className="h-4 w-32 animate-pulse rounded-full bg-dls-hover/80" />
                      <div className="h-3 w-64 animate-pulse rounded-full bg-dls-hover/60" />
                    </div>
                    <div className="space-y-3">
                      {STARTUP_SKELETON_ROWS.map((row) => (
                        <div key={row.id} className="rounded-2xl border border-dls-border bg-dls-hover/40 p-4">
                          <div
                            className="mb-3 h-3 animate-pulse rounded-full bg-dls-hover/80"
                            style={{ width: row.titleWidth }}
                          />
                          <div className="space-y-2">
                            <div className="h-2.5 animate-pulse rounded-full bg-dls-hover/70" />
                            <div
                              className="h-2.5 animate-pulse rounded-full bg-dls-hover/60"
                              style={{ width: row.bodyWidth }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {mainWorkspaceView === null && showDelayedSessionLoadingState ? (
                <div className="px-6 py-16">
                  <div
                    className="mx-auto flex max-w-[320px] flex-col items-center gap-3 text-center"
                    role="status"
                    aria-live="polite"
                  >
                    <OwDotTicker size="md" />
                    <div className="text-[12px] leading-5 text-dls-secondary">
                      {t("session.loading_detail")}
                    </div>
                  </div>
                </div>
              ) : null}

              {mainWorkspaceView === null && !showDelayedSessionLoadingState && canRenderReactSurface ? (
                <div className="flex h-full min-h-0 flex-col lg:flex-row">
                  <div className="min-h-0 min-w-0 flex-1">
                      {isDesignSession && templateSessionLoading ? (
                        <div className="flex h-full items-center justify-center gap-2 text-sm text-dls-secondary"><LoaderCircle className="size-4 animate-spin" />{t("templates.preparing")}</div>
                      ) : isDesignSession && !hasTemplateSession && props.ipolloworkServerClient && props.runtimeWorkspaceId ? (
                        <DesignStarter
                          client={props.ipolloworkServerClient}
                          workspaceId={props.runtimeWorkspaceId}
                          templates={templateCatalog}
                          loading={templateCatalogLoading}
                          busyId={templateBusyId}
                          error={templateCatalogError}
                          onRefresh={() => void refreshTemplateCatalog()}
                          onChoose={(templateId) => void chooseDesignTemplate(templateId)}
                          onInstall={(templateId) => void installDesignTemplate(templateId)}
                          onUninstall={(templateId) => void uninstallDesignTemplate(templateId)}
                          onImport={importDesignTemplate}
                        />
                      ) : currentTemplateSessionData && !hasTemplateBrief && !templateBriefDismissed ? (
                        <TemplateBriefCard template={currentTemplateSessionData.manifest} onSubmit={(brief, references) => void submitTemplateBrief(brief, references)} onClose={() => void closeTemplateBrief()} />
                      ) : <SessionSurface
                        key={`${props.runtimeWorkspaceId}:${props.selectedSessionId}`}
                        // Spread `surface` first so the explicit per-workspace
                        // routing props below CAN'T be silently overridden by
                        // anything that leaks into `surface`. SessionSurface's
                        // server target (client/workspaceId/sessionId/opencodeBaseUrl/ipolloworkToken)
                        // must come from the resolved workspace endpoint passed by
                        // SessionRoute, not from anything in `surface`.
                        {...props.surface!}
                        client={props.ipolloworkServerClient!}
                        environmentClient={props.environmentClient}
                        workspaceId={props.runtimeWorkspaceId!}
                        sessionId={props.selectedSessionId!}
                        sessionTitle={selectedSessionTitle || t("session.default_title")}
                        opencodeBaseUrl={reactSessionBaseUrl}
                        ipolloworkToken={reactSessionToken}
                        todos={props.todos}
                        activePermission={props.activePermission}
                        permissionReplyBusy={props.permissionReplyBusy}
                        respondPermission={props.respondPermission}
                        activeQuestion={props.activeQuestion}
                        questionReplyBusy={props.questionReplyBusy}
                        respondQuestion={props.respondQuestion}
                        safeStringify={props.safeStringify}
                        onOpenTarget={openTarget}
                        onConversationMessagesChange={handleConversationMessagesChange}
                        onLoadSettled={handleSessionLoadSettled}
                        templateEntryPath={templateEntryPathForArtifacts}
                        artifactFiles={artifactFiles}
                        artifactContext={artifactContext}
                        onOpenVideoStudio={openCurrentVideoStudio}
                        onCreateSession={(type, templateId) => props.sidebar.onCreateTaskInWorkspace(
                          props.selectedWorkspaceId,
                          type,
                          templateId,
                          PERSONAL_WORK_CONTEXT_ID,
                        )}
                        onMaterializeTemplate={async (templateId, surface) => {
                          if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId || !props.selectedSessionId) return;
                          const result = await props.ipolloworkServerClient.materializeTemplate(
                            props.runtimeWorkspaceId,
                            templateId,
                            props.selectedSessionId,
                            undefined,
                            PERSONAL_WORK_CONTEXT_ID,
                          );
                          setSessionType(props.selectedSessionId, sessionTypeForTemplate(result.manifest));
                          setTemplateSessionData({ sessionId: props.selectedSessionId, ...result, hasBrief: false });
                          setDismissedTemplateBriefSessionIds((current) => {
                            const next = new Set(current);
                            next.delete(props.selectedSessionId!);
                            return next;
                          });
                          setSessionTypeRevision((value) => value + 1);
                          setTemplateSessionRevision((value) => value + 1);
                          if (surface === "design") {
                            openTab(props.selectedSessionId, {
                              id: `design:${props.selectedSessionId}:${encodeURIComponent(result.state.entry)}`,
                              type: "design",
                              label: result.state.entry.split("/").filter(Boolean).pop() || "Design",
                              sessionId: props.selectedSessionId,
                              path: result.state.entry,
                            });
                            setSidePanelState(props.selectedSessionId, "design");
                            return;
                          }
                          openCurrentVideoStudio();
                        }}
                        onActivateVideoStudio={activateVideoStudio}
                        designTemplates={starterTemplateCatalog}
                        designTemplatesLoading={starterTemplateCatalogLoading}
                        designTemplateBusyId={templateBusyId}
                        onInstallDesignTemplate={(templateId) => void installStarterTemplate(templateId)}
                        onRequestDesignTemplates={() => void refreshStarterTemplateCatalog()}
                      />}
                  </div>
                </div>
              ) : null}

              {mainWorkspaceView === null && !showDelayedSessionLoadingState && !canRenderReactSurface && !showStartupSkeleton ? (
                <div className={`mx-auto max-w-[800px] px-6 ${showWorkspaceSetupEmptyState ? "pt-20" : "pt-10"}`}>
                  {props.notFoundMessage ? (
                    <div className="px-6 py-16 text-center">
                      <div className="mx-auto max-w-md rounded-2xl border border-dls-border bg-dls-card px-5 py-6 shadow-[var(--dls-card-shadow)]">
                        <h3 className="text-base font-medium text-dls-text">Workspace or session not found</h3>
                        <p className="mt-2 text-sm leading-6 text-dls-secondary">{props.notFoundMessage}</p>
                      </div>
                    </div>
                  ) : showWorkspaceSetupEmptyState ? (
                    <div className="space-y-6 px-6 text-center">
                      <div className="mx-auto flex size-16 items-center justify-center rounded-3xl border border-dls-border bg-dls-hover">
                        <Zap className="text-dls-secondary" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-xl font-medium">{t("workspace.empty_state_body")}</h3>
                      </div>
                    </div>
                  ) : showSelectedWorkspaceError ? (
                    <div className="px-6 py-16">
                      <div className="mx-auto max-w-lg rounded-2xl border border-red-7/35 bg-red-1/40 p-5 text-left shadow-[var(--dls-card-shadow)]">
                        <div className="text-sm font-medium text-red-11">{selectedWorkspaceErrorTitle}</div>
                        <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-sm leading-6 text-red-11/90">
                          {selectedWorkspaceErrorMessage}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId)}
                          >
                            Retry
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void Promise.resolve(props.sidebar.onTestWorkspaceConnection(props.selectedWorkspaceId))}
                          >
                            {t("workspace_list.test_connection")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => props.sidebar.onEditWorkspaceConnection(props.selectedWorkspaceId)}
                          >
                            {t("workspace_list.edit_connection")}
                          </Button>
                          {props.sidebar.workspaceConnectionStateById[props.selectedWorkspaceId]?.status === "error" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void Promise.resolve(props.sidebar.onRecoverWorkspace(props.selectedWorkspaceId))}
                            >
                              {t("workspace_list.recover")}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : props.selectedSessionId ? (
                    <div className="px-6 py-16 text-center text-sm text-dls-secondary">
                      {t("session.loading_detail")}
                    </div>
                  ) : (
                    <div className="px-6 py-24" role="status" aria-live="polite">
                      <div className="mx-auto flex max-w-xs flex-col items-center gap-3 text-center">
                        <OwDotTicker size="md" />
                        <div className="text-sm font-medium text-dls-text">
                          {t("session.preparing_workspace")}
                        </div>
                        <p className="text-xs leading-5 text-dls-secondary">
                          {t("session.loading_detail")}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            </ResizablePanel>
            {props.terminalOpen ? (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize="280px" minSize="160px" maxSize="55%" className="min-h-0">
                  <TerminalDock
                    workspaceRoot={props.selectedWorkspaceRoot}
                    isRemoteWorkspace={props.selectedWorkspaceDisplay.workspaceType === "remote"}
                    onClose={() => props.onTerminalOpenChange?.(false)}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>

              </main>
            </div>
                <div
                  role="separator"
                  aria-label="Resize right panel"
                  aria-orientation="vertical"
                  onPointerDown={startRightPanelResize}
                  className={cn(
                    "relative z-20 hidden w-2 shrink-0 cursor-ew-resize touch-none lg:block",
                    (!sidePanelOpen || rightWorkspaceExpanded) && "pointer-events-none w-0",
                  )}
                />
                <aside
                  ref={rightPanelElementRef}
                  className="min-h-0 shrink-0 overflow-hidden lg:flex lg:flex-col"
                  style={{
                    width: sidePanelOpen ? effectiveBrowserPanelWidth : 0,
                    ...rightPanelTransitionStyle,
                  }}
                >
                  {sidePanelOpen && effectiveSidePanelView === "launcher" ? (
                    <div className="flex h-full flex-col bg-background px-6 pt-16 text-[#6B7280] min-[960px]:px-10 min-[960px]:pt-[44vh]">
                      <div className="w-full max-w-[240px] space-y-5">
                        {sidePanelLauncherItems.map((item) => {
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className={cn(
                                "flex h-9 w-full items-center gap-3 rounded-xl px-2 text-left text-[14px] font-normal tracking-[-0.56px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40",
                                item.active && "bg-muted text-foreground",
                              )}
                              onClick={item.onClick}
                              disabled={item.disabled}
                            >
                              <img src={item.iconSrc} alt="" className="size-4 shrink-0" />
                              <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : sidePanelOpen && activeSidePanel === "voice" ? (
                    <VoicePanel
                      client={props.ipolloworkServerClient}
                      workspaceId={props.runtimeWorkspaceId}
                      sessionId={props.selectedSessionId}
                      onClose={closeRightPane}
                    />
                  ) : sidePanelOpen && activeSidePanel === "outputs" ? (
                    <ConversationOutputPanel
                      messages={conversationMessages}
                      sessionId={props.selectedSessionId ?? undefined}
                      openTargets={accessibleTargets}
                      templateEntryPath={templateEntryPathForArtifacts}
                      supplementalFiles={artifactFiles}
                      artifactContext={artifactContext}
                      onOpenTarget={openTarget}
                      onOpenVideoStudio={openCurrentVideoStudio}
                    />
                  ) : sidePanelOpen && activeSidePanel === "panel" && props.selectedSessionId ? (
                    <div
                      className={cn(
                        "h-full min-h-0",
                        rightPanelExpanded && "fixed inset-y-0 right-0 z-[60] bg-background",
                      )}
                      style={rightPanelExpanded ? {
                        left: shellConfig.sidebar && sidebarOpen ? `${effectiveLeftSidebarWidth}px` : "0",
                      } : undefined}
                    >
                      <SidePanel
                        sessionId={props.selectedSessionId}
                        client={props.ipolloworkServerClient}
                        workspaceId={props.runtimeWorkspaceId}
                        workspaceRoot={props.selectedWorkspaceRoot}
                        isRemoteWorkspace={props.surface?.isRemoteWorkspace ?? false}
                        launcherItems={sidePanelLauncherItems}
                        aiEditing={isStreamingSessionStatus(props.sidebar.sessionStatusById[props.selectedSessionId])}
                        onAskAi={handleDesignAskAi}
                        onSaveAsTemplate={hasTemplateSession && props.selectedWorkspaceDisplay.workspaceType === "local" ? openTemplateSave : undefined}
                        expanded={rightPanelExpanded}
                        titlebarInset={rightPanelExpanded && (!shellConfig.sidebar || !sidebarOpen)}
                        onExpandedChange={setRightPanelExpandedState}
                        onClose={closeRightPane}
                      />
                    </div>
                  ) : null}
                </aside>
          </div>
          </div>
        </SidebarInset>
      </SidebarProvider>

      <TemplateSaveDialog
        open={templateSaveOpen}
        template={currentTemplateSessionData?.manifest ?? null}
        report={templateValidationReport}
        validating={templateValidationBusy}
        savingMode={templateSaveMode}
        onOpenChange={setTemplateSaveOpen}
        onValidate={() => void validateCurrentTemplate()}
        onRepair={repairCurrentTemplate}
        onSave={(input) => void saveCurrentTemplate(input)}
      />

      {props.ipolloworkServerClient && props.runtimeWorkspaceId ? <TemplateMarketDialog
        open={templateMarketOpen}
        onOpenChange={setTemplateMarketOpen}
        templates={templateCatalog}
        loading={templateCatalogLoading}
        error={templateCatalogError}
        busyId={templateBusyId}
        getCover={getTemplateCover}
        enterprise={activeEnterprise}
        resourceScope={templateResourceScope}
        enterpriseResources={enterpriseTemplateResources}
        onResourceScopeChange={changeTemplateResourceScope}
        onInstallEnterprise={(resource) => void installEnterpriseTemplate(resource)}
        onRefresh={refreshTemplateCatalog}
        onInstall={(templateId) => void installDesignTemplate(templateId)}
        onUninstall={(templateId) => void uninstallDesignTemplate(templateId)}
        onExport={(template) => void exportPersonalTemplate(template)}
        onImport={importDesignTemplate}
        canCreate={props.selectedWorkspaceDisplay.workspaceType === "local"}
        onCreate={(input) => props.sidebar.onCreateTemplateAuthoring(props.selectedWorkspaceId, input)}
        onUse={(template) => {
          if (template.manifest.surface === "video" && props.selectedWorkspaceDisplay.workspaceType === "remote") {
            toast.error(t("templates.video_local_only"));
            return;
          }
          setTemplateMarketOpen(false);
          props.sidebar.onCreateTaskInWorkspace(
            props.selectedWorkspaceId,
            sessionTypeForTemplate(template.manifest),
            template.manifest.id,
            templateResourceScope,
          );
        }}
      /> : null}

      {props.providerAuthModal ? <ProviderAuthModal {...props.providerAuthModal} /> : null}

      {props.onRenameSession ? (
        <RenameSessionModal
          open={renameOpen}
          title={renameTitle}
          busy={renameBusy}
          canSave={renameTitle.trim().length > 0 && renameTitle.trim() !== sessionActionTitle.trim()}
          onClose={() => {
            if (!renameBusy) setRenameOpen(false);
          }}
          onSave={() => void submitRename()}
          onTitleChange={setRenameTitle}
        />
      ) : null}

      {props.onDeleteSession ? (
        <ConfirmModal
          open={deleteOpen}
          title={t("session.delete_session_title")}
          message={
            sessionActionTitle.trim()
              ? t("session.delete_named_session_message", { title: sessionActionTitle.trim() })
              : t("session.delete_session_generic")
          }
          confirmLabel={deleteBusy ? t("session.deleting") : t("session.delete")}
          cancelLabel={t("common.cancel")}
          variant="danger"
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            if (!deleteBusy) setDeleteOpen(false);
          }}
        />
      ) : null}

      <Dialog open={createProjectOpen} onOpenChange={(open) => { if (!open && !createProjectBusy) setCreateProjectOpen(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("projects.create")}</DialogTitle>
            <DialogDescription>{t("projects.create_description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={createProjectName}
              onChange={(event) => setCreateProjectName(event.currentTarget.value)}
              placeholder={t("projects.name_placeholder")}
              disabled={createProjectBusy}
            />
            <button
              type="button"
              className="flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden disabled:opacity-50"
              onClick={() => void pickProjectFolder()}
              disabled={createProjectBusy}
            >
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
              <span className={cn("min-w-0 flex-1 truncate", !createProjectFolder && "text-muted-foreground")}>
                {createProjectFolder || t("projects.choose_folder")}
              </span>
            </button>
            {createProjectError ? <p role="alert" className="text-xs text-destructive">{createProjectError}</p> : null}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" disabled={createProjectBusy} />}>{t("common.cancel")}</DialogClose>
            <Button type="button" disabled={createProjectBusy || !createProjectName.trim() || !createProjectFolder.trim()} onClick={() => void submitCreateProject()}>
              {createProjectBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t("projects.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameProjectId !== null} onOpenChange={(open) => { if (!open && !renameProjectBusy) setRenameProjectId(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("projects.rename")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameProjectName}
            onChange={(event) => setRenameProjectName(event.currentTarget.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void submitRenameProject(); }}
            placeholder={t("projects.name_placeholder")}
            disabled={renameProjectBusy}
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" disabled={renameProjectBusy} />}>{t("common.cancel")}</DialogClose>
            <Button type="button" disabled={renameProjectBusy || !renameProjectName.trim()} onClick={() => void submitRenameProject()}>
              {renameProjectBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={deleteProjectId !== null}
        title={t("projects.remove_title")}
        message={t("projects.remove_description")}
        confirmLabel={deleteProjectBusy ? t("projects.removing") : t("projects.remove")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void confirmDeleteProject()}
        onCancel={() => { if (!deleteProjectBusy) setDeleteProjectId(null); }}
      />

      <CloudSignInComingSoonDialog
        open={cloudSignInComingSoonOpen}
        onOpenChange={setCloudSignInComingSoonOpen}
      />

      {/* Cloud provider notifications are now handled globally by CloudProvidersToast in app-root.tsx */}
    </div>
  );
}
