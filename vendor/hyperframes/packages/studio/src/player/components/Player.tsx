import { forwardRef, useEffect, useRef, useState } from "react";
import { isLottieAnimationLoaded } from "@hyperframes/core/runtime/lottie-readiness";
import { useMountEffect } from "../../hooks/useMountEffect";
import { applyPreviewVariablesToUrl } from "../../hooks/previewVariablesStore";
import { HyperframesLoader } from "../../components/ui";
// NOTE: importing "@hyperframes/player" registers a class extending HTMLElement
// at module load, which throws under SSR. Defer the import to the mount effect
// so it only runs in the browser.

interface PlayerProps {
  projectId?: string;
  directUrl?: string;
  onLoad: () => void;
  onCompositionLoadingChange?: (loading: boolean) => void;
  portrait?: boolean;
  style?: React.CSSProperties;
  suppressLoadingOverlay?: boolean;
  refreshToken?: number;
  /** Keep this player's iframe hidden until Studio has restored its seek position. */
  deferReveal?: boolean;
  /** Fires after the deferred iframe is both runtime-ready and seek-restored. */
  onReadyToReveal?: () => void;
  /** Fires when the player cannot load its composition. */
  onError?: () => void;
}

interface HyperframesPlayerElement extends HTMLElement {
  iframeElement: HTMLIFrameElement;
}

const MEDIA_HAVE_CURRENT_DATA = 2;
const MEDIA_HAVE_FUTURE_DATA = 3;
const MEDIA_NETWORK_NO_SOURCE = 3;

const COMPOSITION_LOADING_OVERLAY_DELAY_MS = 400;
const REFRESH_LOADING_OVERLAY_DELAY_MS = 220;
const DEFERRED_VISUAL_READY_TIMEOUT_MS = 800;
const DEFERRED_VISUAL_READY_PAINTS = 2;

export function shouldShowCompositionLoadingOverlay(compositionLoading: boolean): boolean {
  return compositionLoading;
}

export function shouldShowRefreshLoadingOverlay({
  compositionLoading,
  suppressLoadingOverlay,
  deferred,
}: {
  compositionLoading: boolean;
  suppressLoadingOverlay?: boolean;
  deferred: boolean;
}): boolean {
  return Boolean(suppressLoadingOverlay) && !deferred && compositionLoading;
}

export function CompositionRefreshLoadingOverlay() {
  return (
    <div
      className="absolute inset-0 bg-black/45 flex items-center justify-center z-30 select-none backdrop-blur-[1px]"
      data-hyperframes-ignore=""
      data-testid="composition-refresh-loading-overlay"
      draggable={false}
      style={{ transition: "opacity 180ms ease-out" }}
      onDragStart={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => event.preventDefault()}
    >
      <div className="flex flex-col items-center gap-3 px-6 text-center" role="status">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-500 motion-reduce:animate-none" />
        <p className="text-xs text-neutral-400">Preparing preview…</p>
      </div>
    </div>
  );
}

function enableInteractiveIframe(player: HyperframesPlayerElement): void {
  const root = player.shadowRoot;
  if (!root) return;

  const container = root.querySelector<HTMLElement>(".hfp-container");
  const iframe = root.querySelector<HTMLIFrameElement>(".hfp-iframe");

  container?.style.setProperty("pointer-events", "auto");
  iframe?.style.setProperty("pointer-events", "auto");
}

function isPreviewMediaElement(el: Element): el is HTMLMediaElement {
  const tagName = el.tagName.toLowerCase();
  return tagName === "video" || tagName === "audio";
}

