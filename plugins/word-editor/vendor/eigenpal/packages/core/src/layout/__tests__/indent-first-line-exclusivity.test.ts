// `w:hanging` and `w:firstLine` are one value with two spellings.
//
// ECMA-376 §17.3.1.10 and §17.3.1.12 make them mutually exclusive, which matters at the CASCADE:
// a style that hangs and a paragraph that cancels the hang must not both apply. Accumulated
// independently, a paragraph carrying `w:ind w:left="0" w:firstLine="0"` kept its style's
// `w:hanging="720"`, and the first line of every body paragraph hung out into the left margin
// while the rest of the paragraph sat where it belonged.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function part(name: string, xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** A style that hangs, so a paragraph can be seen to cancel it. */
const STYLES = part(
  '/word/styles.xml',
  `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="BodyText">` +
    '<w:name w:val="Body Text"/><w:pPr><w:ind w:left="1440" w:hanging="720"/></w:pPr>' +
    '</w:style></w:styles>'
);

function firstLineOffsets(paragraphProperties: string): { first: number; rest: number } {
  const body = part(
    '/word/document.xml',
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:pStyle w:val="BodyText"/>` +
      `${paragraphProperties}</w:pPr>` +
      `<w:r><w:t>${'word '.repeat(40)}</w:t></w:r></w:p></w:body></w:document>`
  );
  const layout = layoutSemanticDocument(body, 1, {
    measurer,
    styleCascade: buildStyleCascadeTable(STYLES.root),
  });
  const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
  expect(fragment.lines.length).toBeGreaterThan(1);
  return {
    first: fragment.lines[0]!.spans[0]!.box.x,
    rest: fragment.lines[1]!.spans[0]!.box.x,
  };
}

describe('a direct w:ind replaces the style s first-line offset, not just part of it', () => {
  test('w:firstLine="0" cancels an inherited w:hanging', () => {
    // The reported symptom: the first line overflowed to the LEFT of the paragraph.
    const { first, rest } = firstLineOffsets('<w:ind w:left="0" w:firstLine="0"/>');
    expect(first).toBe(rest);
  });

  test('the style s hang still applies when the paragraph says nothing', () => {
    // Guards the fix from becoming "ignore hanging": inheritance must still work.
    const { first, rest } = firstLineOffsets('');
    expect(first).toBeLessThan(rest);
  });

  test('a bare w:left leaves the inherited offset alone', () => {
    // `w:ind` stating NEITHER attribute is not a statement about the first line.
    const { first, rest } = firstLineOffsets('<w:ind w:left="720"/>');
    expect(first).toBeLessThan(rest);
  });

  test('a direct w:hanging replaces an inherited one rather than adding to it', () => {
    const { first, rest } = firstLineOffsets('<w:ind w:left="1440" w:hanging="360"/>');
    expect(rest - first).toBeCloseTo(18, 5);
  });

  test('a direct w:firstLine indents the first line past the rest', () => {
    const { first, rest } = firstLineOffsets('<w:ind w:left="0" w:firstLine="720"/>');
    expect(first).toBeGreaterThan(rest);
  });
});
