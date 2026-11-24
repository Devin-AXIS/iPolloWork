// SECTIONPAGES / pgNumType layout projection and security inertness.
import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  createFixedMeasurer,
  enumerateDocumentSections,
  geometryOfSection,
  layoutSemanticDocument,
  type PageFurniture,
} from '../index.ts';
import {
  allowlistedPageField,
  detectStoryPageFields,
  normalizeFieldInstruction,
  piecesOfParagraph,
  projectPageFieldValue,
} from '../field-projection.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import {
  readOoxmlPackage,
  resolveHeaderFooterPartsBySection,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const measurer = createFixedMeasurer(6, 14);

function parsePart(xml: string): OoxmlPart {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${xml}<w:sectPr/></w:body></w:document>`
    ),
  };
  const loaded = readOoxmlPackage(zipSync(entries));
  if (!loaded.ok) throw new Error('load failed');
  return loaded.package.parts.get(loaded.package.mainDocumentPart)!;
}

function footerDoc(
  footerBody: string,
  body = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>'
): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/footer" Target="footer1.xml"/></Relationships>`
    ),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${footerBody}</w:ftr>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
        `<w:sectPr><w:footerReference w:type="default" r:id="rId1"/></w:sectPr>` +
        '</w:body></w:document>'
    ),
  });
}

function furnitureFromPackage(
  pkg: import('@docx-editor.dev/core/store').OoxmlPackage,
  part: OoxmlPart
): readonly (PageFurniture | undefined)[] {
  const sections = enumerateDocumentSections(part);
  const bySection = resolveHeaderFooterPartsBySection(pkg);
  return sections.map((section, index) => {
    const parts = bySection[index];
    if (!parts || (parts.headers.size === 0 && parts.footers.size === 0)) return undefined;
    const geometry = geometryOfSection(section.properties);
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    const mapStories = (source: typeof parts.headers) => {
      const laid = new Map();
      for (const [variant, hfPart] of source) {
        laid.set(variant, layoutHeaderFooterStory(hfPart, width, measurer, 'test'));
      }
      return laid;
    };
    return {
      titlePage: parts.titlePage,
      evenAndOddHeaders: parts.evenAndOddHeaders,
      headers: mapStories(parts.headers),
      footers: mapStories(parts.footers),
    };
  });
}

function footerTextOf(page: {
  footer?: {
    fragments: readonly {
      kind: string;
      lines?: readonly { spans: readonly { text: string }[] }[];
    }[];
  };
}): string {
  return (
    page.footer?.fragments
      .flatMap((f) =>
        f.kind === 'paragraph' ? (f.lines ?? []).flatMap((l) => l.spans.map((s) => s.text)) : []
      )
      .join('') ?? ''
  );
}

