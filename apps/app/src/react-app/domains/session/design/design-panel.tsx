/** @jsxImportSource react */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlignCenter, AlignLeft, AlignRight, ArrowLeft, Check, ChevronLeft, ChevronRight, Code2, ExternalLink, ImagePlus, Link2, Loader2, Minus, Monitor, MousePointer2, Move, Palette, Paintbrush, Plus, RotateCcw, Save, Share2, SlidersHorizontal, Smartphone, Sparkles, Square, Type, Undo2, Upload, X } from "lucide-react";

import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { pickLocalImageFile, readLocalImageAsDataUrl } from "@/app/lib/desktop";
import { downloadBlobAsFile } from "@/app/lib/download";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { isPptxCompatibleTemplate } from "@ipollowork/types/templates";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import {
  buildDesignPreviewDocument,
  DESIGN_MESSAGE_CHANNEL,
  DESIGN_STYLE_FIELDS,
  isLocalHtmlPath,
  resolveDesignNavigationPath,
  type DesignField,
  type DesignDeckState,
  type DesignRuntimeMessage,
  type DesignSelection,
  type DesignStyleField,
} from "./design-html-runtime";
import { DesignExportMenu } from "./design-export-menu";
import { DesignSystemDrawer, type DesignTokenValues } from "./design-system-drawer";
import type { SidePanelLauncherItem } from "../panel/side-panel";
import {
  downgradeUnsupportedPdfExportColors,
  downgradeUnsupportedPdfExportColorText,
} from "./pdf-export-colors";
import {
  deckPptxFileName,
  PPTX_EXPORT_CONFIRMATION,
  PPTX_BACKGROUND_IMAGE_FORMAT,
  PPTX_CAPTURE_SCALE,
} from "./pptx-export";
import { activateDeckExportSlide, PRESENTATION_SLIDE_SELECTOR } from "./deck-export";
import {
  PRESENTATION_CANVAS_HEIGHT,
  PRESENTATION_CANVAS_WIDTH,
  presentationCanvasScale,
} from "./presentation-canvas";
import {
  collectPptxBackgroundPlan,
  collectPptxElementPlans,
  hasPptxCapturedPseudoElement,
  pptxExportSummary,
  pptxPlanCoverage,
  pptxPlanCoversVisual,
  pptxVisualElementPaints,
  slideHasVisiblePptxContent,
  validatePptxElementPlanCoverage,
} from "./pptx-element-export";
import {
  collectPptxCompatibleObjects,
  hasPptxCompatibleObjectMarkers,
  normalizePptxCompatibleMarkers,
  pptxCompatibleSlideBackground,
  removePptxCompatibleRuntimeArtifacts,
} from "./pptx-compatible-export";
import { isPptxExportElement, isPptxExportSvg } from "./pptx-dom";
import {
  addPptxEntranceAnimations,
  isPptxNativeEntranceAnimation,
  pptxEntranceAnimation,
  pptxEntranceObjectName,
  type PptxEntranceAnimation,
} from "./pptx-entrance-animations";

type DesignPanelProps = {
  sessionId: string;
  client: iPolloWorkServerClient | null;
  workspaceId: string | null;
  isRemoteWorkspace?: boolean;
  launcherItems?: SidePanelLauncherItem[];
  onClose: () => void;
};

type LoadedHtml = {
  content: string;
  updatedAt: number | null;
};

const COLOR_SWATCHES = ["#111827", "#ffffff", "#7c3aed", "#2563eb", "#059669", "#ea580c", "#dc2626", "#db2777"];
const PUBLISHABLE_DESIGN_FILE = /\.(?:avif|css|gif|html?|ico|jpe?g|js|json|map|mjs|png|svg|webp|woff2?|ttf|otf)$/i;
const PDF_SLIDE_WIDTH = 1600;
const PDF_SLIDE_HEIGHT = 900;
const PDF_PAGE_WIDTH_MM = 297;
const PDF_PAGE_HEIGHT_MM = 167.0625;
const LOCAL_IMAGE_ACCEPT = "image/*";
const DESIGN_INSPECTOR_WIDTHS = { compact: 256, wide: 384 } as const;

const TYPE_PRESETS = [
  { label: "Display", sample: "Aa", styles: { fontSize: "48px", fontWeight: "700", lineHeight: "1.05", letterSpacing: "-0.025em" } },
  { label: "Heading", sample: "Title", styles: { fontSize: "32px", fontWeight: "650", lineHeight: "1.15", letterSpacing: "-0.015em" } },
  { label: "Body", sample: "Text", styles: { fontSize: "16px", fontWeight: "400", lineHeight: "1.6", letterSpacing: "0em" } },
] satisfies Array<{ label: string; sample: string; styles: Partial<Record<DesignStyleField, string>> }>;

function isDesignRuntimeMessage(value: unknown): value is DesignRuntimeMessage {
  if (!value || typeof value !== "object") return false;
  return Reflect.get(value, "channel") === DESIGN_MESSAGE_CHANNEL
    && (Reflect.get(value, "type") === "selected" || Reflect.get(value, "type") === "editing" || Reflect.get(value, "type") === "draft" || Reflect.get(value, "type") === "document-draft" || Reflect.get(value, "type") === "navigate" || Reflect.get(value, "type") === "deck");
}

function readDesignTokenValues(...sources: string[]): DesignTokenValues {
  const values: DesignTokenValues = {};
  const declaration = document.createElement("div").style;
  const apply = (cssText: string) => {
    declaration.cssText = cssText;
    for (let index = 0; index < declaration.length; index += 1) {
      const name = declaration.item(index);
      if (name.startsWith("--ipw-")) values[name as keyof DesignTokenValues] = declaration.getPropertyValue(name).trim();
    }
  };
  for (const source of sources) {
    for (const match of source.matchAll(/:root\s*{([^}]*)}/gi)) apply(match[1] ?? "");
    const rootStyle = source.match(/<html[^>]*\sstyle=["']([^"']*)["']/i)?.[1];
    if (rootStyle) apply(rootStyle);
  }
  return values;
}

function linkedDesignTokenPath(source: string | undefined): string {
  const path = source?.match(/<link\b[^>]*\bhref=["']([^"']*design-tokens?\.css)["'][^>]*>/i)?.[1]?.trim() ?? "";
  if (!path || path.startsWith("/") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path) || path.split("/").includes("..")) return "";
  return path.replace(/^\.\//, "");
}

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function directoryPath(path: string) {
  const boundary = path.lastIndexOf("/");
  return boundary < 0 ? "" : path.slice(0, boundary + 1);
}

function publicationPathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function isPublishableDesignFile(path: string) {
  return PUBLISHABLE_DESIGN_FILE.test(path)
    && !path.includes("/.versions/")
    && !path.includes("/.ipollowork/");
}

function sanitizePdfFileBaseName(value: string) {
  return value
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 96);
}

function isGenericPdfTitle(value: string) {
  return /^(?:cover|overview|summary|presentation|slides?|pitch deck|deck|untitled|index|entry|ipollowork(?: slide editing demo)?|pitch deck - ipollowork)$/i.test(value.trim());
}

