import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  buildDomEditPatchTarget,
  findElementForSelection,
  type DomEditSelection,
} from "../components/editor/domEditing";
import { resolveAvatarLowLayer } from "../components/editor/canvasContextMenuZOrder";
import { startBackgroundRemoval, waitForMediaJob } from "../components/studioMediaJobs";
import {
  applyAvatarCutout,
  applyAvatarBackgroundRemoval,
  avatarCutoutOutputPath,
  removeAvatarCutout,
  restoreAvatarBackground,
  projectMediaPath,
  relativeMediaPath,
  type AvatarCutoutMode,
} from "../utils/avatarCutout";
import {
  readProjectFileContent,
  saveProjectFilesWithHistory,
  type DomEditCommitBaseParams,
} from "../utils/studioFileHistory";

interface Params extends DomEditCommitBaseParams {
  projectId: string | null;
  previewIframeRef: MutableRefObject<HTMLIFrameElement | null>;
  queueDomEditSave: <T>(save: () => Promise<T>) => Promise<T>;
  forceReloadSdkSession?: () => void;
  refreshDomEditSelectionFromPreview: (selection: DomEditSelection) => Promise<void>;
}

const AVATAR_PREVIEW_READY_TIMEOUT_MS = 10_000;
const AVATAR_PREVIEW_READY_POLL_MS = 50;
const MEDIA_HAVE_CURRENT_DATA = 2;
type AvatarSelectionLocator = Pick<
  DomEditSelection,
  "id" | "hfId" | "selector" | "selectorIndex"
> & { sourceFile?: string };

function isVideoElement(element: Element | null): element is HTMLVideoElement {
  return element?.tagName.toLowerCase() === "video";
}

function isRefreshedAvatarPreviewReady({
  iframe,
  previousIframe,
  selection,
  activeCompPath,
  removing,
  mode = "smart",
}: {
  iframe: HTMLIFrameElement | null;
  previousIframe: HTMLIFrameElement | null;
  selection: AvatarSelectionLocator;
  activeCompPath: string | null;
  removing: boolean;
  mode?: AvatarCutoutMode;
}): boolean {
  if (!iframe || iframe === previousIframe) return false;
  try {
    const doc = iframe.contentDocument;
    if (!doc || doc.readyState !== "complete") return false;
    const source = findElementForSelection(doc, selection, activeCompPath);
    if (!source) return false;
    if (mode === "remove-background")
      return source.hasAttribute("data-avatar-original-src") !== removing &&
        isVideoElement(source) && !source.error && source.readyState >= MEDIA_HAVE_CURRENT_DATA;
    const foregroundId = source.getAttribute("data-avatar-cutout");
    if (removing) return !foregroundId;
    if (!foregroundId) return false;
    const foreground = doc.getElementById(foregroundId);
    return (
      isVideoElement(foreground) &&
      !foreground.error &&
      foreground.readyState >= MEDIA_HAVE_CURRENT_DATA
    );
  } catch {
    return false;
  }
}

export function waitForAvatarPreviewReady({
  previewIframeRef,
  previousIframe,
  selection,
  activeCompPath,
  removing,
  mode = "smart",
  signal,
  timeoutMs = AVATAR_PREVIEW_READY_TIMEOUT_MS,
}: {
  previewIframeRef: MutableRefObject<HTMLIFrameElement | null>;
  previousIframe: HTMLIFrameElement | null;
  selection: AvatarSelectionLocator;
  activeCompPath: string | null;
  removing: boolean;
  mode?: AvatarCutoutMode;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (error?: Error) => {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", handleAbort);
      if (error) reject(error);
      else resolve();
    };
    const handleAbort = () => finish(new DOMException("操作已取消", "AbortError"));
    const check = () => {
      if (signal.aborted) {
        handleAbort();
        return;
      }
      if (
        isRefreshedAvatarPreviewReady({
          iframe: previewIframeRef.current,
          previousIframe,
          selection,
          activeCompPath,
          removing,
          mode,
        })
      ) {
        finish();
        return;
      }
      if (performance.now() - startedAt >= timeoutMs) {
        finish(new Error("抠图已保存，但最终预览加载超时，请重新打开视频后查看"));
        return;
      }
      timer = setTimeout(check, AVATAR_PREVIEW_READY_POLL_MS);
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    check();
  });
}

