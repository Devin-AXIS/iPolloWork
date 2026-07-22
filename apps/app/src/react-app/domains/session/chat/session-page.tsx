/** @jsxImportSource react */
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { usePanelRef } from "react-resizable-panels";
import { useNavigate } from "react-router-dom";
import { Code2, Ellipsis, Eye, FileText, Film, Globe, Image, LoaderCircle, Mic2, Palette, PanelRightClose, PanelRightOpen, Pencil, Presentation, Search, Settings2, Trash2, Upload, X, Zap } from "lucide-react";
import { isPptxCompatibleTemplate, type TemplateCatalogItem, type TemplateManifestV1, type TemplateSessionSnapshot, type TemplateSessionState, type TemplateStyle } from "@ipollowork/types/templates";

import { currentLocale, t } from "../../../../i18n";
import { publicAssetUrl } from "../../../../app/lib/public-asset";
import { IPOLLOWORK_EXTENSION_CATALOG } from "../../../../app/constants";
import { buildDenAuthUrl, readDenBootstrapConfig } from "../../../../app/lib/den";
import { type iPolloWorkServerClient, type iPolloWorkServerStatus } from "../../../../app/lib/ipollowork-server";
import { getDisplaySessionTitle } from "../../../../app/lib/session-title";
import type { BootPhase } from "../../../../app/lib/startup-boot";
import { openDesktopPath, revealDesktopItemInDir, type WorkspaceInfo } from "../../../../app/lib/desktop";
import type {
  ComposerDraft,
  PendingPermission,
  PendingQuestion,
  ProviderListItem,
  TodoItem,
  WorkspaceConnectionState,
  WorkspaceSessionGroup,
} from "../../../../app/types";
import type { ShareWorkspaceModalProps } from "../../workspace/types";
import { ConversationOutputPanel, ConversationOutputTrigger } from "@/components/chat/artifact";
import { getArtifactsFromMessages, isVideoHtmlArtifact } from "@/lib/artifacts";
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
import { usePlatform } from "../../../kernel/platform";
import { useDenAuth } from "../../cloud/den-auth-provider";
import ProviderAuthModal, { type ProviderAuthModalProps } from "../../connections/provider-auth/provider-auth-modal";
import { RenameSessionModal } from "../modals/rename-session-modal";
import { AppSidebar } from "../sidebar/app-sidebar";
import type { iPolloWorkSessionType, iPolloWorkTemplateId } from "../sidebar/app-sidebar-provider";
import { readSessionType, sessionTypeForTemplate, setSessionType } from "../sidebar/session-type";
import { useSessionManagementStore } from "../sidebar/session-management-store";
import { SessionSurface, type SessionSurfaceProps } from "../surface/session-surface";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ShareWorkspaceModal } from "../../workspace/share-workspace-modal";
import { OwDotTicker } from "../../../shell/dot-ticker";
import { useReactRenderWatchdog } from "../../../shell/react-render-watchdog";
import { useShellConfig } from "../../../shell/shell-config";
import { type SidePanelItem, useUiStateStore } from "../../../shell/ui-state-store";
import { workspaceSettingsRoute } from "../../../shell/workspace-routes";

import { isElectronRuntime } from "../../../../app/utils";
import { isCollectibleArtifactTarget, isLocalhostBrowserTarget, isOpenableFileTarget, type OpenTarget } from "../artifacts/open-target";
import type { OpenTargetOptions } from "@/lib/target-provider";
import { VoicePanel } from "../voice/voice-panel";
import { DesignPanel } from "../design/design-panel";
import { waitForTemplateEntrySurface } from "../templates/template-entry-route";
import { VideoPanel } from "../video/video-panel";
import { customTemplateColorPalette, DEFAULT_TEMPLATE_COLOR_PALETTE, paletteColors, TEMPLATE_COLOR_PRESETS, templateBriefConfigFor, templateBriefPrompt, templateColorPaletteLabel, type TemplateBrief, type TemplateColorPalette } from "../templates/template-brief";
import { TemplateMarketDialog } from "../templates/template-market-dialog";
import { SidePanel, type SidePanelLauncherItem } from "../panel/side-panel";
import { TerminalDock } from "../terminal/terminal-dock";
import { useActivePanelTab, usePanelTabStore, useSessionPanelState } from "../panel/panel-tab-store";
import { useWorkspaceShellLayout } from "../../../shell/workspace-shell-layout";
import { useControlAction, type iPolloWorkControlAction } from "../../../shell/control/control-provider";
import { getExtensionId, isiPolloWorkExtensionEnabled, IPOLLOWORK_EXTENSION_STATE_CHANGED } from "../../settings/extension-state";
import { cn } from "@/lib/utils";

const STARTUP_SKELETON_ROWS = [
  { id: "intro", titleWidth: "42%", bodyWidth: "88%" },
  { id: "middle", titleWidth: "56%", bodyWidth: "88%" },
  { id: "final", titleWidth: "36%", bodyWidth: "74%" },
];
const GLOBAL_VOICE_SIDE_PANEL_KEY = "__ipollowork_voice__";
const EMPTY_TRANSCRIPT_TARGETS: OpenTarget[] = [];
const MAIN_WORKSPACE_MIN_WIDTH = 520;
const MAIN_WORKSPACE_FALLBACK_MIN_WIDTH = 480;
type SessionPanelView = SidePanelItem | "launcher";

export type SessionPageHistoryControls = {
  canUndo: boolean;
  canRedo: boolean;
  busyAction: "undo" | "redo" | null;
  onUndo: () => void | Promise<void>;
  onRedo: () => void | Promise<void>;
};

