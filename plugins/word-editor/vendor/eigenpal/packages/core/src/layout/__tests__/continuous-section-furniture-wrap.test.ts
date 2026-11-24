// Text of a continuous section on the host sheet wraps around the host sheet's furniture.
//
// The host sheet keeps and paints its own header and footer. So the continued text on that
// sheet wraps around the drawings of THOSE stories: a wrapping picture in the host footer
// pushes it aside, and a wrapping picture in the continued section's own first-page footer,
// which no sheet here paints, does not.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type LayoutSession,
  type PageFurniture,
  type SemanticLayout,
} from '../index.ts';
import {
  layoutContext,
  load as loadDrawingPart,
  squareAnchorAtLeft,
} from './anchored-drawing-test-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const EMU_PER_PT = 12700;

type Page = SemanticLayout['pages'][number];
type Story = ReturnType<typeof layoutHeaderFooterStory>;

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const p = (text: string) =>
  `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const lines = (count: number, label: string) =>
  Array.from({ length: count }, (_unused, index) => p(`${label}${index + 1}`)).join('');

function sectPr(type?: string, titlePage = false): string {
  return (
    '<w:sectPr>' +
    (type ? `<w:type w:val="${type}"/>` : '') +
    '<w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
    (titlePage ? '<w:titlePg/>' : '') +
    '</w:sectPr>'
  );
}

const ending = (text: string) =>
  `<w:p><w:pPr><w:spacing w:after="0"/>${sectPr()}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

function textFooter(texts: readonly string[], name: string): Story {
  const part = readOoxmlPart(`<w:ftr xmlns:w="${W}">${texts.map(p).join('')}</w:ftr>`, {
    name,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  });
  if (!part.ok) throw new Error(part.reason);
  return layoutHeaderFooterStory(part.part, 468, measurer, name);
}

/** A footer with a 200pt square-wrapped picture at page x 72 (content x 0) and page `topPt`. */
function wrapFooter(name: string, topPt: number): Story {
  const xml = squareAnchorAtLeft({ text: '' })
    .replace('<w:document ', '<w:ftr ')
    .replace('<w:body>', '')
    .replace('</w:body></w:document>', '</w:ftr>')
    .replace(
      'relativeFrom="column"><wp:posOffset>0',
      `relativeFrom="page"><wp:posOffset>${72 * EMU_PER_PT}`
    )
    .replace(
      'relativeFrom="paragraph"><wp:posOffset>0',
      `relativeFrom="page"><wp:posOffset>${topPt * EMU_PER_PT}`
    )
    .replaceAll('cx="1828800"', `cx="${200 * EMU_PER_PT}"`)
    .replaceAll('cy="914400"', `cy="${200 * EMU_PER_PT}"`);
  const part = loadDrawingPart(xml, name);
  return layoutHeaderFooterStory(
    part,
    468,
    measurer,
    name,
    undefined,
    undefined,
    undefined,
    128,
    undefined,
    undefined,
    layoutContext(part, name),
    undefined,
    undefined,
    {
      pageNumber: 1,
      pageWidth: 612,
      pageHeight: 792,
      marginLeft: 72,
      marginRight: 72,
      marginTop: 72,
      marginBottom: 72,
    }
  );
}

function furniture(footers: readonly [string, Story][], titlePage = false): PageFurniture {
  return {
    titlePage,
    evenAndOddHeaders: false,
    headers: new Map(),
    footers: new Map(footers) as PageFurniture['footers'],
  };
}

/** Every body line on a page, with its content-relative left edge and top. */
function bodyLines(page: Page): { text: string; x: number; y: number }[] {
  return page.fragments.flatMap((fragment) =>
    fragment.kind === 'paragraph'
      ? fragment.lines.map((line) => ({
          text: line.spans.map((span) => span.text).join(''),
          x: Math.min(...line.spans.map((span) => span.box.x)),
          y: line.box.y,
        }))
      : []
  );
}

/** Continued-section lines the picture's content-relative band (x 0..200) holds. */
function continuedLinesUnder(page: Page, bandTop: number): string[] {
  return bodyLines(page)
    .filter((line) => line.text.startsWith('B'))
    .filter((line) => line.y + 14 > bandTop && line.y < bandTop + 200 && line.x < 200)
    .map((line) => line.text);
}

const shifted = (page: Page) =>
  bodyLines(page)
    .filter((line) => line.text.startsWith('B') && line.x > 0)
    .map((line) => line.text);

function lay(
  body: string,
  sectionFurniture: readonly PageFurniture[],
  session?: LayoutSession
): SemanticLayout {
  return layoutSemanticDocument(load(body), 1, {
    measurer,
    sectionFurniture,
    ...(session ? { session } : {}),
  });
}

const BODY = lines(19, 'A') + ending('Aend') + lines(20, 'B') + sectPr('continuous');
const BODY_TITLE = lines(19, 'A') + ending('Aend') + lines(20, 'B') + sectPr('continuous', true);
const PLAIN = textFooter(['F'], '/word/footer1.xml');
const TALL = textFooter(['T1', 'T2', 'T3', 'T4'], '/word/footer2.xml');

describe('continued text on the host sheet wraps around the host furniture', () => {
  test('a host footer picture pushes continued text aside when the furniture differs', () => {
    const host = furniture([['default', wrapFooter('/word/footer3.xml', 300)]]);
    const layout = lay(BODY, [host, furniture([['default', TALL]])]);
    expect(layout.pages).toHaveLength(1);
    const page = layout.pages[0]!;
    expect(page.footer?.anchoredDrawings?.length).toBe(1);
    // Page y 300 is content y 228. Some continued lines fall in the band, and none under it.
    expect(bodyLines(page).some((line) => line.text.startsWith('B') && line.y >= 228)).toBe(true);
    expect(continuedLinesUnder(page, 228)).toEqual([]);
    expect(shifted(page).length).toBeGreaterThan(0);
    // The same text lays out as it does when both sections share the host furniture.
    const control = lay(BODY, [host, host]);
    expect(bodyLines(page)).toEqual(bodyLines(control.pages[0]!));
  });

  test("a continued section's own first-page picture does not shape the host sheet", () => {
    const withPicture = furniture(
      [
        ['default', PLAIN],
        ['first', wrapFooter('/word/footer4.xml', 300)],
      ],
      true
    );
    const layout = lay(BODY_TITLE, [furniture([['default', PLAIN]]), withPicture]);
    expect(layout.pages).toHaveLength(1);
    const page = layout.pages[0]!;
    expect(page.footer?.anchoredDrawings).toBeUndefined();
    expect(shifted(page)).toEqual([]);
    const control = lay(BODY_TITLE, [
      furniture([['default', PLAIN]]),
      furniture([['default', PLAIN]], true),
    ]);
    expect(bodyLines(page)).toEqual(bodyLines(control.pages[0]!));
  });

  test('moving only the host picture relays the continued text like a fresh layout', () => {
    // Same footer height before and after, so only the host zones differ for section 2.
    const section2 = furniture([['default', TALL]]);
    const session = createLayoutSession();
    lay(BODY, [furniture([['default', wrapFooter('/word/footer5.xml', 100)]]), section2], session);
    const moved = furniture([['default', wrapFooter('/word/footer5.xml', 300)]]);
    const retained = lay(BODY, [moved, section2], session);
    const fresh = lay(BODY, [moved, section2]);
    expect(retained.pages.map(bodyLines)).toEqual(fresh.pages.map(bodyLines));
    expect(continuedLinesUnder(retained.pages[0]!, 228)).toEqual([]);
  });
});
