import {
  readTwipsMeasure,
  type OoxmlElement,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';
import { shiftInlineDrawingRecord, type InlineDrawingLayoutContext } from './drawing-layout.ts';
import { isLegacyVmlAtom } from '../store/package/legacy-vml-projection.ts';
import { isRunLevelMcAlternateContent } from '../store/package/drawing-projection.ts';
import { framedTokenJoin } from './layout-cache.ts';
import type {
  BlockFragmentRecord,
  LayoutBox,
  ParagraphFragmentRecord,
} from './semantic-records.ts';
import type { TableFloatXSpec, TableFloatYSpec } from './table-float-properties.ts';

const MAX_FRAME_PT = 1584;
const MAX_FRAME_NODES = 10000;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export type ParagraphFrameHeightRule = 'auto' | 'atLeast' | 'exact';
export type ParagraphFrameWrap = 'auto' | 'around' | 'tight' | 'through' | 'none' | 'notBeside';

/** Bounded text-frame properties resolved for semantic layout. */
export interface ParagraphFrame {
  /** Explicit-size drop cap aligned against this many lines of its anchor paragraph. */
  readonly dropCapLines?: number;
  readonly dropCap?: 'drop' | 'margin';
  readonly dropCapRtl?: boolean;
  readonly x: number;
  readonly y: number;
  /** Zero until the containing text width resolves an omitted `w:w`. */
  readonly width: number;
  readonly autoWidth: boolean;
  /** Authored exact or minimum height. Absent for `hRule="auto"`. */
  readonly height?: number;
  readonly heightRule: ParagraphFrameHeightRule;
  readonly horizontalAnchor: 'page' | 'margin' | 'text';
  readonly verticalAnchor: 'page' | 'margin' | 'text';
  readonly xAlign?: TableFloatXSpec;
  readonly yAlign?: TableFloatYSpec;
  readonly anchorLocked: boolean;
  /** Equal authored frame properties group adjacent paragraphs into one frame. */
  readonly token: string;
  readonly wrap: ParagraphFrameWrap;
  readonly hSpace: number;
  readonly vSpace: number;
}

function coordinate(value: string | undefined): number | null {
  const twips = readTwipsMeasure(value);
  if (twips === null || Math.abs(twips) > 99_999_999) return null;
  const points = twips / 20;
  return Math.abs(points) <= MAX_FRAME_PT ? points : null;
}

/** Reject content whose pagination or external anchors need a separate frame story. */
export function supportsParagraphFrameContent(
  paragraph: OoxmlElement,
  drawings?: InlineDrawingLayoutContext
): boolean {
  const pending = [paragraph];
  let count = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (++count > MAX_FRAME_NODES) return false;
    if (node.kind === 'drawing' || isLegacyVmlAtom(node) || isRunLevelMcAlternateContent(node)) {
      const projection =
        drawings?.projectionForAtom?.(node.id) ??
        (node.kind === 'drawing' ? drawings?.project(node) : undefined);
      const resource = projection && drawings?.resourceOf(projection);
      // A metafile the host does not rasterize still draws: an exporter draws it as vectors.
      const drawable =
        resource?.kind === 'ready' ||
        (resource?.kind === 'unrenderable' &&
          (resource.mime === 'image/x-emf' || resource.mime === 'image/x-wmf'));
      if (projection?.kind !== 'inline' || projection.textboxStory || !drawable) return false;
      continue;
    }
    if (node.namespaceUri !== W) return false;
    if (
      [
        'drawing',
        'pict',
        'object',
        'sectPr',
        'footnoteReference',
        'endnoteReference',
        'pageBreakBefore',
        'ins',
        'del',
        'moveFrom',
        'moveTo',
        'pPrChange',
        'rPrChange',
      ].includes(node.localName)
    )
      return false;
    // A manual page break stays in the frame and takes no geometry there (see
    // `ParagraphFlowOptions.pageBreaksIgnored`). A column break still leaves the frame unmodeled.
    if (
      node.localName === 'br' &&
      node.attributes.some(
        (attr) =>
          attr.localName === 'type' && attr.value !== 'textWrapping' && attr.value !== 'page'
      )
    )
      return false;
    if (count + pending.length + node.children.length > MAX_FRAME_NODES) return false;
    for (const child of node.children) if (child.kind !== 'textValue') pending.push(child);
  }
  return true;
}

/** Direct frame attributes override only the attributes supplied by style layers. */
export function paragraphFrameAttributes(
  properties: readonly OoxmlProperty[]
): OoxmlProperty['attributes'] | undefined {
  let attributes: OoxmlProperty['attributes'] | undefined;
  for (const property of properties)
    if (property.localName === 'framePr') attributes = { ...attributes, ...property.attributes };
  return attributes;
}

