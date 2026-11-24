// Safe PAGE / NUMPAGES field projection: allowlist, hostile instructions, and layout geometry.

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
  MAX_FIELD_INSTRUCTION_CHARS,
  MAX_STORY_FIELD_SCAN_NODES,
  normalizeFieldInstruction,
  piecesOfParagraph,
  projectPageFieldValue,
} from '../field-projection.ts';
import { DEFAULT_MAX_HF_PAGE_CONTEXT_ENTRIES, layoutHeaderFooterStory } from '../hf-layout.ts';
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

function storyText(
  part: OoxmlPart,
  pageContext?: { pageNumber: number; pageCount: number }
): string {
  const story = layoutHeaderFooterStory(
    part,
    400,
    measurer,
    'test',
    undefined,
    undefined,
    pageContext
  );
  return story.fragments
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.flatMap((line) => line.spans.map((s) => s.text))
        : []
    )
    .join('');
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

describe('field instruction allowlist', () => {
  test('normalizes and accepts only exact PAGE / NUMPAGES', () => {
    expect(normalizeFieldInstruction('  page  ')).toBe('PAGE');
    expect(normalizeFieldInstruction('NUMPAGES \\* MERGEFORMAT')).toBe('NUMPAGES');
    expect(allowlistedPageField('PAGE')).toBe('PAGE');
    expect(allowlistedPageField(' numpages ')).toBe('NUMPAGES');
    expect(allowlistedPageField('PAGE \\* MERGEFORMAT')).toBe('PAGE');
  });

  test('rejects hostile and non-allowlisted instructions', () => {
    expect(allowlistedPageField('INCLUDETEXT "http://evil"')).toBeNull();
    expect(allowlistedPageField('DDEAUTO Excel')).toBeNull();
    expect(allowlistedPageField('DATE')).toBeNull();
    expect(allowlistedPageField('TOC \\o "1-3"')).toBeNull();
    expect(allowlistedPageField('PAGE \\n Arabic')).toBeNull();
    expect(allowlistedPageField('P')).toBeNull();
    expect(normalizeFieldInstruction('x'.repeat(MAX_FIELD_INSTRUCTION_CHARS + 1))).toBeNull();
  });

  test('projectPageFieldValue emits decimal digits', () => {
    expect(projectPageFieldValue('PAGE', { pageNumber: 2, pageCount: 26 })).toBe('2');
    expect(projectPageFieldValue('NUMPAGES', { pageNumber: 2, pageCount: 26 })).toBe('26');
  });
});
describe('complex field piece projection', () => {
  test('empty PAGE/NUMPAGES project under page context and keep surrounding offsets', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:t xml:space="preserve">Page </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t xml:space="preserve"> of </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>NUMPAGES</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    const paragraph = part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
    const pieces = piecesOfParagraph(paragraph, [], { pageNumber: 2, pageCount: 26 });
    expect(pieces.map((p) => p.text)).toEqual(['Page ', '2', ' of ', '26']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 5 });
    expect(pieces[1]).toMatchObject({ start: 5, end: 6, projected: true });
    expect(pieces[2]).toMatchObject({ start: 6, end: 10 });
    expect(pieces[3]).toMatchObject({ start: 10, end: 11, projected: true });
  });

  test('without page context empty fields stay empty', () => {
    const part = parsePart(
      `<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`
    );
    const paragraph = part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
    expect(piecesOfParagraph(paragraph).map((p) => p.text)).toEqual(['Page ']);
  });

  test('non-allowlisted fields keep cached result text and never evaluate', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>DATE \\@ "yyyy"</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>1999</w:t><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    const paragraph = part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
    const pieces = piecesOfParagraph(paragraph, [], { pageNumber: 1, pageCount: 9 });
    expect(pieces.map((p) => p.text)).toEqual(['1999']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
  });

  test('INCLUDETEXT stays inert even with a result', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/>` +
        `<w:instrText>INCLUDETEXT "http://evil.example/x"</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>cached</w:t><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    const paragraph = part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
    expect(
      piecesOfParagraph(paragraph, [], { pageNumber: 1, pageCount: 2 }).map((p) => p.text)
    ).toEqual(['cached']);
  });

  test('allowlisted projection replaces stale cached PAGE result', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>1</w:t><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    const paragraph = part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
    expect(
      piecesOfParagraph(paragraph, [], { pageNumber: 7, pageCount: 10 }).map((p) => p.text)
    ).toEqual(['7']);
  });

  test('A99Z projects A7Z with canonical Z offset and bold result style', () => {
    // Model text is A\uFFFCZ; live PAGE replaces the atom with "7" while Z stays at offset 2.
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>PAGE</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>99</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
    const pieces = piecesOfParagraph(paragraph, [], { pageNumber: 7, pageCount: 10 });
    expect(pieces.map((p) => p.text)).toEqual(['A', '7', 'Z']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 1 });
    expect(pieces[0]!.projected).toBeUndefined();
    expect(pieces[1]).toMatchObject({ start: 1, end: 2, projected: true });
    expect(pieces[1]!.style.bold).toBe(true);
    expect(pieces[2]).toMatchObject({ start: 2, end: 3 });
  });

  test('multi-run cached result uses the first measurable run style', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>PAGE</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>9</w:t></w:r>` +
        `<w:r><w:rPr><w:i/></w:rPr><w:t>9</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
    const pieces = piecesOfParagraph(paragraph, [], { pageNumber: 7, pageCount: 10 });
    expect(pieces.map((p) => p.text)).toEqual(['7', 'Z']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
    expect(pieces[0]!.style.bold).toBe(true);
    expect(pieces[0]!.style.italic).toBe(false);
    expect(pieces[1]).toMatchObject({ start: 1, end: 2 });
  });

  test('malformed field missing end does not project', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>PAGE</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>99</w:t></w:r>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
    // Fail closed: no end → no live projection; buffered cached result stays visible.
    const pieces = piecesOfParagraph(paragraph, [], { pageNumber: 7, pageCount: 10 });
    expect(pieces.map((p) => p.text)).toEqual(['A', '99', 'Z']);
    expect(pieces.every((p) => !p.projected)).toBe(true);
    expect(pieces[2]).toMatchObject({ start: 3, end: 4 });
  });
});

