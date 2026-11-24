import { readTwipsMeasure } from '@docx-editor.dev/core/store';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../store/package/ooxml-tree.ts';
import { readLegacyPageField } from './legacy-footer-page-field.ts';
import { paragraphFrameAttributes, translateParagraphFragment } from './paragraph-frame.ts';
import { shiftParagraphFragment } from './note-fragment-geometry.ts';
import type { BlockFragmentRecord, ParagraphFragmentRecord } from './semantic-records.ts';

const MAX_PT = 31_680 / 20;
const isElement = (node: OoxmlNode): node is OoxmlElement => node.kind !== 'textValue';
const isW = (node: OoxmlNode, name: string): boolean =>
  isElement(node) && node.namespaceUri === WML_NAMESPACE_URI && node.localName === name;
const elements = (node: OoxmlElement): OoxmlElement[] =>
  (node.children as readonly OoxmlNode[]).filter(isElement);
const attr = (node: OoxmlElement, name: string): string | undefined => {
  const matches = node.attributes.filter((item) => item.localName === name);
  return matches.length === 1 && matches[0]!.namespaceUri === WML_NAMESPACE_URI
    ? matches[0]!.value
    : undefined;
};
function one(node: OoxmlElement, name: string): OoxmlElement | undefined {
  const matches = elements(node).filter((child) => child.localName === name);
  return matches.length === 1 && isW(matches[0]!, name) ? matches[0] : undefined;
}
function twips(value: string | undefined): number | undefined {
  const measure = readTwipsMeasure(value);
  if (measure === null || measure < 0 || measure > 99_999) return undefined;
  const pt = measure / 20;
  return pt <= MAX_PT ? pt : undefined;
}

function simple(fragment: BlockFragmentRecord): fragment is ParagraphFragmentRecord {
  return (
    fragment.kind === 'paragraph' &&
    fragment.lines.length === 1 &&
    !fragment.marker &&
    !fragment.borders?.length &&
    !fragment.shading &&
    !fragment.lines[0]!.drawings?.length &&
    fragment.spacing.before === 0 &&
    fragment.spacing.after === 0 &&
    fragment.indent.left === 0 &&
    fragment.indent.firstLine === 0 &&
    fragment.indent.hanging === 0
  );
}

function emptyAnchor(paragraph: OoxmlElement, fragment: ParagraphFragmentRecord): boolean {
  return (
    fragment.lines[0]!.spans.length === 0 &&
    elements(paragraph).every(
      (node) =>
        isW(node, 'pPr') || (isW(node, 'r') && elements(node).every((child) => isW(child, 'rPr')))
    )
  );
}

function supportedProperties(fragment: ParagraphFragmentRecord, framed: boolean): boolean {
  const allowed = new Set([
    'pStyle',
    'tabs',
    'jc',
    'rPr',
    'ind',
    'spacing',
    'widowControl',
    'contextualSpacing',
    'snapToGrid',
    ...(framed ? ['framePr'] : []),
  ]);
  return (
    fragment.props.length <= 64 &&
    fragment.props.every((property) => allowed.has(property.localName)) &&
    fragment.props.filter((property) => property.localName === 'framePr').length === Number(framed)
  );
}

/**
 * Fixed-width, page-X/text-center footer frames. The caller bounds the entire source tree.
 * This lane preserves both fields, including text outside the frame's clipping rectangle.
 * It does not support multi-paragraph frames, arbitrary text wrapping or partial-line reflow.
 */
export function positionFixedFooterPageFrame<
  T extends { blocks: BlockFragmentRecord[]; bottom: number },
