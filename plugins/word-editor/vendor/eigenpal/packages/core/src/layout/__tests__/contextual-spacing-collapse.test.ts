// `w:contextualSpacing` drops a paragraph's space after when the next paragraph has the same
// style, but the next paragraph's space before still collapses against the dropped value.
// The next paragraph keeps only the part of its space before that exceeds that space after.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { paragraphFragmentsOf, type SemanticLayout } from '../semantic-records.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = WML_NAMESPACE_URI;
const measurer = createFixedMeasurer(6, 14);

function read(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const STYLES =
  `<w:styles xmlns:w="${W}">` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Other"><w:name w:val="Other"/></w:style></w:styles>`;
const cascade = buildStyleCascadeTable(read(STYLES, '/word/styles.xml').root);

/** Spacing in twips; 200 is 10pt, 280 is 14pt. */
const paragraph = (text: string, spacing: string, pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:spacing ${spacing}/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const CS = '<w:contextualSpacing/>';
const AFTER_10 = 'w:before="0" w:after="200"';

function layout(body: string, session?: ReturnType<typeof createLayoutSession>): SemanticLayout {
  const document = read(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    '/word/document.xml'
  );
  return layoutSemanticDocument(document, 1, {
    measurer,
    styleCascade: cascade,
    geometry: { width: 400, height: 600, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    ...(session ? { session } : {}),
  });
}

function tops(result: SemanticLayout): number[] {
  return paragraphFragmentsOf(result.pages[0]!).map((fragment) => fragment.lines[0]!.box.y);
}

/** Gap above the second paragraph's first line beyond one line pitch. */
function gap(body: string): number {
  const [first, second] = tops(layout(body));
  const [plainFirst, plainSecond] = tops(
    layout(paragraph('A', 'w:before="0" w:after="0"') + paragraph('B', 'w:before="0" w:after="0"'))
  );
  return second! - first! - (plainSecond! - plainFirst!);
}

describe('space before under a contextual space after', () => {
  test('keeps only the part of the space before past the dropped space after', () => {
    const second = (spacing: string, pPr = '') => paragraph('Bravo', spacing, pPr);
    const first = paragraph('Alpha', AFTER_10, CS);
    expect(gap(first + second('w:before="280" w:after="0"'))).toBeCloseTo(4, 5);
    expect(gap(first + second('w:before="120" w:after="0"'))).toBeCloseTo(0, 5);
    expect(gap(first + second('w:before="100" w:beforeAutospacing="1" w:after="0"'))).toBeCloseTo(
      4,
      5
    );
  });

  test('another style, no contextual spacing, or contextual spacing below keep the collapse', () => {
    const before14 = 'w:before="280" w:after="0"';
    const other = '<w:pStyle w:val="Other"/>';
    expect(gap(paragraph('Alpha', AFTER_10, CS) + paragraph('Bravo', before14, other))).toBe(14);
    expect(gap(paragraph('Alpha', AFTER_10) + paragraph('Bravo', before14))).toBe(14);
    expect(gap(paragraph('Alpha', AFTER_10) + paragraph('Bravo', before14, CS))).toBe(10);
    expect(gap(paragraph('Alpha', AFTER_10, CS) + paragraph('Bravo', before14, CS))).toBe(0);
  });

  test('an incremental pass agrees with a fresh layout as contextual spacing comes and goes', () => {
    const tail = paragraph('Bravo', 'w:before="280" w:after="0"') + paragraph('C', AFTER_10);
    const withCs = paragraph('Alpha', AFTER_10, CS) + tail;
    const without = paragraph('Alpha', AFTER_10) + tail;
    const session = createLayoutSession();
    for (const body of [withCs, without, withCs, withCs]) {
      expect(tops(layout(body, session))).toEqual(tops(layout(body)));
    }
  });
});