export type SessionPageSidebarProps = {
  workspaceSessionGroups: WorkspaceSessionGroup[];
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  developerMode: boolean;
  sessionStatusById: Record<string, string>;
  connectingWorkspaceId: string | null;
  workspaceConnectionStateById: Record<string, WorkspaceConnectionState>;
  newTaskDisabled: boolean;
  sidebarHydratedFromCache: boolean;
  startupPhase: BootPhase;
  onSelectWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onCreateTaskInWorkspace: (workspaceId: string, type?: iPolloWorkSessionType, templateId?: iPolloWorkTemplateId) => void;
  onCreateTaskWithPrompt?: (workspaceId: string, prompt: string) => void;
  onOpenRenameWorkspace: (workspaceId: string) => void;
  onShareWorkspace: (workspaceId: string) => void;
  onRevealWorkspace: (workspaceId: string) => void;
  onRecoverWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onTestWorkspaceConnection: (workspaceId: string) => Promise<boolean> | boolean | void;
  onEditWorkspaceConnection: (workspaceId: string) => void;
  onForgetWorkspace: (workspaceId: string) => void;
  onOpenCreateWorkspace: () => void;
  /** Opens the cross-session message search dialog (Cmd/Ctrl+Shift+F). */
  onOpenSessionSearch?: () => void;
  onReorderWorkspaces?: (workspaceIds: string[]) => void;
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
  sidebar: SessionPageSidebarProps;
  surface?: SessionPageSurfaceProps | null;
  history?: SessionPageHistoryControls | null;
  todos: TodoItem[];
  sessionLoadingById: (sessionId: string | null) => boolean;
  shareWorkspaceModal?: ShareWorkspaceModalProps | null;
  providerAuthModal?: ProviderAuthModalProps | null;
  activePermission?: PendingPermission | null;
  permissionReplyBusy?: boolean;
  respondPermission?: (requestID: string, reply: "once" | "always" | "reject") => void;
  safeStringify?: (value: unknown) => string;
  activeQuestion?: PendingQuestion | null;
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
  if (props.workspaceSessionGroups.some((group) => group.sessions.length > 0)) {
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
  return props.workspaceSessionGroups.some(
    (group) => group.status === "loading" || group.status === "idle",
  );
}

function sessionTitleForId(groups: WorkspaceSessionGroup[], id: string | null | undefined) {
  if (!id) return "";
  const sessionsById = new Map(groups.flatMap((group) => group.sessions.map((session) => [session.id, session] as const)));
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

function TemplateCover({ client, workspaceId, template, className, alt = "" }: { client: iPolloWorkServerClient; workspaceId: string; template: TemplateCatalogItem; className?: string; alt?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setSrc("");
    void client.getTemplateCover(workspaceId, template.manifest.id).then(({ data, contentType }) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(new Blob([data], { type: contentType ?? "image/svg+xml" }));
      setSrc(objectUrl);
    }).catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [client, template.installedVersion, template.manifest.id, template.manifest.version, workspaceId]);
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
  onImport: (file: File, category: TemplateManifestV1["category"]) => void;
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
            <div className="mb-3 flex items-center justify-between"><button type="button" className="text-xs text-dls-secondary hover:text-dls-text" onClick={() => setCategory(null)}>← {t("templates.starter.back_to_categories")}</button><button type="button" onClick={() => importRef.current?.click()} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-dls-border px-2 text-[11px] font-medium text-dls-secondary transition hover:bg-dls-hover hover:text-dls-text"><Upload className="size-3" />{t("template_market.import_ipwt")}</button><input ref={importRef} type="file" accept=".ipwt,application/zip" className="hidden" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) setPendingImport(file); event.currentTarget.value = ""; }} /></div>
            {pendingImport ? <div className="mb-3 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3"><div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Upload className="size-3.5" /></div><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{pendingImport.name}</div><div className="text-[10px] text-dls-secondary">{(pendingImport.size / 1024).toFixed(1)} KB · {t("templates.starter.file_type", { type: selectedCategory ? t(selectedCategory.labelKey) : "" })}</div></div><button type="button" onClick={() => setPendingImport(null)} className="text-[11px] text-dls-secondary hover:text-dls-text">{t("common.cancel")}</button><button type="button" onClick={() => { onImport(pendingImport, serverCategory); setPendingImport(null); }} className="h-7 rounded-lg bg-primary px-2.5 text-[11px] font-medium text-primary-foreground">{t("template_market.install")}</button></div> : null}
            {visible.length ? <div className="grid gap-3 sm:grid-cols-2">{visible.map((item) => <article key={item.manifest.id} className="group relative overflow-hidden rounded-2xl border border-dls-border bg-dls-surface transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"><button type="button" className="block w-full text-left" onClick={() => setPreviewTemplate(item)} aria-label={t("template_market.preview_aria", { title: item.manifest.title })}><TemplateCover client={client} workspaceId={workspaceId} template={item} alt={t("template_market.cover_alt", { title: item.manifest.title })} /></button><div className="p-4"><div className="flex items-start justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{item.manifest.title}{isPptxCompatibleTemplate(item.manifest) ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">PPTX-compatible</span> : null}{item.sourceType === "local" ? <span className="rounded bg-dls-hover px-1.5 py-0.5 text-[9px] font-medium text-dls-secondary">{t("new_conversation.templates.local")}</span> : null}{item.updateAvailable ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">{t("template_market.update")}</span> : null}</div><div className="mt-1 line-clamp-2 text-xs leading-5 text-dls-secondary">{item.manifest.description}</div><div className="mt-1 text-[10px] text-dls-secondary/75">{item.manifest.source.name}</div></div><details className="relative"><summary className="grid size-7 cursor-pointer list-none place-items-center rounded-lg text-dls-secondary hover:bg-dls-hover"><Ellipsis className="size-4" /></summary><div className="absolute right-0 top-8 z-20 w-36 rounded-xl border border-dls-border bg-dls-surface p-1 text-xs shadow-xl"><div className="px-2 py-1.5 text-[10px] text-dls-secondary">{item.manifest.source.license}</div>{item.installed ? <button type="button" onClick={() => onUninstall(item.manifest.id)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-dls-hover">{t("template_market.uninstall_template")}</button> : null}{item.updateAvailable ? <button type="button" onClick={() => onInstall(item.manifest.id)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-dls-hover">{t("template_market.update_template")}</button> : null}</div></details></div><div className="mt-4 flex items-center gap-2"><button type="button" onClick={() => setPreviewTemplate(item)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dls-border px-3 text-xs font-medium text-dls-text transition hover:bg-dls-hover"><Eye className="size-3.5" />{t("template_market.preview")}</button><button type="button" disabled={busyId === item.manifest.id} onClick={() => item.updateAvailable || !item.installed ? onInstall(item.manifest.id) : onChoose(item.manifest.id)} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">{busyId === item.manifest.id ? <LoaderCircle className="mr-1.5 size-3 animate-spin" /> : null}{item.updateAvailable ? t("template_market.update") : item.installed ? t("template_market.use_template") : t("template_market.install")}</button></div></div></article>)}</div> : <div className="rounded-2xl border border-dls-border bg-dls-surface p-6 text-center"><p className="text-sm font-medium">{t("templates.starter.empty_title")}</p><p className="mt-1 text-xs text-dls-secondary">{t("templates.starter.empty_description")}</p></div>}
          </div>;
        })()}
      </div>
    </div>
    <Dialog open={Boolean(previewTemplate)} onOpenChange={(open) => { if (!open) setPreviewTemplate(null); }}><DialogContent className="max-w-[960px] gap-0 overflow-hidden p-0 sm:max-w-[960px]">{previewTemplate ? <><div className="aspect-video overflow-hidden bg-dls-hover"><TemplateCover client={client} workspaceId={workspaceId} template={previewTemplate} className="h-full" alt={t("template_market.preview_alt", { title: previewTemplate.manifest.title })} /></div><div className="flex flex-col gap-4 border-t border-dls-border px-6 py-5 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0"><DialogTitle className="text-lg">{previewTemplate.manifest.title}</DialogTitle><DialogDescription className="mt-2 max-w-2xl text-xs leading-5">{previewTemplate.manifest.description}</DialogDescription><p className="mt-2 text-[10px] text-dls-secondary">{previewTemplate.manifest.source.name} / {previewTemplate.manifest.source.license}</p></div><div className="flex shrink-0 gap-2"><Button variant="outline" size="sm" className="rounded-xl" onClick={() => setPreviewTemplate(null)}>{t("common.back")}</Button><Button size="sm" className="rounded-xl" disabled={busyId === previewTemplate.manifest.id} onClick={() => { setPreviewTemplate(null); if (previewTemplate.updateAvailable || !previewTemplate.installed) onInstall(previewTemplate.manifest.id); else onChoose(previewTemplate.manifest.id); }}>{busyId === previewTemplate.manifest.id ? <LoaderCircle className="size-3.5 animate-spin" /> : null}{previewTemplate.updateAvailable ? t("template_market.update_template") : previewTemplate.installed ? t("template_market.use_template") : t("template_market.install_template")}</Button></div></div></> : null}</DialogContent></Dialog>
  </>);
}

const TEMPLATE_PALETTE_FIELDS = [
  { key: "canvas", labelKey: "templates.palette_field.canvas" },
  { key: "text", labelKey: "templates.palette_field.text" },
  { key: "accent", labelKey: "templates.palette_field.accent" },
] as const;

function TemplatePalettePreview({ palette }: { palette: TemplateColorPalette }) {
  return <span className="flex gap-1" aria-hidden="true">{paletteColors(palette).map((color) => <span key={color} className="size-4 rounded-full border border-black/10" style={{ backgroundColor: color }} />)}</span>;
}

function TemplatePalettePicker({ selectedId, customPalette, onSelect, onCustomColorChange }: {
  selectedId: string;
  customPalette: TemplateColorPalette;
  onSelect: (id: string) => void;
  onCustomColorChange: (key: (typeof TEMPLATE_PALETTE_FIELDS)[number]["key"], value: string) => void;
}) {
  const selectedClass = "border-primary ring-2 ring-primary/20";
  const unselectedClass = "border-dls-border hover:border-dls-secondary";
  return <div>
    <div className="flex items-baseline justify-between gap-3"><p className="text-sm font-medium">{t("templates.palette.title")}</p><p className="text-[11px] text-dls-secondary">{t("templates.palette.summary")}</p></div>
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {TEMPLATE_COLOR_PRESETS.map((palette) => <button key={palette.id} type="button" aria-pressed={selectedId === palette.id} onClick={() => onSelect(palette.id)} className={cn("rounded-xl border p-2 text-left transition", selectedId === palette.id ? selectedClass : unselectedClass)}><span className="mb-2 block"><TemplatePalettePreview palette={palette} /></span><span className="text-xs font-medium">{templateColorPaletteLabel(palette.id)}</span></button>)}
      <div className={cn("rounded-xl border p-2 transition", selectedId === "custom" ? selectedClass : unselectedClass)}>
        <span className="mb-2 flex gap-1" aria-label={t("templates.palette.custom_group")}>
          {TEMPLATE_PALETTE_FIELDS.map((field) => {
            const label = t(field.labelKey);
            return <label key={field.key} title={t("templates.palette.choose_color", { field: label })} className="relative size-4 cursor-pointer overflow-hidden rounded-full border border-black/10" style={{ backgroundColor: customPalette[field.key] }} onPointerDown={() => onSelect("custom")}><input type="color" value={customPalette[field.key]} onChange={(event) => onCustomColorChange(field.key, event.currentTarget.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={t("templates.palette.custom_color_aria", { field: label })} /></label>;
          })}
        </span>
        <button type="button" aria-pressed={selectedId === "custom"} onClick={() => onSelect("custom")} className="w-full text-left text-xs font-medium">{templateColorPaletteLabel("custom")}</button>
      </div>
    </div>
  </div>;
}

function TemplateBriefCard({ template, onSubmit, onClose }: { template: TemplateManifestV1; onSubmit: (brief: TemplateBrief) => void; onClose: () => void | Promise<void> }) {
  const config = templateBriefConfigFor(template);
  const [brief, setBrief] = useState<Omit<TemplateBrief, "colorPalette">>({ title: "", audience: "", details: "" });
  const [selectedPaletteId, setSelectedPaletteId] = useState(DEFAULT_TEMPLATE_COLOR_PALETTE.id);
  const [customPalette, setCustomPalette] = useState(() => customTemplateColorPalette(paletteColors(DEFAULT_TEMPLATE_COLOR_PALETTE)));
  const colorPalette = selectedPaletteId === "custom"
    ? customPalette
    : TEMPLATE_COLOR_PRESETS.find((palette) => palette.id === selectedPaletteId) ?? DEFAULT_TEMPLATE_COLOR_PALETTE;
  return <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-6 py-10"><div className="w-full max-w-xl overflow-hidden rounded-3xl border border-dls-border bg-dls-surface shadow-[var(--dls-card-shadow)]"><div className={cn("relative p-5 pr-14", template.surface === "video" ? "bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-white" : "bg-gradient-to-br from-stone-100 via-orange-50 to-white")}><Button type="button" variant="ghost" size="icon-sm" className={cn("absolute right-4 top-4 rounded-full", template.surface === "video" ? "text-white/70 hover:text-white" : "text-dls-secondary hover:text-dls-text")} aria-label={t("common.close")} onClick={() => void onClose()}><X className="size-4" /></Button><p className={cn("text-xs font-medium", template.surface === "video" ? "text-indigo-200" : "text-dls-secondary")}>{template.title} · {config.label}</p><h2 className="mt-1 text-lg font-semibold">{config.heading}</h2><p className={cn("mt-1 text-sm", template.surface === "video" ? "text-white/65" : "text-dls-secondary")}>{config.description}</p></div><div className="space-y-4 p-5">{config.fields.map((field) => <label key={field.key} className="block text-sm font-medium">{field.label}{field.optional ? <span className="ml-1 text-xs font-normal text-dls-secondary">{t("common.optional_parens")}</span> : null}<Input value={brief[field.key]} onChange={(event) => { const value = event.currentTarget.value; setBrief((current) => ({ ...current, [field.key]: value })); }} placeholder={field.placeholder} className="mt-2" /></label>)}<TemplatePalettePicker selectedId={selectedPaletteId} customPalette={customPalette} onSelect={setSelectedPaletteId} onCustomColorChange={(key, value) => setCustomPalette((current) => ({ ...current, [key]: value }))} /><Button className="w-full" disabled={!brief.title.trim() || !brief.audience.trim()} onClick={() => onSubmit({ ...brief, title: brief.title.trim(), audience: brief.audience.trim(), details: brief.details.trim(), colorPalette })}>{config.submitLabel}</Button></div></div></div>;
}

export function SessionPage(props: SessionPageProps) {
  const locale = currentLocale();
  const { config: shellConfig } = useShellConfig();
  const platform = usePlatform();
  const navigate = useNavigate();
  const denAuth = useDenAuth();
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
  const [templateSessionRevision, setTemplateSessionRevision] = useState(0);
  const [templateCatalog, setTemplateCatalog] = useState<TemplateCatalogItem[]>([]);
  const [templateCatalogLoading, setTemplateCatalogLoading] = useState(false);
  const [templateCatalogError, setTemplateCatalogError] = useState<string | null>(null);
  const [templateBusyId, setTemplateBusyId] = useState<string | null>(null);
  const [templateMarketOpen, setTemplateMarketOpen] = useState(false);
  const [templateSessionData, setTemplateSessionData] = useState<{ state: TemplateSessionState; manifest: TemplateManifestV1; hasBrief: boolean } | null>(null);
  const [templateSessionLoading, setTemplateSessionLoading] = useState(false);
  const [sessionTypeRevision, setSessionTypeRevision] = useState(0);
  const selectedSessionType = useMemo(() => (
    props.selectedSessionId && typeof window !== "undefined"
      ? readSessionType(props.selectedSessionId)
      : null
  ), [props.selectedSessionId, sessionTypeRevision]);
  const isDesignSession = selectedSessionType === "design";
  const isVideoSession = selectedSessionType === "video";
  const hasTemplateSession = Boolean(templateSessionData);
  const hasTemplateBrief = templateSessionData?.hasBrief === true;
  const selectedTemplate = templateSessionData?.manifest ?? null;
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
  const videoOutput = useMemo(() => (
    getArtifactsFromMessages(conversationMessages, accessibleTargets, { includeTargetFallbacks: true })
      .find(isVideoHtmlArtifact) ?? null
  ), [accessibleTargets, conversationMessages]);
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
  const openCurrentVideoStudio = useCallback(() => {
    if (!props.selectedSessionId) return;
    setSidePanelState(props.selectedSessionId, "video");
  }, [props.selectedSessionId, setSidePanelState]);
  const refreshTemplateCatalog = useCallback(async () => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId) return;
    setTemplateCatalogLoading(true);
    setTemplateCatalogError(null);
    try { setTemplateCatalog((await props.ipolloworkServerClient.listTemplates(props.runtimeWorkspaceId)).items); }
    catch (error) { setTemplateCatalogError(error instanceof Error ? error.message : t("templates.error_load")); }
    finally { setTemplateCatalogLoading(false); }
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId]);
  const getTemplateCover = useCallback((templateId: string) => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId) {
      return Promise.reject(new Error("Template cover is unavailable."));
    }
    return props.ipolloworkServerClient.getTemplateCover(props.runtimeWorkspaceId, templateId);
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId]);
  useEffect(() => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId || !props.selectedSessionId || (selectedSessionType !== "design" && selectedSessionType !== "video")) {
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
      try {
        let result: TemplateSessionSnapshot;
        try {
          result = await client.getTemplateSession(workspaceId, sessionId);
        } catch (error) {
          // Sessions created before template persistence already have exactly
          // one Studio project at video/<session>. Claim that project once so
          // future app launches and agent prompts use its stored binding.
          if (selectedSessionType !== "video") throw error;
          result = await client.adoptLegacyVideoSession(workspaceId, sessionId);
        }
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
      const result = await props.ipolloworkServerClient.materializeTemplate(props.runtimeWorkspaceId, templateId, props.selectedSessionId);
      setSessionType(props.selectedSessionId, sessionTypeForTemplate(result.manifest));
      setTemplateSessionData({ ...result, hasBrief: false });
      setDismissedTemplateBriefSessionIds((current) => {
        const next = new Set(current);
        next.delete(props.selectedSessionId!);
        return next;
      });
      setSessionTypeRevision((value) => value + 1);
      setTemplateSessionRevision((value) => value + 1);
      setSidePanelState(props.selectedSessionId, "design");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create this template.");
    } finally { setTemplateBusyId(null); }
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId, props.selectedSessionId, setSidePanelState]);
  const installDesignTemplate = useCallback(async (templateId: string) => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId) return;
    setTemplateBusyId(templateId);
    try { await props.ipolloworkServerClient.installTemplate(props.runtimeWorkspaceId, templateId); await refreshTemplateCatalog(); }
    catch (error) { toast.error(error instanceof Error ? error.message : t("templates.error_install")); }
    finally { setTemplateBusyId(null); }
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId, refreshTemplateCatalog]);
  const uninstallDesignTemplate = useCallback(async (templateId: string) => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId) return;
    if (!window.confirm(t("templates.confirm_uninstall"))) return;
    setTemplateBusyId(templateId);
    try { await props.ipolloworkServerClient.uninstallTemplate(props.runtimeWorkspaceId, templateId); await refreshTemplateCatalog(); }
    catch (error) { toast.error(error instanceof Error ? error.message : t("templates.error_uninstall")); }
    finally { setTemplateBusyId(null); }
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId, refreshTemplateCatalog]);
  const importDesignTemplate = useCallback(async (file: File, category: TemplateManifestV1["category"]) => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId) return;
    setTemplateBusyId("import");
    try { const result = await props.ipolloworkServerClient.importTemplate(props.runtimeWorkspaceId, file, category); toast.success(t("templates.toast_installed", { title: result.item.manifest.title })); await refreshTemplateCatalog(); }
    catch (error) { toast.error(error instanceof Error ? error.message : t("templates.error_invalid_package")); }
    finally { setTemplateBusyId(null); }
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId, refreshTemplateCatalog]);
  const saveCurrentAsTemplate = useCallback(async (input: { title: string; category: TemplateManifestV1["category"]; style: TemplateStyle }) => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId || !props.selectedSessionId) return;
    try {
      setTemplateBusyId("save");
      const result = await props.ipolloworkServerClient.saveTemplateFromSession(props.runtimeWorkspaceId, {
        sessionId: props.selectedSessionId,
        category: input.category,
        title: input.title,
        style: input.style,
      });
      toast.success(t("templates.toast_saved", { title: result.item.manifest.title }));
      await refreshTemplateCatalog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("templates.error_save"));
    } finally {
      setTemplateBusyId(null);
    }
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId, props.selectedSessionId, refreshTemplateCatalog]);
  const submitTemplateBrief = useCallback(async (brief: TemplateBrief) => {
    if (!props.ipolloworkServerClient || !props.runtimeWorkspaceId || !props.selectedSessionId) return;
    const templateSession = templateSessionData;
    if (!templateSession) return;
    const { manifest: template, state } = templateSession;
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
        ...brief,
      }, null, 2),
      baseUpdatedAt: null,
    });
    setTemplateSessionData((current) => current ? { ...current, hasBrief: true } : current);
    setTemplateSessionRevision((value) => value + 1);
    setDismissedTemplateBriefSessionIds((current) => {
      if (!props.selectedSessionId || !current.has(props.selectedSessionId)) return current;
      const next = new Set(current);
      next.delete(props.selectedSessionId);
      return next;
    });
    const prompt = templateBriefPrompt({ template, entryPath: state.entry, briefPath: state.briefPath });
    const visibleTemplateMessage = t("templates.applied", { title: template.title });
    props.surface?.onSendDraft({
      mode: "prompt",
      parts: [
        { type: "text", text: visibleTemplateMessage },
        { type: "text", text: prompt, synthetic: true },
      ],
      attachments: [],
      text: visibleTemplateMessage,
      resolvedText: visibleTemplateMessage,
    }, props.selectedSessionId);
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId, props.selectedSessionId, props.surface, templateSessionData]);
  const closeTemplateBrief = useCallback(async () => {
    const sessionId = props.selectedSessionId;
    if (!sessionId) return;
    const emptyGeneratedTemplateSession = !templateSessionData?.hasBrief && conversationMessages.length === 0;
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
  }, [conversationMessages.length, props.onDeleteSession, props.selectedSessionId, templateSessionData?.hasBrief]);
  const [sessionPanelView, setSessionPanelView] = useState<SessionPanelView | null>(null);
  const effectiveSidePanelView = activeSidePanel ?? sessionPanelView;
  const sidePanelOpen = effectiveSidePanelView !== null;
  const panelRailActive = activeSidePanel === "panel";
  const designRailActive = activeSidePanel === "design";
  const videoRailActive = activeSidePanel === "video";
  const extensionsRailActive = activeSidePanel === "extensions";
  const voiceRailActive = activeSidePanel === "voice";
  useEffect(() => {
    if (!props.selectedSessionId) return;
    if (isVideoSession) {
      setSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, null);
      return;
    }
    if (isDesignSession && (activeSidePanel === "video" || activeSidePanel === "panel")) {
      setSidePanelState(props.selectedSessionId, "design");
    }
  }, [activeSidePanel, isDesignSession, isVideoSession, props.selectedSessionId, setSidePanelState]);
  useEffect(() => {
    if (!props.selectedSessionId || !isVideoSession || !videoOutput) return;
    const status = props.sidebar.sessionStatusById[props.selectedSessionId] ?? "idle";
    if (status !== "idle") return;
    const outputKey = `${props.selectedSessionId}:${videoOutput.messageId}:${videoOutput.path}`;
    if (autoOpenedVideoOutputRef.current === outputKey) return;
    autoOpenedVideoOutputRef.current = outputKey;
    openCurrentVideoStudio();
  }, [isVideoSession, openCurrentVideoStudio, props.selectedSessionId, props.sidebar.sessionStatusById, videoOutput]);
  useEffect(() => {
    autoOpenedVideoOutputRef.current = null;
  }, [props.selectedSessionId]);
  const voiceExtension = useMemo(
    () => IPOLLOWORK_EXTENSION_CATALOG.find((entry) => getExtensionId(entry) === "ipollowork-voice") ?? null,
    [],
  );
  const voiceExtensionEnabled = voiceExtension ? isiPolloWorkExtensionEnabled(voiceExtension) : false;
  const openCloudSignIn = useCallback(() => {
    const baseUrl = readDenBootstrapConfig().baseUrl;
    // Label stays "Sign in"; opens the sign-up tab so new users aren't defaulted into sign-in.
    platform.openLink(buildDenAuthUrl(baseUrl, "sign-up"));
  }, [platform]);
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
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createGroupLabel, setCreateGroupLabel] = useState("");
  const [createGroupWorkspaceId, setCreateGroupWorkspaceId] = useState<string | null>(null);
  const [mainWorkspaceView, setMainWorkspaceView] = useState<"extensions" | null>(null);
  const browserPanelRef = usePanelRef();
  const preserveSidePanelOnPanelOpenRef = useRef(false);

  const setCurrentSidePanel = useCallback((panel: SidePanelItem | null) => {
    if (panel) setMainWorkspaceView(null);
    setSessionPanelView(null);
    setSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, panel === "voice" ? "voice" : null);
    if (panel === "voice") return;
    setSidePanelState(props.selectedSessionId, panel);
  }, [props.selectedSessionId, setSidePanelState]);

  const toggleCurrentSidePanel = useCallback((panel: SidePanelItem) => {
    setMainWorkspaceView(null);
    setSessionPanelView(null);
    if (panel === "voice") {
      toggleSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, "voice");
      return;
    }
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
    const unsubClose = browser.onPanelClosed?.(() => setCurrentSidePanel(null));
    return () => { unsubOpen?.(); unsubClose?.(); };
  }, [setCurrentSidePanel]);
  const {
    leftSidebarResizing,
    leftSidebarWidth,
    rightSidebarExpandedWidth: browserPanelWidth,
    setRightSidebarExpandedWidth: setBrowserPanelWidth,
    startLeftSidebarResize,
  } = useWorkspaceShellLayout({
    expandedRightWidth: 520,
    minRightWidth: 320,
  });
  const [browserPanelDefaultWidth, setBrowserPanelDefaultWidth] = useState(browserPanelWidth);
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === "undefined" ? MAIN_WORKSPACE_MIN_WIDTH : window.innerWidth
  ));
  const sidebarProviderStyle: CSSProperties & Record<"--sidebar-width", string> = {
    "--sidebar-width": `${leftSidebarWidth}px`,
  };
  const mainWorkspaceMinWidth = viewportWidth >= leftSidebarWidth + browserPanelDefaultWidth + MAIN_WORKSPACE_MIN_WIDTH
    ? MAIN_WORKSPACE_MIN_WIDTH
    : MAIN_WORKSPACE_FALLBACK_MIN_WIDTH;
  const sidebarVisuallyCollapsed = !sidebarOpen;
  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  useEffect(() => {
    if (sidePanelOpen) return;
    setBrowserPanelDefaultWidth(browserPanelWidth);
  }, [sidePanelOpen, browserPanelWidth]);
  useEffect(() => {
    props.onAccessibleTargetsChange?.(accessibleTargets);
  }, [accessibleTargets, props.onAccessibleTargetsChange]);
  const commitBrowserPanelWidth = useCallback(() => {
    const size = browserPanelRef.current?.getSize();
    if (size?.inPixels) setBrowserPanelWidth(Math.round(size.inPixels));
  }, [browserPanelRef, setBrowserPanelWidth]);
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

    const binding = templateSessionData
      ? Promise.resolve({ surface: templateSessionData.manifest.surface, entry: templateSessionData.state.entry })
      : props.ipolloworkServerClient
        .getTemplateSession(props.runtimeWorkspaceId, sourceSessionId)
        .then((session) => ({ surface: session.manifest.surface, entry: session.state.entry }))
        .catch(() => null);

    return waitForTemplateEntrySurface(target, binding);
  }, [props.ipolloworkServerClient, props.runtimeWorkspaceId, props.selectedSessionId, templateSessionData]);
  const openTarget = useCallback(async (target: OpenTarget, options?: OpenTargetOptions, sourceSessionId?: string) => {
    if (target.kind === "url" || target.preview === "browser") {
      const url = browserUrlForTarget(target);
      if (isElectronRuntime()) {
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

    const sourceId = sourceSessionId ?? props.selectedSessionId;
    const templateSurface = await resolveOpenTargetTemplateSurface(target, sourceId);
    if (templateSurface) {
      setCurrentSidePanel(templateSurface);
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

    const sessionId = sourceSessionId ?? props.selectedSessionId;
    if (!sessionId) return;
    if (options?.auto && activePanelTab?.id === target.id) return;
    openTab(sessionId, {
      id: target.id,
      type: "artifact",
      label: target.name,
      preview: target.preview,
    });
    preserveSidePanelOnPanelOpenRef.current = true;
    setCurrentSidePanel("panel");
  }, [activePanelTab?.id, browserUrlForTarget, downloadOpenTarget, openTab, props.selectedSessionId, props.selectedWorkspaceDisplay.workspaceType, props.selectedWorkspaceRoot, resolveOpenTargetTemplateSurface, setCurrentSidePanel]);
  const closeRightPane = useCallback((options?: { preserveAutoCollapse?: boolean }) => {
    if (!options?.preserveAutoCollapse) {
      userOpenedSidePanelWhileNarrowRef.current = false;
      autoCollapsedSidePanelRef.current = null;
    }
    setSessionPanelView(null);
    setCurrentSidePanel(null);
  }, [setCurrentSidePanel]);
  useEffect(() => {
    if (
      availableMainWorkspaceWidth < AUTO_COLLAPSE_RIGHT_PANEL_WIDTH &&
      sidePanelOpen &&
      !userOpenedSidePanelWhileNarrowRef.current
    ) {
      autoCollapsedSidePanelRef.current = effectiveSidePanelView;
      closeRightPane({ preserveAutoCollapse: true });
      return;
    }
    const restoredPanel = autoCollapsedSidePanelRef.current;
    if (
      restoredPanel &&
      !sidePanelOpen &&
      expandedRightPanelWorkspaceWidth >= AUTO_COLLAPSE_RIGHT_PANEL_WIDTH
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
    setCurrentSidePanel,
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
        void window.__IPOLLOWORK_ELECTRON__?.browser?.createTab?.();
      }
    }
    toggleCurrentSidePanel("panel");
  }, [panelRailActive, sessionPanelState.tabs, toggleCurrentSidePanel]);
  const addBrowserPanelTab = useCallback(() => {
    if (isElectronRuntime()) {
      preserveSidePanelOnPanelOpenRef.current = true;
      void window.__IPOLLOWORK_ELECTRON__?.browser?.createTab?.();
    }
    setCurrentSidePanel("panel");
  }, [setCurrentSidePanel]);
  const toggleRightPanel = useCallback(() => {
    if (sidePanelOpen) {
      closeRightPane();
      return;
    }
    setSessionPanelView("launcher");
  }, [closeRightPane, sidePanelOpen]);
  const openDesignRailPane = useCallback(() => {
    toggleCurrentSidePanel("design");
  }, [toggleCurrentSidePanel]);
  const showDesignRailPane = useCallback(() => {
    setCurrentSidePanel("design");
  }, [setCurrentSidePanel]);
  const openVideoRailPane = useCallback(() => {
    if (videoRailActive) {
      closeRightPane();
      return;
    }
    setCurrentSidePanel("video");
  }, [closeRightPane, setCurrentSidePanel, videoRailActive]);
  const showVideoRailPane = useCallback(() => {
    setCurrentSidePanel("video");
  }, [setCurrentSidePanel]);
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
        setTemplateSessionData({ ...materialized, hasBrief: false });
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
        setTemplateSessionData({ ...materialized, hasBrief: false });
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
      return window.__IPOLLOWORK_ELECTRON__?.browser?.openUrl?.(url, provider);
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
      });
    }
    if (!panelRailActive) {
      toggleCurrentSidePanel("panel");
    }
  }, [artifactFileTargets, hasArtifactTargets, openTab, panelRailActive, props.selectedSessionId, selectTab, sessionPanelState, toggleCurrentSidePanel]);
  const showArtifactRailPane = useCallback(() => {
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
      active: panelRailActive,
      onClick: addBrowserPanelTab,
      disabled: !isElectronRuntime(),
    },
    {
      id: "code",
      label: t("session.side_panel.code"),
      iconSrc: publicAssetUrl("sidebar-entry-code.svg"),
      active: designRailActive,
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
  ], [activePanelTab?.type, addBrowserPanelTab, designRailActive, hasArtifactTargets, locale, panelRailActive, props.selectedSessionId, props.selectedWorkspaceDisplay.workspaceType, showArtifactRailPane, showDesignRailPane, showVideoRailPane, videoRailActive]);
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

  const selectedSessionTitle = useMemo(
    () => sessionTitleForId(props.sidebar.workspaceSessionGroups, props.selectedSessionId),
    [props.selectedSessionId, props.sidebar.workspaceSessionGroups],
  );
  const sessionActionTitle = useMemo(
    () => sessionTitleForId(props.sidebar.workspaceSessionGroups, sessionActionId),
    [props.sidebar.workspaceSessionGroups, sessionActionId],
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
  // 3. group.error from workspaceSessionGroups (the same source the sidebar reads)
  const selectedWorkspaceConnectionMessage = (() => {
    const state = props.sidebar.workspaceConnectionStateById[props.selectedWorkspaceId];
    if (state?.status === "error") return state.message?.trim() ?? "";
    return "";
  })();
  const selectedWorkspaceGroupError = (() => {
    const group = props.sidebar.workspaceSessionGroups.find(
      (item) => item.workspace.id === props.selectedWorkspaceId,
    );
    return group?.error?.trim() ?? "";
  })();
  const selectedWorkspaceErrorMessage =
    props.selectedWorkspaceError?.trim() ||
    selectedWorkspaceConnectionMessage ||
    selectedWorkspaceGroupError ||
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
  const showHeaderMenu = Boolean(
    (props.selectedSessionId && (props.onRenameSession || props.onDeleteSession)) || props.developerMode,
  );
  const selectedSessionIsDefaultTitle = selectedSessionTitle === t("session.default_title");
  const showMainHeaderTitle = Boolean(
    showWorkspaceSetupEmptyState || (props.selectedSessionId && !selectedSessionIsDefaultTitle),
  );
  const showMainHeaderMenu = showHeaderMenu && showMainHeaderTitle;

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
    setRenameTitle(sessionTitleForId(props.sidebar.workspaceSessionGroups, sessionId));
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top,rgba(74,111,255,0.12),transparent_42%),var(--app-bg,#0b1020)] text-dls-text mac:bg-transparent">
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        className={cn(
          "relative min-h-0 flex-1 mac:bg-transparent",
          leftSidebarResizing &&
            "**:data-[slot=sidebar-container]:transition-none **:data-[slot=sidebar-gap]:transition-none",
          !shellConfig.sidebar && "**:data-[slot=sidebar-container]:hidden **:data-[slot=sidebar-gap]:hidden",
        )}
        style={sidebarProviderStyle}
      >
        <AppSidebar
          workspaceSessionGroups={props.sidebar.workspaceSessionGroups}
          selectedWorkspaceId={props.sidebar.selectedWorkspaceId}
          developerMode={props.sidebar.developerMode}
          selectedSessionId={props.sidebar.selectedSessionId}
          showInitialLoading={sidebarInitialLoading}
          showSessionActions={Boolean(props.onRenameSession || props.onDeleteSession || props.onArchiveSession)}
          sessionStatusById={props.sidebar.sessionStatusById}
          connectingWorkspaceId={props.sidebar.connectingWorkspaceId}
          workspaceConnectionStateById={props.sidebar.workspaceConnectionStateById}
          newTaskDisabled={props.sidebar.newTaskDisabled}
          onSelectWorkspace={props.sidebar.onSelectWorkspace}
          onOpenSession={props.sidebar.onOpenSession}
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
          onOpenCreateGroupModal={(workspaceId) => {
            setCreateGroupWorkspaceId(workspaceId);
            setCreateGroupLabel("");
            setCreateGroupOpen(true);
          }}
          onOpenRenameWorkspace={props.sidebar.onOpenRenameWorkspace}
          onShareWorkspace={props.sidebar.onShareWorkspace}
          onRevealWorkspace={props.sidebar.onRevealWorkspace}
          onRecoverWorkspace={props.sidebar.onRecoverWorkspace}
          onTestWorkspaceConnection={props.sidebar.onTestWorkspaceConnection}
          onEditWorkspaceConnection={props.sidebar.onEditWorkspaceConnection}
          onForgetWorkspace={props.sidebar.onForgetWorkspace}
          onOpenCreateWorkspace={props.sidebar.onOpenCreateWorkspace}
          account={{
            loading: denAuth.status === "checking",
            signedIn: denAuth.isSignedIn,
            name: denAuth.user?.name ?? null,
            email: denAuth.user?.email ?? null,
          }}
          activePrimaryItem={templateMarketOpen ? "template-market" : mainWorkspaceView === "extensions" ? "extensions" : null}
          onOpenAccount={openCloudAccount}
          onOpenSettings={props.onOpenSettings}
          onOpenTemplateMarket={() => setTemplateMarketOpen(true)}
          onOpenExtensions={openExtensionsRailPane}
          onSignIn={openCloudSignIn}
          onOpenSessionSearch={props.sidebar.onOpenSessionSearch}
          onReorderWorkspaces={props.sidebar.onReorderWorkspaces}
          onStartResize={startLeftSidebarResize}
        />
        <SidebarInset className="relative min-h-0 overflow-hidden bg-background mac:bg-background/80 mac:[&_header]:transition-[padding-left] mac:[&_header]:duration-200 mac:[&_header]:ease-linear mac:peer-data-[state=collapsed]:[&_header]:pl-28 mac:max-md:[&_header]:pl-28">
          <div className="flex min-h-0 flex-1">
          <ResizablePanelGroup
            orientation="horizontal"
            onLayoutChanged={sidePanelOpen ? commitBrowserPanelWidth : undefined}
            className="min-h-0 flex-1"
          >
            <ResizablePanel minSize={`${mainWorkspaceMinWidth}px`} className="min-w-0">
              <main className="flex h-full min-w-0 flex-col overflow-hidden border-r border-[#EAEAEA] [border-right-width:0.5px]">
          <header className={cn(
            "relative z-10 h-10 shrink-0 items-center justify-between border-b border-[#EAEAEA] px-4 [border-bottom-width:0.5px] md:px-6 mac:titlebar-drag mac:backdrop-blur-2xl mac:backdrop-saturate-150 @container/titlebar",
            mainWorkspaceView === "extensions" || (showNewConversationChrome && !sidebarVisuallyCollapsed) ? "hidden" : "flex",
          )}>
            {shellConfig.sidebar && sidebarVisuallyCollapsed ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute left-6 top-1/2 z-20 size-8 -translate-y-1/2 rounded-lg border-none text-muted-foreground hover:bg-muted hover:text-foreground mac:left-20 mac:titlebar-no-drag"
                aria-label={t("sidebar.expand")}
                title={t("sidebar.expand")}
                onClick={() => setSidebarOpen(true)}
                style={{ WebkitAppRegion: "no-drag", pointerEvents: "auto" } as CSSProperties}
              >
                <img src={publicAssetUrl("sidebar-left-expand.svg")} alt="" className="h-3 w-4 shrink-0" />
              </Button>
            ) : null}
            <div className="flex min-w-0 items-center gap-1">
              {showMainHeaderTitle ? (
                <h1 className="truncate text-[14px] font-medium text-dls-text">
                  {showWorkspaceSetupEmptyState
                    ? t("session.create_or_connect_workspace")
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
                disabled={!conversationMessages.length}
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
                      disabled={!props.selectedSessionId}
                      onClick={toggleRightPanel}
                    >
                      <img
                        src={publicAssetUrl(sidePanelOpen ? "sidebar-right-open.svg" : "sidebar-right-closed.svg")}
                        alt=""
                        className="h-3 w-4 shrink-0"
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
                          onImport={(file, category) => void importDesignTemplate(file, category)}
                        />
                      ) : templateSessionData && !hasTemplateBrief && !templateBriefDismissed ? (
                        <TemplateBriefCard template={templateSessionData.manifest} onSubmit={(brief) => void submitTemplateBrief(brief)} onClose={() => void closeTemplateBrief()} />
                      ) : <SessionSurface
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
                        onCreateSession={(type, templateId) => props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId, type, templateId)}
                        onActivateVideoStudio={activateVideoStudio}
                        designTemplates={templateCatalog}
                        designTemplatesLoading={templateCatalogLoading}
                        designTemplateBusyId={templateBusyId}
                        onInstallDesignTemplate={(templateId) => void installDesignTemplate(templateId)}
                        onRequestDesignTemplates={() => void refreshTemplateCatalog()}
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
                        <h3 className="text-xl font-medium">{t("session.create_or_connect_workspace")}</h3>
                        <p className="mx-auto max-w-sm text-sm text-dls-secondary">
                          {t("workspace.empty_state_body")}
                        </p>
                      </div>
                      <div className="flex justify-center">
                        <Button onClick={props.sidebar.onOpenCreateWorkspace}>{t("workspace.create_workspace")}</Button>
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
            </ResizablePanel>
              {sidePanelOpen ? (
              <>
                <ResizableHandle withHandle className="hidden lg:flex" />
                <ResizablePanel
                  panelRef={browserPanelRef}
                  defaultSize={`${effectiveSidePanelView === "video" ? Math.max(browserPanelDefaultWidth, 1120) : effectiveSidePanelView === "launcher" ? 320 : effectiveSidePanelView === "outputs" ? Math.max(browserPanelDefaultWidth, 360) : effectiveSidePanelView === "extensions" || effectiveSidePanelView === "design" ? Math.max(browserPanelDefaultWidth, 480) : browserPanelDefaultWidth}px`}
                  minSize={effectiveSidePanelView === "video" ? "760px" : effectiveSidePanelView === "launcher" ? "280px" : effectiveSidePanelView === "outputs" ? "320px" : effectiveSidePanelView === "extensions" || effectiveSidePanelView === "design" ? "420px" : "320px"}
                  maxSize={effectiveSidePanelView === "video" ? "82%" : "70%"}
                  className="min-h-0 overflow-hidden lg:flex lg:flex-col"
                >
                  {effectiveSidePanelView === "launcher" ? (
                    <div className="flex h-full flex-col bg-background px-10 pt-[44vh] text-[#6B7280]">
                      <div className="w-full max-w-[240px] space-y-5">
                        {sidePanelLauncherItems.map((item) => {
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className={cn(
                                "flex h-9 w-full items-center gap-3 rounded-xl px-2 text-left text-[14px] font-normal tracking-[-0.56px] text-[#8A8A8A] transition-colors hover:bg-[#F5F5F5] hover:text-[#242424] disabled:cursor-not-allowed disabled:opacity-40",
                                item.active && "bg-[#F5F5F5] text-[#242424]",
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
                  ) : activeSidePanel === "voice" ? (
                    <VoicePanel
                      client={props.ipolloworkServerClient}
                      workspaceId={props.runtimeWorkspaceId}
                      sessionId={props.selectedSessionId}
                      onClose={closeRightPane}
                    />
                  ) : activeSidePanel === "design" && props.selectedSessionId ? (
                    <DesignPanel
                      sessionId={props.selectedSessionId}
                      client={props.ipolloworkServerClient}
                      workspaceId={props.runtimeWorkspaceId}
                      isRemoteWorkspace={props.selectedWorkspaceDisplay.workspaceType === "remote"}
                      onClose={closeRightPane}
                    />
                  ) : activeSidePanel === "video" && props.selectedSessionId ? (
                    <VideoPanel
                      key={`${props.selectedWorkspaceId}:${props.selectedSessionId}`}
                      sessionId={props.selectedSessionId}
                      workspaceRoot={props.selectedWorkspaceRoot}
                      client={props.ipolloworkServerClient}
                      workspaceId={props.runtimeWorkspaceId}
                      isRemoteWorkspace={props.selectedWorkspaceDisplay.workspaceType === "remote"}
                      onClose={closeRightPane}
                    />
                  ) : activeSidePanel === "outputs" ? (
                    <ConversationOutputPanel
                      messages={conversationMessages}
                      openTargets={accessibleTargets}
                      onOpenTarget={openTarget}
                      onOpenVideoStudio={openCurrentVideoStudio}
                    />
                  ) : activeSidePanel === "panel" && props.selectedSessionId ? (
                    <SidePanel
                      sessionId={props.selectedSessionId}
                      client={props.ipolloworkServerClient}
                      workspaceId={props.runtimeWorkspaceId}
                      workspaceRoot={props.selectedWorkspaceRoot}
                      isRemoteWorkspace={props.surface?.isRemoteWorkspace ?? false}
                      launcherItems={sidePanelLauncherItems}
                      onClose={closeRightPane}
                    />
                  ) : null}
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
          </div>
        </SidebarInset>
      </SidebarProvider>

      {props.ipolloworkServerClient && props.runtimeWorkspaceId ? <TemplateMarketDialog
        open={templateMarketOpen}
        onOpenChange={setTemplateMarketOpen}
        templates={templateCatalog}
        loading={templateCatalogLoading}
        error={templateCatalogError}
        busyId={templateBusyId}
        getCover={getTemplateCover}
        canSaveCurrent={Boolean(props.selectedSessionId && (isDesignSession || isVideoSession))}
        currentSurface={isVideoSession ? "video" : isDesignSession ? "design" : null}
        currentCategory={isVideoSession ? "video" : selectedTemplate?.category ?? "site"}
        onRefresh={refreshTemplateCatalog}
        onInstall={(templateId) => void installDesignTemplate(templateId)}
        onUninstall={(templateId) => void uninstallDesignTemplate(templateId)}
        onImport={(file, category) => void importDesignTemplate(file, category)}
        onSaveCurrent={(input) => void saveCurrentAsTemplate(input)}
        onUse={(template) => {
          if (template.manifest.surface === "video" && props.selectedWorkspaceDisplay.workspaceType === "remote") {
            toast.error(t("templates.video_local_only"));
            return;
          }
          setTemplateMarketOpen(false);
          props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId, sessionTypeForTemplate(template.manifest), template.manifest.id);
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

      <Dialog open={createGroupOpen} onOpenChange={(open) => { if (!open) setCreateGroupOpen(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("session_management.new_group")}</DialogTitle>
          </DialogHeader>
          <Input
            type="text"
            value={createGroupLabel}
            onChange={(e) => setCreateGroupLabel(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && createGroupLabel.trim()) {
                if (createGroupWorkspaceId) useSessionManagementStore.getState().createGroup(createGroupWorkspaceId, createGroupLabel.trim());
                setCreateGroupOpen(false);
              }
            }}
            placeholder={t("session_management.new_group_prompt")}
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>{t("common.cancel")}</DialogClose>
            <Button
              type="button"
              disabled={!createGroupLabel.trim()}
              onClick={() => {
                if (createGroupWorkspaceId) useSessionManagementStore.getState().createGroup(createGroupWorkspaceId, createGroupLabel.trim());
                setCreateGroupOpen(false);
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {props.shareWorkspaceModal ? <ShareWorkspaceModal {...props.shareWorkspaceModal} /> : null}

      {/* Cloud provider notifications are now handled globally by CloudProvidersToast in app-root.tsx */}
    </div>
  );
}
