// Text frames in a header or footer story that are positioned against their anchor paragraph.
//
// A `w:framePr` paragraph with `w:vAnchor="text"` takes no room in the story: it sits at its
// authored offset from the top of the next ordinary paragraph or table, and horizontally against the
// page, the margins or the column, with `w:xAlign` superseding `w:x`. The story's own text keeps
// its flow, so the frame never changes the height the header or footer reserves. A frame that
// does not wrap text (`w:wrap="none"`) may also size itself to its one line, align with
// `w:xAlign`, and hold fields, which is how page numbers sit beside a footer's text. A frame
// that wraps text around itself may do the same when it holds one page number.
import {
  WML_NAMESPACE_URI as W,
  type OoxmlElement,
  type OoxmlGenericElementNode,
  type OoxmlNode,
} from '../store/package/ooxml-tree.ts';
import {
  paragraphFrameOrigin,
  readParagraphFrame,
  translateParagraphFragment,
  type ParagraphFrame,
} from './paragraph-frame.ts';
import { meetsOrdinaryContent } from './header-positioned-frames.ts';
import { shrinkSingleLineFrame } from './paragraph-frame-flow.ts';
import { readLegacyPageField } from './legacy-footer-page-field.ts';
import type { BlockFragmentRecord, ParagraphFragmentRecord } from './semantic-records.ts';

const MAX_NODES = 4096;
const MAX_GROUPS = 16;
/** How far a self-sized wrapping frame may end below the story's text, for a raised first line. */
const OVERHANG_TOLERANCE_PT = 1;
/** Elements a frame paragraph in this lane may not hold. */
const REFUSED = new Set([
  'drawing',
  'pict',
  'object',
  'sectPr',
  'tbl',
  'footnoteReference',
  'endnoteReference',
  'pageBreakBefore',
  'framePr',
]);
/** Fields a wrapping frame holds only as one page number; a frame that wraps nothing may hold any. */
const FIELDS = new Set(['fldChar', 'fldSimple', 'instrText']);

type Flow = { readonly blocks: BlockFragmentRecord[]; readonly bottom: number };
const key = (block: BlockFragmentRecord) =>
  block.kind === 'paragraph' ? block.paragraphId : block.tableId;

interface FrameGroup {
  readonly frame: ParagraphFrame;
  readonly paragraphs: readonly OoxmlElement[];
  readonly anchorId: string;
  /** For a page number that wraps text: the text beside the number, in source order. */
  readonly decoration?: string;
}

function directFrame(paragraph: OoxmlElement): ParagraphFrame | null | undefined {
  const nodes: readonly OoxmlNode[] = paragraph.children;
  const properties = nodes.find((child) => child.kind === 'paragraphProperties');
  const children: readonly OoxmlNode[] =
    properties?.kind === 'paragraphProperties' ? properties.children : [];
  const framed = children.filter(
    (child): child is OoxmlElement =>
      child.kind !== 'textValue' && child.namespaceUri === W && child.localName === 'framePr'
  );
  if (!framed.length) return undefined;
  if (framed.length > 1) return null;
  const attributes: Record<string, string> = {};
  for (const attribute of framed[0]!.attributes) {
    if (attribute.namespaceUri !== W || Object.hasOwn(attributes, attribute.localName)) return null;
    attributes[attribute.localName] = attribute.value;
  }
  return readParagraphFrame([{ localName: 'framePr', attributes }]);
}

/** Direct paragraph properties a self-sized page number beside the text may carry. */
const PAGE_NUMBER_PROPERTIES = new Set(['pStyle', 'framePr', 'jc', 'tabs', 'rPr']);

/** Whether the paragraph's direct properties leave its frame's geometry to the frame itself. */
function plainFrameProperties(paragraph: OoxmlElement): boolean {
  const properties = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  if (properties?.kind !== 'paragraphProperties') return true;
  return properties.children.every(
    (child) =>
      child.namespaceUri === W &&
      (PAGE_NUMBER_PROPERTIES.has(child.localName) ||
        // A right indent only trims the self-sized frame's far edge.
        (child.localName === 'ind' &&
          child.attributes.every((item) => item.localName === 'right' || item.localName === 'end')))
  );
}

/**
 * Whether the story holds floating content, a DrawingML anchor or legacy VML, or more markup
 * than the bound. A frame beside the text is placed only where nothing else floats.
 */
