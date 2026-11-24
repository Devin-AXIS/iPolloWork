import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../store/package/ooxml-tree.ts';
import { readLegacyPageField } from './legacy-footer-page-field.ts';
import { shiftParagraphFragment } from './note-fragment-geometry.ts';
import type { BlockFragmentRecord, ParagraphFragmentRecord } from './semantic-records.ts';

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
const only = (node: OoxmlElement, names: readonly string[]): boolean =>
  elements(node).every((child) => names.some((name) => isW(child, name)));
const count = (node: OoxmlElement, name: string): number =>
  elements(node).filter((child) => isW(child, name)).length;

/** The frame properties this lane accepts, all required except `y`. */
const FRAME_ATTRIBUTES = new Set(['wrap', 'vAnchor', 'hAnchor', 'xAlign', 'y']);

/** A text anchor: plain runs of text and tabs, with at least one visible character. */
function textAnchor(paragraph: OoxmlElement): boolean {
  let visible = false;
  for (const run of elements(paragraph)) {
    if (isW(run, 'pPr')) continue;
    if (!isW(run, 'r')) return false;
    for (const node of elements(run)) {
      if (isW(node, 'rPr')) continue;
      if (isW(node, 'tab') && node.children.length === 0) continue;
      if (!isW(node, 't') || node.children.some(isElement)) return false;
      visible ||= node.children.some((child) => child.kind === 'textValue' && child.value.trim());
    }
  }
  return visible;
}

/** The XML shape: a right-aligned PAGE frame, then a text paragraph of the same style. */
function rightFramePair(part: OoxmlPart): { framed: string; anchor: string; y: number } | null {
  const paragraphs = elements(part.root);
  if (paragraphs.length !== 2 || paragraphs.some((node) => node.kind !== 'paragraph')) return null;
  const [framed, anchor] = paragraphs as [OoxmlElement, OoxmlElement];
  const framedProps = elements(framed).filter((node) => isW(node, 'pPr'));
  const anchorProps = elements(anchor).filter((node) => isW(node, 'pPr'));
  if (framedProps.length !== 1 || anchorProps.length !== 1) return null;
  const [props, anchorPr] = [framedProps[0]!, anchorProps[0]!];
  // No direct spacing on either side: the anchor then inherits the framed paragraph's spacing,
  // which is what lets it take the framed paragraph's place at the top of the story.
  if (
    !only(props, ['pStyle', 'framePr', 'rPr']) ||
    !only(anchorPr, ['pStyle', 'ind', 'rPr']) ||
    count(props, 'pStyle') !== 1 ||
    count(props, 'framePr') !== 1 ||
    count(anchorPr, 'pStyle') !== 1 ||
    count(anchorPr, 'ind') > 1
  )
    return null;
  const style = attr(
    elements(props).find((node) => isW(node, 'pStyle'))!,
    'val'
  );
  if (
    !style ||
    style !==
      attr(
        elements(anchorPr).find((node) => isW(node, 'pStyle'))!,
        'val'
      )
  )
    return null;
  const frame = elements(props).find((node) => isW(node, 'framePr'))!;
  if (
    frame.children.length ||
    frame.attributes.some(
      (item) => item.namespaceUri !== WML_NAMESPACE_URI || !FRAME_ATTRIBUTES.has(item.localName)
    ) ||
    attr(frame, 'wrap') !== 'none' ||
    attr(frame, 'vAnchor') !== 'text' ||
    attr(frame, 'hAnchor') !== 'margin' ||
    attr(frame, 'xAlign') !== 'right'
  )
    return null;
  const y = attr(frame, 'y') ?? '0';
  if (!['0', '1'].includes(y) || readLegacyPageField(framed) !== '' || !textAnchor(anchor))
    return null;
  return { framed: framed.id, anchor: anchor.id, y: Number(y) / 20 };
}

