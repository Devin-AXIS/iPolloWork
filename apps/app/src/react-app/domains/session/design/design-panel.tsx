/** @jsxImportSource react */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Code2, Focus, Github, Layers3, Loader2, Minus, Monitor, MousePointer2, Palette, Plus, Presentation, Save, Share2, SlidersHorizontal, Smartphone, Sparkles, Undo2 } from "lucide-react";

import {
  IPOLLOWORK_DESIGN_STUDIO_FEATURES,
  type DesignAiSelectionContext,
  type DesignStudioClient,
  type DesignStudioFeatures,
} from "@ipollowork/design-studio";
import { pickLocalImageFile, readLocalImageAsDataUrl } from "@/app/lib/desktop";
import { downloadBlobAsFile } from "@/app/lib/download";
import { Button } from "@/components/ui/button";
import { TemplateIcon } from "@/components/template-icon";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { isPptxCompatibleTemplate, type TemplateSessionSnapshot } from "@ipollowork/types/templates";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { useDesignAiSelectionStore } from "./design-ai-selection-store";
import {
  buildDesignPreviewDocument,
  DESIGN_MESSAGE_CHANNEL,
  DESIGN_MULTI_SELECTION_STYLE_FIELDS,
  DESIGN_STYLE_FIELDS,
  isLocalHtmlPath,
  resolveDesignNavigationPath,
  type DesignAlignment,
  type DesignField,
  type DesignDeckState,
  type DesignRuntimeMessage,
  type DesignSelection,
  type DesignSelectionChange,
  type DesignStyleField,
} from "./design-html-runtime";
import { isDesignSelectionMember, summarizeDesignSelection } from "./design-selection-summary";
import {
  popDesignUndoHistory,
  pushDesignUndoHistory,
  shouldHydrateDesignSource,
  type DesignUndoSnapshot,
} from "./design-undo-history";
import {
  acceptsDesignDeckMessage,
  expectsDesignRestoreFrame,
  restoredSelectionLocator,
  shouldIgnoreDesignDraftMessage,
  type DesignViewRestore,
} from "./design-view-restore";
import { DesignExportMenu } from "./design-export-menu";
import { DesignPropertiesInspector } from "./design-properties-inspector";
import { DesignSaveMenu } from "./design-save-menu";
import { DesignSystemDrawer } from "./design-system-drawer";
import { DesignTemplateDialog } from "./design-template-dialog";
import floatingToolbarAiIcon from "./assets/floating-toolbar-ai.svg";
import floatingToolbarDivider from "./assets/floating-toolbar-divider.svg";
import floatingToolbarEditText from "./assets/floating-toolbar-edit-text.svg";
import floatingToolbarGrip from "./assets/floating-toolbar-grip.svg";
import floatingToolbarPalette from "./assets/floating-toolbar-palette.svg";
import floatingToolbarSettings from "./assets/floating-toolbar-settings.svg";
import floatingToolbarTrash from "./assets/floating-toolbar-trash.svg";
import { linkedDesignTokenPath, mergeTemplateTokenCss, parseDesignTokenValues, refreshTemplateTokenCss, replaceDesignTokenValue, type DesignTokenValues } from "./design-system-files";
import {
  buildTemplateTokenCss,
  getDesignSystemTheme,
  type DesignSystemTheme,
} from "./design-system-registry";
import { ensureHtmlDesignSystemContract, readAppliedDesignSystemId } from "./design-system-theme-contract";
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
  presentationCanvasStageSize,
  presentationCanvasWheelZoom,
  presentationCanvasZoomedScale,
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
  client: DesignStudioClient | null;
  workspaceId: string | null;
  isRemoteWorkspace?: boolean;
  initialPath?: string;
  displayName?: string;
  expanded?: boolean;
  features?: DesignStudioFeatures;
  branding?: {
    kind: "design" | "slides";
    title: string;
    byline: string;
    bylineUrl: string;
    repositoryUrl: string;
    onAskAi: () => void;
  };
  onAskAi: (context: DesignAiSelectionContext) => void;
  onSaveAsTemplate?: () => void;
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
const DESIGN_ACTION_BUTTON_CLASS = "size-8 rounded-lg border-0 bg-transparent text-foreground shadow-none transition-colors hover:bg-muted hover:text-foreground [&_svg]:!size-[18px] [&_svg]:stroke-[1.5]";
const FLOATING_TOOLBAR_BUTTON_CLASS = "grid size-6 shrink-0 place-items-center rounded transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

