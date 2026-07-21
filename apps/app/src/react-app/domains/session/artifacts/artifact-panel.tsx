/** @jsxImportSource react */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, FolderOpen, Loader2, Presentation, X } from "lucide-react";

import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { getDesktopFileIcon, openDesktopPath, revealDesktopItemInDir } from "@/app/lib/desktop";
import { isElectronRuntime } from "@/app/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { cn, formatFileSize } from "@/lib/utils";
import { type ArtifactPanelTab, usePanelTabStore } from "../panel/panel-tab-store";
import { activateDeckExportSlide, PRESENTATION_SLIDE_SELECTOR } from "../design/deck-export";
import { buildDesignPreviewDocument } from "../design/design-html-runtime";
import {
  PPTX_BACKGROUND_IMAGE_FORMAT,
  PPTX_CAPTURE_SCALE,
  PPTX_SLIDE_HEIGHT_INCHES,
  PPTX_SLIDE_WIDTH_INCHES,
  deckPptxFileName,
} from "../design/pptx-export";
import { isCollectibleArtifactTarget, type BinaryData, type Data, type OpenTarget, type TextData } from "./open-target";
import { HTMLPreview, ImagePreview, MarkdownPreview, PdfPreview, PlainText, PreviewError, PreviewLoading, PreviewUnavailable } from "./preview";

const ArtifactTextEditor = lazy(() =>
  import("./artifact-text-editor").then((module) => ({ default: module.ArtifactTextEditor })),
);
const ArtifactSpreadsheetEditor = lazy(() =>
  import("./artifact-spreadsheet-editor").then((module) => ({ default: module.ArtifactSpreadsheetEditor })),
);

const EMPTY_TRANSCRIPT_TARGETS: OpenTarget[] = [];
const PDF_SLIDE_WIDTH = 1600;
const PDF_SLIDE_HEIGHT = 900;
const PDF_PAGE_WIDTH_MM = 297;
const PDF_PAGE_HEIGHT_MM = 167.0625;

type ArtifactPanelProps = {
  sessionId: string;
  tab: ArtifactPanelTab;
  client: iPolloWorkServerClient | null;
  workspaceId: string | null;
  workspaceRoot: string;
  isRemoteWorkspace?: boolean;
  onClose: () => void;
};

type ArtifactPanelViewProps = {
  client: iPolloWorkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  isRemoteWorkspace?: boolean;
  target: OpenTarget;
  onClose: () => void;
};

type ArtifactQueryState =
  | (TextData & { updatedAt: number | null })
  | (BinaryData & { contentType: string | null; updatedAt: number | null });

type SaveArtifactInput = Data & { baseUpdatedAt: number | null };

