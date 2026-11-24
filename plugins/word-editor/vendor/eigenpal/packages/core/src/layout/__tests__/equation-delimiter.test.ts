// `m:d`: projection of its characters and properties, the characters grown around the
// arguments, the space beside the structure, and the line height a grown character claims.

import { describe, expect, test } from 'bun:test';
import {
  OFFICE_MATH_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  canonicalOoxmlFingerprint,
  projectOmmlEquation,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { equationInk } from '../equation-ink.ts';
import type { EquationDelimiterGeometry } from '../equation-delimiter.ts';
import type { EquationGeometry } from '../equation-layout.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type StyleSpanRecord, type TextMeasurer } from '../semantic-records.ts';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}">` +
      `<w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const fixed = createFixedMeasurer(6, 14);
/**
 * Reports glyph ink: lowercase-height letters, taller digits, and delimiter characters that
 * reach from below the baseline to above the digits, near even about the math axis, as the
 * default math face draws them.
 */
const measurer: TextMeasurer = {
  ...fixed,
  textOutline: (text, style) => {
    const fence = /^[()[\]{}|;]$/u.test(text);
    return {
      path: null,
      ink: {
        left: 0,
        top: -style.fontSizePt * (fence ? 0.77 : /[0-9]/u.test(text) ? 0.7 : 0.48),
        right: fixed.measure(text, style),
        bottom: style.fontSizePt * (fence ? 0.23 : 0),
      },
    };
  },
};

function layout(body: string) {
  return layoutSemanticDocument(load(body), 1, { measurer });
}

function equationSpan(body: string): StyleSpanRecord {
  const span = linesOf(layout(body))
    .flatMap((line) => line.spans)
    .find((candidate) => candidate.equation);
  if (!span) throw new Error('missing equation span');
  return span;
}

const run = (text: string) => `<m:r><m:t>${text}</m:t></m:r>`;
const fraction = `<m:f><m:num>${run('a')}</m:num><m:den>${run('b')}</m:den></m:f>`;
const delimited = (properties: string, ...items: string[]) =>
  `<m:d>${properties}${items.map((item) => `<m:e>${item}</m:e>`).join('')}</m:d>`;
const paragraph = (math: string) => `<w:p><m:oMath>${math}</m:oMath></w:p>`;

function expressionOf(math: string) {
  const find = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'generic' && node.localName === 'oMath') return node;
    if (node.kind === 'textValue') return null;
    for (const child of node.children) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  const projection = projectOmmlEquation(find(load(paragraph(math)).root)!);
  if (!projection) throw new Error('missing equation');
  return projection;
}

function delimiterOf(math: string): EquationDelimiterGeometry {
  const find = (node: EquationGeometry): EquationDelimiterGeometry | null => {
    if (node.kind === 'delimiter') return node;
    if (node.kind === 'row') {
      for (const item of node.items) {
        const found = find(item);
        if (found) return found;
      }
    }
    return null;
  };
  const geometry = equationSpan(paragraph(math)).equation!.geometry;
  const found = find(geometry);
  if (!found) throw new Error(`no delimiter: ${geometry.kind}`);
  return found;
}

/** Heights above the delimiter baseline of the top and the bottom of a child's ink. */
function inkSpan(parent: EquationDelimiterGeometry, child: EquationGeometry) {
  const ink = equationInk(child, measurer);
  const baseline = parent.baseline - (child.box.y + child.baseline);
  return { top: baseline + ink.ascent, bottom: baseline - ink.descent };
}

/** The math axis of the default 10pt structure size. */
const AXIS = (585 / 2048) * 10;

describe('m:d', () => {
  test('without properties, parentheses and a bar separator stand around growing arguments', () => {
    const projection = expressionOf(delimited('', run('x'), run('y')));
    expect(projection.expression).toMatchObject({
      kind: 'delimiter',
      opening: '(',
      closing: ')',
      separator: '|',
      grow: true,
      shape: 'centered',
    });
    expect(projection.fallbackText).toBe('(x|y)');
    const geometry = delimiterOf(delimited('', run('x'), run('y')));
    expect(geometry.fences.map((fence) => fence.text)).toEqual(['(', '|', ')']);
    expect(geometry.items).toHaveLength(2);
    // Drawing order, left to right, with no gap.
    const order = [geometry.fences[0]!, geometry.items[0]!, geometry.fences[1]!];
    for (let index = 1; index < order.length; index++) {
      const previous = order[index - 1]!.box;
      expect(order[index]!.box.x).toBeCloseTo(previous.x + previous.width, 6);
    }
  });

  test('properties name the characters, the growth, and the shape; an empty character draws nothing', () => {
    const named = expressionOf(
      delimited(
        '<m:dPr><m:begChr m:val="["/><m:sepChr m:val=";"/><m:endChr m:val=""/>' +
          '<m:grow m:val="0"/><m:shp m:val="match"/></m:dPr>',
        run('x'),
        run('y')
      )
    );
    expect(named.expression).toMatchObject({
      kind: 'delimiter',
      opening: '[',
      closing: '',
      separator: ';',
      grow: false,
      shape: 'match',
    });
    expect(named.fallbackText).toBe('[x;y');
    expect(expressionOf(delimited('<m:dPr><m:grow/></m:dPr>', run('x'))).expression).toMatchObject({
      grow: true,
    });
    const geometry = delimiterOf(delimited('<m:dPr><m:endChr m:val=""/></m:dPr>', run('x')));
    expect(geometry.fences.map((fence) => fence.text)).toEqual(['(']);
  });

  test('an unsupported property keeps the fallback, which keeps the characters', () => {
    for (const properties of [
      '<m:dPr><m:begChr m:val="[["/></m:dPr>',
      '<m:dPr><m:shp m:val="tall"/></m:dPr>',
      '<m:dPr><m:grow m:val="maybe"/></m:dPr>',
    ]) {
      const span = equationSpan(paragraph(delimited(properties, run('x'))));
      expect(span.equation?.geometry.kind).toBe('fallback');
    }
    expect(
      expressionOf(delimited('<m:dPr><m:begChr m:val="[["/></m:dPr>', run('x'))).fallbackText
    ).toBe('[[x)');
    const part = load(paragraph(delimited('<m:dPr><m:begChr m:val="["/></m:dPr>', fraction)));
    const reopened = readOoxmlPart(serializeOoxmlPart(part), {
      name: '/word/document.xml',
      contentType: 'app/xml',
    });
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(part));
  });

  test('around a fraction, the characters grow over its ink, evenly about the math axis', () => {
    const geometry = delimiterOf(
      delimited('<m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr>', fraction)
    );
    const content = inkSpan(geometry, geometry.items[0]!);
    for (const fence of geometry.fences) {
      expect(fence.stretch?.scale).toBeGreaterThan(1);
      const drawn = inkSpan(geometry, fence);
      expect(drawn.top).toBeGreaterThanOrEqual(content.top - 1e-6);
      expect(drawn.bottom).toBeLessThanOrEqual(content.bottom + 1e-6);
      expect(drawn.top - AXIS).toBeCloseTo(AXIS - drawn.bottom, 6);
      // One side of the arguments meets the character exactly.
      expect(Math.min(drawn.top - content.top, content.bottom - drawn.bottom)).toBeCloseTo(0, 6);
    }
    expect(geometry.box.height).toBeGreaterThanOrEqual(
      inkSpan(geometry, geometry.fences[0]!).top - inkSpan(geometry, geometry.fences[0]!).bottom
    );
  });

  test('matched characters span exactly the ink of the arguments', () => {
    const geometry = delimiterOf(delimited('<m:dPr><m:shp m:val="match"/></m:dPr>', fraction));
    const content = inkSpan(geometry, geometry.items[0]!);
    for (const fence of geometry.fences) {
      const drawn = inkSpan(geometry, fence);
      expect(drawn.top).toBeCloseTo(content.top, 6);
      expect(drawn.bottom).toBeCloseTo(content.bottom, 6);
    }
  });

  test('characters keep their size around text, and when growth is off', () => {
    expect(delimiterOf(delimited('', run('x'))).fences.every((fence) => !fence.stretch)).toBe(true);
    const fixed = delimiterOf(delimited('<m:dPr><m:grow m:val="off"/></m:dPr>', fraction));
    expect(fixed.fences.every((fence) => !fence.stretch)).toBe(true);
  });

  test('only brackets, braces, and bars grow; any other character keeps its size', () => {
    const characters = (begin: string, end: string) =>
      `<m:dPr><m:begChr m:val="${begin}"/><m:endChr m:val="${end}"/></m:dPr>`;
    const growing = [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
      ['|', '‖'],
      ['∣', '∥'],
      ['⌈', '⌉'],
      ['⌊', '⌋'],
      ['⟦', '⟧'],
      ['⟨', '⟩'],
      ['⟪', '⟫'],
    ];
    for (const [begin, end] of growing) {
      const geometry = delimiterOf(delimited(characters(begin!, end!), fraction));
      expect(geometry.fences.map((fence) => [fence.text, (fence.stretch?.scale ?? 1) > 1])).toEqual(
        [
          [begin, true],
          [end, true],
        ]
      );
    }
    // Letters, operators, slashes, arrows, and box-drawing or CJK brackets draw as text.
    const fixedSize = [
      ['a', '−'],
      ['_', '.'],
      ['/', '\\'],
      ['&lt;', '&gt;'],
      ['〈', '〉'],
      ['↑', '→'],
      ['│', '∫'],
    ];
    for (const [begin, end] of fixedSize) {
      const geometry = delimiterOf(delimited(characters(begin!, end!), fraction));
      expect(geometry.fences).toHaveLength(2);
      expect(geometry.fences.every((fence) => fence.stretch === undefined)).toBe(true);
    }
    // A separator follows the same rule: a bar grows, a semicolon does not.
    const separated = delimiterOf(
      delimited('<m:dPr><m:sepChr m:val=";"/></m:dPr>', fraction, fraction)
    );
    expect(separated.fences.map((fence) => fence.stretch !== undefined)).toEqual([
      true,
      false,
      true,
    ]);
  });

  test('a character that keeps its size claims only its own line height', () => {
    const lineOf = (body: string) => linesOf(layout(body))[0]!.box.height;
    const fixed = delimited('<m:dPr><m:begChr m:val="a"/><m:endChr m:val="/"/></m:dPr>', fraction);
    expect(lineOf(paragraph(fixed))).toBeCloseTo(lineOf(paragraph(`${run('a')}${fraction}`)), 6);
  });

  test('the structure opens and closes like its characters do in text', () => {
    const geometry = equationSpan(paragraph(`${run('2')}${delimited('', run('x'))}${run('+1')}`))
      .equation!.geometry;
    if (geometry.kind !== 'row') throw new Error(`no row: ${geometry.kind}`);
    const [two, delimiter, plus] = geometry.items;
    expect(delimiter!.kind).toBe('delimiter');
    // No space after an ordinary atom, a medium space before a binary operator.
    expect(delimiter!.box.x).toBeCloseTo(two!.box.x + two!.box.width, 6);
    expect(plus!.box.x - (delimiter!.box.x + delimiter!.box.width)).toBeCloseTo((4 / 18) * 10, 6);
  });

  test('a grown character raises the line to its ink and the math leading', () => {
    const math = delimited('<m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr>', fraction);
    const geometry = equationSpan(paragraph(math)).equation!.geometry;
    const delimiter = delimiterOf(math);
    const top = Math.max(...delimiter.fences.map((fence) => inkSpan(delimiter, fence).top));
    expect(geometry.baseline).toBeCloseTo(top + (300 / 2048) * 10, 6);
    const lineOf = (body: string) => linesOf(layout(body))[0]!.box.height;
    expect(lineOf(paragraph(math))).toBeGreaterThan(lineOf(paragraph(fraction)));
  });
});
