import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/index.ts';
import { withSectionBreakMarks } from '../../layout/section-break-marks.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import {
  DEFAULT_BREAK_MARK_STRINGS,
  breakMarkStringsFromTranslate,
  breakMarksOfLayout,
  paintParagraphEndFurniture,
} from '../semantic-break-marks.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(body: string) {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const sect = (type?: string) =>
  `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}<w:pgSz w:w="6000" w:h="6000"/>` +
  '<w:pgMar w:top="400" w:bottom="400" w:left="400" w:right="400"/></w:sectPr>';

function paint(body: string, options: Parameters<typeof paintSemanticLayout>[2] = {}) {
  const layout = layoutSemanticDocument(part(body), 0, { measurer: createFixedMeasurer(6, 14) });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1, showParagraphMarks: true, ...options });
  return { layout, container };
}

function labels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.docx-break-mark-label')].map((el) => el.textContent!);
}

function paragraphElement(container: HTMLElement, text: string): HTMLElement {
  const line = [...container.querySelectorAll<HTMLElement>('.docx-line')].find((el) =>
    el.textContent?.startsWith(text)
  );
  return line!.closest<HTMLElement>('[data-paragraph-id]')!;
}

test('page and column breaks show a labeled rule from the content end to the band edge', () => {
  const { layout, container } = paint(
    '<w:p><w:r><w:t>asdads</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>' +
      '<w:p><w:r><w:t>Mid</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>after</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Col</w:t></w:r><w:r><w:br w:type="column"/></w:r><w:r><w:t>next</w:t></w:r></w:p>' +
      sect()
  );
  expect(labels(container)).toEqual(['Page break', 'Page break', 'Column break']);
  for (const mark of container.querySelectorAll<HTMLElement>('.docx-break-mark')) {
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.getAttribute('contenteditable')).toBe('false');
    expect(mark.hasAttribute('data-docx-marker')).toBe(true);
    expect(mark.style.pointerEvents).toBe('none');
    expect(mark.parentElement?.classList.contains('docx-line')).toBe(true);
    expect(mark.querySelectorAll('.docx-break-mark-rule')).toHaveLength(2);
  }
  // The rule starts at the content end and fills the rest of the band.
  const first = layout.pages[0]!.fragments[0]!;
  if (first.kind !== 'paragraph') throw new Error('expected a paragraph');
  const line = first.lines[0]!;
  expect(line.breakAfter).toBe('page');
  const text = line.spans.find((span) => span.text === 'asdads')!;
  const contentEnd = text.box.x + text.box.width - line.contentX;
  expect(contentEnd).toBeGreaterThan(0);
  const mark = container.querySelector<HTMLElement>('.docx-break-mark')!;
  expect(parseFloat(mark.style.left)).toBeCloseTo(contentEnd);
  expect(parseFloat(mark.style.width)).toBeCloseTo(
    line.box.x + line.box.width - line.contentX - contentEnd
  );
  // The paragraph ends on the break line, so its pilcrow moves past the label.
  const pilcrowSeat = paragraphElement(container, 'asdads')
    .querySelector('.docx-paragraph-mark')!
    .closest<HTMLElement>('.docx-terminator-seat')!;
  expect(parseFloat(pilcrowSeat.style.left)).toBeCloseTo(
    line.box.x + line.box.width - line.contentX
  );
});

test('a mid-paragraph break keeps the pilcrow at the end of the remaining text', () => {
  const { layout, container } = paint(
    '<w:p><w:r><w:t>Mid</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>after</w:t></w:r></w:p>' +
      sect()
  );
  const fragment = layout.pages[1]!.fragments[0]!;
  if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph');
  const span = fragment.lines[0]!.spans.find((s) => s.text === 'after')!;
  const remainder = paragraphElement(container, 'after');
  const seat = remainder.querySelector('.docx-paragraph-mark')!.parentElement!;
  expect(parseFloat(seat.style.left)).toBeCloseTo(
    span.box.x + span.box.width - fragment.lines[0]!.contentX
  );
  expect(remainder.querySelector('.docx-break-mark')).toBeNull();
});

