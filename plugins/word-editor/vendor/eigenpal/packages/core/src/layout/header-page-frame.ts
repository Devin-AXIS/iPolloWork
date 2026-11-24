// An auto-sized text frame that opens a header and holds its page number.
//
// `w:framePr` with `w:vAnchor="text"` positions the frame from the top of the paragraph after
// it (ECMA-376 17.3.1.11), so the frame paragraph takes no place in the story flow: the next
// paragraph opens the header, and the frame shares its band at the margin that `w:xAlign`
// names. `inside` and `outside` resolve against the physical sheet, not the displayed page
// number: an odd sheet puts `inside` at the left margin and an even sheet puts it at the right
// margin, also after a numbering restart.
//
// The lane is bounded. It accepts one frame, first in the part, followed by an ordinary
// paragraph. The frame is empty or holds one PAGE field or plain text. Anything else keeps the ordinary
// flow, and so does a band where the frame meets the anchor's text, a table, a drawing or a
// paragraph border or shading.

import { readTwipsMeasure } from '@docx-editor.dev/core/store';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../store/package/ooxml-tree.ts';
import { readLegacyPageField } from './legacy-footer-page-field.ts';
import { translateParagraphFragment } from './paragraph-frame.ts';
import type {
  BlockFragmentRecord,
  LayoutBox,
  ParagraphFragmentRecord,
} from './semantic-records.ts';

const MAX_NODES = 4096;
const MAX_DEPTH = 24;
/** One inch. A frame further below its anchor is outside this lane. */
const MAX_FRAME_Y_TWIPS = 1440;

const FRAME_ATTRIBUTES = new Set(['wrap', 'vAnchor', 'hAnchor', 'xAlign', 'y', 'anchorLock']);
const FRAME_PARAGRAPH_PROPERTIES = ['pStyle', 'framePr', 'jc', 'rPr'];
const ALIGNMENTS = ['left', 'center', 'right', 'inside', 'outside'] as const;

type FrameAlignment = (typeof ALIGNMENTS)[number];

/** The supported header frame, read from the part's XML. */
export interface HeaderPageFrame {
  readonly frameId: string;
  readonly anchorId: string;
  readonly align: FrameAlignment;
  /** `w:y` in points, below the top of the anchor paragraph. */
  readonly y: number;
  /** True for `inside` and `outside`: the placement changes with the sheet's parity. */
  readonly parity: boolean;
  /** No field, drawing, or text occupies this frame. */
  readonly empty: boolean;
}

const isElement = (node: OoxmlNode): node is OoxmlElement => node.kind !== 'textValue';
const isW = (node: OoxmlNode, name: string): boolean =>
  isElement(node) && node.namespaceUri === WML_NAMESPACE_URI && node.localName === name;
const elements = (node: OoxmlElement): OoxmlElement[] =>
  (node.children as readonly OoxmlNode[]).filter(isElement);

function attr(node: OoxmlElement, name: string): string | undefined {
  const matches = node.attributes.filter((item) => item.localName === name);
  return matches.length === 1 && matches[0]!.namespaceUri === WML_NAMESPACE_URI
    ? matches[0]!.value
    : undefined;
}

/** Count `w:framePr` elements in a bounded walk; null when the part is too large or deep. */
function framePropertyCount(part: OoxmlPart): number | null {
  const stack: { node: OoxmlNode; depth: number }[] = [{ node: part.root, depth: 0 }];
  let visited = 0,
    frames = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (++visited > MAX_NODES || depth > MAX_DEPTH) return null;
    if (node.kind === 'textValue') continue;
    if (isW(node, 'framePr')) frames++;
    // Refuse before pushing, so one wide element cannot grow the stack past the bound.
    if (visited + stack.length + node.children.length > MAX_NODES) return null;
    for (const child of node.children) stack.push({ node: child, depth: depth + 1 });
  }
  return frames;
}

/** One complete PAGE field, or runs of plain text including an empty frame. */
function supportedFrameContent(paragraph: OoxmlElement): 'empty' | 'text' | null {
  if (readLegacyPageField(paragraph) === '') return 'text';
  let visible = false;
  let hasText = false;
  for (const run of elements(paragraph)) {
    if (isW(run, 'pPr')) continue;
    if (!isW(run, 'r')) return null;
    for (const node of elements(run)) {
      if (isW(node, 'rPr')) continue;
      if (!isW(node, 't') || node.children.some(isElement)) return null;
      hasText ||= node.children.some(
        (child) => child.kind === 'textValue' && child.value.length > 0
      );
      visible ||= node.children.some((child) => child.kind === 'textValue' && child.value.trim());
    }
  }
  // Spaces can carry inherited underline, shading, or highlight. Their advance also
  // remains selectable, so only a paragraph without text is an empty frame.
  return visible ? 'text' : hasText ? null : 'empty';
}

