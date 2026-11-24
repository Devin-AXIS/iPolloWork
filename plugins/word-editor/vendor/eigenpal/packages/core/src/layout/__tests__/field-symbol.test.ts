// SYMBOL instruction parsing and glyph synthesis (§17.16.5.60).
//
// The instruction is attacker-controlled: every hostile shape must resolve to null (the
// caller falls back to previous behavior) and must never throw.

import { describe, expect, test } from 'bun:test';
import {
  MAX_SYMBOL_INSTRUCTION_CHARS,
  parseSymbolInstruction,
  symbolFieldGlyph,
} from '../field-symbol.ts';

describe('parseSymbolInstruction', () => {
  test('parses a hex code with a quoted font', () => {
    expect(parseSymbolInstruction(' SYMBOL 0xF0FC \\f "Wingdings" ')).toEqual({
      code: 0xf0fc,
      font: 'Wingdings',
      sizePt: null,
      unicode: false,
    });
  });

  test('parses a decimal code', () => {
    expect(parseSymbolInstruction('SYMBOL 183 \\f "Symbol"')).toMatchObject({
      code: 183,
      font: 'Symbol',
    });
  });

  test('recognition is case-insensitive; the font keeps its case', () => {
    expect(parseSymbolInstruction(' symbol 65 \\f "MS Gothic"')).toMatchObject({
      code: 65,
      font: 'MS Gothic',
    });
  });

  test('accepts an unquoted single-token font', () => {
    expect(parseSymbolInstruction('SYMBOL 0x41 \\f Wingdings')).toMatchObject({
      font: 'Wingdings',
    });
  });

  test('parses \\s whole points and \\u', () => {
    expect(parseSymbolInstruction('SYMBOL 0x2022 \\u \\s 24')).toEqual({
      code: 0x2022,
      font: null,
      sizePt: 24,
      unicode: true,
    });
  });

  test('an invalid \\s argument only drops the switch', () => {
    expect(parseSymbolInstruction('SYMBOL 65 \\s 0')).toMatchObject({ code: 65, sizePt: null });
    expect(parseSymbolInstruction('SYMBOL 65 \\s 1000')).toMatchObject({ sizePt: null });
    expect(parseSymbolInstruction('SYMBOL 65 \\s huge')).toMatchObject({ sizePt: null });
    expect(parseSymbolInstruction('SYMBOL 65 \\s')).toMatchObject({ sizePt: null });
  });

  test('inert and unknown switches never fail the parse', () => {
    expect(parseSymbolInstruction('SYMBOL 65 \\h \\j \\a \\* MERGEFORMAT')).toMatchObject({
      code: 65,
    });
    expect(parseSymbolInstruction('SYMBOL 65 \\zz garbage "stray"')).toMatchObject({ code: 65 });
  });

  test('a switch token never becomes a font name', () => {
    expect(parseSymbolInstruction('SYMBOL 65 \\f \\s 24')).toEqual({
      code: 65,
      font: null,
      sizePt: 24,
      unicode: false,
    });
  });

  test('rejects non-SYMBOL, missing code, and malformed codes', () => {
    expect(parseSymbolInstruction(' PAGE ')).toBeNull();
    expect(parseSymbolInstruction('SYMBOLS 65')).toBeNull();
    expect(parseSymbolInstruction('SYMBOL')).toBeNull();
    expect(parseSymbolInstruction('"SYMBOL" 65')).toBeNull();
    expect(parseSymbolInstruction('SYMBOL abc')).toBeNull();
    expect(parseSymbolInstruction('SYMBOL 0x')).toBeNull();
    expect(parseSymbolInstruction('SYMBOL 0xZZ')).toBeNull();
    expect(parseSymbolInstruction('SYMBOL -5')).toBeNull();
    expect(parseSymbolInstruction('SYMBOL "65"')).toBeNull();
  });

  test('rejects out-of-range and surrogate codes', () => {
    expect(parseSymbolInstruction('SYMBOL 999999999999')).toBeNull();
    expect(parseSymbolInstruction('SYMBOL 1114112')).toBeNull();
    expect(parseSymbolInstruction('SYMBOL 0x110000')).toBeNull();
    expect(parseSymbolInstruction('SYMBOL 0xD800')).toBeNull();
    expect(parseSymbolInstruction('SYMBOL 0xDFFF')).toBeNull();
  });

  test('rejects an oversized instruction and an oversized font, without throwing', () => {
    expect(parseSymbolInstruction(`SYMBOL 65 ${'x'.repeat(MAX_SYMBOL_INSTRUCTION_CHARS)}`)).toBe(
      null
    );
    // Oversized font: the switch is ignored, the code still parses.
    expect(parseSymbolInstruction(`SYMBOL 65 \\f "${'F'.repeat(200)}"`)).toMatchObject({
      font: null,
    });
    expect(parseSymbolInstruction('SYMBOL 65 \\f ""')).toMatchObject({ font: null });
    expect(parseSymbolInstruction('"'.repeat(64))).toBeNull();
  });
});

