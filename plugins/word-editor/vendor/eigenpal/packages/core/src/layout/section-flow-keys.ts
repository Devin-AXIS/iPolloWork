// The section prepass's flow keys: each prepared block's own key, extended by every input a
// neighbour decides — positioned tables, table lead styles, paragraph frames, list auto
// spacing, leading break groups, contextual spacing, border groups, TOC verdicts, list
// markers, and keep chains. A block whose flow key is unchanged lays out the same at the
// same flow position.

import { contextualFlowInputs } from './contextual-paragraph-spacing.ts';
import { withFlowKeyIntern, type FlowKeyIntern } from './flow-key-intern.ts';
import type { ResolvedListItem } from './list-resolve.ts';
import { listAutoSpacingFlowKeys } from './list-auto-spacing.ts';
import { markerFlowToken } from './list-marker-reuse.ts';
import { composeFlowKeys } from './pagination-keeps.ts';
import { paragraphFrameFlowKeys } from './paragraph-frame-flow.ts';
import { paragraphSectionNode } from './section-properties.ts';
import type { PreparedBlock } from './section-prepass-types.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import { anchorFlowKeys, type PositionedTableFlowPolicy } from './table-float-exclusion.ts';
import { tableLeadFlowKeys } from './cell-edge-neighbours.ts';
import type { TableKeepDecisions } from './table-row-keeps.ts';
import type { TerminalTextTableGroup } from './terminal-table-anchor.ts';
import { tocVerdictFor, type TocIdSets } from './toc-id-sets.ts';

export interface SectionFlowKeyInputs {
  readonly prepared: readonly PreparedBlock[];
  readonly keys: string[];
  readonly positioned: PositionedTableFlowPolicy;
  readonly terminalTextTables: TerminalTextTableGroup | undefined;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly listItems: ReadonlyMap<string, ResolvedListItem> | undefined;
  /** Empty when the part has no TOC field, which skips the TOC scan. */
  readonly tocToken: string;
  readonly tocIds: TocIdSets;
  readonly leadingBreakFlowKeys: (keys: string[], prepared: readonly PreparedBlock[]) => string[];
  readonly keptTables: Pick<TableKeepDecisions, 'endsKept'>;
  /** The previous pass's extended keys, so unchanged ones come back as the same strings. */
  readonly flowKeyIntern: FlowKeyIntern | undefined;
}

/** The flow keys, plus the per-block keep-with-next flags and marker texts they read. */
export function sectionFlowKeys(input: SectionFlowKeyInputs): {
  readonly flowKeys: string[];
  readonly keepsNext: boolean[];
  readonly markerTexts: (string | undefined)[];
  readonly flowKeyIntern: FlowKeyIntern;
} {
  const { prepared, styleCascade, listItems, tocIds } = input;
  const keepsNext = prepared.map((entry) => entry.kind === 'paragraph' && entry.keeps.keepNext);
  const markerTexts = prepared.map((entry) =>
    entry.kind === 'paragraph' ? markerFlowToken(listItems?.get(entry.paragraph.id)) : undefined
  );
  // A paragraph's bottom edge belongs to its border GROUP, which the block after it can
  // join or leave. A table never groups, and neither does a paragraph with no borders.
  const borderGroupKeys = prepared.map((entry) =>
    entry.kind === 'paragraph' ? entry.borderGroupKey : ''
  );
  // Which lines a TOC field's paragraphs emit at all, decided by the OTHER paragraphs of
  // the same field. A part with no TOC skips the scan outright rather than asking three
  // empty sets about every block it holds.
  const tocVerdicts =
    input.tocToken === ''
      ? []
      : prepared.map((entry) =>
          entry.kind === 'paragraph' ? tocVerdictFor(entry.paragraph.id, tocIds) : ''
        );

  const lastBlock = prepared.at(-1);
  const { result: flowKeys, intern } = withFlowKeyIntern(input.flowKeyIntern, () =>
    composeFlowKeys(
      input.leadingBreakFlowKeys(
        listAutoSpacingFlowKeys(
          paragraphFrameFlowKeys(
            anchorFlowKeys(tableLeadFlowKeys(input.keys, prepared), input.positioned),
            prepared
          ),
          prepared
        ),
        prepared
      ),
      {
        terminalTableGroup: input.terminalTextTables,
        ...contextualFlowInputs(prepared, styleCascade),
        borderGroupKeyAt: (index) => borderGroupKeys[index]!,
        tocVerdicts,
        markerTextAt: (index) => markerTexts[index],
        keepsNextAt: (index) => keepsNext[index]! || input.keptTables.endsKept(prepared[index]),
        tableAt: (index) => prepared[index]?.kind === 'table',
        endsWithSectionMark:
          lastBlock?.kind === 'paragraph' && !!paragraphSectionNode(lastBlock.paragraph),
        skipKeepNextAt: (index) => prepared[index]?.kind === 'paragraph' && !!prepared[index].frame,
      }
    )
  );
  return { flowKeys, keepsNext, markerTexts, flowKeyIntern: intern };
}