function absoluteWorkspacePath(root: string, path: string) {
  const cleanRoot = root.trim().replace(/[/\\]+$/, "");
  const cleanPath = path.trim().replace(/^\.\//, "");

  return cleanRoot ? `${cleanRoot}/${cleanPath}` : cleanPath;
}

function isTextContent(target: OpenTarget): boolean {
  return ["markdown", "text", "sheet", "html"].includes(target.preview) && !/\.(xlsx|xls|ods)$/i.test(target.value);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function preparePdfExportContent(source: HTMLElement) {
  const content = source.cloneNode(true);

  if (!(content instanceof HTMLElement)) {
    return null;
  }

  for (const element of [content, ...Array.from(content.querySelectorAll<HTMLElement>("*"))]) {
    const tagName = element.tagName.toLowerCase();

    element.removeAttribute("class");
    element.removeAttribute("style");
    element.style.boxSizing = "border-box";
    element.style.color = "#111827";
    element.style.borderColor = "#d1d5db";
    element.style.textDecorationColor = "currentColor";

    if (tagName === "h1") {
      element.style.margin = "20px 0 12px";
      element.style.fontSize = "24px";
      element.style.fontWeight = "700";
      element.style.lineHeight = "1.3";
    }
    else if (tagName === "h2") {
      element.style.margin = "18px 0 10px";
      element.style.fontSize = "20px";
      element.style.fontWeight = "700";
      element.style.lineHeight = "1.35";
    }
    else if (tagName === "h3" || tagName === "h4" || tagName === "h5" || tagName === "h6") {
      element.style.margin = "16px 0 8px";
      element.style.fontSize = "16px";
      element.style.fontWeight = "700";
      element.style.lineHeight = "1.4";
    }
    else if (tagName === "p") {
      element.style.margin = "10px 0";
    }
    else if (tagName === "ul" || tagName === "ol") {
      element.style.margin = "10px 0";
      element.style.paddingLeft = "24px";
    }
    else if (tagName === "li") {
      element.style.margin = "4px 0";
    }
    else if (tagName === "a") {
      element.style.color = "#4f46e5";
      element.style.textDecoration = "underline";
    }
    else if (tagName === "blockquote") {
      element.style.margin = "16px 0";
      element.style.padding = "10px 14px";
      element.style.borderLeft = "4px solid #d1d5db";
      element.style.backgroundColor = "#f9fafb";
      element.style.color = "#4b5563";
    }
    else if (tagName === "pre") {
      element.style.margin = "16px 0";
      element.style.padding = "12px";
      element.style.overflow = "visible";
      element.style.whiteSpace = "pre-wrap";
      element.style.border = "1px solid #d1d5db";
      element.style.borderRadius = "8px";
      element.style.backgroundColor = "#f9fafb";
      element.style.color = "#4b5563";
      element.style.fontFamily = "Consolas, monospace";
      element.style.fontSize = "12px";
    }
    else if (tagName === "code") {
      element.style.borderRadius = "4px";
      element.style.backgroundColor = element.closest("pre") ? "transparent" : "#f3f4f6";
      element.style.fontFamily = "Consolas, monospace";
      element.style.fontSize = "12px";
      element.style.padding = element.closest("pre") ? "0" : "2px 4px";
    }
    else if (tagName === "table") {
      element.style.width = "100%";
      element.style.margin = "16px 0";
      element.style.borderCollapse = "collapse";
    }
    else if (tagName === "th" || tagName === "td") {
      element.style.padding = "8px";
      element.style.border = "1px solid #d1d5db";
      element.style.textAlign = "left";
      element.style.verticalAlign = "top";
      if (tagName === "th") element.style.backgroundColor = "#f3f4f6";
    }
    else if (tagName === "hr") {
      element.style.margin = "24px 0";
      element.style.border = "0";
      element.style.height = "1px";
      element.style.backgroundColor = "#d1d5db";
    }
    else if (tagName === "img") {
      element.style.maxWidth = "100%";
      element.style.height = "auto";
      element.style.borderRadius = "8px";
    }
  }

  return content;
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function yieldForExportWork() {
  await waitForNextFrame();
  await new Promise<void>((resolve) => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 180 });
    } else {
      globalThis.setTimeout(resolve, 0);
    }
  });
}

function canvasHasVisibleContent(canvas: HTMLCanvasElement) {
  if (canvas.width === 0 || canvas.height === 0) return false;

  const context = canvas.getContext("2d");

  if (!context) return false;

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < data.length; index += 16) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];

    if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) {
      return true;
    }
  }

  return false;
}

function createPdfExportFrame(content: HTMLElement) {
  const frame = document.createElement("iframe");

  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.left = "0";
  frame.style.top = "0";
  frame.style.width = "794px";
  frame.style.height = "1123px";
  frame.style.border = "0";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";
  document.body.append(frame);

  const frameDocument = frame.contentDocument;

  if (!frameDocument) {
    frame.remove();

    return null;
  }

  frameDocument.documentElement.style.backgroundColor = "#ffffff";
  frameDocument.body.style.margin = "0";
  frameDocument.body.style.backgroundColor = "#ffffff";

  const root = frameDocument.createElement("div");

  root.style.boxSizing = "border-box";
  root.style.width = "794px";
  root.style.minHeight = "1123px";
  root.style.padding = "32px";
  root.style.overflow = "visible";
  root.style.backgroundColor = "#ffffff";
  root.style.color = "#111827";
  root.style.fontFamily = "Arial, sans-serif";
  root.style.fontSize = "14px";
  root.style.lineHeight = "1.65";
  root.append(frameDocument.importNode(content, true));
  frameDocument.body.append(root);

  return { frame, root };
}

