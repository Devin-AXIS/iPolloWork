// MACROBUTTON / GOTOBUTTON instruction parsing (§17.16.5.36, §17.16.5.31).
//
// The instruction is attacker-controlled: every hostile shape must resolve to null (the
// caller falls back to cached text or nothing) and must never throw. The first argument —
// the macro name / jump target — is consumed and discarded; only display text comes out.

import { describe, expect, test } from 'bun:test';
import { MAX_BUTTON_INSTRUCTION_CHARS, parseButtonInstruction } from '../field-button.ts';

describe('parseButtonInstruction', () => {
  test('a bare macro name: display is everything after it', () => {
    expect(parseButtonInstruction(' MACROBUTTON MyMacro Click Here ')).toEqual({
      display: 'Click Here',
    });
  });

  test('GOTOBUTTON parses the same way', () => {
    expect(parseButtonInstruction(' GOTOBUTTON bookmark3 Go to section 3 ')).toEqual({
      display: 'Go to section 3',
    });
  });

  test('recognition is case-insensitive; the display keeps its case', () => {
    expect(parseButtonInstruction('macrobutton m Do It')).toEqual({ display: 'Do It' });
    expect(parseButtonInstruction('GoToButton b There')).toEqual({ display: 'There' });
  });

  test('a quoted first argument is consumed whole, embedded spaces included', () => {
    expect(parseButtonInstruction(' MACROBUTTON "My Long Macro" Press me ')).toEqual({
      display: 'Press me',
    });
  });

  test('internal quotes and backslashes in the display survive verbatim', () => {
    expect(parseButtonInstruction('MACROBUTTON M Click "right here" now')).toEqual({
      display: 'Click "right here" now',
    });
    expect(parseButtonInstruction('MACROBUTTON M Open C:\\docs\\file')).toEqual({
      display: 'Open C:\\docs\\file',
    });
  });

  test('internal whitespace is preserved, ends are trimmed', () => {
    expect(parseButtonInstruction('MACROBUTTON M  Two  spaces  ')).toEqual({
      display: 'Two  spaces',
    });
  });

  test('a whole-remainder quoted display loses its surrounding quotes', () => {
    expect(parseButtonInstruction(' MACROBUTTON M "Click Here" ')).toEqual({
      display: 'Click Here',
    });
  });

  test('quotes that close mid-remainder are part of the display', () => {
    expect(parseButtonInstruction('MACROBUTTON M "a" b')).toEqual({ display: '"a" b' });
  });

  test('a trailing \\* MERGEFORMAT is stripped, case-insensitively', () => {
    expect(parseButtonInstruction(' MACROBUTTON M Click Me \\* MERGEFORMAT ')).toEqual({
      display: 'Click Me',
    });
    expect(parseButtonInstruction('MACROBUTTON M Click \\* mergeformat')).toEqual({
      display: 'Click',
    });
  });

  test('a generic trailing \\* switch and its argument are stripped, stacked ones too', () => {
    expect(parseButtonInstruction('MACROBUTTON M Click \\* Upper')).toEqual({ display: 'Click' });
    expect(parseButtonInstruction('MACROBUTTON M Click \\* Upper \\* MERGEFORMAT')).toEqual({
      display: 'Click',
    });
  });

  test('a mid-display \\* is NOT stripped — only a trailing switch tail is', () => {
    expect(parseButtonInstruction('MACROBUTTON M a \\* b c')).toEqual({ display: 'a \\* b c' });
  });

  test('a trailing lone backslash is display text, not a switch', () => {
    expect(parseButtonInstruction('MACROBUTTON M \\')).toEqual({ display: '\\' });
    expect(parseButtonInstruction('MACROBUTTON M x \\')).toEqual({ display: 'x \\' });
  });

  test('a quoted display shields a switch-looking tail from stripping', () => {
    // The tail sits INSIDE one whole-remainder quoted token: the quotes come off, the
    // "switch" stays — it is the authored display text.
    expect(parseButtonInstruction('MACROBUTTON M "Click \\* MERGEFORMAT"')).toEqual({
      display: 'Click \\* MERGEFORMAT',
    });
  });

  test('the keyword must be the exact token, not a prefix superstring', () => {
    expect(parseButtonInstruction('MACROBUTTONX M text')).toBeNull();
    expect(parseButtonInstruction('GOTOBUTTONS b text')).toBeNull();
    expect(parseButtonInstruction('"MACROBUTTON" M text')).toBeNull();
    expect(parseButtonInstruction(' PAGE ')).toBeNull();
  });

  test('no display text is null', () => {
    expect(parseButtonInstruction('MACROBUTTON')).toBeNull();
    expect(parseButtonInstruction('MACROBUTTON MyMacro')).toBeNull();
    expect(parseButtonInstruction('MACROBUTTON MyMacro   ')).toBeNull();
    expect(parseButtonInstruction('MACROBUTTON M \\* MERGEFORMAT')).toBeNull();
    expect(parseButtonInstruction('MACROBUTTON M ""')).toBeNull();
    expect(parseButtonInstruction('')).toBeNull();
  });

  test('an unclosed quoted argument swallows the rest and terminates', () => {
    expect(parseButtonInstruction('MACROBUTTON "unclosed rest of line')).toBeNull();
  });

  test('an unclosed quoted display runs to the end, quote dropped', () => {
    expect(parseButtonInstruction('MACROBUTTON M "unclosed')).toEqual({ display: 'unclosed' });
  });

  test('hostile over-cap input is rejected without a throw', () => {
    const blob = `MACROBUTTON M ${'A'.repeat(100 * 1024)}`;
    expect(parseButtonInstruction(blob)).toBeNull();
    expect(parseButtonInstruction('"'.repeat(MAX_BUTTON_INSTRUCTION_CHARS))).toBeNull();
  });

  test('display text stays within the instruction cap', () => {
    const atCap = `MACROBUTTON M ${'A'.repeat(MAX_BUTTON_INSTRUCTION_CHARS - 14)}`;
    expect(atCap.length).toBe(MAX_BUTTON_INSTRUCTION_CHARS);
    const spec = parseButtonInstruction(atCap);
    expect(spec).not.toBeNull();
    expect(spec!.display.length).toBeLessThanOrEqual(MAX_BUTTON_INSTRUCTION_CHARS);
    expect(parseButtonInstruction(`${atCap}A`)).toBeNull();
  });
});
