// Reveal the original avatar through background-only leaves, keeping scene
// text and graphics in their authored animated containers.
const backgroundSelector = '[data-layer-role="background"], .scene-fill, .background, .backdrop, .bg, .scene.clip';
const maskProperties = ["mask-image", "mask-size", "mask-repeat"] as const;
const previousMasks = new Map<HTMLElement, Array<[string, string]>>();
const previousOwnerBackgrounds = new Map<HTMLElement, Array<[string, string]>>();
const backgroundProxies = new Map<HTMLElement, HTMLElement>();

function restoreMask(element: HTMLElement): void {
  const previous = previousMasks.get(element);
  if (!previous) return;
  maskProperties.forEach((property, index) => {
    const [value, priority] = previous[index]!;
    if (value) element.style.setProperty(property, value, priority);
    else element.style.removeProperty(property);
  });
  previousMasks.delete(element);
}

function backgroundIsVisible(style: CSSStyleDeclaration): boolean {
  return style.backgroundImage !== "none" || !/^(?:|rgba?\(0, 0, 0, 0\)|transparent)$/i.test(style.backgroundColor);
}

function ensureBackgroundProxy(owner: HTMLElement): HTMLElement | null {
  let proxy = backgroundProxies.get(owner);
  if (proxy) return proxy;
  const style = getComputedStyle(owner);
  if (!backgroundIsVisible(style)) return null;
  if (!proxy) {
    proxy = document.createElement("div");
    proxy.dataset.avatarBackgroundProxy = "true";
    proxy.setAttribute("aria-hidden", "true");
    proxy.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:-1";
    owner.prepend(proxy);
    backgroundProxies.set(owner, proxy);
    previousOwnerBackgrounds.set(owner, ["background-image", "background-color", "isolation"].map((property) => [
      owner.style.getPropertyValue(property), owner.style.getPropertyPriority(property),
    ]));
  }
  proxy.style.background = style.background;
  proxy.style.borderRadius = style.borderRadius;
  owner.style.setProperty("background-image", "none", "important");
  owner.style.setProperty("background-color", "transparent", "important");
  owner.style.setProperty("isolation", "isolate");
  return proxy;
}

function removeBackgroundProxy(owner: HTMLElement): void {
  const previous = previousOwnerBackgrounds.get(owner);
  if (previous) ["background-image", "background-color", "isolation"].forEach((property, index) => {
    const [value, priority] = previous[index]!;
    if (value) owner.style.setProperty(property, value, priority);
    else owner.style.removeProperty(property);
  });
  const proxy = backgroundProxies.get(owner);
  if (proxy) {
    restoreMask(proxy);
    proxy.remove();
  }
  previousOwnerBackgrounds.delete(owner);
  backgroundProxies.delete(owner);
}

function backgroundWindow(background: HTMLElement, source: HTMLVideoElement, rect: DOMRect): string {
  let branch: HTMLElement | null = background;
  while (branch && branch.parentElement !== source.parentElement) branch = branch.parentElement;
  if (!branch || branch === source ||
    (Number(getComputedStyle(branch).zIndex) || 0) < (Number(getComputedStyle(source).zIndex) || 0)) return "";
  const video = source.getBoundingClientRect();
  const left = Math.max(rect.left, video.left);
  const top = Math.max(rect.top, video.top);
  const right = Math.min(rect.right, video.right);
  const bottom = Math.min(rect.bottom, video.bottom);
  if (right <= left || bottom <= top) return "";
  const x = (left - rect.left) / rect.width * 10000;
  const y = (top - rect.top) / rect.height * 10000;
  const width = (right - left) / rect.width * 10000;
  const height = (bottom - top) / rect.height * 10000;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="black"/>`;
}

/** Called after timeline visibility, in both preview and deterministic render. */
export function syncAvatarBackgrounds(): void {
  const sources = Array.from(document.querySelectorAll<HTMLVideoElement>("video[data-avatar-cutout]"))
    .filter((source) => {
      const foreground = document.getElementById(source.dataset.avatarCutout || "");
      const style = getComputedStyle(source);
      return foreground?.dataset.avatarSource === source.id &&
        foreground.parentElement === source.parentElement &&
        style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
    });
  const updated = new Set<HTMLElement>();
  const updatedOwners = new Set<HTMLElement>();
  if (sources.length) for (const background of document.querySelectorAll<HTMLElement>(backgroundSelector)) {
    const rect = background.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const ownsContent = Boolean(background.childElementCount || background.textContent?.trim());
    const maskTarget = ownsContent ? ensureBackgroundProxy(background) : background;
    if (!maskTarget) continue;
    if (ownsContent) updatedOwners.add(background);
    const windows = sources.map((source) => backgroundWindow(maskTarget, source, rect)).join("");
    if (!windows) continue;
    // Preserve any authored mask with its own transparency contract.
    if (!previousMasks.has(maskTarget)) {
      const authored = getComputedStyle(maskTarget).maskImage;
      if (authored && authored !== "none") continue;
      previousMasks.set(maskTarget, maskProperties.map((property) => [
        maskTarget.style.getPropertyValue(property), maskTarget.style.getPropertyPriority(property),
      ]));
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10000 10000" preserveAspectRatio="none"><defs><mask id="cutout"><rect width="10000" height="10000" fill="white"/>${windows}</mask></defs><rect width="10000" height="10000" fill="white" mask="url(#cutout)"/></svg>`;
    const image = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    if (maskTarget.style.maskImage !== image) maskTarget.style.maskImage = image;
    maskTarget.style.maskSize = "100% 100%";
    maskTarget.style.maskRepeat = "no-repeat";
    updated.add(maskTarget);
  }
  for (const background of previousMasks.keys()) {
    if (!updated.has(background)) restoreMask(background);
  }
  for (const owner of backgroundProxies.keys()) {
    if (!updatedOwners.has(owner)) removeBackgroundProxy(owner);
  }
}