export function useAvatarCutout(params: Params) {
  const [avatarCutoutProgress, setProgress] = useState<number | null>(null);
  const running = useRef<AbortController | null>(null);
  useEffect(() => {
    setProgress(null);
    return () => {
      running.current?.abort();
      running.current = null;
    };
  }, [params.projectId]);

  const handleAvatarCutout = useCallback(
    async (selection: DomEditSelection, mode: AvatarCutoutMode = "smart") => {
      const pid = params.projectIdRef.current;
      if (!pid || running.current || selection.tagName !== "video") return;
      const controller = new AbortController();
      running.current = controller;
      const target = buildDomEditPatchTarget(selection);
      const file = selection.sourceFile || params.activeCompPath || "index.html";
      const src = selection.element.getAttribute("src") || "";
      const removing = selection.element.hasAttribute(
        mode === "smart" ? "data-avatar-cutout" : "data-avatar-original-src",
      );
      const previousIframe = params.previewIframeRef.current;
      setProgress(0);
      try {
        let output = "";
        if (!removing) {
          const inputPath = projectMediaPath(file, src);
          const foregroundId = selection.element.getAttribute("data-avatar-cutout");
          const foregroundSrc = mode === "remove-background" && foregroundId
            ? selection.element.ownerDocument.getElementById(foregroundId)?.getAttribute("src")
            : null;
          const jobId = await startBackgroundRemoval(
            pid,
            inputPath,
            {
              outputPath: avatarCutoutOutputPath(inputPath, mode),
              ...(foregroundSrc ? { foregroundPath: projectMediaPath(file, foregroundSrc) } : {}),
            },
            controller.signal,
          );
          const result = await waitForMediaJob(
            jobId,
            (progress) => setProgress(progress.progress),
            controller.signal,
          );
          output = relativeMediaPath(file, result.outputPath);
        }
        if (controller.signal.aborted || params.projectIdRef.current !== pid) return;
        await params.queueDomEditSave(async () => {
          if (controller.signal.aborted || params.projectIdRef.current !== pid) return;
          const before = await readProjectFileContent(pid, file);
          const doc = params.previewIframeRef.current?.contentDocument;
          const element =
            !removing && mode === "smart" && doc && findElementForSelection(doc, selection, params.activeCompPath);
          if (!removing && mode === "smart" && !element) throw new Error("数字人已移除或预览已切换，请重新选择后重试");
          const layers = element
            ? resolveAvatarLowLayer(element).map((patch) => ({
                target:
                  patch.element === element
                    ? target
                    : {
                        id: patch.element.id,
                        hfId: patch.element.getAttribute("data-hf-id") || undefined,
                      },
                zIndex: patch.zIndex,
              }))
            : [];
          const after = mode === "remove-background"
            ? removing ? restoreAvatarBackground(before, target)
              : applyAvatarBackgroundRemoval(before, target, src, output)
            : removing ? removeAvatarCutout(before, target)
              : applyAvatarCutout(before, target, src, output, layers);
          params.domEditSaveTimestampRef.current = Date.now();
          await saveProjectFilesWithHistory({
            projectId: pid,
            label: mode === "remove-background" ? removing ? "恢复背景" : "去背景"
              : removing ? "取消智能抠图" : "智能抠图",
            kind: "timeline",
            files: { [file]: after },
            readFile: async () => before,
            writeFile: params.writeProjectFile,
            recordEdit: params.editHistory.recordEdit,
          });
          params.forceReloadSdkSession?.();
          params.reloadPreview();
        });
        await waitForAvatarPreviewReady({
          previewIframeRef: params.previewIframeRef,
          previousIframe,
          selection,
          activeCompPath: params.activeCompPath,
          removing,
          mode,
          signal: controller.signal,
        });
        if (controller.signal.aborted || params.projectIdRef.current !== pid) return;
        await params.refreshDomEditSelectionFromPreview(selection);
        params.showToast(removing ? "已恢复原视频" : mode === "remove-background"
          ? "去背景完成，已保留原有配音和时间位置" : "智能抠图完成，人物主体已保护", "info");
      } catch (error) {
        if (!controller.signal.aborted)
          params.showToast(
            error instanceof Error ? error.message : "智能抠图失败，请重试",
            "error",
          );
      } finally {
        if (running.current === controller) {
          running.current = null;
          setProgress(null);
        }
      }
    },
    [params],
  );
  return { handleAvatarCutout, avatarCutoutProgress };
}