function holdsFloatingContent(blocks: readonly OoxmlElement[]): boolean {
  const pending: OoxmlNode[] = [...blocks];
  let count = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === 'textValue') continue;
    if (++count > MAX_NODES * 4) return true;
    if (node.localName === 'anchor' || node.localName === 'pict' || node.localName === 'object')
      return true;
    for (const child of node.children) pending.push(child);
    if (count + pending.length > MAX_NODES * 4) return true;
  }
  return false;
}

/** Revision and bookmark markup a page-number paragraph reads through. */
const READ_THROUGH = new Set(['ins', 'moveTo']);
const SKIPPED = new Set(['del', 'moveFrom', 'bookmarkStart', 'bookmarkEnd', 'proofErr']);

/**
 * The paragraph as its visible runs, with inserted runs unwrapped and deletions, bookmarks and
 * proofing marks left out, so a tracked edit does not change whether it holds a page number.
 */
function visibleRuns(paragraph: OoxmlElement): OoxmlGenericElementNode {
  const children: OoxmlNode[] = [];
  for (const child of paragraph.children) {
    if (child.kind === 'textValue' || child.namespaceUri !== W) children.push(child);
    else if (SKIPPED.has(child.localName)) continue;
    else if (READ_THROUGH.has(child.localName))
      for (const inner of child.children) {
        if (inner.kind === 'textValue' || !SKIPPED.has(inner.localName)) children.push(inner);
      }
    else children.push(child);
  }
  const { id, namespaceUri, localName, namespaceBindings, attributes } = paragraph;
  return { id, kind: 'generic', namespaceUri, localName, namespaceBindings, attributes, children };
}

function digitCount(text: string): number {
  let count = 0;
  for (const character of text) if (character >= '0' && character <= '9') count += 1;
  return count;
}

/** Room for a page number of this many digits, so a longer one on a later page still fits. */
const PAGE_NUMBER_DIGITS = 5;

/**
 * The box a self-sized page number may need on any page, with its distance from the text: it
 * grows away from its alignment edge until it holds {@link PAGE_NUMBER_DIGITS} characters.
 */
function pageNumberReach(
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  fragment: ParagraphFragmentRecord,
  frame: ParagraphFrame,
  decoration: string
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const line = fragment.lines[0];
  const text = line ? line.spans.map((span) => span.text).join('') : '';
  // Text beside the number keeps its width; only the number's own digits grow.
  const digits = Math.max(0, digitCount(text) - digitCount(decoration));
  // One digit's width comes from the spans that hold only digits, the number's result.
  let digitWidth = 0;
  let digitCharacters = 0;
  for (const span of line?.spans ?? []) {
    if (!span.text || digitCount(span.text) !== span.text.length) continue;
    digitWidth += span.box.width;
    digitCharacters += span.text.length;
  }
  const perDigit =
    digitCharacters > 0
      ? digitWidth / digitCharacters
      : text.length > 0
        ? box.width / text.length
        : (line?.box.height ?? 0) / 2;
  const extra = Math.max(0, PAGE_NUMBER_DIGITS - digits) * perDigit;
  const shift = frame.xAlign === 'right' ? extra : frame.xAlign === 'center' ? extra / 2 : 0;
  return {
    x: box.x - shift - frame.hSpace,
    y: box.y,
    width: box.width + extra + 2 * frame.hSpace,
    height: box.height,
  };
}

/** Bounded text content and revisions, fields when allowed, with at least one visible character. */
function plainContent(paragraph: OoxmlElement, fields: boolean): boolean {
  const pending: OoxmlNode[] = [...paragraph.children];
  let count = 0;
  let visible = false;
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === 'textValue') {
      visible ||= node.value.trim().length > 0;
      continue;
    }
    if (++count > MAX_NODES || node.namespaceUri !== W) return false;
    if (node.kind !== 'paragraphProperties' && REFUSED.has(node.localName)) return false;
    if (!fields && FIELDS.has(node.localName)) return false;
    // A simple field shows its result even before the file caches one.
    visible ||= node.localName === 'fldSimple';
    if (
      node.localName === 'br' &&
      node.attributes.some((item) => item.localName === 'type' && item.value !== 'textWrapping')
    )
      return false;
    if (node.kind !== 'paragraphProperties') pending.push(...node.children);
  }
  return visible;
}

