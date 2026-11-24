import { customDrawingPreview } from './drawing-custom-preview.ts';
import { drawingSourceIssues } from '../store/package/drawing-support-issues.ts';
import { selectedDrawingGraphicKind } from '../store/package/drawing-graphic-kind.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
// Drawing paint dispatch (typed-drawings-and-images task 10).
//
// Trust boundary: every string is file-derived or host-supplied through i18n callbacks.
// DOM is built with createElement/setAttribute/textContent only; styles use validated numbers
// or fixed tokens — never raw authored markup or unescaped file-derived CSS.

import { clearUnsupportedElement, markUnsupportedElement } from './unsupported-elements.ts';
import type {
  RenderableImageMime,
  ValidatedImageBytesHandle,
} from '../store/package/image-resources.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import { applyDrawingBilevelFilter } from './drawing-bilevel-filter.ts';
import { drawingFilterStyle } from './drawing-lum-filter.ts';
import type { DrawingPoint } from '../layout/drawing-geometry.ts';
import { cssTransformForDrawingImage } from '../layout/drawing-geometry.ts';
import { vectorShapeInkClip } from '../layout/vector-shape-ink.ts';
import type {
  LayoutBox,
  PageRecord,
  ParagraphFragmentRecord,
  TableFragmentRecord,
} from '../layout/semantic-records.ts';
import {
  forEachPageStory,
  forEachStoryDrawing,
  forEachStoryParagraphFragment,
} from '../layout/semantic-record-queries.ts';
import type { SemanticLayout } from '@docx-editor.dev/core/layout';
import { paintLayerOf } from '../layout/drawing-exclusion.ts';
import {
  groupPictureLayerDrawing,
  type DrawingGroupPictureLayerRecord,
} from '../layout/drawing-group-picture-layers.ts';
import { appendReflection, applySoftEdge } from './semantic-paint-picture-effects.ts';
import {
  applyVectorInkReach,
  isFramedPicture,
  vectorShapeFrame,
} from './semantic-paint-vector-shape.ts';
import { paintGroupTextboxStories } from './semantic-paint-group-text.ts';
import { paintTextArt } from './semantic-paint-text-art.ts';
import { paintTextboxStory } from './semantic-paint-textbox.ts';
import { applyAccessibility, positionedBox } from './semantic-paint-drawing-box.ts';
import {
  REVIEW_AUTHOR_SLOTS,
  revisionPresentationOf,
  type RevisionStyleContext,
} from './revision-presentation.ts';
import { blockContentSummary } from './block-content-summary.ts';

/** Host port for safe blob URLs — only called for {@link ImageResourceState.kind} `ready`. */
export interface PaintImageUrlPort {
  create(handle: ValidatedImageBytesHandle, mime: RenderableImageMime): string;
  revoke(url: string): void;
}

import type { DrawingPaintStrings } from './drawing-paint-strings.ts';
export type { DrawingPaintStrings } from './drawing-paint-strings.ts';
export {
  DEFAULT_DRAWING_PAINT_STRINGS,
  drawingPaintStringsCacheToken,
  drawingPaintStringsFromTranslate,
} from './drawing-paint-strings.ts';

export interface DrawingPaintContext {
  readonly includePartial?: boolean;
  readonly unsupportedSource?: (nodeId: string, ownerPartName?: string) => OoxmlElement | null;
  readonly scale: number;
  readonly strings: DrawingPaintStrings;
  readonly imageUrlPort?: PaintImageUrlPort;
  readonly inertLinks?: boolean;
  /**
   * Discriminates repeated paints of the SAME drawing (a header image appears once per
   * page). Combined with the drawing id it keys `<img>` element reuse across repaints,
   * so a keystroke moves the already-decoded element instead of recreating it — a fresh
   * element re-decodes asynchronously and flashes blank for a frame.
   */
  readonly paintInstance?: string;
  /**
   * Host-supplied fragment painter for textbox stories (the host owns paragraph/table
   * fragment paint). Absent hosts degrade textbox drawings to the placeholder card.
   */
  readonly paintStoryFragment?: (
    document: Document,
    fragment: ParagraphFragmentRecord | TableFragmentRecord,
    /** `readOnly` paints without selection and editing bindings. */
    options?: { readonly readOnly?: boolean }
  ) => HTMLElement;
  /** Paint drawings without their node binding, inside a story no command may reach. */
  readonly unbound?: boolean;
  /** Resolved author colouring, so a tracked drawing's cue follows the span scheme. */
  readonly revisionStyles?: RevisionStyleContext;
}

// A Map, not an object literal. `ImageResourceState.mime` is a closed union — it comes from
// `sniffImageMime` or from the content-type lookup, both of which already refuse anything
// else — so this is hardening at a sink that is not currently reachable, kept because the
// union is the only thing standing between a file-derived string and this lookup.
const MIME_FORMAT_LABEL: ReadonlyMap<string, string> = new Map([
  ['image/svg+xml', 'SVG'],
  ['image/tiff', 'TIFF'],
  ['image/x-emf', 'EMF'],
  ['image/x-wmf', 'WMF'],
]);
const UNKNOWN_FORMAT_LABEL = 'Unknown';