async function createMarkdownPdf(source: HTMLElement) {
  const content = preparePdfExportContent(source);

  if (!content) throw new Error("Could not prepare this PDF.");

  const exportFrame = createPdfExportFrame(content);

  if (!exportFrame) throw new Error("Could not prepare this PDF.");

  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas-pro"),
      import("jspdf"),
    ]);

    await waitForNextFrame();

    const captureHeight = Math.max(exportFrame.root.scrollHeight, exportFrame.root.offsetHeight, 1);
    const canvas = await html2canvas(exportFrame.root, {
      backgroundColor: "#ffffff",
      scale: 1.5,
      useCORS: true,
      width: 794,
      height: captureHeight,
      windowWidth: 794,
      windowHeight: captureHeight,
    });

    if (!canvasHasVisibleContent(canvas)) {
      throw new Error("PDF capture was blank. Please try again after the preview finishes rendering.");
    }

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const imageWidth = pageWidth - margin * 2;
    const imageHeight = pageHeight - margin * 2;
    const pageHeightPixels = Math.max(1, Math.floor(canvas.width * imageHeight / imageWidth));

    for (let top = 0, page = 0; top < canvas.height; top += pageHeightPixels, page += 1) {
      const sliceHeight = Math.min(pageHeightPixels, canvas.height - top);
      const pageCanvas = document.createElement("canvas");
      const pageContext = pageCanvas.getContext("2d");

      if (!pageContext) throw new Error("Could not prepare this PDF.");

      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeight;
      pageContext.fillStyle = "#ffffff";
      pageContext.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      pageContext.drawImage(canvas, 0, top, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

      if (page > 0) pdf.addPage();

      const pageHeightMm = sliceHeight * imageWidth / canvas.width;
      const pageImage = pageCanvas.toDataURL("image/jpeg", 0.88);

      pdf.addImage(pageImage, "JPEG", margin, margin, imageWidth, pageHeightMm, undefined, "FAST");
    }

    return pdf.output("blob");
  } finally {
    exportFrame.frame.remove();
  }
}

function hasPresentationSlides(source: string) {
  return /(?:data-ipw-slide|class=["'][^"']*(?:slide|slide-frame)\b|<section\b[^>]*class=["'][^"']*\bslide\b)/i.test(source);
}

function sanitizeExportFileBaseName(value: string | undefined) {
  return (value ?? "")
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 96);
}

function presentationExportBaseName(document: Document, target: OpenTarget) {
  const candidates = [
    document.querySelector<HTMLMetaElement>("meta[property='og:title'],meta[name='title'],meta[name='ipw-title']")?.content,
    document.title,
    document.querySelector<HTMLElement>(PRESENTATION_SLIDE_SELECTOR)?.querySelector<HTMLElement>("h1,h2,[data-ipw-title],[data-title]")?.textContent,
    target.name.replace(/\.[^.]+$/, ""),
  ];
  return candidates.map(sanitizeExportFileBaseName).find(Boolean) || "presentation";
}

async function waitForPresentationExportFrame(frame: HTMLIFrameElement) {
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Timed out preparing the presentation.")), 10_000);
    frame.addEventListener("load", () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
  const document = frame.contentDocument;
  if (!document) throw new Error("Could not prepare the presentation.");
  await document.fonts?.ready;
  await Promise.all(Array.from(document.images).map((image) => image.complete
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      })));
}

async function withPresentationExportFrame<T>(source: string, run: (frameDocument: Document) => Promise<T>) {
  const frame = document.createElement("iframe");

  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.left = "-2000px";
  frame.style.top = "0";
  frame.style.width = `${PDF_SLIDE_WIDTH}px`;
  frame.style.height = `${PDF_SLIDE_HEIGHT}px`;
  frame.style.border = "0";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";
  document.body.append(frame);

  try {
    frame.srcdoc = buildDesignPreviewDocument(source, false, "", false, false, true);
    await waitForPresentationExportFrame(frame);
    if (!frame.contentDocument) throw new Error("Could not prepare the presentation.");
    return await run(frame.contentDocument);
  } finally {
    frame.remove();
  }
}