export function readParagraphFrame(properties: readonly OoxmlProperty[]): ParagraphFrame | null {
  const attributes = paragraphFrameAttributes(properties);
  if (!attributes) return null;
  // Wrapping defaults alone do not turn ordinary paragraphs into positioned frames.
  if (
    !['w', 'h', 'x', 'y', 'xAlign', 'yAlign', 'hAnchor', 'vAnchor'].some(
      (name) => attributes[name] !== undefined
    )
  )
    return null;
  const allowed = new Set([
    'x',
    'y',
    'w',
    'h',
    'hRule',
    'hAnchor',
    'vAnchor',
    'wrap',
    'anchorLock',
    'hSpace',
    'vSpace',
    'dropCap',
    'lines',
    'xAlign',
    'yAlign',
  ]);
  if (Object.keys(attributes).some((name) => !allowed.has(name))) return null;
  const wrap = attributes.wrap ?? 'around';
  if (!['auto', 'around', 'tight', 'through', 'none', 'notBeside'].includes(wrap)) return null;
  const hSpace = coordinate(attributes.hSpace ?? '0'),
    vSpace = coordinate(attributes.vSpace ?? '0');
  if (hSpace === null || vSpace === null || hSpace < 0 || vSpace < 0) return null;
  const anchorLock = attributes.anchorLock;
  if (anchorLock !== undefined && !['0', '1', 'true', 'false', 'on', 'off'].includes(anchorLock)) {
    return null;
  }
  const xAlign = attributes.xAlign;
  if (xAlign !== undefined && !['left', 'center', 'right', 'inside', 'outside'].includes(xAlign)) {
    return null;
  }
  const yAlign = attributes.yAlign;
  if (
    yAlign !== undefined &&
    !['inline', 'top', 'center', 'bottom', 'inside', 'outside'].includes(yAlign)
  ) {
    return null;
  }
  const dropCap = attributes.dropCap;
  if (dropCap !== undefined && !['none', 'drop', 'margin'].includes(dropCap)) return null;
  if (dropCap === 'drop' || dropCap === 'margin') return null;

  // Word defaults both anchors to text (MS-OE376 2.1.48).
  const horizontalAnchor = attributes.hAnchor ?? 'text';
  const verticalAnchor = attributes.vAnchor ?? 'text';
  if (
    !['page', 'margin', 'text'].includes(horizontalAnchor) ||
    !['page', 'margin', 'text'].includes(verticalAnchor)
  )
    return null;

  // An alignment supersedes the corresponding offset, so an ignored malformed offset cannot
  // turn a valid frame into ordinary flow.
  const x = xAlign ? 0 : coordinate(attributes.x ?? '0');
  const effectiveYAlign = verticalAnchor === 'text' ? undefined : yAlign;
  const y = effectiveYAlign ? 0 : coordinate(attributes.y ?? '0');
  const width = attributes.w === undefined ? 0 : coordinate(attributes.w);
  if (x === null || y === null || width === null || width < 0) return null;
  const autoWidth = attributes.w === undefined;
  if (!autoWidth && width <= 0) return null;

  const heightRule =
    attributes.hRule ??
    (attributes.h !== undefined && coordinate(attributes.h) !== 0 ? 'atLeast' : 'auto');
  if (!['auto', 'atLeast', 'exact'].includes(heightRule)) return null;
  let height: number | undefined;
  if (heightRule !== 'auto') {
    const parsed = coordinate(attributes.h ?? '0');
    if (parsed === null || parsed < 0 || (heightRule === 'exact' && parsed === 0)) return null;
    height = parsed;
  }
  const token = framedTokenJoin(
    Object.keys(attributes)
      .sort()
      .map((key) => framedTokenJoin([key, attributes[key]!]))
  );
  return {
    x,
    y,
    width,
    autoWidth,
    ...(height === undefined ? {} : { height }),
    heightRule: heightRule as ParagraphFrameHeightRule,
    ...(xAlign ? { xAlign: xAlign as TableFloatXSpec } : {}),
    ...(effectiveYAlign ? { yAlign: effectiveYAlign as TableFloatYSpec } : {}),
    anchorLocked: ['1', 'true', 'on'].includes(anchorLock ?? ''),
    wrap: (yAlign === 'inline' ? 'notBeside' : wrap) as ParagraphFrameWrap,
    hSpace: wrap === 'around' || wrap === 'auto' ? hSpace : 0,
    vSpace,
    horizontalAnchor: horizontalAnchor as ParagraphFrame['horizontalAnchor'],
    verticalAnchor: verticalAnchor as ParagraphFrame['verticalAnchor'],
    token,
  };
}

/** Reference origins use page-content coordinates, including negative page origins. */
export interface ParagraphFrameOrigins {
  readonly pageNumber: number;
  readonly page: LayoutBox;
  readonly margin: LayoutBox;
  readonly text: LayoutBox;
}

export function frameOrigins(
  pageNumber: number,
  geometry: Readonly<{
    width: number;
    height: number;
    margin: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  }>,
  inset: number,
  text: LayoutBox
): ParagraphFrameOrigins {
  const boundedText = { ...text, height: Math.max(0, text.height) };
  return {
    pageNumber,
    page: {
      x: -geometry.margin.left,
      y: -inset,
      width: geometry.width,
      height: geometry.height,
    },
    margin: {
      x: 0,
      y: Math.abs(geometry.margin.top) - inset,
      width: geometry.width - geometry.margin.left - geometry.margin.right,
      height: geometry.height - geometry.margin.top - geometry.margin.bottom,
    },
    text: boundedText,
  };
}

