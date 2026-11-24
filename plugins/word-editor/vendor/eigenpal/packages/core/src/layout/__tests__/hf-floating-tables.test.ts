import { describe, expect, test } from 'bun:test';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { bodyParagraphBreakKey } from '../paragraph-break-request.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';
import { load, layoutContext, squareAnchorAtLeft } from './anchored-drawing-test-fixtures.ts';

const measurer = createFixedMeasurer(6, 14);
const OWNER = '/word/header1.xml';
/** `w:tblpX`/`w:tblpY` twips carry a one-twip storage bias (MS-OE376 2.1.163e). */
const offsetPt = (twips: number) => (twips - 1) / 20;
const PAGE = {
  pageNumber: 1,
  pageWidth: 612,
  pageHeight: 792,
  marginLeft: 72,
  marginRight: 72,
  marginTop: 144,
  marginBottom: 72,
};
const PAGE_ANCHOR =
  '<w:tblpPr w:vertAnchor="page" w:horzAnchor="page" w:tblpX="6238" w:tblpY="2723"/>';
// The picture fixture's root carries the drawing namespaces; its first run is the picture.
const PICTURE_XML = squareAnchorAtLeft({ text: '' });
const ROOT_ATTRIBUTES = PICTURE_XML.slice('<w:document'.length, PICTURE_XML.indexOf('>'));
const PICTURE_RUN = PICTURE_XML.slice(
  PICTURE_XML.indexOf('<w:r><w:drawing>'),
  PICTURE_XML.indexOf('</w:drawing></w:r>') + '</w:drawing></w:r>'.length
);

const WORDS = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
/** A paragraph long enough to wrap over several lines at the story width. */
const longParagraph = (label: string) =>
  `<w:p><w:r><w:t xml:space="preserve">${label} ${WORDS} ${WORDS} ${WORDS} ${WORDS} ${WORDS}</w:t></w:r></w:p>`;
const table = (tblpPr: string, cell = '<w:r><w:t>Ref</w:t></w:r>', width = 2000) =>
  `<w:tbl><w:tblPr>${tblpPr}<w:tblW w:w="${width}" w:type="dxa"/></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="${width}"/></w:tblGrid>` +
  `<w:tr><w:trPr><w:trHeight w:val="1200" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>` +
  `<w:p>${cell}</w:p></w:tc></w:tr></w:tbl>`;

/** A header of `blocks` followed by a `Title` paragraph, laid out on {@link PAGE}. */
function header(
  blocks: string,
  options: {
    readonly storyTop?: number;
    readonly storyDistance?: number;
    readonly footer?: boolean;
    readonly compatibilityMode?: number;
  } = { storyTop: 36 }
) {
  const tag = options.footer ? 'ftr' : 'hdr';
  const part = load(
    `<w:${tag}${ROOT_ATTRIBUTES}>${blocks}<w:p><w:r><w:t>Title</w:t></w:r></w:p></w:${tag}>`,
    options.footer ? '/word/footer1.xml' : OWNER
  );
  const story = layoutHeaderFooterStory(
    part,
    468,
    measurer,
    'test',
    undefined,
    undefined,
    options.storyTop === undefined
      ? undefined
      : { pageNumber: 1, pageCount: 1, storyTop: options.storyTop },
    128,
    undefined,
    undefined,
    layoutContext(part, OWNER),
    undefined,
    undefined,
    {
      ...PAGE,
      ...(options.storyDistance !== undefined ? { storyDistance: options.storyDistance } : {}),
    },
    undefined,
    options.compatibilityMode === undefined
      ? undefined
      : { compatibilityMode: options.compatibilityMode }
  );
  const tables = story.fragments.filter((f) => f.kind === 'table') as TableFragmentRecord[];
  const title = story.fragments.find((f) => f.kind === 'paragraph') as ParagraphFragmentRecord;
  return { story, table: tables[0]!, tables, title };
}