>(
  part: OoxmlPart,
  flow: T,
  geometry: { readonly marginLeft: number; readonly pageWidth: number } | undefined
): T {
  const horizontal = positionPageXFooterFrame(part, flow, geometry);
  if (horizontal !== flow) return horizontal;
  if (
    !geometry ||
    !isW(part.root, 'ftr') ||
    flow.blocks.length !== 2 ||
    !Number.isFinite(geometry.pageWidth) ||
    geometry.pageWidth <= 0 ||
    geometry.pageWidth > MAX_PT ||
    !Number.isFinite(geometry.marginLeft) ||
    geometry.marginLeft < 0 ||
    geometry.marginLeft > geometry.pageWidth
  )
    return flow;
  const paragraphs = elements(part.root);
  const [first, anchor] = flow.blocks;
  if (
    paragraphs.length !== 2 ||
    paragraphs.some((p) => p.kind !== 'paragraph') ||
    !first ||
    !anchor ||
    !simple(first) ||
    !simple(anchor) ||
    !supportedProperties(first, true) ||
    !supportedProperties(anchor, false) ||
    first.paragraphId !== paragraphs[0]!.id ||
    anchor.paragraphId !== paragraphs[1]!.id ||
    first.alignment !== 'left' ||
    first.indent.right !== 0 ||
    anchor.indent.right < 0 ||
    anchor.indent.right > MAX_PT
  )
    return flow;
  const firstProps = one(paragraphs[0]!, 'pPr'),
    anchorProps = one(paragraphs[1]!, 'pPr');
  if (
    !firstProps ||
    !anchorProps ||
    elements(firstProps).some(
      (p) => !['framePr', 'pStyle', 'tabs', 'jc', 'rPr'].some((name) => isW(p, name))
    ) ||
    elements(anchorProps).some((p) => !['pStyle', 'jc', 'ind', 'rPr'].some((name) => isW(p, name)))
  )
    return flow;
  const decoration = readLegacyPageField(paragraphs[0]!, {
    leadingTab: true,
    allowDecoration: true,
  });
  if (
    decoration === undefined ||
    (readLegacyPageField(paragraphs[1]!, { allowDecoration: true }) === undefined &&
      !emptyAnchor(paragraphs[1]!, anchor))
  )
    return flow;
  const frame = one(firstProps, 'framePr');
  const allowed = new Set(['w', 'wrap', 'vAnchor', 'hAnchor', 'x', 'yAlign']);
  if (
    !frame ||
    frame.children.length ||
    frame.attributes.some(
      (a) => a.namespaceUri !== WML_NAMESPACE_URI || !allowed.has(a.localName)
    ) ||
    attr(frame, 'wrap') !== 'around' ||
    attr(frame, 'vAnchor') !== 'text' ||
    attr(frame, 'hAnchor') !== 'page' ||
    attr(frame, 'yAlign') !== 'center'
  )
    return flow;
  const width = twips(attr(frame, 'w')),
    x = twips(attr(frame, 'x'));
  if (width === undefined || width <= 0 || x === undefined || x + width > geometry.pageWidth)
    return flow;
  const line = first.lines[0]!;
  let left = Infinity,
    right = -Infinity;
  for (const span of line.spans) {
    if (span.box.width <= 0 || span.text === '\t' || span.text.trim() === '') continue;
    left = Math.min(left, span.box.x - first.box.x);
    right = Math.max(right, span.box.x + span.box.width - first.box.x);
  }
  // A tab can place the entire value past the frame (Word keeps the value but clips its ink).
  // If it instead straddles the edge, wrapping requires a frame-width text-flow pass; defer it.
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(right) ||
    left < 0 ||
    !(right <= width || left >= width)
  )
    return flow;
  const shiftedAnchor = shiftParagraphFragment(anchor, -anchor.box.y);
  const y = (anchor.box.height - first.box.height) / 2;
  if (y < 0) return flow;
  const shifted = shiftParagraphFragment(first, y - first.box.y);
  const dx = x - geometry.marginLeft - first.box.x;
  const clipped: ParagraphFragmentRecord = {
    ...shifted,
    clipToBox: true,
    box: { ...shifted.box, x: first.box.x + dx, width },
    lines: shifted.lines.map((item) => ({
      ...item,
      box: { ...item.box, x: item.box.x + dx },
      contentX: item.contentX + dx,
      spans: item.spans.map((span) => ({ ...span, box: { ...span.box, x: span.box.x + dx } })),
    })),
  };
  return { ...flow, blocks: [clipped, shiftedAnchor], bottom: shiftedAnchor.box.height };
}