// Assets are considered ready when every `<video>`/`<audio>` has enough data
// to play through without buffering, and every registered Lottie animation has
// finished loading.
//
// Returns whichever value was returned last on cross-origin / transient DOM
// races so a brief access failure (e.g. an iframe that just swapped src)
// doesn't flicker the overlay state — we keep showing whatever was most
// recently true.
export function hasUnloadedAssets(iframe: HTMLIFrameElement, lastResult: boolean): boolean {
  try {
    const win = iframe.contentWindow as unknown as (Window & { __hfLottie?: unknown[] }) | null;
    const doc = iframe.contentDocument;
    if (!win || !doc) return lastResult;

    for (const el of doc.querySelectorAll("video, audio")) {
      if (
        isPreviewMediaElement(el) &&
        !el.error &&
        el.networkState !== MEDIA_NETWORK_NO_SOURCE &&
        el.readyState < MEDIA_HAVE_FUTURE_DATA
      ) {
        return true;
      }
    }

    const lotties = win.__hfLottie;
    if (lotties?.length) {
      for (const anim of lotties) {
        if (!isLottieAnimationLoaded(anim)) return true;
      }
    }

    return false;
  } catch {
    return lastResult;
  }
}

function isVisuallyActive(element: HTMLElement): boolean {
  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }
  const rect = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style?.display !== "none" &&
    style?.visibility !== "hidden" &&
    style?.opacity !== "0"
  );
}

function documentHasPendingVisualAssets(doc: Document, depth = 0): boolean {
  if (doc.fonts?.status !== "loaded") return true;

  for (const image of doc.querySelectorAll<HTMLImageElement>("img")) {
    if (isVisuallyActive(image) && (!image.complete || image.naturalWidth === 0)) return true;
  }

  for (const video of doc.querySelectorAll<HTMLVideoElement>("video")) {
    if (
      isVisuallyActive(video) &&
      !video.error &&
      video.networkState !== MEDIA_NETWORK_NO_SOURCE &&
      video.readyState < MEDIA_HAVE_CURRENT_DATA
    ) {
      return true;
    }
  }

  if (depth >= 2) return false;
  for (const childFrame of doc.querySelectorAll<HTMLIFrameElement>("iframe")) {
    if (!isVisuallyActive(childFrame)) continue;
    try {
      const childDoc = childFrame.contentDocument;
      if (!childDoc || childDoc.readyState !== "complete") return true;
      if (documentHasPendingVisualAssets(childDoc, depth + 1)) return true;
    } catch {
      // Cross-origin child frames cannot expose readiness. The two-paint gate
      // below still prevents swapping on their first unpainted browser frame.
    }
  }

  return false;
}

export function isDeferredFrameVisuallyReady(iframe: HTMLIFrameElement): boolean {
  try {
    const doc = iframe.contentDocument;
    return Boolean(doc && doc.readyState === "complete" && !documentHasPendingVisualAssets(doc));
  } catch {
    return true;
  }
}

/**
 * Renders a composition preview using the <hyperframes-player> web component.
 *
 * The web component handles iframe scaling, dimension detection, and
 * ResizeObserver internally. This wrapper bridges its inner iframe to the
 * forwarded ref so useTimelinePlayer can access it for clip manifest parsing,
 * timeline probing, and DOM inspection.
 */
