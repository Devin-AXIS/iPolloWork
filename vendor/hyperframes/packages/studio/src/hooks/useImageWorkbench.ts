import { useCallback, useEffect, useRef } from "react";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { UseDomEditSessionParams } from "./useDomEditSession";
import { usePlayerStore } from "../player";
import { acceptsIPolloWorkHostHistoryOrigin, parentOrigin } from "./useIPolloWorkHostHistoryBridge";
import {
  assertVideoImageBinding,
  captureVideoImageBinding,
  replaceBoundVideoImage,
  resolveEditableVideoImage,
  uploadedVideoImagePath,
  type VideoImageBinding,
} from "../utils/imageWorkbench";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import {
  MAX_VIDEO_IMAGE_BYTES,
  MAX_VIDEO_MEDIA_BYTES,
  mediaKindForPath,
  VIDEO_IMAGE_CANCEL,
  VIDEO_IMAGE_OPEN,
  VIDEO_IMAGE_RESULT,
  parseVideoImageApply,
} from "@ipollowork/types/video-image-workbench";

type Params = Pick<
  UseDomEditSessionParams,
  | "projectId"
  | "showToast"
  | "queueDomEditSave"
  | "readProjectFile"
  | "writeProjectFile"
  | "updateEditingFileContent"
  | "domEditSaveTimestampRef"
  | "editHistory"
  | "reloadPreview"
  | "forceReloadSdkSession"
>;
type PendingImage = {
  requestId: string;
  projectId: string;
  binding: VideoImageBinding;
  busy: boolean;
  completed: boolean;
};

export function useImageWorkbench(params: Params) {
  const pending = useRef<PendingImage | null>(null);
  const opening = useRef<symbol | null>(null);
  const latest = useRef(params);
  latest.current = params;
  useEffect(
    () => () => {
      pending.current = null;
      opening.current = null;
    },
    [params.projectId],
  );

  const openImageWorkbench = useCallback(async (selection: DomEditSelection) => {
    const scope = latest.current;
    const origin = parentOrigin();
    if (
      !scope.projectId ||
      !origin ||
      window.parent === window ||
      pending.current ||
      opening.current
    )
      return;
    const attempt = Symbol();
    opening.current = attempt;
    try {
      const image = resolveEditableVideoImage(selection, scope.projectId);
      if (!image) throw new Error("Select a local PNG, JPEG or WebP image first.");
      usePlayerStore.getState().setIsPlaying(false);
      const html = await scope.queueDomEditSave(() => scope.readProjectFile(selection.sourceFile));
      if (latest.current.projectId !== scope.projectId || opening.current !== attempt) return;
      const request = {
        requestId: crypto.randomUUID(),
        projectId: scope.projectId,
        binding: captureVideoImageBinding(selection, image, html),
        busy: false,
        completed: false,
      };
      pending.current = request;
      window.parent.postMessage(
        {
          type: VIDEO_IMAGE_OPEN,
          requestId: request.requestId,
          projectId: request.projectId,
          sourcePath: image.sourcePath,
          kind: image.kind === "video" ? "video" : "image",
        },
        origin === "file://" ? "*" : origin,
      );
    } catch (error) {
      scope.showToast(
        error instanceof Error ? error.message : "Could not open Image Studio.",
        "error",
      );
    } finally {
      if (opening.current === attempt) opening.current = null;
    }
  }, []);

  useEffect(() => {
    const origin = parentOrigin();
    const receive = async (event: MessageEvent<unknown>) => {
      if (
        event.source !== window.parent ||
        !acceptsIPolloWorkHostHistoryOrigin(event.origin, origin)
      )
        return;
      const request = pending.current;
      if (!request || request.projectId !== latest.current.projectId) return;
      const data = event.data;
      if (
        data &&
        typeof data === "object" &&
        "type" in data &&
        data.type === VIDEO_IMAGE_CANCEL &&
        "requestId" in data &&
        data.requestId === request.requestId
      ) {
        pending.current = null;
        return;
      }
      const action = parseVideoImageApply(data);
      if (!action || action.requestId !== request.requestId || request.busy) return;
      const reply = (ok: boolean, message?: string) =>
        window.parent.postMessage(
          {
            type: VIDEO_IMAGE_RESULT,
            requestId: request.requestId,
            actionId: action.actionId,
            ok,
            message,
          },
          origin === "file://" ? "*" : origin,
        );
      if (request.completed) {
        reply(true);
        return;
      }
      request.busy = true;
      const scope = latest.current;
      const assertCurrent = () => {
        if (pending.current !== request || latest.current.projectId !== request.projectId)
          throw new Error("The video editing session changed. Select the image again.");
      };
      try {
        await scope.queueDomEditSave(async () => {
          assertCurrent();
          if (action.mode === "copy" && action.image) {
            const before = await scope.readProjectFile(request.binding.sourceFile);
            assertVideoImageBinding(before, request.binding);
            assertCurrent();
            const form = new FormData();
            const kind = request.binding.kind === "video" ? "video" : "image";
            if (
              mediaKindForPath(action.image.name) !== kind ||
              action.image.bytes.byteLength >
                (kind === "video" ? MAX_VIDEO_MEDIA_BYTES : MAX_VIDEO_IMAGE_BYTES)
            )
              throw new Error("Unsupported media type or file too large.");
            form.append(
              "file",
              new File([action.image.bytes], `${action.actionId}-${action.image.name}`),
            );
            const response = await fetch(
              `/api/projects/${encodeURIComponent(request.projectId)}/upload?dir=assets`,
              { method: "POST", body: form, signal: AbortSignal.timeout(30_000) },
            );
            if (!response.ok)
              throw new Error(`Could not import edited image (${response.status}).`);
            const result: unknown = await response.json();
            const assetPath = uploadedVideoImagePath(result);
            if (!assetPath) throw new Error("The image import returned no usable image.");
            assertCurrent();
            const after = replaceBoundVideoImage(before, request.binding, assetPath);
            await saveProjectFilesWithHistory({
              projectId: request.projectId,
              label: "Replace selected video image",
              kind: "source",
              files: { [request.binding.sourceFile]: after },
              readFile: async () => before,
              writeFile: async (...args) => {
                assertCurrent();
                await scope.writeProjectFile(...args);
              },
              recordEdit: scope.editHistory.recordEdit,
            });
            scope.updateEditingFileContent(request.binding.sourceFile, after);
          } else {
            // Refresh the asset's HTTP cache, not the whole editor. A preview-only
            // reload then keeps the playhead, layout and timeline state intact.
            const response = await fetch(request.binding.previewUrl, {
              cache: "reload",
              signal: AbortSignal.timeout(30_000),
            });
            if (!response.ok)
              throw new Error(`Could not refresh the saved image (${response.status}).`);
            await response.arrayBuffer();
          }
          assertCurrent();
          scope.domEditSaveTimestampRef.current = Date.now();
          scope.forceReloadSdkSession?.();
          scope.reloadPreview();
          request.completed = action.mode === "copy";
        });
        reply(true);
      } catch (error) {
        reply(false, error instanceof Error ? error.message : "Could not update the video image.");
      } finally {
        request.busy = false;
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  return openImageWorkbench;
}
