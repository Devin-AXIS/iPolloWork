import { safeVideoMediaPath, type MediaKind } from "@ipollowork/types/video-image-workbench";

export type DesignMedia = { kind: MediaKind; source: string; preview: string; background: boolean };

// Self-contained: the same implementation runs in the editor iframe and host.
export function designMediaTools() {
  const backgroundSelector = ":scope > video[data-ipw-media-background]";
  const source = (element: Element) =>
    element.getAttribute("data-ipw-preview-src") ?? element.getAttribute("src") ?? "";
  const videoSource = (element: Element) =>
    element.hasAttribute("src")
      ? element
      : element.querySelectorAll(":scope > source").length === 1
        ? element.querySelector(":scope > source")
        : null;
  const read = (element: HTMLElement): DesignMedia | null => {
    if (
      element.closest("picture,svg,canvas") ||
      element.parentElement?.closest("video") ||
      element.hasAttribute("srcset")
    )
      return null;
    if (element.tagName === "IMG")
      return {
        kind: "image",
        source: source(element),
        preview: element.getAttribute("src") ?? "",
        background: false,
      };
    const video = element.tagName === "VIDEO" ? element : element.querySelector(backgroundSelector);
    if (video) {
      const target = videoSource(video);
      return target
        ? {
            kind: "video",
            source: source(target),
            preview: target.getAttribute("src") ?? "",
            background: element !== video,
          }
        : null;
    }
    const background =
      element.getAttribute("data-ipw-preview-background") ??
      (element.style.backgroundImage ||
        element.ownerDocument.defaultView?.getComputedStyle(element).backgroundImage ||
        "");
    const match = background.match(/^url\(\s*["']?([^"')]+)["']?\s*\)$/i);
    return match
      ? {
          kind: "image",
          source: match[1],
          preview:
            element.style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/i)?.[1] ?? match[1],
          background: true,
        }
      : null;
  };
  const clearBackground = (element: HTMLElement) => {
    element.querySelector(backgroundSelector)?.remove();
    element.removeAttribute("data-ipw-preview-background");
  };
  const set = (element: HTMLElement, kind: MediaKind, src: string, preview?: string) => {
    if (!src || /^(javascript|vbscript):/i.test(src)) throw new Error("Invalid media source.");
    const existing = read(element);
    if (
      (element.tagName === "IMG" && kind !== "image") ||
      (element.tagName === "VIDEO" && kind !== "video")
    )
      throw new Error("The selected element uses a different media type.");
    let target: Element = element;
    if (element.tagName !== "IMG" && element.tagName !== "VIDEO") {
      if (/^(INPUT|BR|HR|SOURCE|CANVAS|SVG|PICTURE)$/.test(element.tagName))
        throw new Error("This element cannot contain a media fill.");
      if (kind === "image") {
        clearBackground(element);
        element.style.backgroundImage = `url("${preview ?? src}")`;
        if (preview) element.setAttribute("data-ipw-preview-background", `url("${src}")`);
        return;
      }
      let video = element.querySelector<HTMLVideoElement>(backgroundSelector);
      if (!video) {
        video = element.ownerDocument.createElement("video");
        video.setAttribute("data-ipw-media-background", "");
        video.setAttribute("muted", "");
        video.setAttribute("autoplay", "");
        video.setAttribute("loop", "");
        video.setAttribute("playsinline", "");
        video.muted = true;
        video.style.cssText =
          "position:absolute;inset:0;width:100%;height:100%;object-fit:inherit;object-position:inherit;pointer-events:none;z-index:-1;border-radius:inherit";
        const position = element.style.position || element.ownerDocument.defaultView?.getComputedStyle(element).position;
        if (!position || position === "static")
          element.style.position = "relative";
        element.style.isolation = "isolate";
        element.style.objectFit = element.style.objectFit || "cover";
        element.prepend(video);
      }
      element.removeAttribute("data-ipw-preview-background");
      element.style.backgroundImage = "none";
      target = video;
    }
    // Preserve layout/timing and override an authored <source> without treating frames as images.
    target.setAttribute("src", preview ?? src);
    if (preview) target.setAttribute("data-ipw-preview-src", src);
    else target.removeAttribute("data-ipw-preview-src");
    if (existing?.kind === "video")
      target.querySelectorAll(":scope > source").forEach((child) => child.remove());
  };
  const restore = (element: HTMLElement) => {
    const src = element.getAttribute("data-ipw-preview-src");
    if (src !== null) {
      element.setAttribute("src", src);
      element.removeAttribute("data-ipw-preview-src");
    }
    const background = element.getAttribute("data-ipw-preview-background");
    if (background !== null) {
      element.style.backgroundImage = background;
      element.removeAttribute("data-ipw-preview-background");
    }
  };
  return { read, set, restore, clearBackground };
}

