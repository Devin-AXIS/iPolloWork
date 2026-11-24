// The prepass shapes one section's block flow reads: each block prepared once per width and
// producer, and the section-wide results kept on the session between passes.
import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import type { FlowKeyIntern } from './flow-key-intern.ts';
import type { ResolvedListItem } from './list-resolve.ts';
import type { NumberingIndex } from './numbering-index.ts';
import type { ParagraphKeeps } from './pagination-keeps.ts';
import type { ParagraphFrame } from './paragraph-frame.ts';
import type { Alignment } from './paragraph-flow.ts';
import type {
  ParagraphBorders,
  ParagraphLineSpacing,
  ParagraphSpacing,
} from './paragraph-style.ts';
import type { ResolvedTabStops } from './paragraph-tabs.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { PositionedTableFlowPolicy } from './table-float-exclusion.ts';
import type { TerminalTextTableGroup } from './terminal-table-anchor.ts';

/** Prepass results by block node, valid while the width and producer both hold. */
export type PreparedBlock =
  | {
      readonly kind: 'paragraph';
      readonly frame?: ParagraphFrame;
      readonly paragraph: OoxmlElement;
      readonly props: OoxmlProperty[];
      readonly indent: { left: number; right: number; hanging: number; firstLine: number };
      readonly available: number;
      readonly alignment: Alignment;
      readonly spacing: ParagraphSpacing;
      readonly lineSpacing: ParagraphLineSpacing;
      readonly contextualSpacing: boolean;
      readonly styleId: string | null;
      readonly outlineLevel: number | null;
      readonly borders: ParagraphBorders;
      /**
       * Border identity + indent, for the `w:between` group rule.
       *
       * Indent participates because a group whose members sit at different indents would need
       * a stepped outline; splitting the group there gives each member its own closed box,
       * which is the near miss rather than a rule drawn through the text.
       */
      readonly borderGroupKey: string;
      readonly shading: string | undefined;
      readonly inheritedRunProperties: readonly OoxmlProperty[];
      readonly markRunProperties: readonly OoxmlProperty[];
      readonly tabStops: ResolvedTabStops;
      /** `w:widowControl` / `w:keepNext` / `w:keepLines`, after the style cascade. */
      readonly keeps: ParagraphKeeps;
      readonly listItem?: ResolvedListItem;
      readonly key: string;
    }
  | { readonly kind: 'table'; readonly table: OoxmlElement; readonly key: string };

/**
 * One section's whole prepass — prepared entries, cache keys, flow keys and document
 * order — kept on the section's {@link LayoutSession} and reused verbatim while every
 * input it derives from is unchanged. Stored through the session's opaque `prepass` slot.
 */
export interface SectionPrepass {
  /** Anchor membership and break eligibility derived from the prepared section blocks. */
  readonly positioned: PositionedTableFlowPolicy;
  /** Frame admission depends on column policy and probe-disabled paragraph IDs. */
  readonly framePolicy: string;
  readonly bodies: readonly OoxmlElement[];
  readonly producer: string;
  readonly contentWidth: number;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly listItems: ReadonlyMap<string, ResolvedListItem> | undefined;
  /**
   * The numbering index `hostedTextboxListToken` reads. Compared by IDENTITY: a story with
   * no numbered paragraphs of its own can host a text box whose list a numbering edit
   * renumbers, and then `listItems` is the same (empty) map while every hosted token in
   * `entry.key` is stale.
   */
  readonly numberingIndex: NumberingIndex | undefined;
  readonly drawingEpoch: string;
  readonly projectionEpoch: string;
  readonly prepared: PreparedBlock[];
  readonly keys: string[];
  readonly paragraphDocumentOrder: ReadonlyMap<string, number>;
  readonly keepsNext: boolean[];
  readonly markerTexts: (string | undefined)[];
  readonly tocToken: string;
  /**
   * The story-wide REF values token. Compared WHOLE, like {@link tocToken} and for the same
   * shape of reason: a renumbering edit in one section moves a REF value painted in another
   * whose blocks and list map are identity-unchanged, so no per-section input sees it.
   */
  readonly refToken: string;
  readonly flowKeys: string[];
  /** The extended flow keys by base key and suffix, which the next pass answers from. */
  readonly flowKeyIntern: FlowKeyIntern;
  readonly terminalTextTables: TerminalTextTableGroup | undefined;
}
