/** @jsxImportSource react */
import { useBootOverlayState, useBootState } from "./boot-state";
import { publicAssetUrl } from "@/app/lib/public-asset";

const RELEASES_URL = "https://github.com/Devin-AXIS/iPolloWork/releases";

export function IPolloLoadingArtwork() {
  return (
    <img
      src={publicAssetUrl("ipollowork-app-loading-v3.gif")}
      alt="iPolloWork Loading"
      className="h-auto w-[min(288px,33.6vw)] max-[640px]:w-[min(224px,46.4vw)] dark:brightness-0 dark:invert"
    />
  );
}

/**
 * Branded boot overlay. It matches the application surface from the first
 * renderer frame and stays mounted until both boot and route data are ready.
 */
export function LoadingOverlay() {
  const { visible, fading } = useBootOverlayState();
  const { message, error } = useBootState();

  if (!visible) return null;

  return (
    <div
      className={`pointer-events-auto fixed inset-0 z-[1000] flex items-center justify-center bg-dls-surface transition-opacity duration-[160ms] ${
        fading ? "opacity-0" : "opacity-100"
      }`}
      aria-live="polite"
      aria-busy={!fading}
      role="status"
      data-testid="startup-logo-animation"
    >
      <div className="flex items-center justify-center">
        <IPolloLoadingArtwork />
      </div>
      <span className="sr-only">Loading... {message || "Preparing workspace"}</span>
      {error ? (
          <div className="absolute inset-x-6 bottom-8 mx-auto flex max-w-xl flex-col gap-2 rounded-xl bg-black/80 p-4 text-center text-[12px] leading-5 text-red-300 backdrop-blur">
            <div>{error}</div>
            <div className="text-white/70">
              Download the latest version manually here:{" "}
              <a
                href={RELEASES_URL}
                target="_blank"
                rel="noreferrer"
                className="text-white underline decoration-white/40 underline-offset-4"
              >
                {RELEASES_URL}
              </a>
            </div>
          </div>
      ) : null}
    </div>
  );
}
