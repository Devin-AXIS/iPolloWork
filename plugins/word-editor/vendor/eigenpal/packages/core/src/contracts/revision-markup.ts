/** Named revision colors. Identifiers are stable and never contain CSS. @public */
export const REVISION_MARKUP_COLORS = [
  'black',
  'blue',
  'turquoise',
  'green',
  'pink',
  'red',
  'yellow',
  'white',
  'darkBlue',
  'teal',
  'darkGreen',
  'violet',
  'darkRed',
  'darkYellow',
  'gray50',
  'gray25',
  'lightBlue',
  'lightYellow',
  'lightOrange',
  'lightPurple',
  'lightGreen',
  'gray',
] as const;
/** @public */
export type RevisionMarkupNamedColor = (typeof REVISION_MARKUP_COLORS)[number];
/** @public */
export type RevisionMarkupColor = RevisionMarkupNamedColor | 'byAuthor' | 'auto';
/** @public */
export type RevisionMarkupMark =
  | 'none'
  | 'colorOnly'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'doubleUnderline'
  | 'strikethrough'
  | 'doubleStrikethrough';
/** @public */
export type RevisionDeletionMark = RevisionMarkupMark | 'hidden' | 'caret' | 'pound';
/** @public */
export type RevisionChangedLinesMark = 'none' | 'leftBorder' | 'rightBorder' | 'outsideBorder';
/** @public */
export interface RevisionMarkupStyle<Mark extends string = RevisionMarkupMark> {
  readonly mark: Mark;
  readonly color: RevisionMarkupColor;
}
/** Viewer-only text styling. Document highlighting remains unchanged. @public */
export interface RevisionMarkupTextStyle<
  Mark extends string = RevisionMarkupMark,
> extends RevisionMarkupStyle<Mark> {
  /** Background color behind revision text. Defaults to `none`. */
  readonly background: RevisionMarkupNamedColor | 'byAuthor' | 'none';
}
/** Fully resolved, immutable viewer preferences. @public */
export interface ResolvedRevisionMarkup {
  readonly insertions: RevisionMarkupTextStyle;
  readonly deletions: RevisionMarkupTextStyle<RevisionDeletionMark>;
  readonly movedFrom: RevisionMarkupTextStyle<RevisionDeletionMark>;
  readonly movedTo: RevisionMarkupTextStyle;
  readonly formatting: RevisionMarkupTextStyle;
  readonly changedLines: RevisionMarkupStyle<RevisionChangedLinesMark>;
  readonly cells: {
    readonly inserted: RevisionMarkupNamedColor | 'byAuthor' | 'none';
    readonly deleted: RevisionMarkupNamedColor | 'byAuthor' | 'none';
    readonly merged: RevisionMarkupNamedColor | 'byAuthor' | 'none';
    readonly split: RevisionMarkupNamedColor | 'byAuthor' | 'none';
  };
  readonly trackMoves: boolean;
  readonly trackFormatting: boolean;
}
/** Partial viewer preferences. Omitted values keep the previous value. @public */
export type RevisionMarkupOptions = {
  readonly [K in keyof ResolvedRevisionMarkup]?: ResolvedRevisionMarkup[K] extends boolean
    ? boolean
    : Partial<ResolvedRevisionMarkup[K]>;
};
const style = <T extends string>(mark: T, color: RevisionMarkupColor): RevisionMarkupStyle<T> =>
  Object.freeze({ mark, color });
