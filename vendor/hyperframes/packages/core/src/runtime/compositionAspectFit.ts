const aspectFitObservers = new WeakMap<HTMLElement, ResizeObserver>();

type AspectFitHost = HTMLElement & {
  __hfAspectFit?: () => boolean;
};

function readPositiveDimension(value: string | null | undefined): number | null {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isEndingEffectCompositionHost(host: HTMLElement): boolean {
  const source = (
    host.getAttribute("data-composition-src") ??
    host.getAttribute("data-composition-file") ??
    ""
  )
    .replace(/\\/g, "/")
    .toLowerCase();
  const compositionId = (host.getAttribute("data-composition-id") ?? "").toLowerCase();
  return source.includes("/effects/effect-ending-") || compositionId.startsWith("effect-ending-");
}

function findFlattenedInnerRoot(host: HTMLElement): HTMLElement | null {
  return (
    Array.from(host.children).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.hasAttribute("data-hf-inner-root"),
    ) ?? host.querySelector<HTMLElement>("[data-hf-inner-root]")
  );
}

/**
 * Keep an authored sub-composition proportional inside an independently sized
 * host. The CSS `scale` longhand composes with GSAP's `transform`, so resizing
 * the host cannot squash the effect or overwrite its animation transform.
 */
export function applyAspectFitCompositionHost(host: HTMLElement): boolean {
  if (!host.hasAttribute("data-hf-content-fit") && !isEndingEffectCompositionHost(host)) {
    return false;
  }
  const innerRoot = findFlattenedInnerRoot(host);
  if (!innerRoot) return false;

  const sourceWidth = readPositiveDimension(innerRoot.getAttribute("data-width"));
  const sourceHeight = readPositiveDimension(innerRoot.getAttribute("data-height"));
  const hostWidth =
    host.clientWidth ||
    readPositiveDimension(host.style.width) ||
    readPositiveDimension(host.getAttribute("data-width"));
  const hostHeight =
    host.clientHeight ||
    readPositiveDimension(host.style.height) ||
    readPositiveDimension(host.getAttribute("data-height"));
  if (!sourceWidth || !sourceHeight || !hostWidth || !hostHeight) return false;

  const scale = Math.min(hostWidth / sourceWidth, hostHeight / sourceHeight);
  if (!Number.isFinite(scale) || scale <= 0) return false;
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;

  host.style.overflow = "hidden";
  innerRoot.style.position = "absolute";
  innerRoot.style.left = `${(hostWidth - renderedWidth) / 2}px`;
  innerRoot.style.top = `${(hostHeight - renderedHeight) / 2}px`;
  innerRoot.style.width = `${sourceWidth}px`;
  innerRoot.style.height = `${sourceHeight}px`;
  innerRoot.style.maxWidth = "none";
  innerRoot.style.maxHeight = "none";
  innerRoot.style.transformOrigin = "0 0";
  innerRoot.style.scale = String(Number(scale.toFixed(6)));
  return true;
}

/** Install live aspect fitting for authored and already-bundled ending effects. */
export function installAspectFitCompositionHosts(root: ParentNode = document): () => void {
  const installed: HTMLElement[] = [];
  const hooked: AspectFitHost[] = [];
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      '[data-hf-content-fit], [data-composition-id^="effect-ending-"]',
    ),
  );
  for (const host of candidates) {
    const aspectFitHost = host as AspectFitHost;
    const refresh = () => applyAspectFitCompositionHost(host);
    aspectFitHost.__hfAspectFit = refresh;
    hooked.push(aspectFitHost);
    if (!refresh() || aspectFitObservers.has(host)) continue;
    const ResizeObserverCtor = host.ownerDocument.defaultView?.ResizeObserver;
    if (!ResizeObserverCtor) continue;
    const observer = new ResizeObserverCtor(refresh);
    observer.observe(host);
    aspectFitObservers.set(host, observer);
    installed.push(host);
  }
  return () => {
    for (const host of installed) {
      aspectFitObservers.get(host)?.disconnect();
      aspectFitObservers.delete(host);
    }
    for (const host of hooked) {
      delete host.__hfAspectFit;
    }
  };
}
