import { styleSeparatorMembersOf } from './style-separator-group.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { ParagraphSpacing } from './paragraph-style.ts';
import {
  cascadeParagraphFormatting,
  type StyleCascadeTable,
  type TableCellStyleFormatting,
} from './style-cascade.ts';
import { propertiesOf } from './paragraph-flow.ts';
import { hiddenMarkNeighboursOf } from './hidden-paragraph-mark.ts';
import { readTableFloatPosition } from './table-float-properties.ts';
import { wmlChildNamed } from '../store/store/tree-op-table-shared.ts';
import type { CellEdgeNeighbours } from './cell-edge-neighbours.ts';

/** An unnamed paragraph uses the same implicit default style as its unnamed neighbours. */
export function contextualParagraphSpacing(
  spacing: ParagraphSpacing,
  enabled: boolean,
  styleId: string | null,
  previous: string | null | undefined,
  next: string | null | undefined
): ParagraphSpacing {
  return enabled
    ? {
        before: previous !== undefined && previous === styleId ? 0 : spacing.before,
        after: next !== undefined && next === styleId ? 0 : spacing.after,
      }
    : spacing;
}

export function neighbourParagraphStyle(
  block: OoxmlElement | undefined,
  styles: StyleCascadeTable | undefined,
  cellStyle?: TableCellStyleFormatting
): string | null | undefined {
  if (block?.kind !== 'paragraph') return undefined;
  const pPr = block.children.find((node) => node.kind === 'paragraphProperties');
  return styles
    ? cascadeParagraphFormatting(styles, pPr, cellStyle).styleId
    : (propertiesOf(pPr).find((property) => property.localName === 'pStyle')?.attributes?.val ??
        null);
}

/**
 * `w:contextualSpacing` (17.3.1.9) for a paragraph in cell flow. A side with no paragraph
 * in the cell compares with `edges` from `cell-edge-neighbours.ts`, passed only for a real
 * `w:tc`; with none, nothing matches on that side.
 */
export function cellContextualSpacing(
  spacing: ParagraphSpacing,
  enabled: boolean,
  styleId: string | null,
  neighbours: { readonly previous?: OoxmlElement; readonly next?: OoxmlElement } | undefined,
  styles: StyleCascadeTable | undefined,
  cellStyle?: TableCellStyleFormatting,
  edges?: CellEdgeNeighbours
): ParagraphSpacing {
  if (!enabled) return spacing;
  const previous = neighbours?.previous
    ? neighbourParagraphStyle(neighbours.previous, styles, cellStyle)
    : edges?.previous?.style;
  const next = neighbours?.next
    ? neighbourParagraphStyle(neighbours.next, styles, cellStyle)
    : edges?.next?.style;
  return contextualParagraphSpacing(spacing, true, styleId, previous, next);
}

/** A prepared body block, as far as its neighbours' contextual spacing reads it. */
interface FlowNeighbour {
  readonly kind: string;
  readonly styleId?: string | null;
  readonly contextualSpacing?: boolean;
  readonly paragraph?: OoxmlElement;
  readonly table?: OoxmlElement;
}

/** Whether `entry` is a table positioned against the text (17.4.57, 17.4.66). */
function textAnchoredTable(entry: FlowNeighbour): boolean {
  if (entry.kind !== 'table' || !entry.table) return false;
  return readTableFloatPosition(wmlChildNamed(entry.table, 'tblPr'))?.vertAnchor === 'text';
}

/**
 * The block next to `prepared[index]` on `side` for contextual spacing. A table positioned
 * against the text stands aside: the paragraphs around it are neighbours, so the space between
 * them collapses across it when their style asks for it.
 */
export function flowNeighbourAt<T extends FlowNeighbour>(
  prepared: readonly T[],
  index: number,
  side: -1 | 1
): T | undefined {
  let at = index + side;
  while (prepared[at] && textAnchoredTable(prepared[at]!)) at += side;
  return prepared[at];
}

