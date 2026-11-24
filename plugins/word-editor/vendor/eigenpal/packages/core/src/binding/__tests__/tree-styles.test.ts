// Accepted OOXML properties -> CSS for the tree projection.
//
// Without this the projection rendered a formatted document as plain text: the properties
// travelled on the mark and nothing painted them. These tests exist because that defect is
// invisible to any test that only checks the model.

import { describe, expect, test } from 'bun:test';
import { paragraphPropsToCss, runPropsToCss } from '../tree-styles.ts';

const css = (localName: string, attributes?: Record<string, string>) =>
  runPropsToCss([attributes ? { localName, attributes } : { localName }]);

describe('run properties paint', () => {
  test('bold, italic and their explicit-off forms', () => {
    expect(css('b')).toBe('font-weight:bold');
    expect(css('i')).toBe('font-style:italic');
    // OOXML toggle semantics: `w:val="0"` is authored OFF, not absent.
    expect(css('b', { val: '0' })).toBe('font-weight:normal');
    expect(css('i', { val: 'false' })).toBe('font-style:normal');
  });

  test('underline carries its variant and colour', () => {
    expect(css('u')).toContain('text-decoration-line:underline');
    expect(css('u', { val: 'double' })).toContain('text-decoration-style:double');
    expect(css('u', { val: 'wave' })).toContain('text-decoration-style:wavy');
    expect(css('u', { val: 'dotted' })).toContain('text-decoration-style:dotted');
    expect(css('u', { val: 'single', color: 'C00000' })).toContain('text-decoration-color:#C00000');
    // `none` is an authored off and must paint nothing.
    expect(css('u', { val: 'none' })).toBe('');
  });

  test('strike and double strike both draw a line through', () => {
    expect(css('strike')).toContain('line-through');
    expect(css('dstrike')).toContain('line-through');
  });

  test('underline and strike combine into one decoration', () => {
    const combined = runPropsToCss([{ localName: 'u' }, { localName: 'strike' }]);
    expect(combined).toContain('text-decoration-line:underline line-through');
  });

  test('colour, highlight, size and font family', () => {
    expect(css('color', { val: '1F4E79' })).toBe('color:#1F4E79');
    expect(css('highlight', { val: 'yellow' })).toBe('background-color:#ffff00');
    // `w:sz` is HALF-points, so 36 is 18pt.
    expect(css('sz', { val: '36' })).toBe('font-size:18pt');
    expect(css('rFonts', { ascii: 'Courier New' })).toBe('font-family:"Courier New"');
  });

  test('caps, small caps and vertical alignment', () => {
    expect(css('caps')).toBe('text-transform:uppercase');
    expect(css('smallCaps')).toBe('font-variant:small-caps');
    expect(css('vertAlign', { val: 'superscript' })).toContain('vertical-align:super');
    expect(css('vertAlign', { val: 'subscript' })).toContain('vertical-align:sub');
  });

  test('a property with no faithful CSS paints nothing rather than guessing', () => {
    expect(css('kern', { val: '16' })).toBe('');
    expect(css('szCs', { val: '24' })).toBe('');
  });
});

describe('paragraph properties paint', () => {
  test('alignment', () => {
    expect(paragraphPropsToCss([{ localName: 'jc', attributes: { val: 'center' } }])).toBe(
      'text-align:center'
    );
    expect(paragraphPropsToCss([{ localName: 'jc', attributes: { val: 'both' } }])).toBe(
      'text-align:justify'
    );
  });

  test('indents in twips become points', () => {
    const style = paragraphPropsToCss([
      { localName: 'ind', attributes: { left: '720', firstLine: '360' } },
    ]);
    expect(style).toContain('margin-left:36pt');
    expect(style).toContain('text-indent:18pt');
  });

  test('a hanging indent is a negative first-line indent', () => {
    expect(paragraphPropsToCss([{ localName: 'ind', attributes: { hanging: '360' } }])).toContain(
      'text-indent:-18pt'
    );
  });

  test('spacing before/after and auto line spacing', () => {
    const style = paragraphPropsToCss([
      { localName: 'spacing', attributes: { before: '120', after: '240', line: '360' } },
    ]);
    expect(style).toContain('margin-top:6pt');
    expect(style).toContain('margin-bottom:12pt');
    // `w:line` in auto mode is 240ths of a line.
    expect(style).toContain('line-height:1.500');
  });

  test('shading and page-break-before', () => {
    expect(paragraphPropsToCss([{ localName: 'shd', attributes: { fill: 'F2F2F2' } }])).toBe(
      'background-color:#F2F2F2'
    );
    expect(paragraphPropsToCss([{ localName: 'pageBreakBefore' }])).toBe('break-before:page');
  });

  test('a property layout owns is not painted inline', () => {
    expect(paragraphPropsToCss([{ localName: 'pStyle', attributes: { val: 'Heading1' } }])).toBe(
      ''
    );
    expect(paragraphPropsToCss([{ localName: 'numPr' }])).toBe('');
  });
});

describe('file-derived values cannot inject CSS', () => {
  // Every value here reaches an inline `style`. A crafted attribute must not be able to
  // close the declaration and start its own.
  test('a colour that is not six hex digits is dropped', () => {
    expect(css('color', { val: 'red;background:url(x)' })).toBe('');
    expect(css('color', { val: '12345' })).toBe('');
    expect(css('shd', { fill: 'javascript:alert(1)' })).toBe('');
  });

  test('a font family containing quotes, semicolons or parens is refused', () => {
    expect(css('rFonts', { ascii: 'Arial";background:url(//evil)' })).toBe('');
    expect(css('rFonts', { ascii: 'x;color:red' })).toBe('');
    expect(css('rFonts', { ascii: 'url(evil)' })).toBe('');
    // A real font name still works.
    expect(css('rFonts', { ascii: 'Times New Roman' })).toBe('font-family:"Times New Roman"');
  });

  test('a non-numeric length is dropped', () => {
    expect(css('sz', { val: '36pt;color:red' })).toBe('');
    expect(paragraphPropsToCss([{ localName: 'ind', attributes: { left: 'expression(1)' } }])).toBe(
      ''
    );
  });

  test('an unknown underline variant falls back to a solid line', () => {
    expect(css('u', { val: 'not-a-variant' })).toContain('text-decoration-style:solid');
  });

  test('no output ever contains a declaration separator from a value', () => {
    const hostile = runPropsToCss([
      { localName: 'color', attributes: { val: 'a;b' } },
      { localName: 'rFonts', attributes: { ascii: 'a}b{' } },
      { localName: 'sz', attributes: { val: '1;2' } },
    ]);
    expect(hostile).toBe('');
  });
});