describe('symbolFieldGlyph', () => {
  test('maps a Wingdings PUA code to its Unicode glyph and keeps the family', () => {
    const spec = parseSymbolInstruction('SYMBOL 0xF0FC \\f "Wingdings"')!;
    const glyph = symbolFieldGlyph(spec, [])!;
    expect(glyph.text).toBe('✔');
    expect(glyph.style.fontFamily).toBe('Wingdings');
  });

  test('a bare byte on a symbol font normalizes onto the 0xF000 page', () => {
    const spec = parseSymbolInstruction('SYMBOL 183 \\f "Symbol"')!;
    expect(symbolFieldGlyph(spec, [])!.text).toBe('•');
  });

  test('an unmapped PUA code keeps the codepoint and the symbol font', () => {
    const spec = parseSymbolInstruction('SYMBOL 0x21 \\f "Wingdings"')!;
    const glyph = symbolFieldGlyph(spec, [])!;
    expect(glyph.text).toBe('\uF021');
    expect(glyph.style.fontFamily).toBe('Wingdings');
  });

  test('\\u renders the codepoint directly with no symbol-page mapping', () => {
    const spec = parseSymbolInstruction('SYMBOL 183 \\f "Symbol" \\u')!;
    const glyph = symbolFieldGlyph(spec, [])!;
    expect(glyph.text).toBe('·');
    expect(glyph.style.fontFamily).toBe('Symbol');
  });

  test('\\s overrides the size in whole points on top of the base props', () => {
    const spec = parseSymbolInstruction('SYMBOL 65 \\s 24')!;
    const glyph = symbolFieldGlyph(spec, [{ localName: 'b' }])!;
    expect(glyph.style.fontSizePt).toBe(24);
    expect(glyph.style.bold).toBe(true);
  });

  test('without \\f the base font decides the symbol-page logic', () => {
    const baseProps = [{ localName: 'rFonts', attributes: { ascii: 'Wingdings' } }];
    const spec = parseSymbolInstruction('SYMBOL 0x6C')!;
    expect(symbolFieldGlyph(spec, baseProps)!.text).toBe('●');
  });

  test('rejects controls, noncharacters, and U+FFFC on a non-symbol font', () => {
    for (const raw of [
      'SYMBOL 7',
      'SYMBOL 0x7F',
      'SYMBOL 0xFFFE',
      'SYMBOL 0xFDD0',
      'SYMBOL 0x1FFFF',
      'SYMBOL 0xFFFC',
      'SYMBOL 0xFFFC \\u',
    ]) {
      const spec = parseSymbolInstruction(raw);
      expect(spec).not.toBeNull();
      expect(symbolFieldGlyph(spec!, [])).toBeNull();
    }
  });

  test('a control BYTE on a symbol font still resolves via the PUA page', () => {
    // 0x07 + 0xF000 is an unmapped Wingdings PUA glyph; the byte is not treated as a control.
    const spec = parseSymbolInstruction('SYMBOL 7 \\f "Wingdings"')!;
    expect(symbolFieldGlyph(spec, [])!.text).toBe('\uF007');
  });
});
