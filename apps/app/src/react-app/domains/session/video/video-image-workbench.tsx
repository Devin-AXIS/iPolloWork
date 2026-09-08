/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  MAX_VIDEO_IMAGE_BYTES,
  MAX_VIDEO_MEDIA_BYTES,
  VIDEO_IMAGE_APPLY,
  VIDEO_IMAGE_CANCEL,
  VIDEO_IMAGE_RESULT,
  parseVideoImageRequest,
  type VideoImageApply,
  type VideoImageRequest,
} from "@ipollowork/types/video-image-workbench";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { MediaWorkbench, type MediaWorkbenchSave } from "@/react-app/plugin-ui/media-workbench";
import { t } from "@/i18n";
import { videoProjectDirectory, videoProjectId } from "./video-project";

type Props = {
  client: iPolloWorkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  sessionId: string;
  studioUrl: string;
  studioFrameRef: RefObject<HTMLIFrameElement | null>;
};
type Pending = {
  requestId: string;
  actionId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: number;
};

// Protocol adapter only: the shared media surface owns plugin loading and save UX.
export function VideoImageWorkbench({
  client,
  workspaceId,
  workspaceRoot,
  sessionId,
  studioUrl,
  studioFrameRef,
}: Props) {
  const [open, setOpen] = useState<VideoImageRequest | null>(null);
  const current = useRef<VideoImageRequest | null>(null);
  const ack = useRef<Pending | null>(null);
  const origin = new URL(studioUrl).origin;
  const close = useCallback(() => {
    if (current.current)
      studioFrameRef.current?.contentWindow?.postMessage(
        { type: VIDEO_IMAGE_CANCEL, requestId: current.current.requestId },
        origin,
      );
    current.current = null;
    if (ack.current) {
      window.clearTimeout(ack.current.timer);
      ack.current.reject(new Error(t("video.image.session_changed")));
      ack.current = null;
    }
    setOpen(null);
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
        value.requestId === ack.current?.requestId &&
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
                : t("media.workbench.failed"),
            ),
          );
        return;
      }
      const request = parseVideoImageRequest(value);
      if (!request || request.projectId !== videoProjectId(sessionId) || current.current) return;
      current.current = request;
      setOpen(request);
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      close();
    };
  }, [sessionId, origin, studioFrameRef, close]);
  const apply = useCallback(
    async (save: MediaWorkbenchSave) => {
      const request = current.current;
      if (!request) throw new Error(t("video.image.session_changed"));
      const action: VideoImageApply = {
        type: VIDEO_IMAGE_APPLY,
        requestId: request.requestId,
        actionId: crypto.randomUUID(),
        mode: save.saveMode,
      };
      if (save.saveMode === "copy") {
        const file = await client.downloadWorkspaceFile(workspaceId, save.path);
        if (
          file.data.byteLength >
          (request.kind === "video" ? MAX_VIDEO_MEDIA_BYTES : MAX_VIDEO_IMAGE_BYTES)
        )
          throw new Error(t("media.workbench.too_large"));
        if (save.revision) {
          const hash = Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", file.data)),
            (byte) => byte.toString(16).padStart(2, "0"),
          ).join("");
          if (hash !== save.revision) throw new Error(t("video.image.copy_changed"));
        }
        action.image = { bytes: file.data, name: save.path.split("/").pop() ?? "edited.png" };
      }
      if (current.current !== request) throw new Error(t("video.image.session_changed"));
      await new Promise<void>((resolve, reject) => {
        ack.current = {
          requestId: request.requestId,
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
    },
    [client, workspaceId, origin, studioFrameRef],
  );
  return open ? (
    <div data-testid="video-image-workbench">
      <MediaWorkbench
        key={open.requestId}
        source={{
          requestId: open.requestId,
          path: `${videoProjectDirectory(sessionId)}/${open.sourcePath}`,
          kind: open.kind ?? "image",
        }}
        client={client}
        workspaceId={workspaceId}
        workspaceRoot={workspaceRoot}
        sessionId={sessionId}
        returnLabel={t("video.image.back")}
        onApply={apply}
        onClose={close}
      />
    </div>
  ) : null;
}