// Previewing an existing file is broader than offering a model edit action
// (for example GIF/SVG/AVIF and extensionless image endpoints).
export function resolveDesignPreviewAssetPath(page: string, src: string): string | null {
  src = src.trim().split(/[?#]/, 1)[0] ?? "";
  if (!src || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(src) || /[?#]/.test(src)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    return null;
  }
  const parts = page.replaceAll("\\", "/").split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  const path = parts.join("/");
  return path && path.length <= 1000 && !/[\\\x00-\x1f?#:%"<>|]/.test(path) ? path : null;
}

export function resolveDesignMediaPath(page: string, src: string): string | null {
  if (/[?#]/.test(src)) return null;
  return safeVideoMediaPath(resolveDesignPreviewAssetPath(page, src));
}

export function relativeDesignMediaPath(page: string, asset: string): string {
  if (!safeVideoMediaPath(asset)) throw new Error("Invalid media path.");
  const from = page.split("/").slice(0, -1);
  const to = asset.split("/");
  while (from.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => ".."), ...to].join("/");
}

export function replaceDesignMedia(
  html: string,
  locator: string,
  originalElement: string,
  media: DesignMedia,
  path: string,
): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const element = doc.querySelector<HTMLElement>(locator);
  if (!element || element.outerHTML !== originalElement)
    throw new Error("The selected element changed. Reopen its media editor before replacing it.");
  designMediaTools().set(element, media.kind, path);
  return `${html.trimStart().toLowerCase().startsWith("<!doctype") ? "<!DOCTYPE html>\n" : ""}${doc.documentElement.outerHTML}`;
}

export async function hydrateDesignMedia(
  source: string,
  page: string,
  download: (path: string) => Promise<{ data: ArrayBuffer; contentType: string | null }>,
) {
  const doc = new DOMParser().parseFromString(source, "text/html");
  const urls = new Map<string, string>();
  const objectUrls: string[] = [];
  const tools = designMediaTools();
  // Serial and deduplicated: large videos must not multiply peak memory.
  for (const element of doc.querySelectorAll<HTMLElement>("img,video,[style]")) {
    const media: DesignMedia | null =
      element.tagName === "IMG"
        ? {
            kind: "image",
            source: element.getAttribute("src") ?? "",
            preview: "",
            background: false,
          }
        : tools.read(element);
    const path = media && resolveDesignPreviewAssetPath(page, media.source);
    if (!media || !path) continue;
    try {
      let preview = urls.get(path);
      if (!preview) {
        const file = await download(path);
        const extension = path.split(".").pop()?.toLowerCase() ?? "";
        const mime: Record<string, string> = {
          svg: "image/svg+xml",
          gif: "image/gif",
          avif: "image/avif",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          webp: "image/webp",
          mp4: "video/mp4",
          mov: "video/quicktime",
          webm: "video/webm",
        };
        preview = URL.createObjectURL(
          new Blob([file.data], {
            type:
              file.contentType && file.contentType !== "application/octet-stream"
                ? file.contentType
                : (mime[extension] ?? "application/octet-stream"),
          }),
        );
        urls.set(path, preview);
        objectUrls.push(preview);
      }
      // Do not restructure source elements or backgrounds merely to display a preview.
      if (media.background && media.kind === "image") {
        element.setAttribute("data-ipw-preview-background", element.style.backgroundImage);
        element.style.backgroundImage = `url("${preview}")`;
      } else {
        const video = media.background
          ? element.querySelector("video[data-ipw-media-background]")
          : element;
        const target = video?.hasAttribute("src") ? video : video?.querySelector("source");
        if (target) {
          target.setAttribute("data-ipw-preview-src", media.source);
          target.setAttribute("src", preview);
        }
      }
    } catch {
      /* Keep broken original references visible, never persist preview URLs. */
    }
  }
  return {
    source: `${source.trimStart().toLowerCase().startsWith("<!doctype") ? "<!DOCTYPE html>\n" : ""}${doc.documentElement.outerHTML}`,
    objectUrls,
  };
}
