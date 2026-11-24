import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import { flowNeighbourStyle } from './contextual-paragraph-spacing.ts';
import { paragraphSpacing, type ParagraphSpacing } from './paragraph-style.ts';
import { resolveParagraphLayoutInputs, type StyleCascadeTable } from './style-cascade.ts';
import { styleSeparatorMembersOf } from './style-separator-group.ts';
import { extendedFlowKey } from './flow-key-intern.ts';

type SpacingBlock =
  | {
      readonly kind: 'paragraph';
      readonly props: readonly OoxmlProperty[];
      readonly spacing: ParagraphSpacing;
      /** The prepared spacing before this resolver changed it; reused entries keep it. */
      readonly rawSpacing?: ParagraphSpacing;
      readonly contextualSpacing: boolean;
      readonly styleId: string | null;
      readonly listItem?: { readonly numId: string };
      readonly paragraph?: OoxmlElement;
    }
  | { readonly kind: 'table' };

/**
 * Automatic spacing is suppressed inside a list, but its outer margins remain.
 *
 * Contextual spacing compares against the neighbour `flowNeighbourStyle` names, so a
 * paragraph a hidden mark removed from the flow still counts; `styles` resolves its style.
 */
export function resolveListAutoSpacing<T extends SpacingBlock>(
  blocks: readonly T[],
  lineUnitPt = 12,
  styles?: StyleCascadeTable
): T[] {
  const resolved = blocks.map((block, index) => {
    if (block.kind !== 'paragraph' || (!block.listItem && !block.contextualSpacing)) return block;
    const sameStyle = (side: -1 | 1): boolean => {
      const adjacent = blocks[index + side];
      const style = block.paragraph
        ? flowNeighbourStyle(block.paragraph, side, adjacent, styles)
        : adjacent?.kind === 'paragraph'
          ? adjacent.styleId
          : undefined;
      return style !== undefined && style === block.styleId;
    };
    const suppressesAuto = (side: -1 | 1): boolean => {
      const neighbor = blocks[index + side];
      const previousEndsUnnumbered =
        side < 0 &&
        neighbor?.kind === 'paragraph' &&
        neighbor.paragraph !== undefined &&
        styleSeparatorMembersOf(neighbor.paragraph) !== undefined;
      const sameList =
        !previousEndsUnnumbered &&
        neighbor?.kind === 'paragraph' &&
        block.listItem !== undefined &&
        neighbor.listItem?.numId === block.listItem.numId;
      return sameList || (block.contextualSpacing && sameStyle(side));
    };
    // Recompute both answers from properties: a reused prepass entry may have been the
    // last item before Enter, or an interior item before the next paragraph was deleted.
    // Include contextual suppression here so keep-with-next prices the same margins
    // as placement, including explicit spacing on unnamed paragraphs.
    const fixedAutoSpacing = styles?.fixedParagraphSpacing === true;
    const lastMember = block.paragraph
      ? styleSeparatorMembersOf(block.paragraph)?.at(-1)?.paragraph
      : undefined;
    const afterProps = lastMember
      ? resolveParagraphLayoutInputs(
          lastMember,
          1000,
          styles,
          undefined,
          undefined,
          false,
          lineUnitPt
        ).props
      : block.props;
    const outer = paragraphSpacing(block.props, { lineUnitPt, fixedAutoSpacing });
    const inner = paragraphSpacing(block.props, {
      inList: block.listItem !== undefined,
      lineUnitPt,
      fixedAutoSpacing,
    });
    // Word also suppresses automatic before-spacing at the start of a story/section.
    let before =
      (block.listItem && index === 0) || suppressesAuto(-1) ? inner.before : outer.before;
    let after = lastMember
      ? paragraphSpacing(afterProps, { lineUnitPt, fixedAutoSpacing }).after
      : suppressesAuto(1)
        ? inner.after
        : outer.after;
    if (block.contextualSpacing) {
      if (sameStyle(-1)) before = 0;
      if (sameStyle(1)) after = 0;
    }
    if (before === block.spacing.before && after === block.spacing.after) return block;
    return { ...block, spacing: { before, after }, rawSpacing: block.rawSpacing ?? block.spacing };
  });
  return resolved.map((block, index) => {
    const input = blocks[index]!;
    if (block.kind !== 'paragraph' || input.kind !== 'paragraph') return block;
    const removed = contextualAfterAbove(blocks, index, styles);
    // A list or contextual paragraph was resolved again above; any other keeps its raw value.
    const resolvedAbove = block !== input || !!input.listItem || input.contextualSpacing;
    const own = resolvedAbove ? block.spacing.before : (input.rawSpacing ?? input.spacing).before;
    // The space before still collapses against the space after that contextual spacing
    // removed above, so it keeps only what exceeds that space after.
    const before = Math.max(0, own - removed);
    if (before === block.spacing.before) return block;
    return {
      ...block,
      spacing: { before, after: block.spacing.after },
      rawSpacing: input.rawSpacing ?? input.spacing,
    };
  });
}

/** The space after that the block above drops by its own contextual spacing, or 0. */
function contextualAfterAbove(
  blocks: readonly SpacingBlock[],
  index: number,
  styles: StyleCascadeTable | undefined
): number {
  const above = blocks[index - 1];
  const block = blocks[index];
  if (above?.kind !== 'paragraph' || !above.contextualSpacing || block?.kind !== 'paragraph') {
    return 0;
  }
  const style = above.paragraph
    ? flowNeighbourStyle(above.paragraph, 1, block, styles)
    : block.styleId;
  return style !== undefined && style === above.styleId
    ? (above.rawSpacing ?? above.spacing).after
    : 0;
}

/**
 * Neighbor changes must invalidate placement before keep-next folds consume the keys.
 *
 * A paragraph under a contextual-spacing paragraph also folds its spacing: its space before
 * depends on the space after above, see {@link resolveListAutoSpacing}.
 */
export function listAutoSpacingFlowKeys(keys: string[], blocks: readonly SpacingBlock[]): string[] {
  let flow = keys;
  blocks.forEach((block, index) => {
    if (block.kind !== 'paragraph') return;
    const above = blocks[index - 1];
    const underContextual = above?.kind === 'paragraph' && above.contextualSpacing;
    if (block.listItem === undefined && !underContextual) return;
    if (flow === keys) flow = [...keys];
    flow[index] = extendedFlowKey(
      flow[index]!,
      '~ls~',
      `${block.spacing.before},${block.spacing.after}`
    );
  });
  return flow;
}
