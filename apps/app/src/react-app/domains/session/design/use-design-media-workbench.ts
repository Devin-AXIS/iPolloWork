import * as React from "react";
import { resolveInstalledPluginContributions } from "@/react-app/plugin-ui/plugin-ui-contributions";
import { usePanelTabStore, type MediaEditBinding } from "../panel/panel-tab-store";
import {
  MAX_VIDEO_IMAGE_BYTES,
  MAX_VIDEO_MEDIA_BYTES,
  mediaKindForPath,
  safeVideoMediaPath,
  type MediaKind,
} from "@ipollowork/types/video-image-workbench";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import type { DesignSelection } from "./design-html-runtime";
import {
  designMediaTools,
  relativeDesignMediaPath,
  replaceDesignMedia,
  resolveDesignMediaPath,
} from "./design-media";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";

type Params = {
  sessionId: string;
  projectSessionId: string;
  client: iPolloWorkServerClient | null;
  workspaceId: string | null;
  page: string;
  selection: DesignSelection | null;
  enabled: boolean;
  saveCurrent: () => Promise<string>;
  onReload: (content: string, updatedAt: number | null) => void;
  onFill: (kind: MediaKind, src: string, preview: string) => void;
};

export function useDesignMediaWorkbench(params: Params) {
  const [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const picking = React.useRef<{ id: string; page: string; kind: MediaKind } | null>(null);
  const latest = React.useRef(params);
  latest.current = params;
  const active = React.useRef(true);
  const urls = React.useRef<string[]>([]);
  const operating = React.useRef(false);
  React.useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  React.useEffect(() => {
    picking.current = null;
    return () => {
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      urls.current = [];
    };
  }, [params.page, params.workspaceId]);
  const assertCurrent = (scope: Params) => {
    if (
      !active.current ||
      latest.current.page !== scope.page ||
      latest.current.workspaceId !== scope.workspaceId
    )
      throw new Error(t("media.workbench.changed"));
  };
  const upload = async (scope: Params, file: File) => {
    const kind = mediaKindForPath(file.name);
    if (
      !kind ||
      !file.size ||
      file.size > (kind === "video" ? MAX_VIDEO_MEDIA_BYTES : MAX_VIDEO_IMAGE_BYTES)
    )
      throw new Error(t("media.workbench.too_large"));
    if (!scope.client || !scope.workspaceId) throw new Error(t("media.workbench.unavailable"));
    const ext = file.name.split(".").at(-1)?.toLowerCase();
    const path = `${scope.page.replace(/[^/]+$/, "")}assets/${crypto.randomUUID()}.${ext}`;
    await scope.client.uploadWorkspaceMedia(scope.workspaceId, path, file);
    assertCurrent(scope);
    return path;
  };
  const choose = (kind: MediaKind) => {
    if (!params.enabled || !params.selection || busy) return;
    picking.current = { id: params.selection.id, page: params.page, kind };
    if (input.current) {
      input.current.accept = kind === "video" ? ".mp4,.mov" : ".png,.jpg,.jpeg,.webp";
      input.current.click();
    }
  };
  const importFile = async (file?: File) => {
    const picked = picking.current;
    if (!file || !picked || operating.current) return;
    const scope = latest.current;
    if (scope.page !== picked.page || scope.selection?.id !== picked.id || !scope.enabled) return;
    operating.current = true;
    setBusy(true);
    try {
      if (mediaKindForPath(file.name) !== picked.kind)
        throw new Error(t("media.workbench.wrong_type"));
      const path = await upload(scope, file);
      if (latest.current.selection?.id !== picked.id) throw new Error(t("media.workbench.changed"));
      const preview = URL.createObjectURL(file);
      urls.current.push(preview);
      scope.onFill(picked.kind, relativeDesignMediaPath(scope.page, path), preview);
    } catch (error) {
      if (active.current)
        toast.error(error instanceof Error ? error.message : t("media.workbench.failed"));
    } finally {
      operating.current = false;
      if (active.current) setBusy(false);
    }
  };
  const selectedMedia = params.selection?.media;
  const canOpen = Boolean(
    params.enabled &&
    params.client &&
    selectedMedia &&
    (resolveDesignMediaPath(params.page, selectedMedia.source) ||
      /^data:image\/(png|jpeg|webp);base64,/i.test(selectedMedia.source)),
  );
  const open = async () => {
    if (
      !canOpen ||
      operating.current ||
      !params.selection ||
      !selectedMedia ||
      !params.client ||
      !params.workspaceId
    )
      return;
    const scope = params;
    operating.current = true;
    setBusy(true);
    try {
      let content = await scope.saveCurrent();
      assertCurrent(scope);
      const locator = params.selection.locator;
      let element = new DOMParser()
        .parseFromString(content, "text/html")
        .querySelector<HTMLElement>(locator);
      if (!element) throw new Error(t("media.workbench.changed"));
      let path = resolveDesignMediaPath(scope.page, selectedMedia.source);
      if (!path) {
        const response = await fetch(selectedMedia.source);
        const blob = await response.blob();
        path = await upload(
          scope,
          new File(
            [blob],
            `embedded.${blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1]}`,
            { type: blob.type },
          ),
        );
        const previous = await params.client.readWorkspaceFile(params.workspaceId, scope.page);
        if (previous.content !== content) throw new Error(t("media.workbench.changed"));
        content = replaceDesignMedia(
          content,
          locator,
          element.outerHTML,
          selectedMedia,
          relativeDesignMediaPath(scope.page, path),
        );
        const result = await params.client.writeWorkspaceFile(params.workspaceId, {
          path: scope.page,
          content,
          baseUpdatedAt: previous.updatedAt,
        });
        assertCurrent(scope);
        scope.onReload(content, result.updatedAt ?? null);
        element = new DOMParser()
          .parseFromString(content, "text/html")
          .querySelector<HTMLElement>(locator);
      }
      if (!element || !path) throw new Error(t("media.workbench.changed"));
      const binding: MediaEditBinding = {
        workspaceId: params.workspaceId, sessionId: params.sessionId, projectSessionId: params.projectSessionId,
        results: [], active: true, replaced: false,
        source: { requestId: crypto.randomUUID(), path, kind: selectedMedia.kind },
        locator,
        original: element.outerHTML,
        media: designMediaTools().read(element) ?? selectedMedia,
        page: scope.page,
      };
      const packages = await params.client.listPluginPackages(params.workspaceId);
      assertCurrent(scope);
      const pluginId = selectedMedia.kind === "image" ? "image-studio" : "video-console";
      const surface = resolveInstalledPluginContributions(packages.items).workspaceApps.find(item => item.pluginId === pluginId);
      if (!surface) throw new Error(t("media.workbench.unavailable"));
      usePanelTabStore.getState().rememberMediaEdit(binding);
      usePanelTabStore.getState().resumeMediaEdit(binding, path, surface);
    } catch (error) {
      if (active.current)
        toast.error(error instanceof Error ? error.message : t("media.workbench.failed"));
    } finally {
      operating.current = false;
      if (active.current) setBusy(false);
    }
  };
  return {
    input,
    choose,
    importFile,
    canOpen,
    open,
    busy,
  };
}