async function createPresentationPdf(source: string, target: OpenTarget) {
  return withPresentationExportFrame(source, async (frameDocument) => {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
    const slides = Array.from(frameDocument.querySelectorAll<HTMLElement>(PRESENTATION_SLIDE_SELECTOR))
      .filter((slide, index, list) => list.indexOf(slide) === index);
    if (!slides.length) throw new Error("Could not find slides to export.");

    const pdf = new jsPDF({ unit: "mm", format: [PDF_PAGE_WIDTH_MM, PDF_PAGE_HEIGHT_MM], orientation: "landscape", compress: true });
    slides.forEach((slide) => slide.removeAttribute("hidden"));

    for (const [index, slide] of slides.entries()) {
      activateDeckExportSlide(slides, slide);
      slide.style.width = `${PDF_SLIDE_WIDTH}px`;
      slide.style.height = `${PDF_SLIDE_HEIGHT}px`;
      slide.style.maxWidth = `${PDF_SLIDE_WIDTH}px`;
      slide.style.maxHeight = `${PDF_SLIDE_HEIGHT}px`;
      slide.style.margin = "0";
      slide.style.overflow = "hidden";
      await yieldForExportWork();

      const canvas = await html2canvas(slide, {
        backgroundColor: null,
        scale: 1.5,
        useCORS: true,
        width: PDF_SLIDE_WIDTH,
        height: PDF_SLIDE_HEIGHT,
        windowWidth: PDF_SLIDE_WIDTH,
        windowHeight: PDF_SLIDE_HEIGHT,
      });
      if (!canvasHasVisibleContent(canvas)) throw new Error("PDF capture was blank. Please try again after the preview finishes rendering.");
      if (index > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, PDF_PAGE_WIDTH_MM, PDF_PAGE_HEIGHT_MM, undefined, "FAST");
    }

    return { blob: pdf.output("blob"), filename: `${presentationExportBaseName(frameDocument, target)}.pdf` };
  });
}

async function createPresentationPptx(source: string, target: OpenTarget) {
  return withPresentationExportFrame(source, async (frameDocument) => {
    const [{ default: PptxGenJS }, { default: html2canvas }] = await Promise.all([import("pptxgenjs"), import("html2canvas-pro")]);
    const slides = Array.from(frameDocument.querySelectorAll<HTMLElement>(PRESENTATION_SLIDE_SELECTOR))
      .filter((slide, index, list) => list.indexOf(slide) === index);
    if (!slides.length) throw new Error("Could not find slides to export.");

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "iPolloWork";
    pptx.title = presentationExportBaseName(frameDocument, target);
    slides.forEach((slide) => slide.removeAttribute("hidden"));

    for (const slide of slides) {
      activateDeckExportSlide(slides, slide);
      slide.style.width = `${PDF_SLIDE_WIDTH}px`;
      slide.style.height = `${PDF_SLIDE_HEIGHT}px`;
      slide.style.maxWidth = `${PDF_SLIDE_WIDTH}px`;
      slide.style.maxHeight = `${PDF_SLIDE_HEIGHT}px`;
      slide.style.margin = "0";
      slide.style.overflow = "hidden";
      await yieldForExportWork();

      const canvas = await html2canvas(slide, {
        backgroundColor: null,
        scale: PPTX_CAPTURE_SCALE,
        useCORS: true,
        width: PDF_SLIDE_WIDTH,
        height: PDF_SLIDE_HEIGHT,
        windowWidth: PDF_SLIDE_WIDTH,
        windowHeight: PDF_SLIDE_HEIGHT,
      });
      if (!canvasHasVisibleContent(canvas)) throw new Error("PPTX capture was blank. Please try again after the preview finishes rendering.");
      pptx.addSlide().addImage({
        data: canvas.toDataURL(PPTX_BACKGROUND_IMAGE_FORMAT),
        x: 0,
        y: 0,
        w: PPTX_SLIDE_WIDTH_INCHES,
        h: PPTX_SLIDE_HEIGHT_INCHES,
      });
    }

    await pptx.writeFile({ fileName: deckPptxFileName(presentationExportBaseName(frameDocument, target)) });
  });
}

