export interface BlockPreviewRuntimeOptions {
  container: HTMLElement;
  videoUrl: string;
  signal: AbortSignal;
  onReady: () => void;
  onError: () => void;
}

/**
 * Mounts the current card's media only after hover intent has been confirmed.
 * Clearing src + load() cancels the browser's pending media request.
 */
export function mountBlockPreview({
  container,
  videoUrl,
  signal,
  onReady,
  onError,
}: BlockPreviewRuntimeOptions): () => void {
  const video = document.createElement("video");
  let cleaned = false;

  const normalizePlayback = () => {
    video.defaultPlaybackRate = 1;
    if (video.playbackRate !== 1) video.playbackRate = 1;
  };
  const handleLoadedMetadata = () => {
    normalizePlayback();
    video.currentTime = 0;
  };
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    signal.removeEventListener("abort", cleanup);
    video.removeEventListener("loadedmetadata", handleLoadedMetadata);
    video.removeEventListener("ratechange", normalizePlayback);
    video.removeEventListener("playing", handlePlaying);
    video.removeEventListener("error", handleError);
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
  };
  const handlePlaying = () => {
    if (!cleaned && !signal.aborted) onReady();
  };
  const handleError = () => {
    if (cleaned || signal.aborted) return;
    cleanup();
    onError();
  };

  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  normalizePlayback();
  video.disablePictureInPicture = true;
  video.className = "absolute inset-0 size-full object-cover";
  video.addEventListener("loadedmetadata", handleLoadedMetadata);
  video.addEventListener("ratechange", normalizePlayback);
  video.addEventListener("playing", handlePlaying);
  video.addEventListener("error", handleError);
  signal.addEventListener("abort", cleanup, { once: true });
  container.replaceChildren(video);
  video.src = videoUrl;
  video.load();
  void video.play().catch(handleError);

  return cleanup;
}