/** Groups of adjacent frame paragraphs with equal properties, each with its anchor paragraph. */
function textFrameGroups(blocks: readonly OoxmlElement[]): readonly FrameGroup[] | null {
  let floating: boolean | undefined;
  type Open = { frame: ParagraphFrame; paragraphs: OoxmlElement[]; decoration?: string };
  const groups: Open[] = [];
  const anchored: FrameGroup[] = [];
  let open: Open | undefined;
  for (const block of blocks) {
    const frame = block.kind === 'paragraph' ? directFrame(block) : undefined;
    if (frame === undefined) {
      // The next ordinary block, a paragraph or a table, anchors every group waiting for one.
      for (const group of groups.splice(0)) anchored.push({ ...group, anchorId: block.id });
      open = undefined;
      continue;
    }
    if (!frame || frame.verticalAnchor !== 'text' || frame.dropCap !== undefined) return null;
    // A wrapping frame needs fixed geometry and plain text, unless it sizes itself to one page
    // number; one that wraps nothing may size itself, align, and hold fields. The lane places
    // every page alike, so it never takes inside or outside alignment, which follows odd and
    // even pages.
    const free = frame.wrap === 'none';
    const decoration =
      frame.autoWidth &&
      (frame.wrap === 'around' || frame.wrap === 'auto') &&
      plainFrameProperties(block)
        ? readLegacyPageField(visibleRuns(block), { allowDecoration: 'text' })
        : undefined;
    const pageNumber = decoration !== undefined && !(floating ??= holdsFloatingContent(blocks));
    const sized = free || pageNumber;
    if (
      (!sized && (frame.autoWidth || frame.xAlign !== undefined)) ||
      frame.xAlign === 'inside' ||
      frame.xAlign === 'outside' ||
      !plainContent(block, sized)
    )
      return null;
    if (open && open.frame.token === frame.token) open.paragraphs.push(block);
    else {
      open = { frame, paragraphs: [block], ...(pageNumber ? { decoration } : {}) };
      groups.push(open);
      if (groups.length + anchored.length > MAX_GROUPS) return null;
    }
  }
  return groups.length ? null : anchored;
}

/**
 * The frame's paragraphs laid out at the frame width. A frame without `w:w` holds one line of one
 * paragraph and shrinks to it, the way a page number does; any other auto-width frame is refused.
 */
function sizedFrame(
  group: FrameGroup,
  layoutFrame: (paragraphs: readonly OoxmlElement[], width: number) => Flow,
  storyWidth: number
): {
  readonly frame: ParagraphFrame;
  readonly fragments: readonly ParagraphFragmentRecord[];
  readonly contentHeight: number;
} | null {
  const auto = group.frame.autoWidth;
  if (auto && group.paragraphs.length !== 1) return null;
  const flow = layoutFrame(group.paragraphs, auto ? storyWidth : group.frame.width);
  if (flow.blocks.length !== group.paragraphs.length) return null;
  const fragments = flow.blocks.filter(
    (block): block is ParagraphFragmentRecord => block.kind === 'paragraph'
  );
  if (fragments.length !== flow.blocks.length) return null;
  if (!auto) return { frame: group.frame, fragments, contentHeight: flow.bottom };
  const fitted = shrinkSingleLineFrame(fragments[0]!) ?? emptyFrame(fragments[0]!);
  if (!fitted) return null;
  return {
    frame: { ...group.frame, width: fitted.width },
    fragments: [fitted.fragment],
    contentHeight: flow.bottom,
  };
}

/**
 * A one-line frame with nothing to paint, such as a simple field before its page is known, has
 * no width. It keeps its place in the lane, so the page that fills it does not change the lane.
 */
function emptyFrame(
  fragment: ParagraphFragmentRecord
): { readonly width: number; readonly fragment: ParagraphFragmentRecord } | undefined {
  const line = fragment.lines.length === 1 ? fragment.lines[0]! : undefined;
  if (!line || line.drawings?.length || line.spans.some((span) => span.text.trim()))
    return undefined;
  return {
    width: 0,
    fragment: {
      ...fragment,
      box: { ...fragment.box, width: 0 },
      lines: [{ ...line, box: { ...line.box, x: fragment.box.x, width: 0 } }],
    },
  };
}

/** Whether the story holds a frame this lane positions; cheap enough for every layout. */
export function hasStoryTextFrames(blocks: readonly OoxmlElement[]): boolean {
  return blocks.some((block) => block.kind === 'paragraph' && directFrame(block) !== undefined);
}

/**
 * Lay out the story without its text-anchored frames, then place each frame against its anchor.
 * Null when any frame falls outside this lane, so the caller keeps ordinary flow for all.
 */