export const Player = forwardRef<HTMLIFrameElement, PlayerProps>(
  (
    {
      projectId,
      directUrl,
      onLoad,
      onCompositionLoadingChange,
      portrait,
      style,
      suppressLoadingOverlay,
      refreshToken,
      deferReveal,
      onReadyToReveal,
      onError,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const loadCountRef = useRef(0);
    const assetPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [compositionLoading, setCompositionLoading] = useState(true);
    const [compositionOverlayDeferred, setCompositionOverlayDeferred] = useState(true);
    const previousRefreshTokenRef = useRef(refreshToken);

    // eslint-disable-next-line no-restricted-syntax
    useEffect(() => {
      if (!compositionLoading) {
        setCompositionOverlayDeferred(true);
        return;
      }
      const timer = setTimeout(
        () => setCompositionOverlayDeferred(false),
        suppressLoadingOverlay
          ? REFRESH_LOADING_OVERLAY_DELAY_MS
          : COMPOSITION_LOADING_OVERLAY_DELAY_MS,
      );
      return () => clearTimeout(timer);
    }, [compositionLoading, suppressLoadingOverlay]);

    useEffect(() => {
      if (refreshToken === previousRefreshTokenRef.current) return;
      previousRefreshTokenRef.current = refreshToken;
      if (loadCountRef.current === 0) return;
      if (suppressLoadingOverlay) return;
      setCompositionLoading(true);
    }, [refreshToken, suppressLoadingOverlay]);

    useMountEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      let canceled = false;
      let cleanup: (() => void) | undefined;
      let revealRaf = 0;

      // Dynamic import registers the custom element in the browser only.
      import("@hyperframes/player").then(() => {
        if (canceled) return;

        // Create the web component imperatively to avoid JSX custom-element typing.
        const player = document.createElement("hyperframes-player") as HyperframesPlayerElement;
        const srcUrl = new URL(
          directUrl || `/api/projects/${projectId}/preview`,
          window.location.origin,
        );
        applyPreviewVariablesToUrl(srcUrl);
        // A staged refresh mounts a new player, but the browser can still serve
        // the previous HTML document when its URL is unchanged. Carry the
        // refresh token into the request so a persisted delete cannot be
        // visually resurrected from that stale preview response.
        if (refreshToken !== undefined) {
          srcUrl.searchParams.set("_hfRefresh", String(refreshToken));
        }
        const src = srcUrl.pathname + srcUrl.search;
        player.setAttribute("shader-capture-scale", "1");
        player.setAttribute("shader-loading", "player");
        player.setAttribute("src", src);
        player.setAttribute("width", String(portrait ? 1080 : 1920));
        player.setAttribute("height", String(portrait ? 1920 : 1080));
        player.style.width = "100%";
        player.style.height = "100%";
        player.style.display = "block";
        player.style.background = "transparent";
        container.appendChild(player);

        // Inject pasteboard shadow: let the shadow around the canvas bleed
        // into the surrounding pasteboard area (overflow: visible on the container)
        // and add a subtle outline + drop-shadow so the canvas boundary reads
        // against the gray pasteboard, consistent with professional editors.
        if (player.shadowRoot) {
          const pasteboardStyle = document.createElement("style");
          pasteboardStyle.textContent =
            ".hfp-container{overflow:visible}" +
            ".hfp-iframe{box-shadow:0 0 0 1px rgba(255,255,255,0.08),0 4px 32px rgba(0,0,0,.7)}";
          player.shadowRoot.appendChild(pasteboardStyle);
        }

        enableInteractiveIframe(player);

        // Bridge the inner iframe to the forwarded ref for useTimelinePlayer.
        const iframe = player.iframeElement;
        if (deferReveal) iframe.style.visibility = "hidden";
        const assignForwardedRef = () => {
          if (typeof ref === "function") {
            ref(iframe);
          } else if (ref) {
            (ref as React.MutableRefObject<HTMLIFrameElement | null>).current = iframe;
          }
        };
        if (!deferReveal) assignForwardedRef();

        // Prevent the web component's built-in click-to-toggle behavior.
        // The studio manages playback exclusively via useTimelinePlayer.
        const preventToggle = (e: Event) => e.stopImmediatePropagation();
        player.addEventListener("click", preventToggle, { capture: true });

        let deferredReadyHandled = false;
        const handleReady = () => {
          setCompositionLoading(false);
          if (!deferReveal) return;
          if (deferredReadyHandled) return;
          deferredReadyHandled = true;
          // Keep playback/selection bound to the visible player while the new
          // document loads. Once its runtime is ready, hand over the ref and let
          // Studio restore the seek before revealing it.
          assignForwardedRef();
          onLoad();
          let visibleAt = 0;
          let readyPaints = 0;
          const notifyWhenRestored = () => {
            if (canceled) return;
            if (iframe.style.visibility === "hidden") {
              revealRaf = requestAnimationFrame(notifyWhenRestored);
              return;
            }
            if (visibleAt === 0) visibleAt = performance.now();
            const timedOut = performance.now() - visibleAt >= DEFERRED_VISUAL_READY_TIMEOUT_MS;
            if (timedOut || isDeferredFrameVisuallyReady(iframe)) {
              readyPaints += 1;
            } else {
              readyPaints = 0;
            }
            if (readyPaints >= DEFERRED_VISUAL_READY_PAINTS) {
              onReadyToReveal?.();
              return;
            }
            revealRaf = requestAnimationFrame(notifyWhenRestored);
          };
          notifyWhenRestored();
        };
        const handleError = () => {
          setCompositionLoading(false);
          onError?.();
        };
        player.addEventListener("ready", handleReady);
        player.addEventListener("error", handleError);

        // Forward the iframe's native load event to the studio's onIframeLoad.
        const handleLoad = () => {
          loadCountRef.current++;
          // A staged replacement may report `ready` before the iframe's native
          // load event reaches this listener. Once the replacement has already
          // handed off, that late load must not reopen a redundant overlay over
          // the freshly revealed preview.
          if (!deferredReadyHandled) setCompositionLoading(true);
          // Reveal animation on reload (hot-reload, composition switch)
          if (loadCountRef.current > 1) {
            container.classList.remove("preview-revealing");
            void container.offsetWidth;
            container.classList.add("preview-revealing");
            const onEnd = () => container.classList.remove("preview-revealing");
            container.addEventListener("animationend", onEnd, { once: true });
          }
          if (!deferReveal) onLoad();

          // Keep polling media and motion readiness without covering the
          // preview. The player remains usable while assets finish loading.
          if (assetPollRef.current) clearInterval(assetPollRef.current);
          const isContentRefresh = loadCountRef.current > 1;
          let lastUnloaded = isContentRefresh ? false : hasUnloadedAssets(iframe, false);
          if (lastUnloaded) {
            let attempts = 0;
            assetPollRef.current = setInterval(() => {
              attempts += 1;
              lastUnloaded = hasUnloadedAssets(iframe, lastUnloaded);
              if (!lastUnloaded || attempts > 100) {
                if (assetPollRef.current) clearInterval(assetPollRef.current);
                assetPollRef.current = null;
              }
            }, 100);
          }
        };
        iframe.addEventListener("load", handleLoad);

        cleanup = () => {
          iframe.removeEventListener("load", handleLoad);
          player.removeEventListener("click", preventToggle, { capture: true });
          player.removeEventListener("ready", handleReady);
          player.removeEventListener("error", handleError);
          if (assetPollRef.current) clearInterval(assetPollRef.current);
          assetPollRef.current = null;
          if (revealRaf) cancelAnimationFrame(revealRaf);
          container.removeChild(player);
          // Clear the forwarded ref only if it still points to THIS iframe.
          // During crossfade refreshes the retiring Player unmounts after the
          // new Player has already assigned its iframe to the same ref — blindly
          // nulling it would break seeking in the new Player.
          // Callback refs are skipped — we can't read back the current value to
          // guard against clobbering a newer assignment. The mutable-ref branch
          // (the only path used today) is guarded by identity check.
          if (typeof ref === "function") {
            // no-op: can't safely guard callback refs
          } else if (ref) {
            const mutableRef = ref as React.MutableRefObject<HTMLIFrameElement | null>;
            if (mutableRef.current === iframe) {
              mutableRef.current = null;
            }
          }
        };
      });

      return () => {
        canceled = true;
        cleanup?.();
      };
    });

    const showCompositionOverlay =
      !suppressLoadingOverlay &&
      !compositionOverlayDeferred &&
      shouldShowCompositionLoadingOverlay(compositionLoading);
    const showRefreshOverlay = shouldShowRefreshLoadingOverlay({
      compositionLoading,
      suppressLoadingOverlay,
      deferred: compositionOverlayDeferred,
    });
    useEffect(() => {
      onCompositionLoadingChange?.(showCompositionOverlay);
    }, [onCompositionLoadingChange, showCompositionOverlay]);

    return (
      <div
        className="relative w-full h-full max-w-full max-h-full overflow-hidden flex items-center justify-center"
        style={style}
      >
        <div ref={containerRef} className="w-full h-full" />
        {showCompositionOverlay && (
          <div
            className="absolute inset-0 bg-black flex items-center justify-center z-30 select-none"
            data-hyperframes-ignore=""
            data-testid="composition-loading-overlay"
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onPointerDown={(event) => event.preventDefault()}
          >
            <HyperframesLoader
              title="Loading composition"
              detail="Preparing the Studio preview."
              size={56}
            />
          </div>
        )}
        {showRefreshOverlay && <CompositionRefreshLoadingOverlay />}
      </div>
    );
  },
);

Player.displayName = "Player";