test('section breaks replace the pilcrow and are named by the section that follows', () => {
  const { layout, container } = paint(
    `<w:p><w:pPr>${sect()}</w:pPr><w:r><w:t>One</w:t></w:r></w:p>` +
      `<w:p><w:pPr>${sect('continuous')}</w:pPr><w:r><w:t>Two</w:t></w:r></w:p>` +
      `<w:p><w:pPr>${sect('evenPage')}</w:pPr><w:r><w:t>Three</w:t></w:r></w:p>` +
      `<w:p><w:pPr>${sect('oddPage')}</w:pPr><w:r><w:t>Four</w:t></w:r></w:p>` +
      `<w:p><w:pPr>${sect('nextColumn')}</w:pPr><w:r><w:t>Five</w:t></w:r></w:p>` +
      '<w:p><w:r><w:t>Last</w:t></w:r></w:p>' +
      sect()
  );
  expect(layout.sectionBreaks?.map((mark) => mark.kind)).toEqual([
    'continuous',
    'evenPage',
    'oddPage',
    'nextColumn',
    'nextPage',
  ]);
  expect(labels(container)).toEqual([
    'Section break (continuous)',
    'Section break (even page)',
    'Section break (odd page)',
    'Section break (new column)',
    'Section break (next page)',
  ]);
  for (const text of ['One', 'Two', 'Three', 'Four', 'Five']) {
    expect(paragraphElement(container, text).querySelector('.docx-paragraph-mark')).toBeNull();
  }
  expect(paragraphElement(container, 'Last').querySelector('.docx-paragraph-mark')).not.toBeNull();
});

test('break labels follow Show/Hide and repaint when the labels change', () => {
  const body =
    '<w:p><w:r><w:t>A</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>' +
    `<w:p><w:pPr>${sect()}</w:pPr><w:r><w:t>B</w:t></w:r></w:p>` +
    sect('continuous');
  const layout = layoutSemanticDocument(part(body), 0, { measurer: createFixedMeasurer(6, 14) });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  expect(container.querySelector('.docx-break-mark')).toBeNull();
  paintSemanticLayout(container, layout, { scale: 1, showParagraphMarks: true });
  expect(labels(container)).toEqual(['Page break', 'Section break (continuous)']);
  const t = (key: string) =>
    key === 'formattingMarks.pageBreak' ? 'Podział strony' : key.replace(/^x/, '');
  paintSemanticLayout(container, layout, {
    scale: 1,
    showParagraphMarks: true,
    breakMarkStrings: breakMarkStringsFromTranslate(t),
  });
  // A translate that echoes an unknown key falls back to English instead of painting the key.
  expect(labels(container)).toEqual(['Podział strony', 'Section break (continuous)']);
  paintSemanticLayout(container, layout, { scale: 1, showParagraphMarks: false });
  expect(container.querySelector('.docx-break-mark')).toBeNull();
});

test('a page break ending a section mark paragraph shows both labels on one line', () => {
  const { container } = paint(
    `<w:p><w:pPr>${sect()}</w:pPr><w:r><w:t>End</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>` +
      '<w:p><w:r><w:t>Next</w:t></w:r></w:p>' +
      sect('continuous')
  );
  const marks = paragraphElement(container, 'End').querySelectorAll('.docx-break-mark');
  expect(marks).toHaveLength(1);
  expect(labels(marks[0] as HTMLElement)).toEqual(['Page break', 'Section break (continuous)']);
});

test('a tracked mark on a section break paragraph keeps its attributed pilcrow', () => {
  const { container } = paint(
    `<w:p><w:pPr><w:rPr><w:ins w:id="7" w:author="Ada"/></w:rPr>${sect()}</w:pPr><w:r><w:t>Tracked</w:t></w:r></w:p>` +
      '<w:p><w:r><w:t>Next</w:t></w:r></w:p>' +
      sect()
  );
  const paragraph = paragraphElement(container, 'Tracked');
  expect(labels(paragraph)).toEqual(['Section break (next page)']);
  const pilcrow = paragraph.querySelector<HTMLElement>('.docx-paragraph-mark')!;
  expect(pilcrow.dataset.revisionId).toBe('7');
});

test('section break records keep the layout identity and follow the whole body', () => {
  const body =
    `<w:p><w:pPr>${sect()}</w:pPr></w:p>` +
    `<w:p><w:pPr>${sect('continuous')}</w:pPr></w:p><w:p/>` +
    sect('oddPage');
  const source = part(body);
  const layout = layoutSemanticDocument(source, 0, { measurer: createFixedMeasurer(6, 14) });
  expect(layout.sectionBreaks?.map((mark) => mark.kind)).toEqual(['continuous', 'oddPage']);
  // An opening slice that stops at the first break still names it by the real next section.
  const sliced = layoutSemanticDocument(source, 0, {
    measurer: createFixedMeasurer(6, 14),
    bodyBlockLimit: 1,
  });
  expect(sliced.sectionBreaks?.map((mark) => mark.kind)).toEqual(['continuous', 'oddPage']);
  expect(withSectionBreakMarks(layout, source, [])).not.toBe(layout);
  expect(withSectionBreakMarks(layout, source, []).sectionBreaks).toBeUndefined();
});

