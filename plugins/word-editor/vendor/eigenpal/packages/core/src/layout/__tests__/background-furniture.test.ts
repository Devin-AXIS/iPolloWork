import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  openHeadlessDocument,
  readOoxmlPart,
  serializeOoxmlPart,
  type HeadlessDocumentView,
} from '@docx-editor.dev/core/store';
import { createDocumentFurnitureSource } from '../document-furniture-source.ts';
import { createDocumentLinkProjectors } from '../document-link-projector.ts';
import { createDocumentStyleDependencies } from '../document-style-deps.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createPageContentInsets } from '../page-furniture-insets.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const header =
  '<w:p><w:pPr><w:pStyle w:val="CustomHeader"/></w:pPr><w:r><w:t>Header</w:t></w:r></w:p>';

function fixture(background = true, content: string | undefined = header, title = false) {
  const main = `<w:document xmlns:w="${W}" xmlns:r="${R}">${background ? '<w:background w:color="FFFFFF"/>' : ''}<w:body><w:p/><w:sectPr>${content === undefined ? '' : '<w:headerReference w:type="default" r:id="header"/>'}<w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="0" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720"/>${title ? '<w:titlePg/>' : ''}</w:sectPr></w:body></w:document>`;
  const loaded = openHeadlessDocument(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="header" Type="${R}/header" Target="header.xml"/><Relationship Id="footer" Type="${R}/footer" Target="footer.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(main),
      'word/header.xml': strToU8(`<w:hdr xmlns:w="${W}">${content ?? '<w:p/>'}</w:hdr>`),
      'word/footer.xml': strToU8(
        `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>Footer</w:t></w:r></w:p></w:ftr>`
      ),
      'word/styles.xml': strToU8(
        `<w:styles xmlns:w="${W}"><w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="CustomHeader"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="140" w:after="100" w:line="400" w:lineRule="exact"/></w:pPr></w:style></w:styles>`
      ),
    })
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.view;
}

function source(view: HeadlessDocumentView) {
  return createDocumentFurnitureSource({
    view,
    measurer: createFixedMeasurer(6, 14),
    producer: 'background-test',
    cache: createParagraphLayoutCache(),
    ...createDocumentStyleDependencies(view),
    linkProjectors: createDocumentLinkProjectors(view),
    displayMode: 'proposed',
    inlineDrawingLayoutForPart(name) {
      if (!view.currentPackage().parts.has(name)) throw new Error('Synthetic resource lookup');
      return undefined;
    },
  });
}

test('background header reserve uses the document defaults, not the last header style', () => {
  const original = source(fixture(false)).furniture()!;
  const projected = source(fixture()).furniture()!;
  expect(original.headers.get('default')!.flowHeight).toBe(32);
  expect(projected.headers.get('default')!.flowHeight).toBe(44);
  expect(projected.headers.get('default')!.fragments).toEqual(
    original.headers.get('default')!.fragments
  );
  expect(projected.footers.get('default')!.flowHeight).toBe(
    original.footers.get('default')!.flowHeight
  );
});

test('a missing title-page header reserves the implicit styled paragraph and default tail', () => {
  const view = fixture(true, header, true);
  const furniture = source(view).furniture()!;
  const first = furniture.headers.get('first')!;
  expect(first.flowHeight).toBe(44);
  expect(first.fragments).toEqual([]);
  expect(first.part).toBeUndefined();
  const insets = createPageContentInsets({
    furniture,
    pageHeight: 792,
    marginTop: 0,
    marginBottom: 72,
    headerDistance: 36,
    footerDistance: 36,
    pageIndexStart: 0,
  });
  expect(insets(0).top).toBe(80);
  expect(
    source(fixture(false, header, true))
      .furniture()!
      .headers.has('first')
  ).toBe(false);
});

test('background-only documents create empty reserves without resource lookups', () => {
  const view = fixture(true, undefined);
  // Omit the authored header without removing its otherwise harmless package part.
  const parsed = readOoxmlPart(
    serializeOoxmlPart(view.part()).replace(/<w:headerReference[^>]*\/>/, ''),
    view.part()
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const furniture = source({
    ...view,
    part: () => parsed.part,
    headerFooterPartsBySection: () => [
      { headers: new Map(), footers: new Map(), titlePage: false, evenAndOddHeaders: false },
    ],
  }).furniture()!;
  expect(furniture.headers.get('default')!.flowHeight).toBe(44);
  expect(furniture.headers.get('default')!.fragments).toEqual([]);
  expect(furniture.footers.get('default')!.flowHeight).toBe(12);
});

test('projection preserves authored package nodes and memoizes unchanged stories', () => {
  const view = fixture();
  const before = [...view.currentPackage().parts].map(([name, part]) => [
    name,
    serializeOoxmlPart(part),
  ]);
  const projection = source(view);
  const a = projection.furniture()!.headers.get('default')!;
  const b = projection.furniture()!.headers.get('default')!;
  expect(a).toBe(b);
  expect(a.part).toBe(view.currentPackage().parts.get('/word/header.xml'));
  expect(a.fragments).toHaveLength(1);
  expect(
    [...view.currentPackage().parts].map(([name, part]) => [name, serializeOoxmlPart(part)])
  ).toEqual(before);
});

test('background toggles invalidate the reserve while reusing unchanged authored content', () => {
  const view = fixture();
  const parsed = readOoxmlPart(
    serializeOoxmlPart(view.part()).replace('<w:background w:color="FFFFFF"/>', ''),
    view.part()
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  let main = view.part();
  const projection = source({ ...view, part: () => main });
  const withBackground = projection.furniture()!.headers.get('default')!;
  main = parsed.part;
  const without = projection.furniture()!.headers.get('default')!;
  expect(without.flowHeight).toBe(32);
  expect(without.contentKey).not.toBe(withBackground.contentKey);
  main = view.part();
  expect(projection.furniture()!.headers.get('default')).toBe(withBackground);
});

test('a deleted terminal paragraph mark cannot merge authored content into the reserve', () => {
  const content = header.replace(
    '</w:pPr>',
    '<w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>'
  );
  const original = source(fixture(false, content)).furniture()!.headers.get('default')!;
  const projected = source(fixture(true, content)).furniture()!.headers.get('default')!;
  expect(projected.fragments).toEqual(original.fragments);
  expect(projected.flowHeight - original.flowHeight).toBe(12);
});

test('page-field projections retain reserves without publishing synthetic paragraph records', () => {
  const content = '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>';
  const projection = source(fixture(true, content));
  const baseline = projection.furniture()!.headers.get('default')!;
  const projected = baseline.withPageContext({ pageNumber: 3, pageCount: 9 });
  expect(projected.flowHeight).toBe(24);
  expect(projected.fragments).toHaveLength(1);
  expect(projected.part).toBe(baseline.part);
  expect(projected.rId).toBe('header');
  expect(
    projected.fragments
      .flatMap((block) =>
        block.kind === 'paragraph'
          ? block.lines.flatMap((line) => line.spans.map((span) => span.text))
          : []
      )
      .join('')
  ).toBe('3');
  expect(baseline.withPageContext({ pageNumber: 3, pageCount: 9 })).toBe(projected);
});