function readFrameProperties(frame: OoxmlElement): Pick<HeaderPageFrame, 'align' | 'y'> | null {
  if (
    frame.children.length ||
    frame.attributes.some(
      (item) => item.namespaceUri !== WML_NAMESPACE_URI || !FRAME_ATTRIBUTES.has(item.localName)
    ) ||
    new Set(frame.attributes.map((item) => item.localName)).size !== frame.attributes.length
  )
    return null;
  const wrap = attr(frame, 'wrap');
  const align = attr(frame, 'xAlign') as FrameAlignment | undefined;
  const y = readTwipsMeasure(attr(frame, 'y') ?? '0');
  if (
    (wrap !== 'around' && wrap !== 'auto' && wrap !== 'none') ||
    attr(frame, 'vAnchor') !== 'text' ||
    attr(frame, 'hAnchor') !== 'margin' ||
    !align ||
    !ALIGNMENTS.includes(align) ||
    y === null ||
    y < 0 ||
    y > MAX_FRAME_Y_TWIPS
  )
    return null;
  // `auto` is the default wrap, around the frame (17.18.104). `around` and `none` place the
  // frame the same way; neither moves the text in its band.
  return { align, y: y / 20 };
}

/** Recognize the supported frame in a header part, or null to keep the ordinary flow. */
export function readHeaderPageFrame(part: OoxmlPart): HeaderPageFrame | null {
  if (!isW(part.root, 'hdr') || framePropertyCount(part) !== 1) return null;
  const [framed, anchor] = elements(part.root);
  if (framed?.kind !== 'paragraph' || anchor?.kind !== 'paragraph') return null;
  const properties = elements(framed).filter((node) => isW(node, 'pPr'));
  if (properties.length !== 1) return null;
  const children = elements(properties[0]!);
  if (
    !children.every((node) => FRAME_PARAGRAPH_PROPERTIES.some((name) => isW(node, name))) ||
    FRAME_PARAGRAPH_PROPERTIES.some((name) => children.filter((node) => isW(node, name)).length > 1)
  )
    return null;
  const frame = children.find((node) => isW(node, 'framePr'));
  const placement = frame ? readFrameProperties(frame) : null;
  const content = supportedFrameContent(framed);
  if (!placement || !content) return null;
  return {
    frameId: framed.id,
    empty: content === 'empty',
    anchorId: anchor.id,
    ...placement,
    parity: placement.align === 'inside' || placement.align === 'outside',
  };
}

/** Left and right edge of a line's visible text, or null when it holds none. */
function inkExtent(line: ParagraphFragmentRecord['lines'][number]): {
  left: number;
  right: number;
} | null {
  let left = Infinity,
    right = -Infinity;
  for (const span of line.spans) {
    if (!(span.box.width > 0) || span.text.trim() === '') continue;
    left = Math.min(left, span.box.x);
    right = Math.max(right, span.box.x + span.box.width);
  }
  return Number.isFinite(left) && Number.isFinite(right) ? { left, right } : null;
}

/** `w:framePr` entries in a fragment's cascaded properties, the style's included. */
const frameProperties = (fragment: BlockFragmentRecord): number =>
  fragment.kind === 'paragraph'
    ? fragment.props.filter((property) => property.localName === 'framePr').length
    : 0;

const overlaps = (low: number, high: number, start: number, end: number): boolean =>
  low < end && start < high;

/**
 * True when the frame would meet content it cannot share a band with.
 *
 * The anchor paragraph must keep its ink, marker and drawings clear of the frame. Later
 * paragraphs may run under the frame's lower edge, and they neither wrap nor move there.
 * A table, paragraph decoration or drawing in the frame's band is outside the lane.
 */
function meetsFrame(
  blocks: readonly BlockFragmentRecord[],
  frame: LayoutBox,
  anchorId: string
): boolean {
  const top = frame.y,
    bottom = frame.y + frame.height,
    left = frame.x,
    right = frame.x + frame.width;
  const crosses = (box: LayoutBox) =>
    overlaps(box.y, box.y + box.height, top, bottom) &&
    overlaps(box.x, box.x + box.width, left, right);
  for (const block of blocks) {
    if (!overlaps(block.box.y, block.box.y + block.box.height, top, bottom)) continue;
    if (block.kind !== 'paragraph') return true;
    if (block.borders?.length || block.bottomBorder || block.shading) return true;
    const anchor = block.paragraphId === anchorId;
    if (anchor && block.marker && crosses(block.marker.box)) return true;
    for (const line of block.lines) {
      if (!overlaps(line.box.y, line.box.y + line.box.height, top, bottom)) continue;
      const ink = inkExtent(line);
      if (anchor && ink && overlaps(ink.left, ink.right, left, right)) return true;
      for (const drawing of line.drawings ?? []) {
        if (
          crosses(drawing.paintBounds) ||
          overlaps(drawing.x, drawing.x + drawing.width, left, right)
        )
          return true;
      }
    }
  }
  return false;
}