test('a collapsed empty section mark draws its label between blocks, across the whole band', () => {
  const { layout, container } = paint(
    '<w:p><w:r><w:t>Before</w:t></w:r></w:p>' +
      `<w:p><w:pPr><w:jc w:val="center"/>${sect()}</w:pPr></w:p>` +
      '<w:p><w:r><w:t>After</w:t></w:r></w:p>' +
      sect('continuous')
  );
  const fragment = layout.pages[0]!.fragments.find(
    (f) => f.kind === 'paragraph' && f.paragraphId === layout.sectionBreaks![0]!.paragraphId
  );
  if (fragment?.kind !== 'paragraph') throw new Error('expected the mark paragraph');
  expect(fragment.outOfFlow).toBe(true);
  const line = fragment.lines[0]!;
  const mark = container.querySelector<HTMLElement>('.docx-break-mark')!;
  expect(mark.textContent).toBe('Section break (continuous)');
  // Centred on the line's top edge, not on its baseline, so it clears the next line's text.
  expect(mark.style.top).toBe(`${-8 / 2}px`);
  expect(mark.style.bottom).toBe('');
  // The whole band, although the empty paragraph is centred.
  expect(parseFloat(mark.style.left)).toBeCloseTo(line.box.x - line.contentX);
  expect(parseFloat(mark.style.width)).toBeCloseTo(line.box.width);
});

test('a tracked page break label carries its revision', () => {
  const { container } = paint(
    '<w:p><w:r><w:t>Text</w:t></w:r><w:ins w:id="9" w:author="Ada"><w:r><w:br w:type="page"/></w:r></w:ins></w:p>' +
      sect()
  );
  const segment = container.querySelector<HTMLElement>('.docx-break-mark-segment')!;
  expect(segment.textContent).toBe('Page break');
  expect(segment.dataset.revisionId).toBe('9');
  expect(segment.dataset.revisionKind).toBe('insert');
  expect(segment.dataset.reviewAuthor).toBe('Ada');
});

test('furniture stories paint no break labels', () => {
  const { layout } = paint(
    '<w:p><w:r><w:t>A</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>' + sect()
  );
  const fragment = layout.pages[0]!.fragments[0]!;
  if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph');
  const breakMarks = breakMarksOfLayout(layout, DEFAULT_BREAK_MARK_STRINGS);
  const paintLines = () => fragment.lines.map(() => document.createElement('div'));
  const body = paintLines();
  paintParagraphEndFurniture(document, fragment, body, { showParagraphMarks: true, breakMarks }, 1);
  expect(body[0]!.querySelector('.docx-break-mark')).not.toBeNull();
  // Headers, footers and text boxes paint with inert links.
  const furniture = paintLines();
  paintParagraphEndFurniture(
    document,
    fragment,
    furniture,
    { showParagraphMarks: true, breakMarks, inertLinks: true },
    1
  );
  expect(furniture[0]!.querySelector('.docx-break-mark')).toBeNull();
  expect(furniture[0]!.querySelector('.docx-paragraph-mark')).not.toBeNull();
});

test('a centred line holding only a page break labels the whole band', () => {
  const { layout, container } = paint(
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>' + sect()
  );
  const fragment = layout.pages[0]!.fragments[0]!;
  if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph');
  const line = fragment.lines[0]!;
  expect(line.breakAfter).toBe('page');
  const mark = container.querySelector<HTMLElement>('.docx-break-mark')!;
  expect(parseFloat(mark.style.left)).toBeCloseTo(line.box.x - line.contentX);
  expect(parseFloat(mark.style.width)).toBeCloseTo(line.box.width);
});

test('the empty line kept before a leading page break paints no label', () => {
  const { layout } = paint(
    '<w:p><w:r><w:br w:type="page"/></w:r><w:r><w:t>Next</w:t></w:r></w:p>' + sect()
  );
  const fragment = layout.pages[0]!.fragments[0]!;
  if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph');
  expect(fragment.lines[0]!.breakAfter).toBe('page');
  const kept = { ...fragment, outOfFlow: true as const };
  const lines = kept.lines.map(() => document.createElement('div'));
  const breakMarks = breakMarksOfLayout(layout, DEFAULT_BREAK_MARK_STRINGS);
  paintParagraphEndFurniture(document, kept, lines, { showParagraphMarks: true, breakMarks }, 1);
  expect(lines[0]!.querySelector('.docx-break-mark')).toBeNull();
});
