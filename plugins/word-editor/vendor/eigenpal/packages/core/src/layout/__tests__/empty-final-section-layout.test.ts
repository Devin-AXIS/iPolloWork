// Empty final section pagination: body-level sectPr with no remaining blocks.
//
// enumerateDocumentSections intentionally keeps that trailing empty section. Layout must
// materialize a blank sheet for default/nextPage/evenPage/oddPage (after any parity sheet),
// apply its geometry and furniture, and must not invent a page for continuous.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  enumerateDocumentSections,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type LayoutSession,
  type PageFurniture,
  type SemanticLayout,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);

const pageText = (layout: SemanticLayout, pageIndex: number): string => {
  const page = layout.pages[pageIndex];
  if (!page) return '';
  const parts: string[] = [];
  for (const fragment of page.fragments) {
    if (fragment.kind !== 'paragraph') continue;
    for (const line of fragment.lines) {
      for (const span of line.spans) parts.push(span.text);
    }
  }
  return parts.join('');
};

const furnitureText = (
  page: SemanticLayout['pages'][number],
  edge: 'header' | 'footer'
): string => {
  const story = page[edge];
  if (!story) return '';
  return story.fragments
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    )
    .join('');
};

function headerFurniture(text: string): PageFurniture {
  const headerPart = readOoxmlPart(
    `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:hdr>`,
    {
      name: '/word/header1.xml',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
    }
  );
  if (!headerPart.ok) throw new Error(headerPart.reason);
  const story = layoutHeaderFooterStory(headerPart.part, 400, measurer, 'test');
  return {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: new Map([['default', story]]),
    footers: new Map(),
  };
}

/** Section 0 has content; body-level sectPr is an empty final section. */
function emptyFinalBody(
  finalType: string | undefined,
  finalPgSz: string,
  finalPgMar?: string
): string {
  const type = finalType ? `<w:type w:val="${finalType}"/>` : '';
  const mar =
    finalPgMar ??
    '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360"/>';
  return (
    '<w:p><w:pPr><w:sectPr>' +
    '<w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
    '</w:sectPr></w:pPr><w:r><w:t>A</w:t></w:r></w:p>' +
    `<w:sectPr>${type}${finalPgSz}${mar}</w:sectPr>`
  );
}

const lay = (
  part: OoxmlPart,
  revision = 1,
  session?: LayoutSession,
  furniture?: readonly (PageFurniture | undefined)[]
) =>
  layoutSemanticDocument(part, revision, {
    measurer,
    ...(session ? { session } : {}),
    ...(furniture ? { sectionFurniture: furniture } : {}),
  });

describe('empty final nextPage section materializes a blank sheet', () => {
  test('absent type (default nextPage) keeps a blank page with final geometry', () => {
    const part = load(emptyFinalBody(undefined, '<w:pgSz w:w="15840" w:h="12240"/>'));
    const sections = enumerateDocumentSections(part);
    expect(sections).toHaveLength(2);
    expect(sections[1]!.blockStart).toBe(sections[1]!.blockEndExclusive);
    expect(sections[1]!.properties.breakType).toBe('nextPage');

    const layout = lay(part);
    expect(layout.pages).toHaveLength(2);
    expect(pageText(layout, 0)).toBe('A');
    expect(layout.pages[0]!.box).toMatchObject({ width: 612, height: 792 });
    expect(pageText(layout, 1)).toBe('');
    expect(layout.pages[1]!.fragments).toHaveLength(0);
    // Landscape final section: 15840×12240 twips → 792×612 pt.
    expect(layout.pages[1]!.box).toMatchObject({ width: 792, height: 612 });
    expect(layout.pages[1]!.contentBox.y - layout.pages[1]!.box.y).toBe(36); // 720 twips
    expect(layout.pages[1]!.index).toBe(1);
    expect(layout.pages[1]!.box.y).toBeGreaterThan(layout.pages[0]!.box.y);
  });

  test('explicit nextPage matches absent-type blank-page behaviour', () => {
    const absent = lay(load(emptyFinalBody(undefined, '<w:pgSz w:w="15840" w:h="12240"/>')));
    const explicit = lay(load(emptyFinalBody('nextPage', '<w:pgSz w:w="15840" w:h="12240"/>')));
    expect(explicit.pages).toHaveLength(2);
    expect(explicit.pages[1]!.box.width).toBe(absent.pages[1]!.box.width);
    expect(explicit.pages[1]!.box.height).toBe(absent.pages[1]!.box.height);
    expect(pageText(explicit, 1)).toBe('');
  });
});

