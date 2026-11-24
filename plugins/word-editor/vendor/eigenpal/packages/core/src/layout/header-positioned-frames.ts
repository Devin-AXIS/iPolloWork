import { readTwipsMeasure } from '@docx-editor.dev/core/store';
import {
  WML_NAMESPACE_URI as W,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../store/package/ooxml-tree.ts';
import { framedTokenJoin } from './layout-cache.ts';
import { translateParagraphFragment } from './paragraph-frame.ts';
import type {
  BlockFragmentRecord,
  LayoutBox,
  ParagraphFragmentRecord,
} from './semantic-records.ts';

const MAX_NODES = 4096;
const MAX_DEPTH = 24;
const MAX_GROUPS = 16;
const MAX_PARAGRAPHS = 128;
const MAX_COORDINATE_PT = 1584;
const FRAME_ATTRIBUTES = new Set([
  'x',
  'y',
  'w',
  'h',
  'hRule',
  'hAnchor',
  'vAnchor',
  'wrap',
  'hSpace',
  'vSpace',
  'anchorLock',
]);
const PARAGRAPH_PROPERTIES = new Set([
  'framePr',
  'pStyle',
  'jc',
  'rPr',
  'pBdr',
  'shd',
  'spacing',
  'ind',
  'contextualSpacing',
  'keepNext',
  'keepLines',
  'widowControl',
]);

export interface PositionedHeaderFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly heightRule: string;
  readonly hSpace: number;
  readonly vSpace: number;
  readonly token: string;
  readonly paragraphs: readonly OoxmlElement[];
}

const isW = (node: OoxmlNode, name: string): boolean =>
  node.kind !== 'textValue' && node.namespaceUri === W && node.localName === name;
function elements(node: OoxmlElement): OoxmlElement[] {
  const result: OoxmlElement[] = [];
  for (const child of node.children) if (child.kind !== 'textValue') result.push(child);
  return result;
}

function frameCount(part: OoxmlPart): number | null {
  const pending = [{ node: part.root as OoxmlNode, depth: 0 }];
  let visited = 0,
    count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++visited > MAX_NODES || depth > MAX_DEPTH) return null;
    if (node.kind === 'textValue') continue;
    if (
      node.namespaceUri === W &&
      ['ins', 'del', 'moveFrom', 'moveTo', 'pPrChange', 'rPrChange'].includes(node.localName)
    )
      return null;
    // A later page value must not change admission after the body consumed the header reserve.
    if (
      node.namespaceUri === W &&
      ['fldSimple', 'fldChar', 'instrText', 'delInstrText'].includes(node.localName)
    )
      return null;
    if (isW(node, 'framePr')) count++;
    if (visited + pending.length + node.children.length > MAX_NODES) return null;
    for (const child of node.children) pending.push({ node: child, depth: depth + 1 });
  }
  return count;
}

function points(value: string | undefined, fallback?: number): number | null {
  if (value === undefined) return fallback ?? null;
  const twips = readTwipsMeasure(value);
  if (twips === null || twips < 0 || twips > 99_999) return null;
  const result = twips / 20;
  return result <= MAX_COORDINATE_PT ? result : null;
}

function readFrame(paragraph: OoxmlElement): Omit<PositionedHeaderFrame, 'paragraphs'> | null {
  const properties = elements(paragraph).filter((node) => isW(node, 'pPr'));
  if (properties.length !== 1) return null;
  const children = elements(properties[0]!);
  if (children.some((node) => node.namespaceUri !== W || !PARAGRAPH_PROPERTIES.has(node.localName)))
    return null;
  const frames = children.filter((node) => isW(node, 'framePr'));
  if (frames.length !== 1) return null;
  const frame = frames[0]!;
  const values = new Map<string, string>();
  for (const attribute of frame.attributes) {
    if (
      attribute.namespaceUri !== W ||
      !FRAME_ATTRIBUTES.has(attribute.localName) ||
      values.has(attribute.localName)
    )
      return null;
    values.set(attribute.localName, attribute.value);
  }
  if (frame.children.length || values.get('hAnchor') !== 'page' || values.get('vAnchor') !== 'page')
    return null;
  if ((values.get('wrap') ?? 'around') !== 'around') return null;
  if (
    values.has('anchorLock') &&
    !['0', '1', 'true', 'false', 'on', 'off'].includes(values.get('anchorLock')!)
  )
    return null;
  const x = points(values.get('x'), 0),
    y = points(values.get('y'), 0);
  const width = points(values.get('w')),
    height = points(values.get('h'), 0);
  const hSpace = points(values.get('hSpace'), 0),
    vSpace = points(values.get('vSpace'), 0);
  const heightRule = values.get('hRule') ?? 'atLeast';
  if (
    x === null ||
    y === null ||
    width === null ||
    width < 1 ||
    height === null ||
    hSpace === null ||
    vSpace === null ||
    !['auto', 'atLeast'].includes(heightRule)
  )
    return null;
  // This lane contains inert plain text only. Fields and revision wrappers keep ordinary flow.
  for (const run of elements(paragraph)) {
    if (isW(run, 'pPr')) continue;
    if (!isW(run, 'r')) return null;
    for (const child of elements(run)) {
      if (isW(child, 'rPr')) {
        if (elements(child).some((property) => property.localName.endsWith('Change'))) return null;
      } else if (!isW(child, 't') || child.children.some((node) => node.kind !== 'textValue'))
        return null;
    }
  }
  const token = framedTokenJoin(
    [...values.keys()].sort().map((key) => framedTokenJoin([key, values.get(key)!]))
  );
  return { x, y, width, height, heightRule, hSpace, vSpace, token };
}

