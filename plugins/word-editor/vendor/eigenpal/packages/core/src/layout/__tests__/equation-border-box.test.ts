// `m:borderBox`: projection of its flags, the box geometry around the body, and the line
// height a shown edge claims.

import { describe, expect, test } from 'bun:test';
import {
  OFFICE_MATH_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type StyleSpanRecord } from '../semantic-records.ts';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}">` +
      `<w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);

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

const boxed = (properties: string) =>
  `<w:p><m:oMath><m:borderBox>${properties}<m:e><m:r><m:t>abc</m:t></m:r></m:e>` +
  '</m:borderBox></m:oMath></w:p>';

function boxOf(properties: string) {
  const span = equationSpan(boxed(properties));
  const geometry = span.equation?.geometry;
  if (geometry?.kind !== 'borderBox') throw new Error(`no box: ${geometry?.kind}`);
  return { span, geometry };
}

describe('m:borderBox', () => {
  test('a default box rules all four edges around the body, with a gap on each side', () => {
    const { span, geometry } = boxOf('');
    expect(span.equation?.fallbackText).toBe('abc');
    expect(geometry.rules).toHaveLength(4);
    expect(geometry.diagonals).toHaveLength(0);
    const em = 10;
    const rule = (133 / 2048) * em;
    const pad = (345 / 2048) * em + rule;
    expect(geometry.thickness).toBeCloseTo(rule, 6);
    expect(geometry.body.box.x).toBeCloseTo(pad, 6);
    expect(geometry.box.width).toBeCloseTo(geometry.body.box.width + 2 * pad, 6);
    const [top, bottom, left, right] = geometry.rules;
    expect(top!.y + top!.height).toBeLessThanOrEqual(geometry.body.box.y + geometry.body.baseline);
    expect(bottom!.y).toBeGreaterThan(top!.y);
    expect(left!.x).toBe(0);
    expect(right!.x + right!.width).toBeCloseTo(geometry.box.width, 6);
  });

  test('a hidden edge draws no rule and keeps no gap; ST_OnOff values decide', () => {
    const plain = boxOf('').geometry;
    const hidden = boxOf(
      '<m:borderBoxPr><m:hideTop/><m:hideBot m:val="0"/><m:hideLeft m:val="on"/>' +
        '<m:hideRight m:val="false"/></m:borderBoxPr>'
    ).geometry;
    expect(hidden.rules).toHaveLength(2);
    expect(hidden.body.box.x).toBe(0);
    expect(hidden.box.width).toBeLessThan(plain.box.width);
    const all = boxOf(
      '<m:borderBoxPr><m:hideTop/><m:hideBot/><m:hideLeft/><m:hideRight/></m:borderBoxPr>'
    ).geometry;
    expect(all.rules).toHaveLength(0);
    expect(all.box.width).toBe(all.body.box.width);
  });

  test('strikes cross the whole box; diagonals join its corners', () => {
    const { geometry } = boxOf(
      '<m:borderBoxPr><m:strikeH/><m:strikeV/><m:strikeBLTR/><m:strikeTLBR/></m:borderBoxPr>'
    );
    expect(geometry.rules).toHaveLength(6);
    const horizontal = geometry.rules[4]!;
    const vertical = geometry.rules[5]!;
    expect(horizontal.width).toBeCloseTo(geometry.box.width, 6);
    expect(vertical.x + vertical.width / 2).toBeCloseTo(geometry.box.width / 2, 6);
    expect(geometry.diagonals).toHaveLength(2);
    const [up, down] = geometry.diagonals;
    expect(up!.y1).toBeGreaterThan(up!.y2);
    expect(down!.y1).toBeLessThan(down!.y2);
    expect(up!.x2).toBeCloseTo(geometry.box.width, 6);
  });

  test('a shown top edge raises the line; an all-hidden box keeps the plain line', () => {
    const height = (body: string) => linesOf(layout(body))[0]!.box.height;
    const plain = height('<w:p><m:oMath><m:r><m:t>abc</m:t></m:r></m:oMath></w:p>');
    expect(height(boxed(''))).toBeGreaterThan(plain);
    expect(
      height(
        boxed('<m:borderBoxPr><m:hideTop/><m:hideBot/><m:hideLeft/><m:hideRight/></m:borderBoxPr>')
      )
    ).toBeCloseTo(plain, 6);
  });

  test('an unknown flag value keeps the fallback, and the source saves unchanged', () => {
    const span = equationSpan(boxed('<m:borderBoxPr><m:hideTop m:val="maybe"/></m:borderBoxPr>'));
    expect(span.equation?.geometry.kind).toBe('fallback');
    const part = load(boxed('<m:borderBoxPr><m:strikeH/></m:borderBoxPr>'));
    const reopened = readOoxmlPart(serializeOoxmlPart(part), {
      name: '/word/document.xml',
      contentType: 'app/xml',
    });
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(part));
  });
});
