import type { ResolvedRunStyle } from './run-style.ts';

// Enumerable symbol metadata survives shaping copies without entering the public style shape.
const authoredMarks = Symbol('authored-revision-markup-style');
type MarkupStyle = ResolvedRunStyle & {
  readonly [authoredMarks]?: { readonly bold: boolean; readonly italic: boolean };
};

/** Measure viewer emphasis while retaining authored formatting for editing. */
export function withRevisionMarkupEmphasis(
  style: ResolvedRunStyle,
  mark: 'bold' | 'italic'
): ResolvedRunStyle {
  const source = (style as MarkupStyle)[authoredMarks] ?? {
    bold: style.bold,
    italic: style.italic,
  };
  return { ...style, [mark]: true, [authoredMarks]: source } as MarkupStyle;
}

/** Formatting commands and toolbar readback must not turn viewer markup into document formatting. */
export function revisionMarkupStyleForEditing(style: ResolvedRunStyle): ResolvedRunStyle {
  const source = (style as MarkupStyle)[authoredMarks];
  return source ? { ...style, bold: source.bold, italic: source.italic } : style;
}

/** Visually identical runs still keep distinct authored formatting boundaries. */
export function revisionMarkupSourcesEqual(a: ResolvedRunStyle, b: ResolvedRunStyle): boolean {
  const left = (a as MarkupStyle)[authoredMarks] ?? a;
  const right = (b as MarkupStyle)[authoredMarks] ?? b;
  return left.bold === right.bold && left.italic === right.italic;
}
