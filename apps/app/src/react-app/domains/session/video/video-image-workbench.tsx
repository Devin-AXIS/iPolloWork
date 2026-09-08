/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  MAX_VIDEO_IMAGE_BYTES,
  VIDEO_IMAGE_APPLY,
  VIDEO_IMAGE_CANCEL,
  VIDEO_IMAGE_RESULT,
  parseVideoImageRequest,
  type VideoImageApply,
  type VideoImageRequest,
} from "@ipollowork/types/video-image-workbench";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import {
  WorkspaceAppFrame,
  type WorkspaceImageSave,
} from "@/react-app/plugin-ui/workspace-app-frame";
import {
  resolveInstalledPluginContributions,
  type PluginUiSurface,
} from "@/react-app/plugin-ui/plugin-ui-contributions";
import { videoProjectDirectory, videoProjectId } from "./video-project";

type Props = {
  client: iPolloWorkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  sessionId: string;
  studioUrl: string;
  studioFrameRef: RefObject<HTMLIFrameElement | null>;
};
type OpenImage = { request: VideoImageRequest; path: string; surface: PluginUiSurface | null };
type Acknowledgement = {
  actionId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: number;
};

// Keep Video Studio mounted behind this view so returning preserves its playhead.
export function VideoImageWorkbench({
  client,
  workspaceId,
  workspaceRoot,
  sessionId,
  studioUrl,
  studioFrameRef,
}: Props) {
  const [open, setOpen] = useState<OpenImage | null>(null);
  const [saved, setSaved] = useState<WorkspaceImageSave | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const current = useRef<OpenImage | null>(null);
  const ack = useRef<Acknowledgement | null>(null);
  const origin = new URL(studioUrl).origin;

  const close = useCallback(() => {
    const image = current.current;
    if (image)
      studioFrameRef.current?.contentWindow?.postMessage(
        { type: VIDEO_IMAGE_CANCEL, requestId: image.request.requestId },
        origin,
      );
    current.current = null;
    if (ack.current) {
      window.clearTimeout(ack.current.timer);
      ack.current.reject(new Error(t("video.image.session_changed")));
      ack.current = null;
    }
    setOpen(null);
    setSaved(null);
    setError(null);
    setNotice(null);
    setBusy(false);
  }, [origin, studioFrameRef]);

  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== studioFrameRef.current?.contentWindow || event.origin !== origin) return;
      const value = event.data;
      if (
        value &&
        typeof value === "object" &&
        "type" in value &&
        value.type === VIDEO_IMAGE_RESULT &&
        "requestId" in value &&
        value.requestId === current.current?.request.requestId &&
        "actionId" in value &&
        value.actionId === ack.current?.actionId &&
        "ok" in value
      ) {
        const pending = ack.current;
        if (!pending) return;
        window.clearTimeout(pending.timer);
        ack.current = null;
        if (value.ok === true) pending.resolve();
        else
          pending.reject(
            new Error(
              "message" in value && typeof value.message === "string"
                ? value.message
                : t("video.image.update_failed"),
            ),
          );
        return;
      }
      const request = parseVideoImageRequest(value);
      if (!request || request.projectId !== videoProjectId(sessionId) || current.current) return;
      const image: OpenImage = {
        request,
        path: `${videoProjectDirectory(sessionId)}/${request.sourcePath}`,
        surface: null,
      };
      current.current = image;
      setOpen(image);
      setError(null);
      setSaved(null);
      setNotice(null);
      void client
        .listPluginPackages(workspaceId)
        .then(({ items }) => {
          if (current.current !== image) return;
          const surface = resolveInstalledPluginContributions(items).workspaceApps.find(
            (item) => item.pluginId === "image-studio",
          );
          if (!surface) throw new Error(t("artifact.image_studio_install_required"));
          const ready = { ...image, surface };
          current.current = ready;
          setOpen(ready);
        })
        .catch((reason: unknown) => {
          if (current.current === image)
            setError(reason instanceof Error ? reason.message : t("video.image.open_failed"));
        });
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      close();
    };
  }, [client, workspaceId, sessionId, studioFrameRef, origin, close]);

  const apply = useCallback(
    async (save: WorkspaceImageSave) => {
      const image = current.current;
      if (!image || ack.current) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const action: VideoImageApply = {
          type: VIDEO_IMAGE_APPLY,
          requestId: image.request.requestId,
          actionId: crypto.randomUUID(),
          mode: save.saveMode,
        };
        if (save.saveMode === "copy") {
          const file = await client.downloadWorkspaceFile(workspaceId, save.path);
          if (file.data.byteLength > MAX_VIDEO_IMAGE_BYTES)
            throw new Error(t("video.image.too_large"));
          const hash = Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", file.data)),
            (byte) => byte.toString(16).padStart(2, "0"),
          ).join("");
          if (hash !== save.revision) throw new Error(t("video.image.copy_changed"));
          action.image = { bytes: file.data, name: save.path.split("/").pop() ?? "edited.png" };
        }
        if (current.current !== image) return;
        await new Promise<void>((resolve, reject) => {
          ack.current = {
            actionId: action.actionId,
            resolve,
            reject,
            timer: window.setTimeout(() => {
              ack.current = null;
              reject(new Error(t("video.image.update_timeout")));
            }, 60_000),
          };
          studioFrameRef.current?.contentWindow?.postMessage(action, origin);
        });
        if (current.current !== image) return;
        setNotice(
          t(
            save.saveMode === "copy" ? "video.image.copy_applied" : "video.image.overwrite_applied",
          ),
        );
        if (save.saveMode === "copy") {
          close();
          toast.success(t("video.image.copy_applied"));
        }
      } catch (reason) {
        if (current.current === image)
          setError(reason instanceof Error ? reason.message : t("video.image.update_failed"));
      } finally {
        if (current.current === image) setBusy(false);
      }
    },
    [client, workspaceId, origin, studioFrameRef, close],
  );

  const onImageSaved = useCallback(
    (save: WorkspaceImageSave) => {
      const image = current.current;
      if (!image || (save.originalPath !== image.path && save.originalPath !== saved?.path)) return;
      const next: WorkspaceImageSave = {
        ...save,
        saveMode: save.path === image.path ? "overwrite" : "copy",
      };
      setSaved(next);
      setNotice(null);
      setError(null);
      if (next.saveMode === "overwrite") void apply(next);
    },
    [apply, saved?.path],
  );

  if (!open) return null;
  return (
    <section
      className="absolute inset-0 z-30 flex min-h-0 min-w-0 flex-col bg-background text-foreground"
      data-testid="video-image-workbench"
      aria-label={t("video.image.title")}
    >
      <header className="flex flex-wrap items-center gap-2 border-b p-2">
        <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
          <ArrowLeft className="size-4" />
          {t("video.image.back")}
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={open.path}>
          {open.request.sourcePath}
        </span>
        {saved ? (
          <Button size="sm" disabled={busy} onClick={() => void apply(saved)}>
            {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
            {t(saved.saveMode === "copy" ? "video.image.replace_selected" : "video.image.refresh")}
          </Button>
        ) : null}
      </header>
      <div className="border-b px-3 py-2 text-xs text-muted-foreground" role="status">
        {notice ?? t("video.image.save_hint")}
      </div>
      {error ? (
        <div className="border-b px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      ) : null}
      {open.surface ? (
        <WorkspaceAppFrame
          key={open.request.requestId}
          className="min-h-0 flex-1"
          surface={open.surface}
          client={client}
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          sessionId={sessionId}
          placement="workspace"
          launch={{
            intent: "edit-image",
            source: {
              kind: "workspace-file",
              path: open.path,
              name: open.request.sourcePath.split("/").pop() ?? "image",
              preview: "image",
            },
          }}
          onImageSaved={onImageSaved}
        />
      ) : !error ? (
        <div className="grid flex-1 place-items-center" role="status">
          <span className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            {t("video.image.loading")}
          </span>
        </div>
      ) : null}
    </section>
  );
}
