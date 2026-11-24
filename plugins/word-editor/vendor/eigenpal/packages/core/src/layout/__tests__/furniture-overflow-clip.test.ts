// Header and footer stories too tall for the page (ECMA-376 §17.10, §17.6.11 `w:pgMar`).
//
// The body always starts below the whole header, even past the bottom margin or the sheet
// edge, and each page then holds one line. What the furniture PAINTS is limited: once the
// header and footer of a page together pass four fifths of the sheet height, each shows only
// the whole lines that fit in two fifths of it. Top and bottom margins that together pass the
// sheet height stay as authored.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  createFixedMeasurer,
  enumerateDocumentSections,
  geometryOfSection,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type PageFurniture,
} from '../index.ts';
import { readOoxmlPackage, resolveHeaderFooterPartsBySection } from '@docx-editor.dev/core/store';
import { clipFurnitureFragments, furniturePaintLimit } from '../furniture-overflow-clip.ts';
import type { ParagraphFragmentRecord, PageRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const LETTER = 792;
const DISTANCE = 36;

const measurer = createFixedMeasurer(6, 14);

const paragraphs = (prefix: string, count: number) =>
  Array.from(
    { length: count },
    (_unused, index) => `<w:p><w:r><w:t>${prefix}${index + 1}</w:t></w:r></w:p>`
  ).join('');

function layoutOf(options: {
  readonly headerLines?: number;
  readonly footerLines?: number;
  readonly bodyLines?: number;
  readonly top?: number;
  readonly bottom?: number;
}) {
  const refs =
    (options.headerLines ? '<w:headerReference w:type="default" r:id="rIdH"/>' : '') +
    (options.footerLines ? '<w:footerReference w:type="default" r:id="rIdF"/>' : '');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdH" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rIdF" Type="${R}/footer" Target="footer1.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${paragraphs('BODY', options.bodyLines ?? 3)}` +
        `<w:sectPr>${refs}<w:pgSz w:w="12240" w:h="15840"/>` +
        `<w:pgMar w:top="${options.top ?? 1440}" w:right="1440" w:bottom="${options.bottom ?? 1440}"` +
        ' w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}">${paragraphs('HEAD', options.headerLines ?? 1)}</w:hdr>`
    ),
    'word/footer1.xml': strToU8(
      `<w:ftr xmlns:w="${W}">${paragraphs('FOOT', options.footerLines ?? 1)}</w:ftr>`
    ),
  };
  const loaded = readOoxmlPackage(zipSync(files));
  if (!loaded.ok) throw new Error(loaded.reason);
  const pkg = loaded.package;
  const part = pkg.parts.get(pkg.mainDocumentPart)!;
  const sections = enumerateDocumentSections(part);
  const bySection = resolveHeaderFooterPartsBySection(pkg);
  const sectionFurniture = sections.map((section, index): PageFurniture | undefined => {
    const parts = bySection[index];
    if (!parts || (parts.headers.size === 0 && parts.footers.size === 0)) return undefined;
    const geometry = geometryOfSection(section.properties);
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    const stories = (source: typeof parts.headers) =>
      new Map(
        [...source].map(([variant, hfPart]) => [
          variant,
          layoutHeaderFooterStory(hfPart, width, measurer, 'test'),
        ])
      );
    return {
      titlePage: parts.titlePage,
      evenAndOddHeaders: parts.evenAndOddHeaders,
      headers: stories(parts.headers),
      footers: stories(parts.footers),
    };
  });
  return layoutSemanticDocument(part, 1, { measurer, producer: 'test', sectionFurniture });
}

/** Every painted line of a story record, in order. */
function storyLines(story: PageRecord['header']): ParagraphFragmentRecord['lines'] {
  return (story?.fragments ?? []).flatMap((fragment) =>
    fragment.kind === 'paragraph' ? fragment.lines : []
  );
}

const LINE = (() => {
  const page = layoutOf({ headerLines: 2 }).pages[0]!;
  return page.header!.box.height / 2;
})();

