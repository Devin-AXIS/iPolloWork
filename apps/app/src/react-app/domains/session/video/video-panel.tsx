/** @jsxImportSource react */
import * as React from "react";
import { Loader2 } from "lucide-react";

import type { HyperframesCatalogItem, iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { pickLocalImageFile, readLocalImageAsDataUrl } from "@/app/lib/desktop";
import { getResolvedThemeMode, subscribeToTheme } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { currentLocale, localeChangedEvent, t } from "@/i18n";
import type { DesignAiSelectionContext } from "@ipollowork/design-studio";
import {
  IPOLLOWORK_VIDEO_STUDIO_FEATURES,
  type VideoStudioBranding,
  type VideoStudioClient,
  type VideoStudioFeatures,
  type VideoStudioRuntime,
} from "@ipollowork/video-studio";
import { DesignSystemDrawer } from "../design/design-system-drawer";
import { mergeTemplateTokenCss, parseDesignTokenValues, refreshTemplateTokenCss, replaceDesignTokenValue, type DesignTokenValues } from "../design/design-system-files";
import { buildStableTokenBridgeCss, buildTemplateTokenCss, getDesignSystemTheme, type DesignSystemTheme } from "../design/design-system-registry";
import { ensureHtmlDesignSystemContract, readAppliedDesignSystemId } from "../design/design-system-theme-contract";
import {
  HYPERFRAMES_STUDIO_LABEL,
  hyperframesStudioPort,
  hyperframesStudioUrl,
  videoProjectDirectory,
  videoProjectId,
} from "./video-project";
import { resolveVideoAiSelectionTarget } from "./video-ai-selection";
import { VideoTemplateDialog } from "./video-template-dialog";
import { VideoVoicePanel } from "./video-voice-panel";

export {
  hyperframesStudioPort,
  hyperframesStudioUrl,
  videoProjectDirectory,
  videoProjectId,
} from "./video-project";

type VideoPanelProps = {
  title: string;
  sessionId: string;
  workspaceRoot: string;
  client: VideoStudioClient | null;
  workspaceId: string | null;
  runtime?: VideoStudioRuntime;
  features?: VideoStudioFeatures;
  branding?: VideoStudioBranding;
  isRemoteWorkspace?: boolean;
  aiEditing?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onAskAi?: (context: DesignAiSelectionContext) => void;
  onSaveAsTemplate?: () => void;
};

type StudioStartupStage = "starting-service" | "waiting-for-studio" | "loading-frame";
type StudioHostPanel = "voice" | "style" | null;

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

const DEFAULT_STUDIO_PANEL_WIDTH = 400;
const MIN_STUDIO_PANEL_WIDTH = 160;
const MAX_STUDIO_PANEL_WIDTH = 600;
const RUNTIME_THEME_BRIDGE_PATTERN = /\/\*\s*ipw-runtime-theme-bridge:start\s*\*\/[\s\S]*?\/\*\s*ipw-runtime-theme-bridge:end\s*\*\//i;

function ensureVideoTokenBridge(source: string) {
  const bridge = buildStableTokenBridgeCss();
  if (RUNTIME_THEME_BRIDGE_PATTERN.test(source)) return source.replace(RUNTIME_THEME_BRIDGE_PATTERN, bridge);
  return `${source.trimEnd()}${source.trim() ? "\n\n" : ""}${bridge}\n`;
}

function normalizeVideoThemeTypeScale(source: string) {
  return replaceDesignTokenValue(source, "--ipw-type-scale", "1");
}

function isIPolloWorkServerClient(client: VideoStudioClient | null): client is iPolloWorkServerClient {
  return Boolean(client && "createVoiceRealtimeSession" in client);
}

export function VideoPanel({ title, sessionId, workspaceRoot, client, workspaceId, runtime, features = IPOLLOWORK_VIDEO_STUDIO_FEATURES, branding, isRemoteWorkspace = false, aiEditing = false, expanded = false, onExpandedChange, onAskAi, onSaveAsTemplate }: VideoPanelProps) {
  const studioFrameRef = React.useRef<HTMLIFrameElement | null>(null);
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
  const [studioHostPanel, setStudioHostPanel] = React.useState<StudioHostPanel>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = React.useState(false);
  const [studioPanelWidth, setStudioPanelWidth] = React.useState(DEFAULT_STUDIO_PANEL_WIDTH);
  const [designTokenSource, setDesignTokenSource] = React.useState("");
  const designTokenSourceRef = React.useRef("");
  const designTokenLoadRequestRef = React.useRef(0);
  const designTokenLoadedRef = React.useRef(false);
  const pendingDesignTokenChangesRef = React.useRef<DesignTokenValues>({});
  const pendingStudioDesignTokensRef = React.useRef<{ tokens: Record<string, string>; cssSource?: string } | null>(null);
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
    revision,
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
  const appliedDesignSystemTheme = React.useMemo(
    () => (appliedDesignSystemId ? getDesignSystemTheme(appliedDesignSystemId) : undefined),
    [appliedDesignSystemId],
  );
  const showStudioStartupOverlay = status === "starting" || (status === "ready" && !studioChromeReady);
  const studioRuntime = runtime ?? window.__IPOLLOWORK_ELECTRON__?.hyperframes;
  const templatesAvailable = Boolean(
    features.templates
    && client?.listVideoStudioTemplates
    && client.getVideoStudioTemplateCover
    && client.applyVideoStudioTemplate,
  );

  const syncStudioDesignTokens = React.useCallback((tokens: Record<string, string>, cssSource?: string) => {
    pendingStudioDesignTokensRef.current = { tokens, cssSource };
    const frameWindow = studioFrameRef.current?.contentWindow;
    if (!frameWindow || Object.keys(tokens).length === 0) return;
    frameWindow.postMessage(
      {
        type: "ipollowork:studio-design-token-change",
        projectId: videoProjectId(sessionId),
        tokens,
        cssSource,
      },
      new URL(studioUrl).origin,
    );
  }, [sessionId, studioUrl]);

  const replayPendingStudioDesignTokens = React.useCallback(() => {
    const pending = pendingStudioDesignTokensRef.current;
    if (pending) syncStudioDesignTokens(pending.tokens, pending.cssSource);
  }, [syncStudioDesignTokens]);

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

  const loadDesignSystemFiles = React.useCallback(async () => {
    if (!client || !workspaceId) return;
    const requestId = ++designTokenLoadRequestRef.current;
    designTokenLoadedRef.current = false;
    const tokens = await client.readWorkspaceFile(workspaceId, designTokenPath).catch(() => null);
    if (requestId !== designTokenLoadRequestRef.current) return;
    const source = tokens?.content ?? "";
    const pendingChanges = pendingDesignTokenChangesRef.current;
    const hasPendingChanges = Object.keys(pendingChanges).length > 0;
    let nextSource = source;
    if (hasPendingChanges) {
      const themeId = readAppliedDesignSystemId(source);
      const theme = themeId ? getDesignSystemTheme(themeId) : undefined;
      nextSource = theme
        ? refreshTemplateTokenCss(source, buildTemplateTokenCss(theme))
        : ensureVideoTokenBridge(source);
      for (const [name, value] of Object.entries(pendingChanges)) {
        nextSource = replaceDesignTokenValue(nextSource, name, value);
      }
      pendingDesignTokenChangesRef.current = {};
    }
    designTokenSourceRef.current = nextSource;
    designTokenLoadedRef.current = true;
    setDesignTokenSource(nextSource);
    const themeId = readAppliedDesignSystemId(source);
    const previewCss = themeId && getDesignSystemTheme(themeId) ? nextSource : ensureVideoTokenBridge(nextSource);
    syncStudioDesignTokens(parseDesignTokenValues(nextSource), previewCss);
    if (hasPendingChanges) saveDesignTokenSource(nextSource);
  }, [client, designTokenPath, saveDesignTokenSource, syncStudioDesignTokens, workspaceId]);

  React.useEffect(() => {
    if (studioHostPanel !== "style") return;
    void loadDesignSystemFiles();
  }, [loadDesignSystemFiles, studioHostPanel]);

  React.useEffect(() => {
    const handlePanelRequest = (event: MessageEvent) => {
      if (event.source !== studioFrameRef.current?.contentWindow) return;
      if (event.origin !== new URL(studioUrl).origin) return;
      if (event.data?.type !== "ipollowork:video-studio-panel") return;
      if (event.data.projectId !== videoProjectId(sessionId)) return;
      if (typeof event.data.width === "number" && Number.isFinite(event.data.width)) {
        setStudioPanelWidth(Math.max(MIN_STUDIO_PANEL_WIDTH, Math.min(MAX_STUDIO_PANEL_WIDTH, event.data.width)));
      }
      if (event.data.panel === "voice") {
        if (features.voice) setStudioHostPanel("voice");
      } else if (event.data.panel === "style") {
        if (features.designSystem) setStudioHostPanel("style");
      } else if (event.data.panel === null) {
        setStudioHostPanel(null);
      }
    };
    window.addEventListener("message", handlePanelRequest);
    return () => window.removeEventListener("message", handlePanelRequest);
  }, [features.designSystem, features.voice, sessionId, studioUrl]);

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

  const handleDesignTokenChanges = React.useCallback((values: DesignTokenValues) => {
    if (!designTokenLoadedRef.current) {
      pendingDesignTokenChangesRef.current = {
        ...pendingDesignTokenChangesRef.current,
        ...values,
      };
    }
    let next = appliedDesignSystemTheme
      ? refreshTemplateTokenCss(designTokenSourceRef.current, buildTemplateTokenCss(appliedDesignSystemTheme))
      : ensureVideoTokenBridge(designTokenSourceRef.current);
    for (const [name, value] of Object.entries(values)) {
      next = replaceDesignTokenValue(next, name, value);
    }
    designTokenSourceRef.current = next;
    setDesignTokenSource(next);
    syncStudioDesignTokens(values, next);
    saveDesignTokenSource(next);
  }, [appliedDesignSystemTheme, saveDesignTokenSource, syncStudioDesignTokens]);

  const handleDesignTokenChange = React.useCallback((name: string, value: string) => {
    handleDesignTokenChanges({ [name]: value });
  }, [handleDesignTokenChanges]);

  const chooseDesignSystemBackgroundImage = React.useCallback(async () => {
    const pickedPath = await pickLocalImageFile("选择视频背景图片");
    if (!pickedPath) return;
    const dataUrl = await readLocalImageAsDataUrl(pickedPath);
    if (!dataUrl) {
      toast.error("无法读取图片，请选择 PNG、JPG 或 WebP 文件。");
      return;
    }
    handleDesignTokenChanges({
      "--ipw-bg-image": `url("${dataUrl}")`,
      "--ipw-bg-color": "var(--ipw-color-bg)",
      "--ipw-bg-decoration-opacity": "1",
      "--ipw-bg-gradient": "none",
      "--ipw-bg-overlay": "linear-gradient(rgba(28,27,26,.45), rgba(28,27,26,.45))",
      "--ipw-bg-overlay-opacity": "0.45",
      "--ipw-bg-mode": "image",
      "--ipw-bg-size": "cover",
      "--ipw-bg-position": "50% 50%",
    });
    toast.success("背景图片已应用。");
  }, [handleDesignTokenChanges]);

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
      const nextTokens = normalizeVideoThemeTypeScale(
        mergeTemplateTokenCss(currentTokenCss, buildTemplateTokenCss(theme)),
      );
      if (themedHtml === current.content && nextTokens === currentTokenCss) {
        if (hadPendingTokenSave) saveDesignTokenSource(currentTokenCss);
        toast.info(`${theme.name} is already applied to Video Studio.`);
        return;
      }
      syncStudioDesignTokens(parseDesignTokenValues(nextTokens), nextTokens);
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
  }, [client, compositionPath, designTokenPath, recordStudioHostEdit, saveDesignTokenSource, studioHistoryReady, syncStudioDesignTokens, workspaceId]);

  React.useEffect(() => {
    if (studioHostPanel !== "style") return;
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
  }, [sessionId, studioHostPanel, studioUrl]);

  const syncStudioLocale = React.useCallback(() => {
    const frameWindow = studioFrameRef.current?.contentWindow;
    if (!frameWindow) return;
    const targetOrigin = new URL(studioUrl).origin;
    frameWindow.postMessage(
      { type: "ipollowork:studio-locale", locale: currentLocale() },
      targetOrigin,
    );
  }, [studioUrl]);

  const syncStudioHostContext = React.useCallback(() => {
    const frameWindow = studioFrameRef.current?.contentWindow;
    if (!frameWindow) return;
    frameWindow.postMessage(
      {
        type: "ipollowork:studio-host-context",
        projectId: videoProjectId(sessionId),
        title,
        branding: branding ? {
          title: branding.title,
          byline: branding.byline,
          bylineUrl: branding.bylineUrl,
          repositoryUrl: branding.repositoryUrl,
        } : null,
        actions: {
          reload: true,
          saveAsTemplate: Boolean(onSaveAsTemplate),
          openTemplates: templatesAvailable,
          askAi: Boolean(branding?.onAskAi),
        },
      },
      new URL(studioUrl).origin,
    );
  }, [branding, onSaveAsTemplate, sessionId, studioUrl, templatesAvailable, title]);

  React.useEffect(() => {
    if (!studioFrameLoaded) return;
    syncStudioHostContext();
  }, [studioFrameLoaded, syncStudioHostContext]);

  const syncStudioTheme = React.useCallback(() => {
    const frameWindow = studioFrameRef.current?.contentWindow;
    if (!frameWindow) return;
    frameWindow.postMessage(
      { type: "ipollowork:studio-theme", theme: getResolvedThemeMode() },
      new URL(studioUrl).origin,
    );
  }, [studioUrl]);

  const syncStudioAiEditing = React.useCallback(() => {
    const frameWindow = studioFrameRef.current?.contentWindow;
    if (!frameWindow) return;
    frameWindow.postMessage(
      {
        type: "ipollowork:studio-ai-editing",
        projectId: videoProjectId(sessionId),
        active: aiEditing,
      },
      new URL(studioUrl).origin,
    );
  }, [aiEditing, sessionId, studioUrl]);

  React.useEffect(() => {
    if (!studioFrameLoaded) return;
    syncStudioAiEditing();
  }, [studioFrameLoaded, syncStudioAiEditing]);

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
        const semanticContext = typeof event.data.semanticContext === "string"
          ? event.data.semanticContext.slice(0, 20_000)
          : undefined;
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
            semanticContext,
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
      syncStudioHostContext();
      syncStudioTheme();
      syncStudioAiEditing();
      replayPendingStudioDesignTokens();
    };
    window.addEventListener("message", handleStudioReady);
    return () => window.removeEventListener("message", handleStudioReady);
  }, [activeStudioPort, replayPendingStudioDesignTokens, scheduleStudioLocaleSync, sessionId, studioUrl, syncStudioAiEditing, syncStudioHostContext, syncStudioTheme]);

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
    if (!studioRuntime?.start || !studioRuntime.stop) {
      setStatus("failed");
      setDetail(t("video.requires_desktop"));
      return;
    }
    const startHyperframes = studioRuntime.start;
    const stopHyperframes = studioRuntime.stop;

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
      void stopHyperframes(sessionId, { keepWarm: false });
    };
  }, [isRemoteWorkspace, projectDirectory, sessionId, startAttempt, studioPort, studioRuntime, workspaceRoot]);

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
    setStudioHostPanel(null);
    setRevision((value) => value + 1);
  }, []);

  React.useEffect(() => {
    const handleStudioHostAction = (event: MessageEvent) => {
      if (event.source !== studioFrameRef.current?.contentWindow) return;
      if (event.origin !== new URL(studioUrl).origin) return;
      if (event.data?.type !== "ipollowork:studio-host-action") return;
      if (event.data.projectId !== videoProjectId(sessionId)) return;
      if (event.data.action === "reload") {
        reloadStudio();
        return;
      }
      if (event.data.action === "save-as-template") onSaveAsTemplate?.();
      if (event.data.action === "open-templates" && templatesAvailable) setTemplateDialogOpen(true);
      if (event.data.action === "ask-ai") branding?.onAskAi();
    };
    window.addEventListener("message", handleStudioHostAction);
    return () => window.removeEventListener("message", handleStudioHostAction);
  }, [branding, onSaveAsTemplate, reloadStudio, sessionId, studioUrl, templatesAvailable]);

  React.useEffect(() => {
    setStudioHostPanel(null);
  }, [revision]);

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
      {isRemoteWorkspace ? (
        <div className="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">{t("video.local_only")}</div>
      ) : (
        <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[#0c0c0d]">
          <div className="relative min-w-0 flex-1">
          {showStudioStartupOverlay ? (
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
          {status === "ready" ? <iframe ref={studioFrameRef} key={`${sessionId}:${revision}`} src={studioUrl} title={t("video.iframe_title")} allow="fullscreen" allowFullScreen className="h-full w-full border-0" data-loading-covered={showStudioStartupOverlay ? "true" : "false"} data-loaded={studioFrameLoaded ? "true" : "false"} onLoad={() => {
            setStudioFrameLoaded(true);
            if (studioChromeReadyRef.current) return;
            if (studioReadyFallbackRef.current != null) window.clearTimeout(studioReadyFallbackRef.current);
            studioReadyFallbackRef.current = window.setTimeout(() => {
              studioReadyFallbackRef.current = null;
              studioChromeReadyRef.current = true;
              setStudioChromeReady(true);
              scheduleStudioLocaleSync();
              syncStudioHostContext();
              syncStudioTheme();
              syncStudioAiEditing();
              replayPendingStudioDesignTokens();
            }, 8_000);
          }} onError={() => {
            setStatus("failed");
            setDetail(t("video.could_not_load", { url: studioUrl }));
          }} /> : null}
          {features.voice && studioHostPanel === "voice" && isIPolloWorkServerClient(client) ? <VideoVoicePanel
            sessionId={sessionId}
            workspaceRoot={workspaceRoot}
            client={client}
            workspaceId={workspaceId}
            previewRequest={0}
            onClose={() => setStudioHostPanel(null)}
            embeddedWidth={studioPanelWidth}
            embedded
          /> : null}
          {features.designSystem && studioHostPanel === "style" ? <div className="absolute bottom-0 right-0 top-[90px] z-20 flex min-w-0 max-w-full overflow-hidden border-l border-border bg-background" style={{ width: studioPanelWidth }} data-testid="video-style-tab-content">
            <DesignSystemDrawer
              embedded
              open
              templateName="Video Studio"
              currentThemeId={appliedDesignSystemId}
              initialValues={designTokenValues}
              onClose={() => setStudioHostPanel(null)}
              onTokenChange={handleDesignTokenChange}
              onTokenChangeMany={handleDesignTokenChanges}
              onApplyDesignSystem={(theme) => void handleApplyDesignSystem(theme)}
              onChooseBackgroundImage={() => void chooseDesignSystemBackgroundImage()}
            />
          </div> : null}
          </div>
          {features.templates && templatesAvailable && client && workspaceId ? (
            <VideoTemplateDialog
              open={templateDialogOpen}
              onOpenChange={setTemplateDialogOpen}
              client={client}
              workspaceId={workspaceId}
              sessionId={sessionId}
              copy={features.templates}
              onApplied={(nextRuntime) => {
                if (Number.isInteger(nextRuntime.port) && nextRuntime.port > 0) setActiveStudioPort(nextRuntime.port);
                reloadStudio();
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