function isDesignRuntimeMessage(value: unknown): value is DesignRuntimeMessage {
  if (!value || typeof value !== "object") return false;
  if (typeof Reflect.get(value, "frameRevision") !== "string" || Reflect.get(value, "channel") !== DESIGN_MESSAGE_CHANNEL) return false;
  const type = Reflect.get(value, "type");
  if (type === "selected" || type === "editing" || type === "draft") {
    return isDesignSelectionMember(Reflect.get(value, "selection"))
      && (type !== "draft" || typeof Reflect.get(value, "html") === "string");
  }
  return type === "deselected" || type === "document-draft" || type === "snapshot" || type === "navigate" || type === "deck" || type === "view" || type === "view-restored" || type === "zoom" || type === "pan";
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
  input: { client: DesignStudioClient | null; workspaceId: string | null; activePagePath: string },
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
  initialPath,
  displayName,
  expanded = false,
  features = IPOLLOWORK_DESIGN_STUDIO_FEATURES,
  branding,
  onAskAi,
  onSaveAsTemplate,
}: DesignPanelProps) {
  const queryClient = useQueryClient();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const iframeRef = React.useRef<any>(null);
  const previewViewportRef = React.useRef<HTMLDivElement>(null);
  const presentationPanRef = React.useRef<HTMLDivElement>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const imageInputIntentRef = React.useRef<"replacement" | "element-background" | "design-background">("replacement");
  const designTokenDraftRef = React.useRef("");
  const designTokenSaveTimerRef = React.useRef<number | null>(null);
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
  const lockedPath = initialPath || templateQuery.data?.state.entry || "";
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
  const [presentationZoom, setPresentationZoom] = React.useState(1);
  const [presentationScroll, setPresentationScroll] = React.useState({ left: 0, top: 0 });
  const [panelWidth, setPanelWidth] = React.useState(480);
  const [editing, setEditing] = React.useState(false);
  const [deck, setDeck] = React.useState<DesignDeckState | null>(null);
  const deckRef = React.useRef<DesignDeckState | null>(null);
  const frameViewRef = React.useRef({ scrollX: 0, scrollY: 0 });
  const pendingViewRestoreRef = React.useRef<DesignViewRestore | null>(null);
  const hydratedPageRef = React.useRef("");
  const [selectionState, setSelectionState] = React.useState<DesignSelectionChange | null>(null);
  const selectionSummary = selectionState
    ? summarizeDesignSelection(selectionState.selection, selectionState.selections, selectionState.selectionRect)
    : null;
  const selection = selectionSummary?.primary ?? null;
  const isMultiSelection = selectionSummary?.isMultiSelection ?? false;
  const [draft, setDraft] = React.useState("");
  const draftRef = React.useRef("");
  const [pendingCanvasChange, setPendingCanvasChange] = React.useState(false);
  const [savedSource, setSavedSource] = React.useState("");
  const [history, setHistoryState] = React.useState<DesignUndoSnapshot[]>([]);
  const historyRef = React.useRef<DesignUndoSnapshot[]>([]);
  const setHistory = React.useCallback((update: React.SetStateAction<DesignUndoSnapshot[]>) => {
    const current = historyRef.current;
    const next = typeof update === "function" ? update(current) : update;
    historyRef.current = next;
    setHistoryState(next);
  }, []);
  const rememberHistory = React.useCallback((snapshot: DesignUndoSnapshot = {
    html: draftRef.current,
    tokenCss: designTokenDraftRef.current,
  }) => {
    setHistory((current) => pushDesignUndoHistory(current, snapshot));
  }, [setHistory]);
  const [previewSource, setPreviewSource] = React.useState("");
  const [hydratedPreviewSource, setHydratedPreviewSource] = React.useState("");
  const [previewRevision, setPreviewRevision] = React.useState(0);
  const previewRevisionRef = React.useRef(previewRevision);
  previewRevisionRef.current = previewRevision;
  const activeFrameRevision = `${activePagePath}:${previewRevision}`;
  const activeFrameRevisionRef = React.useRef(activeFrameRevision);
  activeFrameRevisionRef.current = activeFrameRevision;
  const [previewLoaded, setPreviewLoaded] = React.useState(false);
  const [sourceHydrated, setSourceHydrated] = React.useState(false);
  const [quickEdit, setQuickEdit] = React.useState<"text" | "href" | "src" | "color" | "fontSize" | null>(null);
  const [floatingPosition, setFloatingPosition] = React.useState<{ left: number; top: number } | null>(null);
  const floatingToolbarRef = React.useRef<HTMLDivElement>(null);
  const floatingDragRef = React.useRef<{ pointerId: number; startX: number; startY: number; left: number; top: number } | null>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [propertiesTab, setPropertiesTab] = React.useState<"element" | "design-system">("element");
  const elementPropertiesOpen = advancedOpen;
  const toggleElementProperties = React.useCallback(() => {
    setAdvancedOpen((current) => !current);
  }, []);
  const handlePropertiesTabChange = React.useCallback((tab: "element" | "design-system") => {
    setPropertiesTab(tab);
  }, []);
  const [designTokenDraft, setDesignTokenDraft] = React.useState("");
  const [exportingPdf, setExportingPdf] = React.useState(false);
  const [exportingPptx, setExportingPptx] = React.useState(false);
  const [pptxConfirmationOpen, setPptxConfirmationOpen] = React.useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = React.useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = React.useState(false);
  const templateCatalog = features.templates
    && client?.listDesignStudioTemplates
    && client.getDesignStudioTemplateCover
    && client.applyDesignStudioTemplate
    && workspaceId
    ? features.templates
    : null;
  const aiUndoCheckpoint = useDesignAiSelectionStore((state) => {
    const checkpoint = state.undoCheckpoints[sessionId]?.[activePagePath]?.at(-1);
    const context = checkpoint ? state.contexts[checkpoint.contextId] : undefined;
    return context?.workspaceId === workspaceId ? checkpoint : undefined;
  });
  const appliedAiCheckpointRef = React.useRef<string | null>(null);

  const applyTemplateSnapshot = React.useCallback((snapshot: TemplateSessionSnapshot) => {
    queryClient.setQueryData(["design-session-template", workspaceId, sessionId] as const, snapshot);
    queryClient.removeQueries({ queryKey: ["design-html", workspaceId] });
    setSelectedPath("");
    setActivePagePath("");
    setActivePageHash("");
    setViewedVersionPath("current");
    setViewedVersionUpdatedAt(null);
    setHistory([]);
    setDraft("");
    draftRef.current = "";
    setSavedSource("");
    setPreviewSource("");
    setHydratedPreviewSource("");
    setSelectionState(null);
    setQuickEdit(null);
    setAdvancedOpen(false);
    setPreviewLoaded(false);
  }, [queryClient, sessionId, setHistory, workspaceId]);

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

  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const sync = () => setPanelWidth(panel.getBoundingClientRect().width);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!aiUndoCheckpoint || appliedAiCheckpointRef.current === aiUndoCheckpoint.contextId) return;
    appliedAiCheckpointRef.current = aiUndoCheckpoint.contextId;
    queryClient.setQueryData<LoadedHtml>(
      ["design-html", workspaceId, activePagePath] as const,
      { content: aiUndoCheckpoint.afterHtml, updatedAt: aiUndoCheckpoint.afterUpdatedAt },
    );
    draftRef.current = aiUndoCheckpoint.afterHtml;
    setDraft(aiUndoCheckpoint.afterHtml);
    setSavedSource(aiUndoCheckpoint.afterHtml);
    setPendingCanvasChange(false);
    setSelectionState(null);
    setQuickEdit(null);
    setPreviewSource(aiUndoCheckpoint.afterHtml);
    setHydratedPreviewSource("");
    setPreviewLoaded(false);
    setPreviewRevision((current) => current + 1);
  }, [activePagePath, aiUndoCheckpoint, queryClient, workspaceId]);
  const usesNativeEditablePptx = Boolean(
    designTemplate
    && isPptxCompatibleTemplate(designTemplate)
    && hasPptxCompatibleObjectMarkers(fileQuery.data?.content ?? ""),
  );
  const isPresentationTemplate = designTemplate?.category === "slides";
  const presentationFitScale = presentationCanvasScale(previewViewport.width, previewViewport.height);
  const presentationScale = presentationCanvasZoomedScale(presentationFitScale, presentationZoom);
  const presentationCanvasStage = presentationCanvasStageSize(previewViewport.width, previewViewport.height, presentationScale);
  const presentationCanvasLeft = Math.max(0, (presentationCanvasStage.width - PRESENTATION_CANVAS_WIDTH * presentationScale) / 2);
  const presentationCanvasTop = Math.max(0, (presentationCanvasStage.height - PRESENTATION_CANVAS_HEIGHT * presentationScale) / 2);

  React.useEffect(() => {
    if (!isPresentationTemplate) return;
    setPreviewDevice("desktop");
  }, [isPresentationTemplate]);

  React.useEffect(() => {
    setPresentationZoom(1);
    setPresentationScroll({ left: 0, top: 0 });
  }, [activePagePath, isPresentationTemplate]);

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

  React.useEffect(() => {
    const viewport = previewViewportRef.current;
    if (!viewport || !isPresentationTemplate) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      setPresentationZoom((current) => presentationCanvasWheelZoom(current, event.deltaY));
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [isPresentationTemplate]);
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
  React.useEffect(() => {
    const next = templateTokenQuery.data ?? "";
    designTokenDraftRef.current = next;
    setDesignTokenDraft(next);
  }, [templateTokenPath, templateTokenQuery.data]);
  const designTokenValues = React.useMemo(
    () => parseDesignTokenValues(designTokenDraft || templateTokenQuery.data),
    [designTokenDraft, templateTokenQuery.data],
  );
  const appliedDesignSystemId = React.useMemo(
    () => readAppliedDesignSystemId(designTokenDraft || templateTokenQuery.data),
    [designTokenDraft, templateTokenQuery.data],
  );
  const writeDesignTokenMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!client || !workspaceId || !templateTokenPath) throw new Error("Design token file is not ready.");
      return client.writeWorkspaceFile(workspaceId, { path: templateTokenPath, content, force: true });
    },
    onSuccess: (_result, content) => {
      queryClient.setQueryData(["design-template-tokens", workspaceId, templateTokenPath] as const, content);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not save design system tokens.");
    },
  });
  const scheduleDesignTokenSave = React.useCallback((content: string) => {
    if (designTokenSaveTimerRef.current != null) window.clearTimeout(designTokenSaveTimerRef.current);
    designTokenSaveTimerRef.current = window.setTimeout(() => {
      designTokenSaveTimerRef.current = null;
      writeDesignTokenMutation.mutate(content);
    }, 350);
  }, [writeDesignTokenMutation]);
  React.useEffect(() => () => {
    if (designTokenSaveTimerRef.current != null) window.clearTimeout(designTokenSaveTimerRef.current);
  }, []);
  const handleDesignTokenChange = React.useCallback((name: string, value: string) => {
    const current = designTokenDraftRef.current || templateTokenQuery.data || "";
    const appliedTheme = appliedDesignSystemId ? getDesignSystemTheme(appliedDesignSystemId) : undefined;
    const next = replaceDesignTokenValue(appliedTheme ? refreshTemplateTokenCss(current, buildTemplateTokenCss(appliedTheme)) : current, name, value);
    designTokenDraftRef.current = next;
    setDesignTokenDraft(next);
    scheduleDesignTokenSave(next);
  }, [appliedDesignSystemId, scheduleDesignTokenSave, templateTokenQuery.data]);
  const handleApplyDesignSystem = React.useCallback((theme: DesignSystemTheme) => {
    const currentTokenCss = designTokenDraftRef.current || templateTokenQuery.data || "";
    const next = mergeTemplateTokenCss(
      currentTokenCss,
      buildTemplateTokenCss(theme),
    );
    const currentHtml = draftRef.current || fileQuery.data?.content || "";
    const themedHtml = ensureHtmlDesignSystemContract(
      currentHtml,
      theme.id,
      linkedDesignTokenPath(currentHtml) || "design-tokens.css",
    );
    if (themedHtml === currentHtml && next === currentTokenCss) {
      toast.info(`${theme.name} is already applied.`);
      return;
    }
    rememberHistory({ html: currentHtml, tokenCss: currentTokenCss, restoreTokenCss: true });
    if (themedHtml !== currentHtml) {
      draftRef.current = themedHtml;
      setDraft(themedHtml);
      setPendingCanvasChange(true);
      setPreviewSource(themedHtml);
      setHydratedPreviewSource("");
      setPreviewLoaded(false);
      setPreviewRevision((current) => current + 1);
    }
    designTokenDraftRef.current = next;
    setDesignTokenDraft(next);
    scheduleDesignTokenSave(next);
    toast.success(`Applied ${theme.name}.`);
  }, [fileQuery.data?.content, rememberHistory, scheduleDesignTokenSave, templateTokenQuery.data]);

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
    const pageIdentity = `${sessionId}:${activePagePath}`;
    const pageChanged = hydratedPageRef.current !== pageIdentity;
    if (!shouldHydrateDesignSource(pageChanged, fileQuery.data.content, draftRef.current)) return;
    draftRef.current = fileQuery.data.content;
    setPendingCanvasChange(false);
    setDraft(fileQuery.data.content);
    setSavedSource(fileQuery.data.content);
    setHistory([]);
    setSelectionState(null);
    if (pageChanged) {
      hydratedPageRef.current = pageIdentity;
      deckRef.current = null;
      setDeck(null);
      frameViewRef.current = { scrollX: 0, scrollY: 0 };
      pendingViewRestoreRef.current = null;
    }
    setQuickEdit(null);
    setAdvancedOpen(false);
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
      if (event.data.frameRevision !== activeFrameRevisionRef.current) return;
      if (event.data.type === "navigate") {
        void openDesignLink(event.data.href);
        return;
      }
      if (event.data.type === "deck") {
        const pending = pendingViewRestoreRef.current;
        if (!acceptsDesignDeckMessage(pending, { index: event.data.deck.index, viewRevision: event.data.viewRevision })) return;
        deckRef.current = event.data.deck;
        setDeck(event.data.deck);
        if (pending && pending.deckIndex === event.data.deck.index) {
          pending.deckRestored = true;
          if (pending.frameRestored) {
            const locator = restoredSelectionLocator(pending);
            if (locator) event.source?.postMessage({ channel: DESIGN_MESSAGE_CHANNEL, type: "select-locator", locator }, { targetOrigin: "*" });
            pendingViewRestoreRef.current = null;
          }
        }
        return;
      }
      if (event.data.type === "view") {
        const pending = pendingViewRestoreRef.current;
        if (pending && event.data.viewRevision !== pending.id) return;
        frameViewRef.current = { scrollX: event.data.scrollX, scrollY: event.data.scrollY };
        return;
      }
      if (event.data.type === "view-restored") {
        const pending = pendingViewRestoreRef.current;
        if (pending && event.data.viewRevision === pending.id) {
          pending.frameRestored = true;
          if (pending.deckIndex === null || pending.deckRestored) {
            const locator = restoredSelectionLocator(pending);
            if (locator) event.source?.postMessage({ channel: DESIGN_MESSAGE_CHANNEL, type: "select-locator", locator }, { targetOrigin: "*" });
            pendingViewRestoreRef.current = null;
          }
        }
        return;
      }
      if (event.data.type === "zoom") {
        setPresentationZoom((current) => presentationCanvasWheelZoom(current, event.data.deltaY));
        return;
      }
      if (event.data.type === "pan") {
        presentationPanRef.current?.scrollBy({ left: -event.data.deltaX, top: -event.data.deltaY });
        return;
      }
      if (event.data.type === "deselected") {
        setSelectionState(null);
        setQuickEdit(null);
        setAdvancedOpen(false);
        return;
      }
      if ((event.data.type === "draft" || event.data.type === "document-draft") && shouldIgnoreDesignDraftMessage(pendingViewRestoreRef.current)) return;
      if (event.data.type === "document-draft") {
        draftRef.current = event.data.html;
        setDraft(event.data.html);
        setPendingCanvasChange(false);
        return;
      }
      if (event.data.type !== "selected" && event.data.type !== "editing" && event.data.type !== "draft") return;
      if (event.data.type === "editing") rememberHistory();
      setSelectionState((current) => {
        const currentIds = current
          ? summarizeDesignSelection(current.selection, current.selections, current.selectionRect).selectionIds
          : [];
        const nextSummary = summarizeDesignSelection(event.data.selection, event.data.selections, event.data.selectionRect);
        const nextIds = nextSummary.selectionIds;
        if (current?.selection.id !== event.data.selection.id
          || currentIds.length !== nextIds.length
          || currentIds.some((id, index) => id !== nextIds[index])) {
          setQuickEdit(null);
        }
        return {
          ...event.data,
          selections: nextSummary.selections,
          selectionRect: nextSummary.selectionRect,
        };
      });
      if (event.data.type === "draft") {
        draftRef.current = event.data.html;
        setDraft(event.data.html);
        setPendingCanvasChange(false);
      }
    };
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [openDesignLink, rememberHistory]);

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
    setSelectionState(null);
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
        if (data.channel !== DESIGN_MESSAGE_CHANNEL || data.frameRevision !== activeFrameRevisionRef.current || data.type !== "snapshot" || data.requestId !== requestId || typeof data.html !== "string") return;
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
      setSelectionState(null);
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
    if (!selection || selection.locked || !selectionSummary || !editing) return;
    if (isMultiSelection && !DESIGN_MULTI_SELECTION_STYLE_FIELDS.some((styleField) => styleField === field)) return;
    setPendingCanvasChange(true);
    if (remember) rememberHistory();
    setSelectionState((current) => current ? {
      ...current,
      selection: updateSelectionValue(current.selection, field, value),
      selections: current.selections.map((member) => updateSelectionValue(member, field, value)),
    } : null);
    iframeRef.current?.contentWindow?.postMessage({
      channel: DESIGN_MESSAGE_CHANNEL,
      type: "set",
      ids: selectionSummary.selectionIds,
      field,
      value,
      scope: isMultiSelection ? "element" : selection.rangeText && (field === "color" || field === "fontSize" || field === "fontWeight" || field === "letterSpacing") ? "range" : "element",
    }, "*");
  };

  const applyStyleFields = (fields: Partial<Record<DesignStyleField, string>>, remember = true) => {
    if (!selection || selection.locked || !selectionSummary || !editing) return;
    setPendingCanvasChange(true);
    if (remember) rememberHistory();
    setSelectionState((current) => current ? {
      ...current,
      selection: { ...current.selection, styles: { ...current.selection.styles, ...fields } },
      selections: current.selections.map((member) => ({ ...member, styles: { ...member.styles, ...fields } })),
    } : null);
    for (const [field, value] of Object.entries(fields)) {
      iframeRef.current?.contentWindow?.postMessage({ channel: DESIGN_MESSAGE_CHANNEL, type: "set", ids: selectionSummary.selectionIds, field, value, scope: "element" }, "*");
    }
  };

  const alignSelection = (alignment: DesignAlignment) => {
    if (!selection || selection.locked || !selectionSummary || !editing) return;
    setPendingCanvasChange(true);
    rememberHistory();
    iframeRef.current?.contentWindow?.postMessage({
      channel: DESIGN_MESSAGE_CHANNEL,
      type: "align",
      ids: selectionSummary.selectionIds,
      alignment,
    }, "*");
  };

  const deleteSelection = () => {
    if (!selectionSummary || !selectionSummary.selections.some((member) => member.canDelete) || !editing) return;
    setPendingCanvasChange(true);
    rememberHistory();
    setSelectionState(null);
    setQuickEdit(null);
    setAdvancedOpen(false);
    iframeRef.current?.contentWindow?.postMessage({
      channel: DESIGN_MESSAGE_CHANNEL,
      type: "delete",
      ids: selectionSummary.selectionIds,
    }, "*");
  };

  const toggleSelectionLock = () => {
    if (!selection || !selectionSummary || isMultiSelection || !editing) return;
    const locked = !selection.locked;
    setPendingCanvasChange(true);
    rememberHistory();
    setQuickEdit(null);
    setSelectionState((current) => current ? {
      ...current,
      selection: { ...current.selection, locked },
      selections: current.selections.map((member) => member.id === selection.id
        ? { ...member, locked }
        : member),
    } : null);
    iframeRef.current?.contentWindow?.postMessage({
      channel: DESIGN_MESSAGE_CHANNEL,
      type: "lock",
      ids: [selection.id],
      locked,
    }, "*");
  };

  const askAiAboutSelection = async () => {
    if (!selection || !workspaceId || !activePagePath || !fileQuery.data || saveMutation.isPending) return;
    if (viewedVersionPath !== "current") {
      toast.info("Switch to the Current design before asking AI about an element.");
      return;
    }
    const selected = selection;
    let baseUpdatedAt = fileQuery.data.updatedAt;
    let beforeHtml: string;
    try {
      beforeHtml = await readLatestCanvasHtml();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read the current design.");
      return;
    }
    if (pendingCanvasChange || beforeHtml !== savedSource) {
      try {
        const saved = await saveMutation.mutateAsync();
        beforeHtml = saved.content;
        baseUpdatedAt = saved.result.updatedAt ?? null;
      } catch {
        return;
      }
    }
    const summary = (selected.text || selected.alt || selected.source).replace(/\s+/g, " ").trim().slice(0, 80);
    onAskAi({
      id: `design-ai-${crypto.randomUUID()}`,
      sessionId,
      workspaceId,
      filePath: activePagePath,
      baseUpdatedAt,
      beforeHtml,
      target: {
        tag: selected.tag,
        label: summary ? `${selected.tag.toUpperCase()} · ${summary}` : selected.tag.toUpperCase(),
        locator: selected.locator,
        text: selected.text,
        src: selected.source,
        alt: selected.alt,
        styles: selected.styles,
      },
    });
  };

  const beginQuickEdit = (kind: "text" | "href" | "src" | "color" | "fontSize") => {
    rememberHistory();
    setQuickEdit(kind);
  };

  const fontSize = Math.max(1, Math.round(Number.parseFloat(selection?.styles.fontSize || "16") || 16));
  const setFontSize = (next: number, remember = false) => applyField("fontSize", `${Math.max(1, Math.min(240, next))}px`, remember);

  const applyBrowserImage = async (file: File | undefined) => {
    if (!file) return;
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
      if (imageInputIntentRef.current === "replacement") {
        if (!selection || selection.tag !== "img") return;
        rememberHistory();
        applyField("src", result, false);
        toast.success("Image replaced in the design.");
      } else if (imageInputIntentRef.current === "element-background") {
        if (!selection || selection.tag === "img") return;
        applyStyleFields({ backgroundColor: "transparent", backgroundImage: `url(\"${result}\")` });
        toast.success("Image added as the fill.");
      } else {
        handleDesignTokenChange("--ipw-bg-image", `url(\"${result}\")`);
        handleDesignTokenChange("--ipw-bg-gradient", "none");
        handleDesignTokenChange("--ipw-bg-overlay", "linear-gradient(rgba(28,27,26,.45), rgba(28,27,26,.45))");
        handleDesignTokenChange("--ipw-bg-overlay-opacity", "0.45");
        handleDesignTokenChange("--ipw-bg-mode", "image");
        handleDesignTokenChange("--ipw-bg-size", "cover");
        handleDesignTokenChange("--ipw-bg-position", "50% 50%");
        toast.success("Background image applied.");
      }
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
      rememberHistory();
      applyField("src", dataUrl, false);
      toast.success("Image replaced in the design.");
      return;
    }
    if (typeof window !== "undefined" && window.__IPOLLOWORK_ELECTRON__?.invokeDesktop) return;
    imageInputIntentRef.current = "replacement";
    imageInputRef.current?.click();
  };

  const undo = async () => {
    const pan = presentationPanRef.current;
    const selectionLocator = selection?.locator ?? null;
    const restoreView = (targetSource: string): DesignViewRestore => ({
      id: crypto.randomUUID(),
      targetSource,
      previewRevision: previewRevisionRef.current + 1,
      frameRevision: `${activePagePath}:${previewRevisionRef.current + 1}`,
      frameLoaded: false,
      frameRestored: false,
      deckRestored: false,
      deckIndex: deckRef.current?.index ?? null,
      frameScrollX: frameViewRef.current.scrollX,
      frameScrollY: frameViewRef.current.scrollY,
      panLeft: pan?.scrollLeft ?? 0,
      panTop: pan?.scrollTop ?? 0,
      selectionLocator,
    });
    if (pendingViewRestoreRef.current) return;
    const popped = popDesignUndoHistory(historyRef.current, {
      html: draftRef.current,
      tokenCss: designTokenDraftRef.current,
    });
    setHistory(popped.history);
    const previous = popped.previous;
    if (previous !== undefined) {
      const restore = restoreView(previous.html);
      pendingViewRestoreRef.current = restore;
      draftRef.current = previous.html;
      setPendingCanvasChange(false);
      setDraft(previous.html);
      setSelectionState(null);
      setQuickEdit(null);
      setPreviewSource(previous.html);
      setHydratedPreviewSource("");
      setPreviewLoaded(false);
      setPreviewRevision(restore.previewRevision);
      if (previous.restoreTokenCss) {
        designTokenDraftRef.current = previous.tokenCss;
        setDesignTokenDraft(previous.tokenCss);
        scheduleDesignTokenSave(previous.tokenCss);
      }
      return;
    }
    const checkpoint = useDesignAiSelectionStore.getState().latestUndoCheckpoint(sessionId, activePagePath);
    if (!checkpoint || !client || !workspaceId) return;
    const restore = restoreView(checkpoint.beforeHtml);
    pendingViewRestoreRef.current = restore;
    try {
      const current = await client.readWorkspaceFile(workspaceId, activePagePath);
      if (current.content !== checkpoint.afterHtml) {
        throw new Error("This HTML file changed since the AI update.");
      }
      const result = await client.writeWorkspaceFile(workspaceId, {
        path: activePagePath,
        content: checkpoint.beforeHtml,
        baseUpdatedAt: checkpoint.afterUpdatedAt,
      });
      const restored = await client.readWorkspaceFile(workspaceId, activePagePath);
      useDesignAiSelectionStore.getState().popUndoCheckpoint(sessionId, activePagePath);
      appliedAiCheckpointRef.current = useDesignAiSelectionStore.getState()
        .latestUndoCheckpoint(sessionId, activePagePath)?.contextId ?? null;
      queryClient.setQueryData<LoadedHtml>(
        ["design-html", workspaceId, activePagePath] as const,
        { content: restored.content, updatedAt: restored.updatedAt ?? result.updatedAt ?? null },
      );
      draftRef.current = restored.content;
      setDraft(restored.content);
      setSavedSource(restored.content);
      setPendingCanvasChange(false);
      setSelectionState(null);
      setQuickEdit(null);
      setPreviewSource(restored.content);
      setHydratedPreviewSource("");
      setPreviewLoaded(false);
      setPreviewRevision(restore.previewRevision);
    } catch (error) {
      pendingViewRestoreRef.current = null;
      const message = error instanceof Error ? error.message : "";
      toast.error(message.includes("changed since")
        ? "Could not undo the AI Design change because the file changed. Reload before trying again."
        : message || "Could not undo the AI Design change.");
    }
  };

  const chooseBackgroundImage = async () => {
    if (!selection || selection.tag === "img") return;
    const pickedPath = await pickLocalImageFile("选择填充图片");
    if (!pickedPath) {
      if (typeof window !== "undefined" && window.__IPOLLOWORK_ELECTRON__?.invokeDesktop) return;
      imageInputIntentRef.current = "element-background";
      imageInputRef.current?.click();
      return;
    }
    const dataUrl = await readLocalImageAsDataUrl(pickedPath);
    if (!dataUrl) {
      toast.error("Could not prepare that image. Try PNG, JPG, or WebP.");
      return;
    }
    applyStyleFields({ backgroundColor: "transparent", backgroundImage: `url(\"${dataUrl}\")` });
    toast.success("Image added as the fill.");
  };

  const chooseDesignSystemBackgroundImage = async () => {
    const pickedPath = await pickLocalImageFile("选择全局背景图片");
    if (!pickedPath) {
      if (typeof window !== "undefined" && window.__IPOLLOWORK_ELECTRON__?.invokeDesktop) return;
      imageInputIntentRef.current = "design-background";
      imageInputRef.current?.click();
      return;
    }
    const dataUrl = await readLocalImageAsDataUrl(pickedPath);
    if (!dataUrl) {
      toast.error("Could not prepare that image. Try PNG, JPG, or WebP.");
      return;
    }
    handleDesignTokenChange("--ipw-bg-image", `url("${dataUrl}")`);
    handleDesignTokenChange("--ipw-bg-gradient", "none");
    handleDesignTokenChange("--ipw-bg-overlay", "linear-gradient(rgba(28,27,26,.45), rgba(28,27,26,.45))");
    handleDesignTokenChange("--ipw-bg-overlay-opacity", "0.45");
    handleDesignTokenChange("--ipw-bg-mode", "image");
    handleDesignTokenChange("--ipw-bg-size", "cover");
    handleDesignTokenChange("--ipw-bg-position", "50% 50%");
    toast.success("Background image applied.");
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
  const preview = React.useMemo(
    // The bridge is always present but starts inactive. Toggling editing is
    // a message to that bridge, not a new srcDoc, so a deck stays on its slide.
    () => buildDesignPreviewDocument(hydratedPreviewSource || previewSource, true, designTokenDraft || templateTokenQuery.data || "", false, usesNativeEditablePptx, isPresentationTemplate, activeFrameRevision),
    [activeFrameRevision, designTokenDraft, hydratedPreviewSource, isPresentationTemplate, previewSource, templateTokenQuery.data, usesNativeEditablePptx],
  );
  const selectionRect = selectionSummary?.selectionRect;
  const selectionLeft = isPresentationTemplate
    ? presentationCanvasLeft + (selectionRect?.left ?? 0) * presentationScale + (selectionRect?.width ?? 0) * presentationScale / 2 - presentationScroll.left
    : (iframeRef.current?.offsetLeft ?? 0) + (selectionRect?.left ?? 0) + (selectionRect?.width ?? 0) / 2;
  const selectionTop = isPresentationTemplate
    ? presentationCanvasTop + (selectionRect?.top ?? 0) * presentationScale - presentationScroll.top
    : (iframeRef.current?.offsetTop ?? 0) + (selectionRect?.top ?? 0);
  React.useLayoutEffect(() => {
    const toolbar = floatingToolbarRef.current;
    const viewport = previewViewportRef.current;
    if (!selection || !toolbar || !viewport) return;
    const padding = 8;
    const desiredLeft = selectionLeft + 8 - toolbar.offsetWidth / 2;
    const desiredTop = (selectionRect?.top ?? 0) > 58
      ? selectionTop + 8 - toolbar.offsetHeight
      : selectionTop + 8;
    setFloatingPosition({
      left: Math.min(Math.max(padding, desiredLeft), Math.max(padding, viewport.clientWidth - toolbar.offsetWidth - padding)),
      top: Math.min(Math.max(padding, desiredTop), Math.max(padding, viewport.clientHeight - toolbar.offsetHeight - padding)),
    });
  }, [advancedOpen, panelWidth, previewDevice, quickEdit, selection?.id, selectionLeft, selectionRect?.top, selectionSummary?.selectionCount, selectionTop]);
  const floatingStyle = selection ? floatingPosition
    ? { left: floatingPosition.left, top: floatingPosition.top }
    : { left: selectionLeft + 8, top: Math.max(8, selectionTop + 8), transform: "translateX(-50%)" } satisfies React.CSSProperties
    : undefined;
  const startFloatingDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const toolbar = floatingToolbarRef.current;
    const viewport = previewViewportRef.current;
    if (!toolbar || !viewport || event.button !== 0) return;
    const toolbarRect = toolbar.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const left = toolbarRect.left - viewportRect.left;
    const top = toolbarRect.top - viewportRect.top;
    floatingDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left, top };
    setFloatingPosition({ left, top });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const moveFloatingToolbar = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = floatingDragRef.current;
    const toolbar = floatingToolbarRef.current;
    const viewport = previewViewportRef.current;
    if (!drag || !toolbar || !viewport || drag.pointerId !== event.pointerId) return;
    const padding = 8;
    setFloatingPosition({
      left: Math.min(Math.max(padding, drag.left + event.clientX - drag.startX), Math.max(padding, viewport.clientWidth - toolbar.offsetWidth - padding)),
      top: Math.min(Math.max(padding, drag.top + event.clientY - drag.startY), Math.max(padding, viewport.clientHeight - toolbar.offsetHeight - padding)),
    });
  };
  const stopFloatingDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (floatingDragRef.current?.pointerId !== event.pointerId) return;
    floatingDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const compactToolbar = panelWidth < 480;
  const veryCompactToolbar = panelWidth < 360;
  const currentVersionLabel = `V${versionTargets.length + 1}`;
  const viewedVersionLabel = viewedVersionPath === "current"
    ? currentVersionLabel
    : `V${versionTargets.length - versionTargets.findIndex((version) => version.path === viewedVersionPath)}`;
  const activePageDisplayName = activePagePath === lockedPath
    ? displayName?.trim() || fileName(activePagePath)
    : fileName(activePagePath);
  const selectEditingMode = (nextEditing: boolean) => {
    setEditing(nextEditing);
    setSelectionState(null);
    setQuickEdit(null);
    setAdvancedOpen(false);
  };
  const editControl = (
    <ToggleGroup
      value={[editing ? "edit" : "preview"]}
      onValueChange={(value) => {
        const nextMode = value[0];
        if (nextMode === "edit" || nextMode === "preview") selectEditingMode(nextMode === "edit");
      }}
      spacing={0.5}
      aria-label={t("design.toolbar.mode")}
      className="flex h-8 shrink-0 items-center gap-0.5 rounded-[9px] bg-muted p-[3px]"
      data-testid="design-mode-toggle"
    >
      <ToggleGroupItem value="preview" className="h-[26px] min-w-0 rounded-md px-3 text-xs text-muted-foreground shadow-none hover:bg-background/70 hover:text-foreground aria-pressed:bg-white aria-pressed:text-[#171717] aria-pressed:shadow-none">
        {t("design.toolbar.preview")}
      </ToggleGroupItem>
      <ToggleGroupItem value="edit" className="h-[26px] min-w-0 rounded-md px-3 text-xs text-muted-foreground shadow-none hover:bg-background/70 hover:text-foreground aria-pressed:bg-white aria-pressed:text-[#171717] aria-pressed:shadow-none">
        {t("design.toolbar.edit")}
      </ToggleGroupItem>
    </ToggleGroup>
  );
  const templateControl = templateCatalog ? (
    <Button
      variant="ghost"
      size="icon-sm"
      className={DESIGN_ACTION_BUTTON_CLASS}
      onClick={() => setTemplateDialogOpen(true)}
      aria-label={templateCatalog.title}
      title={templateCatalog.title}
      data-testid="design-template-market-button"
    >
      <TemplateIcon className="size-4" />
    </Button>
  ) : null;

  return (
    <div ref={panelRef} className="flex h-full min-h-0 flex-col bg-background" data-testid="design-panel">
      <input
        ref={imageInputRef}
        type="file"
        accept={LOCAL_IMAGE_ACCEPT}
        className="sr-only"
        aria-label="Choose design image"
        onChange={(event) => {
          void applyBrowserImage(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
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
          <div className={cn(
            "relative flex min-w-0 shrink-0 items-center border-b border-border px-3 py-2 [border-bottom-width:0.5px]",
            branding
              ? "relative z-30 h-14 flex-nowrap overflow-hidden border-white/60 bg-background/80 shadow-[0_10px_30px_-22px_rgba(15,23,42,0.55),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl backdrop-saturate-150 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/90 before:to-transparent dark:border-white/10 dark:bg-background/72 dark:shadow-[0_10px_30px_-22px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.12)] dark:before:via-white/20"
              : "flex-wrap",
            compactToolbar ? "gap-1" : "gap-2",
          )}>
            {branding ? (
              <div className="order-0 flex min-w-0 shrink-0 items-center gap-2.5 border-r border-border/70 pr-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-white/70 bg-white/70 text-foreground shadow-[0_6px_18px_-12px_rgba(15,23,42,0.8),inset_0_1px_0_rgba(255,255,255,0.9)] dark:border-white/10 dark:bg-white/8 dark:shadow-none" aria-hidden="true">
                  {branding.kind === "slides" ? <Presentation className="size-4" /> : <Layers3 className="size-4" />}
                </span>
                <div className="flex min-w-0 flex-col justify-center leading-none">
                  <strong className="truncate text-sm font-semibold tracking-[-0.02em]">{branding.title}</strong>
                  <a
                    href={branding.bylineUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 w-fit truncate text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {branding.byline}
                  </a>
                </div>
              </div>
            ) : null}
            {hasSiteVersioning ? (
              <div className={cn("order-0 flex min-w-0 flex-1 items-center gap-2", veryCompactToolbar && "hidden")}>
                <p className="min-w-0 truncate text-sm font-medium">{activePageDisplayName}</p>
                {versionTargets.length > 0 ? (
                  <Select value={viewedVersionPath} onValueChange={(value) => { if (value) void viewVersion(value); }}>
                    <SelectTrigger size="sm" className="w-14 shrink-0 rounded-lg border-0 bg-transparent px-2 shadow-none hover:bg-muted focus-visible:ring-0" aria-label="Design version"><SelectValue>{viewedVersionLabel}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="current">{currentVersionLabel}</SelectItem>
                      {versionTargets.map((version, index) => <SelectItem key={version.path} value={version.path}>V{versionTargets.length - index}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
            ) : null}
            {deck ? (
              <div className="order-2 flex h-8 min-w-0 items-center rounded-lg border border-border bg-transparent p-0.5 shadow-none" data-testid="design-deck-navigation">
                <Button variant="ghost" size="icon-sm" className="size-7 rounded-md text-foreground hover:bg-muted" onClick={() => navigateDeck("previous")} disabled={deck.index <= 0} aria-label="Previous slide" title="Previous slide">
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-0 max-w-40 truncate px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground" aria-live="polite">
                  {deck.index + 1} / {deck.total}
                </span>
                <Button variant="ghost" size="icon-sm" className="size-7 rounded-md text-foreground hover:bg-muted" onClick={() => navigateDeck("next")} disabled={deck.index >= deck.total - 1} aria-label="Next slide" title="Next slide">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            ) : null}
            {!isPresentationTemplate ? (
              compactToolbar ? null : (
                <ToggleGroup
                  value={[previewDevice]}
                  onValueChange={(value) => {
                    const next = value[0];
                    if (next !== "desktop" && next !== "mobile") return;
                    setPreviewDevice(next);
                    setSelectionState(null);
                    setQuickEdit(null);
                    setAdvancedOpen(false);
                  }}
                  variant="outline"
                  size="sm"
                  aria-label={t("design.toolbar.preview_device")}
                  className="order-3 shrink-0 rounded-lg"
                >
                  <ToggleGroupItem value="desktop" className="h-8 w-8 rounded-l-lg px-0" aria-label={t("design.toolbar.desktop")} title={t("design.toolbar.desktop")}>
                    <Monitor className="size-3.5 stroke-[1.5]" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="mobile" className="h-8 w-8 rounded-r-lg px-0" aria-label={t("design.toolbar.mobile")} title={t("design.toolbar.mobile")}>
                    <Smartphone className="size-3.5 stroke-[1.5]" />
                  </ToggleGroupItem>
                </ToggleGroup>
              )
            ) : null}
            <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2" data-testid="design-mode-controls">
              {editControl}
            </div>
            <div className={cn("ml-auto flex shrink-0 items-center gap-1", isPresentationTemplate ? "order-3" : "order-2")}>
              {branding ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 rounded-lg bg-foreground px-2.5 text-xs font-semibold text-background shadow-none hover:bg-foreground/90 hover:text-background"
                    onClick={branding.onAskAi}
                    aria-label="Ask AI about this document"
                    title="Ask AI"
                  >
                    <Sparkles className="size-4" />
                    <span className={cn(compactToolbar && "sr-only")}>Ask AI</span>
                  </Button>
                </>
              ) : null}
              {templateControl}
              {editing ? <Button
                variant="ghost"
                size="icon-sm"
                className={cn(DESIGN_ACTION_BUTTON_CLASS, elementPropertiesOpen && "bg-muted")}
                onClick={toggleElementProperties}
                aria-label={t("design.toolbar.properties")}
                title={t("design.toolbar.properties")}
                aria-pressed={elementPropertiesOpen}
                data-testid="design-properties-button"
              >
                <SlidersHorizontal />
              </Button> : null}
              <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
              <div className="flex shrink-0 items-center gap-1" data-testid="design-history-controls">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={DESIGN_ACTION_BUTTON_CLASS}
                  onClick={() => void undo()}
                  disabled={history.length === 0 && !aiUndoCheckpoint}
                  aria-label={t("design.toolbar.undo")}
                  title={history.length === 0 && !aiUndoCheckpoint ? t("design.toolbar.undo_empty") : t("design.toolbar.undo")}
                >
                  <Undo2 />
                </Button>
                {isPresentationTemplate ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={DESIGN_ACTION_BUTTON_CLASS}
                    onClick={() => setPresentationZoom(1)}
                    disabled={presentationZoom === 1}
                    aria-label="Fit canvas to view"
                    title="Fit canvas to view"
                  >
                    <Focus />
                  </Button>
                ) : null}
                {onSaveAsTemplate ? (
                  <DesignSaveMenu
                    triggerClassName={DESIGN_ACTION_BUTTON_CLASS}
                    expanded={expanded}
                    saving={saveMutation.isPending}
                    saveDisabled={!editing && !dirty}
                    onSave={() => saveMutation.mutate()}
                    onSaveAsTemplate={onSaveAsTemplate}
                  />
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={DESIGN_ACTION_BUTTON_CLASS}
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending || (!editing && !dirty)}
                    aria-label={t("design.toolbar.save")}
                    title={t("design.toolbar.save")}
                  >
                    {saveMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                  </Button>
                )}
              </div>
              <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
              <div className="flex shrink-0 items-center gap-1" data-testid="design-sharing-controls">
                {!compactToolbar && features.publish ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={DESIGN_ACTION_BUTTON_CLASS}
                    onClick={() => publishMutation.mutate()}
                    disabled={publishMutation.isPending || saveMutation.isPending || !lockedPath}
                    aria-label={t("design.toolbar.publish")}
                    title={t("design.toolbar.publish")}
                  >
                    {publishMutation.isPending ? <Loader2 className="animate-spin" /> : <Share2 />}
                  </Button>
                ) : null}
                {deck || compactToolbar ? (
                  <DesignExportMenu
                    triggerClassName={DESIGN_ACTION_BUTTON_CLASS}
                    compact={compactToolbar}
                    expanded={expanded}
                    showExports={Boolean(deck)}
                    publishing={publishMutation.isPending}
                    publishDisabled={publishMutation.isPending || saveMutation.isPending || !lockedPath}
                    exportingPdf={exportingPdf}
                    exportingPptx={exportingPptx}
                    exportReady={previewLoaded}
                    exportDisabledReason="Preview is still preparing."
                    previewDevice={!isPresentationTemplate ? previewDevice : undefined}
                    onPreviewDeviceChange={!isPresentationTemplate ? (device) => {
                      setPreviewDevice(device);
                      setSelectionState(null);
                      setQuickEdit(null);
                      setAdvancedOpen(false);
                    } : undefined}
                    onPublish={features.publish ? () => publishMutation.mutate() : undefined}
                    onExportPdf={() => void exportDeckToPdf()}
                    onExportPptx={() => setPptxConfirmationOpen(true)}
                  />
                ) : null}
                {branding ? (
                  <a
                    href={branding.repositoryUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(DESIGN_ACTION_BUTTON_CLASS, "inline-flex items-center justify-center border border-border/70 bg-background/65 shadow-sm hover:border-foreground/20 hover:bg-background")}
                    aria-label="View DeepSeek Design on GitHub"
                    title="DeepSeek Design on GitHub"
                  >
                    <Github className="size-[18px]" />
                  </a>
                ) : null}
              </div>
            </div>
          </div>

          {fileQuery.isLoading || !sourceHydrated ? (
            <div className="flex flex-1 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : fileQuery.isError ? (
            <div className="p-4 text-sm text-destructive">{fileQuery.error.message}</div>
          ) : (
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
              <div
                ref={previewViewportRef}
                className={cn("relative min-w-0 flex-1 overflow-hidden bg-muted/30 p-2", !isPresentationTemplate && previewDevice === "mobile" && "flex justify-center bg-muted/50 px-4 py-3")}
              >
                <div
                  ref={presentationPanRef}
                  className={cn(isPresentationTemplate ? "absolute inset-0 overflow-auto" : "contents")}
                  onScroll={isPresentationTemplate
                    ? (event) => setPresentationScroll({ left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop })
                    : undefined}
                >
                  <div
                    className={cn(isPresentationTemplate ? "relative" : "contents")}
                    style={isPresentationTemplate ? { width: presentationCanvasStage.width, height: presentationCanvasStage.height } : undefined}
                  >
                    <iframe
                      ref={iframeRef}
                      key={`${activePagePath}:${previewRevision}`}
                      srcDoc={preview}
                      title={`Design preview: ${activePageDisplayName}`}
                      className={cn(
                        "border border-border bg-white transition-[width,border-radius,box-shadow,transform] duration-200",
                        isPresentationTemplate
                          ? "absolute h-[900px] w-[1600px] origin-top-left rounded-lg shadow-sm"
                          : previewDevice === "desktop"
                          ? "h-full w-full rounded-lg shadow-sm"
                          : "h-full w-[390px] max-w-full shrink-0 rounded-[26px] shadow-xl shadow-black/15",
                      )}
                      style={isPresentationTemplate
                        ? {
                          left: presentationCanvasLeft,
                          top: presentationCanvasTop,
                          transform: `scale(${presentationScale})`,
                        }
                        : undefined}
                      sandbox="allow-scripts allow-same-origin"
                      data-preview-loaded={previewLoaded ? "true" : "false"}
                      onLoad={() => {
                        setPreviewLoaded(true);
                        const frameWindow = iframeRef.current?.contentWindow;
                        const pending = pendingViewRestoreRef.current;
                        if (pending && !expectsDesignRestoreFrame(pending, previewSource, previewRevision, activeFrameRevision)) return;
                        if (pending) pending.frameLoaded = true;
                        if (activePageHash && !pending) frameWindow?.postMessage({ channel: DESIGN_MESSAGE_CHANNEL, type: "scroll-to", hash: activePageHash }, "*");
                        frameWindow?.postMessage({ channel: DESIGN_MESSAGE_CHANNEL, type: "set-editing", editing }, "*");
                        const deckIndex = pending?.deckIndex ?? deckRef.current?.index;
                        if (deckIndex !== undefined && deckIndex !== null) {
                          frameWindow?.postMessage({ channel: DESIGN_MESSAGE_CHANNEL, type: "deck-navigate", direction: "index", index: deckIndex, viewRevision: pending?.id ?? "" }, "*");
                        }
                        if (pending) {
                          frameWindow?.postMessage({
                            channel: DESIGN_MESSAGE_CHANNEL,
                            type: "restore-view",
                            viewRevision: pending.id,
                            scrollX: pending.frameScrollX,
                            scrollY: pending.frameScrollY,
                          }, "*");
                          window.requestAnimationFrame(() => presentationPanRef.current?.scrollTo({ left: pending.panLeft, top: pending.panTop }));
                        }
                      }}
                    />
                  </div>
                </div>
                {editing && selection && selectionSummary ? (
                  <div
                    ref={floatingToolbarRef}
                    className="absolute z-20 flex w-max items-center gap-4 rounded-lg border border-border bg-popover px-4 py-2 text-popover-foreground shadow-[0_4px_4.2px_rgba(0,0,0,0.09)]"
                    style={floatingStyle}
                    role="toolbar"
                    aria-label="Design floating toolbar"
                    data-testid="design-floating-toolbar"
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerUp={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="grid size-6 shrink-0 touch-none cursor-grab place-items-center rounded transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                      onPointerDown={startFloatingDrag}
                      onPointerMove={moveFloatingToolbar}
                      onPointerUp={stopFloatingDrag}
                      onPointerCancel={stopFloatingDrag}
                      onLostPointerCapture={stopFloatingDrag}
                      aria-label="Move floating toolbar"
                      title="Drag toolbar"
                    >
                      <img src={floatingToolbarGrip} alt="" className="size-4 select-none" draggable={false} />
                    </button>
                    {quickEdit && (!isMultiSelection || quickEdit === "color") ? (
                      <div className="flex items-center gap-1">
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
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        {!isMultiSelection && selection.canEditText ? (
                          <>
                            <button
                              type="button"
                              className="flex h-6 shrink-0 items-center rounded px-1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => beginQuickEdit("text")}
                              aria-label="Edit selected text"
                            >
                              <img src={floatingToolbarEditText} alt="" className="h-4 w-auto select-none" draggable={false} />
                            </button>
                            <button
                              type="button"
                              className="h-6 shrink-0 rounded px-1 text-base font-normal leading-6 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => beginQuickEdit("fontSize")}
                              aria-label="Change selected font size"
                            >
                              {fontSize}
                            </button>
                          </>
                        ) : null}
                        <Button
                          variant={elementPropertiesOpen ? "secondary" : "ghost"}
                          size="icon-xs"
                          onClick={toggleElementProperties}
                          aria-label="Toggle advanced design settings"
                          aria-pressed={elementPropertiesOpen}
                        >
                          <img src={floatingToolbarSettings} alt="" className="size-[18px] select-none" draggable={false} />
                        </Button>
                        {isMultiSelection || selection.tag !== "img" ? (
                          <button
                            type="button"
                            className={FLOATING_TOOLBAR_BUTTON_CLASS}
                            onClick={() => beginQuickEdit("color")}
                            aria-label={selection.colorField === "color" ? "Change selected text color" : "Change selected background color"}
                            title={selection.colorField === "color" ? "Text color" : "Background color"}
                          >
                            <img src={floatingToolbarPalette} alt="" className="size-[18px] select-none" draggable={false} />
                          </button>
                        ) : null}
                        {!isMultiSelection ? <button
                          type="button"
                          className={FLOATING_TOOLBAR_BUTTON_CLASS}
                          onClick={() => void askAiAboutSelection()}
                          disabled={!selection.canDelete || saveMutation.isPending || viewedVersionPath !== "current"}
                          aria-label="Ask AI about selected element"
                          title="Ask AI"
                        >
                          <img src={floatingToolbarAiIcon} alt="" className="size-[18px] select-none" draggable={false} />
                        </button> : null}
                        <img src={floatingToolbarDivider} alt="" className="h-[22.5px] w-px shrink-0 select-none" draggable={false} />
                        <button
                          type="button"
                          className={FLOATING_TOOLBAR_BUTTON_CLASS}
                          onClick={() => setDeleteConfirmationOpen(true)}
                          disabled={!selectionSummary.selections.some((member) => member.canDelete)}
                          aria-label={isMultiSelection ? "Delete selected elements" : "Delete selected element"}
                          title={isMultiSelection ? "Delete selected elements" : "Delete selected element"}
                        >
                          <img src={floatingToolbarTrash} alt="" className="size-[18px] select-none" draggable={false} />
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              {editing && advancedOpen ? <DesignPropertiesInspector
                selection={selection}
                isMultiSelection={isMultiSelection}
                selectionCount={selectionSummary?.selectionCount ?? 0}
                mixedStyleFields={selectionSummary?.mixedStyleFields ?? []}
                gradientRecommendationColors={[
                  designTokenValues["--ipw-color-primary"],
                  designTokenValues["--ipw-color-secondary"],
                  designTokenValues["--ipw-color-accent"],
                  designTokenValues["--ipw-color-bg"],
                  designTokenValues["--ipw-color-surface"],
                  selection?.styles.backgroundColor,
                ]}
                activeTab={propertiesTab}
                onClose={() => setAdvancedOpen(false)}
                onActiveTabChange={handlePropertiesTabChange}
                onApplyField={applyField}
                onApplyFields={applyStyleFields}
                onAlign={alignSelection}
                onToggleLock={toggleSelectionLock}
                onDelete={() => setDeleteConfirmationOpen(true)}
                onChooseReplacementImage={() => void chooseReplacementImage()}
                onChooseBackgroundImage={() => void chooseBackgroundImage()}
              >
                <DesignSystemDrawer
                  embedded
                  open={propertiesTab === "design-system"}
                  templateName={designTemplate?.title ?? activePageDisplayName}
                  currentThemeId={appliedDesignSystemId}
                  initialValues={designTokenValues}
                  onClose={() => setAdvancedOpen(false)}
                  onTokenChange={handleDesignTokenChange}
                  onApplyDesignSystem={handleApplyDesignSystem}
                  onChooseBackgroundImage={() => void chooseDesignSystemBackgroundImage()}
                />
              </DesignPropertiesInspector> : null}
            </div>
          )}
        </>
      )}
      <ConfirmModal
        open={deleteConfirmationOpen}
        title={isMultiSelection ? "Delete selected elements?" : "Delete selected element?"}
        message={isMultiSelection
          ? `${selectionSummary?.selectionCount ?? 0} selected elements will be removed. You can still use Undo before saving.`
          : "This element will be removed from the design. You can still use Undo before saving."}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onCancel={() => setDeleteConfirmationOpen(false)}
        onConfirm={() => {
          setDeleteConfirmationOpen(false);
          deleteSelection();
        }}
      />
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
      {templateCatalog && client && workspaceId ? (
        <DesignTemplateDialog
          open={templateDialogOpen}
          onOpenChange={setTemplateDialogOpen}
          client={client}
          workspaceId={workspaceId}
          sessionId={sessionId}
          copy={templateCatalog}
          onApplied={applyTemplateSnapshot}
        />
      ) : null}
    </div>
  );
}
