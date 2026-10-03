import { useState } from "react";
import { IMAGE_EXT, VIDEO_EXT, AUDIO_EXT } from "../utils/mediaTypes";
import { resolveMediaPreviewUrl } from "../player/components/thumbnailUtils";
import { useStudioI18n } from "../i18n";

function MediaErrorPanel({
  name,
  filePath,
}: {
  name: string;
  filePath: string;
}) {
  const { tx } = useStudioI18n();
  return (
    <div className="flex flex-col items-center justify-center h-full p-4 bg-[var(--hf-workspace-bg)] gap-2">
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-[var(--hf-panel-text-3)]"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" strokeLinecap="round" />
        <line x1="12" y1="16" x2="12.01" y2="16" strokeLinecap="round" />
      </svg>
      <span className="text-sm text-[var(--hf-panel-text-0)] font-medium">
        {name}
      </span>
      <span className="max-w-full break-all text-[11px] text-[var(--hf-panel-text-3)] font-mono">
        {filePath}
      </span>
      <span role="alert" className="text-[11px] text-[var(--hf-panel-text-3)]">
        {tx("Couldn't load this file — it may be missing or corrupt")}
      </span>
    </div>
  );
}

export function MediaPreview({
  projectId,
  filePath,
}: {
  projectId: string;
  filePath: string;
}) {
  const { tx } = useStudioI18n();
  const serveUrl = resolveMediaPreviewUrl(filePath, projectId);
  const mediaPath =
    /^https?:\/\//i.test(filePath) && URL.canParse(filePath)
      ? new URL(filePath).pathname
      : filePath;
  const name = mediaPath.split("/").pop() ?? mediaPath;
  // Keyed by path so switching to another file clears a previous failure.
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const failed = failedPath === filePath;
  const setFailed = () => setFailedPath(filePath);

  if (failed) return <MediaErrorPanel name={name} filePath={filePath} />;

  if (IMAGE_EXT.test(mediaPath)) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 bg-[var(--hf-workspace-bg)]">
        <img
          src={serveUrl}
          alt={name}
          onError={setFailed}
          className="max-w-full max-h-[85%] object-contain rounded border border-[var(--hf-workspace-hairline)]"
        />
        <span className="mt-3 max-w-full truncate text-[11px] text-[var(--hf-panel-text-3)] font-mono">
          {filePath}
        </span>
      </div>
    );
  }

  if (VIDEO_EXT.test(mediaPath)) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 bg-[var(--hf-workspace-bg)]">
        <video
          src={serveUrl}
          controls
          playsInline
          preload="metadata"
          onError={setFailed}
          className="max-w-full max-h-[85%] rounded border border-[var(--hf-workspace-hairline)]"
        />
        <span className="mt-3 max-w-full truncate text-[11px] text-[var(--hf-panel-text-3)] font-mono">
          {filePath}
        </span>
      </div>
    );
  }

  if (AUDIO_EXT.test(mediaPath)) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 bg-[var(--hf-workspace-bg)] gap-3">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-[var(--hf-panel-text-3)]"
        >
          <path
            d="M9 18V5l12-2v13"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        <audio
          src={serveUrl}
          controls
          onError={setFailed}
          className="w-full max-w-[280px]"
        />
        <span className="max-w-full truncate text-[11px] text-[var(--hf-panel-text-3)] font-mono">
          {filePath}
        </span>
      </div>
    );
  }

  // Fonts and other binary — show info instead of binary dump
  return (
    <div className="flex flex-col items-center justify-center h-full p-4 bg-[var(--hf-workspace-bg)] gap-2">
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-[var(--hf-panel-text-3)]"
      >
        <path
          d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points="14 2 14 8 20 8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-sm text-[var(--hf-panel-text-0)] font-medium">
        {name}
      </span>
      <span className="max-w-full truncate text-[11px] text-[var(--hf-panel-text-3)] font-mono">
        {filePath}
      </span>
      <span className="text-[11px] text-[var(--hf-panel-text-3)]">
        {tx("Binary file — preview not available")}
      </span>
    </div>
  );
}