const textStyle = <T extends string>(
  mark: T,
  color: RevisionMarkupColor
): RevisionMarkupTextStyle<T> => Object.freeze({ mark, color, background: 'none' });
/** Initial viewer preferences. @public */
export const DEFAULT_REVISION_MARKUP: ResolvedRevisionMarkup = Object.freeze({
  insertions: textStyle('underline', 'byAuthor'),
  deletions: textStyle('strikethrough', 'byAuthor'),
  movedFrom: textStyle('doubleStrikethrough', 'green'),
  movedTo: textStyle('doubleUnderline', 'green'),
  formatting: textStyle('none', 'byAuthor'),
  changedLines: style('outsideBorder', 'auto'),
  cells: Object.freeze({
    inserted: 'lightBlue',
    deleted: 'pink',
    merged: 'lightYellow',
    split: 'lightOrange',
  }),
  trackMoves: true,
  trackFormatting: true,
});
const marks = [
  'none',
  'colorOnly',
  'bold',
  'italic',
  'underline',
  'doubleUnderline',
  'strikethrough',
  'doubleStrikethrough',
];
/** Validate and merge preferences without modifying the input. @public */
export function resolveRevisionMarkup(
  input: RevisionMarkupOptions = {},
  previous: ResolvedRevisionMarkup = DEFAULT_REVISION_MARKUP
): ResolvedRevisionMarkup {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError('Invalid revision markup settings');
  const result = { ...previous };
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(previous, key))
      throw new TypeError(`Unknown revision markup setting: ${key}`);
  }
  for (const key of ['trackMoves', 'trackFormatting'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') throw new TypeError(`Invalid ${key}`);
      result[key] = input[key];
    }
  }
  for (const key of [
    'insertions',
    'deletions',
    'movedFrom',
    'movedTo',
    'formatting',
    'changedLines',
    'cells',
  ] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new TypeError(`Invalid ${key}`);
    for (const field of Object.keys(value))
      if (!Object.hasOwn(previous[key], field)) throw new TypeError(`Unknown ${key}.${field}`);
    const merged = { ...previous[key], ...value };
    if (key === 'cells') {
      for (const color of Object.values(merged))
        if (
          color !== 'none' &&
          color !== 'byAuthor' &&
          !REVISION_MARKUP_COLORS.includes(color as RevisionMarkupNamedColor)
        )
          throw new TypeError('Invalid cell color');
    } else {
      if (key !== 'changedLines') {
        const background = (merged as RevisionMarkupTextStyle<string>).background;
        if (
          background !== 'none' &&
          background !== 'byAuthor' &&
          !REVISION_MARKUP_COLORS.includes(background)
        )
          throw new TypeError(`Invalid ${key} background`);
      }
      const entry = merged as RevisionMarkupStyle<string>;
      const allowed =
        key === 'changedLines'
          ? ['none', 'leftBorder', 'rightBorder', 'outsideBorder']
          : key === 'deletions' || key === 'movedFrom'
            ? [...marks, 'hidden', 'caret', 'pound']
            : marks;
      if (!allowed.includes(entry.mark)) throw new TypeError(`Invalid ${key} mark`);
      if (
        entry.color !== 'auto' &&
        entry.color !== 'byAuthor' &&
        !REVISION_MARKUP_COLORS.includes(entry.color)
      )
        throw new TypeError(`Invalid ${key} color`);
    }
    Object.assign(result, { [key]: Object.freeze(merged) });
  }
  return Object.freeze(result);
}
/** CSS token for a validated named color. */
export function revisionMarkupColor(
  color: RevisionMarkupColor,
  authorColor: string,
  auto = 'currentColor'
): string {
  return color === 'auto'
    ? auto
    : color === 'byAuthor'
      ? authorColor
      : `var(--doc-revision-color-${color})`;
}

/** Select the visual style without changing revision identity. */
export function revisionMarkupStyle(
  settings: ResolvedRevisionMarkup,
  kind: 'insert' | 'delete' | 'moveFrom' | 'moveTo' | 'format'
): RevisionMarkupTextStyle<RevisionDeletionMark> {
  switch (kind) {
    case 'insert':
      return settings.insertions;
    case 'delete':
      return settings.deletions;
    case 'moveFrom':
      return settings.trackMoves ? settings.movedFrom : settings.deletions;
    case 'moveTo':
      return settings.trackMoves ? settings.movedTo : settings.insertions;
    case 'format':
      return settings.formatting;
  }
}

/** A local settings draft owned by the editor. @public */
export interface RevisionMarkupDialogSession {
  /** Aborts on close, replacement, load, detach, destroy, or renderer disposal. */
  readonly signal: AbortSignal;
  /** Read the immutable draft. */
  get(): ResolvedRevisionMarkup;
  /** Merge validated options into the draft without committing preferences. */
  set(options: RevisionMarkupOptions): void;
  /** Restore default preferences in the draft only. */
  reset(): void;
  /** Observe draft changes, including effective external preference changes. */
  subscribe(listener: () => void): () => void;
  canApply(): boolean;
  /** Commit the draft and close. Returns false after cancellation. */
  apply(): boolean;
  /** Close without committing the draft. */
  cancel(): void;
}
/** Host rendering for the Track changes options dialog. @public */
export interface RevisionMarkupChromeHandlers {
  readonly onRequest?: (session: RevisionMarkupDialogSession) => void;
}