export function ArtifactPanel({ sessionId, tab, client, workspaceId, workspaceRoot, isRemoteWorkspace = false, onClose }: ArtifactPanelProps) {
  const transcriptTargets = usePanelTabStore((state) => state.transcriptArtifactTargets[sessionId] ?? EMPTY_TRANSCRIPT_TARGETS);
  const artifactTargets = useMemo(() => transcriptTargets.filter(isCollectibleArtifactTarget), [transcriptTargets]);
  const target = artifactTargets.find((item) => item.id === tab.id) ?? null;

  if (!target || !client || !workspaceId) {
    return null;
  }

  return (
    <ArtifactPanelView
      client={client}
      workspaceId={workspaceId}
      workspaceRoot={workspaceRoot}
      isRemoteWorkspace={isRemoteWorkspace}
      target={target}
      onClose={onClose}
    />
  );
}

function ArtifactPanelView({ client, workspaceId, workspaceRoot, isRemoteWorkspace = false, target, onClose }: ArtifactPanelViewProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [autoSaveBlockedDraft, setAutoSaveBlockedDraft] = useState<string | null>(null);
  const [isPdfGenerating, setIsPdfGenerating] = useState(false);
  const [isPptxGenerating, setIsPptxGenerating] = useState(false);
  const visibleMarkdownRef = useRef<HTMLDivElement | null>(null);
  const pdfContentRef = useRef<HTMLDivElement | null>(null);
  const isDirectTextEdit = isTextContent(target) && target.preview === "markdown";
  const externalPath = useMemo(() => target.kind === "file" ? absoluteWorkspacePath(workspaceRoot, target.value) : target.value, [target.kind, target.value, workspaceRoot]);

  const { data: fileIcon } = useQuery<string | null>({
    queryKey: ["desktop-file-icon", externalPath] as const,
    queryFn: async () => getDesktopFileIcon(externalPath, "small"),
    enabled: target.kind === "file" && !isRemoteWorkspace && isElectronRuntime(),
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });

  const { data, error, isError, isLoading } = useQuery<ArtifactQueryState>({
    queryKey: ["artifact-panel", workspaceId, target.id] as const,
    queryFn: async () => {
      if (target.kind === "url") {
        throw new Error("URLs open in browser tabs.");
      }
      else if (target.exists === false) {
        throw new Error("File not found in this workspace.");
      }

      if (isTextContent(target)) {
        const result = await client.readWorkspaceFile(workspaceId, target.value);

        return { kind: "text", data: result.content, updatedAt: result.updatedAt ?? null };
      }

      const result = await client.downloadWorkspaceFile(workspaceId, target.value);

      return { kind: "binary", data: result.data, contentType: result.contentType, updatedAt: target.updatedAt ?? null };
    },
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const [binaryObjectUrl, setBinaryObjectUrl] = useState<string | null>(null);
  const isPresentationHtml = target.kind === "file" && target.preview === "html" && data?.kind === "text" && hasPresentationSlides(draft);

  useEffect(() => {
    if (!data || data.kind !== "binary") {
      setBinaryObjectUrl(null);

      return;
    }

    const fallbackType = target.preview === "pdf" ? "application/pdf" : "application/octet-stream";
    const url = URL.createObjectURL(new Blob([data.data], { type: data.contentType ?? fallbackType }));

    setBinaryObjectUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [data, target.preview]);

  useEffect(() => {
    setEditing(false);
    setDraft("");
    setAutoSaveBlockedDraft(null);
  }, [target.id, workspaceId]);

  useEffect(() => {
    if (data?.kind === "text") {
      setDraft(data.data);
    }
  }, [data]);

  const { mutate, mutateAsync, isPending: isSaving } = useMutation({
    mutationFn: async (input: SaveArtifactInput) => {
      if (target.kind !== "file") {
        throw new Error("Cannot save non-file artifact.");
      }

      if (input.kind === "text") {
        return client.writeWorkspaceFile(workspaceId, { path: target.value, content: input.data, baseUpdatedAt: input.baseUpdatedAt });
      }

      return client.writeWorkspaceBinaryFile(workspaceId, { path: target.value, data: input.data, baseUpdatedAt: input.baseUpdatedAt });
    },
    onSuccess: (result, input) => {
      queryClient.setQueryData<ArtifactQueryState>(
        ["artifact-panel", workspaceId, target.id] as const,
        input.kind === "text"
          ? { kind: "text", data: input.data, updatedAt: result.updatedAt ?? null }
          : { kind: "binary", data: input.data, contentType: data?.kind === "binary" ? data.contentType : null, updatedAt: result.updatedAt ?? null },
      );

      if (input.kind === "text") {
        setDraft((current) => current === input.data ? input.data : current);
      }
      setAutoSaveBlockedDraft(null);
    },
    onError: (cause, input) => {
      if (input.kind === "text") setAutoSaveBlockedDraft(input.data);
      toast.error(cause instanceof Error ? cause.message : t("artifact.could_not_save_file"));
    },
  });

  useEffect(() => {
    if (
      !isDirectTextEdit ||
      target.kind !== "file" ||
      data?.kind !== "text" ||
      draft === data.data ||
      draft === autoSaveBlockedDraft ||
      isSaving
    ) return;

    const timer = window.setTimeout(() => {
      mutate({ kind: "text", data: draft, baseUpdatedAt: data.updatedAt });
    }, 800);

    return () => window.clearTimeout(timer);
  }, [autoSaveBlockedDraft, data, draft, isDirectTextEdit, isSaving, mutate, target.kind]);

  const download = async () => {
    if (target.kind === "url") {
      return;
    }

    const result = await client.downloadWorkspaceFile(workspaceId, target.value);

    downloadBlob(new Blob([result.data], { type: result.contentType ?? "application/octet-stream" }), target.name);
  };

  const downloadMarkdown = () => {
    if (target.kind !== "file" || target.preview !== "markdown" || data?.kind !== "text") {
      return;
    }

    downloadBlob(new Blob([draft], { type: "text/markdown;charset=utf-8" }), target.name);
  };

  const downloadPdf = async () => {
    if (target.kind !== "file" || target.preview !== "markdown" || data?.kind !== "text" || isPdfGenerating) {
      return;
    }

    const content = pdfContentRef.current ?? visibleMarkdownRef.current;

    if (!content) {
      toast.error("Could not prepare this PDF.");

      return;
    }

    setIsPdfGenerating(true);

    try {
      const filename = target.name.replace(/\.(md|markdown|mdx)$/i, ".pdf");
      const pdf = await createMarkdownPdf(content);

      downloadBlob(pdf, filename);

      toast.success("PDF downloaded.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not download this PDF.");
    } finally {
      setIsPdfGenerating(false);
    }
  };

  const downloadPresentationPdf = async () => {
    if (target.kind !== "file" || target.preview !== "html" || data?.kind !== "text" || isPdfGenerating) {
      return;
    }

    setIsPdfGenerating(true);

    try {
      const { blob, filename } = await createPresentationPdf(draft, target);
      downloadBlob(blob, filename);
      toast.success("PDF downloaded.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not download this PDF.");
    } finally {
      setIsPdfGenerating(false);
    }
  };

  const downloadPresentationPptx = async () => {
    if (target.kind !== "file" || target.preview !== "html" || data?.kind !== "text" || isPptxGenerating) {
      return;
    }

    setIsPptxGenerating(true);

    try {
      await createPresentationPptx(draft, target);
      toast.success("PPTX downloaded.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not download this PPTX.");
    } finally {
      setIsPptxGenerating(false);
    }
  };

  const openExternal = async () => {
    if (target.kind === "url") {
      window.open(target.value, "_blank", "noopener,noreferrer");

      return;
    }
    else if (!isRemoteWorkspace) {
      try {
        await openDesktopPath(externalPath);
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "Could not open this file.");
      }

      return;
    }

    await download();
  };

  const revealExternal = async () => {
    if (target.kind !== "file" || isRemoteWorkspace) return;
    try {
      await revealDesktopItemInDir(externalPath);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not show this file in your file manager.");
    }
  };

  const save = () => {
    if (target.kind !== "file" || !isTextContent(target) || data?.kind !== "text") {
      return;
    }

    mutate(
      {
        kind: "text",
        data: draft,
        baseUpdatedAt: data.updatedAt,
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  const close = async () => {
    if (isDirectTextEdit && target.kind === "file" && data?.kind === "text" && draft !== data.data) {
      try {
        await mutateAsync({ kind: "text", data: draft, baseUpdatedAt: data.updatedAt });
      } catch {
        return;
      }
    }
    onClose();
  };

  const saveStatus = isSaving
    ? t("artifact.status_saving")
    : data?.kind === "text" && draft === data.data
      ? t("artifact.status_saved")
      : draft === autoSaveBlockedDraft
        ? t("artifact.status_save_failed")
        : t("artifact.status_unsaved");

  const saveSpreadsheetContent = async (payload: Data) => {
    if (target.kind !== "file") {
      return;
    }

    await mutateAsync({
      ...payload,
      baseUpdatedAt: data?.kind === payload.kind ? data.updatedAt : target.updatedAt ?? null,
    });
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      {isPdfGenerating ? (
        <div className="pointer-events-none absolute left-1/2 top-3 z-50 inline-flex -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
          <Loader2 className="size-3.5 animate-spin" />
          <span>正在生成PDF~</span>
        </div>
      ) : null}
      <div className="shrink-0 border-b border-border bg-background mac:bg-background/80 mac:backdrop-blur-2xl mac:backdrop-saturate-150">
        <div className="flex h-10 items-center gap-2 pe-2 ps-4">
          <div className="min-w-0 flex-1 flex items-center gap-1.5">
            {fileIcon ? (
              <img src={fileIcon} alt="" className="h-4 w-4 shrink-0 object-contain" />
            ) : null}
            <h3 className="min-w-0 truncate text-sm font-medium text-foreground">
              {target.name}
            </h3>
            <span className="shrink-0 text-xs text-muted-foreground">
              {target.exists === false ? t("artifact.missing") : target.size !== undefined ? `${formatFileSize(target.size)}` : ""}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
          {isTextContent(target) && data?.kind === "text" ? (
            isDirectTextEdit ? (
              <button
                type="button"
                className={cn(
                  "rounded-lg px-2 py-1 text-[11px] transition-colors",
                  saveStatus === t("artifact.status_save_failed") ? "text-destructive hover:bg-destructive/10" : "text-muted-foreground",
                )}
                disabled={saveStatus !== t("artifact.status_save_failed")}
                title={saveStatus === t("artifact.status_save_failed") ? t("artifact.retry_save") : saveStatus}
                onClick={() => {
                  if (target.kind !== "file") return;
                  setAutoSaveBlockedDraft(null);
                  mutate({ kind: "text", data: draft, baseUpdatedAt: data.updatedAt });
                }}
              >
                {saveStatus}
              </button>
            ) : editing ? (
              <>
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (data?.kind === "text") {
                            setDraft(data.data);
                          }
                          setEditing(false);
                        }}
                        disabled={isSaving}
                      >
                        {t("artifact.discard")}
                      </Button>
                    )}
                  />
                  <TooltipContent>{t("artifact.discard_changes")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={(
                    <Button variant="default" size="sm" onClick={() => void save()} disabled={isSaving || draft === data.data}>{isSaving ? t("artifact.saving") : t("common.save")}</Button>
                    )}
                  />
                  <TooltipContent>{t("artifact.save_changes")}</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>{t("common.edit")}</Button>
                  )}
                />
                <TooltipContent>{t("artifact.edit_artifact")}</TooltipContent>
              </Tooltip>
            )
          ) : null}
          {isPresentationHtml ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={(
                  <Button variant="ghost" size="icon-sm" aria-label={t("artifact.download_options")}>
                    {isPdfGenerating || isPptxGenerating ? <Loader2 className="animate-spin" /> : <Download />}
                  </Button>
                )}
              />
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem disabled={isPdfGenerating} onClick={() => void downloadPresentationPdf()}>
                  {isPdfGenerating ? <Loader2 className="animate-spin" /> : <Download />}
                  {t("design.export.download_pdf")}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={isPptxGenerating} onClick={() => void downloadPresentationPptx()}>
                  {isPptxGenerating ? <Loader2 className="animate-spin" /> : <Presentation />}
                  {t("design.export.download_pptx")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : target.kind === "file" && target.preview === "markdown" ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={(
                  <Button variant="ghost" size="icon-sm" aria-label={t("artifact.download_options")}>
                    <Download />
                  </Button>
                )}
              />
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={downloadMarkdown}>
                  下载MarkDown文件
                </DropdownMenuItem>
                <DropdownMenuItem disabled={isPdfGenerating} onClick={() => void downloadPdf()}>
                  下载PDF文件
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : target.kind === "file" ? (
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Button variant="ghost" size="icon-sm" onClick={() => void download()} aria-label={t("artifact.download_artifact")}>
                    <Download />
                  </Button>
                )}
              />
              <TooltipContent>{t("artifact.download_artifact")}</TooltipContent>
            </Tooltip>
          ) : null}
          {target.kind === "file" && !isRemoteWorkspace ? (
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Button variant="ghost" size="icon-sm" onClick={() => void revealExternal()} aria-label={t("artifact.show_in_folder")}>
                    <FolderOpen />
                  </Button>
                )}
              />
              <TooltipContent>{t("artifact.show_in_folder")}</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button variant="ghost" size="icon-sm" onClick={() => void openExternal()} aria-label={isRemoteWorkspace ? t("artifact.download_artifact") : t("artifact.open_externally")}>
                  <ExternalLink />
                </Button>
              )}
            />
            <TooltipContent>{isRemoteWorkspace ? t("artifact.download_artifact") : t("artifact.open_externally")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button variant="ghost" size="icon-sm" onClick={() => void close()} aria-label={t("artifact.close_artifact")}>
                  <X />
                </Button>
              )}
            />
            <TooltipContent>{t("artifact.close_artifact")}</TooltipContent>
          </Tooltip>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading || (data?.kind === "binary" && !binaryObjectUrl) ? (
          <PreviewLoading />
        ) : isError ? (
          <PreviewError message={error instanceof Error ? error.message : t("artifact.failed_to_load")} />
        ) : data?.kind === "text" && (editing || isDirectTextEdit) ? (
          <TextEditor value={draft} language={target.preview === "markdown" ? "markdown" : "text"} onChange={setDraft} />
        ) : target.preview === "markdown" && data?.kind === "text" ? (
          <MarkdownPreview ref={visibleMarkdownRef} content={data.data} />
        ) : target.preview === "sheet" ? (
          <SheetEditor
            name={target.name}
            content={data ?? { kind: "binary", data: new ArrayBuffer(0) }}
            saving={isSaving}
            onSave={saveSpreadsheetContent}
          />
        ) : target.preview === "html" && data?.kind === "text" ? (
          <HTMLPreview type="text" title={target.name} content={data.data} />
        ) : target.preview === "image" && data?.kind === "binary" && binaryObjectUrl ? (
          <ImagePreview src={binaryObjectUrl} alt={target.name} />
        ) : target.preview === "pdf" && data?.kind === "binary" && binaryObjectUrl ? (
          <PdfPreview url={binaryObjectUrl} title={target.name} />
        ) : data?.kind === "binary" && binaryObjectUrl && target.preview === "html" ? (
          <HTMLPreview type="binary" title={target.name} url={binaryObjectUrl} />
        ) : data?.kind === "text" ? (
          <PlainText content={data.data} />
        ) : (
          <PreviewUnavailable />
        )}
      </div>
      {target.preview === "markdown" && data?.kind === "text" ? (
        <div aria-hidden="true" className="pointer-events-none fixed left-[-10000px] top-0 w-[794px]" style={{ backgroundColor: "#ffffff", color: "#111827" }}>
          <MarkdownPreview ref={pdfContentRef} content={draft} data-pdf-export-root="" className="h-auto min-h-0 overflow-visible" />
        </div>
      ) : null}
    </div>
  );
}

interface TextEditorProps extends React.ComponentProps<typeof ArtifactTextEditor> {
  value: string;
  language: "markdown" | "text";
  onChange: (value: string) => void;
}

function TextEditor({ value, language, onChange, ...props }: TextEditorProps) {
  return (
    <Suspense fallback={<PreviewLoading />}>
      <ArtifactTextEditor value={value} language={language} onChange={onChange} {...props} />
    </Suspense>
  );
}

interface SheetEditorProps extends React.ComponentProps<typeof ArtifactSpreadsheetEditor> {

}

function SheetEditor({ className, ...props }: SheetEditorProps) {
  return (
    <Suspense fallback={<PreviewLoading />}>
      <ArtifactSpreadsheetEditor
        className={className}
        {...props}
      />
    </Suspense>
  );
}
