// The combining kana voiced and semi-voiced sound marks, U+3099 and U+309A.
//
// A face that classes the mark glyph as a mark (GDEF class 3) joins the mark with the kana
// before it, and the pair takes one cell. A face whose mark glyph has no class and an advance
// of its own draws the mark as a character, in its own cell, beside an uncomposed base. A face
// whose mark glyph has no advance, unclassed or classed as a base, overlays it on the base.
//
// HarfBuzz composes a base and a mark into the precomposed kana when the face has it, and
// zeroes an unclassed mark, so it would draw the second kind of face like the first. Such a
// face shapes the mark as its spacing form (U+309B, U+309C) instead, which neither composes
// nor loses its advance, and the face's own mark glyph and advance then replace that glyph.

const MARK_GLYPH_CLASS = 3;
const SOUND_MARKS = /[゙゚]/u;
const SPACING_FORMS: Readonly<Record<string, string>> = { '゙': '゛', '゚': '゜' };

/** The parts of a HarfBuzz face and font that classify a sound mark glyph. */
export interface SoundMarkFontView {
  readonly face: { getGlyphClass(glyph: number): number };
  readonly font: {
    nominalGlyph(unicode: number): number | undefined;
    glyphHAdvance(glyph: number): number;
  };
}

/** The face's own glyph for a sound mark it spaces, and that glyph's advance in font units. */
export interface SpacedSoundMark {
  readonly glyph: number;
  readonly advance: number;
}

/** Sound marks that a face spaces, by UTF-16 code unit. Empty when the face spaces none. */
export type SpacedSoundMarks = ReadonlyMap<number, SpacedSoundMark>;

const classified = new WeakMap<object, SpacedSoundMarks>();

/** Whether the character is a combining sound mark. */
export function isSoundMark(character: string): boolean {
  return character === '\u3099' || character === '\u309A';
}

/** Whether the text holds a combining sound mark. */
export function hasSoundMark(text: string): boolean {
  return SOUND_MARKS.test(text);
}

/**
 * The sound marks this face draws in a cell of their own: the mark glyph exists, has no GDEF
 * mark class, has an advance, and the face also maps the spacing form used to shape it.
 * Classified once per font object.
 */
export function spacedSoundMarks(view: SoundMarkFontView): SpacedSoundMarks {
  const known = classified.get(view.font);
  if (known) return known;
  const marks = new Map<number, SpacedSoundMark>();
  for (const [mark, spacing] of Object.entries(SPACING_FORMS)) {
    const glyph = view.font.nominalGlyph(mark.charCodeAt(0));
    if (glyph === undefined || view.font.nominalGlyph(spacing.charCodeAt(0)) === undefined)
      continue;
    if (view.face.getGlyphClass(glyph) === MARK_GLYPH_CLASS) continue;
    const advance = view.font.glyphHAdvance(glyph);
    if (advance > 0) marks.set(mark.charCodeAt(0), { glyph, advance });
  }
  classified.set(view.font, marks);
  return marks;
}

/** The text with each spaced sound mark replaced by its spacing form, one code unit for one. */
export function withSpacingSoundMarks(text: string, marks: SpacedSoundMarks): string {
  if (marks.size === 0 || !SOUND_MARKS.test(text)) return text;
  return text.replace(/[゙゚]/gu, (mark) =>
    marks.has(mark.charCodeAt(0)) ? SPACING_FORMS[mark]! : mark
  );
}
