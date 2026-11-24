// Auto paragraph spacing at a table cell's own edges, split out of `semantic-table-layout.ts`
// so that module stays inside its line budget; the rule and its budget are unchanged.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import {
  AUTO_PARAGRAPH_SPACING_PT,
  paragraphAutoSpacingSides,
  type ParagraphSpacing,
} from './paragraph-style.ts';

/**
 * Drop the auto gap where a paragraph meets its cell's own boundary.
 *
 * `w:beforeAutospacing` / `w:afterAutospacing` resolve to Word's automatic value, and that
 * value applies BETWEEN paragraphs — including between two inside one cell. It contributes
 * nothing across a cell boundary: a captured control at 10pt with an 11.52pt line pitch puts
 * 26.16pt between two auto-spaced paragraphs in a cell, the same as in the body, while the
 * gap across a row boundary carries no addition at all. See `.cache/pdf/claude-autospacing/`.
 *
 * An AUTHORED measurement is untouched — only the substituted value is suppressed, because
 * only it is the consumer's to decide. Under `w:doNotUseHTMLParagraphAutoSpacing`
 * (`edges.fixedAutoSpacing`) nothing is substituted, so the authored spacing stays.
 *
 * A numbered paragraph (17.9.18 `w:numPr`) in a table cell is the exception at the cell's
 * end: the outer margin of its list run stays below it, also when the next row continues the
 * same list. `edges.listItem` marks it; {@link cellListAutoSpacing} supplies that margin.
 */
export function cellEdgeAutoSpacing(
  spacing: ParagraphSpacing,
  props: readonly OoxmlProperty[],
  edges: {
    readonly firstInCell: boolean;
    readonly lastInCell: boolean;
    readonly fixedAutoSpacing: boolean;
    readonly listItem?: boolean;
  }
): ParagraphSpacing {
  const { firstInCell, lastInCell } = edges;
  if (!firstInCell && !lastInCell) return spacing;
  const auto = paragraphAutoSpacingSides(props, edges);
  const dropBefore = firstInCell && auto.before;
  const dropAfter = lastInCell && auto.after && edges.listItem !== true;
  if (!dropBefore && !dropAfter) return spacing;
  return {
    before: dropBefore ? 0 : spacing.before,
    after: dropAfter ? 0 : spacing.after,
  };
}

/**
 * The outer margins of a list run inside one table cell.
 *
 * Automatic spacing (17.3.1.33 `w:spacing` `@w:beforeAutospacing`/`@w:afterAutospacing`) is
 * suppressed between two items of the same list, and the run keeps its automatic margin
 * before its first item and after its last. The body flow resolves this across blocks
 * (`list-auto-spacing.ts`); in a cell the neighbours are the paragraphs of the same cell, and
 * a cell edge counts as the end of the run.
 */
export function cellListAutoSpacing(
  spacing: ParagraphSpacing,
  props: readonly OoxmlProperty[],
  list: {
    readonly numId: string;
    readonly fixedAutoSpacing: boolean;
    /** The `w:numId` of the paragraph before and after in the cell, if numbered. */
    readonly previous: string | undefined;
    readonly next: string | undefined;
  }
): ParagraphSpacing {
  const auto = paragraphAutoSpacingSides(props, list);
  if (!auto.before && !auto.after) return spacing;
  return {
    before:
      auto.before && list.previous !== list.numId ? AUTO_PARAGRAPH_SPACING_PT : spacing.before,
    after: auto.after && list.next !== list.numId ? AUTO_PARAGRAPH_SPACING_PT : spacing.after,
  };
}

/**
 * A cell paragraph's automatic spacing: the list margins of {@link cellListAutoSpacing} for a
 * numbered paragraph in a table cell (`list`, set only for a real `w:tc`), then the cell-edge
 * rule of {@link cellEdgeAutoSpacing}.
 */
export function cellAutoSpacing(
  spacing: ParagraphSpacing,
  props: readonly OoxmlProperty[],
  edges: {
    readonly firstInCell: boolean;
    readonly lastInCell: boolean;
    readonly fixedAutoSpacing: boolean;
    readonly list?: { readonly numId: string } | undefined;
    readonly listItems?: ReadonlyMap<string, { readonly numId: string }> | undefined;
    readonly neighbours?:
      | { readonly previous: OoxmlElement | undefined; readonly next: OoxmlElement | undefined }
      | undefined;
  }
): ParagraphSpacing {
  const { list, listItems, neighbours, fixedAutoSpacing } = edges;
  const numIdOf = (block: OoxmlElement | undefined) => block && listItems?.get(block.id)?.numId;
  const listed = list
    ? cellListAutoSpacing(spacing, props, {
        numId: list.numId,
        fixedAutoSpacing,
        previous: numIdOf(neighbours?.previous),
        next: numIdOf(neighbours?.next),
      })
    : spacing;
  return cellEdgeAutoSpacing(listed, props, { ...edges, listItem: list !== undefined });
}