// A top-level `tblpPr` table in a header sits at its anchor position, and the blocks after it
// start where the table would have started.
describe('floating tables in a header', () => {
  test('a header frame beside a floating table keeps its ordinary-flow fallback', () => {
    const framePr =
      '<w:framePr w:wrap="around" w:vAnchor="text" w:hAnchor="margin" w:xAlign="inside" w:y="1"/>';
    const frame = `<w:p><w:pPr>${framePr}</w:pPr><w:r><w:t>1</w:t></w:r></w:p>`;
    const running = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Head</w:t></w:r></w:p>';
    const source = frame + running + table(PAGE_ANCHOR);
    const candidate = header(source);
    const control = header(source.replace(framePr, ''));
    const paragraphBoxes = (story: typeof candidate.story) =>
      story.fragments
        .filter((fragment) => fragment.kind === 'paragraph')
        .map((fragment) => fragment.box);
    expect(candidate.story.flowHeight).toBe(control.story.flowHeight);
    expect(paragraphBoxes(candidate.story)).toEqual(paragraphBoxes(control.story));
    expect(candidate.tables).toHaveLength(1);
    expect(candidate.table.box).toEqual(control.table.box);
    expect((candidate.table as { outOfFlow?: true }).outOfFlow).toBe(true);
  });

  test('a page-anchored table sits at its page position, outside the header flow', () => {
    const { story, table: placed, title } = header(table(PAGE_ANCHOR));
    // Story coordinates: x from the left margin, y from the header top at 36pt.
    expect(placed.box.x).toBeCloseTo(offsetPt(6238) - 72, 3);
    expect(placed.box.y).toBeCloseTo(offsetPt(2723) - 36, 3);
    expect((placed as { outOfFlow?: true }).outOfFlow).toBe(true);
    expect(title.box.y).toBe(0);
    expect(story.flowHeight).toBeCloseTo(title.box.height, 3);
  });

  test('a margin-anchored table measures from the top margin', () => {
    const { table: placed } = header(
      table('<w:tblpPr w:vertAnchor="margin" w:horzAnchor="margin" w:tblpX="200" w:tblpY="400"/>')
    );
    expect(placed.box.x).toBeCloseTo(offsetPt(200), 3);
    expect(placed.box.y).toBeCloseTo(144 - 36 + offsetPt(400), 3);
  });

  test('a text-anchored table measures from the next block in flow', () => {
    const textAnchor =
      '<w:tblpPr w:vertAnchor="text" w:horzAnchor="text" w:tblpX="0" w:tblpY="200"/>';
    const { tables, title } = header(table(textAnchor) + table(PAGE_ANCHOR));
    expect(title.box.y).toBe(0);
    // The page-anchored table between them floats too, so `Title` is the anchor.
    expect(tables[0]!.box.y).toBeCloseTo(offsetPt(200), 3);
  });

  test('a picture inside a floating table is still published', () => {
    const { story } = header(table(PAGE_ANCHOR, PICTURE_RUN));
    expect(story.anchoredDrawings).toHaveLength(1);
  });

  test('the story distance places the table before any page context exists', () => {
    const { story, table: placed, title } = header(table(PAGE_ANCHOR), { storyDistance: 36 });
    expect(placed.box.y).toBeCloseTo(offsetPt(2723) - 36, 3);
    expect((placed as { outOfFlow?: true }).outOfFlow).toBe(true);
    expect(title.box.y).toBe(0);
    expect(story.flowHeight).toBeCloseTo(title.box.height, 3);
  });

  test('a footer measures its top edge from the sheet bottom', () => {
    const { table: placed, title } = header(
      table('<w:tblpPr w:vertAnchor="page" w:horzAnchor="page" w:tblpX="1440" w:tblpY="14000"/>'),
      { storyDistance: 36, footer: true }
    );
    // The footer's flow is the title alone, so its top edge is 36pt plus that height up.
    const footerTop = 792 - 36 - title.box.height;
    expect(placed.box.y).toBeCloseTo(offsetPt(14000) - footerTop, 3);
  });

  test('a page-framed table that would pass the sheet bottom moves up onto the sheet', () => {
    const { table: placed, title } = header(
      table('<w:tblpPr w:vertAnchor="page" w:horzAnchor="page" w:tblpX="1440" w:tblpY="15600"/>'),
      { storyDistance: 36, footer: true }
    );
    const footerTop = 792 - 36 - title.box.height;
    expect(footerTop + placed.box.y + placed.box.height).toBeCloseTo(792, 3);
  });

  test('without page geometry the table stays in the flow', () => {
    const { table: placed, title } = header(table(PAGE_ANCHOR), {});
    expect(placed.box.y).toBe(0);
    expect(title.box.y).toBeGreaterThan(0);
  });
});

