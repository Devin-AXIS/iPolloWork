import { afterEach, describe, expect, test } from 'bun:test';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';
import { parseRefLinkInstruction } from '../../layout/field-ref-link.ts';

const mounted: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of mounted.splice(0)) editor.destroy();
});
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const complex = (instruction: string, result: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  instruction
    .split('|')
    .map((chunk) => `<w:r><w:instrText>${chunk}</w:instrText></w:r>`)
    .join('') +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  result +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const target =
  '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:bookmarkStart w:id="1" w:name="target"/>' +
  run('Destination') +
  '<w:bookmarkEnd w:id="1"/></w:p>';
function mount(body: string) {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: docx(body) });
  mounted.push(editor);
  return { editor, container, surface: editor.surface! };
}
function activate(element: Element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('reference field navigation', () => {
  for (const instruction of [
    ' REF tar|get \\h ',
    ' REF target \\r \\h \\* MERGEFORMAT ',
    ' REF target \\p \\h ',
    ' PAGEREF target \\h ',
    ' NOTEREF target \\h ',
    ' NOTEREF target \\p \\f \\h ',
  ]) {
    for (const simple of [false, true]) {
      test(`${simple ? 'simple' : 'complex'} ${instruction} navigates without changing XML`, () => {
        const result = run('Cached reference');
        const field = simple
          ? `<w:fldSimple w:instr='${instruction.replaceAll('|', '')}'>${result}</w:fldSimple>`
          : complex(instruction, result);
        const { container, surface } = mount(
          `<w:p>${field}</w:p>${target}<w:sectPr><w:cols w:num="2"/></w:sectPr>`
        );
        const before = serializeOoxmlPart(surface.session.part());
        const anchor = container.querySelector('a.docx-hyperlink')!;
        expect(anchor).not.toBeNull();
        expect(anchor.getAttribute('href')).toBe('#target');
        activate(anchor);
        expect(surface.state().selection.head).toMatchObject({
          paragraphId: surface.bookmarks().get('target')!.paragraphId,
          offset: 0,
        });
        expect(serializeOoxmlPart(surface.session.part())).toBe(before);
      });
    }
  }
  for (const simple of [false, true]) {
    test(`${simple ? 'simple' : 'complex'} computed text also keeps the link`, () => {
      const field = simple
        ? '<w:fldSimple w:instr=" REF target \\h "/>'
        : complex(' REF target \\h ', '');
      const { container } = mount(`<w:p>${field}</w:p>${target}`);
      expect(container.querySelector('a.docx-hyperlink')?.textContent).toBe('Destination');
    });
  }
  test('an enclosing hyperlink retains precedence', () => {
    const { container } = mount(
      `<w:p><w:hyperlink w:anchor="outer">${complex(' REF target \\h ', run('Reference'))}</w:hyperlink></w:p>${target}`
    );
    expect(container.querySelector('a.docx-hyperlink')?.getAttribute('href')).toBe('#outer');
  });
  test('a tracked instruction and result use the live reference target', () => {
    const field =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:del w:id="1" w:author="Reviewer"><w:r><w:delInstrText>REF old \\h</w:delInstrText></w:r></w:del>' +
      '<w:ins w:id="2" w:author="Reviewer"><w:r><w:instrText>REF target \\h</w:instrText></w:r></w:ins><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      `<w:ins w:id="3" w:author="Reviewer">${run('Reference')}</w:ins><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const { container, surface } = mount(`<w:p>${field}</w:p>${target}`);
    const anchor = container.querySelector('a.docx-hyperlink')!;
    expect(anchor.getAttribute('href')).toBe('#target');
    activate(anchor);
    expect(surface.state().selection.head.paragraphId).toBe(
      surface.bookmarks().get('target')!.paragraphId
    );
  });
  test('missing targets do not change the selection', () => {
    const { container, surface } = mount(
      `<w:p>${complex(' REF missing \\h ', run('Missing'))}</w:p>`
    );
    const before = surface.state().selection;
    activate(container.querySelector('a.docx-hyperlink')!);
    expect(surface.state().selection).toEqual(before);
  });
  for (const instruction of [
    'REF target',
    'PAGEREF target',
    'NOTEREF target',
    'REF target "\\h"',
    'REF target \\d "\\h"',
    'REF target \\unknown \\h',
    'REF "target \\h',
    'DDE target \\h',
    `REF ${'x'.repeat(257)} \\h`,
  ]) {
    test(`inert instruction: ${instruction.slice(0, 45)}`, () => {
      expect(parseRefLinkInstruction(instruction)).toBeNull();
      const { container } = mount(`<w:p>${complex(instruction, run('Reference'))}</w:p>${target}`);
      expect(container.querySelector('a.docx-hyperlink')).toBeNull();
    });
  }
});
