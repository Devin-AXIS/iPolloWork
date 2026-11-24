// Blank parity sheets in the editable surface: painted, never a caret target, never a
// place to create a header, and derived again after every edit, undo, and reopen.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { findEmptyFurnitureBandAtSheetPoint } from '../surface-scope.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const SECTION =
  '<w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>';

const BODY =
  `<w:p><w:pPr><w:sectPr>${SECTION}</w:sectPr></w:pPr><w:r><w:t>First</w:t></w:r></w:p>` +
  '<w:p><w:r><w:t>Second</w:t></w:r></w:p>' +
  `<w:sectPr><w:type w:val="oddPage"/>${SECTION}</w:sectPr>`;

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function mount(bytes: Uint8Array): { editor: DocxEditorInstance; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = createDocxEditor({ container, document: bytes, mode: 'edit' });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container };
}

const blanks = (editor: DocxEditorInstance): boolean[] =>
  editor.surface!.layout().pages.map((page) => page.parityBlank === true);

describe('blank parity sheets in the editor', () => {
  test('paints the blank sheet with no text and no furniture', () => {
    const { editor, container } = mount(docx(BODY));
    try {
      expect(blanks(editor)).toEqual([false, true, false]);
      expect(container.querySelectorAll('[data-page-index]')).toHaveLength(3);
      const blank = container.querySelector('[data-page-index="1"]');
      expect(blank).not.toBeNull();
      expect(blank!.textContent ?? '').toBe('');
      expect(blank!.querySelector('[data-docx-hf]')).toBeNull();
      // The sheet before it still offers the empty header band.
      expect(container.querySelector('[data-page-index="0"] [data-docx-hf]')).not.toBeNull();
    } finally {
      editor.destroy();
      container.remove();
    }
  });

  test('a double click in its margin does not offer to create a header or footer', () => {
    const { editor, container } = mount(docx(BODY));
    try {
      const layout = editor.surface!.layout();
      const [first, blank] = layout.pages;
      const at = (page: typeof first) => ({ x: page!.contentBox.x + 10, y: page!.box.y + 10 });
      expect(findEmptyFurnitureBandAtSheetPoint(layout, at(first), () => 0)).toMatchObject({
        pageIndex: 0,
        kind: 'header',
      });
      expect(findEmptyFurnitureBandAtSheetPoint(layout, at(blank), () => 0)).toBeNull();
    } finally {
      editor.destroy();
      container.remove();
    }
  });

  test('an edit that changes the parity removes the sheet, and undo restores it', () => {
    const { editor, container } = mount(docx(BODY));
    try {
      const first = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId: first, offset: 0 },
        head: { paragraphId: first, offset: 0 },
      });
      expect(editor.exec({ type: 'insertBreak', kind: 'page' })).toMatchObject({ ok: true });
      expect(blanks(editor)).toEqual([false, false, false]);
      editor.surface!.undo();
      expect(blanks(editor)).toEqual([false, true, false]);
    } finally {
      editor.destroy();
      container.remove();
    }
  });

  test('save writes no page for the blank sheet and reopening derives it again', () => {
    const { editor, container } = mount(docx(BODY));
    let saved: Uint8Array;
    try {
      saved = editor.surface!.save();
    } finally {
      editor.destroy();
      container.remove();
    }
    const xml = new TextDecoder().decode(unzipSync(saved)['word/document.xml']!);
    expect(xml.match(/<w:p[ >]/g)?.length).toBe(2);
    expect(xml).not.toContain('w:br');
    const reopened = mount(saved);
    try {
      expect(blanks(reopened.editor)).toEqual([false, true, false]);
    } finally {
      reopened.editor.destroy();
      reopened.container.remove();
    }
  });

  test('Shift+PageDown extends only to the sheet after the blank sheet', () => {
    const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const body =
      para('A0') +
      pageBreak +
      `<w:p><w:pPr><w:sectPr>${SECTION}</w:sectPr></w:pPr><w:r><w:t>A1</w:t></w:r></w:p>` +
      para('S0') +
      pageBreak +
      para('S1') +
      pageBreak +
      para('S2') +
      `<w:sectPr><w:type w:val="oddPage"/>${SECTION}</w:sectPr>`;
    // [A0 A1] then page 3 is odd, so the section starts on it: no blank. Add one page to make
    // the blank sheet appear: [A0 . A1 | S0 S1 S2].
    const { editor, container } = mount(docx(para('X') + pageBreak + body));
    try {
      expect(blanks(editor)).toEqual([false, false, false, true, false, false, false]);
      const ids = editor.surface!.session.paragraphIds();
      const textOf = (id: string) =>
        editor
          .surface!.layout()
          .pages.flatMap((page) => page.fragments)
          .flatMap((fragment) =>
            fragment.kind === 'paragraph' && fragment.paragraphId === id
              ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
              : []
          )
          .join('');
      const a1 = ids.find((id) => textOf(id) === 'A1')!;
      editor.surface!.setSelection({
        anchor: { paragraphId: a1, offset: 0 },
        head: { paragraphId: a1, offset: 0 },
      });
      editor.surface!.navigate('pageDown', true);
      const selection = editor.surface!.state().selection!;
      expect(selection.anchor.paragraphId).toBe(a1);
      expect(textOf(selection.head.paragraphId)).toBe('S0');
      editor.surface!.navigate('pageUp', false);
      expect(textOf(editor.surface!.state().selection!.head.paragraphId)).toBe('A1');
    } finally {
      editor.destroy();
      container.remove();
    }
  });
});

