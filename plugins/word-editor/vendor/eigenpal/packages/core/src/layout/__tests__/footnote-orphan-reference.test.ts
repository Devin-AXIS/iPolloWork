import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import type { PageRecord } from '../semantic-records.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const run = (text: string) => `<w:r><w:rPr><w:sz w:val="22"/></w:rPr>${text}</w:r>`;
const p = (text: string, props = '') =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/><w:rPr><w:sz w:val="22"/></w:rPr>${props}</w:pPr>${run(text)}</w:p>`;
function fixture(prop = '', height = 115, lines = 4) {
  const body =
    Array.from({ length: 4 }, (_, i) => p(`<w:t>Filler${i}</w:t>`)).join('') +
    p('<w:t>Earlier</w:t><w:footnoteReference w:id="1"/>') +
    p(
      [
        '<w:t>First</w:t>',
        '<w:t>Second</w:t><w:footnoteReference w:id="2"/>',
        '<w:t>Third</w:t>',
        '<w:t>Fourth</w:t><w:footnoteReference w:id="3"/>',
      ]
        .slice(0, lines)
        .join('<w:br/>'),
      prop
    );
  const entries = {
    '[Content_Types].xml': `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`,
    'word/document.xml': `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="4000" w:h="${height * 20}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/></w:sectPr></w:body></w:document>`,
    'word/footnotes.xml': `<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1">${p('<w:separator/>')}</w:footnote><w:footnote w:type="continuationSeparator" w:id="0">${p('<w:continuationSeparator/>')}</w:footnote>${[1, 2, 3].map((id) => `<w:footnote w:id="${id}">${p(`<w:t>Note${id}</w:t>`)}</w:footnote>`).join('')}</w:footnotes>`,
  };
  const bytes = zipSync(
    Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)]))
  );
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const fn = resolveFootnoteProperties(undefined, undefined),
    en = resolveEndnoteProperties(undefined, undefined);
  const measurer = createFixedMeasurer(5, 12);
  const session = createLayoutSession();
  const options = {
    measurer,
    session,
    notes: {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      documentFootnoteProps: fn,
      footnotePropsBySection: [fn],
      documentEndnoteProps: en,
      endnotePropsBySection: [en],
      measurer,
      producer: 'footnote-orphan-test',
    },
  };
  return { part, options };
}
const pageLines = (page: PageRecord) =>
  page.fragments.flatMap((fragment) =>
    fragment.kind === 'paragraph'
      ? fragment.lines.map((line) =>
          line.spans
            .map((span) => span.text)
            .join('')
            .trim()
        )
      : []
  );
const noteIds = (page: PageRecord) => page.footnotes?.notes.map((note) => note.noteId);

describe('footnote reference orphan pairs', () => {
  test('keeps an opening pair while its whole second-line note continues', () => {
    const { part, options } = fixture();
    const source = JSON.stringify(part);
    const layout = layoutSemanticDocument(part, 0, options);
    expect(layout.pages).toHaveLength(2);
    expect(pageLines(layout.pages[0]!)).toEqual([
      'Filler0',
      'Filler1',
      'Filler2',
      'Filler3',
      'Earlier1',
      'First',
      'Second2',
    ]);
    expect(pageLines(layout.pages[1]!)).toEqual(['Third', 'Fourth3']);
    expect(noteIds(layout.pages[0]!)).toEqual([1]);
    expect(noteIds(layout.pages[1]!)).toEqual([2, 3]);
    expect(layout.pages[1]!.footnotes?.separator?.kind).toBe('continuationSeparator');
    for (let pass = 0; pass < 3; pass++) {
      expect(layoutSemanticDocument(part, 0, options).pages).toEqual(layout.pages);
    }
    expect(layoutSemanticDocument(part, 0, { ...options, session: undefined }).pages).toEqual(
      layout.pages
    );
    expect(JSON.stringify(part)).toBe(source);
    expect(
      layoutSemanticDocument(part, 0, { ...options, session: createLayoutSession() }).pages
    ).toEqual(layout.pages);
  });
  test('explicit widowControl false keeps the reference with its note', () => {
    const { part, options } = fixture('<w:widowControl w:val="0"/>');
    const layout = layoutSemanticDocument(part, 0, options);
    expect(pageLines(layout.pages[0]!).slice(-1)).toEqual(['First']);
    expect(pageLines(layout.pages[1]!)).toEqual(['Second2', 'Third', 'Fourth3']);
    expect(noteIds(layout.pages[1]!)).toEqual([2, 3]);
    expect(layout.pages[1]!.footnotes?.separator?.kind).toBe('separator');
  });
  test('keepLines moves the whole paragraph instead of deferring its note', () => {
    const { part, options } = fixture('<w:keepLines/>');
    const layout = layoutSemanticDocument(part, 0, options);
    expect(pageLines(layout.pages[0]!).slice(-1)).toEqual(['Earlier1']);
    expect(pageLines(layout.pages[1]!)).toEqual(['First', 'Second2', 'Third', 'Fourth3']);
    expect(layout.pages[1]!.footnotes?.separator?.kind).toBe('separator');
  });
  test('keeps a fitting note on the same page', () => {
    const { part, options } = fixture('', 121);
    const layout = layoutSemanticDocument(part, 0, options);
    expect(pageLines(layout.pages[0]!).slice(-2)).toEqual(['First', 'Second2']);
    expect(noteIds(layout.pages[0]!)).toEqual([1, 2]);
    expect(noteIds(layout.pages[1]!)).toEqual([3]);
  });
  for (const lines of [2, 3])
    test(`does not split a ${lines}-line paragraph into an orphan or widow`, () => {
      const { part, options } = fixture('', 115, lines);
      const layout = layoutSemanticDocument(part, 0, options);
      expect(pageLines(layout.pages[0]!).slice(-1)).toEqual(['Earlier1']);
      expect(pageLines(layout.pages[1]!).slice(0, 2)).toEqual(['First', 'Second2']);
      expect(layout.pages[1]!.footnotes?.separator?.kind).toBe('separator');
    });
});
