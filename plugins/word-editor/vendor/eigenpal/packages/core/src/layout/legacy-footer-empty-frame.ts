import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../store/package/ooxml-tree.ts';
import { paragraphSpacing } from './paragraph-style.ts';
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
const one = (node: OoxmlElement, name: string): OoxmlElement | undefined => {
  const matches = elements(node).filter((child) => child.localName === name);
  return matches.length === 1 && isW(matches[0]!, name) ? matches[0] : undefined;
};

function pair(part: OoxmlPart): { framed: string; anchor: string; y: number } | null {
  const children = elements(part.root);
  if (children.length !== 2 || children.some((child) => child.kind !== 'paragraph')) return null;
  const [framed, anchor] = children as [OoxmlElement, OoxmlElement];
  const props = one(framed, 'pPr'),
    anchorProps = one(anchor, 'pPr');
  if (
    !props ||
    !anchorProps ||
    elements(props).some(
      (p) => !['pStyle', 'framePr', 'rPr', 'spacing'].some((name) => isW(p, name))
    ) ||
    elements(anchorProps).some(
      (p) => !['pStyle', 'ind', 'rPr', 'spacing'].some((name) => isW(p, name))
    )
  )
    return null;
  const style = one(props, 'pStyle'),
    anchorStyle = one(anchorProps, 'pStyle');
  if (
    !style ||
    !anchorStyle ||
    !attr(style, 'val') ||
    attr(style, 'val') !== attr(anchorStyle, 'val')
  )
    return null;
  if (
    elements(anchor).some(
      (node) =>
        !isW(node, 'pPr') && (!isW(node, 'r') || elements(node).some((child) => !isW(child, 'rPr')))
    )
  )
    return null;
  const frame = one(props, 'framePr');
  const allowed = new Set(['wrap', 'vAnchor', 'hAnchor', 'xAlign', 'y']);
  if (
    !frame ||
    frame.children.length ||
    frame.attributes.some(
      (a) => a.namespaceUri !== WML_NAMESPACE_URI || !allowed.has(a.localName)
    ) ||
    attr(frame, 'wrap') !== 'around' ||
    attr(frame, 'vAnchor') !== 'text' ||
    attr(frame, 'hAnchor') !== 'margin' ||
    attr(frame, 'xAlign') !== 'right'
  )
    return null;
  const y = attr(frame, 'y') ?? '0';
  if (
    !['0', '1'].includes(y) ||
    readLegacyPageField(framed, { allowDecoration: 'text' }) === undefined
  )
    return null;
  return { framed: framed.id, anchor: anchor.id, y: Number(y) / 20 };
}

function simple(block: BlockFragmentRecord): block is ParagraphFragmentRecord {
  return (
    block.kind === 'paragraph' &&
    block.props.length <= 64 &&
    block.props.every((p) =>
      [
        'pStyle',
        'framePr',
        'rPr',
        'spacing',
        'ind',
        'jc',
        'tabs',
        'widowControl',
        'snapToGrid',
      ].includes(p.localName)
    ) &&
    block.props.every(
      (p) =>
        p.localName !== 'spacing' ||
        Object.keys(p.attributes ?? {}).every((key) =>
          ['before', 'after', 'line', 'lineRule'].includes(key)
        )
    ) &&
    block.lines.length === 1 &&
    !block.marker &&
    !block.borders?.length &&
    !block.shading &&
    !block.lines[0]!.drawings?.length &&
    block.indent.left === 0 &&
    block.indent.firstLine === 0 &&
    block.indent.hanging === 0
  );
}

/** Place a right margin PAGE frame over its empty text anchor. The caller bounds the tree. */
export function positionEmptyFooterPageFrame<
  T extends { blocks: BlockFragmentRecord[]; bottom: number },
>(part: OoxmlPart, flow: T, contentWidth: number, fixedParagraphSpacing = false): T {
  if (!isW(part.root, 'ftr') || flow.blocks.length !== 2 || !(contentWidth > 0)) return flow;
  const shape = pair(part);
  const [framed, anchor] = flow.blocks;
  if (
    !shape ||
    !framed ||
    !anchor ||
    !simple(framed) ||
    !simple(anchor) ||
    framed.paragraphId !== shape.framed ||
    anchor.paragraphId !== shape.anchor ||
    framed.indent.right !== 0 ||
    anchor.indent.right < 0 ||
    anchor.lines[0]!.spans.length ||
    anchor.props.some((p) => p.localName === 'framePr')
  )
    return flow;
  const line = framed.lines[0]!;
  const ink = line.spans.filter((span) => span.box.width > 0 && span.text.trim() !== '');
  if (!ink.length) return flow;
  let left = Infinity,
    right = -Infinity;
  for (const span of ink) {
    left = Math.min(left, span.box.x);
    right = Math.max(right, span.box.x + span.box.width);
  }
  if (!Number.isFinite(left) || !Number.isFinite(right) || right - left > contentWidth) return flow;
  const before = paragraphSpacing(anchor.props).before;
  // Restore the anchor's inherited leading space, which ordinary adjacent flow collapsed.
  const lifted = shiftParagraphFragment(anchor, before - anchor.lines[0]!.box.y);
  const opened: ParagraphFragmentRecord = {
    ...lifted,
    spacing: { ...lifted.spacing, before },
    box: { ...lifted.box, y: 0, height: lifted.box.y + lifted.box.height },
  };
  // Fixed paragraph spacing aligns the frame text with the anchor text, without a second lead.
  const frameLead = fixedParagraphSpacing ? framed.spacing.before : 0;
  const moved = shiftParagraphFragment(framed, before + shape.y - framed.box.y - frameLead);
  const dx = contentWidth - right;
  const movedLine = moved.lines[0]!;
  const placed: ParagraphFragmentRecord = {
    ...moved,
    box: { ...moved.box, x: left + dx, width: right - left },
    lines: [
      {
        ...movedLine,
        box: { ...movedLine.box, x: left + dx, width: right - left },
        contentX: movedLine.contentX + dx,
        spans: movedLine.spans.map((span) => ({
          ...span,
          box: { ...span.box, x: span.box.x + dx },
        })),
      },
    ],
  };
  // The floating frame does not reserve a second paragraph in the body text area.
  return { ...flow, blocks: [placed, opened], bottom: opened.box.height };
}