describe('empty final continuous does not manufacture a page', () => {
  test('continuous empty final shares/continues — only the content section sheet', () => {
    const part = load(emptyFinalBody('continuous', '<w:pgSz w:w="15840" w:h="12240"/>'));
    const sections = enumerateDocumentSections(part);
    expect(sections).toHaveLength(2);
    expect(sections[1]!.properties.breakType).toBe('continuous');
    expect(sections[1]!.blockStart).toBe(sections[1]!.blockEndExclusive);

    const layout = lay(part);
    expect(layout.pages).toHaveLength(1);
    expect(pageText(layout, 0)).toBe('A');
    // Geometry stays the first section's — continuous empty must not swap the sheet.
    expect(layout.pages[0]!.box).toMatchObject({ width: 612, height: 792 });
  });
});

describe('empty final evenPage/oddPage parity', () => {
  test('evenPage after page 1 materializes one blank page like nextPage', () => {
    const next = lay(load(emptyFinalBody('nextPage', '<w:pgSz w:w="15840" w:h="12240"/>')));
    const parity = lay(load(emptyFinalBody('evenPage', '<w:pgSz w:w="15840" w:h="12240"/>')));
    expect(parity.pages).toHaveLength(next.pages.length);
    expect(parity.pages[1]!.box.width).toBe(next.pages[1]!.box.width);
    expect(parity.pages[1]!.box.height).toBe(next.pages[1]!.box.height);
    expect(pageText(parity, 1)).toBe('');
  });

  test('oddPage after page 1 puts a blank parity sheet before the section page', () => {
    const parity = lay(load(emptyFinalBody('oddPage', '<w:pgSz w:w="15840" w:h="12240"/>')));
    expect(parity.pages).toHaveLength(3);
    expect(parity.pages[1]!.parityBlank).toBe(true);
    expect(parity.pages[2]!.parityBlank).toBeUndefined();
    expect(parity.pages[2]!.box.width).toBe(792);
    expect(parity.pages[2]!.pageFieldSource?.pageNumber).toBe(3);
  });
});

describe('empty final furniture and ordinary nonempty sections', () => {
  test('blank final nextPage page carries that section’s furniture', () => {
    const part = load(emptyFinalBody('nextPage', '<w:pgSz w:w="12240" w:h="15840"/>'));
    const layout = lay(part, 1, undefined, [undefined, headerFurniture('FINAL HF')]);
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]!.header).toBeUndefined();
    expect(furnitureText(layout.pages[1]!, 'header')).toBe('FINAL HF');
    expect(layout.pages[1]!.header!.box.y - layout.pages[1]!.box.y).toBeCloseTo(18, 5);
  });

  test('ordinary nonempty final section is unchanged (no extra blank page)', () => {
    const part = load(
      '<w:p><w:pPr><w:sectPr>' +
        '<w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>' +
        '</w:sectPr></w:pPr><w:r><w:t>cover</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
        '<w:sectPr>' +
        '<w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="720" w:right="1440" w:bottom="1440" w:left="1440"/>' +
        '</w:sectPr>'
    );
    const sections = enumerateDocumentSections(part);
    expect(sections).toHaveLength(2);
    expect(sections[1]!.blockEndExclusive - sections[1]!.blockStart).toBe(1);

    const layout = lay(part);
    expect(layout.pages).toHaveLength(2);
    expect(pageText(layout, 0)).toBe('cover');
    expect(pageText(layout, 1)).toBe('body');
    expect(layout.pages[1]!.contentBox.y - layout.pages[1]!.box.y).toBe(36);
  });
});

describe('empty final section incremental reuse', () => {
  test('unchanged empty nextPage final reuses blank page identity', () => {
    const part = load(emptyFinalBody('nextPage', '<w:pgSz w:w="15840" w:h="12240"/>'));
    const session = createLayoutSession();
    const first = lay(part, 1, session);
    expect(first.pages).toHaveLength(2);
    const second = lay(part, 2, session);
    expect(second.pages).toHaveLength(2);
    expect(second.pages[0]).toBe(first.pages[0]);
    expect(second.pages[1]).toBe(first.pages[1]);
    expect(session.stats.placed).toBe(0);
    expect(session.stats.reusedPages).toBe(2);
  });

  test('switching empty final from nextPage to continuous drops the blank page', () => {
    const session = createLayoutSession();
    const withBlank = lay(
      load(emptyFinalBody('nextPage', '<w:pgSz w:w="15840" w:h="12240"/>')),
      1,
      session
    );
    expect(withBlank.pages).toHaveLength(2);
    const continuous = lay(
      load(emptyFinalBody('continuous', '<w:pgSz w:w="15840" w:h="12240"/>')),
      2,
      session
    );
    expect(continuous.pages).toHaveLength(1);
    expect(pageText(continuous, 0)).toBe('A');
  });
});