interface UrlRegistry {
  readonly urlForReady: (
    handle: ValidatedImageBytesHandle,
    mime: RenderableImageMime
  ) => string | null;
  /** Stable `<img>` per (paint instance, drawing, resource) — reuse keeps the decode. */
  readonly imageFor?: (
    elementKey: string,
    resourceKey: string,
    document: Document
  ) => HTMLImageElement;
  /** Previously decoded image to retain while a new package snapshot revalidates it. */
  readonly imageForPending?: (elementKey: string) => HTMLImageElement | null;
  readonly readyElementFor?: (elementKey: string) => HTMLElement | null;
  readonly rememberReadyElement?: (elementKey: string, element: HTMLElement) => void;
  readonly reconcile: (
    usedResourceKeys: ReadonlySet<string>,
    usedElementKeys: ReadonlySet<string>
  ) => void;
  readonly revokeAll: () => void;
}

const urlRegistries = new WeakMap<object, UrlRegistry>();
const readyImagePaintSignatures = new WeakMap<HTMLElement, string>();

/** Cached-element ceiling per registry — beyond it paint falls back to fresh elements. */
const MAX_CACHED_DRAWING_IMAGES = 256;

export function drawingUrlRegistryFor(
  container: HTMLElement,
  port: PaintImageUrlPort
): UrlRegistry {
  let registry = urlRegistries.get(container);
  if (registry) return registry;
  const urlsByKey = new Map<string, string>();
  const imagesByElementKey = new Map<
    string,
    {
      readonly element: HTMLImageElement;
      readonly resourceKey: string;
      readonly readyElement?: HTMLElement;
    }
  >();
  registry = Object.freeze({
    urlForReady(handle: ValidatedImageBytesHandle, mime: RenderableImageMime): string | null {
      const existing = urlsByKey.get(handle.resourceKey);
      if (existing) return existing;
      let url: string;
      try {
        url = port.create(handle, mime);
      } catch (error) {
        // Layout marked the resource ready, but the validated bytes are gone — a
        // package reset between layout and paint, or a stale handle. Paint must
        // still finish; the placeholder stands until a later pass mints.
        if (error instanceof Error && error.message.startsWith('PaintImageUrlSource:')) {
          return null;
        }
        throw error;
      }
      urlsByKey.set(handle.resourceKey, url);
      return url;
    },
    imageFor(elementKey: string, resourceKey: string, document: Document): HTMLImageElement {
      const cached = imagesByElementKey.get(elementKey);
      if (cached && cached.resourceKey === resourceKey) return cached.element;
      const element = document.createElement('img');
      if (imagesByElementKey.size < MAX_CACHED_DRAWING_IMAGES) {
        imagesByElementKey.set(elementKey, {
          element,
          resourceKey,
          ...(cached?.readyElement ? { readyElement: cached.readyElement } : {}),
        });
      }
      return element;
    },
    imageForPending(elementKey: string): HTMLImageElement | null {
      return imagesByElementKey.get(elementKey)?.element ?? null;
    },
    readyElementFor(elementKey: string): HTMLElement | null {
      return imagesByElementKey.get(elementKey)?.readyElement ?? null;
    },
    rememberReadyElement(elementKey: string, element: HTMLElement): void {
      const cached = imagesByElementKey.get(elementKey);
      if (!cached) return;
      imagesByElementKey.set(elementKey, { ...cached, readyElement: element });
    },
    reconcile(usedResourceKeys: ReadonlySet<string>, usedElementKeys: ReadonlySet<string>): void {
      // A pending picture paints its retained image, so that image's URL stays live too.
      // Revoked, the retained image blanks, and the next ready paint loads it again.
      const retainedResourceKeys = new Set<string>();
      for (const [key, entry] of imagesByElementKey) {
        if (usedElementKeys.has(key)) retainedResourceKeys.add(entry.resourceKey);
      }
      for (const [key, url] of urlsByKey) {
        if (usedResourceKeys.has(key) || retainedResourceKeys.has(key)) continue;
        port.revoke(url);
        urlsByKey.delete(key);
      }
      for (const [key, entry] of imagesByElementKey) {
        if (usedElementKeys.has(key)) continue;
        entry.element.removeAttribute('src');
        imagesByElementKey.delete(key);
      }
    },
    revokeAll(): void {
      for (const url of urlsByKey.values()) port.revoke(url);
      urlsByKey.clear();
      for (const entry of imagesByElementKey.values()) entry.element.removeAttribute('src');
      imagesByElementKey.clear();
    },
  });
  urlRegistries.set(container, registry);
  return registry;
}

