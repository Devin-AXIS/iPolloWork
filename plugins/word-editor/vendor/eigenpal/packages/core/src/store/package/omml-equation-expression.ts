// The bounded expression tree that the Office Math projection reads OMML into.

/**
 * Marks a structure whose property element carries `m:ctrlPr` operator run formatting that
 * compact replacement cannot reproduce.
 *
 * The source keeps those properties verbatim. Layout draws the operator glyphs with the
 * default math formatting. When every `m:ctrlPr` of the equation holds only default
 * formatting, no structure carries this mark: compact replacement writes the same control
 * properties back on each structure it emits.
 */
export interface EquationControlSource {
  /** The structure carries non-default `m:ctrlPr` properties, so compact replacement refuses it. */
  readonly controlProperties?: true;
  /**
   * Font size of the structure, in points. The source is the `w:sz` value of the run
   * properties in the structure's `m:ctrlPr`, which counts half-points.
   *
   * Layout sizes script offsets and bar strokes and gaps from this size, not from the size of
   * the runs inside the structure. When it is not set, those use the size of the text around
   * the equation. A script or fraction after the first atom of the equation takes its offsets
   * from the size of that first atom instead. Set whether or not the control properties are
   * default. Radicals and n-ary operators with limits below and above do not use it yet.
   */
  readonly controlFontSizePt?: number;
}

export type EquationExpression =
  | { readonly kind: 'row'; readonly items: readonly EquationExpression[] }
  | {
      readonly kind: 'text';
      readonly value: string;
      /**
       * Authored font size of the run, in points. The source is the `w:sz` value of the
       * run properties (`w:rPr`), which counts half-points.
       *
       * Set only when every run of the equation holds the same default math formatting: the
       * Cambria Math font, italic, one size, and at most a language. Such runs have no
       * `format`, so compact replacement stays available and writes the same `w:rPr` back.
       * Otherwise the size is in `format.fontSizePt`. When neither field is set, the text
       * takes the size of the surrounding text. To read the size of any text expression,
       * use `format?.fontSizePt ?? fontSizePt`.
       */
      readonly fontSizePt?: number;
      /**
       * Source formatting of the run. Set when the run has its own supported formatting and
       * the equation does not use the uniform default math formatting. Compact replacement
       * refuses an equation that has a text expression with a `format`, because it cannot
       * write that formatting back.
       */
      readonly format?: {
        readonly fontFamily?: string;
        /**
         * Authored font size of the run, in points. The source is the `w:sz` value of the
         * run properties (`w:rPr`), which counts half-points. Set when the run has a
         * `format` and a `w:sz`. The top-level `fontSizePt` is not set in that case.
         */
        readonly fontSizePt?: number;
        readonly bold?: boolean;
        readonly italic?: boolean;
        readonly literal?: boolean;
        readonly normalText?: boolean;
        readonly mathStyle?: 'p' | 'b' | 'i' | 'bi';
      };
    }
  | ({
      readonly kind: 'bar';
      readonly body: EquationExpression;
      readonly position: 'top' | 'bottom';
    } & EquationControlSource)
  | ({
      readonly kind: 'fraction';
      readonly numerator: EquationExpression;
      readonly denominator: EquationExpression;
    } & EquationControlSource)
  | ({
      readonly kind: 'radical';
      readonly radicand: EquationExpression;
      readonly degree?: EquationExpression;
    } & EquationControlSource)
  | ({
      readonly kind: 'script';
      readonly base: EquationExpression;
      readonly subscript?: EquationExpression;
      readonly superscript?: EquationExpression;
    } & EquationControlSource)
  | ({
      readonly kind: 'nary';
      /** The operator character from `m:chr`, or `∫` when the source names none. */
      readonly operator: string;
      readonly body: EquationExpression;
      readonly lowerLimit?: EquationExpression;
      readonly upperLimit?: EquationExpression;
      /**
       * Where the limits sit, from `m:limLoc`: `undOvr` below and above the operator, `subSup`
       * to its right as a subscript and superscript. Not set when the source names none.
       * Inline equations place the limits to the right either way. An `m:oMath` alone in its
       * paragraph is a display equation, as an `m:oMathPara` is, and follows this location.
       */
      readonly limitLocation?: 'undOvr' | 'subSup';
    } & EquationControlSource)
  | ({
      /**
       * `m:d`: arguments between an opening and a closing character, with a separator
       * character between arguments. Each character is the source `m:val`, or the default
       * (`(`, `)`, and `|`) when the source names none. An empty string draws nothing.
       */
      readonly kind: 'delimiter';
      readonly opening: string;
      readonly closing: string;
      readonly separator: string;
      /** The `m:e` arguments, in source order. There is at least one. */
      readonly items: readonly EquationExpression[];
      /**
       * `m:grow`: the characters stretch to the height of the arguments. An omitted `m:grow`
       * is on for a delimiter (ISO/IEC 29500-1). Only brackets, braces, and vertical bars grow.
       */
      readonly grow: boolean;
      /**
       * `m:shp`: `centered` characters cover the arguments evenly above and below the math
       * axis; `match` characters cover exactly the arguments.
       */
      readonly shape: 'centered' | 'match';
    } & EquationControlSource)
  | ({
      /**
       * `m:borderBox`: the body inside a rectangle. A hidden edge draws no rule and keeps no
       * gap. Strikes cross the box horizontally, vertically, or along a diagonal.
       */
      readonly kind: 'borderBox';
      readonly body: EquationExpression;
      readonly hidden: EquationBoxEdges;
      readonly strikes: EquationBoxStrikes;
    } & EquationControlSource)
  | { readonly kind: 'fallback'; readonly text: string };

/** The edges of an `m:borderBox` that its properties hide. */
export interface EquationBoxEdges {
  readonly top: boolean;
  readonly bottom: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

/** The strikes an `m:borderBox` draws across its body. */
export interface EquationBoxStrikes {
  /** `m:strikeH`: a horizontal line through the centre. */
  readonly horizontal: boolean;
  /** `m:strikeV`: a vertical line through the centre. */
  readonly vertical: boolean;
  /** `m:strikeBLTR`: from the bottom-left corner to the top-right corner. */
  readonly bottomLeftToTopRight: boolean;
  /** `m:strikeTLBR`: from the top-left corner to the bottom-right corner. */
  readonly topLeftToBottomRight: boolean;
}
