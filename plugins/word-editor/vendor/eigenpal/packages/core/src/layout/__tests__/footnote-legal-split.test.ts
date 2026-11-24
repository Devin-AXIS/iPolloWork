import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { PageRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(xml: string, name: string) {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const paragraph = (text: string, props = '') =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>${props}</w:pPr><w:r>${text}</w:r></w:p>`;
function fixture(
  reference: number,
  widow: boolean,
  keep: boolean | 'next' = false,
  noteCount = 6,
  stacked = false,
  bodyProps = ''
) {
  const body = Array.from({ length: reference }, (_, index) =>
    paragraph(
      `<w:t>Body ${index + 1}</w:t>${index + 1 === reference ? '<w:footnoteReference w:id="1"/>' : stacked && index === 9 ? '<w:footnoteReference w:id="2"/>' : ''}`,
      bodyProps
    )
  ).join('');
  const document = part(
    `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`,
    '/word/document.xml'
  );
  const note = paragraph(
    Array.from(
      { length: noteCount },
      (_, i) => `${i ? '<w:br/>' : ''}<w:t>Note ${i + 1}</w:t>`
    ).join(''),
    `<w:widowControl w:val="${widow ? 1 : 0}"/>${keep === 'next' ? '<w:keepNext/>' : keep ? '<w:keepLines/>' : ''}`
  );
  const footnotesPart = part(
    `<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1">${paragraph('<w:separator/>')}</w:footnote><w:footnote w:type="continuationSeparator" w:id="0">${paragraph('<w:continuationSeparator/>')}</w:footnote><w:footnote w:id="1">${note}${keep === 'next' ? paragraph('<w:t>Kept successor</w:t>') : ''}</w:footnote>${stacked ? `<w:footnote w:id="2">${paragraph('<w:t>Earlier note</w:t><w:br/><w:t>Earlier tail</w:t>')}</w:footnote>` : ''}</w:footnotes>`,
    '/word/footnotes.xml'
  );
  const fn = resolveFootnoteProperties(undefined, undefined);
  const en = resolveEndnoteProperties(undefined, undefined);
  const measurer = createFixedMeasurer(5, 12);
  const options = {
    measurer,
    compatibilityMode: 15,
    session: createLayoutSession(),
    notes: {
      compatibilityMode: 15,
      footnotesPart,
      endnotesPart: null,
      documentFootnoteProps: fn,
      footnotePropsBySection: [fn],
      documentEndnoteProps: en,
      endnotePropsBySection: [en],
      measurer,
      producer: 'legal-note-split',
    },
  };
  return { document, options };
}
function counts(page: PageRecord) {
  return {
    body: page.fragments.reduce((n, f) => n + (f.kind === 'paragraph' ? f.lines.length : 0), 0),
    notes:
      page.footnotes?.notes.reduce(
        (n, note) =>
          n + note.fragments.reduce((n, f) => n + (f.kind === 'paragraph' ? f.lines.length : 0), 0),
        0
      ) ?? 0,
  };
}
describe('legal footnote opening admission', () => {
  // The admission does not depend on the compatibility mode: every mode places the same note
  // lines on the first page.
  for (const mode of [undefined, 11, 12, 14, 15, 16]) {
    for (const [reference, widow, keep, head] of [
      [49, true, false, 4],
      [49, true, true, 0],
      [52, false, false, 1],
      [52, true, false, 0],
    ] as const) {
      test(`mode ${mode}, reference ${reference}, widow ${widow}, keep ${keep}`, () => {
        const { document, options } = fixture(reference, widow, keep);
        const configured = {
          ...options,
          compatibilityMode: mode,
          notes: { ...options.notes, compatibilityMode: mode },
        };
        const layout = layoutSemanticDocument(document, 0, configured);
        expect(counts(layout.pages[0]!).notes).toBe(head);
        expect(layout.pages.reduce((n, p) => n + counts(p).notes, 0)).toBe(6);
      });
    }
  }
  for (const mode of [14, 15]) {
    for (const indent of [
      '<w:ind w:left="720"/>',
      '<w:ind w:right="720"/>',
      '<w:ind w:left="720" w:hanging="360"/>',
      '<w:ind w:left="1440" w:right="1440"/>',
    ]) {
      test(`mode ${mode}: indented body text admits the same split opening, ${indent}`, () => {
        const { document, options } = fixture(49, true, false, 6, false, indent);
        const configured = {
          ...options,
          compatibilityMode: mode,
          notes: { ...options.notes, compatibilityMode: mode },
        };
        const layout = layoutSemanticDocument(document, 0, configured);
        expect(counts(layout.pages[0]!)).toEqual({ body: 49, notes: 4 });
        expect(layout.pages.reduce((n, p) => n + counts(p).notes, 0)).toBe(6);
      });
    }
  }
  test('an oversized kept note still drains on fresh pages', () => {
    const { document, options } = fixture(1, true, true, 70);
    const layout = layoutSemanticDocument(document, 0, options);
    expect(layout.pages.length).toBeLessThanOrEqual(3);
    expect(layout.pages.reduce((n, p) => n + counts(p).notes, 0)).toBe(70);
    expect(counts(layout.pages[1]!).notes).toBeGreaterThan(0);
  });
  test('keeps unsupported note keepNext boundaries under whole-note admission', () => {
    const { document, options } = fixture(49, true, 'next');
    const layout = layoutSemanticDocument(document, 0, options);
    expect(counts(layout.pages[0]!).notes).toBe(0);
    expect(counts(layout.pages[1]!).notes).toBe(7);
  });
  test('an earlier note consumes room before a later split note', () => {
    const { document, options } = fixture(49, true, false, 6, true);
    const layout = layoutSemanticDocument(document, 0, options);
    expect(
      layout.pages[0]!.footnotes?.notes.map((n) => [
        n.noteId,
        n.fragments.flatMap((f) => (f.kind === 'paragraph' ? f.lines : [])).length,
      ])
    ).toEqual([
      [2, 2],
      [1, 2],
    ]);
    expect(counts(layout.pages[1]!).notes).toBe(4);
    expect(
      layoutSemanticDocument(document, 0, { ...options, session: createLayoutSession() }).pages
    ).toEqual(layout.pages);
  });
  test('a warm split release preserves an earlier note stack', () => {
    const initial = fixture(49, true, true, 6, true);
    layoutSemanticDocument(initial.document, 0, initial.options);
    const options = { ...initial.options, notes: fixture(49, true, false, 6, true).options.notes };
    const warm = layoutSemanticDocument(initial.document, 1, options);
    const cold = layoutSemanticDocument(initial.document, 1, {
      ...options,
      session: createLayoutSession(),
    });
    expect(warm.pages).toEqual(cold.pages);
    expect(warm.pages[0]!.footnotes?.notes.map((note) => note.noteId)).toEqual([2, 1]);
    expect(counts(warm.pages[0]!).notes).toBe(4);
  });
  test('reference edits and note growth retain cold geometry', () => {
    const initial = fixture(49, true);
    layoutSemanticDocument(initial.document, 0, initial.options);
    for (const [reference, lines] of [
      [51, 8],
      [49, 3],
      [52, 6],
    ]) {
      const changed = fixture(reference!, false, false, lines);
      const options = { ...changed.options, session: initial.options.session };
      const warm = layoutSemanticDocument(changed.document, reference!, options);
      const cold = layoutSemanticDocument(changed.document, reference!, {
        ...options,
        session: createLayoutSession(),
      });
      expect(warm.pages).toEqual(cold.pages);
      expect(warm.pages.reduce((n, p) => n + counts(p).notes, 0)).toBe(lines!);
    }
  });
  test('indented reference edits retain cold geometry', () => {
    const indent = '<w:ind w:left="720" w:hanging="360"/>';
    const initial = fixture(49, true, false, 6, false, indent);
    layoutSemanticDocument(initial.document, 0, initial.options);
    for (const [reference, lines] of [
      [51, 8],
      [49, 3],
      [52, 6],
      [49, 6],
    ]) {
      const changed = fixture(reference!, true, false, lines, false, indent);
      const options = { ...changed.options, session: initial.options.session };
      const warm = layoutSemanticDocument(changed.document, reference!, options);
      const cold = layoutSemanticDocument(changed.document, reference!, {
        ...options,
        session: createLayoutSession(),
      });
      expect(warm.pages).toEqual(cold.pages);
      expect(warm.pages.reduce((n, p) => n + counts(p).notes, 0)).toBe(lines!);
    }
  });
  test('widow changes release a legal one-line opening', () => {
    const initial = fixture(52, true);
    layoutSemanticDocument(initial.document, 0, initial.options);
    const options = { ...initial.options, notes: fixture(52, false).options.notes };
    const warm = layoutSemanticDocument(initial.document, 1, options);
    expect(counts(warm.pages[0]!).notes).toBe(1);
    expect(warm.pages).toEqual(
      layoutSemanticDocument(initial.document, 1, { ...options, session: createLayoutSession() })
        .pages
    );
  });
  test('note keep changes release an earlier whole-note placement', () => {
    const { document, options } = fixture(49, true, true);
    expect(counts(layoutSemanticDocument(document, 0, options).pages[0]!).notes).toBe(0);
    const changed = { ...options, notes: fixture(49, true).options.notes };
    const warm = layoutSemanticDocument(document, 1, changed);
    const cold = layoutSemanticDocument(document, 1, {
      ...changed,
      session: createLayoutSession(),
    });
    expect(warm.pages).toEqual(cold.pages);
    expect(counts(warm.pages[0]!).notes).toBe(4);
  });

  for (const [reference, widow, keep, firstNotes] of [
    [49, false, false, 4],
    [49, true, false, 4],
    [49, true, true, 0],
    [51, false, false, 2],
    [51, true, false, 2],
    [52, false, false, 1],
    [52, true, false, 0],
  ] as const) {
    test(`reference ${reference}, widow ${widow}, keep ${keep}`, () => {
      const { document, options } = fixture(reference, widow, keep);
      const before = JSON.stringify(document);
      const layout = layoutSemanticDocument(document, 0, options);
      expect(layout.pages).toHaveLength(2);
      expect(counts(layout.pages[0]!)).toEqual({
        body: reference - (firstNotes ? 0 : 1),
        notes: firstNotes,
      });
      expect(counts(layout.pages[1]!)).toEqual({ body: firstNotes ? 0 : 1, notes: 6 - firstNotes });
      expect(layout.pages[1]!.footnotes?.separator?.kind).toBe(
        firstNotes ? 'continuationSeparator' : 'separator'
      );
      expect(layoutSemanticDocument(document, 0, options).pages).toEqual(layout.pages);
      expect(
        layoutSemanticDocument(document, 0, { ...options, session: createLayoutSession() }).pages
      ).toEqual(layout.pages);
      expect(JSON.stringify(document)).toBe(before);
    });
  }
});