function drawingElementKey(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext
): string {
  return `${ctx.paintInstance ?? ''}|${drawing.drawingNodeId}`;
}

export function detachDrawingUrlRegistry(container: HTMLElement): void {
  const registry = urlRegistries.get(container);
  registry?.revokeAll();
  urlRegistries.delete(container);
}

function finiteStyle(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(value);
}

function cssClipPathFromPolygon(
  polygon: readonly DrawingPoint[],
  bounds: LayoutBox
): string | null {
  if (polygon.length < 3 || bounds.width <= 0 || bounds.height <= 0) return null;
  const parts: string[] = [];
  for (const point of polygon) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const px = ((point.x - bounds.x) / bounds.width) * 100;
    const py = ((point.y - bounds.y) / bounds.height) * 100;
    parts.push(`${finiteStyle(px)}% ${finiteStyle(py)}%`);
  }
  return `polygon(${parts.join(', ')})`;
}

/** Pixel transform — xfrm affine into wp:extent; crop stays inside the transform stage. */
function imagePaintTransformStyle(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord
): string | undefined {
  const content = drawing.geometry.contentBounds;
  return cssTransformForDrawingImage({
    transform: drawing.transform,
    contentWidth: content.width,
    contentHeight: content.height,
  });
}

function cropImageStyles(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  resource: Extract<InlineDrawingRecord['resource'], { kind: 'ready' }>
): {
  readonly width: string;
  readonly height: string;
  readonly left: string;
  readonly top: string;
} {
  const { crop } = drawing;
  const left = Math.max(0, Math.min(1, crop.left));
  const top = Math.max(0, Math.min(1, crop.top));
  const right = Math.max(0, Math.min(1, crop.right));
  const bottom = Math.max(0, Math.min(1, crop.bottom));
  const visibleW = Math.max(0.000_1, 1 - left - right);
  const visibleH = Math.max(0.000_1, 1 - top - bottom);
  void resource;
  return Object.freeze({
    width: `${finiteStyle((1 / visibleW) * 100)}%`,
    height: `${finiteStyle((1 / visibleH) * 100)}%`,
    left: `${finiteStyle((-left / visibleW) * 100)}%`,
    top: `${finiteStyle((-top / visibleH) * 100)}%`,
  });
}

function refusalLabel(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  strings: DrawingPaintStrings
): string {
  const { resource } = drawing;
  switch (resource.kind) {
    case 'external':
      return strings.externalResource;
    case 'missing':
      return strings.missingResource;
    case 'pending':
      return strings.pendingResource;
    case 'unrenderable':
      switch (resource.reason) {
        case 'unsupported-format':
          return strings.unsupportedFormat(
            MIME_FORMAT_LABEL.get(resource.mime) ?? UNKNOWN_FORMAT_LABEL
          );
        case 'non-picture-graphic':
          return strings.nonPictureGraphic(drawing.placeholderGraphicKind ?? 'graphic');
        case 'signature-mismatch':
          return strings.contentMismatch;
        case 'decode-failed':
          return strings.decodeFailed;
        case 'resource-limit':
          return strings.resourceLimit;
        default:
          return strings.invalidResource;
      }
    default:
      return strings.invalidResource;
  }
}

/** The box the image fills: a group picture's member frame, else the drawing's content box. */
function imageFrameBounds(drawing: InlineDrawingRecord | AnchoredDrawingRecord): LayoutBox {
  const corners = drawing.groupPicture ? drawing.geometry.imageTransformCorners : undefined;
  if (!corners || corners.length === 0) return drawing.geometry.contentBounds;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of corners) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function readyImagePaintSignature(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  resource: Extract<InlineDrawingRecord['resource'], { kind: 'ready' }>,
  ctx: DrawingPaintContext,
  url: string,
  origin?: LayoutBox
): string {
  const paint = drawing.paintBounds;
  const content = imageFrameBounds(drawing);
  const crop = cropImageStyles(drawing, resource);
  return [
    url,
    ctx.scale,
    origin?.x ?? 0,
    origin?.y ?? 0,
    paint.x,
    paint.y,
    paint.width,
    paint.height,
    content.x,
    content.y,
    content.width,
    content.height,
    cssClipPathFromPolygon(drawing.geometry.clipPolygon ?? [], paint) ?? '',
    drawingFilterStyle(drawing.effects) ?? '',
    drawing.effects.bilevel ?? '',
    imagePaintTransformStyle(drawing) ?? '',
    crop.width,
    crop.height,
    crop.left,
    crop.top,
    ctx.inertLinks ? '' : (drawing.hyperlinkHref ?? ''),
    drawing.accessibility.label ?? '',
  ].join('|');
}