export function paragraphFrameOrigin(
  frame: ParagraphFrame,
  origins: ParagraphFrameOrigins,
  frameSize: Readonly<{ width: number; height: number }>
): Readonly<{ x: number; y: number }> {
  if (frame.dropCap === 'margin') {
    const x = frame.dropCapRtl
      ? origins.text.x + origins.text.width + frame.hSpace
      : origins.text.x - frameSize.width - frame.hSpace;
    return { x, y: origins.text.y };
  }
  const horizontal = origins[frame.horizontalAnchor];
  const slackX = horizontal.width - frameSize.width;
  let x: number;
  if (frame.xAlign === 'center') x = horizontal.x + slackX / 2;
  else if (frame.xAlign === 'right') x = horizontal.x + slackX;
  else if (frame.xAlign === 'inside')
    x = origins.pageNumber % 2 === 1 ? horizontal.x : horizontal.x + slackX;
  else if (frame.xAlign === 'outside')
    x = origins.pageNumber % 2 === 1 ? horizontal.x + slackX : horizontal.x;
  else x = horizontal.x + frame.x;

  const vertical = origins[frame.verticalAnchor];
  const slackY = vertical.height - frameSize.height;
  let y: number;
  // A negative text offset raises the frame above its anchor, but never past the page top.
  if (frame.verticalAnchor === 'text') y = Math.max(origins.page.y, vertical.y + frame.y);
  else if (!frame.yAlign) y = vertical.y + frame.y;
  else if (frame.yAlign === 'center') y = vertical.y + slackY / 2;
  else if (frame.yAlign === 'bottom' || frame.yAlign === 'outside') y = vertical.y + slackY;
  else if (frame.yAlign === 'inline') y = origins.text.y;
  else y = vertical.y;
  return { x, y };
}

/** Translate all published geometry together; source ranges and paragraph alignment stay authored. */
export function positionParagraphFrame(
  fragment: ParagraphFragmentRecord,
  frame: ParagraphFrame,
  origins: ParagraphFrameOrigins,
  frameSize: Readonly<{ width: number; height: number }>
): ParagraphFragmentRecord {
  const { x: dx, y: dy } = paragraphFrameOrigin(frame, origins, frameSize);
  return { ...translateParagraphFragment(fragment, dx, dy), outOfFlow: true };
}

/** Move every box a paragraph fragment publishes, including its marker and inline drawings. */
export function translateParagraphFragment(
  fragment: ParagraphFragmentRecord,
  dx: number,
  dy: number
): ParagraphFragmentRecord {
  const move = (box: LayoutBox): LayoutBox => ({ ...box, x: box.x + dx, y: box.y + dy });
  return {
    ...fragment,
    box: move(fragment.box),
    ...(fragment.shadingBox ? { shadingBox: move(fragment.shadingBox) } : {}),
    ...(fragment.bottomBorder
      ? { bottomBorder: { ...fragment.bottomBorder, box: move(fragment.bottomBorder.box) } }
      : {}),
    ...(fragment.borders
      ? { borders: fragment.borders.map((border) => ({ ...border, box: move(border.box) })) }
      : {}),
    // The picture bullet shares the marker's coordinate space, so it moves with the marker.
    ...(fragment.marker
      ? {
          marker: {
            ...fragment.marker,
            box: move(fragment.marker.box),
            ...(fragment.marker.picture
              ? { picture: { ...fragment.marker.picture, box: move(fragment.marker.picture.box) } }
              : {}),
          },
        }
      : {}),
    lines: fragment.lines.map((line) => ({
      ...line,
      box: move(line.box),
      contentX: line.contentX + dx,
      spans: line.spans.map((span) => ({ ...span, box: move(span.box) })),
      ...(line.drawings
        ? { drawings: line.drawings.map((drawing) => shiftInlineDrawingRecord(drawing, dx, dy)) }
        : {}),
    })),
  };
}

/**
 * A continuous section clears the drop caps whose bands intersect the body area. Other frames
 * stay on the sheet as wrap obstacles for the continued section.
 */
export function positionedFrameBottom(
  blocks: readonly BlockFragmentRecord[],
  contentHeight: number
): number {
  let bottom = 0;
  for (const block of blocks) {
    if (
      block.kind !== 'paragraph' ||
      !block.positionedFrame ||
      block.positionedFrame.dropCapLines === undefined
    )
      continue;
    const { box, vSpace } = block.positionedFrame;
    if (box.y - vSpace >= contentHeight || box.y + box.height + vSpace <= 0) continue;
    bottom = Math.max(bottom, box.y + box.height + vSpace);
  }
  return bottom;
}

/** Whether `previous` is a positioned frame (not a drop cap) that the next paragraph anchors. */
export function anchorsFrames(
  previous: { readonly kind: string; readonly frame?: ParagraphFrame } | undefined
): boolean {
  return previous?.kind === 'paragraph' && !!previous.frame && !previous.frame.dropCapLines;
}