/** Honor bounded page-X and explicit exact text-anchored PAGE/empty-anchor frames. */
function positionPageXFooterFrame<T extends { blocks: BlockFragmentRecord[]; bottom: number }>(
  part: OoxmlPart,
  flow: T,
  geometry: { readonly marginLeft: number; readonly pageWidth: number } | undefined
): T {
  if (
    !geometry ||
    !isW(part.root, 'ftr') ||
    flow.blocks.length !== 2 ||
    !Number.isFinite(geometry.pageWidth) ||
    geometry.pageWidth <= 0 ||
    geometry.pageWidth > MAX_PT ||
    !Number.isFinite(geometry.marginLeft) ||
    geometry.marginLeft < 0 ||
    geometry.marginLeft > geometry.pageWidth
  )
    return flow;
  const paragraphs = elements(part.root);
  const [first, anchor] = flow.blocks;
  if (
    paragraphs.length !== 2 ||
    paragraphs.some((p) => p.kind !== 'paragraph') ||
    !first ||
    !anchor ||
    !simple(first) ||
    !simple(anchor) ||
    first.paragraphId !== paragraphs[0]!.id ||
    anchor.paragraphId !== paragraphs[1]!.id ||
    first.indent.right !== 0 ||
    !['left', 'center', 'right'].includes(first.alignment) ||
    !emptyAnchor(paragraphs[1]!, anchor) ||
    !supportedProperties(anchor, false) ||
    readLegacyPageField(paragraphs[0]!) !== ''
  )
    return flow;
  const frameProperties = first.props.filter((p) => p.localName === 'framePr');
  if (
    frameProperties.length === 0 ||
    frameProperties.length > 8 ||
    !supportedProperties(
      { ...first, props: first.props.filter((p) => p.localName !== 'framePr') },
      false
    )
  )
    return flow;
  const attrs = paragraphFrameAttributes(first.props)!;
  const allowed = new Set(['w', 'h', 'hRule', 'wrap', 'vAnchor', 'hAnchor', 'x', 'y']);
  if (
    Object.keys(attrs).some((key) => !allowed.has(key)) ||
    attrs.hAnchor !== 'page' ||
    attrs.vAnchor !== 'text' ||
    (attrs.wrap ?? 'around') !== 'around'
  )
    return flow;
  const width = twips(attrs.w),
    x = twips(attrs.x);
  const y = readTwipsMeasure(attrs.y ?? '0');
  if (
    width === undefined ||
    width <= 0 ||
    x === undefined ||
    x + width > geometry.pageWidth ||
    y === null ||
    Math.abs(y / 20) > MAX_PT ||
    (attrs.h !== undefined && twips(attrs.h) === undefined) ||
    (attrs.hRule !== undefined && !['auto', 'atLeast', 'exact'].includes(attrs.hRule)) ||
    (attrs.hRule !== undefined && attrs.hRule !== 'auto' && attrs.h === undefined)
  )
    return flow;
  const line = first.lines[0]!;
  let left = Infinity,
    right = -Infinity;
  for (const span of line.spans) {
    if (!Number.isFinite(span.box.x) || !Number.isFinite(span.box.width) || span.box.width < 0)
      return flow;
    if (!span.text.trim() || span.box.width === 0) continue;
    left = Math.min(left, span.box.x);
    right = Math.max(right, span.box.x + span.box.width);
  }
  if (!Number.isFinite(left) || !Number.isFinite(right) || right - left > width) return flow;
  const origin = x - geometry.marginLeft;
  const inset =
    first.alignment === 'right'
      ? width - (right - left)
      : first.alignment === 'center'
        ? (width - (right - left)) / 2
        : 0;
  const moved = translateParagraphFragment(first, origin + inset - left, 0);
  // A bounded exact-height text-anchored frame floats over its following text anchor.
  // The anchor alone reserves footer flow; exact frames clip just as paragraph-frame-flow does.
  const height = twips(attrs.h);
  if (attrs.hRule === 'exact' && height !== undefined && height > 0 && attrs.y !== undefined) {
    const opened = shiftParagraphFragment(anchor, -anchor.box.y);
    const positioned = translateParagraphFragment(moved, 0, y / 20 - moved.box.y);
    const floating: ParagraphFragmentRecord = {
      ...positioned,
      outOfFlow: true,
      clipToBox: true,
      box: { ...positioned.box, x: origin, width, height },
    };
    return { ...flow, blocks: [floating, opened], bottom: opened.box.height };
  }
  // Other height rules retain the existing horizontal-only placement lane.
  const placed: ParagraphFragmentRecord = {
    ...moved,
    box: { ...moved.box, x: origin, width },
    lines: moved.lines.map((item) => ({ ...item, box: { ...item.box, x: origin, width } })),
  };
  return { ...flow, blocks: [placed, anchor] };
}