function paintPlaceholderCard(
  document: Document,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext,
  origin?: LayoutBox
): HTMLElement {
  const outer = document.createElement('div');
  outer.className = 'docx-drawing docx-drawing-placeholder';
  if (!ctx.unbound) outer.dataset.drawingNodeId = drawing.drawingNodeId;
  positionedBox(outer, drawing.paintBounds, ctx.scale, origin);

  const card = document.createElement('div');
  card.className = 'docx-drawing-placeholder-card';
  const label = document.createElement('span');
  label.className = 'docx-drawing-placeholder-label';
  label.textContent = refusalLabel(drawing, ctx.strings);
  card.append(label);
  const source = ctx.unsupportedSource?.(drawing.drawingNodeId, drawing.ownerPartName) ?? null;
  markUnsupportedElement(
    card,
    label,
    {
      ownerPartName: drawing.ownerPartName,
      namespaceUri:
        source?.namespaceUri ?? 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      localName: source?.localName ?? 'drawing',
      source,
      ...(source
        ? {
            drawingIssues: drawingSourceIssues(source, drawing.drawingNodeId),
            graphicKind: selectedDrawingGraphicKind(source, drawing.drawingNodeId),
          }
        : {}),
      support: 'unrendered',
      placement: 'inline',
      bounds: drawing.paintBounds,
      nodeId: drawing.drawingNodeId,
      label: label.textContent,
      drawing,
    },
    outer
  );
  outer.append(card);

  if (drawing.hyperlinkHref && !ctx.inertLinks) {
    outer.dataset.docxDrawingLink = drawing.drawingNodeId;
    outer.dataset.docxDrawingLinkKind = 'external';
    outer.dataset.docxDrawingLinkHref = drawing.hyperlinkHref;
    outer.setAttribute('tabindex', '-1');
    applyAccessibility(outer, drawing, true);
  } else {
    applyAccessibility(outer, drawing, false);
  }
  return outer;
}

/**
 * The positioned, clipped and cropped frame that shows one ready picture of `drawing` in
 * `img`. A clip that belongs on the drawing's outer box comes back as `outerClipPath`.
 */
function imageFrameElement(
  document: Document,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  resource: Extract<InlineDrawingRecord['resource'], { kind: 'ready' }>,
  ctx: DrawingPaintContext,
  url: string,
  img: HTMLImageElement
): { readonly inner: HTMLElement; readonly outerClipPath: string | null } {
  const inner = document.createElement('div');
  inner.className = 'docx-drawing-image-frame';
  inner.style.position = 'absolute';
  const content = imageFrameBounds(drawing);
  const paint = drawing.paintBounds;
  // Preset clip in authoritative paint space — xfrm rotation is already in clipPolygon. A
  // group, or a picture with its own frame, clips only its picture there: the vector paint
  // shares the outer box, which clips at the paint bounds so strokes can use the effect
  // extent, as a lone shape does.
  const clipsPictureOnly =
    drawing.groupPicture !== undefined ||
    drawing.vectorShape !== null ||
    drawing.frameEffects !== undefined;
  const clipPath = cssClipPathFromPolygon(
    drawing.geometry.clipPolygon ?? [],
    clipsPictureOnly ? content : paint
  );
  if (clipPath && clipsPictureOnly) inner.style.clipPath = clipPath;
  inner.style.left = `${(content.x - paint.x) * ctx.scale}px`;
  inner.style.top = `${(content.y - paint.y) * ctx.scale}px`;
  inner.style.width = `${content.width * ctx.scale}px`;
  inner.style.height = `${content.height * ctx.scale}px`;

  const filter = drawingFilterStyle(drawing.effects);
  if (filter) inner.style.filter = filter;

  const transformStage = document.createElement('div');
  transformStage.className = 'docx-drawing-transform-stage';
  transformStage.style.position = 'relative';
  transformStage.style.width = '100%';
  transformStage.style.height = '100%';
  const flipTransform = imagePaintTransformStyle(drawing);
  if (flipTransform) {
    transformStage.style.transform = flipTransform;
    transformStage.style.transformOrigin = '0 0';
  }

  const cropViewport = document.createElement('div');
  cropViewport.className = 'docx-drawing-crop-viewport';
  cropViewport.style.position = 'relative';
  cropViewport.style.width = '100%';
  cropViewport.style.height = '100%';
  cropViewport.style.overflow = 'hidden';

  img.className = 'docx-drawing-image';
  img.setAttribute('draggable', 'false');
  // SAFE: `src` is a host-minted object URL from PaintImageUrlPort, never file-derived.
  // Re-assigning an identical src still restarts the load and blanks a frame — skip it.
  if (img.getAttribute('src') !== url) img.setAttribute('src', url);
  img.setAttribute('alt', '');

  const cropStyles = cropImageStyles(drawing, resource);
  img.style.position = 'absolute';
  img.style.width = cropStyles.width;
  img.style.height = cropStyles.height;
  img.style.left = cropStyles.left;
  img.style.top = cropStyles.top;
  img.style.maxWidth = 'none';
  img.style.maxHeight = 'none';

  cropViewport.append(img);
  transformStage.append(cropViewport);
  inner.append(transformStage);
  return { inner, outerClipPath: clipPath && !clipsPictureOnly ? clipPath : null };
}

