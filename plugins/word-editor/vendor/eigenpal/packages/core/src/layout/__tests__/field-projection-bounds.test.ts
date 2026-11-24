// Adversarial bounds for PAGE/NUMPAGES field detection and projection.
// Detection and HF layout must share the same node/depth/character-capped machine.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createFixedMeasurer } from '../index.ts';
import {
  detectStoryPageFields,
  MAX_STORY_FIELD_SCAN_DEPTH,
  MAX_STORY_FIELD_SCAN_NODES,
  piecesOfParagraph,
} from '../field-projection.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { readOoxmlPackage, type OoxmlPart } from '@docx-editor.dev/core/store';

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

function footerDoc(footerBody: string): Uint8Array {
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
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        `<w:p><w:r><w:t>Hello</w:t></w:r></w:p>` +
        `<w:sectPr><w:footerReference w:type="default" r:id="rId1"/></w:sectPr>` +
        '</w:body></w:document>'
    ),
  });
}

function nestWrappers(inner: string, depth: number): string {
  let xml = inner;
  for (let i = 0; i < depth; i += 1) {
    xml = `<w:customXml w:element="x${i}">${xml}</w:customXml>`;
  }
  return xml;
}

function manyBookmarks(count: number): string {
  return Array.from(
    { length: count },
    (_, i) => `<w:bookmarkStart w:id="${i}" w:name="n${i}"/>`
  ).join('');
}

describe('bounded instrText extraction (node/depth/character caps)', () => {
  test('instrText with many descendants above the node cap stays undetected', () => {
    // Descendants alone exceed the story scan budget; PAGE must not leak past the cap.
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/>` +
        `<w:instrText>${manyBookmarks(MAX_STORY_FIELD_SCAN_NODES + 64)}PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    expect(detectStoryPageFields(part.root)).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: false,
    });
  });

  test('instrText with many descendants below the node cap still detects PAGE', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/>` +
        `<w:instrText>${manyBookmarks(8)}PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    expect(detectStoryPageFields(part.root)).toEqual({
      hasPage: true,
      hasNumPages: false,
      hasSectionPages: false,
    });
  });

  test('instrText nested deeper than the depth cap stays undetected', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/>` +
        `<w:instrText>${nestWrappers('PAGE', MAX_STORY_FIELD_SCAN_DEPTH + 8)}</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    expect(detectStoryPageFields(part.root)).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: false,
    });
  });

  test('instrText nested within the depth cap still detects PAGE', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/>` +
        `<w:instrText>${nestWrappers('PAGE', 4)}</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    expect(detectStoryPageFields(part.root)).toEqual({
      hasPage: true,
      hasNumPages: false,
      hasSectionPages: false,
    });
  });

  test('projection refuses hostile oversize instrText descendants', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/>` +
        `<w:instrText>${manyBookmarks(MAX_STORY_FIELD_SCAN_NODES + 64)}PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>99</w:t><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
    const pieces = piecesOfParagraph(paragraph, [], { pageNumber: 7, pageCount: 10 });
    // Instruction overflow / scan exhaust → atomic field with no live projection or cached piece.
    expect(pieces.some((p) => p.projected)).toBe(false);
    expect(pieces.map((p) => p.text)).toEqual(['A', 'Z']);
    expect(pieces[1]).toMatchObject({ start: 1, end: 2 });
  });

  test('HF layout detection and projection share the same bounded machine', () => {
    const hostile = footerDoc(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/>` +
        `<w:instrText>${manyBookmarks(MAX_STORY_FIELD_SCAN_NODES + 64)}PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>1</w:t><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    const loaded = readOoxmlPackage(hostile);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const footer = [...loaded.package.parts.values()].find((p) => p.name.includes('footer1'))!;
    expect(detectStoryPageFields(footer.root)).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: false,
    });
    const baseline = layoutHeaderFooterStory(footer, 300, measurer, 'test');
    expect(baseline.pageFieldNeeds).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: false,
    });
    // No projector path: page context is a no-op identity reuse.
    expect(baseline.withPageContext({ pageNumber: 3, pageCount: 9 })).toBe(baseline);

    const ok = footerDoc(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/>` +
        `<w:instrText>${manyBookmarks(4)}PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>1</w:t><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    const okLoaded = readOoxmlPackage(ok);
    expect(okLoaded.ok).toBe(true);
    if (!okLoaded.ok) return;
    const okFooter = [...okLoaded.package.parts.values()].find((p) => p.name.includes('footer1'))!;
    expect(detectStoryPageFields(okFooter.root)).toEqual({
      hasPage: true,
      hasNumPages: false,
      hasSectionPages: false,
    });
    const okBaseline = layoutHeaderFooterStory(okFooter, 300, measurer, 'test');
    expect(okBaseline.pageFieldNeeds).toEqual({
      hasPage: true,
      hasNumPages: false,
      hasSectionPages: false,
    });
    const projected = okBaseline.withPageContext({ pageNumber: 3, pageCount: 9 });
    expect(
      projected.fragments
        .flatMap((f) =>
          f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
        )
        .join('')
    ).toBe('3');
  });
});