/** Direct, adjacent page-anchored paragraphs share a frame only when their properties agree. */
export function readPositionedHeaderFrames(
  part: OoxmlPart
): readonly PositionedHeaderFrame[] | null {
  if (!isW(part.root, 'hdr')) return null;
  const count = frameCount(part);
  if (count === null || count === 0 || count > MAX_PARAGRAPHS) return null;
  const groups: PositionedHeaderFrame[] = [];
  let previous: PositionedHeaderFrame | undefined;
  let accepted = 0;
  for (const node of elements(part.root)) {
    const frame = node.kind === 'paragraph' ? readFrame(node) : null;
    if (!frame) {
      previous = undefined;
      continue;
    }
    accepted++;
    if (previous?.token === frame.token) {
      previous = { ...previous, paragraphs: [...previous.paragraphs, node] };
      groups[groups.length - 1] = previous;
    } else {
      if (groups.length >= MAX_GROUPS) return null;
      previous = { ...frame, paragraphs: [node] };
      groups.push(previous);
    }
  }
  // Do not partially remove unsupported or nested frames from the ordinary story.
  return accepted === count ? groups : null;
}

interface PageGeometry {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginLeft: number;
}
type Flow = { readonly blocks: BlockFragmentRecord[]; readonly bottom: number };

const overlaps = (a: LayoutBox, b: LayoutBox): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export function meetsOrdinaryContent(
  frame: LayoutBox,
  blocks: readonly BlockFragmentRecord[]
): boolean {
  for (const block of blocks) {
    if (block.kind !== 'paragraph') {
      if (overlaps(frame, block.box)) return true;
      continue;
    }
    if (block.props.some((property) => property.localName === 'framePr')) return true;
    if (block.marker && overlaps(frame, block.marker.box)) return true;
    for (const border of block.borders ?? []) if (overlaps(frame, border.box)) return true;
    if (block.shadingBox && overlaps(frame, block.shadingBox)) return true;
    for (const line of block.lines) {
      for (const span of line.spans) if (span.text.trim() && overlaps(frame, span.box)) return true;
      for (const drawing of line.drawings ?? [])
        if (overlaps(frame, drawing.paintBounds)) return true;
    }
  }
  return false;
}

/** Extend the closing paragraph's decoration for a minimum-height frame, without moving its text. */
function extendFrameBottom(
  fragment: ParagraphFragmentRecord,
  extra: number
): ParagraphFragmentRecord {
  const decorationExtra = extra + fragment.spacing.after;
  if (decorationExtra <= 0) return fragment;
  return {
    ...fragment,
    box: { ...fragment.box, height: fragment.box.height + extra },
    ...(fragment.shadingBox
      ? {
          shadingBox: {
            ...fragment.shadingBox,
            height: fragment.shadingBox.height + decorationExtra,
          },
        }
      : {}),
    ...(fragment.bottomBorder
      ? {
          bottomBorder: {
            ...fragment.bottomBorder,
            box: { ...fragment.bottomBorder.box, y: fragment.bottomBorder.box.y + decorationExtra },
          },
        }
      : {}),
    ...(fragment.borders
      ? {
          borders: fragment.borders.map((border) => ({
            ...border,
            box:
              border.side === 'bottom'
                ? { ...border.box, y: border.box.y + decorationExtra }
                : border.side === 'left' || border.side === 'right'
                  ? { ...border.box, height: border.box.height + decorationExtra }
                  : border.box,
          })),
        }
      : {}),
  };
}

