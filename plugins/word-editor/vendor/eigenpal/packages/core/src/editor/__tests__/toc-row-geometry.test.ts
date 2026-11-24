import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { paragraphFragmentsOf } from '../../layout/index.ts';
import { TOC_LEVEL_INDENT_TWIPS } from '../../store/package/toc-build.ts';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

/** Content width of the default US-Letter page with one-inch margins, in points. */
const RIGHT_MARGIN_PT = 468;
const INDENT_STEP_PT = TOC_LEVEL_INDENT_TWIPS / 20;

// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

const STYLES =
  `<w:styles xmlns:w="${W}">` +
  FORMAT_DOC_DEFAULTS +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>' +
  // Indented like Word's own toc 2, so a nested row's tab is resolved from a paragraph origin
  // that is not the text column's.
  '<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/>' +
  '<w:pPr><w:ind w:left="220"/></w:pPr></w:style>' +
  '</w:styles>';

const SECTION =
  '<w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>';

/**
 * A real font's advances are not multiples of anything, and that is what the geometry under
 * test depends on: a right-aligned positional tab derives its advance by subtracting the
 * accumulated line width from the right margin, so the page number lands on the margin only
 * to within the rounding of those sums. The deterministic fixed measurer works on a whole-point
 * grid where that rounding cannot occur, so it cannot see the arrangement a reader gets.
 */
function fractionalCanvasContext(): CanvasRenderingContext2D {
  let font = '11px serif';
  return {
    get font() {
      return font;
    },
    set font(value: string) {
      font = value;
    },
    measureText(text: string) {
      const sizePx = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 11);
      return {
        width: text.length * sizePx * 0.61,
        fontBoundingBoxAscent: sizePx * 0.9,
        fontBoundingBoxDescent: sizePx * 0.21,
      };
    },
  } as unknown as CanvasRenderingContext2D;
}

function heading(level: 1 | 2, text: string): string {
  return (
    `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>` +
    `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
  );
}

function filler(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `<w:p><w:r><w:t>Body paragraph number ${index + 1}.</w:t></w:r></w:p>`
  ).join('');
}

/**
 * Two sections, each spilling over a page, so the TOC is refreshed against a multi-section
 * pagination whose page numbers only settle across the refresh's convergence passes.
 */
function multiSectionDocument(): Uint8Array {
  const firstSection =
    heading(1, 'Overview') +
    filler(40) +
    heading(1, 'Headers and Footers') +
    filler(40) +
    heading(2, 'Formatting') +
    filler(40) +
    heading(1, 'A Heading Long Enough That It Cannot Fit Beside Its Page Number On A Single Line') +
    `<w:p><w:pPr><w:sectPr>${SECTION}</w:sectPr></w:pPr></w:p>`;
  const secondSection =
    heading(1, 'Tables Lists And Numbering') +
    filler(40) +
    heading(2, 'Typography') +
    filler(40) +
    heading(1, 'Fields Bookmarks And Cross References');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${STYLE_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${firstSection}${secondSection}` +
        `<w:sectPr>${SECTION}</w:sectPr></w:body></w:document>`
    ),
  });
}

interface TocRow {
  readonly id: string;
  readonly text: string;
  readonly lineCount: number;
  readonly textStartPt: number;
  readonly pageNumberEndPt: number;
  readonly tabLine: string;
}

/** Every published row carrying the dot-leader tab a generated TOC entry is built with. */
function tocRowsOf(editor: ReturnType<typeof createDocxEditor>): readonly TocRow[] {
  const rows: TocRow[] = [];
  for (const page of editor.surface!.layout().pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      const tabLine = fragment.lines.find((line) =>
        line.spans.some((span) => span.text === '\t' && span.tabLeader === 'dot')
      );
      if (!tabLine) continue;
      const last = tabLine.spans[tabLine.spans.length - 1]!;
      rows.push({
        id: fragment.id,
        text: fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join(''),
        lineCount: fragment.lines.length,
        textStartPt: tabLine.spans[0]!.box.x,
        pageNumberEndPt: last.box.x + last.box.width,
        tabLine: tabLine.spans.map((span) => span.text).join(''),
      });
    }
  }
  return rows;
}

describe('generated TOC row geometry', () => {
  test('rows keep their heading whole and their page number on the right margin', () => {
    const previousGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = ((kind: string) =>
      kind === '2d' ? fractionalCanvasContext() : null) as typeof previousGetContext;
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    try {
      const errors: string[] = [];
      editor.on('error', (error) => errors.push(`${error.code}: ${error.message}`));
      editor.load(multiSectionDocument());
      expect(errors).toEqual([]);

      expect(editor.exec({ type: 'insertToc' })).toEqual({ ok: true, changed: true });
      const rows = tocRowsOf(editor);
      // One row per heading, so a row lost to a wrap cannot pass by disappearing.
      expect(rows).toHaveLength(7);

      for (const row of rows) {
        // The page number is what the tab was positioned for, so it must reach the margin.
        expect(row.pageNumberEndPt).toBeCloseTo(RIGHT_MARGIN_PT, 3);
        // A heading that fits beside its page number stays on one line; the one heading too
        // long for that wraps, and its tail — not the page number — is what moves down.
        expect(row.lineCount).toBe(row.text.includes('Long Enough') ? 2 : 1);
        // Whatever line the tab landed on ends with the dot leader and the page number, so a
        // heading word carried past the tab would show up here.
        expect(row.tabLine).toMatch(/^\S.*\t\d+$/);
      }

      // Page numbers settled on the pages the headings actually landed on, so the refresh
      // converged instead of publishing the pass that seeded it.
      expect(rows.map((row) => row.tabLine.split('\t')[1])).toEqual([
        '1',
        '1',
        '2',
        '3',
        '4',
        '4',
        '5',
      ]);
    } finally {
      editor.destroy();
      container.remove();
      HTMLCanvasElement.prototype.getContext = previousGetContext;
    }
  });

  test('nested rows step in by the fixture increment while page numbers stay aligned', () => {
    const previousGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = ((kind: string) =>
      kind === '2d' ? fractionalCanvasContext() : null) as typeof previousGetContext;
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    try {
      editor.load(multiSectionDocument());
      expect(editor.exec({ type: 'insertToc' })).toEqual({ ok: true, changed: true });
      const rows = tocRowsOf(editor);
      const overview = rows.find((row) => row.text.startsWith('Overview'));
      const formatting = rows.find((row) => row.text.startsWith('Formatting'));
      expect(overview).toBeDefined();
      expect(formatting).toBeDefined();
      expect(overview!.textStartPt).toBeCloseTo(0, 3);
      expect(formatting!.textStartPt - overview!.textStartPt).toBeCloseTo(INDENT_STEP_PT, 3);
      for (const row of rows) {
        expect(row.pageNumberEndPt).toBeCloseTo(RIGHT_MARGIN_PT, 3);
      }
    } finally {
      editor.destroy();
      container.remove();
      HTMLCanvasElement.prototype.getContext = previousGetContext;
    }
  });
});
