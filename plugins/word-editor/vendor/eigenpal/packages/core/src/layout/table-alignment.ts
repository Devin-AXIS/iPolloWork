import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { wmlChildNamed as childNamed } from '../store/store/tree-op-table-shared.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import type { TableAlignment } from './semantic-table.ts';

/** `w:tblPr/w:jc`, defaulting to left when absent or unrecognised. */
export function readTableAlignment(
  container: OoxmlElement | undefined
): TableAlignment | undefined {
  const jc = container?.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'jc'
  );
  if (!jc || jc.kind === 'textValue') return undefined;
  const value = jc.attributes.find((attribute) => attribute.localName === 'val')?.value;
  // `start`/`end` are the strict-conformant spellings of `left`/`right`.
  if (value === 'center') return 'center';
  if (value === 'right' || value === 'end') return 'right';
  if (value === 'left' || value === 'start') return 'left';
  return undefined;
}

/** The alignment of a right-to-left table seen from its visual sides. */
export function mirroredAlignment(alignment: TableAlignment): TableAlignment {
  return alignment === 'left' ? 'right' : alignment === 'right' ? 'left' : alignment;
}

/** The first row's `w:tblPrEx` (17.4.61) child named `localName`. */
function firstRowException(firstRow: OoxmlElement | undefined, localName: string) {
  const exception = firstRow && childNamed(firstRow, 'tblPrEx');
  return exception && childNamed(exception, localName);
}

/**
 * The table's `w:tblInd` (17.4.50): the first row's exception states it for the whole table,
 * in every mode; a later row's exception does not move the table.
 */
export function tableIndentNode(
  tblPr: OoxmlElement | undefined,
  firstRow: OoxmlElement | undefined
): OoxmlElement | undefined {
  return firstRowException(firstRow, 'tblInd') ?? (tblPr && childNamed(tblPr, 'tblInd'));
}

/**
 * The table's stated `w:jc` (17.4.29). In compatibility mode 15 the first row's exception
 * (17.4.61) aligns the whole table; the legacy modes align only that row by it.
 */
export function tableAlignmentOf(
  tblPr: OoxmlElement | undefined,
  firstRow: OoxmlElement | undefined,
  compatibilityMode: number | undefined
): TableAlignment | undefined {
  const own = hasCompatibilityRule(compatibilityMode, 'firstRowExceptionAlignsTable')
    ? readTableAlignment(firstRow && childNamed(firstRow, 'tblPrEx'))
    : undefined;
  return own ?? readTableAlignment(tblPr);
}
