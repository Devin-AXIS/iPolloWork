import { activateDeckExportSlide, PRESENTATION_SLIDE_SELECTOR } from "./deck-export";
import { buildDesignPreviewDocument } from "./design-html-runtime";
import { hydrateDesignMedia } from "./design-media";

export type DesignPreviewReviewKind = "site" | "slides";

type PreviewIssue = {
  code: "blank_surface" | "broken_media" | "horizontal_overflow" | "missing_slides";
  target: string;
  detail: string;
};

const siteViewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

async function waitForFrame(frame: HTMLIFrameElement, source: string) {
  return new Promise<Document>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Client preview timed out.")), 15_000);
    frame.addEventListener("load", async () => {
      try {
        const document = frame.contentDocument;
        if (!document) throw new Error("Client preview document is unavailable.");
        await document.fonts?.ready;
        await Promise.all(Array.from(document.images).map((image) => image.complete
          ? Promise.resolve()
          : new Promise<void>((resolveImage) => {
              image.addEventListener("load", () => resolveImage(), { once: true });
              image.addEventListener("error", () => resolveImage(), { once: true });
            })));
        window.clearTimeout(timeout);
        resolve(document);
      } catch (error) {
        window.clearTimeout(timeout);
        reject(error);
      }
    }, { once: true });
    frame.srcdoc = source;
  });
}

function visible(element: Element) {
  const rect = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return rect.width > 1 && rect.height > 1 && style?.display !== "none"
    && style?.visibility !== "hidden" && Number(style?.opacity ?? "1") > 0.01;
}

function surfaceIsBlank(root: HTMLElement) {
  const meaningful = root.querySelectorAll("h1,h2,h3,h4,p,li,button,a,img,video,svg,canvas,[data-pptx-text],[data-pptx-shape]");
  return !Array.from(meaningful).some((element) => {
    if (!visible(element)) return false;
    if (element.matches("img,video,svg,canvas,[data-pptx-shape]")) return true;
    return Boolean(element.textContent?.trim());
  });
}

function brokenMedia(root: ParentNode) {
  return [
    ...Array.from(root.querySelectorAll("img")).filter((image) => image.complete && image.naturalWidth === 0),
    ...Array.from(root.querySelectorAll("video")).filter((video) => video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE),
  ].length;
}

function horizontalOverflow(root: HTMLElement) {
  return Math.ceil(root.scrollWidth) > Math.ceil(root.clientWidth) + 4;
}

export async function reviewDesignPreview(input: {
  source: string;
  sourcePath: string;
  tokenCss: string;
  kind: DesignPreviewReviewKind;
  download: (path: string) => Promise<{ data: ArrayBuffer; contentType: string | null }>;
}) {
  const hydrated = await hydrateDesignMedia(input.source, input.sourcePath, input.download);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-100000px;top:0;border:0;opacity:0;pointer-events:none";
  document.body.append(frame);
  const issues: PreviewIssue[] = [];
  try {
    frame.style.width = `${input.kind === "slides" ? 1280 : siteViewports[0].width}px`;
    frame.style.height = `${input.kind === "slides" ? 720 : siteViewports[0].height}px`;
    const previewDocument = await waitForFrame(frame, buildDesignPreviewDocument(
      hydrated.source,
      false,
      input.tokenCss,
      false,
      input.kind === "slides",
      input.kind === "slides",
    ));

    if (input.kind === "site") {
      const viewports = [];
      for (const viewport of siteViewports) {
        frame.style.width = `${viewport.width}px`;
        frame.style.height = `${viewport.height}px`;
        await nextPaint();
        const body = previewDocument.body;
        const mediaFailures = brokenMedia(body);
        const overflow = horizontalOverflow(previewDocument.documentElement) || horizontalOverflow(body);
        if (surfaceIsBlank(body)) issues.push({ code: "blank_surface", target: viewport.name, detail: "The rendered page has no visible meaningful content." });
        if (mediaFailures) issues.push({ code: "broken_media", target: viewport.name, detail: `${mediaFailures} media element(s) failed to load.` });
        if (overflow) issues.push({ code: "horizontal_overflow", target: viewport.name, detail: "The page exceeds the viewport width." });
        viewports.push({ ...viewport, mediaFailures, horizontalOverflow: overflow });
      }
      return { passed: issues.length === 0, kind: input.kind, sourcePath: input.sourcePath, viewports, issues };
    }

    const slides = Array.from(previewDocument.querySelectorAll<HTMLElement>(PRESENTATION_SLIDE_SELECTOR))
      .filter((slide, index, entries) => entries.indexOf(slide) === index);
    if (!slides.length) issues.push({ code: "missing_slides", target: "deck", detail: "No recognized slide roots were rendered." });
    const pages = [];
    for (const [index, slide] of slides.entries()) {
      activateDeckExportSlide(slides, slide);
      await nextPaint();
      const target = `slide-${index + 1}`;
      const mediaFailures = brokenMedia(slide);
      const blank = surfaceIsBlank(slide);
      const overflow = horizontalOverflow(slide);
      if (blank) issues.push({ code: "blank_surface", target, detail: "The slide renders without visible meaningful content." });
      if (mediaFailures) issues.push({ code: "broken_media", target, detail: `${mediaFailures} media element(s) failed to load.` });
      if (overflow) issues.push({ code: "horizontal_overflow", target, detail: "The slide content exceeds its canvas width." });
      pages.push({ index: index + 1, blank, mediaFailures, horizontalOverflow: overflow });
    }
    return { passed: issues.length === 0, kind: input.kind, sourcePath: input.sourcePath, pageCount: pages.length, pages, issues };
  } finally {
    hydrated.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    frame.remove();
  }
}