function oneLine(fragment: BlockFragmentRecord): fragment is ParagraphFragmentRecord {
  return (
    fragment.kind === 'paragraph' &&
    fragment.lines.length === 1 &&
    !fragment.marker &&
    !fragment.borders?.length &&
    !fragment.shading &&
    !fragment.lines[0]!.drawings?.length &&
    fragment.indent.left === 0 &&
    fragment.indent.firstLine === 0 &&
    fragment.indent.hanging === 0
  );
}

/** Left and right edge of a line's visible ink, or null when it holds none. */
function inkExtent(fragment: ParagraphFragmentRecord): { left: number; right: number } | null {
  let left = Infinity,
    right = -Infinity;
  for (const span of fragment.lines[0]!.spans) {
    if (span.box.width <= 0 || span.text.trim() === '') continue;
    left = Math.min(left, span.box.x);
    right = Math.max(right, span.box.x + span.box.width);
  }
  return Number.isFinite(left) && Number.isFinite(right) ? { left, right } : null;
}

/**
 * Right-aligned, auto-sized PAGE frame over the footer's text paragraph.
 *
 * `w:vAnchor="text"` puts the frame's top `w:y` below the top of the paragraph after it, and
 * `w:wrap="none"` keeps the text of that paragraph where it is. So the frame adds no flow
 * height: the anchor paragraph opens the story, and the frame shares its band at the right
 * margin. The caller bounds the source tree. Anything else stays in ordinary flow, including
 * anchor text that would reach under the frame.
 */
export function positionRightFooterPageFrame<
  T extends { blocks: BlockFragmentRecord[]; bottom: number },
>(part: OoxmlPart, flow: T, contentWidth: number): T {
  if (!isW(part.root, 'ftr') || flow.blocks.length !== 2 || !(contentWidth > 0)) return flow;
  const pair = rightFramePair(part);
  const [framed, anchor] = flow.blocks;
  if (
    !pair ||
    !framed ||
    !anchor ||
    !oneLine(framed) ||
    !oneLine(anchor) ||
    framed.paragraphId !== pair.framed ||
    anchor.paragraphId !== pair.anchor ||
    framed.indent.right !== 0 ||
    anchor.indent.right < 0
  )
    return flow;
  const ink = inkExtent(framed);
  const anchorInk = inkExtent(anchor);
  if (!ink || !anchorInk) return flow;
  const dx = contentWidth - ink.right;
  if (ink.left + dx < 0 || anchorInk.right > ink.left + dx) return flow;

  // The anchor takes the framed paragraph's place: its line keeps the gap the framed
  // paragraph's line had below the story top, which is their shared style's space before.
  const framedLine = framed.lines[0]!;
  const anchorLine = anchor.lines[0]!;
  const leadingGap = framedLine.box.y - framed.box.y;
  const lifted = shiftParagraphFragment(anchor, leadingGap - anchorLine.box.y);
  const opened: ParagraphFragmentRecord = {
    ...lifted,
    spacing: { ...lifted.spacing, before: framed.spacing.before },
    box: {
      ...lifted.box,
      y: 0,
      height: lifted.box.y + lifted.box.height,
    },
  };
  const moved = shiftParagraphFragment(framed, pair.y - framed.box.y);
  const line = moved.lines[0]!;
  const width = ink.right - ink.left;
  // The frame is auto-sized, so its box is the ink it holds. A full-width box would claim
  // every click in the band and leave the anchor paragraph unreachable by mouse.
  const placed: ParagraphFragmentRecord = {
    ...moved,
    box: { ...moved.box, x: ink.left + dx, width },
    lines: [
      {
        ...line,
        box: { ...line.box, x: ink.left + dx, width },
        contentX: line.contentX + dx,
        spans: line.spans.map((span) => ({ ...span, box: { ...span.box, x: span.box.x + dx } })),
      },
    ],
  };
  // Both canonical paragraphs stay addressable; framePr is never rewritten.
  return {
    ...flow,
    blocks: [placed, opened],
    bottom: Math.max(placed.box.y + placed.box.height, opened.box.y + opened.box.height),
  };
}