function multiSectionDoc(args: {
  footerBody: string;
  sections: readonly { body: string; sectPrExtra?: string }[];
}): Uint8Array {
  const body = args.sections
    .map((section, index) => {
      const isLast = index === args.sections.length - 1;
      const sectInner =
        (section.sectPrExtra ?? '') +
        `<w:pgSz w:w="6000" w:h="2400"/>` +
        `<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" w:header="100" w:footer="100"/>` +
        `<w:footerReference w:type="default" r:id="rId1"/>`;
      if (isLast) {
        return `${section.body}<w:sectPr>${sectInner}</w:sectPr>`;
      }
      return (
        `${section.body}` +
        `<w:p><w:pPr><w:sectPr>${sectInner}</w:sectPr></w:pPr>` +
        `<w:r><w:t>section-end-${index}</w:t></w:r></w:p>`
      );
    })
    .join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/footer" Target="footer1.xml"/></Relationships>`
    ),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${args.footerBody}</w:ftr>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const PAGE_X_OF_SECTION =
  `<w:p><w:r><w:t>P</w:t></w:r>` +
  `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
  `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
  `<w:r><w:t>/</w:t></w:r>` +
  `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>SECTIONPAGES</w:instrText>` +
  `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
  `<w:r><w:t xml:space="preserve"> of </w:t></w:r>` +
  `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>NUMPAGES</w:instrText>` +
  `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`;

describe('SECTIONPAGES and pgNumType projection', () => {
  test('allowlists SECTIONPAGES and rejects partial matches', () => {
    expect(normalizeFieldInstruction('sectionpages \\* MERGEFORMAT')).toBe('SECTIONPAGES');
    expect(allowlistedPageField('SECTIONPAGES')).toBe('SECTIONPAGES');
    expect(allowlistedPageField('SECTION')).toBeNull();
  });

  test('projectPageFieldValue emits SECTIONPAGES and formats PAGE via pgNumType', () => {
    expect(
      projectPageFieldValue('SECTIONPAGES', {
        pageNumber: 2,
        pageCount: 26,
        sectionPageCount: 4,
      })
    ).toBe('4');
    expect(
      projectPageFieldValue('PAGE', { pageNumber: 4, pageCount: 10, format: 'lowerRoman' })
    ).toBe('iv');
    expect(
      projectPageFieldValue('PAGE', { pageNumber: 4, pageCount: 10, format: 'japaneseCounting' })
    ).toBe('4');
  });

  test('detects SECTIONPAGES and reuses one layout per section page count', () => {
    const bytes = footerDoc(
      `<w:p><w:r><w:t xml:space="preserve">sec </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>SECTIONPAGES</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`
    );
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const footer = [...loaded.package.parts.values()].find((p) => p.name.includes('footer1'))!;
    expect(detectStoryPageFields(footer.root)).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: true,
    });
    const baseline = layoutHeaderFooterStory(footer, 300, measurer, 'test');
    const a = baseline.withPageContext({
      pageNumber: 1,
      pageCount: 12,
      sectionPageCount: 4,
    });
    const b = baseline.withPageContext({
      pageNumber: 9,
      pageCount: 99,
      sectionPageCount: 4,
    });
    expect(a).toBe(b);
    expect(
      a.fragments
        .flatMap((f) =>
          f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
        )
        .join('')
    ).toBe('sec 4');
    const other = baseline.withPageContext({
      pageNumber: 1,
      pageCount: 12,
      sectionPageCount: 5,
    });
    expect(other).not.toBe(a);
  });

  test('multi-section footer: NUMPAGES is document-wide, SECTIONPAGES is per section', () => {
    const pad = (n: number) =>
      Array.from(
        { length: n },
        () => `<w:p><w:r><w:t xml:space="preserve">${'x'.repeat(40)}</w:t></w:r></w:p>`
      ).join('');
    const bytes = multiSectionDoc({
      footerBody: PAGE_X_OF_SECTION,
      sections: [{ body: pad(8) }, { body: pad(12) }, { body: pad(8) }],
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'test',
      sectionFurniture: furnitureFromPackage(loaded.package, part),
    });
    expect(layout.pages.length).toBeGreaterThan(3);
    const pageCount = layout.pages.length;
    const sections = enumerateDocumentSections(part);
    expect(sections.length).toBe(3);

    // Group pages by section via pageFieldSource.sectionPageCount continuity.
    const bySection = new Map<number, typeof layout.pages>();
    for (const page of layout.pages) {
      const key = page.pageFieldSource?.sectionPageCount ?? pageCount;
      const list = bySection.get(key) ?? [];
      list.push(page);
      bySection.set(key, list);
    }

    for (const page of layout.pages) {
      const sectionPages = page.pageFieldSource?.sectionPageCount ?? pageCount;
      const displayed = page.pageFieldSource?.pageNumber ?? page.index + 1;
      expect(footerTextOf(page)).toBe(`P${displayed}/${sectionPages} of ${pageCount}`);
    }
  });

  test('pgNumType start restarts PAGE mid-document', () => {
    const pad = (n: number) =>
      Array.from(
        { length: n },
        () => `<w:p><w:r><w:t xml:space="preserve">${'x'.repeat(40)}</w:t></w:r></w:p>`
      ).join('');
    const bytes = multiSectionDoc({
      footerBody:
        `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
      sections: [{ body: pad(8) }, { body: pad(8), sectPrExtra: '<w:pgNumType w:start="1"/>' }],
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'test',
      sectionFurniture: furnitureFromPackage(loaded.package, part),
    });
    expect(layout.pages.length).toBeGreaterThan(2);
    const restarted = layout.pages.filter((p) => p.pageFieldSource?.pageNumber === 1);
    expect(restarted.length).toBeGreaterThanOrEqual(1);
    // First sheet stays physical 1; a later sheet also shows 1 after the restart.
    expect(footerTextOf(layout.pages[0]!)).toBe('1');
    const laterRestart = layout.pages.find(
      (p) => p.index > 0 && p.pageFieldSource?.pageNumber === 1
    );
    expect(laterRestart).toBeDefined();
    expect(footerTextOf(laterRestart!)).toBe('1');
  });

  test('pgNumType lowerRoman formats PAGE', () => {
    const pad = Array.from(
      { length: 8 },
      () => `<w:p><w:r><w:t xml:space="preserve">${'x'.repeat(40)}</w:t></w:r></w:p>`
    ).join('');
    const bytes = footerDoc(
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
      pad
    );
    // Rebuild with fmt on the body sectPr.
    const loaded0 = readOoxmlPackage(bytes);
    expect(loaded0.ok).toBe(true);
    if (!loaded0.ok) return;
    const withFmt = multiSectionDoc({
      footerBody:
        `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
      sections: [{ body: pad, sectPrExtra: '<w:pgNumType w:fmt="lowerRoman"/>' }],
    });
    const loaded = readOoxmlPackage(withFmt);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    expect(enumerateDocumentSections(part)[0]!.properties.pageNumbering).toEqual({
      fmt: 'lowerRoman',
    });
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'test',
      sectionFurniture: furnitureFromPackage(loaded.package, part),
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    expect(footerTextOf(layout.pages[0]!)).toBe('i');
    expect(footerTextOf(layout.pages[1]!)).toBe('ii');
  });

  test('digit-width right tab stays correct across 9→10 for PAGE', () => {
    const body =
      Array.from({ length: 5 }, (_, i) => `<w:p><w:r><w:t>line ${i}</w:t></w:r></w:p>`).join('') +
      Array.from(
        { length: 40 },
        () => `<w:p><w:r><w:t xml:space="preserve">${'x'.repeat(40)}</w:t></w:r></w:p>`
      ).join('');
    const bytes = footerDoc(
      `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="4000"/></w:tabs></w:pPr>` +
        `<w:r><w:t>L</w:t><w:tab/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
      body
    );
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'test',
      geometry: {
        width: 200,
        height: 80,
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
      },
      sectionFurniture: furnitureFromPackage(loaded.package, part),
    });
    expect(layout.pages.length).toBeGreaterThan(10);
    const tabWidth = (pageIndex: number): number => {
      const spans = layout.pages[pageIndex]!.footer!.fragments.flatMap((f) =>
        f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans) : []
      );
      return spans.find((s) => s.text === '\t')!.box.width;
    };
    expect(footerTextOf(layout.pages[8]!)).toContain('9');
    expect(footerTextOf(layout.pages[9]!)).toContain('10');
    expect(tabWidth(8)).not.toBe(tabWidth(9));
  });

  test('NUMPAGES refreshes everywhere when pagination grows', () => {
    const footer =
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>NUMPAGES</w:instrText>` +
      `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
    const shortBody = Array.from(
      { length: 10 },
      () => `<w:p><w:r><w:t xml:space="preserve">${'x'.repeat(40)}</w:t></w:r></w:p>`
    ).join('');
    const longBody = Array.from(
      { length: 30 },
      () => `<w:p><w:r><w:t xml:space="preserve">${'x'.repeat(40)}</w:t></w:r></w:p>`
    ).join('');
    const geometry = {
      width: 200,
      height: 100,
      margin: { top: 10, right: 10, bottom: 10, left: 10 },
    };
    const short = readOoxmlPackage(footerDoc(footer, shortBody));
    const long = readOoxmlPackage(footerDoc(footer, longBody));
    expect(short.ok && long.ok).toBe(true);
    if (!short.ok || !long.ok) return;
    const shortPart = short.package.parts.get(short.package.mainDocumentPart)!;
    const longPart = long.package.parts.get(long.package.mainDocumentPart)!;
    const shortLayout = layoutSemanticDocument(shortPart, 1, {
      measurer,
      producer: 'test',
      geometry,
      sectionFurniture: furnitureFromPackage(short.package, shortPart),
    });
    const longLayout = layoutSemanticDocument(longPart, 2, {
      measurer,
      producer: 'test',
      geometry,
      sectionFurniture: furnitureFromPackage(long.package, longPart),
    });
    expect(longLayout.pages.length).toBeGreaterThan(shortLayout.pages.length);
    for (const page of shortLayout.pages) {
      expect(footerTextOf(page)).toBe(String(shortLayout.pages.length));
    }
    for (const page of longLayout.pages) {
      expect(footerTextOf(page)).toBe(String(longLayout.pages.length));
    }
  });

  test('unsupported and inert instructions never evaluate; ffData macros stay unread', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin">` +
        `<w:ffData><w:name w:val="x"/><w:enabled/><w:calcOnExit w:val="0"/>` +
        `<w:entryMacro w:val="Evil"/><w:exitMacro w:val="Worse"/></w:ffData>` +
        `</w:fldChar>` +
        `<w:instrText>INCLUDETEXT "http://evil.example/x.docx"</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>cached</w:t>` +
        `<w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>DATE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>1999</w:t>` +
        `<w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    const paragraph = part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
    expect(
      piecesOfParagraph(paragraph, [], {
        pageNumber: 3,
        pageCount: 9,
        sectionPageCount: 2,
      }).map((p) => p.text)
    ).toEqual(['cached', '1999']);
    expect(allowlistedPageField('INCLUDETEXT "http://evil.example/x.docx"')).toBeNull();
  });
});
