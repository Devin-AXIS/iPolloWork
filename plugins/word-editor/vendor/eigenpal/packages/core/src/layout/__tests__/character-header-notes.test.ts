import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { createLayoutSession, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-records.ts';
import type { SemanticLayoutOptions } from '../semantic-layout-options.ts';
import { noteBodyGeometryChanged } from '../note-body-geometry.ts';
import { noticeFixture } from './note-continuation-fixture.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function read(xml: string, name: string) {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const paragraph = (runs: string) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>${runs}</w:p>`;
function fixture(count: number, notice: string | null = 'Continue', titleWords = 45) {
  const note = noticeFixture(notice);
  const styleCascade = buildStyleCascadeTable(
    read(
      `<w:styles xmlns:w="${W}"><w:style w:type="character" w:styleId="Heading"><w:name w:val="Header Source"/></w:style></w:styles>`,
      '/word/styles.xml'
    ).root
  );
  const title = paragraph(
    `<w:r><w:rPr><w:rStyle w:val="Heading"/></w:rPr><w:t>${'Long '.repeat(titleWords)}</w:t></w:r>`
  );
  const body =
    title +
    Array.from({ length: count }, (_, i) => paragraph(`<w:r><w:t>Body ${i}</w:t></w:r>`)).join('') +
    paragraph(
      '<w:r><w:t>Reference</w:t><w:footnoteReference w:id="2"/><w:br/><w:t>Companion</w:t><w:br/><w:t>Following</w:t><w:br/><w:t>Last</w:t></w:r>'
    );
  const document = read(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    '/word/document.xml'
  );
  const header = read(
    `<w:hdr xmlns:w="${W}">${paragraph('<w:fldSimple w:instr=" STYLEREF &quot;Header Source&quot; "><w:r><w:t>cached</w:t></w:r></w:fldSimple>')}</w:hdr>`,
    '/word/header1.xml'
  );
  const story = layoutHeaderFooterStory(
    header,
    468,
    note.options.measurer,
    'header-notes',
    undefined,
    styleCascade
  );
  const options: SemanticLayoutOptions = {
    ...note.options,
    styleCascade,
    geometry: {
      width: 612,
      height: 792,
      margin: { top: 72, bottom: 72, left: 72, right: 72 },
      headerDistance: 60,
    },
    furniture: {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([['default', story]]),
      footers: new Map(),
    },
  };
  return { document, options };
}
function geometry(layout: SemanticLayout) {
  return layout.pages.map((page) => ({
    box: page.box,
    contentBox: page.contentBox,
    fragments: page.fragments,
    footnotes: page.footnotes,
  }));
}
function noteLines(layout: SemanticLayout) {
  return layout.pages.map(
    (page) =>
      page.footnotes?.notes.flatMap((note) =>
        note.fragments.flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
      ).length ?? 0
  );
}

test('live header growth restarts note admission with the effective body box', () => {
  const { document, options } = fixture(42);
  const cold = layoutSemanticDocument(document, 1, { ...options, session: undefined });
  const first = layoutSemanticDocument(document, 1, options);
  const noteMemo = options.session!.notes;
  const warm = layoutSemanticDocument(document, 1, options);
  expect(options.session!.notes === noteMemo).toBe(true);
  expect(first.pages[0]!.contentBox.y).toBe(96);
  expect(noteLines(first)).toEqual([3, 3]);
  expect(first.pages[0]!.footnotes?.continuationNotice).toBeDefined();
  expect(geometry(first)).toEqual(geometry(cold));
  expect(geometry(warm)).toEqual(geometry(cold));
  expect(warm.pages[0]!.fragments === first.pages[0]!.fragments).toBe(true);
  expect(warm.pages[1]!.fragments === first.pages[1]!.fragments).toBe(true);
});

for (const notice of ['Continue', '', null]) {
  test(`changed header distance reconsiders notes with notice ${JSON.stringify(notice)}`, () => {
    const { document, options } = fixture(38, notice);
    layoutSemanticDocument(document, 1, options);
    for (const headerDistance of [120, 60, 120]) {
      const changed = { ...options, geometry: { ...options.geometry!, headerDistance } };
      const warm = layoutSemanticDocument(document, 1, changed);
      const cold = layoutSemanticDocument(document, 1, {
        ...changed,
        session: createLayoutSession(),
      });
      const unseeded = layoutSemanticDocument(document, 1, { ...changed, session: undefined });
      expect(geometry(warm)).toEqual(geometry(cold));
      expect(geometry(warm)).toEqual(geometry(unseeded));
      expect(noteLines(warm).reduce((sum, count) => sum + count, 0)).toBe(6);
      const repeated = layoutSemanticDocument(document, 1, changed);
      expect(repeated.pages[0]!.fragments === warm.pages[0]!.fragments).toBe(true);
    }
  });
}

for (const liveHeader of [false, true]) {
  test(`note edits retain warm geometry with live header ${liveHeader}`, () => {
    const { document, options } = fixture(42);
    const furniture = liveHeader ? options.furniture : undefined;
    for (const count of [6, 10, 2, 6]) {
      const footnotesPart = noticeFixture('Continue', 12, false, count).options.notes.footnotesPart;
      const changed = { ...options, furniture, notes: { ...options.notes!, footnotesPart } };
      const warm = layoutSemanticDocument(document, 1, changed);
      const cold = layoutSemanticDocument(document, 1, {
        ...changed,
        session: createLayoutSession(),
      });
      expect(geometry(warm)).toEqual(geometry(cold));
      expect(noteLines(warm).reduce((sum, lines) => sum + lines, 0)).toBe(count);
      const memo = options.session!.notes;
      const repeat = layoutSemanticDocument(document, 1, changed);
      expect(options.session!.notes === memo).toBe(true);
      expect(repeat.pages[0]!.fragments === warm.pages[0]!.fragments).toBe(true);
    }
  });
}

test('note geometry ignores page count and whole-page translation', () => {
  const { document, options } = fixture(42);
  const layout = layoutSemanticDocument(document, 1, { ...options, session: undefined });
  const session = {};
  expect(noteBodyGeometryChanged(session, layout, document)).toBe(false);
  const shifted = layout.pages.map((page) => ({
    ...page,
    box: { ...page.box, x: page.box.x + 40, y: page.box.y + 80 },
    contentBox: { ...page.contentBox, x: page.contentBox.x + 40, y: page.contentBox.y + 80 },
  }));
  expect(noteBodyGeometryChanged(session, { ...layout, pages: shifted }, document)).toBe(false);
  expect(
    noteBodyGeometryChanged(session, { ...layout, pages: shifted.slice(0, 1) }, document)
  ).toBe(false);
  expect(noteBodyGeometryChanged(session, { ...layout, pages: shifted }, document)).toBe(false);
  expect(
    noteBodyGeometryChanged(
      session,
      {
        ...layout,
        pages: shifted.map((page) => ({
          ...page,
          contentBox: {
            ...page.contentBox,
            y: page.contentBox.y + 12,
            height: page.contentBox.height - 12,
          },
        })),
      },
      document
    )
  ).toBe(true);
});

test('body edits that change live header height retain cold geometry', () => {
  const { document, options } = fixture(42);
  layoutSemanticDocument(document, 1, options);
  let revision = 1;
  for (const titleWords of [65, 15, 45]) {
    const edited = fixture(42, 'Continue', titleWords).document;
    revision += 1;
    const warm = layoutSemanticDocument(edited, revision, options);
    const cold = layoutSemanticDocument(edited, revision, { ...options, session: undefined });
    expect(geometry(warm)).toEqual(geometry(cold));
    expect(noteLines(warm).reduce((sum, lines) => sum + lines, 0)).toBe(6);
    const repeat = layoutSemanticDocument(edited, revision, options);
    expect(geometry(repeat)).toEqual(geometry(cold));
    expect(repeat.pages[0]!.fragments === warm.pages[0]!.fragments).toBe(true);
  }
});

test('a replacement body part keeps the existing edit reserve policy', () => {
  const { document, options } = fixture(42);
  const layout = layoutSemanticDocument(document, 1, { ...options, session: undefined });
  const session = {};
  expect(noteBodyGeometryChanged(session, layout, document)).toBe(false);
  const changed = {
    ...layout,
    pages: layout.pages.map((page) => ({
      ...page,
      contentBox: { ...page.contentBox, height: page.contentBox.height + 0.5 },
    })),
  };
  const replacement = fixture(43).document;
  expect(noteBodyGeometryChanged(session, changed, replacement)).toBe(false);
  expect(noteBodyGeometryChanged(session, layout, replacement)).toBe(true);
});
