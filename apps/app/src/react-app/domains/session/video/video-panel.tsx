/** @jsxImportSource react */
import * as React from "react";
import { AudioLines, Ellipsis, Film, LayoutTemplate, Loader2, Maximize2, Minimize2, Palette, Plus, RefreshCw, X } from "lucide-react";

import type { HyperframesCatalogItem, iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { getResolvedThemeMode, subscribeToTheme } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { currentLocale, localeChangedEvent, t } from "@/i18n";
import type { DesignAiSelectionContext } from "../design/design-ai-selection";
import { DesignSystemDrawer } from "../design/design-system-drawer";
import { mergeTemplateTokenCss, parseDesignTokenValues, replaceDesignTokenValue, type DesignTokenValues } from "../design/design-system-files";
import { buildTemplateTokenCss, type DesignSystemTheme } from "../design/design-system-registry";
import { ensureHtmlDesignSystemContract, readAppliedDesignSystemId } from "../design/design-system-theme-contract";
import type { SidePanelLauncherItem } from "../panel/side-panel";
import {
  HYPERFRAMES_STUDIO_LABEL,
  hyperframesStudioPort,
  hyperframesStudioUrl,
  videoProjectDirectory,
  videoProjectId,
} from "./video-project";
import { resolveVideoAiSelectionTarget } from "./video-ai-selection";
import { VideoVoicePanel } from "./video-voice-panel";

export {
  hyperframesStudioPort,
  hyperframesStudioUrl,
  videoProjectDirectory,
  videoProjectId,
} from "./video-project";

type VideoPanelProps = {
  sessionId: string;
  workspaceRoot: string;
  client: iPolloWorkServerClient | null;
  workspaceId: string | null;
  isRemoteWorkspace?: boolean;
  launcherItems?: SidePanelLauncherItem[];
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onAskAi?: (context: DesignAiSelectionContext) => void;
  onSaveAsTemplate?: () => void;
  onClose: () => void;
};

type StudioStartupStage = "starting-service" | "waiting-for-studio" | "loading-frame";

type StudioHistoryFiles = Record<"index.html" | "design-tokens.css", {
  before: string;
  after: string;
}>;

const studioStartupTitleKey: Record<StudioStartupStage, string> = {
  "starting-service": "video.startup.starting_service_title",
  "waiting-for-studio": "video.startup.waiting_for_studio_title",
  "loading-frame": "video.startup.loading_frame_title",
};

const studioStartupDetailKey: Record<StudioStartupStage, string> = {
  "starting-service": "video.startup.starting_service_detail",
  "waiting-for-studio": "video.startup.waiting_for_studio_detail",
  "loading-frame": "video.startup.loading_frame_detail",
};

export function VideoPanel({ sessionId, workspaceRoot, client, workspaceId, isRemoteWorkspace = false, launcherItems = [], expanded = false, onExpandedChange, onAskAi, onSaveAsTemplate, onClose }: VideoPanelProps) {
  const terminalIdRef = React.useRef<string | null>(null);
  const studioFrameRef = React.useRef<HTMLIFrameElement | null>(null);
  const keepStudioWarmOnCloseRef = React.useRef(false);
  const studioChromeReadyRef = React.useRef(false);
  const studioReadyFallbackRef = React.useRef<number | null>(null);
  const [revision, setRevision] = React.useState(0);
  const [startAttempt, setStartAttempt] = React.useState(0);
  const [status, setStatus] = React.useState<"starting" | "ready" | "failed">("starting");
  const [startupStage, setStartupStage] = React.useState<StudioStartupStage>("starting-service");
  const [detail, setDetail] = React.useState(`Starting ${HYPERFRAMES_STUDIO_LABEL}...`);
  const [studioFrameLoaded, setStudioFrameLoaded] = React.useState(false);
  const [studioChromeReady, setStudioChromeReady] = React.useState(false);
  const [studioHistoryReady, setStudioHistoryReady] = React.useState(false);
  const [voicePanelOpen, setVoicePanelOpen] = React.useState(false);
  const [designSystemOpen, setDesignSystemOpen] = React.useState(false);
  const [designTokenSource, setDesignTokenSource] = React.useState("");
  const designTokenSourceRef = React.useRef("");
  const designTokenSaveTimerRef = React.useRef<number | null>(null);
  const studioPort = hyperframesStudioPort(sessionId);
  const [activeStudioPort, setActiveStudioPort] = React.useState(studioPort);
  const resolvedTheme = React.useSyncExternalStore(
    subscribeToTheme,
    getResolvedThemeMode,
    getResolvedThemeMode,
  );
  const initialStudioThemeRef = React.useRef(resolvedTheme);
  const studioUrl = hyperframesStudioUrl(
    activeStudioPort,
    videoProjectId(sessionId),
    currentLocale(),
    initialStudioThemeRef.current,
    0,
  );
  const projectDirectory = videoProjectDirectory(sessionId);
  const compositionPath = `${projectDirectory}/index.html`;
  const designTokenPath = `${projectDirectory}/design-tokens.css`;
  const designTokenValues = React.useMemo<DesignTokenValues>(
    () => parseDesignTokenValues(designTokenSource),
    [designTokenSource],
  );
  const appliedDesignSystemId = React.useMemo(
    () => readAppliedDesignSystemId(designTokenSource),
    [designTokenSource],
  );

  const loadDesignSystemFiles = React.useCallback(async () => {
    if (!client || !workspaceId) return;
    const tokens = await client.readWorkspaceFile(workspaceId, designTokenPath).catch(() => null);
    const source = tokens?.content ?? "";
    designTokenSourceRef.current = source;
    setDesignTokenSource(source);
  }, [client, designTokenPath, workspaceId]);

  React.useEffect(() => {
    if (!designSystemOpen) return;
    void loadDesignSystemFiles();
  }, [designSystemOpen, loadDesignSystemFiles]);

  React.useEffect(() => {
    const handlePanelRequest = (event: MessageEvent) => {
      if (event.source !== studioFrameRef.current?.contentWindow) return;
      if (event.origin !== new URL(studioUrl).origin) return;
      if (event.data?.type !== "ipollowork:video-studio-panel") return;
      if (event.data.projectId !== videoProjectId(sessionId)) return;
      if (event.data.panel === "voice") {
        setDesignSystemOpen(false);
        setVoicePanelOpen(true);
      } else if (event.data.panel === "style") {
        setVoicePanelOpen(false);
        setDesignSystemOpen(true);
      } else if (event.data.panel === null) {
        setVoicePanelOpen(false);
        setDesignSystemOpen(false);
      }
    };
    window.addEventListener("message", handlePanelRequest);
    return () => window.removeEventListener("message", handlePanelRequest);
  }, [sessionId, studioUrl]);

  React.useEffect(() => {
    setStudioHistoryReady(false);
  }, [studioUrl]);

  React.useEffect(() => {
    const handleHistoryMessage = (event: MessageEvent) => {
      if (event.source !== studioFrameRef.current?.contentWindow) return;
      if (event.origin !== new URL(studioUrl).origin) return;
      if (event.data?.projectId !== videoProjectId(sessionId)) return;
      if (event.data.type === "ipollowork:studio-history-ready") {
        setStudioHistoryReady(true);
        return;
      }
      if (event.data.type === "ipollowork:studio-history-applied") void loadDesignSystemFiles();
    };
    window.addEventListener("message", handleHistoryMessage);
    return () => window.removeEventListener("message", handleHistoryMessage);
  }, [loadDesignSystemFiles, sessionId, studioUrl]);

  React.useEffect(() => () => {
    if (designTokenSaveTimerRef.current != null) window.clearTimeout(designTokenSaveTimerRef.current);
  }, []);

  const saveDesignTokenSource = React.useCallback((source: string) => {
    if (!client || !workspaceId) return;
    if (designTokenSaveTimerRef.current != null) window.clearTimeout(designTokenSaveTimerRef.current);
    designTokenSaveTimerRef.current = window.setTimeout(() => {
      designTokenSaveTimerRef.current = null;
      void client.writeWorkspaceFile(workspaceId, {
        path: designTokenPath,
        content: source,
        force: true,
      }).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Could not save video design tokens.");
      });
    }, 350);
  }, [client, designTokenPath, workspaceId]);

  const handleDesignTokenChange = React.useCallback((name: string, value: string) => {
    const next = replaceDesignTokenValue(designTokenSourceRef.current, name, value);
    designTokenSourceRef.current = next;
    setDesignTokenSource(next);
    saveDesignTokenSource(next);
  }, [saveDesignTokenSource]);

  const recordStudioHostEdit = React.useCallback((label: string, files: StudioHistoryFiles) => {
    const frameWindow = studioFrameRef.current?.contentWindow;
    if (!studioHistoryReady || !frameWindow) {
      return Promise.reject(new Error("Video Studio undo history is not ready."));
    }
    const projectId = videoProjectId(sessionId);
    const operationId = crypto.randomUUID();
    const targetOrigin = new URL(studioUrl).origin;
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timeoutId);
        window.removeEventListener("message", handleResult);
      };
      const handleResult = (event: MessageEvent) => {
        if (event.source !== frameWindow || event.origin !== targetOrigin) return;
        if (
          event.data?.type !== "ipollowork:studio-history-recorded"
          || event.data.projectId !== projectId
          || event.data.operationId !== operationId
        ) {
          return;
        }
        cleanup();
        if (event.data.ok === true) {
          resolve();
          return;
        }
        reject(new Error(
          typeof event.data.error === "string"
            ? event.data.error
            : "Could not record Video Studio undo history.",
        ));
      };
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error("Video Studio did not confirm the undo history update."));
      }, 3_000);
      window.addEventListener("message", handleResult);
      frameWindow.postMessage({
        type: "ipollowork:studio-record-host-edit",
        projectId,
        operationId,
        label,
        files,
      }, targetOrigin);
    });
  }, [sessionId, studioHistoryReady, studioUrl]);

  const handleApplyDesignSystem = React.useCallback(async (theme: DesignSystemTheme) => {
    if (!client || !workspaceId) return;
    if (!studioHistoryReady) {
      toast.info("Video Studio is still preparing undo history.");
      return;
    }
    const hadPendingTokenSave = designTokenSaveTimerRef.current != null;
    const pendingTokenSource = designTokenSourceRef.current;
    try {
      if (designTokenSaveTimerRef.current != null) {
        window.clearTimeout(designTokenSaveTimerRef.current);
        designTokenSaveTimerRef.current = null;
      }
      const [current, currentTokens] = await Promise.all([
        client.readWorkspaceFile(workspaceId, compositionPath),
        client.readWorkspaceFile(workspaceId, designTokenPath).catch(() => ({
          content: pendingTokenSource,
        })),
      ]);
      const currentTokenCss = hadPendingTokenSave ? pendingTokenSource : currentTokens.content;
      const themedHtml = ensureHtmlDesignSystemContract(current.content, theme.id);
      const nextTokens = mergeTemplateTokenCss(currentTokenCss, buildTemplateTokenCss(theme));
      if (themedHtml === current.content && nextTokens === currentTokenCss) {
        if (hadPendingTokenSave) saveDesignTokenSource(currentTokenCss);
        toast.info(`${theme.name} is already applied to Video Studio.`);
        return;
      }
      await client.writeWorkspaceFile(workspaceId, {
        path: designTokenPath,
        content: nextTokens,
        force: true,
      });
      try {
        if (themedHtml !== current.content) {
          await client.writeWorkspaceFile(workspaceId, {
            path: compositionPath,
            content: themedHtml,
            baseUpdatedAt: current.updatedAt ?? null,
            force: true,
          });
        }
      } catch (error) {
        await client.writeWorkspaceFile(workspaceId, {
          path: designTokenPath,
          content: currentTokenCss,
          force: true,
        }).catch((rollbackError) => {
          console.error("[video-studio] failed to roll back design tokens", rollbackError);
        });
        throw error;
      }
      try {
        await recordStudioHostEdit(`Apply ${theme.name} design system`, {
          "index.html": {
            before: current.content,
            after: themedHtml,
          },
          "design-tokens.css": {
            before: currentTokenCss,
            after: nextTokens,
          },
        });
      } catch (historyError) {
        try {
          await client.writeWorkspaceFile(workspaceId, {
            path: designTokenPath,
            content: currentTokenCss,
            force: true,
          });
          if (themedHtml !== current.content) {
            await client.writeWorkspaceFile(workspaceId, {
              path: compositionPath,
              content: current.content,
              force: true,
            });
          }
        } catch (rollbackError) {
          throw new AggregateError(
            [historyError, rollbackError],
            "Could not record or roll back the video design system.",
          );
        }
        throw historyError;
      }
      designTokenSourceRef.current = nextTokens;
      setDesignTokenSource(nextTokens);
      toast.success(`Applied ${theme.name} to Video Studio.`);
    } catch (error) {
      if (hadPendingTokenSave && designTokenSaveTimerRef.current == null) {
        saveDesignTokenSource(pendingTokenSource);
      }
      toast.error(error instanceof Error ? error.message : "Could not apply the video design system.");
    }
  }, [client, compositionPath, designTokenPath, recordStudioHostEdit, saveDesignTokenSource, studioHistoryReady, workspaceId]);

  React.useEffect(() => {
    if (!designSystemOpen) return;
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement
        && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      const action = key === "z"
        ? event.shiftKey ? "redo" : "undo"
        : key === "y" && event.ctrlKey && !event.metaKey ? "redo" : null;
      if (!action) return;
      const frameWindow = studioFrameRef.current?.contentWindow;
      if (!frameWindow) return;
      event.preventDefault();
      frameWindow.postMessage({
        type: "ipollowork:studio-history-action",
        projectId: videoProjectId(sessionId),
        action,
      }, new URL(studioUrl).origin);
    };
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [designSystemOpen, sessionId, studioUrl]);

  const syncStudioLocale = React.useCallback(() => {
    const frameWindow = studioFrameRef.current?.contentWindow;
    if (!frameWindow) return;
    const targetOrigin = new URL(studioUrl).origin;
    frameWindow.postMessage(
      { type: "ipollowork:studio-locale", locale: currentLocale() },
      targetOrigin,
    );
  }, [studioUrl]);

  const syncStudioTheme = React.useCallback(() => {
    const frameWindow = studioFrameRef.current?.contentWindow;
    if (!frameWindow) return;
    frameWindow.postMessage(
      { type: "ipollowork:studio-theme", theme: getResolvedThemeMode() },
      new URL(studioUrl).origin,
    );
  }, [studioUrl]);

  React.useEffect(() => {
    if (!client || !workspaceId || !onAskAi) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== studioFrameRef.current?.contentWindow) return;
      if (event.origin !== new URL(studioUrl).origin) return;
      if (event.data?.type !== "ipollowork:hyperframes:ask-ai-selection") return;
      const target = resolveVideoAiSelectionTarget(event.data.target);
      if (!target) {
        toast.error("Could not identify the selected video element. Select it again and retry.");
        return;
      }
      const filePath = `${projectDirectory}/${target.file}`.replace(/\\/g, "/");
      void (async () => {
        const current = await client.readWorkspaceFile(workspaceId, filePath);
        const tag = typeof event.data.tag === "string" && event.data.tag.trim()
          ? event.data.tag.trim().toLowerCase()
          : "element";
        const text = typeof event.data.text === "string" ? event.data.text.trim() : "";
        const src = typeof event.data.src === "string" ? event.data.src : "";
        const alt = typeof event.data.alt === "string" ? event.data.alt : "";
        const summary = (text || alt || src || target.locator).replace(/\s+/g, " ").trim().slice(0, 80);
        const styles = event.data.styles && typeof event.data.styles === "object"
          ? Object.fromEntries(Object.entries(event.data.styles).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"))
          : {};
        onAskAi({
          id: `video-ai-${crypto.randomUUID()}`,
          sessionId,
          workspaceId,
          filePath,
          baseUpdatedAt: current.updatedAt ?? null,
          beforeHtml: current.content,
          target: {
            tag,
            label: summary ? `VIDEO ${tag.toUpperCase()} · ${summary}` : `VIDEO ${tag.toUpperCase()}`,
            locator: target.locator,
            text,
            src,
            alt,
            styles,
          },
        });
        onExpandedChange?.(false);
      })().catch((error) => {
        console.error("[video-studio] failed to create AI selection", error);
        toast.error(error instanceof Error ? error.message : "Could not add the selected video element to Ask AI.");
      });
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [client, onAskAi, onExpandedChange, projectDirectory, sessionId, studioUrl, workspaceId]);

  React.useEffect(() => {
    const handleAnimationReference = (event: MessageEvent) => {
      if (event.source !== studioFrameRef.current?.contentWindow) return;
      if (event.origin !== new URL(studioUrl).origin) return;
      if (event.data?.type !== "ipollowork:hyperframes:animation-reference") return;
      const candidate = event.data.animation;
      if (!candidate || typeof candidate !== "object") return;
      if (
        typeof candidate.name !== "string" ||
        typeof candidate.title !== "string" ||
        typeof candidate.description !== "string" ||
        typeof candidate.type !== "string" ||
        typeof candidate.category !== "string" ||
        typeof candidate.agentPrompt !== "string"
      ) return;
      const item: HyperframesCatalogItem = {
        name: candidate.name,
        title: candidate.title,
        description: candidate.description,
        type: candidate.type === "hyperframes:block" ? "hyperframes:block" : "hyperframes:component",
        kind: candidate.kind === "effect"
          || candidate.type !== "hyperframes:block"
          || ["scroll", "svg", "text-effects", "transitions", "captions", "effects", "vfx"].includes(candidate.category)
          ? "effect"
          : "animation",
        category: candidate.category,
        tags: Array.isArray(candidate.tags)
          ? candidate.tags.filter((tag: unknown): tag is string => typeof tag === "string")
          : [],
        duration: typeof candidate.duration === "number" ? candidate.duration : undefined,
        preview: candidate.preview && typeof candidate.preview === "object"
          ? {
              poster: typeof candidate.preview.poster === "string" ? candidate.preview.poster : undefined,
              video: typeof candidate.preview.video === "string" ? candidate.preview.video : undefined,
            }
          : undefined,
        variables: [],
        agentPrompt: candidate.agentPrompt,
      };
      window.dispatchEvent(new CustomEvent("ipollowork:add-animation-reference", {
        detail: { sessionId, item },
      }));
      window.dispatchEvent(new Event("ipollowork:focusPrompt"));
    };
    window.addEventListener("message", handleAnimationReference);
    return () => window.removeEventListener("message", handleAnimationReference);
  }, [sessionId, studioUrl]);

  const scheduleStudioLocaleSync = React.useCallback(() => {
    syncStudioLocale();
  }, [syncStudioLocale]);

  React.useEffect(() => {
    const handleStudioReady = (event: MessageEvent) => {
      if (event.source !== studioFrameRef.current?.contentWindow) return;
      if (event.origin !== new URL(studioUrl).origin) return;
      if (event.data?.type !== "ipollowork:studio-ready") return;
      if (event.data.projectId !== videoProjectId(sessionId)) return;
      if (studioReadyFallbackRef.current != null) {
        window.clearTimeout(studioReadyFallbackRef.current);
        studioReadyFallbackRef.current = null;
      }
      studioChromeReadyRef.current = true;
      setStudioChromeReady(true);
      setDetail(t("video.ready_on_port", { port: activeStudioPort }));
      scheduleStudioLocaleSync();
      syncStudioTheme();
    };
    window.addEventListener("message", handleStudioReady);
    return () => window.removeEventListener("message", handleStudioReady);
  }, [activeStudioPort, scheduleStudioLocaleSync, sessionId, studioUrl, syncStudioTheme]);

  React.useEffect(() => {
    setStatus("starting");
    setStartupStage("starting-service");
    setDetail(t("video.starting_hyperframes", { version: HYPERFRAMES_STUDIO_LABEL }));
    setStudioFrameLoaded(false);
    studioChromeReadyRef.current = false;
    setStudioChromeReady(false);
    setActiveStudioPort(studioPort);
    if (isRemoteWorkspace) {
      setStatus("failed");
      setDetail(t("video.local_workspaces"));
      return;
    }
    if (!workspaceRoot.trim()) {
      setStatus("starting");
      setDetail(t("video.starting_workspace"));
      return;
    }
    const bridge = window.__IPOLLOWORK_ELECTRON__?.hyperframes;
    if (!bridge?.start || !bridge.stop) {
      setStatus("failed");
      setDetail(t("video.requires_desktop"));
      return;
    }
    const startHyperframes = bridge.start;
    const stopHyperframes = bridge.stop;

    let disposed = false;
    const waitingTimer = window.setTimeout(() => {
      if (!disposed) {
        setStartupStage("waiting-for-studio");
        setDetail(t("video.waiting_on_port", { port: studioPort }));
      }
    }, 900);
    void startHyperframes({
      workspaceRoot,
      sessionId,
      projectDirectory,
      port: studioPort,
    }).then((result) => {
      if (disposed) return;
      window.clearTimeout(waitingTimer);
      if (!result?.ok) throw new Error(t("video.could_not_start"));
      if (typeof result.port === "number" && Number.isInteger(result.port) && result.port > 0) {
        setActiveStudioPort(result.port);
      }
      setStatus("ready");
      setStartupStage("loading-frame");
      setDetail(t("video.ready_on_port", { port: result.port ?? studioPort }));
      setStudioFrameLoaded(false);
      setRevision((value) => value + 1);
    }).catch((cause) => {
      if (disposed) return;
      window.clearTimeout(waitingTimer);
      setStatus("failed");
      setDetail(cause instanceof Error ? cause.message : t("video.could_not_start"));
    });

    return () => {
      disposed = true;
      window.clearTimeout(waitingTimer);
      if (studioReadyFallbackRef.current != null) {
        window.clearTimeout(studioReadyFallbackRef.current);
        studioReadyFallbackRef.current = null;
      }
      void stopHyperframes(sessionId, { keepWarm: keepStudioWarmOnCloseRef.current });
    };
  }, [isRemoteWorkspace, projectDirectory, sessionId, startAttempt, studioPort, workspaceRoot]);

  React.useEffect(() => {
    window.addEventListener(localeChangedEvent, scheduleStudioLocaleSync);
    scheduleStudioLocaleSync();
    return () => {
      window.removeEventListener(localeChangedEvent, scheduleStudioLocaleSync);
    };
  }, [scheduleStudioLocaleSync]);

  React.useEffect(() => {
    syncStudioTheme();
  }, [resolvedTheme, syncStudioTheme]);

  const toggleFullscreen = React.useCallback(() => {
    onExpandedChange?.(!expanded);
  }, [expanded, onExpandedChange]);

  const reloadStudio = React.useCallback(() => {
    if (studioReadyFallbackRef.current != null) {
      window.clearTimeout(studioReadyFallbackRef.current);
      studioReadyFallbackRef.current = null;
    }
    setStudioFrameLoaded(false);
    studioChromeReadyRef.current = false;
    setStudioChromeReady(false);
    setStartupStage("loading-frame");
    setDetail(t("video.reloading"));
    setRevision((value) => value + 1);
  }, []);

  React.useEffect(() => {
    if (!expanded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onExpandedChange?.(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expanded, onExpandedChange]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="video-panel" data-expanded={expanded ? "true" : "false"}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 [border-bottom-width:0.5px] mac:titlebar-drag">
        <Film className="size-4 text-primary" />
        <div className="flex min-w-0 flex-1 items-center">
          <p className="truncate text-sm font-medium">{t("video.title")}</p>
          <span className="ml-2 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {status === "failed" ? t("video.status_failed") : status === "ready" && studioChromeReady ? t("video.status_ready") : startupStage === "waiting-for-studio" ? t("video.status_waiting") : t("video.status_starting")}
          </span>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={reloadStudio} aria-label={t("video.reload")}><RefreshCw /></Button>
        <Button
          variant={expanded ? "secondary" : "ghost"}
          size="icon-xs"
          onClick={toggleFullscreen}
          aria-label={t("video.toggle_fullscreen")}
          aria-pressed={expanded}
        >
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
        {onSaveAsTemplate ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={t("template_authoring.more_actions")}><Ellipsis /></Button>} />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onSaveAsTemplate}><LayoutTemplate />{t("template_authoring.save_as_template")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {launcherItems.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={(
                <Button variant="ghost" size="icon-xs" aria-label={t("session.right_panel_add")}>
                  <Plus />
                </Button>
              )}
            />
            <DropdownMenuContent
              align="end"
              className="w-[296px] rounded-[18px] border border-border bg-popover p-3 text-popover-foreground shadow-[0_8px_24px_rgba(0,0,0,0.10)] before:hidden"
            >
              {launcherItems.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  disabled={item.disabled}
                  onClick={item.onClick}
                  className={cn(
                    "h-9 rounded-xl px-2 text-[14px] font-normal tracking-[-0.56px] text-foreground focus:bg-muted focus:text-foreground data-disabled:opacity-40",
                    item.active && "bg-muted",
                  )}
                >
                  <img src={item.iconSrc} alt="" className="size-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut ? (
                    <span className="text-[12px] tracking-[-0.24px] text-muted-foreground">{item.shortcut}</span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Button variant="ghost" size="icon-xs" onClick={() => { keepStudioWarmOnCloseRef.current = true; onExpandedChange?.(false); onClose(); }} aria-label={t("video.close")} title={t("video.close")}><X /></Button>
      </header>

      {isRemoteWorkspace ? (
        <div className="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">{t("video.local_only")}</div>
      ) : (
        <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[#0c0c0d]">
          <div className="relative min-w-0 flex-1">
          {status === "starting" || (status === "ready" && !studioChromeReady) ? (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-background/80 backdrop-blur-sm" aria-live="polite">
              <div className="text-center">
                <Loader2 className="mx-auto mb-2 size-5 animate-spin text-primary" />
                <p className="text-xs font-medium text-foreground">{t(studioStartupTitleKey[startupStage])}</p>
                <p className="mt-1 text-[10px] font-medium text-primary">{startupStage === "starting-service" ? "1 / 3" : startupStage === "waiting-for-studio" ? "2 / 3" : "3 / 3"}</p>
                <p className="mt-1 max-w-[32rem] text-[11px] text-muted-foreground">{detail || t(studioStartupDetailKey[startupStage])}</p>
              </div>
            </div>
          ) : null}
          {status === "failed" ? <div className="absolute inset-0 z-20 grid place-items-center bg-background p-6"><div className="max-w-md text-center"><p className="text-sm font-medium">{t("video.failed_to_start")}</p><p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{detail}</p><Button className="mt-4" variant="secondary" size="sm" onClick={() => { setStatus("starting"); setStartupStage("starting-service"); setDetail(t("video.starting_hyperframes", { version: HYPERFRAMES_STUDIO_LABEL })); setStudioFrameLoaded(false); studioChromeReadyRef.current = false; setStudioChromeReady(false); setStartAttempt((value) => value + 1); }}>{t("common.retry")}</Button></div></div> : null}
          {status === "ready" ? <iframe ref={studioFrameRef} key={`${sessionId}:${revision}`} src={studioUrl} title={t("video.iframe_title")} allow="fullscreen" allowFullScreen className={`h-full w-full border-0 transition-opacity duration-150 ${studioChromeReady ? "opacity-100" : "opacity-0"}`} data-loaded={studioFrameLoaded ? "true" : "false"} onLoad={() => {
            setStudioFrameLoaded(true);
            if (studioChromeReadyRef.current) return;
            if (studioReadyFallbackRef.current != null) window.clearTimeout(studioReadyFallbackRef.current);
            studioReadyFallbackRef.current = window.setTimeout(() => {
              studioReadyFallbackRef.current = null;
              studioChromeReadyRef.current = true;
              setStudioChromeReady(true);
              scheduleStudioLocaleSync();
              syncStudioTheme();
            }, 8_000);
          }} onError={() => {
            setStatus("failed");
            setDetail(t("video.could_not_load", { url: studioUrl }));
          }} /> : null}
          {voicePanelOpen ? <VideoVoicePanel
            sessionId={sessionId}
            workspaceRoot={workspaceRoot}
            client={client}
            workspaceId={workspaceId}
            previewRequest={0}
            onClose={() => setVoicePanelOpen(false)}
            embedded
          /> : null}
          {designSystemOpen ? <div className="absolute bottom-0 right-0 top-[82px] z-20 flex w-[400px] max-w-[calc(100%-2rem)] overflow-hidden border-l border-border bg-background" data-testid="video-style-tab-content">
            <DesignSystemDrawer
              embedded
              open
              templateName="Video Studio"
              currentThemeId={appliedDesignSystemId}
              initialValues={designTokenValues}
              onClose={() => setDesignSystemOpen(false)}
              onTokenChange={handleDesignTokenChange}
              onApplyDesignSystem={(theme) => void handleApplyDesignSystem(theme)}
            />
          </div> : null}
          </div>
        </div>
      )}
    </div>
  );
}