/** Place bounded page frames independently of the header's ordinary flow and body reserve. */
export function placePositionedHeaderFrames(
  groups: readonly PositionedHeaderFrame[],
  source: readonly OoxmlElement[],
  ordinary: Flow,
  layoutGroup: (paragraphs: readonly OoxmlElement[], width: number) => Flow,
  geometry: PageGeometry,
  storyTop: number
): Flow | null {
  if (
    ![geometry.pageWidth, geometry.pageHeight, geometry.marginLeft, storyTop].every(
      Number.isFinite
    ) ||
    geometry.pageWidth <= 0 ||
    geometry.pageHeight <= 0
  )
    return null;
  const order = new Map(source.map((node, index) => [node.id, index]));
  const placed: ParagraphFragmentRecord[] = [];
  const boxes: LayoutBox[] = [];
  for (const group of groups) {
    if (group.paragraphs.some((paragraph) => !order.has(paragraph.id))) return null;
    const flow = layoutGroup(group.paragraphs, group.width);
    if (flow.blocks.length !== group.paragraphs.length || !Number.isFinite(flow.bottom))
      return null;
    const height = group.heightRule === 'auto' ? flow.bottom : Math.max(flow.bottom, group.height);
    if (
      height < 0 ||
      group.x + group.width > geometry.pageWidth ||
      group.y + height > geometry.pageHeight
    )
      return null;
    const frame = {
      x: group.x - geometry.marginLeft,
      y: group.y - storyTop,
      width: group.width,
      height,
    };
    const firstPlaced = placed.length;
    for (let index = 0; index < flow.blocks.length; index++) {
      const block = flow.blocks[index]!;
      if (
        block.kind !== 'paragraph' ||
        block.paragraphId !== group.paragraphs[index]!.id ||
        block.marker ||
        block.props.filter((property) => property.localName === 'framePr').length !== 1
      )
        return null;
      const resolved = block.props.find((property) => property.localName === 'framePr')!;
      const attributes = resolved.attributes ?? {};
      if (
        framedTokenJoin(
          Object.keys(attributes)
            .sort()
            .map((key) => framedTokenJoin([key, attributes[key]!]))
        ) !== group.token
      )
        return null;
      const fragment =
        index === flow.blocks.length - 1 ? extendFrameBottom(block, height - flow.bottom) : block;
      // Frame side borders include the frame's 1.5pt horizontal inset outside the text column.
      // Paragraph layout already supplies the authored border space and stroke width.
      const sideInset = 1.5;
      const hasLeft = fragment.borders?.some((border) => border.side === 'left') ?? false;
      const hasRight = fragment.borders?.some((border) => border.side === 'right') ?? false;
      const widen = (box: LayoutBox): LayoutBox => ({
        ...box,
        x: box.x - (hasLeft ? sideInset : 0),
        width: box.width + (hasLeft ? sideInset : 0) + (hasRight ? sideInset : 0),
      });
      const decorated = {
        ...fragment,
        ...(fragment.bottomBorder
          ? { bottomBorder: { ...fragment.bottomBorder, box: widen(fragment.bottomBorder.box) } }
          : {}),
        ...(fragment.shadingBox ? { shadingBox: widen(fragment.shadingBox) } : {}),
        ...(fragment.borders
          ? {
              borders: fragment.borders.map((border) => ({
                ...border,
                box:
                  border.side === 'left'
                    ? { ...border.box, x: border.box.x - sideInset }
                    : border.side === 'right'
                      ? { ...border.box, x: border.box.x + sideInset }
                      : border.side === 'top' ||
                          border.side === 'bottom' ||
                          border.side === 'between'
                        ? widen(border.box)
                        : border.box,
              })),
            }
          : {}),
      };
      placed.push({ ...translateParagraphFragment(decorated, frame.x, frame.y), outOfFlow: true });
    }
    // Use paint extents too: a border or an unbreakable word can exceed the text column.
    let left = frame.x,
      top = frame.y,
      right = frame.x + frame.width,
      bottom = frame.y + frame.height;
    const include = (box: LayoutBox) => {
      left = Math.min(left, box.x);
      top = Math.min(top, box.y);
      right = Math.max(right, box.x + box.width);
      bottom = Math.max(bottom, box.y + box.height);
    };
    for (let index = firstPlaced; index < placed.length; index++) {
      const block = placed[index]!;
      include(block.box);
      for (const border of block.borders ?? []) include(border.box);
      if (block.shadingBox) include(block.shadingBox);
      for (const line of block.lines) for (const span of line.spans) include(span.box);
    }
    if (
      ![left, top, right, bottom].every(Number.isFinite) ||
      left + geometry.marginLeft < 0 ||
      right + geometry.marginLeft > geometry.pageWidth ||
      top + storyTop < 0 ||
      bottom + storyTop > geometry.pageHeight
    )
      return null;
    const exclusion = {
      x: left - group.hSpace,
      y: top - group.vSpace,
      width: right - left + 2 * group.hSpace,
      height: bottom - top + 2 * group.vSpace,
    };
    if (
      meetsOrdinaryContent(exclusion, ordinary.blocks) ||
      boxes.some((box) => overlaps(box, exclusion))
    )
      return null;
    boxes.push(exclusion);
  }
  const all = ordinary.blocks.concat(placed);
  const key = (block: BlockFragmentRecord) =>
    block.kind === 'paragraph' ? block.paragraphId : block.tableId;
  if (all.some((block) => !order.has(key(block)))) return null;
  all.sort((a, b) => order.get(key(a))! - order.get(key(b))!);
  return { blocks: all, bottom: ordinary.bottom };
}
