import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { ResolvedListItem } from './list-resolve.ts';
import {
  resolveParagraphLayoutInputs,
  type ParagraphLayoutInputs,
  type StyleCascadeTable,
  type TableCellStyleFormatting,
} from './style-cascade.ts';
import {
  prepareParagraphBreakInputs,
  type ParagraphBreakDependencies,
} from './paragraph-break-request.ts';
import { rememberLayoutProperties } from './layout-cache.ts';

interface Memo {
  cascade: StyleCascadeTable | undefined;
  list: ResolvedListItem | undefined;
  cell: TableCellStyleFormatting | undefined;
  lineUnit: number | undefined;
  width: number;
  inputs: ParagraphLayoutInputs;
  prepared?: {
    interval: number | undefined;
    dependencies: ParagraphBreakDependencies;
    value: ReturnType<typeof prepareParagraphBreakInputs>;
  };
}
const memos = new WeakMap<OoxmlElement, Memo>();

/** Internal immutable tree inputs; available width is the only width-dependent field. */
export function cellParagraphInputs(
  paragraph: OoxmlElement,
  width: number,
  cascade: StyleCascadeTable | undefined,
  list: ResolvedListItem | undefined,
  cell: TableCellStyleFormatting | undefined,
  lineUnit: number | undefined
): ParagraphLayoutInputs {
  const memo = memos.get(paragraph);
  if (
    memo &&
    memo.cascade === cascade &&
    memo.list === list &&
    memo.cell === cell &&
    memo.lineUnit === lineUnit
  ) {
    if (memo.width !== width) {
      memo.width = width;
      memo.inputs = {
        ...memo.inputs,
        available: cellAvailableWidth(memo.inputs, width),
      };
    }
    return memo.inputs;
  }
  const inputs = resolveParagraphLayoutInputs(
    paragraph,
    width,
    cascade,
    list,
    cell,
    true,
    lineUnit
  );
  memos.set(paragraph, { cascade, list, cell, lineUnit, width, inputs });
  return inputs;
}

/** The line width `inputs` leave at a cell content `width`; the one formula resolve also uses. */
export function cellAvailableWidth(inputs: ParagraphLayoutInputs, width: number): number {
  return cellWidthAfterIndents(width, inputs.indent.left, inputs.indent.right);
}

/** The width expression shared by placement and grouped width-fit proofs. */
export function cellWidthAfterIndents(width: number, left: number, right: number): number {
  return Math.max(1, width - left - right);
}

/**
 * The memoized inputs for these dependencies, whatever width they were last read at, without
 * replacing the memo. Every field but `available` is width-independent; callers that only
 * move a placed line read `available` through {@link cellAvailableWidth} instead.
 */
export function memoizedCellParagraphInputs(
  paragraph: OoxmlElement,
  cascade: StyleCascadeTable | undefined,
  list: ResolvedListItem | undefined,
  cell: TableCellStyleFormatting | undefined,
  lineUnit: number | undefined
): ParagraphLayoutInputs | undefined {
  const memo = memos.get(paragraph);
  return memo &&
    memo.cascade === cascade &&
    memo.list === list &&
    memo.cell === cell &&
    memo.lineUnit === lineUnit
    ? memo.inputs
    : undefined;
}

/**
 * The prepared break inputs `cellParagraphBreakInputs` would return from its memo for these
 * values, or undefined on a miss. Builds no dependency object; callers fall back to
 * `cellParagraphBreakInputs` on a miss.
 */
export function memoizedCellParagraphBreakInputs(
  paragraph: OoxmlElement,
  inputs: ParagraphLayoutInputs,
  interval: number | undefined,
  listToken: string | undefined,
  hostedListToken: string,
  refToken: string
): ReturnType<typeof prepareParagraphBreakInputs> | undefined {
  const memo = memos.get(paragraph);
  const known = memo?.prepared;
  return memo?.inputs === inputs &&
    known &&
    known.interval === interval &&
    known.dependencies.listToken === listToken &&
    known.dependencies.hostedListToken === hostedListToken &&
    known.dependencies.refToken === refToken
    ? known.value
    : undefined;
}

export function cellParagraphBreakInputs(
  paragraph: OoxmlElement,
  inputs: ParagraphLayoutInputs,
  interval: number | undefined,
  dependencies: ParagraphBreakDependencies
): ReturnType<typeof prepareParagraphBreakInputs> {
  const memo = memos.get(paragraph);
  const known = memo?.prepared;
  if (
    memo?.inputs === inputs &&
    known &&
    known.interval === interval &&
    known.dependencies.listToken === dependencies.listToken &&
    known.dependencies.hostedListToken === dependencies.hostedListToken &&
    known.dependencies.refToken === dependencies.refToken
  )
    return known.value;
  const value = prepareParagraphBreakInputs(inputs, interval, dependencies);
  rememberLayoutProperties(value.properties);
  if (memo?.inputs === inputs) memo.prepared = { interval, dependencies, value };
  return value;
}