/** The URL of a group's later picture; null while it is not ready or cannot mint. */
function layerUrl(
  layer: DrawingGroupPictureLayerRecord,
  ctx: DrawingPaintContext,
  urlRegistry: UrlRegistry | null
): string | null {
  const resource = layer.resource;
  return resource.kind === 'ready' && ctx.imageUrlPort && urlRegistry
    ? urlRegistry.urlForReady(resource.validatedHandle, resource.mime)
    : null;
}

/** The frames of a group's later pictures in paint order; one still pending is left out. */
function groupPictureLayerFrames(
  document: Document,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext,
  urlRegistry: UrlRegistry | null
): HTMLElement[] {
  const frames: HTMLElement[] = [];
  for (const layer of drawing.groupPictureLayers ?? []) {
    const url = layerUrl(layer, ctx, urlRegistry);
    if (url === null || layer.resource.kind !== 'ready') continue;
    const img = document.createElement('img');
    const layered = groupPictureLayerDrawing(drawing, layer);
    frames.push(imageFrameElement(document, layered, layer.resource, ctx, url, img).inner);
  }
  return frames;
}

function paintReadyImage(
  document: Document,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext,
  url: string,
  urlRegistry: UrlRegistry | null,
  origin?: LayoutBox
): HTMLElement {
  const resource = drawing.resource;
  if (resource.kind !== 'ready') {
    return paintPlaceholderCard(document, drawing, ctx, origin);
  }

  const elementKey = drawingElementKey(drawing, ctx);
  const outer = urlRegistry?.readyElementFor?.(elementKey) ?? document.createElement('div');
  const paintSignature = readyImagePaintSignature(drawing, resource, ctx, url, origin);
  // A group's vector members are rebuilt on every paint; only a lone image is reused.
  const reusable = !drawing.vectorShape && !drawing.frameEffects && !drawing.groupPictureLayers;
  if (reusable && readyImagePaintSignatures.get(outer) === paintSignature) return outer;
  if (outer.hasAttribute('data-docx-unsupported')) clearUnsupportedElement(outer);
  outer.className = 'docx-drawing docx-drawing-ready';
  outer.style.cssText = '';
  if (!ctx.unbound) outer.dataset.drawingNodeId = drawing.drawingNodeId;
  delete outer.dataset.docxDrawingLink;
  delete outer.dataset.docxDrawingLinkKind;
  delete outer.dataset.docxDrawingLinkHref;
  outer.removeAttribute('aria-hidden');
  outer.removeAttribute('aria-label');
  outer.removeAttribute('role');
  outer.removeAttribute('tabindex');
  positionedBox(outer, drawing.paintBounds, ctx.scale, origin);

  const framed = imageFrameElement(
    document,
    drawing,
    resource,
    ctx,
    url,
    urlRegistry?.imageFor?.(elementKey, resource.resourceKey, document) ??
      document.createElement('img')
  );
  const inner = framed.inner;
  if (framed.outerClipPath) outer.style.clipPath = framed.outerClipPath;
  outer.replaceChildren(inner, ...groupPictureLayerFrames(document, drawing, ctx, urlRegistry));
  if (drawing.frameEffects) {
    const softEdge = drawing.frameEffects.softEdgeEmu ?? 0;
    applySoftEdge(inner, (softEdge / 12_700) * ctx.scale);
    appendReflection(document, outer, inner, drawing, ctx.scale);
  }
  if (drawing.vectorShape) {
    // A group's members drawn before its picture paint under it, as a frame's fill does.
    const framed = isFramedPicture(drawing) || drawing.groupPicture !== undefined;
    const ink = vectorShapeInkClip(drawing, drawing.paintBounds);
    // A picture's frame paints its shadow and fill under the picture and its outline over it.
    const frame = vectorShapeFrame(
      document,
      drawing,
      ctx.scale,
      framed ? (component) => component.belowPicture !== true : undefined
    );
    applyVectorInkReach(outer, frame, drawing.paintBounds, ink, ctx.scale);
    outer.append(frame);
    if (framed && drawing.vectorShape.components.some((component) => component.belowPicture)) {
      const under = vectorShapeFrame(
        document,
        drawing,
        ctx.scale,
        (component) => component.belowPicture === true
      );
      under.style.pointerEvents = 'none';
      outer.insertBefore(under, inner);
    }
  }
  applyDrawingBilevelFilter(document, outer, inner, drawing.effects.bilevel);

  if (drawing.hyperlinkHref && !ctx.inertLinks) {
    outer.dataset.docxDrawingLink = drawing.drawingNodeId;
    outer.dataset.docxDrawingLinkKind = 'external';
    outer.dataset.docxDrawingLinkHref = drawing.hyperlinkHref;
    outer.setAttribute('tabindex', '-1');
    applyAccessibility(outer, drawing, true);
  } else {
    applyAccessibility(outer, drawing, false);
  }
  urlRegistry?.rememberReadyElement?.(elementKey, outer);
  if (reusable) readyImagePaintSignatures.set(outer, paintSignature);
  else readyImagePaintSignatures.delete(outer);
  return outer;
}

