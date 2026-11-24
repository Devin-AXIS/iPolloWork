import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/index.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(body: string) {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

test('manual breaks show one inert arrow each, including consecutive and trailing breaks in tables', () => {
  const body =
    '<w:p><w:r><w:t>A</w:t><w:br/><w:cr/><w:t>B</w:t><w:br w:type="textWrapping"/></w:r></w:p>' +
    '<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t><w:br/><w:cr/></w:r></w:p></w:tc></w:tr></w:tbl>';
  const source = part(body);
  const before = serializeOoxmlPart(source);
  const layout = layoutSemanticDocument(source, 0, { measurer: createFixedMeasurer(6, 14) });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  expect(container.querySelectorAll('.docx-line-break-mark')).toHaveLength(0);
  paintSemanticLayout(container, layout, { scale: 1, showParagraphMarks: true });
  const marks = container.querySelectorAll<HTMLElement>('.docx-line-break-mark');
  expect(marks).toHaveLength(5);
  for (const mark of marks) {
    expect(mark.textContent).toBe('↵');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.getAttribute('contenteditable')).toBe('false');
    expect(mark.hasAttribute('data-docx-marker')).toBe(true);
    expect(mark.style.userSelect).toBe('none');
    // Seated on its line's baseline in a zero-height seat outside the line's flow.
    const seat = mark.parentElement!;
    expect(seat.classList.contains('docx-terminator-seat')).toBe(true);
    expect(seat.parentElement?.classList.contains('docx-line')).toBe(true);
    expect(seat.style.position).toBe('absolute');
    expect(parseFloat(seat.style.fontSize)).toBe(0);
    expect(mark.style.display).toBe('inline-block');
    expect(mark.style.verticalAlign).toBe('baseline');
  }
  expect(serializeOoxmlPart(source)).toBe(before);
  expect(before).toContain('<w:cr');
  paintSemanticLayout(container, layout, { scale: 1, showParagraphMarks: false });
  expect(container.querySelectorAll('.docx-line-break-mark')).toHaveLength(0);
});

test('soft wraps, page breaks and column breaks do not produce manual-break arrows', () => {
  const source = part(
    `<w:p><w:r><w:t>${'word '.repeat(150)}</w:t><w:br w:type="page"/><w:t>Page</w:t><w:br w:type="column"/><w:t>Column</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="5000" w:h="4000"/><w:pgMar w:top="300" w:bottom="300" w:left="300" w:right="300"/></w:sectPr>`
  );
  const layout = layoutSemanticDocument(source, 0, { measurer: createFixedMeasurer(6, 14) });
  expect(layout.pages.length).toBeGreaterThan(1);
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1, showParagraphMarks: true });
  expect(container.querySelectorAll('.docx-line-break-mark')).toHaveLength(0);
});

test('manual-break arrows follow revision display projection', () => {
  const source = part(
    '<w:p><w:r><w:t>Base</w:t></w:r><w:ins w:id="1" w:author="Ada"><w:r><w:br/><w:cr/></w:r></w:ins><w:del w:id="2" w:author="Ada"><w:r><w:br/></w:r></w:del></w:p>'
  );
  const container = document.createElement('div');
  for (const [displayMode, count] of [
    ['all-markup', 3],
    ['proposed', 2],
    ['original', 1],
  ] as const) {
    const layout = layoutSemanticDocument(source, 0, {
      measurer: createFixedMeasurer(6, 14),
      displayMode,
    });
    paintSemanticLayout(container, layout, { scale: 1, showParagraphMarks: true });
    expect(container.querySelectorAll('.docx-line-break-mark')).toHaveLength(count);
  }
});

test('carriage returns have the same layout geometry and model offsets as text-wrapping breaks', () => {
  const layoutFor = (tag: string) =>
    layoutSemanticDocument(
      part(
        `<w:p><w:r><w:t>Before</w:t><w:${tag}/><w:${tag}/><w:t>After</w:t><w:${tag}/></w:r></w:p>`
      ),
      0,
      { measurer: createFixedMeasurer(6, 14) }
    );
  const geometry = (layout: ReturnType<typeof layoutFor>) =>
    layout.pages.map((page) => ({
      box: page.box,
      fragments: page.fragments.map((fragment) =>
        fragment.kind === 'paragraph'
          ? {
              box: fragment.box,
              lines: fragment.lines.map((line) => ({
                box: line.box,
                start: line.range.start,
                end: line.range.end,
                manualBreakAfter: line.manualBreakAfter,
                spans: line.spans.map((span) => ({ text: span.text, box: span.box })),
              })),
            }
          : { box: fragment.box }
      ),
    }));
  expect(geometry(layoutFor('cr'))).toEqual(geometry(layoutFor('br')));
});

test('manual-break marks use their own revision colors and decorations', () => {
  const source = part(
    '<w:p><w:ins w:id="1" w:author="Ada"><w:r><w:t>Inserted</w:t><w:br/></w:r></w:ins>' +
      '<w:del w:id="2" w:author="Grace"><w:r><w:cr/></w:r></w:del>' +
      '<w:ins w:id="3" w:author="Ada"><w:r><w:t>Text only</w:t></w:r></w:ins>' +
      '<w:r><w:br/></w:r></w:p>'
  );
  const container = document.createElement('div');
  const layout = layoutSemanticDocument(source, 0, { measurer: createFixedMeasurer(6, 14) });
  for (const revisionStyles of [
    'author',
    'kind',
    { authors: { Ada: 'purple', Grace: 'orange' } },
  ] as const) {
    paintSemanticLayout(container, layout, { scale: 1, showParagraphMarks: true, revisionStyles });
    const marks = [...container.querySelectorAll<HTMLElement>('.docx-line-break-mark')];
    expect(marks).toHaveLength(3);
    for (const [index, id] of ['1', '2'].entries()) {
      const mark = marks[index]!;
      const modelSpan = container.querySelector<HTMLElement>(
        `.docx-line [data-start][data-revision-id="${id}"]`
      )!;
      expect(modelSpan).not.toBeNull();
      expect(mark.style.color).toBe(modelSpan.style.color);
      expect(mark.style.textDecorationLine).toBe(modelSpan.style.textDecorationLine);
      expect(mark.dataset.reviewAuthor).toBe(index === 0 ? 'Ada' : 'Grace');
    }
    expect(marks[2]!.style.color).toBe('var(--doc-revision-format)');
    expect(marks[2]!.dataset.revisionId).toBeUndefined();
  }
});