describe('header/footer page-context layout cache', () => {
  test('withPageContext projects distinct digit widths per page key', () => {
    const bytes = footerDoc(
      `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="4000"/></w:tabs></w:pPr>` +
        `<w:r><w:t>L</w:t><w:tab/></w:r>` +
        `<w:r><w:t xml:space="preserve">Page </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t xml:space="preserve"> of </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>NUMPAGES</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`
    );
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const footer = [...loaded.package.parts.values()].find((p) => p.name.includes('footer1'))!;
    const baseline = layoutHeaderFooterStory(footer, 300, measurer, 'test');
    expect(baseline.pageFieldNeeds).toEqual({
      hasPage: true,
      hasNumPages: true,
      hasSectionPages: false,
    });
    expect(storyText(footer)).toBe('L\tPage  of ');
    const page2 = baseline.withPageContext({ pageNumber: 2, pageCount: 26 });
    const page10 = baseline.withPageContext({ pageNumber: 10, pageCount: 26 });
    expect(
      page2.fragments
        .flatMap((f) =>
          f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
        )
        .join('')
    ).toBe('L\tPage 2 of 26');
    expect(
      page10.fragments
        .flatMap((f) =>
          f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
        )
        .join('')
    ).toBe('L\tPage 10 of 26');
    // Distinct digit widths → distinct right-tab advances for the same stop.
    const tabWidth = (story: typeof page2): number => {
      const spans = story.fragments.flatMap((f) =>
        f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans) : []
      );
      return spans.find((s) => s.text === '\t')!.box.width;
    };
    expect(tabWidth(page2)).not.toBe(tabWidth(page10));
    expect(baseline.withPageContext({ pageNumber: 2, pageCount: 26 })).toBe(page2);
  });

  test('field-free stories reuse the baseline layout identity', () => {
    const bytes = footerDoc(`<w:p><w:r><w:t>Static footer</w:t></w:r></w:p>`);
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const footer = [...loaded.package.parts.values()].find((p) => p.name.includes('footer1'))!;
    const baseline = layoutHeaderFooterStory(footer, 300, measurer, 'test');
    expect(baseline.pageFieldNeeds).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: false,
    });
    expect(baseline.withPageContext({ pageNumber: 1, pageCount: 9 })).toBe(baseline);
    expect(baseline.withPageContext({ pageNumber: 9, pageCount: 9 })).toBe(baseline);
  });

  test('NUMPAGES-only stories reuse one layout per page count', () => {
    const bytes = footerDoc(
      `<w:p><w:r><w:t xml:space="preserve">of </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>NUMPAGES</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`
    );
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const footer = [...loaded.package.parts.values()].find((p) => p.name.includes('footer1'))!;
    const baseline = layoutHeaderFooterStory(footer, 300, measurer, 'test');
    expect(baseline.pageFieldNeeds).toEqual({
      hasPage: false,
      hasNumPages: true,
      hasSectionPages: false,
    });
    const page1 = baseline.withPageContext({ pageNumber: 1, pageCount: 12 });
    const page7 = baseline.withPageContext({ pageNumber: 7, pageCount: 12 });
    expect(page1).toBe(page7);
    expect(
      page1.fragments
        .flatMap((f) =>
          f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
        )
        .join('')
    ).toBe('of 12');
    const otherCount = baseline.withPageContext({ pageNumber: 1, pageCount: 13 });
    expect(otherCount).not.toBe(page1);
    expect(
      otherCount.fragments
        .flatMap((f) =>
          f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
        )
        .join('')
    ).toBe('of 13');
  });

  test('PAGE-dependent context cache stays bounded across many keys', () => {
    const bytes = footerDoc(
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`
    );
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const footer = [...loaded.package.parts.values()].find((p) => p.name.includes('footer1'))!;
    const maxEntries = 4;
    const baseline = layoutHeaderFooterStory(
      footer,
      300,
      measurer,
      'test',
      undefined,
      undefined,
      undefined,
      maxEntries
    );
    const first = baseline.withPageContext({ pageNumber: 1, pageCount: 100 });
    for (let pageNumber = 2; pageNumber <= maxEntries + 3; pageNumber += 1) {
      baseline.withPageContext({ pageNumber, pageCount: 100 });
    }
    // Baseline + maxEntries projected contexts; LRU evicts the oldest projected key.
    expect(baseline.withPageContext({ pageNumber: 1, pageCount: 100 })).not.toBe(first);
    const recent = baseline.withPageContext({ pageNumber: maxEntries + 3, pageCount: 100 });
    expect(baseline.withPageContext({ pageNumber: maxEntries + 3, pageCount: 100 })).toBe(recent);
    expect(maxEntries).toBeLessThan(DEFAULT_MAX_HF_PAGE_CONTEXT_ENTRIES);
  });
});

describe('story page-field detection', () => {
  test('detects PAGE and NUMPAGES in complex fields and in fldSimple', () => {
    const both = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>NUMPAGES</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    expect(detectStoryPageFields(both.root)).toEqual({
      hasPage: true,
      hasNumPages: true,
      hasSectionPages: false,
    });

    // A simple field keeps its instruction in an ATTRIBUTE, so the marker machine never sees
    // it. Ignoring it was harmless while simple fields painted nothing — the sheet showed a
    // blank either way. Once the cached result paints, ignoring it means the story's page
    // context never varies, one layout is reused for every sheet, and a footer PAGE shows the
    // producer's last saved number on every page. A wrong number is quieter than a blank, not
    // smaller.
    const simpleOnly = parsePart(
      `<w:p><w:fldSimple w:instr="PAGE"/><w:fldSimple w:instr="NUMPAGES"/></w:p>`
    );
    expect(detectStoryPageFields(simpleOnly.root)).toEqual({
      hasPage: true,
      hasNumPages: true,
      hasSectionPages: false,
    });

    const hostile = parsePart(
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>${'X'.repeat(MAX_FIELD_INSTRUCTION_CHARS + 1)}</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`
    );
    expect(detectStoryPageFields(hostile.root)).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: false,
    });
    expect(MAX_STORY_FIELD_SCAN_NODES).toBeGreaterThan(0);
  });

  test('detects begin/instr/separate/result/end split across distinct runs', () => {
    const pageOnly = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>PAGE</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>1</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    expect(detectStoryPageFields(pageOnly.root)).toEqual({
      hasPage: true,
      hasNumPages: false,
      hasSectionPages: false,
    });

    const numOnly = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>NUMPAGES</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>99</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    expect(detectStoryPageFields(numOnly.root)).toEqual({
      hasPage: false,
      hasNumPages: true,
      hasSectionPages: false,
    });
  });

  test('detects instruction text split across runs', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>NU</w:instrText></w:r>` +
        `<w:r><w:instrText>MPAGES</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    expect(detectStoryPageFields(part.root)).toEqual({
      hasPage: false,
      hasNumPages: true,
      hasSectionPages: false,
    });

    const pageSplit = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>PA</w:instrText></w:r>` +
        `<w:r><w:instrText>GE</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    expect(detectStoryPageFields(pageSplit.root)).toEqual({
      hasPage: true,
      hasNumPages: false,
      hasSectionPages: false,
    });
  });

  test('detects mixed PAGE and NUMPAGES when each field is split across runs', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:t xml:space="preserve">Page </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>PAGE</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>1</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t xml:space="preserve"> of </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>NUMPAGES</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>26</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    expect(detectStoryPageFields(part.root)).toEqual({
      hasPage: true,
      hasNumPages: true,
      hasSectionPages: false,
    });
  });

  test('malformed cross-paragraph fields do not count', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>PAGE</w:instrText></w:r>` +
        `</w:p>` +
        `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>1</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    expect(detectStoryPageFields(part.root)).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: false,
    });

    const numCross = parsePart(
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>NUMPAGES</w:instrText></w:r></w:p>` +
        `<w:p><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`
    );
    expect(detectStoryPageFields(numCross.root)).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: false,
    });
  });

  test('hostile oversize instructions split across runs stay undetected', () => {
    const half = Math.ceil((MAX_FIELD_INSTRUCTION_CHARS + 1) / 2);
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>${'X'.repeat(half)}</w:instrText></w:r>` +
        `<w:r><w:instrText>${'Y'.repeat(half)}</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    expect(detectStoryPageFields(part.root)).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: false,
    });
  });
});

describe('header/footer split-field projection and reuse', () => {
  test('cross-run PAGE/NUMPAGES detection enables live projection and context reuse', () => {
    const bytes = footerDoc(
      `<w:p>` +
        `<w:r><w:t xml:space="preserve">Page </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>PAGE</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>1</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t xml:space="preserve"> of </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>NU</w:instrText></w:r>` +
        `<w:r><w:instrText>MPAGES</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>99</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const footer = [...loaded.package.parts.values()].find((p) => p.name.includes('footer1'))!;
    expect(detectStoryPageFields(footer.root)).toEqual({
      hasPage: true,
      hasNumPages: true,
      hasSectionPages: false,
    });

    const baseline = layoutHeaderFooterStory(footer, 300, measurer, 'test');
    expect(baseline.pageFieldNeeds).toEqual({
      hasPage: true,
      hasNumPages: true,
      hasSectionPages: false,
    });
    // Without page context, cached result text stays (often stale).
    expect(
      baseline.fragments
        .flatMap((f) =>
          f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
        )
        .join('')
    ).toBe('Page 1 of 99');

    const page2 = baseline.withPageContext({ pageNumber: 2, pageCount: 26 });
    const page2Again = baseline.withPageContext({ pageNumber: 2, pageCount: 26 });
    expect(page2Again).toBe(page2);
    expect(
      page2.fragments
        .flatMap((f) =>
          f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
        )
        .join('')
    ).toBe('Page 2 of 26');

    const page7 = baseline.withPageContext({ pageNumber: 7, pageCount: 26 });
    expect(page7).not.toBe(page2);
    expect(
      page7.fragments
        .flatMap((f) =>
          f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
        )
        .join('')
    ).toBe('Page 7 of 26');
  });

  test('NUMPAGES-only split across runs reuses one layout per page count', () => {
    const bytes = footerDoc(
      `<w:p>` +
        `<w:r><w:t xml:space="preserve">of </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>NUM</w:instrText></w:r>` +
        `<w:r><w:instrText>PAGES</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>0</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const footer = [...loaded.package.parts.values()].find((p) => p.name.includes('footer1'))!;
    const baseline = layoutHeaderFooterStory(footer, 300, measurer, 'test');
    expect(baseline.pageFieldNeeds).toEqual({
      hasPage: false,
      hasNumPages: true,
      hasSectionPages: false,
    });
    const a = baseline.withPageContext({ pageNumber: 1, pageCount: 12 });
    const b = baseline.withPageContext({ pageNumber: 9, pageCount: 12 });
    expect(a).toBe(b);
    expect(
      a.fragments
        .flatMap((f) =>
          f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
        )
        .join('')
    ).toBe('of 12');
  });

  test('document layout projects split-run footer fields per page', () => {
    const body =
      Array.from({ length: 5 }, (_, i) => `<w:p><w:r><w:t>line ${i}</w:t></w:r></w:p>`).join('') +
      Array.from(
        { length: 20 },
        () => `<w:p><w:r><w:t xml:space="preserve">${'x'.repeat(40)}</w:t></w:r></w:p>`
      ).join('');
    const bytes = footerDoc(
      `<w:p>` +
        `<w:r><w:t xml:space="preserve">Page </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>PAGE</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>1</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t xml:space="preserve"> of </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>NUMPAGES</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>1</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`,
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
        height: 100,
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
      },
      sectionFurniture: furnitureFromPackage(loaded.package, part),
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    const pageCount = layout.pages.length;
    for (const page of layout.pages) {
      const text = page.footer?.fragments
        .flatMap((f) =>
          f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
        )
        .join('');
      expect(text).toBe(`Page ${page.index + 1} of ${pageCount}`);
      expect(page.footer?.pageFieldProjector).toBeUndefined();
    }
  });
});

describe('document layout page index and page count', () => {
  test('footer fields show physical page index and total pages', () => {
    const body =
      Array.from({ length: 5 }, (_, i) => `<w:p><w:r><w:t>line ${i}</w:t></w:r></w:p>`).join('') +
      Array.from(
        { length: 20 },
        () => `<w:p><w:r><w:t xml:space="preserve">${'x'.repeat(40)}</w:t></w:r></w:p>`
      ).join('');
    const bytes = footerDoc(
      `<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t xml:space="preserve"> of </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>NUMPAGES</w:instrText>` +
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
        height: 100,
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
      },
      sectionFurniture: furnitureFromPackage(loaded.package, part),
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    const pageCount = layout.pages.length;
    for (const page of layout.pages) {
      const text = page.footer?.fragments
        .flatMap((f) =>
          f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
        )
        .join('');
      expect(text).toBe(`Page ${page.index + 1} of ${pageCount}`);
      expect(page.footer?.pageFieldProjector).toBeUndefined();
    }
  });

  test('field-free furniture keeps baseline fragments and skips projectors', () => {
    const body = Array.from(
      { length: 25 },
      () => `<w:p><w:r><w:t xml:space="preserve">${'x'.repeat(40)}</w:t></w:r></w:p>`
    ).join('');
    const bytes = footerDoc(`<w:p><w:r><w:t>Static</w:t></w:r></w:p>`, body);
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'test',
      geometry: {
        width: 200,
        height: 100,
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
      },
      sectionFurniture: furnitureFromPackage(loaded.package, part),
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    const firstFragments = layout.pages[0]!.footer!.fragments;
    for (const page of layout.pages) {
      expect(page.footer?.pageFieldProjector).toBeUndefined();
      expect(page.footer?.fragments).toBe(firstFragments);
      const text = page.footer?.fragments
        .flatMap((f) =>
          f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
        )
        .join('');
      expect(text).toBe('Static');
    }
  });
});

describe('w:delInstrText — a tracked-deleted field instruction', () => {
  const paragraphOf = (part: OoxmlPart) => {
    const find = (node: (typeof part)['root']): (typeof part)['root'] | undefined => {
      if (node.kind === 'paragraph') return node;
      if (node.kind === 'textValue') return undefined;
      for (const child of node.children ?? []) {
        const hit = find(child);
        if (hit) return hit;
      }
      return undefined;
    };
    const paragraph = find(part.root);
    if (!paragraph) throw new Error('no paragraph');
    return paragraph;
  };
  // Word rewrites `w:instrText` as `w:delInstrText` inside a deletion; the machine must
  // ingest it per phase exactly like the live form, and it must never paint.
  const deletedField =
    '<w:p><w:r><w:t>A</w:t></w:r>' +
    '<w:del w:id="1" w:author="X">' +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:delInstrText> PAGE </w:delInstrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:delText>3</w:delText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
    '</w:del><w:r><w:t>B</w:t></w:r></w:p>';

  test('forms one atom and paints the struck result in all-markup', () => {
    const pieces = piecesOfParagraph(paragraphOf(parsePart(deletedField)));
    expect(pieces.map((piece) => piece.text)).toEqual(['A', '3', 'B']);
    const atom = pieces[1]!;
    expect(atom).toMatchObject({ start: 1, end: 2, projected: true });
    expect(atom.revisions?.map((revision) => revision.kind)).toEqual(['delete']);
    expect(pieces[2]).toMatchObject({ start: 2, end: 3 });
  });

  test('is gone from the proposed result, unit kept', () => {
    const pieces = piecesOfParagraph(
      paragraphOf(parsePart(deletedField)),
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      'proposed'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'B']);
    expect(pieces[1]).toMatchObject({ start: 2, end: 3 });
  });

  test('shows the pre-deletion document in the original view', () => {
    const pieces = piecesOfParagraph(
      paragraphOf(parsePart(deletedField)),
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      'original'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', '3', 'B']);
  });

  test('the instruction text itself never paints in any mode', () => {
    for (const mode of ['all-markup', 'proposed', 'original'] as const) {
      const pieces = piecesOfParagraph(
        paragraphOf(parsePart(deletedField)),
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        mode
      );
      expect(pieces.map((piece) => piece.text).join('')).not.toContain('PAGE');
    }
  });

  test("a demoted field's buffered result pieces carry the field-atom shading", () => {
    // No end marker: the field demotes, its cache flushes as ordinary addressable pieces —
    // which are still a field's displayed result and shade like one.
    const demoted =
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> DATE </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>cached</w:t></w:r></w:p>';
    const pieces = piecesOfParagraph(paragraphOf(parsePart(demoted)));
    expect(pieces.map((piece) => piece.text)).toEqual(['cached']);
    expect(pieces[0]!.fieldAtom).toEqual({ formField: false });
  });

  test('a fully-deleted PAGE still evaluates live, with delete attribution', () => {
    // No live instrText at all: the deleted buffer answers, so the field keeps its meaning
    // and the value paints struck in all-markup instead of going inert.
    const pieces = piecesOfParagraph(paragraphOf(parsePart(deletedField)), [], {
      pageNumber: 4,
      pageCount: 9,
    });
    expect(pieces.map((piece) => piece.text)).toEqual(['A', '4', 'B']);
    expect(pieces[1]!.revisions?.map((revision) => revision.kind)).toEqual(['delete']);
  });
});

// A LIVE `w:instrText` beside `w:delInstrText` (a tracked field-code edit) is covered in
// `field-instruction-revisions.test.ts` — this file is at the max-lines cap.