type Side = 'left' | 'center' | 'right';

function sideOf(align: FrameAlignment, sheetNumber: number): Side {
  const odd = Math.abs(sheetNumber % 2) === 1;
  if (align === 'inside') return odd ? 'left' : 'right';
  if (align === 'outside') return odd ? 'right' : 'left';
  return align;
}

/**
 * Place the frame paragraph, laid out alone, over the story laid out without it.
 *
 * `rest` must be the flow of every block after the frame, so the anchor paragraph opens the
 * story. Returns null when the frame or the band is outside the lane; the caller then keeps
 * the ordinary flow. Both paragraphs stay addressable, and the source is never rewritten.
 *
 * `sheetNumber` is the 1-based physical sheet. It picks the side of an `inside` or `outside`
 * frame; the frame's text comes from the displayed number the caller already laid out.
 *
 * `checkBand` tests the band on every side the frame can take, so the answer does not change
 * with the sheet. The caller asks once, without a page context, and places the frame on
 * each page without asking again: the story height must not change from page to page, because
 * the body's content box is sized from the story laid out without a page context.
 */
export function placeHeaderPageFrame<T extends { blocks: BlockFragmentRecord[]; bottom: number }>(
  frame: HeaderPageFrame,
  framed: { readonly blocks: readonly BlockFragmentRecord[] },
  rest: T,
  contentWidth: number,
  sheetNumber: number,
  checkBand: boolean
): T | null {
  const [fragment] = framed.blocks;
  const anchor = rest.blocks[0];
  if (
    framed.blocks.length !== 1 ||
    fragment?.kind !== 'paragraph' ||
    fragment.paragraphId !== frame.frameId ||
    anchor?.kind !== 'paragraph' ||
    anchor.paragraphId !== frame.anchorId ||
    fragment.lines.length !== 1 ||
    fragment.marker ||
    fragment.borders?.length ||
    fragment.bottomBorder ||
    fragment.shading ||
    fragment.lines[0]!.drawings?.length ||
    Object.values(fragment.indent).some((value) => value !== 0) ||
    !(contentWidth > 0) ||
    // A style can make a paragraph a frame too. Its properties would merge with the direct
    // frame, or make a later paragraph a frame of its own.
    frameProperties(fragment) !== 1 ||
    rest.blocks.some((block) => frameProperties(block) > 0)
  )
    return null;
  const frameLine = fragment.lines[0]!;
  // An empty cached PAGE result paints nothing, so the frame holds no width until a page
  // context gives it a value.
  const ink = inkExtent(frameLine) ?? { left: frameLine.contentX, right: frameLine.contentX };
  const width = ink.right - ink.left;
  if (width > contentWidth) return null;
  const boxAt = (side: Side): LayoutBox => ({
    x: side === 'left' ? 0 : side === 'right' ? contentWidth - width : (contentWidth - width) / 2,
    y: anchor.box.y + frame.y,
    width,
    height: fragment.box.height,
  });
  const box = boxAt(sideOf(frame.align, sheetNumber));
  // The frame starts in the anchor's first line: the only band this lane has evidence for.
  const firstLine = anchor.lines[0];
  if (!firstLine || box.y >= firstLine.box.y + firstLine.box.height) return null;
  if (checkBand && !frame.empty) {
    const sides: readonly Side[] = frame.parity
      ? ['left', 'right']
      : [sideOf(frame.align, sheetNumber)];
    if (sides.some((side) => meetsFrame(rest.blocks, boxAt(side), anchor.paragraphId))) return null;
  }
  const moved = translateParagraphFragment(fragment, box.x - ink.left, box.y - fragment.box.y);
  const line = moved.lines[0]!;
  // The frame is auto-sized, so its box is the ink it holds. Hit testing is containment-first
  // in fragment order, so the frame, first in document order, answers inside its ink and the
  // anchor answers everywhere else in the band. A full-width box would claim every click.
  const placed: ParagraphFragmentRecord = {
    ...moved,
    box,
    lines: [{ ...line, box: { ...line.box, x: box.x, width } }],
  };
  return {
    ...rest,
    blocks: [placed, ...rest.blocks],
    bottom: Math.max(rest.bottom, box.y + box.height),
  };
}