describe('furniture paint limit', () => {
  test('header and footer within four fifths of the sheet show whole', () => {
    expect(furniturePaintLimit(LETTER, 632.5, 0)).toBeUndefined();
    expect(furniturePaintLimit(LETTER, 322, 310.5)).toBeUndefined();
    expect(furniturePaintLimit(841.9, 667, 0)).toBeUndefined();
  });

  test('past four fifths each keeps two fifths of the sheet', () => {
    expect(furniturePaintLimit(LETTER, 655.5, 0)).toBeCloseTo(316.8, 6);
    expect(furniturePaintLimit(LETTER, 333.5, 322)).toBeCloseTo(316.8, 6);
    expect(furniturePaintLimit(841.9, 678.5, 0)).toBeCloseTo(336.76, 6);
  });

  test('a cut paragraph keeps its whole lines and loses its paragraph end', () => {
    const line = (index: number) => ({
      id: `l${index}`,
      range: { paragraphId: 'p', start: index, end: index + 1 },
      spans: [],
      box: { x: 0, y: index * 40, width: 100, height: 40 },
    });
    const fragment = {
      kind: 'paragraph',
      id: 'p#f0',
      paragraphId: 'p',
      fragmentIndex: 0,
      paragraphEnd: true,
      range: { paragraphId: 'p', start: 0, end: 20 },
      lines: Array.from({ length: 20 }, (_unused, index) => line(index)),
      box: { x: 0, y: 0, width: 100, height: 800 },
    } as unknown as ParagraphFragmentRecord;
    const clipped = clipFurnitureFragments([fragment], 316.8);
    expect(clipped.height).toBeCloseTo(280, 6);
    const kept = clipped.fragments[0] as ParagraphFragmentRecord;
    expect(kept.lines).toHaveLength(7);
    expect(kept.paragraphEnd).toBeUndefined();
    expect(kept.range.end).toBe(7);
  });
});

describe('§17.10 a header or footer taller than the page', () => {
  test('a header within four fifths of the sheet paints every line', () => {
    const count = Math.floor((0.8 * LETTER) / LINE);
    const page = layoutOf({ headerLines: count }).pages[0]!;
    expect(storyLines(page.header)).toHaveLength(count);
  });

  test('a taller header paints the lines that fit in two fifths and pushes by all of it', () => {
    // Tall enough that the body starts below the bottom margin.
    const count = Math.floor((0.8 * LETTER) / LINE) + 5;
    const layout = layoutOf({ headerLines: count });
    const page = layout.pages[0]!;
    const kept = Math.floor((0.4 * LETTER) / LINE);
    expect(storyLines(page.header)).toHaveLength(kept);
    expect(page.header!.box.height).toBeCloseTo(kept * LINE, 3);
    // The body still starts under the whole header, past the 720pt bottom margin, and each
    // page holds one line.
    expect(page.contentBox.y - page.box.y).toBeCloseTo(DISTANCE + count * LINE, 3);
    expect(page.contentBox.y - page.box.y).toBeGreaterThan(LETTER - 72);
    expect(layout.pages).toHaveLength(3);
  });

  test('a header taller than the sheet pushes the body off it', () => {
    const count = Math.ceil(LETTER / LINE) + 5;
    const page = layoutOf({ headerLines: count }).pages[0]!;
    expect(page.contentBox.y - page.box.y).toBeCloseTo(DISTANCE + count * LINE, 3);
    expect(page.contentBox.height).toBeCloseTo(1, 6);
  });

  test('a cut footer sits on its distance by the height it keeps, from its first line', () => {
    const count = Math.floor((0.8 * LETTER) / LINE) + 2;
    const page = layoutOf({ footerLines: count }).pages[0]!;
    const kept = Math.floor((0.4 * LETTER) / LINE);
    const lines = storyLines(page.footer);
    expect(lines).toHaveLength(kept);
    expect(lines[0]!.range.start).toBe(0);
    expect(page.footer!.box.y - page.box.y).toBeCloseTo(LETTER - DISTANCE - kept * LINE, 3);
  });

  test('a header and a footer that pass four fifths together are both cut', () => {
    const half = Math.floor((0.4 * LETTER) / LINE) + 2;
    const page = layoutOf({ headerLines: half, footerLines: half }).pages[0]!;
    const kept = Math.floor((0.4 * LETTER) / LINE);
    expect(storyLines(page.header)).toHaveLength(kept);
    expect(storyLines(page.footer)).toHaveLength(kept);
  });
});

describe('§17.6.11 top and bottom margins that pass the sheet height', () => {
  test('the body starts at the authored top margin, one line per page', () => {
    const layout = layoutOf({ top: 8000, bottom: 8000, bodyLines: 4 });
    expect(layout.pages).toHaveLength(4);
    for (const page of layout.pages) {
      expect(page.contentBox.y - page.box.y).toBeCloseTo(400, 6);
      expect(page.contentBox.height).toBeCloseTo(1, 6);
    }
  });
});