describe('pointer gestures on a mounted blank parity sheet', () => {
  // The surface measurer's 6pt base describes an 11pt run.
  const para = (text: string) =>
    `<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
  const BODY_WITH_TEXT =
    Array.from({ length: 12 }, (_, index) => para(`A${index}`)).join('') +
    `<w:p><w:pPr><w:sectPr>${SECTION}</w:sectPr></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>Aend</w:t></w:r></w:p>` +
    para('Second') +
    `<w:sectPr><w:type w:val="oddPage"/>${SECTION}</w:sectPr>`;
  const LEFT = 100;
  const TOP = 50;

  function mountSurface(): {
    surface: PaginatedSurface;
    pages: HTMLElement;
    container: HTMLElement;
  } {
    const container = document.createElement('div');
    document.body.append(container);
    const result = mountPaginatedSurface(container, docx(BODY_WITH_TEXT), { scale: 1 });
    if (!result.ok) throw new Error(result.reason);
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    // happy-dom has no layout: supply where the pages layer sits on screen.
    Object.defineProperty(pages, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: LEFT,
        top: TOP,
        right: LEFT + 1000,
        bottom: TOP + 5000,
        width: 1000,
        height: 5000,
        x: LEFT,
        y: TOP,
      }),
    });
    return { surface: result.surface, pages, container };
  }

  /** A pointer event at sheet coordinates. */
  const pointer = (type: string, x: number, y: number, init: PointerEventInit = {}) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: LEFT + x,
      clientY: TOP + y,
      ...init,
    });

  function landmarks(surface: PaginatedSurface) {
    const layout = surface.layout();
    expect(layout.pages.map((page) => page.parityBlank === true)).toEqual([false, true, false]);
    const paragraphs = (index: number) =>
      layout.pages[index]!.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph' ? [fragment.paragraphId] : []
      );
    const blank = layout.pages[1]!;
    return {
      first: paragraphs(0)[0]!,
      aEnd: paragraphs(0).at(-1)!,
      second: paragraphs(2)[0]!,
      x: blank.contentBox.x + 10,
      upper: blank.box.y + 100,
      lower: blank.box.y + blank.box.height - 100,
      firstLineY: layout.pages[0]!.contentBox.y + 5,
    };
  }

  test('a press on the upper half puts the caret at the end of the text before it', () => {
    const { surface, pages, container } = mountSurface();
    try {
      const at = landmarks(surface);
      pages.dispatchEvent(pointer('pointerdown', at.x, at.upper));
      document.dispatchEvent(pointer('pointerup', at.x, at.upper));
      const { anchor, head } = surface.state().selection;
      expect(head).toEqual({ paragraphId: at.aEnd, offset: 4 });
      expect(anchor).toEqual(head);
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('Shift+click on the lower half extends to the start of the text after it', () => {
    const { surface, pages, container } = mountSurface();
    try {
      const at = landmarks(surface);
      surface.setSelection({
        anchor: { paragraphId: at.first, offset: 0 },
        head: { paragraphId: at.first, offset: 0 },
      });
      pages.dispatchEvent(pointer('pointerdown', at.x, at.lower, { shiftKey: true }));
      document.dispatchEvent(pointer('pointerup', at.x, at.lower, { shiftKey: true }));
      const { anchor, head } = surface.state().selection;
      expect(anchor).toEqual({ paragraphId: at.first, offset: 0 });
      expect(head).toEqual({ paragraphId: at.second, offset: 0 });
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('a drag that ends on the upper half selects to the end of the text before it', () => {
    const { surface, pages, container } = mountSurface();
    try {
      const at = landmarks(surface);
      pages.dispatchEvent(pointer('pointerdown', at.x, at.firstLineY));
      document.dispatchEvent(pointer('pointermove', at.x, at.upper));
      document.dispatchEvent(pointer('pointerup', at.x, at.upper));
      const { anchor, head } = surface.state().selection;
      expect(anchor.paragraphId).toBe(at.first);
      expect(head).toEqual({ paragraphId: at.aEnd, offset: 4 });
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});