/**
 * Paint a typed `wps:wsp` solid-geometry shape as inline SVG. Coordinates stay in the
 * projection's extent-EMU space via the viewBox; the frame div scales them to layout
 * points exactly like the image frame does, so clipped paint bounds crop correctly.
 */
function paintVectorShape(
  document: Document,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext,
  ink: LayoutBox,
  origin?: LayoutBox
): HTMLElement {
  const outer = document.createElement('div');
  outer.className = 'docx-drawing docx-drawing-shape';
  if (!ctx.unbound) outer.dataset.drawingNodeId = drawing.drawingNodeId;
  const paint = drawing.paintBounds;
  positionedBox(outer, paint, ctx.scale, origin);
  const frame = vectorShapeFrame(document, drawing, ctx.scale);
  applyVectorInkReach(outer, frame, paint, ink, ctx.scale);
  outer.append(frame);

  if (drawing.hyperlinkHref && !ctx.inertLinks) {
    outer.dataset.docxDrawingLink = drawing.drawingNodeId;
    outer.dataset.docxDrawingLinkKind = 'external';
    outer.dataset.docxDrawingLinkHref = drawing.hyperlinkHref;
    outer.setAttribute('tabindex', '-1');
    applyAccessibility(outer, drawing, true);
  } else {
    applyAccessibility(outer, drawing, false);
  }
  return outer;
}

/**
 * The tracked-change cue on a painted drawing (#479).
 *
 * Drawings share the page-margin change bars with text. The stylesheet dims a pending
 * removal, while the `data-revision-*` datasets let review chrome resolve a hovered
 * picture to its decision exactly like a hovered word.
 *
 * Applied on EVERY paint — including the ready-image path's signature-matched reuse, whose
 * cached element would otherwise keep the marking of a decision the document no longer
 * records. That is also why the untracked branch scrubs rather than returns.
 */
function applyDrawingRevisionPresentation(
  element: HTMLElement,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext
): void {
  const colors = ctx.revisionStyles;
  const presentation = revisionPresentationOf(
    drawing.revisions,
    colors?.authorSlots,
    colors?.styles
  );
  if (!presentation) {
    if (element.dataset.revisionKind === undefined) return;
    element.classList.remove(
      'docx-drawing--revision',
      'docx-drawing--revision-insertion',
      'docx-drawing--revision-deletion'
    );
    delete element.dataset.revisionKind;
    delete element.dataset.revisionId;
    delete element.dataset.reviewAuthor;
    delete element.dataset.revisionDate;
    delete element.dataset.reviewAuthorSlot;
    return;
  }
  const { attribution } = presentation;
  element.classList.add(
    'docx-drawing--revision',
    presentation.deleted ? 'docx-drawing--revision-deletion' : 'docx-drawing--revision-insertion'
  );
  element.classList.remove(
    presentation.deleted ? 'docx-drawing--revision-insertion' : 'docx-drawing--revision-deletion'
  );
  element.dataset.revisionKind = attribution.kind;
  element.dataset.revisionId = attribution.id;
  if (attribution.author !== '') element.dataset.reviewAuthor = attribution.author;
  else delete element.dataset.reviewAuthor;
  if (attribution.date !== undefined) element.dataset.revisionDate = attribution.date;
  else delete element.dataset.revisionDate;
  // Keep author attribution available to review chrome without painting a colored frame.
  if (colors) {
    element.dataset.reviewAuthorSlot = String(
      (colors.authorSlots.get(attribution.author) ?? 0) % REVIEW_AUTHOR_SLOTS
    );
  } else {
    delete element.dataset.reviewAuthorSlot;
  }
}

export function paintDrawingRecord(
  document: Document,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext,
  urlRegistry: UrlRegistry | null,
  origin?: LayoutBox
): HTMLElement | null {
  const element = paintDrawingRecordElement(document, drawing, ctx, urlRegistry, origin);
  if (element) {
    customDrawingPreview(
      element,
      drawing,
      ctx.includePartial === true,
      ctx.includePartial
        ? (ctx.unsupportedSource?.(drawing.drawingNodeId, drawing.ownerPartName) ?? null)
        : null
    );
    applyDrawingRevisionPresentation(element, drawing, ctx);
  }
  return element;
}

