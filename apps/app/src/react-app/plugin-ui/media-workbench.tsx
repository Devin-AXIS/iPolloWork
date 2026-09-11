/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  mediaKindForPath,
  safeVideoMediaPath,
  type MediaKind,
} from "@ipollowork/types/video-image-workbench";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { IMAGE_STUDIO_EDIT_RESULT } from "@/app/types";
import {
  WorkspaceAppFrame,
  type WorkspaceImageSave,
  type WorkspaceImageEdit,
  type WorkspaceVideoResult,
} from "./workspace-app-frame";
import {
  resolveInstalledPluginContributions,
  type PluginUiSurface,
} from "./plugin-ui-contributions";

export type MediaWorkbenchSource = { requestId: string; path: string; kind: MediaKind };
export type MediaWorkbenchSave = {
  path: string;
  saveMode: "copy" | "overwrite";
  revision?: string;
};

// Both editors retain their canvas behind this surface; only the owning editor
// can update the frozen selection. No generation or replacement happens on open.
export function MediaWorkbench({
  source,
  client,
  workspaceId,
  workspaceRoot,
  sessionId,
  returnLabel,
  resultPath,
  replaced = false,
  onResult,
  visible = true,
  onActivate,
  onApply,
  onClose,
}: {
  source: MediaWorkbenchSource;
  client: iPolloWorkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  sessionId: string;
  returnLabel: string;
  resultPath?: string;
  replaced?: boolean;
  onResult?: (path: string) => void;
  visible?: boolean;
  onActivate?: () => void;
  onApply: (save: MediaWorkbenchSave) => Promise<void>;
  onClose: () => void;
}) {
  const [surface, setSurface] = useState<PluginUiSurface | null>(null);
  const [saved, setSaved] = useState<(MediaWorkbenchSave & { editId?: string }) | null>(null);
  const [previewPath, setPreviewPath] = useState(resultPath ?? source.path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef(true);
  const applying = useRef(false);
  const imagePath = useRef(source.path);
  const replaceVideoOnSave = useRef(false);
  useEffect(() => {
    if (!resultPath || resultPath === source.path) return;
    imagePath.current = resultPath;
    setPreviewPath(resultPath);
    setSaved(current => current?.path === resultPath ? current : {path:resultPath,saveMode:"copy"});
  }, [resultPath, source.path]);
  const pluginId = source.kind === "image" ? "image-studio" : "video-console";
  useEffect(() => {
    active.current = true;
    void client
      .listPluginPackages(workspaceId)
      .then(({ items }) => {
        if (!active.current) return;
        const found = resolveInstalledPluginContributions(items).workspaceApps.find(
          (item) => item.pluginId === pluginId,
        );
        if (!found) throw new Error(t("media.workbench.unavailable"));
        setSurface(found);
      })
      .catch((reason) => {
        if (active.current)
          setError(reason instanceof Error ? reason.message : t("media.workbench.unavailable"));
      });
    return () => {
      active.current = false;
    };
  }, [client, workspaceId, pluginId]);

  const apply = useCallback(
    async (save: MediaWorkbenchSave) => {
      if (applying.current) return;
      applying.current = true;
      setBusy(true);
      setError("");
      setNotice("");
      try {
        await onApply(save);
        if (!active.current) return;
        if (source.kind === "image" || save.saveMode === "copy") onClose();
        else setNotice(t("media.workbench.refreshed"));
      } catch (reason) {
        if (active.current)
          setError(reason instanceof Error ? reason.message : t("media.workbench.failed"));
      } finally {
        applying.current = false;
        if (active.current) setBusy(false);
      }
    },
    [onApply, onClose, source.kind],
  );
  const imageEdited = (result: WorkspaceImageEdit | null) => {
    if (!result) { setSaved(null); setNotice(""); return; }
    if (result.originalPath !== imagePath.current) return;
    if (!safeVideoMediaPath(result.path) || mediaKindForPath(result.path) !== "image" || result.path === source.path) return;
    imagePath.current = result.path;
    setPreviewPath(result.path);
    setSaved({ ...result, saveMode: "copy" });
    onResult?.(result.path);
    setNotice("");
    setError("");
  };
  useEffect(() => {
    const receive = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const value = event.detail;
      if (!value || value.workspaceId !== workspaceId || value.sessionId !== sessionId
        || value.requestId !== source.requestId || source.kind !== "image") return;
      if (value.phase === "pending") { setSaved(null); setNotice(""); return; }
      if (typeof value.path !== "string" || !safeVideoMediaPath(value.path)
        || mediaKindForPath(value.path) !== "image" || value.path === source.path) return;
      event.preventDefault();
      onResult?.(value.path);
      imagePath.current = value.path;
      setSaved({ path: value.path, saveMode: "copy" });
      setPreviewPath(value.path);
      onActivate?.();
      setNotice("");
      setError("");
    };
    window.addEventListener(IMAGE_STUDIO_EDIT_RESULT, receive);
    return () => window.removeEventListener(IMAGE_STUDIO_EDIT_RESULT, receive);
  }, [workspaceId, sessionId, source.requestId, source.path, source.kind, onActivate, onResult]);

  const finishImage = async (replace: boolean) => {
    if (!saved || applying.current) return;
    applying.current = true;
    setBusy(true);
    setError("");
    try {
      let copy: MediaWorkbenchSave = saved;
      if (saved.editId) {
        const response = await client.callExtensionAction({ extensionId: "image-studio", action: "save-edit",
          args: { editId: saved.editId, mode: "copy" },
          context: { directory: workspaceRoot, workspaceId, sessionId } });
        if (!response.ok) throw new Error(response.message);
        copy = { path: saved.path, saveMode: "copy", revision: saved.revision };
        if (active.current) setSaved(copy);
      }
      if (replace) {
        await onApply(copy);
        if (active.current) onClose();
      } else if (active.current) setNotice(t("media.workbench.copy_saved"));
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : t("media.workbench.failed"));
    } finally {
      applying.current = false;
      if (active.current) setBusy(false);
    }
  };
  const imageSaved = (result: WorkspaceImageSave) => {
    if (result.originalPath !== imagePath.current) return;
    if (!safeVideoMediaPath(result.path) || mediaKindForPath(result.path) !== source.kind) return;
    const next: MediaWorkbenchSave = {
      path: result.path,
      revision: result.revision,
      saveMode: result.path === source.path ? "overwrite" : "copy",
    };
    imagePath.current = next.path;
    setSaved(next);
    setError("");
    setNotice("");
    if (next.saveMode === "overwrite" && source.kind !== "image") void apply(next);
  };
  const videoResult = (result: WorkspaceVideoResult) => {
    if (
      result.requestId !== source.requestId ||
      result.sourcePath !== source.path ||
      !safeVideoMediaPath(result.path) ||
      mediaKindForPath(result.path) !== "video"
    )
      return;
    const next: MediaWorkbenchSave = { path: result.path, saveMode: result.path === source.path ? "overwrite" : "copy", revision: result.revision };
    setSaved(next);
    setError("");
    setNotice("");
    if (next.saveMode === "overwrite" || replaceVideoOnSave.current) void apply(next);
    else setNotice(t("media.workbench.copy_saved"));
    replaceVideoOnSave.current = false;
  };
  return (
    <section
      className="absolute inset-0 z-30 flex min-h-0 min-w-0 flex-col bg-background text-foreground"
      data-testid="media-workbench"
      data-request-id={source.requestId}
      aria-label={t("media.workbench.title")}
    >
      {!surface ? <div className="flex items-center gap-2 p-2">
        <Button variant="ghost" size="sm" onClick={onClose}><ArrowLeft className="size-4" />{returnLabel}</Button>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div> : null}
      {surface ? (
        <WorkspaceAppFrame
          className="min-h-0 flex-1"
          active={visible}
          surface={surface}
          client={client}
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          sessionId={sessionId}
          placement="workspace"
          launch={{
            intent: source.kind === "image" ? "edit-image" : "edit-video",
            requestId: source.requestId,
            returnToSource: true,
            returnLabel,
            workbenchMessage: error || (replaced ? t("media.workbench.replaced") : notice) || t(source.kind === "image" ? "media.workbench.image_hint" : "media.workbench.video_hint"),
            workbenchError: !!error,
            workbenchBusy: busy,
            source: {
              kind: "workspace-file",
              path: previewPath,
              name: source.path.split("/").pop() ?? source.kind,
              preview: source.kind,
            },
          }}
          workbench={{
            canSave: source.kind === "video" || (!!saved && !notice),
            canReplace: !replaced && (source.kind === "video" || !!saved),
            busy,
            onAction(action) {
              if (busy) return;
              if (action === "back") onClose();
              else if (source.kind === "image") void finishImage(action === "replace");
              else replaceVideoOnSave.current = action === "replace";
            },
          }}
          onImageSaved={imageSaved}
          onImageEdited={imageEdited}
          onVideoResult={videoResult}
        />
      ) : !error ? (
        <div className="grid flex-1 place-items-center" role="status" aria-label={t("media.workbench.loading")}>
          <Loader2 className="size-5 animate-spin motion-reduce:animate-none" />
        </div>
      ) : null}
    </section>
  );
}