export function placeStoryTextFrames(
  blocks: readonly OoxmlElement[],
  layout: {
    readonly story: (source: readonly OoxmlElement[]) => Flow;
    readonly frame: (paragraphs: readonly OoxmlElement[], width: number) => Flow;
  },
  geometry: {
    readonly contentWidth: number;
    readonly pageWidth?: number;
    readonly marginLeft?: number;
  },
  overlapDecided = false
): Flow | null {
  const groups = textFrameGroups(blocks);
  if (!groups?.length) return null;
  const framed = new Set(groups.flatMap((group) => group.paragraphs.map((node) => node.id)));
  const ordinary = layout.story(blocks.filter((block) => !framed.has(block.id)));
  const width = Math.max(1, geometry.contentWidth);
  const marginLeft = geometry.marginLeft ?? 0;
  const pageWidth = geometry.pageWidth ?? width;
  const placed: ParagraphFragmentRecord[] = [];
  for (const group of groups) {
    const anchor = ordinary.blocks.find((block) => key(block) === group.anchorId);
    if (!anchor) return null;
    const sized = sizedFrame(group, layout.frame, width);
    if (!sized) return null;
    const { frame, fragments, contentHeight } = sized;
    const height =
      frame.heightRule === 'exact'
        ? frame.height!
        : frame.heightRule === 'atLeast'
          ? Math.max(contentHeight, frame.height ?? 0)
          : contentHeight;
    const size = { width: frame.width, height };
    const column = { x: 0, y: 0, width, height: Number.MAX_SAFE_INTEGER };
    const origin = paragraphFrameOrigin(
      frame,
      {
        pageNumber: 1,
        page: { x: -marginLeft, y: Number.NEGATIVE_INFINITY, width: pageWidth, height: 0 },
        margin: column,
        text: { ...column, y: anchor.box.y },
      },
      size
    );
    const box = { ...origin, ...size };
    const pageNumber = frame.autoWidth && frame.wrap !== 'none';
    // The lane keeps the height the story reserves. A page number that wraps text and ends
    // below that height would need more, so its story keeps ordinary flow.
    if (
      !overlapDecided &&
      pageNumber &&
      box.y + box.height > ordinary.bottom + OVERHANG_TOLERANCE_PT
    )
      return null;
    // A frame over the story's own paragraph text would wrap it; that stays in ordinary flow.
    // A page number that wraps text keeps clear of it on every page, however long it grows.
    const paragraphs = ordinary.blocks.filter((block) => block.kind === 'paragraph');
    const reach = pageNumber
      ? pageNumberReach(box, fragments[0]!, frame, group.decoration ?? '')
      : box;
    if (!overlapDecided && meetsOrdinaryContent(reach, paragraphs)) return null;
    for (const fragment of fragments) {
      const moved = translateParagraphFragment(fragment, origin.x, origin.y);
      placed.push(
        frame.heightRule === 'exact'
          ? { ...moved, outOfFlow: true, clipToBox: true, box }
          : { ...moved, outOfFlow: true }
      );
    }
  }
  const order = new Map(blocks.map((block, index) => [block.id, index]));
  const all = ordinary.blocks.concat(placed);
  if (all.some((block) => !order.has(key(block)))) return null;
  all.sort((a, b) => order.get(key(a))! - order.get(key(b))!);
  return { blocks: all, bottom: ordinary.bottom };
}

/**
 * Re-lay a header or footer story with its text-anchored frames placed, when it has any.
 * Returns whether the frames were placed, or undefined when the story has none.
 *
 * `overlapDecided` skips the check that a frame meets the story's text. A caller sets it when a
 * layout without a page context already admitted the frames, because a longer page number
 * widens its frame and must not move the story text on later pages.
 */
export function layoutStoryWithTextFrames(
  blocks: readonly OoxmlElement[],
  story: (source: readonly OoxmlElement[]) => Flow,
  frame: (paragraphs: readonly OoxmlElement[], width: number) => Flow,
  geometry: {
    readonly contentWidth: number;
    readonly pageWidth?: number;
    readonly marginLeft?: number;
  },
  publish: (flow: Flow) => void,
  overlapDecided = false
): boolean | undefined {
  if (!hasStoryTextFrames(blocks)) return undefined;
  // The trial lays the story out without its frames; a refusal lays all of it out again.
  const placed = placeStoryTextFrames(blocks, { story, frame }, geometry, overlapDecided);
  publish(placed ?? story(blocks));
  return placed !== null;
}