// Later story blocks wrap around a floating table: beside it when it leaves room, below it
// when it spans the story. The story's flow height, and so the body top, grows with them.
describe('story blocks wrap around a floating table', () => {
  const TEXT_ANCHOR =
    '<w:tblpPr w:vertAnchor="text" w:horzAnchor="margin" w:tblpXSpec="center" w:tblpY="1"/>';
  const wide = (tblpPr = TEXT_ANCHOR) => table(tblpPr, undefined, 9360);
  const MODERN = { storyTop: 36, compatibilityMode: 15 };

  test('a table as wide as the story moves the next paragraph below it', () => {
    const { story, table: placed, title } = header(wide(), MODERN);
    expect(placed.box.y).toBeCloseTo(0, 3);
    expect(placed.box.height).toBeCloseTo(60, 0);
    const bottom = placed.box.y + placed.box.height;
    expect(title.lines[0]!.box.y).toBeGreaterThanOrEqual(bottom - 0.01);
    expect(story.flowHeight).toBeGreaterThanOrEqual(bottom + title.lines[0]!.box.height - 0.01);
  });

  test('a narrow table leaves the paragraph beside it and the height unchanged', () => {
    const narrow =
      '<w:tblpPr w:vertAnchor="text" w:horzAnchor="margin" w:tblpXSpec="right" w:tblpY="1"/>';
    const { story, title } = header(table(narrow), MODERN);
    expect(title.lines[0]!.box.y).toBe(0);
    expect(story.flowHeight).toBeCloseTo(title.box.height, 3);
  });

  test('the paragraph a narrow table anchors to wraps beside it from its first line', () => {
    const left =
      '<w:tblpPr w:vertAnchor="text" w:horzAnchor="margin" w:tblpXSpec="left" w:tblpY="1"/>';
    const { table: placed, title } = header(table(left) + longParagraph('First'), MODERN);
    const right = placed.box.x + placed.box.width;
    const beside = title.lines.filter((line) => line.box.y < placed.box.y + placed.box.height);
    expect(beside.length).toBeGreaterThan(1);
    for (const line of beside) expect(line.contentX).toBeGreaterThanOrEqual(right - 0.01);
  });

  test('a table raised above its anchor does not move the paragraph before it', () => {
    const raised = TEXT_ANCHOR.replace('w:tblpY="1"', 'w:tblpY="-199"');
    const lead = '<w:p><w:r><w:t>Lead</w:t></w:r></w:p>';
    const { story } = header(lead + wide(raised), MODERN);
    const paragraphs = story.fragments.filter(
      (fragment): fragment is ParagraphFragmentRecord => fragment.kind === 'paragraph'
    );
    const [first, second] = paragraphs.map((paragraph) => paragraph.lines[0]!.box.y);
    expect(first).toBe(0);
    const placed = story.fragments.find((fragment) => fragment.kind === 'table')!;
    expect(placed.box.y).toBeLessThan(paragraphs[1]!.box.y);
    expect(second).toBeGreaterThanOrEqual(placed.box.y + placed.box.height - 0.01);
  });

  test('a footer grows upward by the wrapped flow', () => {
    const {
      story,
      table: placed,
      title,
    } = header(wide(), { storyDistance: 36, footer: true, compatibilityMode: 15 });
    expect(title.lines[0]!.box.y).toBeGreaterThanOrEqual(placed.box.y + placed.box.height - 0.01);
    expect(story.flowHeight).toBeGreaterThan(60);
    // The table measures its text anchor from the footer's top edge, after the growth.
    expect(placed.box.y).toBeCloseTo(0, 3);
  });

  test('a page-framed footer table keeps its page position and never overlaps the text', () => {
    // The footer's bottom edge is fixed at 756pt. Its text moves below a table that ends above
    // that edge, and above one that passes it; the table stays at its page position.
    const below: number[] = [];
    const above: number[] = [];
    for (let y = 13000; y <= 15800; y += 100) {
      const tblpPr = `<w:tblpPr w:vertAnchor="page" w:horzAnchor="margin" w:tblpXSpec="center" w:tblpY="${y}"/>`;
      const {
        story,
        table: placed,
        title,
      } = header(wide(tblpPr), {
        storyDistance: 36,
        footer: true,
        compatibilityMode: 15,
      });
      const footerTop = 756 - story.flowHeight;
      const tableTop = placed.box.y;
      const tableBottom = tableTop + placed.box.height;
      expect(footerTop + tableTop).toBeCloseTo(Math.min(offsetPt(y), 792 - 60), 3);
      const line = title.lines[0]!.box;
      const clear = line.y >= tableBottom - 0.01 || line.y + line.height <= tableTop + 0.01;
      expect(clear).toBe(true);
      if (line.y > 0) below.push(y);
      if (
        footerTop + line.y + line.height <= footerTop + tableTop + 0.01 &&
        line.y + footerTop < 742
      )
        above.push(y);
    }
    // A table ending above the bottom edge pushes the text below it; one past it lifts it.
    expect(below).toContain(13800);
    expect(above).toContain(14400);
  });

  test('a footer takes the page top it is handed, and its height is a fixed point', () => {
    // The page furniture hands a footer the top its own last height implies and repeats until
    // the height stops changing. A table that lifts the text must give the same answer then.
    const tblpPr =
      '<w:tblpPr w:vertAnchor="page" w:horzAnchor="margin" w:tblpXSpec="center" w:tblpY="14400"/>';
    const cold = header(wide(tblpPr), { storyDistance: 36, footer: true, compatibilityMode: 15 });
    const handed = header(wide(tblpPr), {
      storyDistance: 36,
      footer: true,
      compatibilityMode: 15,
      storyTop: 756 - cold.story.flowHeight,
    });
    expect(handed.story.flowHeight).toBeCloseTo(cold.story.flowHeight, 6);
    expect(handed.table.box.y).toBeCloseTo(cold.table.box.y, 6);
    expect(handed.title.lines[0]!.box.y).toBeCloseTo(cold.title.lines[0]!.box.y, 6);
  });

  test('the handed footer top converges for every page-framed table position', () => {
    for (let y = 13000; y <= 15800; y += 200) {
      const tblpPr = `<w:tblpPr w:vertAnchor="page" w:horzAnchor="margin" w:tblpXSpec="center" w:tblpY="${y}"/>`;
      const options = { storyDistance: 36, footer: true, compatibilityMode: 15 } as const;
      let height = header(wide(tblpPr), options).story.flowHeight;
      let settled = false;
      // The page furniture's own loop: hand the top the last height implies, eight times.
      for (let pass = 0; pass < 8 && !settled; pass += 1) {
        const next = header(wide(tblpPr), { ...options, storyTop: 756 - height }).story.flowHeight;
        settled = Math.abs(next - height) <= 0.001;
        height = next;
      }
      expect(settled).toBe(true);
    }
  });

  test('footer text around a page-framed table always stays on the sheet', () => {
    // Text moved below a wide table rises above it when it would pass the sheet bottom. Text
    // wrapped beside a narrow table grows the footer upward, and never covers the table.
    const variants = [
      { xSpec: 'center', width: 9360, step: 100 },
      { xSpec: 'left', width: 3000, step: 200 },
      { xSpec: 'right', width: 3000, step: 200 },
    ];
    const bodies = [
      ...[0, 1, 2].map((extra) =>
        Array.from({ length: extra }, () => '<w:p><w:r><w:t>Line</w:t></w:r></w:p>').join('')
      ),
      ...[1, 2, 3].map((count) =>
        Array.from({ length: count }, (_, i) => longParagraph(`P${i}`)).join('')
      ),
    ];
    for (const { xSpec, width, step } of variants) {
      for (const storyDistance of [10, 36]) {
        for (const body of bodies) {
          for (let y = 14000; y <= 16000; y += step) {
            const tblpPr = `<w:tblpPr w:vertAnchor="page" w:horzAnchor="margin" w:tblpXSpec="${xSpec}" w:tblpY="${y}"/>`;
            const { story, table: placed } = header(table(tblpPr, undefined, width) + body, {
              storyDistance,
              footer: true,
              compatibilityMode: 15,
            });
            const footerTop = 792 - storyDistance - story.flowHeight;
            const tableTop = footerTop + placed.box.y;
            const tableBottom = tableTop + placed.box.height;
            for (const fragment of story.fragments) {
              if (fragment.kind !== 'paragraph') continue;
              for (const line of fragment.lines) {
                const top = footerTop + line.box.y;
                const bottom = top + line.box.height;
                expect(top).toBeGreaterThanOrEqual(0);
                expect(bottom).toBeLessThanOrEqual(792 + 0.01);
                if (bottom <= tableTop + 0.01 || top >= tableBottom - 0.01) continue;
                const ink = line.spans.filter((span) => span.text.trim() !== '');
                const left = Math.min(...ink.map((span) => span.box.x));
                const right = Math.max(...ink.map((span) => span.box.x + span.box.width));
                const clear =
                  right <= placed.box.x + 0.01 || left >= placed.box.x + placed.box.width - 0.01;
                expect(clear).toBe(true);
              }
            }
          }
        }
      }
    }
  });

  test('compatibility mode 14, or no mode, runs header text under the table', () => {
    for (const compatibilityMode of [14, undefined]) {
      const { story, title } = header(wide(), { storyTop: 36, compatibilityMode });
      expect(title.lines[0]!.box.y).toBe(0);
      expect(story.flowHeight).toBeCloseTo(title.box.height, 3);
    }
  });
});

describe('body break key and spacing before', () => {
  const key = (spaceBefore: number, anchorsTopAndBottom: boolean) =>
    bodyParagraphBreakKey('k', {
      exclusionToken: '',
      paragraphStartY: 100,
      paragraphSpaceBefore: spaceBefore,
      anchorsTopAndBottom,
      columnIndex: 0,
      startOffset: 0,
    });

  test('a paragraph with its own topAndBottom band keys its spacing before', () => {
    expect(key(12, true)).not.toBe(key(0, true));
  });

  test('other paragraphs keep the base key', () => {
    expect(key(12, false)).toBe('k');
  });
});
