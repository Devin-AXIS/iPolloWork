import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';
import { detectBodyTocs, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { applyTreeOp, paragraphTextOf } from '../../store/store/tree-ops.ts';
import { validateOoxmlPart, bodyStoryRoot, storyParagraphs } from '@docx-editor.dev/core/store';
import { tocParagraphRanges } from '../surface-toc-ranges.ts';
const run = (s: string) => `<w:r><w:t>${s}</w:t></w:r>`;
const begin =
  '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>TOC \\o "1-1" \\h</w:instrText><w:fldChar w:fldCharType="separate"/></w:r>';
const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const bookmark = '<w:bookmarkStart w:id="1" w:name="target"/>';
const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});
function mount(body: string) {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: docx(body) });
  editors.push(editor);
  return { editor, surface: editor.surface!, container };
}
function select(
  surface: NonNullable<DocxEditorInstance['surface']>,
  index: number,
  offset: number,
  endOffset = offset
) {
  const paragraphId = surface.session.paragraphIds()[index]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset: endOffset },
  });
}
function headingDoc(prefix = '', suffix = '') {
  return `<w:p>${begin}${run('Entry 1')}</w:p><w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/></w:sectPr></w:pPr>${prefix}${end}${bookmark}${run('Heading')}${suffix}<w:bookmarkEnd w:id="1"/></w:p><w:p>${run('Following')}</w:p><w:sectPr><w:cols w:num="2"/></w:sectPr>`;
}
test('heading after closing marker accepts text, paragraph and page breaks with undo', async () => {
  const { editor, surface } = mount(headingDoc());
  const before = serializeOoxmlPart(surface.session.part());
  expect(surface.navigation.goToBookmark('target')).toBe(true);
  expect(editor.exec({ type: 'insertText', text: 'New ' })).toEqual({ ok: true, changed: true });
  expect(surface.session.bodyText()).toContain('New Heading');
  expect(editor.exec({ type: 'undo' }).ok).toBe(true);
  expect(serializeOoxmlPart(surface.session.part())).toBe(before);
  select(surface, 1, 0);
  surface.splitParagraph();
  expect(surface.state().lastRejection).toBeNull();
  expect(surface.session.paragraphIds()).toHaveLength(4);
  expect(detectBodyTocs(surface.session.part())).toHaveLength(1);
  expect(detectBodyTocs(surface.session.part())[0]!.endParagraphId).toBe(
    surface.session.paragraphIds()[1]!
  );
  expect(serializeOoxmlPart(surface.session.part()).match(/<w:sectPr>/g) ?? []).toHaveLength(2);
  editor.exec({ type: 'undo' });
  select(surface, 1, 0);
  expect(editor.exec({ type: 'insertBreak', kind: 'page' }).ok).toBe(true);
  expect(serializeOoxmlPart(surface.session.part())).toContain('w:type="page"');
  editor.load(await editor.save());
  expect(detectBodyTocs(editor.surface!.session.part())).toHaveLength(1);
  expect(editor.surface!.bookmarks().get('target')).toBeDefined();
});
test('generated result remains read-only and a refused insert reports failure', () => {
  const { editor, surface } = mount(headingDoc());
  select(surface, 0, 2);
  const before = serializeOoxmlPart(surface.session.part());
  expect(editor.exec({ type: 'insertText', text: 'X' })).toMatchObject({
    ok: false,
    reason: 'the table of contents is generated and read-only',
  });
  expect(serializeOoxmlPart(surface.session.part())).toBe(before);
});
test('normal text on both field boundaries can change while cached rows remain unchanged', () => {
  const { editor, surface } = mount(
    `<w:p>${run('Before')}${begin}${run('Entry')}</w:p><w:p>${run('Page 1')}${end}${run('After')}</w:p>`
  );
  select(surface, 0, 2);
  expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
  select(surface, 1, 8);
  expect(editor.exec({ type: 'insertText', text: 'Y' }).ok).toBe(true);
  const ranges = tocParagraphRanges(surface.session.part());
  expect(ranges.map((r) => [r.start, r.end])).toEqual([
    [7, 12],
    [0, 6],
  ]);
  select(surface, 0, 8);
  expect(editor.exec({ type: 'insertText', text: 'Z' }).ok).toBe(false);
  select(surface, 1, 2);
  expect(editor.exec({ type: 'insertText', text: 'Z' }).ok).toBe(false);
});
test('arrows can reach the editable text after the TOC', () => {
  const { surface } = mount(headingDoc());
  select(surface, 2, 0);
  surface.navigate('up');
  expect(surface.state().selection.head.paragraphId).toBe(surface.session.paragraphIds()[1]!);
});
test('TOC highlight excludes the following heading', () => {
  const { container, surface } = mount(headingDoc());
  const id = surface.session.paragraphIds()[1]!;
  const heading = container.querySelector(`[data-paragraph-id="${id}"]`)!;
  expect(heading.getAttribute('contenteditable')).not.toBe('false');
  const chrome = container.querySelector<HTMLElement>('[data-docx-toc]')!;
  expect(chrome).not.toBeNull();
  const before = chrome.querySelector<HTMLElement>('.docx-content-control-boundary')!.style.height;
  expect(Number.parseFloat(before)).toBeLessThan(50);
});

