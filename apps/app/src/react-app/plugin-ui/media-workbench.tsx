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
import {
  WorkspaceAppFrame,
  type WorkspaceImageSave,
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
  onApply,
  onClose,
}: {
  source: MediaWorkbenchSource;
  client: iPolloWorkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  sessionId: string;
  returnLabel: string;
  onApply: (save: MediaWorkbenchSave) => Promise<void>;
  onClose: () => void;
}) {
  const [surface, setSurface] = useState<PluginUiSurface | null>(null);
  const [saved, setSaved] = useState<MediaWorkbenchSave | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef(true);
  const applying = useRef(false);
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
        if (save.saveMode === "copy") onClose();
        else setNotice(t("media.workbench.refreshed"));
      } catch (reason) {
        if (active.current)
          setError(reason instanceof Error ? reason.message : t("media.workbench.failed"));
      } finally {
        applying.current = false;
        if (active.current) setBusy(false);
      }
    },
    [onApply, onClose],
  );
  const imageSaved = (result: WorkspaceImageSave) => {
    if (result.originalPath !== source.path && result.originalPath !== saved?.path) return;
    if (!safeVideoMediaPath(result.path) || mediaKindForPath(result.path) !== source.kind) return;
    const next: MediaWorkbenchSave = {
      path: result.path,
      revision: result.revision,
      saveMode: result.path === source.path ? "overwrite" : "copy",
    };
    setSaved(next);
    setError("");
    setNotice("");
    if (next.saveMode === "overwrite") void apply(next);
  };
  const videoResult = (result: WorkspaceVideoResult) => {
    if (
      result.requestId !== source.requestId ||
      result.sourcePath !== source.path ||
      !safeVideoMediaPath(result.path) ||
      mediaKindForPath(result.path) !== "video"
    )
      return;
    setSaved({ path: result.path, saveMode: "copy" });
    setError("");
    setNotice("");
  };
  return (
    <section
      className="absolute inset-0 z-30 flex min-h-0 min-w-0 flex-col bg-background text-foreground"
      data-testid="media-workbench"
      aria-label={t("media.workbench.title")}
    >
      <header className="flex flex-wrap items-center gap-2 border-b p-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          <ArrowLeft className="size-4" />
          {returnLabel}
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={source.path}>
          {source.path}
        </span>
        {saved ? (
          <Button size="sm" disabled={busy} onClick={() => void apply(saved)}>
            {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
            {t(saved.saveMode === "copy" ? "media.workbench.replace" : "media.workbench.refresh")}
          </Button>
        ) : null}
      </header>
      <div className="border-b px-3 py-2 text-xs text-muted-foreground" role="status">
        {notice ||
          t(source.kind === "image" ? "media.workbench.image_hint" : "media.workbench.video_hint")}
      </div>
      {error ? (
        <div className="border-b px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      ) : null}
      {surface ? (
        <WorkspaceAppFrame
          className="min-h-0 flex-1"
          surface={surface}
          client={client}
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          sessionId={sessionId}
          placement="workspace"
          launch={{
            intent: source.kind === "image" ? "edit-image" : "edit-video",
            requestId: source.requestId,
            source: {
              kind: "workspace-file",
              path: source.path,
              name: source.path.split("/").pop() ?? source.kind,
              preview: source.kind,
            },
          }}
          onImageSaved={imageSaved}
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
