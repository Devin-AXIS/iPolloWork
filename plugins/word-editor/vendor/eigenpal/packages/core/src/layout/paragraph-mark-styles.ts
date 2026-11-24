// The run styles that size a paragraph's lines before, and without, their content.

import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { markRunPropertiesWithoutCharacterStyle } from './paragraph-mark-run.ts';
import {
  DEFAULT_RUN_STYLE,
  resolveRunStyle,
  type ResolvedRunStyle,
  type ThemeFonts,
} from './run-style.ts';
import type { TextMeasurer } from './semantic-records.ts';

/** The styles {@link paragraphMarkStyles} resolves for one paragraph. */
export interface ParagraphMarkStyles {
  /** The mark face (CT_PPr/rPr), not content inheritance: it sizes a line with nothing on it. */
  readonly empty: ResolvedRunStyle;
  /** The runs' cascade. A line with content never takes the mark's size (`paragraph-mark-metrics.ts`). */
  readonly cascade: ResolvedRunStyle;
  /**
   * The mark WITHOUT its character style (`paragraph-mark-run.ts`). The floor of a script line
   * reads its vertical alignment.
   */
  readonly unstyledMark: ResolvedRunStyle;
  /**
   * The style a line is estimated from before its first piece: the shorter of the unstyled
   * mark and the runs' cascade. A small direct mark usually carries the size of its runs, and
   * a taller one never grows the line. Heights, not sizes, compare, since faces differ. Only an
   * empty paragraph's line, which has no piece to come, reads the whole mark.
   */
  readonly lineStart: ResolvedRunStyle;
}

/**
 * Resolve the paragraph mark styles. `markProps` is the mark's cascade, or the runs' cascade
 * (`inheritedRunProperties`) by identity when the paragraph names no mark properties.
 */
export function paragraphMarkStyles(
  markProps: readonly OoxmlProperty[],
  inheritedRunProperties: readonly OoxmlProperty[],
  themeFonts: ThemeFonts | undefined,
  measurer: TextMeasurer,
  hasContent: boolean
): ParagraphMarkStyles {
  const empty = markProps.length === 0 ? DEFAULT_RUN_STYLE : resolveRunStyle(markProps, themeFonts);
  const cascade =
    markProps === inheritedRunProperties
      ? empty
      : inheritedRunProperties.length === 0
        ? DEFAULT_RUN_STYLE
        : resolveRunStyle(inheritedRunProperties, themeFonts);
  const unstyledProps = markRunPropertiesWithoutCharacterStyle(markProps);
  const unstyledMark =
    unstyledProps === markProps ? empty : resolveRunStyle(unstyledProps, themeFonts);
  const lineStart = !hasContent
    ? empty
    : measurer.lineMetrics(unstyledMark).height < measurer.lineMetrics(cascade).height
      ? unstyledMark
      : cascade;
  return { empty, cascade, unstyledMark, lineStart };
}