/**
 * The style `w:contextualSpacing` compares against on one side of a body paragraph.
 *
 * A paragraph a hidden mark removed from the flow is still the neighbour on its side; see
 * `hidden-paragraph-mark.ts`. Otherwise the adjacent prepared block answers: a paragraph with
 * its style, anything else with `undefined`, which never matches.
 */
export function flowNeighbourStyle(
  paragraph: OoxmlElement,
  side: -1 | 1,
  adjacent: FlowNeighbour | undefined,
  styles: StyleCascadeTable | undefined
): string | null | undefined {
  const hidden = hiddenMarkNeighboursOf(paragraph);
  const removed = side < 0 ? hidden?.before : hidden?.after;
  if (removed) return neighbourParagraphStyle(removed, styles);
  const members = adjacent?.paragraph ? styleSeparatorMembersOf(adjacent.paragraph) : undefined;
  const member = side < 0 ? members?.at(-1) : members?.[0];
  if (member) return neighbourParagraphStyle(member.paragraph, styles);
  return adjacent?.kind === 'paragraph' ? adjacent.styleId : undefined;
}

/** {@link flowNeighbourStyle} of the paragraph `prepared[index]`, past text-anchored tables. */
export function flowNeighbourBeside(
  prepared: readonly FlowNeighbour[],
  index: number,
  side: -1 | 1,
  styles: StyleCascadeTable | undefined
): string | null | undefined {
  const paragraph = prepared[index]?.paragraph;
  return paragraph
    ? flowNeighbourStyle(paragraph, side, flowNeighbourAt(prepared, index, side), styles)
    : undefined;
}

/**
 * {@link flowNeighbourStyle} as the flow keys read it: `null` never matches, and an
 * unnamed style is `''`, the same encoding as the block's own style.
 */
export function flowNeighbourStyleAt(
  prepared: readonly FlowNeighbour[],
  index: number,
  side: -1 | 1,
  styles: StyleCascadeTable | undefined
): string | null {
  const paragraph = prepared[index]?.paragraph;
  if (!paragraph) return null;
  const style = flowNeighbourStyle(paragraph, side, flowNeighbourAt(prepared, index, side), styles);
  return style === undefined ? null : (style ?? '');
}

/**
 * A cell paragraph's neighbours for contextual spacing, with a paragraph a hidden mark
 * removed from the flow standing in on its side.
 */
export function contextualCellNeighbours<
  T extends { readonly previous?: OoxmlElement; readonly next?: OoxmlElement },
>(paragraph: OoxmlElement, neighbours: T | undefined): T | undefined {
  const hidden = hiddenMarkNeighboursOf(paragraph);
  if (!hidden) return neighbours;
  return {
    ...neighbours,
    previous: hidden.before ?? neighbours?.previous,
    next: hidden.after ?? neighbours?.next,
  } as T;
}

/**
 * The `w:contextualSpacing` inputs the flow keys fold, for one section's prepared blocks.
 *
 * A table answers `null` for its style, which is what the fold means by "not a paragraph of
 * this style".
 */
export function contextualFlowInputs(
  prepared: readonly FlowNeighbour[],
  styles: StyleCascadeTable | undefined
): {
  readonly contextualSpacingAt: (index: number) => boolean;
  readonly styleIdAt: (index: number) => string | null;
  readonly neighbourStyleAt: (index: number, side: -1 | 1) => string | null;
} {
  const contextual = prepared.map(
    (entry) => entry.kind === 'paragraph' && !!entry.contextualSpacing
  );
  const styleIds = prepared.map((entry) =>
    entry.kind === 'paragraph' ? (entry.styleId ?? '') : null
  );
  return {
    contextualSpacingAt: (index) => contextual[index]!,
    styleIdAt: (index) => styleIds[index] ?? null,
    neighbourStyleAt: (index, side) => flowNeighbourStyleAt(prepared, index, side, styles),
  };
}
