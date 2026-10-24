import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Eye, Image as ImageIcon, Music2, Video, X } from "lucide-react";
import { useFileManagerContext } from "../../contexts/FileManagerContext";
import { useStudioI18n } from "../../i18n";
import { resolveMediaPreviewUrl } from "../../player/components/thumbnailUtils";
import { AUDIO_EXT, IMAGE_EXT, isMediaFile, VIDEO_EXT } from "../../utils/mediaTypes";
import { MediaPreview } from "../MediaPreview";
import { VideoFrameThumbnail } from "../ui/VideoFrameThumbnail";
import { useDialogBehavior } from "../ui/useDialogBehavior";

/** Select, preview or import media through the shared project file manager. */
export function StoryboardAsset({
  projectId,
  index,
  reference,
  audioOnly = false,
  mediaKind,
  disabled = false,
  onChange,
}: {
  projectId: string;
  index: number;
  reference: string;
  /** Use the same project asset source, narrowed to audio for music/SFX. */
  audioOnly?: boolean;
  mediaKind?: "image" | "video";
  disabled?: boolean;
  onChange: (path: string) => void;
}) {
  const { tx } = useStudioI18n();
  const { assets, fileTreeLoaded, uploadProjectFiles } = useFileManagerContext();
  const mediaAssets = assets.filter(
    (asset) =>
      isMediaFile(asset) &&
      (audioOnly ? AUDIO_EXT.test(asset) : mediaKind === "image" ? IMAGE_EXT.test(asset) : mediaKind === "video" ? VIDEO_EXT.test(asset) : IMAGE_EXT.test(asset) || VIDEO_EXT.test(asset)),
  );
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const { requestClose } = useDialogBehavior({
    open: preview !== null,
    onClose: () => setPreview(null),
    containerRef: dialog,
  });
  const selected = reference.trim().replace(/^\.\//, "");
  const selectedExists = assets.includes(selected) && isMediaFile(selected);
  const matches = libraryOpen ? mediaAssets.filter((asset) => asset.toLowerCase().includes(query.trim().toLowerCase())) : [];
  const visibleAssets = libraryOpen ? matches.slice(0, 40) : selectedExists ? [selected] : [];

  async function importFile(file: File) {
    setImportError("");
    const compatible = audioOnly ? AUDIO_EXT.test(file.name) : mediaKind === "image" ? IMAGE_EXT.test(file.name) : mediaKind === "video" ? VIDEO_EXT.test(file.name) : IMAGE_EXT.test(file.name) || VIDEO_EXT.test(file.name);
    if (!compatible) {
      setImportError(tx("Choose a compatible media file"));
      return;
    }
    setImporting(true);
    try {
      const [path] = await uploadProjectFiles([file]);
      if (!path) throw new Error(tx("No media imported. Check the file and try again."));
      onChange(path);
      setLibraryOpen(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : tx("No media imported. Check the file and try again."));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="px-2 pb-2">
      <input
        ref={fileInput}
        type="file"
        hidden
        aria-label={`${tx(audioOnly ? "Import audio" : "Import media")} ${index}`}
        accept={audioOnly ? "audio/*" : mediaKind === "image" ? "image/*" : mediaKind === "video" ? "video/*" : "image/*,video/*"}
        disabled={disabled || importing}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importFile(file);
        }}
      />
      <button
        type="button"
        disabled={disabled || importing}
        onClick={() => fileInput.current?.click()}
        className="mb-2 mr-1 rounded-md border border-[var(--hf-workspace-border)] px-2 py-1.5 text-[10px] text-[var(--hf-panel-text-2)] hover:bg-[var(--hf-panel-hover)] disabled:opacity-50"
      >
        {tx(importing ? "Importing media…" : audioOnly ? "Import audio" : "Import media")}
      </button>
      {importError && <p role="alert" className="mb-2 text-[10px] text-red-500">{importError}</p>}
      <button
        type="button"
        disabled={disabled || importing}
        aria-expanded={libraryOpen}
        aria-label={`${tx(audioOnly ? "Browse audio assets" : "Browse visual assets")} ${index}`}
        onClick={() => setLibraryOpen((open) => !open)}
        className="mb-2 rounded-md border border-[var(--hf-workspace-border)] px-2 py-1.5 text-[10px] text-[var(--hf-panel-text-2)] hover:bg-[var(--hf-panel-hover)]"
      >
        {tx(libraryOpen ? "Close asset library" : selected ? "Replace asset" : "Choose from project assets")}
      </button>
      {libraryOpen && (
        <input
          type="search"
          aria-label={`${tx(audioOnly ? "Find audio assets" : "Find visual assets")} ${index}`}
          placeholder={tx("Search project assets")}
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          className="mb-2 w-full rounded-md border border-[var(--hf-workspace-border)] bg-transparent px-2 py-1.5 text-[10px]"
        />
      )}
      {visibleAssets.length > 0 ? (
        <div
          role="group"
          aria-label={`${tx(audioOnly ? "Choose existing audio asset" : "Choose existing visual asset")} ${index}`}
          className={`grid max-h-52 gap-2 overflow-y-auto pr-1 ${audioOnly ? "grid-cols-1" : "grid-cols-2"}`}
        >
          {visibleAssets.map((asset) => {
            const selectedAsset = selected === asset;
            const url = resolveMediaPreviewUrl(asset, projectId);
            const isImage = IMAGE_EXT.test(asset);
            const isVideo = VIDEO_EXT.test(asset);
            const isAudio = AUDIO_EXT.test(asset);
            const name = asset.split("/").pop() ?? asset;
            return (
              <div
                key={asset}
                className={`relative min-w-0 overflow-hidden rounded-md border transition-colors ${
                  selectedAsset
                    ? "border-studio-accent ring-1 ring-studio-accent/40"
                    : "border-[var(--hf-workspace-hairline)] hover:border-[var(--hf-workspace-border)]"
                }`}
              >
                <button
                  type="button"
                  disabled={disabled || importing}
                  aria-pressed={selectedAsset}
                  aria-label={`${tx("Select asset")}: ${name}`}
                  title={name}
                  onClick={() => { onChange(asset); setLibraryOpen(false); }}
                  className={`w-full min-w-0 text-left focus-visible:outline-studio-accent ${audioOnly ? "flex items-center gap-2 px-2 py-1.5 pr-7" : "block"}`}
                >
                  <span className={`relative block overflow-hidden bg-[var(--hf-workspace-inset)] ${audioOnly ? "size-7 shrink-0 rounded" : "aspect-video"}`}>
                    {isImage ? (
                      <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : isVideo ? (
                      <VideoFrameThumbnail src={url} fallbackLabel="VIDEO" />
                    ) : (
                      <span className="flex h-full items-center justify-center text-[var(--hf-panel-text-3)]">
                        <Music2 size={22} />
                      </span>
                    )}
                    {selectedAsset && !audioOnly && (
                      <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-studio-accent text-white">
                        <Check size={12} aria-hidden="true" />
                      </span>
                    )}
                    {!audioOnly && <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[9px] text-white">
                      {isImage ? (
                        <ImageIcon size={10} />
                      ) : isVideo ? (
                        <Video size={10} />
                      ) : (
                        <Music2 size={10} />
                      )}
                      {isImage ? tx("Image") : isVideo ? tx("Video") : tx("Audio")}
                    </span>}
                  </span>
                  <span className="block truncate px-1.5 py-1.5 text-[10px] text-[var(--hf-panel-text-2)]">
                    {name}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`${tx("Preview")}: ${name}`}
                  title={tx("Preview")}
                  onClick={() => setPreview(asset)}
                  className="absolute right-1 bottom-1 rounded bg-[var(--hf-workspace-bg)]/90 p-1 text-[var(--hf-panel-text-2)] hover:text-[var(--hf-panel-text-0)]"
                >
                  <Eye size={12} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      ) : libraryOpen && fileTreeLoaded ? (
        <p className="rounded-md border border-dashed border-[var(--hf-workspace-border)] px-2 py-3 text-center text-[10px] leading-4 text-[var(--hf-panel-text-3)]">
          {tx(query || mediaAssets.length ? "No matching assets" : "No project media yet. Import a file above.")}
        </p>
      ) : libraryOpen ? <p role="status" className="text-[10px] text-[var(--hf-panel-text-3)]">{tx("Loading project assets…")}</p> : null}

      {libraryOpen && matches.length > 40 && <p className="text-[10px] text-[var(--hf-panel-text-3)]">{tx("Search to narrow the asset list")}</p>}
      {selected && !selectedExists && (
        <p role="status" className="mt-1 break-all text-[10px] text-[var(--hf-panel-text-3)]">
          {selected}<br />{tx(fileTreeLoaded ? "Reference only — import the media file to use it" : "Loading project assets…")}
        </p>
      )}
      {!selected && !libraryOpen && !audioOnly && <p className="text-[10px] text-[var(--hf-panel-text-4)]">{tx("No file selected yet")}</p>}

      {selected && (
        <button
          type="button"
          disabled={disabled || importing}
          aria-label={`${tx("Clear selected asset")} ${index}`}
          onClick={() => onChange("")}
          className="mt-2 inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-[var(--hf-panel-text-3)] hover:bg-[var(--hf-panel-hover)] hover:text-[var(--hf-panel-text-0)]"
        >
          <X size={11} aria-hidden="true" />
          {tx("Clear selected asset")}
        </button>
      )}

      {preview &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/35 p-4"
            onClick={requestClose}
            data-playback-shortcuts="off"
          >
            <div
              ref={dialog}
              role="dialog"
              aria-modal="true"
              aria-label={tx("Asset preview")}
              tabIndex={-1}
              onClick={(event) => event.stopPropagation()}
              className="flex h-[min(640px,85vh)] w-[min(900px,92vw)] flex-col overflow-hidden rounded-xl border border-[var(--hf-workspace-border)] bg-[var(--hf-workspace-bg)] text-[var(--hf-panel-text-0)] shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-[var(--hf-workspace-hairline)] px-4 py-3">
                <span className="text-sm font-medium">{tx("Asset preview")}</span>
                <button
                  type="button"
                  onClick={requestClose}
                  aria-label={tx("Close preview")}
                  className="rounded p-1.5 hover:bg-[var(--hf-panel-hover)]"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <MediaPreview projectId={projectId} filePath={preview} />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