function isPreviewLocalAssetUrl(value: string) {
  const trimmed = value.trim();
  return Boolean(trimmed)
    && !trimmed.startsWith("#")
    && !trimmed.startsWith("/")
    && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(trimmed)
    && !trimmed.split(/[?#]/, 1)[0]?.split("/").includes("..");
}

function resolvePreviewAssetPath(currentPath: string, assetUrl: string) {
  const path = assetUrl.split(/[?#]/, 1)[0] ?? "";
  const base = directoryPath(currentPath);
  const segments: string[] = [];
  for (const segment of `${base}${path}`.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

type HydratedDesignPreview = {
  source: string;
  objectUrls: string[];
};

function arrayBufferToPreviewDataUrl(data: ArrayBuffer, contentType: string | null) {
  const bytes = new Uint8Array(data);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${contentType ?? "application/octet-stream"};base64,${btoa(binary)}`;
}

async function hydrateDesignPreviewAssets(
  source: string,
  input: { client: iPolloWorkServerClient | null; workspaceId: string | null; activePagePath: string },
): Promise<HydratedDesignPreview> {
  if (!input.client || !input.workspaceId || !input.activePagePath || typeof DOMParser === "undefined") {
    return { source, objectUrls: [] };
  }
  const client = input.client;
  const workspaceId = input.workspaceId;
  const parser = new DOMParser();
  const document = parser.parseFromString(source, "text/html");
  const images = Array.from(document.querySelectorAll<HTMLImageElement>("img[src]"))
    .filter((image) => isPreviewLocalAssetUrl(image.getAttribute("src") ?? ""));
  if (!images.length) return { source, objectUrls: [] };

  const assetUrls = new Map<string, string>();
  await Promise.all(images.map(async (image) => {
    const original = image.getAttribute("src") ?? "";
    const assetPath = resolvePreviewAssetPath(input.activePagePath, original);
    const existing = assetUrls.get(assetPath);
    if (existing) {
      image.setAttribute("src", existing);
      image.setAttribute("data-ipw-preview-src", original);
      return;
    }
    try {
      const downloaded = await client.downloadWorkspaceFile(workspaceId, assetPath);
      const dataUrl = arrayBufferToPreviewDataUrl(downloaded.data, downloaded.contentType);
      assetUrls.set(assetPath, dataUrl);
      image.setAttribute("src", dataUrl);
      image.setAttribute("data-ipw-preview-src", original);
    } catch {
      // Leave the original relative URL in place so broken assets stay visible
      // as broken assets instead of hiding an underlying file issue.
    }
  }));
  const doctype = source.trimStart().toLowerCase().startsWith("<!doctype") ? "<!DOCTYPE html>\n" : "";
  return { source: `${doctype}${document.documentElement.outerHTML}`, objectUrls: [] };
}

function deckPdfFileName(document: Document, path: string) {
  const cleanCandidate = (value: string | null | undefined) => {
    const cleaned = sanitizePdfFileBaseName(value ?? "");
    return cleaned && !isGenericPdfTitle(cleaned) ? cleaned : "";
  };
  const firstSlide = document.querySelector<HTMLElement>(PRESENTATION_SLIDE_SELECTOR);
  const candidates = [
    document.querySelector<HTMLMetaElement>("meta[property='og:title'],meta[name='title'],meta[name='ipw-title']")?.content,
    document.title,
    firstSlide?.querySelector<HTMLElement>("h1,h2,[data-ipw-title],[data-title]")?.textContent,
    document.querySelector<HTMLElement>("h1,h2,[data-ipw-title],[data-title]")?.textContent,
    fileName(path).replace(/\.[^.]+$/, ""),
  ];
  const base = candidates.map(cleanCandidate).find(Boolean) || "presentation";
  return `${base}.pdf`;
}

async function waitForExportFrame(frame: any) {
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
  await Promise.all(Array.from(document.images as HTMLCollectionOf<HTMLImageElement>).map((image) => image.complete
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      })));
}

async function yieldForExportWork() {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 180 });
    } else {
      globalThis.setTimeout(resolve, 0);
    }
  });
}

const finalFrameProperties = ["transform", "transform-origin", "opacity", "filter", "backdrop-filter", "background-position", "text-shadow", "box-shadow"] as const;

async function freezePptxExportFrame(document: Document) {
  const animatedProperties = new Set<string>(finalFrameProperties);
  for (const animation of document.getAnimations()) {
    const effect = animation.effect;
    const target = effect ? Reflect.get(effect, "target") : null;
    const pseudoElement = effect ? Reflect.get(effect, "pseudoElement") : null;
    if (isPptxExportElement(target) && (!isPptxNativeEntranceAnimation(target.dataset.anim) || typeof pseudoElement === "string" && pseudoElement.length > 0)) {
      target.setAttribute("data-ipw-pptx-static-animation", "");
    }
    const getKeyframes = effect ? Reflect.get(effect, "getKeyframes") : null;
    const keyframesValue: unknown = typeof getKeyframes === "function" ? getKeyframes.call(effect) : [];
    const keyframes = Array.isArray(keyframesValue) ? keyframesValue : [];
    for (const keyframe of keyframes) {
      for (const property of Object.keys(keyframe)) {
        if (property !== "offset" && property !== "easing" && property !== "composite") animatedProperties.add(property);
      }
    }
    try {
      animation.finish();
    } catch {
      const endTime = effect?.getComputedTiming().endTime;
      if (typeof endTime === "number" && Number.isFinite(endTime)) animation.currentTime = endTime;
      else {
        const getTiming = effect ? Reflect.get(effect, "getTiming") : null;
        const timingValue: unknown = typeof getTiming === "function" ? getTiming.call(effect) : null;
        const duration = timingValue && typeof timingValue === "object" ? Reflect.get(timingValue, "duration") : 0;
        animation.currentTime = typeof duration === "number" ? Math.max(0, duration - 0.001) : 0;
      }
    }
    animation.pause();
  }
  const view = document.defaultView;
  if (view) {
    const pseudoRules: string[] = [];
    let pseudoIndex = 0;
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      const computed = view.getComputedStyle(element);
      for (const property of animatedProperties) element.style.setProperty(property, computed.getPropertyValue(property));
      for (const pseudo of ["::before", "::after"] as const) {
        const pseudoStyle = view.getComputedStyle(element, pseudo);
        if (pseudoStyle.content === "none" || pseudoStyle.content === "normal") continue;
        const selector = `data-ipw-pptx-pseudo-${++pseudoIndex}`;
        element.setAttribute(selector, "");
        const declarations = Array.from(pseudoStyle)
          .filter((property) => !property.startsWith("animation") && !property.startsWith("transition"))
          .map((property) => `${property}:${pseudoStyle.getPropertyValue(property)}!important`)
          .join(";");
        pseudoRules.push(`[${selector}]${pseudo}{${declarations}}`);
      }
    }
    if (pseudoRules.length) document.head.append(Object.assign(document.createElement("style"), { textContent: pseudoRules.join("") }));
  }
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{animation:none!important;animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}";
  document.head.append(style);
  await new Promise<void>((resolve) => document.defaultView?.requestAnimationFrame(() => resolve()) ?? resolve());
}

function visiblePptxVisualElements(slide: HTMLElement, includeSlide: boolean) {
  const view = slide.ownerDocument.defaultView;
  const slideBox = slide.getBoundingClientRect();
  if (!view || !slideBox.width || !slideBox.height) return [];
  const candidates = includeSlide ? [slide, ...Array.from(slide.querySelectorAll<HTMLElement>("*"))] : Array.from(slide.querySelectorAll<HTMLElement>("*"));
  return candidates.filter((element) => {
    if (element.matches(".notes,[data-ipw-deck-control],[data-action='prev'],[data-action='previous'],[data-action='next'],.deck-chrome,.deck-controls,.dots,.counter")) return false;
    const style = view.getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const directText = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join("");
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity) > 0
      && box.width > 1
      && box.height > 1
      && box.right > slideBox.left
      && box.left < slideBox.right
      && box.bottom > slideBox.top
      && box.top < slideBox.bottom
      && (element.children.length === 0 || element.matches("img,svg,canvas,video"))
      && pptxVisualElementPaints({
        hasChildren: element.children.length > 0,
        text: directText,
        tag: element.tagName,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
        boxShadow: style.boxShadow,
        outlineStyle: style.outlineStyle,
        filter: style.filter,
        backdropFilter: style.backdropFilter,
        maskImage: style.maskImage,
        clipPath: style.clipPath,
        hasVisiblePseudo: hasPptxCapturedPseudoElement(element),
        hasStaticAnimation: element.hasAttribute("data-ipw-pptx-static-animation"),
      });
  });
}

function assertPptxVisualCoverage(
  slide: HTMLElement,
  plans: readonly { kind: string; element: HTMLElement; coversDescendants?: boolean }[],
  backgroundPlan?: { kind: "color" | "fallback"; element?: HTMLElement },
) {
  const visible = visiblePptxVisualElements(slide, backgroundPlan != null);
  const covered = visible.filter((element) => backgroundPlan?.kind === "color" && element === slide
    || backgroundPlan?.kind === "fallback" && backgroundPlan.element === element
    || plans.some((plan) => pptxPlanCoversVisual(plan, element)));
  const coverage = pptxPlanCoverage({ visibleVisualElementCount: visible.length, coveredVisualElementCount: covered.length });
  if (!coverage.valid) {
    const missing = visible
      .filter((element) => !covered.includes(element))
      .slice(0, 8)
      .map((element) => {
        const classes = typeof element.className === "string" && element.className.trim()
          ? `.${element.className.trim().split(/\s+/).join(".")}`
          : "";
        const text = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(" ")
          .slice(0, 32);
        return `${element.tagName.toLowerCase()}${classes}${text ? `:${text}` : ""}`;
      });
    throw new Error(`PPTX export stopped because ${visible.length - covered.length} visible visual element(s) are not covered: ${missing.join(", ")}. No incomplete presentation was created.`);
  }
}

function svgSourceWithDimensions(element: SVGSVGElement, width: number, height: number) {
  const source = new XMLSerializer().serializeToString(element);
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  const sourceElements = [element, ...Array.from(element.querySelectorAll<SVGElement>("*"))];
  const clonedElements = [root, ...Array.from(root.querySelectorAll("*"))];
  const view = element.ownerDocument.defaultView;
  for (const [index, sourceElement] of sourceElements.entries()) {
    const clonedElement = clonedElements[index];
    if (!clonedElement || !view) continue;
    const style = view.getComputedStyle(sourceElement);
    const declarations = Array.from(style).map((property) => `${property}:${style.getPropertyValue(property)}${style.getPropertyPriority(property) ? " !important" : ""}`);
    clonedElement.setAttribute("style", declarations.join(";"));
  }
  root.setAttribute("width", String(Math.max(1, Math.ceil(width))));
  root.setAttribute("height", String(Math.max(1, Math.ceil(height))));
  if (!root.hasAttribute("viewBox")) root.setAttribute("viewBox", `0 0 ${Math.max(1, Math.ceil(width))} ${Math.max(1, Math.ceil(height))}`);
  return new XMLSerializer().serializeToString(root);
}

async function capturePptxSvgElement(element: SVGSVGElement, scale: number) {
  const bounds = element.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(bounds.width));
  const height = Math.max(1, Math.ceil(bounds.height));
  const source = svgSourceWithDimensions(element, width, height);
  const objectUrl = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error("Could not render the SVG export element.")), { once: true });
    });
    image.src = objectUrl;
    await loaded;
    const canvas = element.ownerDocument.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(width * scale));
    canvas.height = Math.max(1, Math.ceil(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function normalizeHexColor(value: string) {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  const rgb = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return "#111827";
  return `#${rgb.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0")).join("")}`;
}

async function imageFileToPortableDataUrl(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const render = (maxSide: number, quality: number) => {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", quality);
    };
    const first = render(1400, 0.82);
    return first.length <= 360_000 ? first : render(960, 0.72);
  } finally {
    bitmap.close();
  }
}

function updateSelectionValue(selection: DesignSelection, field: DesignField, value: string): DesignSelection {
  if (DESIGN_STYLE_FIELDS.includes(field as DesignStyleField)) {
    return {
      ...selection,
      styles: { ...selection.styles, [field]: value },
    };
  }
  return { ...selection, [field]: value };
}

export function DesignPanel({
  sessionId,
  client,
  workspaceId,
  isRemoteWorkspace = false,
  launcherItems = [],
  onClose,
}: DesignPanelProps) {
  const queryClient = useQueryClient();
  const iframeRef = React.useRef<any>(null);
  const previewViewportRef = React.useRef<HTMLDivElement>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const templateQuery = useQuery({
    queryKey: ["design-session-template", workspaceId, sessionId] as const,
    queryFn: async () => {
      if (!client || !workspaceId) return null;
      try {
        const snapshot = await client.getTemplateSession(workspaceId, sessionId);
        return snapshot.surface === "design" ? snapshot : null;
      } catch { return null; }
    },
    enabled: Boolean(client && workspaceId),
    staleTime: 5_000,
  });
  const lockedPath = templateQuery.data?.state.entry ?? "";
  const hasSiteVersioning = templateQuery.data?.manifest.category === "site";
  const designTemplate = templateQuery.data?.manifest ?? null;
  const catalogQuery = useQuery({
    queryKey: ["design-html-catalog", workspaceId] as const,
    queryFn: async () => {
      if (!client || !workspaceId) return [];
      return client.listWorkspaceFiles(workspaceId);
    },
    // The workspace file catalog is needed solely to discover version
    // snapshots for a site. A slide deck (or any other design category) has
    // one materialized entry and must never become a workspace-wide picker.
    enabled: Boolean(client && workspaceId && !isRemoteWorkspace && hasSiteVersioning),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
  const versionTargets = React.useMemo(
    () => hasSiteVersioning ? (catalogQuery.data ?? [])
      .filter((entry) => entry.kind === "file" && entry.path.startsWith(`design/.versions/${sessionId}/`) && isLocalHtmlPath(entry.path))
      .sort((left, right) => right.path.localeCompare(left.path)) : [],
    [catalogQuery.data, hasSiteVersioning, sessionId],
  );
  const [selectedPath, setSelectedPath] = React.useState("");
  const [activePagePath, setActivePagePath] = React.useState("");
  const [activePageHash, setActivePageHash] = React.useState("");
  const [viewedVersionPath, setViewedVersionPath] = React.useState("current");
  const [viewedVersionUpdatedAt, setViewedVersionUpdatedAt] = React.useState<number | null>(null);
  const [previewDevice, setPreviewDevice] = React.useState<"desktop" | "mobile">("desktop");
  const [previewViewport, setPreviewViewport] = React.useState({ width: 0, height: 0 });
  const [editing, setEditing] = React.useState(false);
  const [deck, setDeck] = React.useState<DesignDeckState | null>(null);
  const hydratedPageRef = React.useRef("");
  const [selection, setSelection] = React.useState<DesignSelection | null>(null);
  const [draft, setDraft] = React.useState("");
  const draftRef = React.useRef("");
  const [pendingCanvasChange, setPendingCanvasChange] = React.useState(false);
  const [savedSource, setSavedSource] = React.useState("");
  const [history, setHistory] = React.useState<string[]>([]);
  const [previewSource, setPreviewSource] = React.useState("");
  const [hydratedPreviewSource, setHydratedPreviewSource] = React.useState("");
  const [previewRevision, setPreviewRevision] = React.useState(0);
  const [previewLoaded, setPreviewLoaded] = React.useState(false);
  const [sourceHydrated, setSourceHydrated] = React.useState(false);
  const [quickEdit, setQuickEdit] = React.useState<"text" | "href" | "src" | "color" | "fontSize" | null>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [advancedInspectorWidth, setAdvancedInspectorWidth] = React.useState<keyof typeof DESIGN_INSPECTOR_WIDTHS>("compact");
  const [designSystemOpen, setDesignSystemOpen] = React.useState(false);
  const [exportingPdf, setExportingPdf] = React.useState(false);
  const [exportingPptx, setExportingPptx] = React.useState(false);
  const [pptxConfirmationOpen, setPptxConfirmationOpen] = React.useState(false);

  React.useEffect(() => {
    if (!lockedPath) {
      setSelectedPath("");
      setActivePagePath("");
      setViewedVersionPath("current");
      setViewedVersionUpdatedAt(null);
      return;
    }
    if (lockedPath !== selectedPath) {
      setSelectedPath(lockedPath);
      setActivePagePath(lockedPath);
      setActivePageHash("");
      setViewedVersionPath("current");
      setViewedVersionUpdatedAt(null);
    }
  }, [lockedPath, selectedPath]);

  const fileQuery = useQuery<LoadedHtml>({
    queryKey: ["design-html", workspaceId, activePagePath] as const,
    queryFn: async () => {
      if (!client || !workspaceId || !activePagePath) throw new Error("Workspace file is not ready.");
      const result = await client.readWorkspaceFile(workspaceId, activePagePath);
      return { content: result.content, updatedAt: result.updatedAt ?? null };
    },
    enabled: Boolean(client && workspaceId && activePagePath && !isRemoteWorkspace),
    refetchInterval: viewedVersionPath === "current" && !editing && draft === savedSource ? 1_500 : false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const usesNativeEditablePptx = Boolean(
    designTemplate
    && isPptxCompatibleTemplate(designTemplate)
    && hasPptxCompatibleObjectMarkers(fileQuery.data?.content ?? ""),
  );
  const isPresentationTemplate = designTemplate?.category === "slides";
  const presentationScale = presentationCanvasScale(previewViewport.width, previewViewport.height);

  React.useEffect(() => {
    if (!isPresentationTemplate) return;
    setPreviewDevice("desktop");
  }, [isPresentationTemplate]);

  // A presentation is opened to edit slides, not to inspect a static page.
  // The editor bridge supplies click-to-select, drag, resize handles and
  // double-click text editing directly on the 16:9 canvas.
  React.useEffect(() => {
    setEditing(isPresentationTemplate);
  }, [isPresentationTemplate]);

  React.useEffect(() => {
    const viewport = previewViewportRef.current;
    if (!viewport || !isPresentationTemplate) return;
    const sync = () => {
      const rect = viewport.getBoundingClientRect();
      setPreviewViewport({ width: rect.width, height: rect.height });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [isPresentationTemplate, sourceHydrated]);
  const templateTokenPath = React.useMemo(() => {
    const tokenPath = designTemplate?.designSystem.tokens || linkedDesignTokenPath(fileQuery.data?.content) || "design-tokens.css";
    const briefPath = templateQuery.data?.state.briefPath;
    if (!tokenPath || !briefPath) return "";
    return `${briefPath.replace(/[^/]+$/, "")}${tokenPath}`;
  }, [designTemplate?.designSystem.tokens, fileQuery.data?.content, templateQuery.data?.state.briefPath]);
  const templateTokenQuery = useQuery({
    queryKey: ["design-template-tokens", workspaceId, templateTokenPath] as const,
    queryFn: async () => {
      if (!client || !workspaceId || !templateTokenPath) return "";
      return (await client.readWorkspaceFile(workspaceId, templateTokenPath)).content;
    },
    enabled: Boolean(client && workspaceId && templateTokenPath && !isRemoteWorkspace),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const openDesignLink = React.useCallback(async (href: string) => {
    if (!client || !workspaceId || !lockedPath || !activePagePath) return;
    if (draft !== savedSource && !window.confirm("Discard unsaved design changes and open this page?")) return;
    const resolved = resolveDesignNavigationPath(activePagePath, lockedPath, href);
    if (!resolved) {
      toast.error("This link is outside the current Design task.");
      return;
    }
    try {
      const loaded = await client.readWorkspaceFile(workspaceId, resolved.path);
      queryClient.setQueryData<LoadedHtml>(
        ["design-html", workspaceId, resolved.path] as const,
        { content: loaded.content, updatedAt: loaded.updatedAt ?? null },
      );
      setActivePagePath(resolved.path);
      setActivePageHash(resolved.hash);
      setViewedVersionPath("current");
      window.localStorage.setItem(`ipollowork.session-design-version.${sessionId}`, "current");
    } catch {
      toast.error(`Page not found: ${resolved.path}`);
    }
  }, [activePagePath, client, draft, lockedPath, queryClient, savedSource, sessionId, workspaceId]);

  React.useEffect(() => {
    if (!fileQuery.data) return;
    const storedVersion = typeof window !== "undefined"
      ? window.localStorage.getItem(`ipollowork.session-design-version.${sessionId}`)
      : "current";
    if (viewedVersionPath !== "current" && storedVersion !== "current") return;
    setViewedVersionPath("current");
    setViewedVersionUpdatedAt(fileQuery.data.updatedAt);
    if (typeof window !== "undefined") window.localStorage.setItem(`ipollowork.session-design-version.${sessionId}`, "current");
    draftRef.current = fileQuery.data.content;
    setPendingCanvasChange(false);
    setDraft(fileQuery.data.content);
    setSavedSource(fileQuery.data.content);
    setHistory([]);
    setSelection(null);
    const pageIdentity = `${sessionId}:${activePagePath}`;
    if (hydratedPageRef.current !== pageIdentity) {
      hydratedPageRef.current = pageIdentity;
      setDeck(null);
    }
    setQuickEdit(null);
    setAdvancedOpen(false);
    setDesignSystemOpen(false);
    setPreviewSource(fileQuery.data.content);
    setHydratedPreviewSource("");
    setPreviewLoaded(false);
    setSourceHydrated(true);
    setPreviewRevision((current) => current + 1);
  }, [activePagePath, fileQuery.data?.content, fileQuery.data?.updatedAt, sessionId, viewedVersionPath]);

  React.useEffect(() => {
    if (!previewSource) {
      setHydratedPreviewSource("");
      return;
    }
    let cancelled = false;
    let objectUrls: string[] = [];
    setPreviewLoaded(false);
    void hydrateDesignPreviewAssets(previewSource, { client, workspaceId, activePagePath }).then((result) => {
      objectUrls = result.objectUrls;
      if (cancelled) {
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      setHydratedPreviewSource(result.source);
      setPreviewRevision((current) => current + 1);
    });
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [activePagePath, client, previewSource, workspaceId]);

  React.useEffect(() => {
    const receiveMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || !isDesignRuntimeMessage(event.data)) return;
      if (event.data.type === "navigate") {
        void openDesignLink(event.data.href);
        return;
      }
      if (event.data.type === "deck") {
        setDeck(event.data.deck);
        return;
      }
      if (event.data.type === "document-draft") {
        draftRef.current = event.data.html;
        setDraft(event.data.html);
        setPendingCanvasChange(false);
        return;
      }
      if (event.data.type === "editing") setHistory((current) => [...current, draft]);
      setSelection((current) => {
        if (event.data.type === "selected" || current?.id !== event.data.selection.id) setQuickEdit(null);
        return event.data.selection;
      });
      if (event.data.type === "draft") {
        draftRef.current = event.data.html;
        setDraft(event.data.html);
        setPendingCanvasChange(false);
      }
    };
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [draft, openDesignLink]);

  React.useEffect(() => {
    if (!previewLoaded) return;
    iframeRef.current?.contentWindow?.postMessage({
      channel: DESIGN_MESSAGE_CHANNEL,
      type: "set-editing",
      editing,
    }, "*");
  }, [editing, previewLoaded]);

  const navigateDeck = React.useCallback((direction: "previous" | "next") => {
    if (!deck) return;
    setSelection(null);
    setQuickEdit(null);
    setAdvancedOpen(false);
    iframeRef.current?.contentWindow?.postMessage({
      channel: DESIGN_MESSAGE_CHANNEL,
      type: "deck-navigate",
      direction,
    }, "*");
  }, [deck]);

  const readLatestCanvasHtml = React.useCallback(async () => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!editing || !frameWindow) return draftRef.current;
    // The visible value of a focused input can be newer than React state while
    // an IME composition is finishing. Flush that exact DOM value to the
    // canvas before requesting the snapshot so Chinese/Japanese/Korean text is
    // never visually changed but omitted from the saved HTML.
    if (selection && quickEdit) {
      const inputSelector = quickEdit === "text"
          ? '[aria-label="Quick edit text"]'
          : quickEdit === "href"
            ? '[aria-label="Quick edit link"]'
            : quickEdit === "src"
              ? '[aria-label="Quick edit image URL"]'
              : quickEdit === "fontSize"
                ? '[aria-label="Quick font size"]'
                : null;
      const input = inputSelector ? document.querySelector<HTMLInputElement>(inputSelector) : null;
      if (input) {
        const field: DesignField = quickEdit === "fontSize" ? "fontSize" : quickEdit;
        const value = quickEdit === "fontSize" ? `${Math.max(1, Number(input.value) || 1)}px` : input.value;
        frameWindow.postMessage({
          channel: DESIGN_MESSAGE_CHANNEL,
          type: "set",
          id: selection.id,
          field,
          value,
          scope: "element",
        }, "*");
      }
    }
    const requestId = crypto.randomUUID();
    return new Promise<string>((resolve) => {
      let settled = false;
      const finish = (html: string) => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", receiveSnapshot);
        window.clearTimeout(timeout);
        resolve(html);
      };
      const receiveSnapshot = (event: MessageEvent) => {
        const data = event.data;
        if (event.source !== frameWindow || !data || typeof data !== "object") return;
        if (data.channel !== DESIGN_MESSAGE_CHANNEL || data.type !== "snapshot" || data.requestId !== requestId || typeof data.html !== "string") return;
        finish(data.html);
      };
      const timeout = window.setTimeout(() => finish(draftRef.current), 1_000);
      window.addEventListener("message", receiveSnapshot);
      frameWindow.postMessage({ channel: DESIGN_MESSAGE_CHANNEL, type: "snapshot", requestId }, "*");
    });
  }, [editing, quickEdit, selection]);

  const exportDeckToPdf = React.useCallback(async () => {
    if (!deck || exportingPdf) return;
    if (!previewLoaded) {
      toast.warning("Preview is still preparing. Try exporting again when it finishes loading.");
      return;
    }
    setExportingPdf(true);
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    // Keep the export document laid out and paintable. `visibility:hidden` on
    // the host iframe can make Chromium/html2canvas skip its rendering tree in
    // packaged Electron builds, producing a valid but blank PPTX.
    frame.style.cssText = `position:fixed;left:-100000px;top:0;width:${PDF_SLIDE_WIDTH}px;height:${PDF_SLIDE_HEIGHT}px;border:0;opacity:0;pointer-events:none`;
    document.body.append(frame);
    let hydratedObjectUrls: string[] = [];
    try {
      const exportLibraries = Promise.all([import("html2canvas-pro"), import("jspdf")]);
      const content = editing ? await readLatestCanvasHtml() : draftRef.current;
      const hydratedContent = await hydrateDesignPreviewAssets(
        downgradeUnsupportedPdfExportColorText(content),
        { client, workspaceId, activePagePath },
      );
      hydratedObjectUrls = hydratedContent.objectUrls;
      frame.srcdoc = buildDesignPreviewDocument(
        hydratedContent.source,
        false,
        downgradeUnsupportedPdfExportColorText(templateTokenQuery.data ?? ""),
        false,
        false,
        isPresentationTemplate,
      );
      await waitForExportFrame(frame);
      const frameDocument = frame.contentDocument;
      if (!frameDocument) throw new Error("Could not prepare the presentation.");
      downgradeUnsupportedPdfExportColors(frameDocument);
      frameDocument.querySelectorAll("script,[data-ipw-deck-control],[data-action='prev'],[data-action='previous'],[data-action='next']").forEach((node) => node.remove());
      frameDocument.documentElement.style.width = `${PDF_SLIDE_WIDTH}px`;
      frameDocument.documentElement.style.height = `${PDF_SLIDE_HEIGHT}px`;
      frameDocument.documentElement.style.overflow = "hidden";
      frameDocument.body.style.width = `${PDF_SLIDE_WIDTH}px`;
      frameDocument.body.style.height = `${PDF_SLIDE_HEIGHT}px`;
      frameDocument.body.style.overflow = "hidden";
      frameDocument.querySelectorAll<HTMLElement>(".deck,[data-ipw-template-kind='slides']").forEach((container) => {
        container.style.width = `${PDF_SLIDE_WIDTH}px`;
        container.style.height = `${PDF_SLIDE_HEIGHT}px`;
        container.style.maxWidth = `${PDF_SLIDE_WIDTH}px`;
        container.style.maxHeight = `${PDF_SLIDE_HEIGHT}px`;
        container.style.aspectRatio = "16 / 9";
        container.style.overflow = "hidden";
      });
      const slides = Array.from(frameDocument.querySelectorAll<HTMLElement>(PRESENTATION_SLIDE_SELECTOR))
        .filter((slide, index, entries) => entries.indexOf(slide) === index);
      if (!slides.length) throw new Error("No slides were found in this presentation.");
      const [{ default: html2canvas }, { jsPDF }] = await exportLibraries;
      const pdf = new jsPDF({ unit: "mm", format: [PDF_PAGE_WIDTH_MM, PDF_PAGE_HEIGHT_MM], orientation: "landscape", compress: true });
      for (let index = 0; index < slides.length; index += 1) {
        const slide = slides[index];
        activateDeckExportSlide(slides, slide);
        slide.style.width = `${PDF_SLIDE_WIDTH}px`;
        slide.style.height = `${PDF_SLIDE_HEIGHT}px`;
        slide.style.maxWidth = `${PDF_SLIDE_WIDTH}px`;
        slide.style.maxHeight = `${PDF_SLIDE_HEIGHT}px`;
        slide.style.margin = "0";
        slide.style.overflow = "hidden";
        await yieldForExportWork();
        const canvas = await html2canvas(slide, {
          backgroundColor: "#ffffff",
          scale: 1,
          useCORS: true,
          onclone: (clonedDocument) => downgradeUnsupportedPdfExportColors(clonedDocument),
          logging: false,
          width: PDF_SLIDE_WIDTH,
          height: PDF_SLIDE_HEIGHT,
          windowWidth: PDF_SLIDE_WIDTH,
          windowHeight: PDF_SLIDE_HEIGHT,
        });
        if (index > 0) pdf.addPage([PDF_PAGE_WIDTH_MM, PDF_PAGE_HEIGHT_MM], "landscape");
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, PDF_PAGE_WIDTH_MM, PDF_PAGE_HEIGHT_MM, undefined, "FAST");
        await yieldForExportWork();
      }
      pdf.save(deckPdfFileName(frameDocument, activePagePath));
      toast.success("Presentation exported as PDF.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export this presentation.");
    } finally {
      hydratedObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      frame.remove();
      setExportingPdf(false);
    }
  }, [activePagePath, client, deck, editing, exportingPdf, isPresentationTemplate, previewLoaded, readLatestCanvasHtml, templateTokenQuery.data, workspaceId]);

  const exportDeckToPptx = React.useCallback(async () => {
    if (!deck || exportingPptx) return;
    if (!previewLoaded) {
      toast.warning("Preview is still preparing. Try exporting again when it finishes loading.");
      return;
    }
    setExportingPptx(true);
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    // html2canvas clones local fallback elements into its own iframe. Keep this
    // source iframe paintable so Chromium can resolve those elements in the clone.
    frame.style.cssText = `position:fixed;left:-100000px;top:0;width:${PDF_SLIDE_WIDTH}px;height:${PDF_SLIDE_HEIGHT}px;border:0;opacity:0;pointer-events:none`;
    document.body.append(frame);
    let hydratedObjectUrls: string[] = [];
    try {
      const content = editing ? await readLatestCanvasHtml() : draftRef.current;
      const previewContent = usesNativeEditablePptx ? content : downgradeUnsupportedPdfExportColorText(content);
      const previewTokens = usesNativeEditablePptx
        ? templateTokenQuery.data ?? ""
        : downgradeUnsupportedPdfExportColorText(templateTokenQuery.data ?? "");
      const hydratedContent = await hydrateDesignPreviewAssets(
        previewContent,
        { client, workspaceId, activePagePath },
      );
      hydratedObjectUrls = hydratedContent.objectUrls;
      frame.srcdoc = buildDesignPreviewDocument(
        hydratedContent.source,
        false,
        previewTokens,
        false,
        usesNativeEditablePptx,
        isPresentationTemplate,
      );
      await waitForExportFrame(frame);
      const frameDocument = frame.contentDocument;
      if (!frameDocument) throw new Error("Could not prepare the presentation.");
      await freezePptxExportFrame(frameDocument);
      if (!usesNativeEditablePptx) downgradeUnsupportedPdfExportColors(frameDocument);
      if (usesNativeEditablePptx) {
        normalizePptxCompatibleMarkers(frameDocument);
        removePptxCompatibleRuntimeArtifacts(frameDocument);
      }
      else frameDocument.querySelectorAll("script,[data-ipw-deck-control],[data-action='prev'],[data-action='previous'],[data-action='next']").forEach((node) => node.remove());
      frameDocument.documentElement.style.width = `${PDF_SLIDE_WIDTH}px`;
      frameDocument.documentElement.style.height = `${PDF_SLIDE_HEIGHT}px`;
      frameDocument.documentElement.style.overflow = "hidden";
      frameDocument.body.style.width = `${PDF_SLIDE_WIDTH}px`;
      frameDocument.body.style.height = `${PDF_SLIDE_HEIGHT}px`;
      frameDocument.body.style.overflow = "hidden";
      frameDocument.querySelectorAll<HTMLElement>(".deck,[data-ipw-template-kind='slides']").forEach((container) => {
        container.style.width = `${PDF_SLIDE_WIDTH}px`;
        container.style.height = `${PDF_SLIDE_HEIGHT}px`;
        container.style.maxWidth = `${PDF_SLIDE_WIDTH}px`;
        container.style.maxHeight = `${PDF_SLIDE_HEIGHT}px`;
        container.style.aspectRatio = "16 / 9";
        container.style.overflow = "hidden";
      });
      const slides = Array.from(frameDocument.querySelectorAll<HTMLElement>(PRESENTATION_SLIDE_SELECTOR))
        .filter((slide, index, entries) => entries.indexOf(slide) === index);
      if (!slides.length) throw new Error("No slides were found in this presentation.");

      const { default: PptxGenJS } = await import("pptxgenjs");
      const html2canvas = await import("html2canvas-pro").then((module) => module.default);
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      pptx.author = "iPolloWork";
      pptx.title = deck.title || "Presentation";
      let nativeObjectCount = 0;
      let fallbackCount = 0;
      let entryObjectIndex = 0;
      const animationFor = (element: HTMLElement): PptxEntranceAnimation | null => {
        const animationElement = element.closest<HTMLElement>("[data-anim]");
        if (animationElement && isPptxNativeEntranceAnimation(animationElement.dataset.anim)) return pptxEntranceAnimation(animationElement.dataset.anim);
        return element.closest<HTMLElement>("[data-ipw-pptx-static-animation]") ? "fade" : null;
      };
      const entryObjectName = (element: HTMLElement) => {
        const animation = animationFor(element);
        return animation ? pptxEntranceObjectName(++entryObjectIndex, animation) : undefined;
      };
      const capturePptxElement = async (element: HTMLElement, captureBackground = false, capturePadding = 0) => {
        const marker = "data-ipw-pptx-background-root";
        if (captureBackground) element.setAttribute(marker, "true");
        try {
          return await html2canvas(element, {
            backgroundColor: null,
            scale: PPTX_CAPTURE_SCALE,
            ...(capturePadding > 0 ? {
              x: -capturePadding,
              y: -capturePadding,
              width: Math.ceil(element.getBoundingClientRect().width + capturePadding * 2),
              height: Math.ceil(element.getBoundingClientRect().height + capturePadding * 2),
            } : {}),
            useCORS: true,
            logging: false,
            onclone: (clonedDocument) => {
              downgradeUnsupportedPdfExportColors(clonedDocument);
              if (!captureBackground) return;
              const root = clonedDocument.querySelector<HTMLElement>(`[${marker}]`);
              if (root?.matches(PRESENTATION_SLIDE_SELECTOR)) Array.from(root.children).forEach((child) => { (child as HTMLElement).style.visibility = "hidden"; });
              root?.querySelectorAll<HTMLElement>(`${PRESENTATION_SLIDE_SELECTOR},.deck-chrome,.deck-controls,.dots,.counter,[data-ipw-deck-control],[data-action='prev'],[data-action='previous'],[data-action='next']`)
                .forEach((node) => { node.style.visibility = "hidden"; });
            },
          });
        } finally {
          if (captureBackground) element.removeAttribute(marker);
        }
      };
      for (const [slideIndex, slide] of slides.entries()) {
        activateDeckExportSlide(slides, slide);
        slide.style.width = `${PDF_SLIDE_WIDTH}px`;
        slide.style.height = `${PDF_SLIDE_HEIGHT}px`;
        slide.style.maxWidth = `${PDF_SLIDE_WIDTH}px`;
        slide.style.maxHeight = `${PDF_SLIDE_HEIGHT}px`;
        slide.style.margin = "0";
        slide.style.overflow = "hidden";
        await yieldForExportWork();

        const pptxSlide = pptx.addSlide();
        if (usesNativeEditablePptx) {
          try {
            pptxSlide.background = { color: pptxCompatibleSlideBackground(slide) };
          } catch {
            const backgroundCanvas = await capturePptxElement(slide, true);
            pptxSlide.addImage({
              data: backgroundCanvas.toDataURL(PPTX_BACKGROUND_IMAGE_FORMAT),
              x: 0,
              y: 0,
              w: 13.333,
              h: 7.5,
              objectName: `ipw-background-${slideIndex}`,
            });
            fallbackCount += 1;
          }
          const objects = collectPptxCompatibleObjects(slide);
          assertPptxVisualCoverage(slide, objects.map((object) => ({
            kind: object.kind,
            element: object.element,
            ...(object.kind === "text" || object.kind === "fallback" ? { coversDescendants: true } : {}),
          })), { kind: "color" });
          const objectCoverage = validatePptxElementPlanCoverage({
            hasVisibleContent: slideHasVisiblePptxContent(slide),
            planCount: objects.length,
          });
          if (!objectCoverage.valid) {
            throw new Error("PPTX export stopped because visible slide content could not be collected. No blank presentation was created.");
          }
          nativeObjectCount += objects.length;
          for (const object of objects) {
            if (object.kind === "fallback") {
              const canvas = isPptxExportSvg(object.element)
                ? await capturePptxSvgElement(object.element, PPTX_CAPTURE_SCALE)
                : await capturePptxElement(object.element);
              pptxSlide.addImage({
                data: canvas.toDataURL(PPTX_BACKGROUND_IMAGE_FORMAT),
                ...object.frame,
                objectName: entryObjectName(object.element),
              });
              fallbackCount += 1;
              continue;
            }
            if (object.kind === "shape") {
              pptxSlide.addShape(object.value.type, {
                ...object.value.frame,
                fill: object.value.fill,
                line: object.value.line,
                objectName: entryObjectName(object.element),
              });
              continue;
            }
            if (object.kind === "text") {
              pptxSlide.addText(object.value.runs, {
                ...object.value.frame,
                fontFace: object.value.fontFace,
                fontSize: object.value.fontSize,
                color: object.value.color,
                bold: object.value.bold,
                italic: object.value.italic,
                align: object.value.align,
                lineSpacing: object.value.lineSpacing,
                charSpacing: object.value.charSpacing,
                margin: 0,
                valign: "top",
                fit: "none",
                objectName: entryObjectName(object.element),
              });
              continue;
            }
            pptxSlide.addImage({
              data: object.value.data,
              ...object.value.frame,
              altText: object.value.altText,
              objectName: entryObjectName(object.element),
            });
          }
          await yieldForExportWork();
          continue;
        }
        const backgroundPlan = collectPptxBackgroundPlan(slide);
        if (backgroundPlan?.kind === "color") {
          pptxSlide.background = { color: backgroundPlan.color };
        } else if (backgroundPlan?.kind === "fallback") {
          const canvas = await capturePptxElement(backgroundPlan.element, true);
          pptxSlide.addImage({ data: canvas.toDataURL(PPTX_BACKGROUND_IMAGE_FORMAT), ...backgroundPlan.frame, objectName: `ipw-background-${slideIndex}` });
          fallbackCount += 1;
        }
        const plans = collectPptxElementPlans(slide);
        assertPptxVisualCoverage(slide, plans, backgroundPlan ?? undefined);
        const planCoverage = validatePptxElementPlanCoverage({
          hasVisibleContent: slideHasVisiblePptxContent(slide),
          planCount: plans.length,
        });
        if (!planCoverage.valid) {
          throw new Error("PPTX export stopped because visible slide content could not be collected. No blank presentation was created.");
        }
        const summary = pptxExportSummary(plans);
        nativeObjectCount += summary.nativeObjectCount;
        fallbackCount += summary.fallbackCount;
        for (const plan of plans) {
          if (plan.kind === "shape" && plan.shape) {
            pptxSlide.addShape(plan.shape.shape, { ...plan.shape, objectName: entryObjectName(plan.element) });
            continue;
          }
          if (plan.kind === "text" && plan.text) {
            pptxSlide.addText(plan.text.runs?.length ? plan.text.runs : plan.text.text, {
              x: plan.text.x,
              y: plan.text.y,
              w: plan.text.w,
              h: plan.text.h,
              fontFace: plan.text.fontFace,
              fontSize: plan.text.fontSize,
              lang: plan.text.lang,
              lineSpacing: plan.text.lineSpacing,
              charSpacing: plan.text.charSpacing,
              color: plan.text.color,
              transparency: plan.text.transparency,
              bold: plan.text.bold,
              italic: plan.text.italic,
              align: plan.text.align,
              margin: 0,
              breakLine: false,
              valign: "top",
              fit: "none",
              objectName: entryObjectName(plan.element),
            });
            continue;
          }
          const canvas = isPptxExportSvg(plan.element)
            ? await capturePptxSvgElement(plan.element, PPTX_CAPTURE_SCALE)
            : await capturePptxElement(plan.element, false, plan.capturePadding);
          pptxSlide.addImage({ data: canvas.toDataURL(PPTX_BACKGROUND_IMAGE_FORMAT), ...plan.frame, objectName: entryObjectName(plan.element) });
        }
        await yieldForExportWork();
      }
      const exported = await pptx.write({ outputType: "blob" });
      if (!(exported instanceof Blob)) throw new Error("Could not build the PowerPoint file.");
      const finalized = await addPptxEntranceAnimations(exported);
      downloadBlobAsFile(deckPptxFileName(deckPdfFileName(frameDocument, activePagePath)), finalized);
      toast.success(fallbackCount
        ? `Presentation exported: ${nativeObjectCount} editable objects, ${fallbackCount} local visual fallbacks.`
        : `Presentation exported: ${nativeObjectCount} editable objects.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export this presentation.");
    } finally {
      hydratedObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      frame.remove();
      setExportingPptx(false);
    }
  }, [activePagePath, client, deck, editing, exportingPptx, isPresentationTemplate, previewLoaded, readLatestCanvasHtml, templateTokenQuery.data, usesNativeEditablePptx, workspaceId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!client || !workspaceId || !activePagePath || !fileQuery.data) {
        throw new Error("Workspace file is not ready.");
      }
      // Read the DOM snapshot directly at save time. This includes the last
      // contenteditable keystroke even when blur/draft messages are still in
      // flight, which is especially important for text nested in controls.
      const content = await readLatestCanvasHtml();
      draftRef.current = content;
      const savePath = viewedVersionPath === "current" ? activePagePath : viewedVersionPath;
      const result = await client.writeWorkspaceFile(workspaceId, {
        path: savePath,
        content,
        baseUpdatedAt: viewedVersionPath === "current" ? fileQuery.data.updatedAt : viewedVersionUpdatedAt,
      });
      return { result, content, savePath, isCurrent: viewedVersionPath === "current" };
    },
    onSuccess: ({ result, content, isCurrent }) => {
      if (isCurrent) {
        queryClient.setQueryData<LoadedHtml>(
          ["design-html", workspaceId, activePagePath] as const,
          { content, updatedAt: result.updatedAt ?? null },
        );
      } else {
        setViewedVersionUpdatedAt(result.updatedAt ?? null);
      }
      setDraft(content);
      setSavedSource(content);
      setPendingCanvasChange(false);
      setHistory([]);
      toast.success(isCurrent ? "Design saved to the workspace." : "This version was saved.");
    },
    onError: (cause) => {
      const message = cause instanceof Error ? cause.message : "Could not save this design.";
      toast.error(message.includes("changed since") ? "This HTML file changed on disk. Reopen it before saving." : message);
    },
  });

  const viewVersion = async (versionPath: string) => {
    if (!client || !workspaceId || !fileQuery.data || versionPath === viewedVersionPath) return;
    if (draft !== savedSource && !window.confirm("Discard unsaved design changes and switch versions?")) return;
    try {
      const loaded = await client.readWorkspaceFile(workspaceId, versionPath === "current" ? activePagePath : versionPath);
      const content = loaded.content;
      if (versionPath === "current") {
        queryClient.setQueryData<LoadedHtml>(
          ["design-html", workspaceId, activePagePath] as const,
          { content, updatedAt: loaded.updatedAt ?? null },
        );
      }
      setViewedVersionPath(versionPath);
      setActivePageHash("");
      setViewedVersionUpdatedAt(loaded.updatedAt ?? null);
      window.localStorage.setItem(`ipollowork.session-design-version.${sessionId}`, versionPath);
      draftRef.current = content;
      setDraft(content);
      setSavedSource(content);
      setPendingCanvasChange(false);
      setHistory([]);
      setSelection(null);
      setQuickEdit(null);
      setAdvancedOpen(false);
      setPreviewSource(content);
      setHydratedPreviewSource("");
      setPreviewLoaded(false);
      setPreviewRevision((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open this version.");
    }
  };

  const applyField = (field: DesignField, value: string, remember = true) => {
    if (!selection || !editing) return;
    setPendingCanvasChange(true);
    if (remember) setHistory((current) => [...current, draft]);
    setSelection(updateSelectionValue(selection, field, value));
    iframeRef.current?.contentWindow?.postMessage({
      channel: DESIGN_MESSAGE_CHANNEL,
      type: "set",
      id: selection.id,
      field,
      value,
      scope: selection.rangeText && (field === "color" || field === "fontSize" || field === "fontWeight" || field === "letterSpacing") ? "range" : "element",
    }, "*");
  };

  const applyToken = (name: string, value: string) => {
    if (!editing) return;
    setPendingCanvasChange(true);
    setHistory((current) => [...current, draft]);
    iframeRef.current?.contentWindow?.postMessage({
      channel: DESIGN_MESSAGE_CHANNEL,
      type: "set-token",
      name,
      value,
    }, "*");
  };

  const beginQuickEdit = (kind: "text" | "href" | "src" | "color" | "fontSize") => {
    setHistory((current) => [...current, draft]);
    setQuickEdit(kind);
  };

  const applyStyleBatch = (styles: Partial<Record<DesignStyleField, string>>) => {
    if (!selection || !editing) return;
    setPendingCanvasChange(true);
    setHistory((current) => [...current, draft]);
    setSelection((current) => {
      if (!current) return current;
      return Object.entries(styles).reduce(
        (next, [field, value]) => updateSelectionValue(next, field as DesignStyleField, value),
        current,
      );
    });
    Object.entries(styles).forEach(([field, value]) => {
      iframeRef.current?.contentWindow?.postMessage({
        channel: DESIGN_MESSAGE_CHANNEL,
        type: "set",
        id: selection.id,
        field,
        value,
      }, "*");
    });
  };

  const fontSize = Math.max(1, Math.round(Number.parseFloat(selection?.styles.fontSize || "16") || 16));
  const setFontSize = (next: number, remember = false) => applyField("fontSize", `${Math.max(1, Math.min(240, next))}px`, remember);

  const replaceImageFromFile = async (file: File | undefined) => {
    if (!file || !selection || selection.tag !== "img") return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file to replace this image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Choose an image smaller than 5 MB.");
      return;
    }
    try {
      const result = await imageFileToPortableDataUrl(file);
      setHistory((current) => [...current, draft]);
      applyField("src", result, false);
      toast.success("Image replaced in the design.");
    } catch {
      toast.error("Could not prepare that image. Try PNG, JPG, or WebP.");
    }
  };

  const chooseReplacementImage = async () => {
    if (!selection || selection.tag !== "img") return;
    const pickedPath = await pickLocalImageFile("选择替换图片");
    if (pickedPath) {
      const dataUrl = await readLocalImageAsDataUrl(pickedPath);
      if (!dataUrl) {
        toast.error("Could not prepare that image. Try PNG, JPG, or WebP.");
        return;
      }
      setHistory((current) => [...current, draft]);
      applyField("src", dataUrl, false);
      toast.success("Image replaced in the design.");
      return;
    }
    if (typeof window !== "undefined" && window.__IPOLLOWORK_ELECTRON__?.invokeDesktop) return;
    imageInputRef.current?.click();
  };

  const undo = () => {
    const previous = history[history.length - 1];
    if (previous === undefined) return;
    draftRef.current = previous;
    setPendingCanvasChange(false);
    setDraft(previous);
    setHistory((current) => current.slice(0, -1));
    setSelection(null);
    setQuickEdit(null);
    setPreviewSource(previous);
    setHydratedPreviewSource("");
    setPreviewLoaded(false);
    setPreviewRevision((current) => current + 1);
  };

  const dirty = pendingCanvasChange || draft !== savedSource;
  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!client || !workspaceId || !lockedPath) throw new Error("This design is not ready to publish.");
      const status = await client.callStorage("status", {}, { workspaceId });
      if (!status.ok || !status.result || typeof status.result !== "object") {
        throw new Error("Storage Center is unavailable.");
      }
      const storage = status.result as { defaultProvider?: unknown };
      if (typeof storage.defaultProvider !== "string" || !storage.defaultProvider) {
        throw new Error("Configure a default OSS or Wasabi provider in Authorization Center first.");
      }
      if (dirty) await saveMutation.mutateAsync();

      const root = directoryPath(lockedPath);
      const catalog = await client.listWorkspaceFiles(workspaceId);
      const paths = new Set<string>([lockedPath]);
      for (const item of catalog) {
        if (item.kind !== "file" || !isPublishableDesignFile(item.path)) continue;
        if (root ? item.path.startsWith(root) : item.path === lockedPath) paths.add(item.path);
      }
      if (templateTokenPath && isPublishableDesignFile(templateTokenPath)) paths.add(templateTokenPath);
      const sourcePaths = [...paths].sort();
      if (sourcePaths.length > 100) throw new Error("This design has more than 100 publishable files. Reduce its asset folder before publishing.");

      const objectPrefix = `ipollowork/published/${publicationPathSegment(workspaceId)}/${publicationPathSegment(sessionId)}`;
      let publicUrl = "";
      for (const sourcePath of sourcePaths) {
        const uploaded = await client.callStorage("upload_workspace_file", {
          sourcePath,
          provider: "auto",
          objectKey: `${objectPrefix}/${sourcePath}`,
        }, { workspaceId });
        if (!uploaded.ok || !uploaded.result || typeof uploaded.result !== "object") {
          throw new Error(`Could not publish ${fileName(sourcePath)}.`);
        }
        if (sourcePath === lockedPath) {
          const output = uploaded.result as { url?: unknown; downloadUrl?: unknown };
          publicUrl = typeof output.downloadUrl === "string" ? output.downloadUrl : typeof output.url === "string" ? output.url : "";
        }
      }
      if (!publicUrl) throw new Error("The published design did not return a browser link.");
      return { publicUrl, files: sourcePaths.length };
    },
    onSuccess: ({ publicUrl, files }) => {
      void navigator.clipboard?.writeText(publicUrl).catch(() => undefined);
      window.open(publicUrl, "_blank", "noopener,noreferrer");
      toast.success(`Published ${files} file${files === 1 ? "" : "s"} to object storage. Link copied.`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not publish this design.");
    },
  });
  const designTokenValues = React.useMemo(
    () => readDesignTokenValues(templateTokenQuery.data ?? "", draft),
    [draft, templateTokenQuery.data],
  );
  const preview = React.useMemo(
    // The bridge is always present but starts inactive. Toggling Edit page is
    // a message to that bridge, not a new srcDoc, so a deck stays on its slide.
    () => buildDesignPreviewDocument(hydratedPreviewSource || previewSource, true, templateTokenQuery.data ?? "", false, usesNativeEditablePptx, isPresentationTemplate),
    [hydratedPreviewSource, isPresentationTemplate, previewSource, templateTokenQuery.data, usesNativeEditablePptx],
  );
  const presentationLeft = Math.max(0, (previewViewport.width - PRESENTATION_CANVAS_WIDTH * presentationScale) / 2);
  const presentationTop = Math.max(0, (previewViewport.height - PRESENTATION_CANVAS_HEIGHT * presentationScale) / 2);
  const selectionLeft = isPresentationTemplate
    ? presentationLeft + (selection?.rect.left ?? 0) * presentationScale + (selection?.rect.width ?? 0) * presentationScale / 2
    : (iframeRef.current?.offsetLeft ?? 0) + (selection?.rect.left ?? 0) + (selection?.rect.width ?? 0) / 2;
  const selectionTop = isPresentationTemplate
    ? presentationTop + (selection?.rect.top ?? 0) * presentationScale
    : (iframeRef.current?.offsetTop ?? 0) + (selection?.rect.top ?? 0);
  const floatingStyle = selection ? {
    left: `clamp(112px, ${selectionLeft + 8}px, calc(100% - 112px))`,
    top: `${Math.max(8, selectionTop + 8)}px`,
    transform: selection.rect.top > 58 ? "translate(-50%, -100%)" : "translate(-50%, 0)",
  } satisfies React.CSSProperties : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="design-panel">
      <input
        ref={imageInputRef}
        type="file"
        accept={LOCAL_IMAGE_ACCEPT}
        className="sr-only"
        aria-label="Choose replacement image"
        onChange={(event) => {
          replaceImageFromFile(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[#EAEAEA] px-3 [border-bottom-width:0.5px]">
        <Code2 className="size-4 text-primary" />
        <div className="flex min-w-0 flex-1 items-center">
          <p className="truncate text-sm font-medium">Design</p>
        </div>
        {launcherItems.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={(
                <Button variant="ghost" size="icon-sm" aria-label="Add panel">
                  <Plus />
                </Button>
              )}
            />
            <DropdownMenuContent
              align="end"
              className="w-[296px] rounded-[18px] border border-[#E5E5E5] bg-white p-3 text-[#242424] shadow-[0_8px_24px_rgba(0,0,0,0.10)] before:hidden"
            >
              {launcherItems.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  disabled={item.disabled}
                  onClick={item.onClick}
                  className={cn(
                    "h-9 rounded-xl px-2 text-[14px] font-normal tracking-[-0.56px] text-[#242424] focus:bg-[#F5F5F5] focus:text-[#242424] data-disabled:opacity-40",
                    item.active && "bg-[#F5F5F5]",
                  )}
                >
                  <img src={item.iconSrc} alt="" className="size-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut ? (
                    <span className="text-[12px] tracking-[-0.24px] text-[#8A8A8A]">{item.shortcut}</span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close Design">
          <X />
        </Button>
      </div>

      {isRemoteWorkspace ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Design editing is available for local workspaces only.
        </div>
      ) : templateQuery.isLoading ? (
        <div className="flex flex-1 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : !lockedPath ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <div className="max-w-xs">
            <Code2 className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No current design file</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Start a new Design session and select a template.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#EAEAEA] px-3 py-2 [border-bottom-width:0.5px]">
            {hasSiteVersioning ? (
              <div className="min-w-0 flex flex-1 items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{fileName(activePagePath)}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{viewedVersionPath === "current" ? "Current design" : "Version preview"}</p>
                </div>
                {versionTargets.length > 0 ? (
                <Select value={viewedVersionPath} onValueChange={(value) => { if (value) void viewVersion(value); }}>
                  <SelectTrigger size="sm" className="w-32 rounded-lg" aria-label="Design version"><SelectValue>Versions</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current">Current version</SelectItem>
                    {versionTargets.map((version, index) => <SelectItem key={version.path} value={version.path}>Version {versionTargets.length - index}</SelectItem>)}
                  </SelectContent>
                </Select>
                ) : null}
              </div>
            ) : null}
            <Label className="flex items-center gap-2 text-xs">
              <Switch
                size="sm"
                checked={editing}
                onCheckedChange={(checked) => {
                  setEditing(checked);
                  setSelection(null);
                  setQuickEdit(null);
                  setAdvancedOpen(false);
                  setDesignSystemOpen(false);
                }}
                aria-label="Edit page"
              />
              {isPresentationTemplate ? "Canvas edit" : "Edit page"}
            </Label>
            {deck ? (
              <div className="flex h-8 min-w-0 items-center rounded-lg border border-border/80 bg-muted/35 p-0.5 shadow-sm" data-testid="design-deck-navigation">
                <Button variant="ghost" size="icon-sm" className="size-7 rounded-md" onClick={() => navigateDeck("previous")} disabled={deck.index <= 0} aria-label="Previous slide" title="Previous slide">
                  <ChevronLeft className="size-3.5" />
                </Button>
                <span className="min-w-0 max-w-40 truncate px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground" aria-live="polite">
                  {deck.index + 1} / {deck.total}
                </span>
                <Button variant="ghost" size="icon-sm" className="size-7 rounded-md" onClick={() => navigateDeck("next")} disabled={deck.index >= deck.total - 1} aria-label="Next slide" title="Next slide">
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            ) : null}
            {editing && designTemplate ? (
              <Button
                variant={designSystemOpen ? "secondary" : "ghost"}
                size="icon-sm"
                className={cn("rounded-lg", !deck && "ml-auto")}
                onClick={() => {
                  setDesignSystemOpen((current) => !current);
                  setAdvancedOpen(false);
                }}
                aria-label="Open design system"
                title="Design system"
              >
                <Palette className="size-3.5" />
              </Button>
            ) : null}
            <Button variant="ghost" size="icon-sm" onClick={undo} disabled={history.length === 0} aria-label="Undo design change">
              <Undo2 />
            </Button>
            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || (!editing && !dirty)}>
              {saveMutation.isPending ? <Loader2 className="animate-spin" /> : dirty ? <Save /> : <Check />}
              Save
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending || saveMutation.isPending || !lockedPath}
              aria-label="Publish to object storage"
              title="Publish to object storage"
            >
              {publishMutation.isPending ? <Loader2 className="animate-spin" /> : <Share2 />}
            </Button>
            {!isPresentationTemplate ? (
              <ToggleGroup
                value={[previewDevice]}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next !== "desktop" && next !== "mobile") return;
                  setPreviewDevice(next);
                  setSelection(null);
                  setQuickEdit(null);
                  setAdvancedOpen(false);
                }}
                variant="outline"
                size="sm"
                aria-label="Preview device"
                className="rounded-lg"
              >
                <ToggleGroupItem value="desktop" className="h-8 w-8 rounded-l-lg px-0" aria-label="Desktop preview" title="Desktop">
                  <Monitor className="size-3.5" />
                </ToggleGroupItem>
                <ToggleGroupItem value="mobile" className="h-8 w-8 rounded-r-lg px-0" aria-label="Mobile preview" title="Mobile">
                  <Smartphone className="size-3.5" />
                </ToggleGroupItem>
              </ToggleGroup>
            ) : null}
            {deck ? (
              <div className="ml-auto">
                <DesignExportMenu
                  exportingPdf={exportingPdf}
                  exportingPptx={exportingPptx}
                  exportReady={previewLoaded}
                  exportDisabledReason="Preview is still preparing."
                  onExportPdf={() => void exportDeckToPdf()}
                  onExportPptx={() => setPptxConfirmationOpen(true)}
                />
              </div>
            ) : null}
          </div>

          {fileQuery.isLoading || !sourceHydrated ? (
            <div className="flex flex-1 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : fileQuery.isError ? (
            <div className="p-4 text-sm text-destructive">{fileQuery.error.message}</div>
          ) : (
            <div className="flex min-h-0 flex-1">
              <div
                ref={previewViewportRef}
                className={cn("relative min-w-0 flex-1 overflow-hidden bg-muted/30 p-2", !isPresentationTemplate && previewDevice === "mobile" && "flex justify-center bg-muted/50 px-4 py-3")}
              >
                <iframe
                  ref={iframeRef}
                  key={`${activePagePath}:${previewRevision}`}
                  srcDoc={preview}
                  title={`Design preview: ${fileName(activePagePath)}`}
                  className={cn(
                    "border border-border bg-white transition-[width,border-radius,box-shadow,transform] duration-200",
                    isPresentationTemplate
                      ? "absolute left-1/2 top-1/2 h-[900px] w-[1600px] origin-center rounded-lg shadow-sm"
                      : previewDevice === "desktop"
                      ? "h-full w-full rounded-lg shadow-sm"
                      : "h-full w-[390px] max-w-full shrink-0 rounded-[26px] shadow-xl shadow-black/15",
                  )}
                  style={isPresentationTemplate
                    ? { transform: `translate(-50%, -50%) scale(${presentationScale})` }
                    : undefined}
                  sandbox="allow-scripts"
                  data-preview-loaded={previewLoaded ? "true" : "false"}
                  onLoad={() => {
                    setPreviewLoaded(true);
                    iframeRef.current?.contentWindow?.postMessage({ channel: DESIGN_MESSAGE_CHANNEL, type: "scroll-to", hash: activePageHash }, "*");
                    iframeRef.current?.contentWindow?.postMessage({ channel: DESIGN_MESSAGE_CHANNEL, type: "set-editing", editing }, "*");
                    if (deck) iframeRef.current?.contentWindow?.postMessage({ channel: DESIGN_MESSAGE_CHANNEL, type: "deck-navigate", direction: "index", index: deck.index }, "*");
                  }}
                />
                {editing && selection ? (
                  <div
                    className="absolute z-20 flex max-w-[calc(100%-24px)] items-center gap-1 rounded-2xl border border-border/80 bg-background/95 p-1 shadow-xl shadow-black/10 backdrop-blur-xl"
                    style={floatingStyle}
                    role="toolbar"
                    aria-label="Design floating toolbar"
                    data-testid="design-floating-toolbar"
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerUp={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {quickEdit ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setQuickEdit(null)}
                          aria-label="Back to design tools"
                        >
                          <ArrowLeft />
                        </Button>
                        {quickEdit === "color" ? (
                          <div className="flex items-center gap-1 px-0.5" aria-label={selection.colorField === "color" ? "Quick text colors" : "Quick background colors"}>
                            {COLOR_SWATCHES.slice(0, 6).map((color) => (
                              <button
                                key={color}
                                type="button"
                                className="size-6 rounded-full border border-black/10 shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                style={{ backgroundColor: color }}
                                onClick={() => applyField(selection.colorField, color, false)}
                                aria-label={`Set ${selection.colorField === "color" ? "text" : "background"} color ${color}`}
                              />
                            ))}
                            <label
                              className="relative grid size-6 cursor-pointer place-items-center rounded-full border border-border bg-muted text-muted-foreground"
                              aria-label={selection.colorField === "color" ? "Choose custom text color" : "Choose custom background color"}
                            >
                              <Palette className="size-3" />
                              <input
                                type="color"
                                className="absolute inset-0 cursor-pointer opacity-0"
                                value={normalizeHexColor(selection.styles[selection.colorField])}
                                onChange={(event) => applyField(selection.colorField, event.currentTarget.value, false)}
                                aria-label={selection.colorField === "color" ? "Custom text color" : "Custom background color"}
                              />
                            </label>
                          </div>
                        ) : quickEdit === "fontSize" ? (
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon-xs" onClick={() => setFontSize(fontSize - 1)} aria-label="Decrease font size"><Minus /></Button>
                            <Input
                              autoFocus
                              type="number"
                              min={1}
                              max={240}
                              aria-label="Quick font size"
                              className="h-7 w-14 rounded-xl border-0 bg-muted/70 px-1 text-center text-xs shadow-none focus-visible:ring-2"
                              value={fontSize}
                              onChange={(event) => setFontSize(Number(event.currentTarget.value) || 1)}
                            />
                            <span className="text-[10px] text-muted-foreground">px</span>
                            <Button variant="ghost" size="icon-xs" onClick={() => setFontSize(fontSize + 1)} aria-label="Increase font size"><Plus /></Button>
                          </div>
                        ) : (
                          <Input
                            autoFocus
                            aria-label={quickEdit === "text" ? "Quick edit text" : quickEdit === "href" ? "Quick edit link" : "Quick edit image URL"}
                            className="h-7 w-52 rounded-xl border-0 bg-muted/70 px-2.5 text-xs shadow-none focus-visible:ring-2"
                            value={quickEdit === "text" ? selection.text : quickEdit === "href" ? selection.href : selection.src}
                            placeholder={quickEdit === "src" ? "Paste an image URL…" : undefined}
                            onChange={(event) => applyField(quickEdit, event.currentTarget.value, false)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape" || event.key === "Enter") setQuickEdit(null);
                            }}
                          />
                        )}
                        <Button variant="ghost" size="icon-xs" onClick={() => setQuickEdit(null)} aria-label="Done quick editing">
                          <Check />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {selection.tag}
                        </span>
                        {selection.canEditText ? (
                          <>
                            <Button variant="ghost" size="xs" onClick={() => beginQuickEdit("text")} aria-label="Edit selected text">
                              <Type />
                              Edit text
                            </Button>
                            <Button variant="ghost" size="xs" onClick={() => beginQuickEdit("fontSize")} aria-label="Change selected font size">
                              {fontSize}
                            </Button>
                          </>
                        ) : null}
                        {selection.tag !== "img" ? (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => beginQuickEdit("color")}
                            aria-label={selection.colorField === "color" ? "Change selected text color" : "Change selected background color"}
                            title={selection.colorField === "color" ? "Text color" : "Background color"}
                          >
                            <Palette />
                          </Button>
                        ) : null}
                        {selection.href ? (
                          <>
                            <Button variant="ghost" size="xs" onClick={() => beginQuickEdit("href")} aria-label="Edit selected link">
                              <Link2 />
                              Link
                            </Button>
                            <Button variant="ghost" size="icon-xs" onClick={() => void openDesignLink(selection.href)} aria-label="Open linked Design page" title="Open page">
                              <ExternalLink />
                            </Button>
                          </>
                        ) : null}
                        {selection.tag === "img" ? (
                          <>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => void chooseReplacementImage()}
                              aria-label="Upload replacement image"
                            >
                              <Upload />
                              Replace
                            </Button>
                            <Button variant="ghost" size="icon-xs" onClick={() => beginQuickEdit("src")} aria-label="Edit image URL">
                              <ImagePlus />
                            </Button>
                          </>
                        ) : null}
                        <Button
                          variant={advancedOpen ? "secondary" : "ghost"}
                          size="icon-xs"
                          onClick={() => {
                            setAdvancedOpen((current) => !current);
                            setDesignSystemOpen(false);
                          }}
                          aria-label="Toggle advanced design settings"
                          aria-pressed={advancedOpen}
                        >
                          <SlidersHorizontal />
                        </Button>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
              <DesignSystemDrawer
                open={editing && designSystemOpen && Boolean(designTemplate)}
                templateName={designTemplate?.title ?? "Template"}
                initialValues={designTokenValues}
                onClose={() => setDesignSystemOpen(false)}
                onTokenChange={applyToken}
                onBackgroundImageUpload={async (file) => {
                  if (!file.type.startsWith("image/")) {
                    toast.error("Choose an image file for the background.");
                    throw new Error("Invalid background image");
                  }
                  if (file.size > 5 * 1024 * 1024) {
                    toast.error("Choose a background image smaller than 5 MB.");
                    throw new Error("Background image too large");
                  }
                  return imageFileToPortableDataUrl(file);
                }}
              />
              {editing && advancedOpen ? (
                <aside
                  className="shrink-0 overflow-y-auto border-l border-[#EAEAEA] bg-background [border-left-width:0.5px]"
                  style={{ width: DESIGN_INSPECTOR_WIDTHS[advancedInspectorWidth] }}
                  aria-label="Design inspector"
                >
                  {selection ? (
                    <div className="space-y-1 p-2">
                      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[#EAEAEA] bg-background/95 px-1 py-2 [border-bottom-width:0.5px] backdrop-blur-xl">
                        <div className="grid size-6 place-items-center rounded-lg bg-primary/10 text-primary"><SlidersHorizontal className="size-3" /></div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold">Design properties</p>
                          <p className="truncate text-[10px] text-muted-foreground">{selection.tag.toUpperCase()} · element {selection.id}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setAdvancedInspectorWidth((current) => current === "compact" ? "wide" : "compact")}
                          aria-label={advancedInspectorWidth === "compact" ? "Widen design inspector" : "Narrow design inspector"}
                          title={advancedInspectorWidth === "compact" ? "Widen inspector" : "Narrow inspector"}
                        >
                          {advancedInspectorWidth === "compact" ? <ChevronLeft /> : <ChevronRight />}
                        </Button>
                        <Button variant="ghost" size="icon-xs" onClick={() => setAdvancedOpen(false)} aria-label="Close advanced design settings"><X /></Button>
                      </div>

                      {selection.rangeText ? (
                        <div className="rounded-lg border border-primary/15 bg-primary/5 px-2 py-1.5 text-[9px] text-primary">
                          Formatting selection: “{selection.rangeText.slice(0, 48)}{selection.rangeText.length > 48 ? "…" : ""}”
                        </div>
                      ) : null}

                      {selection.canEditText ? (
                        <InspectorSection icon={<Type />} title="Content">
                          <Input aria-label="Design text" className="h-7 rounded-lg border-0 bg-muted/55 px-2 text-[11px] shadow-none" value={selection.text} onChange={(event) => applyField("text", event.currentTarget.value)} />
                        </InspectorSection>
                      ) : null}

                      {selection.href ? (
                        <div className="border-b border-[#EAEAEA] px-2 py-2.5 [border-bottom-width:0.5px]">
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Link</p>
                          <Input aria-label="Design link destination" className="h-9 rounded-xl bg-muted/40 px-3 text-xs" value={selection.href} onChange={(event) => applyField("href", event.currentTarget.value)} />
                        </div>
                      ) : null}

                      {selection.tag === "img" ? (
                        <div className="rounded-2xl border border-border/70 bg-background p-3 shadow-xs">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Image</p>
                            <Button variant="secondary" size="xs" onClick={() => void chooseReplacementImage()}><Upload /> Replace</Button>
                          </div>
                          <div className="space-y-2">
                            <Input aria-label="Design image source" className="h-7 rounded-lg border-0 bg-muted/55 px-2 text-[11px] shadow-none" value={selection.src} onChange={(event) => applyField("src", event.currentTarget.value)} />
                            <Input aria-label="Design alt text" className="h-7 rounded-lg border-0 bg-muted/55 px-2 text-[11px] shadow-none" value={selection.alt} onChange={(event) => applyField("alt", event.currentTarget.value)} placeholder="Describe this image" />
                          </div>
                        </div>
                      ) : null}

                      {selection.canEditText ? (
                        <InspectorSection icon={<Sparkles />} title="Text styles">
                          <div className="grid grid-cols-3 gap-1.5">
                            {TYPE_PRESETS.map((preset) => (
                              <button
                                key={preset.label}
                                type="button"
                                className="rounded-lg border border-border/60 bg-muted/20 px-2 py-1.5 text-left transition-all hover:-translate-y-px hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm"
                                onClick={() => applyStyleBatch(preset.styles)}
                                aria-label={`Apply ${preset.label} text preset`}
                              >
                                <span className="block text-sm font-semibold leading-none">{preset.sample}</span>
                                <span className="mt-1 block text-[9px] text-muted-foreground">{preset.label}</span>
                              </button>
                            ))}
                          </div>
                        </InspectorSection>
                      ) : null}

                      <InspectorSection icon={<Type />} title="Typography">
                        <div className="flex items-center gap-2">
                          <div className="flex flex-1 items-center rounded-lg bg-muted/55 p-0.5">
                            <Button variant="ghost" size="icon-xs" onClick={() => setFontSize(fontSize - 1, true)} aria-label="Decrease advanced font size"><Minus /></Button>
                            <Input type="number" min={1} max={240} aria-label="Design font size" className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-center text-xs shadow-none" value={fontSize} onChange={(event) => setFontSize(Number(event.currentTarget.value) || 1, true)} />
                            <span className="pr-1 text-[9px] text-muted-foreground">px</span>
                            <Button variant="ghost" size="icon-xs" onClick={() => setFontSize(fontSize + 1, true)} aria-label="Increase advanced font size"><Plus /></Button>
                          </div>
                          <div className="flex rounded-lg bg-muted/55 p-0.5">
                            {(["left", "center", "right"] as const).map((alignment) => {
                              const Icon = alignment === "left" ? AlignLeft : alignment === "center" ? AlignCenter : AlignRight;
                              return (
                                <Button key={alignment} variant={selection.styles.textAlign === alignment ? "secondary" : "ghost"} size="icon-xs" onClick={() => applyField("textAlign", alignment)} aria-label={`Align ${alignment}`}><Icon /></Button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <InspectorField label="Weight" value={selection.styles.fontWeight} onChange={(value) => applyField("fontWeight", value)} />
                          <InspectorField label="Line height" value={selection.styles.lineHeight} onChange={(value) => applyField("lineHeight", value)} />
                          <InspectorField label="Tracking" value={selection.styles.letterSpacing} onChange={(value) => applyField("letterSpacing", value)} />
                        </div>
                      </InspectorSection>


                      <InspectorSection icon={<Move />} title="Layout & size">
                        <div className="grid grid-cols-2 gap-2">
                          <InspectorField label="Left" value={selection.styles.left} onChange={(value) => applyField("left", value)} />
                          <InspectorField label="Top" value={selection.styles.top} onChange={(value) => applyField("top", value)} />
                          <InspectorField label="Width" value={selection.styles.width} onChange={(value) => applyField("width", value)} />
                          <InspectorField label="Height" value={selection.styles.height} onChange={(value) => applyField("height", value)} />
                          <InspectorField label="Margin" value={selection.styles.margin} onChange={(value) => applyField("margin", value)} />
                          <InspectorField label="Padding" value={selection.styles.padding} onChange={(value) => applyField("padding", value)} />
                        </div>
                      </InspectorSection>

                      <InspectorSection icon={<Square />} title="Appearance">
                        <div className="grid grid-cols-2 gap-2">
                          <InspectorField label="Opacity" value={selection.styles.opacity} onChange={(value) => applyField("opacity", value)} />
                          <InspectorField label="Shadow" value={selection.styles.boxShadow} onChange={(value) => applyField("boxShadow", value)} />
                          <InspectorField label="Border width" value={selection.styles.borderWidth} onChange={(value) => applyField("borderWidth", value)} />
                          <InspectorField label="Border style" value={selection.styles.borderStyle} onChange={(value) => applyField("borderStyle", value)} />
                          <InspectorField label="Border color" value={selection.styles.borderColor} onChange={(value) => applyField("borderColor", value)} />
                          <InspectorField label="Radius" value={selection.styles.borderRadius} onChange={(value) => applyField("borderRadius", value)} />
                        </div>
                      </InspectorSection>

                      <InspectorSection icon={<Paintbrush />} title="Fill & color">
                        <div className="flex flex-wrap gap-2">
                          {COLOR_SWATCHES.map((color) => (
                            <button key={color} type="button" className="size-6 rounded-md border border-black/10 shadow-xs transition-all hover:-translate-y-px hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ backgroundColor: color }} onClick={() => applyField("color", color)} aria-label={`Set advanced text color ${color}`} />
                          ))}
                          <label className="relative grid size-6 cursor-pointer place-items-center rounded-md border border-border bg-muted text-muted-foreground" aria-label="Choose advanced custom text color">
                            <Palette className="size-3.5" />
                            <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={normalizeHexColor(selection.styles.color)} onChange={(event) => applyField("color", event.currentTarget.value)} aria-label="Advanced custom text color" />
                          </label>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <InspectorField label="Text color" value={selection.styles.color} onChange={(value) => applyField("color", value)} />
                          <InspectorField label="Background" value={selection.styles.backgroundColor} onChange={(value) => applyField("backgroundColor", value)} />
                        </div>
                      </InspectorSection>

                    </div>
                  ) : (
                    <div className="pt-8 text-center text-xs leading-5 text-muted-foreground">
                      <MousePointer2 className="mx-auto mb-2 size-5" />
                      Click an element in the page to edit it.
                    </div>
                  )}
                </aside>
              ) : null}
            </div>
          )}
        </>
      )}
      <ConfirmModal
        open={pptxConfirmationOpen}
        title={PPTX_EXPORT_CONFIRMATION.title}
        message={usesNativeEditablePptx
          ? "This PPTX-compatible template exports text, shapes, and images as editable PowerPoint objects. Unsupported effects block export instead of being converted to a screenshot."
          : PPTX_EXPORT_CONFIRMATION.message}
        confirmLabel={PPTX_EXPORT_CONFIRMATION.confirmLabel}
        cancelLabel={PPTX_EXPORT_CONFIRMATION.cancelLabel}
        confirmButtonVariant="secondary"
        onCancel={() => setPptxConfirmationOpen(false)}
        onConfirm={() => {
          setPptxConfirmationOpen(false);
          void exportDeckToPptx();
        }}
      />
    </div>
  );
}

function InspectorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="group/field flex h-7 min-w-0 items-center gap-1 rounded-lg bg-muted/45 px-1.5 transition-colors focus-within:bg-muted/70">
      <Label className="min-w-0 flex-1 truncate text-[9px] font-medium text-muted-foreground group-focus-within/field:text-foreground">{label}</Label>
      <Input aria-label={`Design ${label.toLowerCase()}`} className="h-6 w-[58%] min-w-0 rounded-md border-0 bg-transparent px-1 text-right text-[10px] shadow-none focus-visible:ring-1" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </div>
  );
}

function InspectorSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[#EAEAEA] px-2 py-2.5 [border-bottom-width:0.5px] last:border-b-0">
      <div className="mb-2 flex items-center gap-1.5 text-muted-foreground [&_svg]:size-3">
        {icon}
        <h3 className="text-[9px] font-semibold uppercase tracking-[0.12em]">{title}</h3>
      </div>
      {children}
    </section>
  );
}