function paintDrawingRecordElement(
  document: Document,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext,
  urlRegistry: UrlRegistry | null,
  origin?: LayoutBox
): HTMLElement | null {
  if (drawing.accessibility.hidden) return null;
  // A straight line's paint box can have no width; its stroke still paints.
  const painted = drawing.vectorShape
    ? vectorShapeInkClip(drawing, drawing.paintBounds)
    : drawing.paintBounds;
  if (painted.width <= 0 || painted.height <= 0) return null;

  if (drawing.textboxStory !== undefined && ctx.paintStoryFragment !== undefined) {
    return paintTextboxStory(document, drawing, drawing.textboxStory, ctx, origin);
  }
  if (drawing.textArt) {
    return paintTextArt(
      document,
      { ...drawing, textArt: drawing.textArt },
      ctx.scale,
      !!ctx.unbound,
      origin
    );
  }

  // A group made only of text box members paints its text in its own layer, and a shape whose
  // custom geometry has no paths paints nothing. The frame here is empty, but it keeps the
  // drawing selectable and labelled like any other drawing, and shows no placeholder card.
  const groupFrame = !!drawing.groupTextboxStories && !drawing.groupPicture && !drawing.vectorShape;
  const emptyShape =
    drawing.vectorShape?.components.length === 0 &&
    drawing.groupPicture === undefined &&
    !isFramedPicture(drawing);
  if (groupFrame || emptyShape) {
    const frame = document.createElement('div');
    frame.className = groupFrame
      ? 'docx-drawing docx-drawing-group-frame'
      : 'docx-drawing docx-drawing-empty-frame';
    if (!ctx.unbound) frame.dataset.drawingNodeId = drawing.drawingNodeId;
    positionedBox(frame, drawing.paintBounds, ctx.scale, origin);
    applyAccessibility(frame, drawing, false);
    return frame;
  }

  const { resource } = drawing;
  const url =
    resource.kind === 'ready' && ctx.imageUrlPort && urlRegistry
      ? urlRegistry.urlForReady(resource.validatedHandle, resource.mime)
      : null;
  // A group paints whole or not at all. Its vector members paint alone only while the
  // picture is pending. A picture that cannot paint turns the whole group into the refusal
  // card of an unsupported group, including groups in alternative content.
  const layerFailed = drawing.groupPictureLayers?.some(
    (layer) => layer.resource.kind !== 'pending' && layerUrl(layer, ctx, urlRegistry) === null
  );
  if (drawing.groupPicture && ((resource.kind !== 'pending' && !url) || layerFailed)) {
    return paintPlaceholderCard(document, drawing, ctx, origin);
  }
  const groupImageReady = drawing.groupPicture !== undefined && url !== null;
  if (
    drawing.vectorShape &&
    drawing.vectorShape.subpathsEmu.length > 0 &&
    !groupImageReady &&
    !isFramedPicture(drawing)
  ) {
    return paintVectorShape(document, drawing, ctx, painted, origin);
  }

  if (resource.kind === 'ready') {
    if (!url || !urlRegistry) return paintPlaceholderCard(document, drawing, ctx, origin);
    return paintReadyImage(document, drawing, ctx, url, urlRegistry, origin);
  }

  if (resource.kind === 'pending') {
    const retained =
      urlRegistry?.readyElementFor?.(drawingElementKey(drawing, ctx)) ??
      urlRegistry
        ?.imageForPending?.(drawingElementKey(drawing, ctx))
        ?.closest<HTMLElement>('.docx-drawing-ready');
    if (retained) {
      readyImagePaintSignatures.delete(retained);
      if (!ctx.unbound) retained.dataset.drawingNodeId = drawing.drawingNodeId;
      positionedBox(retained, drawing.paintBounds, ctx.scale, origin);
      return retained;
    }
    return paintPlaceholderCard(document, drawing, ctx, origin);
  }

  return paintPlaceholderCard(document, drawing, ctx, origin);
}

export function paintInlineDrawingsOnLine(
  document: Document,
  line: Readonly<{ readonly drawings?: readonly InlineDrawingRecord[] }>,
  ctx: DrawingPaintContext,
  urlRegistry: UrlRegistry | null,
  lineOrigin: LayoutBox
): readonly HTMLElement[] {
  const painted: HTMLElement[] = [];
  for (const drawing of line.drawings ?? []) {
    const element = paintDrawingRecord(document, drawing, ctx, urlRegistry, lineOrigin);
    if (element) painted.push(element);
    const text = paintGroupTextboxStories(document, drawing, ctx, lineOrigin);
    if (text) painted.push(text);
  }
  return Object.freeze(painted);
}

export function paintAnchoredDrawingsLayer(
  document: Document,
  drawings: readonly AnchoredDrawingRecord[],
  layer: 'behind' | 'inFront',
  ctx: DrawingPaintContext,
  urlRegistry: UrlRegistry | null,
  pageOrigin: LayoutBox
): readonly HTMLElement[] {
  const painted: HTMLElement[] = [];
  for (const drawing of drawings) {
    if (paintLayerOf(drawing) !== layer) continue;
    const element = paintDrawingRecord(document, drawing, ctx, urlRegistry, pageOrigin);
    if (element) {
      element.dataset.drawingLayer = layer;
      painted.push(element);
    }
    const text = paintGroupTextboxStories(document, drawing, ctx, pageOrigin);
    if (text) {
      text.dataset.drawingLayer = layer;
      painted.push(text);
    }
  }
  return Object.freeze(painted);
}