for (const at of ['before', 'after'] as const) {
  test(`typing exactly at the ${at} boundary does not enter the cached result`, () => {
    const { editor, surface } = mount(
      `<w:p>${run('Before')}${begin}${run('Entry')}</w:p><w:p>${run('Page 1')}${end}${run('After')}</w:p>`
    );
    select(surface, at === 'before' ? 0 : 1, 6);
    expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    expect(tocParagraphRanges(surface.session.part()).map((r) => [r.start, r.end])).toEqual(
      at === 'before'
        ? [
            [7, 12],
            [0, 6],
          ]
        : [
            [6, 11],
            [0, 6],
          ]
    );
  });
}
test('same-paragraph TOC leaves both neighbouring text ranges editable', () => {
  const { editor, surface } = mount(
    `<w:p>${run('Before')}${begin}${run('Entry')}${end}${run('After')}</w:p>`
  );
  select(surface, 0, 2);
  expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
  const range = tocParagraphRanges(surface.session.part())[0]!;
  select(surface, 0, range.end + 2);
  expect(editor.exec({ type: 'insertText', text: 'Y' }).ok).toBe(true);
  expect(editor.query({ type: 'isInsideToc', pos: 0 })).toBe(false);
  select(surface, 0, range.start);
  expect(editor.exec({ type: 'insertText', text: 'Z' }).ok).toBe(true);
});

test('deleting and retyping all heading text leaves the field boundary intact', () => {
  const { editor, surface } = mount(headingDoc());
  select(surface, 1, 0, 7);
  editor.exec({ type: 'deleteText' });
  expect(surface.session.bodyText()).not.toContain('Heading');
  expect(editor.exec({ type: 'insertText', text: 'Replacement' })).toEqual({
    ok: true,
    changed: true,
  });
  expect(detectBodyTocs(surface.session.part())).toHaveLength(1);
});
test('normal suffix text can merge with the following paragraph', () => {
  const { surface } = mount(headingDoc());
  select(surface, 1, 7);
  surface.deleteForward();
  expect(surface.state().lastRejection).toBeNull();
  expect(surface.session.bodyText()).toContain('HeadingFollowing');
  expect(detectBodyTocs(surface.session.part())).toHaveLength(1);
});
test('tracked insertion at the closing boundary stays outside the cached result', () => {
  const { editor, surface } = mount(
    `<w:p>${begin}${run('Entry')}</w:p><w:p>${run('Page 1')}${end}${run('After')}</w:p>`
  );
  editor.setAuthor('Reviewer');
  surface.setEditingMode('suggest');
  select(surface, 1, 6);
  expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
  expect(tocParagraphRanges(surface.session.part())[1]!.end).toBe(6);
  expect(serializeOoxmlPart(surface.session.part())).toContain('<w:ins');
});
test('partial content-control TOC paints only one boundary and excludes its heading', () => {
  const { container, surface } = mount(
    '<w:sdt><w:sdtPr/><w:sdtContent>' +
      headingDoc().replace(/<w:sectPr><w:cols[^]*$/, '') +
      '</w:sdtContent></w:sdt>'
  );
  expect(container.querySelectorAll('[data-docx-toc] .docx-content-control-boundary')).toHaveLength(
    1
  );
  const heading = container.querySelector(
    `[data-paragraph-id="${surface.session.paragraphIds()[1]!}"] [data-start]`
  )!;
  heading.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
  expect(container.querySelector('[data-docx-toc]')?.hasAttribute('data-hover')).toBe(false);
});

for (const wrapped of [false, true]) {
  test(`paragraph splits keep the closing marker before the break, wrapped=${wrapped}`, () => {
    const boundary =
      '<w:r><w:rPr><w:b/></w:rPr><w:fldChar w:fldCharType="end"/><w:t>Heading</w:t></w:r>';
    const { surface } = mount(
      `<w:p>${begin}${run('Entry')}</w:p><w:p>${wrapped ? `<w:hyperlink w:anchor="target">${boundary}</w:hyperlink>` : boundary}</w:p>`
    );
    select(surface, 1, 0);
    surface.splitParagraph();
    expect(surface.state().lastRejection).toBeNull();
    expect(detectBodyTocs(surface.session.part())[0]!.endParagraphId).toBe(
      surface.session.paragraphIds()[1]!
    );
    expect(surface.session.bodyText()).toContain('Heading');
  });
}

for (const wrapped of [false, true]) {
  test(`repeated and multi-line splits preserve the field boundary, wrapped=${wrapped}`, () => {
    const boundary =
      '<w:r><w:rPr><w:b/></w:rPr><w:fldChar w:fldCharType="end"/><w:t>Heading</w:t></w:r>';
    const { surface } = mount(
      `<w:p>${begin}${run('Entry')}</w:p><w:p>${wrapped ? `<w:hyperlink w:anchor="target">${boundary}</w:hyperlink>` : boundary}</w:p>`
    );
    const paragraphId = surface.session.paragraphIds()[1]!;
    const result = applyTreeOp(surface.session.part(), {
      op: 'splitParagraphMany',
      paragraphId,
      offsets: [0, 0, 3],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateOoxmlPart(result.part).ok).toBe(true);
    expect(detectBodyTocs(result.part)[0]!.endParagraphId).toBe(paragraphId);
    const texts = storyParagraphs(bodyStoryRoot(result.part)!).map((p) =>
      paragraphTextOf(result.part, p.id)
    );
    expect(texts).toEqual(['Entry', '', '', 'Hea', 'ding']);
  });
}