interface PageDrawingKeys {
  readonly resourceKeys: readonly string[];
  readonly elementKeys: readonly string[];
}

/**
 * Drawing keys per immutable page record.
 *
 * Both collectors run on every paint, and each walked every fragment of every page — two
 * whole-document walks per keystroke for answers that cannot change on an untouched page.
 * Page records are reused by identity across incremental passes, and everything a key reads
 * (fragments, resource state, the page index the element key embeds) lives inside the record,
 * so the record's identity is the complete cache key.
 *
 * Every story the page paints is covered, notes included: `paintPageNoteAreas` paints note
 * fragments through the same `paintFragment` the body uses, so a picture in a footnote gets a
 * cached element and a blob URL like any other, and a reconcile that missed it would revoke
 * the resource and strip its `src`. Each story walks with {@link forEachStoryDrawing} — the
 * SAME bounded walk the furniture invalidation token uses, so what layout invalidates and what
 * paint keeps alive cannot drift apart. A story that provably holds no drawing source skips
 * both walks: no anchored drawing, and no inline drawing or picture bullet in any paragraph
 * (`blockContentSummary`). Every drawing either walk can reach hangs off one of those.
 */
const drawingKeysByPage = new WeakMap<PageRecord, PageDrawingKeys>();

function pageDrawingKeys(page: PageRecord): PageDrawingKeys {
  const cached = drawingKeysByPage.get(page);
  if (cached) return cached;
  const resourceKeys: string[] = [];
  const elementKeys: string[] = [];
  forEachPageStory(page, ({ host }) => {
    if (
      (!('anchoredDrawings' in host) || (host.anchoredDrawings?.length ?? 0) === 0) &&
      blockContentSummary(host.fragments).drawingFree
    )
      return;
    forEachStoryDrawing(host, (drawing) => {
      if (drawing.resource.kind === 'ready') resourceKeys.push(drawing.resource.resourceKey);
      for (const layer of drawing.groupPictureLayers ?? []) {
        if (layer.resource.kind === 'ready') resourceKeys.push(layer.resource.resourceKey);
      }
      elementKeys.push(`p${page.index}|${drawing.drawingNodeId}`);
    });
    // A picture-bullet marker mints a blob URL from the same registry, so its resource has to
    // be reported used here too. Left out, the next reconcile revoked the URL and every list
    // image went blank on the following repaint.
    forEachStoryParagraphFragment(host, (fragment) => {
      const picture = fragment.marker?.picture;
      if (picture?.resource.kind === 'ready') resourceKeys.push(picture.resource.resourceKey);
    });
  });
  const keys: PageDrawingKeys = Object.freeze({
    resourceKeys: Object.freeze(resourceKeys),
    elementKeys: Object.freeze(elementKeys),
  });
  drawingKeysByPage.set(page, keys);
  return keys;
}

interface LayoutDrawingKeys {
  readonly resourceKeys: ReadonlySet<string>;
  readonly elementKeys: ReadonlySet<string>;
}

/**
 * Aggregate both key sets for the supplied immutable layout. The painter passes only
 * materialized pages so reconciliation releases resources from offscreen pages.
 * Each supplied layout reuses unchanged page extraction. Weak ownership releases the
 * aggregate with the layout; it retains no DOM or bytes.
 */
const drawingKeysByLayout = new WeakMap<SemanticLayout, LayoutDrawingKeys>();

function layoutDrawingKeys(layout: SemanticLayout): LayoutDrawingKeys {
  const cached = drawingKeysByLayout.get(layout);
  if (cached) return cached;
  const resourceKeys = new Set<string>();
  const elementKeys = new Set<string>();
  for (const page of layout.pages) {
    const keys = pageDrawingKeys(page);
    for (const key of keys.resourceKeys) resourceKeys.add(key);
    for (const key of keys.elementKeys) elementKeys.add(key);
  }
  const keys: LayoutDrawingKeys = Object.freeze({ resourceKeys, elementKeys });
  drawingKeysByLayout.set(layout, keys);
  return keys;
}

/** Shared read-only membership for this immutable layout. */
export function collectUsedDrawingResourceKeys(layout: SemanticLayout): ReadonlySet<string> {
  return layoutDrawingKeys(layout).resourceKeys;
}

/** Shared read-only membership for this immutable layout. */
export function collectUsedDrawingElementKeys(layout: SemanticLayout): ReadonlySet<string> {
  return layoutDrawingKeys(layout).elementKeys;
}
