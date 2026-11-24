// `getSelectionRange()`, `snapshot().selectionRange`, and `getCaretRect()`.
//
// A host reads the caret as a paragraph id and an offset, in the units search results and
// highlight ranges use, and passes the read back to `setSelection` unchanged. The caret
// rectangle comes from the placement the painted caret uses, so a popover lands on it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { EditorSnapshot } from '../../contracts/editor.ts';
import { docx, selectCellRectangle } from './paginated-surface-fixtures.ts';
import { HEADER_R_ID, storyParityDocx } from './story-parity-fixture.ts';
import { textboxDocx } from './textbox-editing-fixture.ts';

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (content: string) => `<w:tc>${content}</w:tc>`;
const tr = (content: string) => `<w:tr>${content}</w:tr>`;
const TABLE =
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
  `${tr(tc(p('A1')) + tc(p('B1')))}${tr(tc(p('A2')) + tc(p('B2')))}</w:tbl>`;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function mount(bytes: Uint8Array = docx(p('Supplier pays the Supplier.') + p('Second line.'))) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ document: bytes, container }) as DocxEditorInstance;
  cleanups.push(() => {
    editor.destroy();
    container.remove();
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container };
}

function paragraphIds(editor: DocxEditorInstance): readonly string[] {
  return editor.surface!.session.paragraphIds();
}

function caretAt(editor: DocxEditorInstance, blockId: string, offset: number, head = offset) {
  const result = editor.exec({
    type: 'setSelection',
    range: { anchor: { blockId, offset }, head: { blockId, offset: head } },
  });
  expect(result.ok).toBe(true);
}

describe('getSelectionRange', () => {
  test('reads the caret as a paragraph id and offset that setSelection accepts', () => {
    const { editor } = mount();
    const [first, second] = paragraphIds(editor);
    caretAt(editor, first!, 4);
    const range = editor.getSelectionRange();
    expect(range).toEqual({
      anchor: { blockId: first!, offset: 4 },
      head: { blockId: first!, offset: 4 },
      scope: { kind: 'body' },
    });
    caretAt(editor, second!, 2);
    expect(editor.exec({ type: 'setSelection', range: range! }).ok).toBe(true);
    expect(editor.getSelectionRange()).toEqual(range);
  });

  test('setSelection takes blockId and the older paragraphId, and refuses ambiguous positions', () => {
    const { editor } = mount();
    const [first, second] = paragraphIds(editor);
    const older = { paragraphId: first!, offset: 3 };
    expect(editor.exec({ type: 'setSelection', range: { anchor: older, head: older } }).ok).toBe(
      true
    );
    expect(editor.getSelectionRange()?.head).toEqual({ blockId: first!, offset: 3 });
    const before = editor.getSelectionRange();
    const refused = [
      { offset: 1 },
      { blockId: first!, paragraphId: second!, offset: 1 },
      { blockId: 7, offset: 1 },
      { blockId: first! },
    ];
    for (const position of refused) {
      const range = { anchor: position, head: position } as never;
      expect(editor.can({ type: 'setSelection', range })).toMatchObject({
        ok: false,
        code: 'invalidArgs',
      });
      expect(editor.exec({ type: 'setSelection', range })).toMatchObject({
        ok: false,
        code: 'invalidArgs',
      });
    }
    expect(editor.getSelectionRange()).toBe(before);
    // Both names set to the same id are one position.
    const both = { blockId: second!, paragraphId: second!, offset: 2 };
    expect(editor.exec({ type: 'setSelection', range: { anchor: both, head: both } }).ok).toBe(
      true
    );
    expect(editor.getSelectionRange()?.head).toEqual({ blockId: second!, offset: 2 });
  });

  test('keeps a backward selection backward', () => {
    const { editor } = mount();
    const [first] = paragraphIds(editor);
    caretAt(editor, first!, 9, 2);
    expect(editor.getSelectionRange()).toMatchObject({
      anchor: { blockId: first!, offset: 9 },
      head: { blockId: first!, offset: 2 },
    });
    expect(editor.snapshot().selectionCollapsed).toBe(false);
  });

  test('counts offsets in the units of search results and highlight ranges', () => {
    const { editor } = mount();
    const [, match] = editor.findMatches('Supplier');
    expect(match).toBeDefined();
    expect(editor.selectMatch(match!).ok).toBe(true);
    expect(editor.getSelectionRange()).toMatchObject({
      anchor: { blockId: match!.blockId, offset: match!.start },
      head: { blockId: match!.blockId, offset: match!.start + match!.length },
    });
  });

  test('counts a field as the unit search results and paragraph text count it', () => {
    const field =
      '<w:p><w:r><w:t xml:space="preserve">Total </w:t></w:r>' +
      '<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>12</w:t></w:r></w:fldSimple>' +
      '<w:r><w:t xml:space="preserve"> pages</w:t></w:r></w:p>';
    const { editor } = mount(docx(field));
    const [match] = editor.findMatches('pages');
    expect(match).toBeDefined();
    const [paragraph] = editor.query({ type: 'paragraphs' });
    expect(paragraph!.text.indexOf('pages')).toBe(match!.start);
    expect(editor.selectMatch(match!).ok).toBe(true);
    expect(editor.getSelectionRange()?.anchor.offset).toBe(match!.start);
  });

  test('is reference-stable and frozen, and shared with the snapshot', () => {
    const { editor } = mount();
    const [first] = paragraphIds(editor);
    caretAt(editor, first!, 3);
    const range = editor.getSelectionRange();
    expect(editor.getSelectionRange()).toBe(range);
    expect(editor.snapshot().selectionRange).toBe(range);
    expect(Object.isFrozen(range)).toBe(true);
    expect(Object.isFrozen(range!.head)).toBe(true);
    expect(Object.isFrozen(range!.scope)).toBe(true);
  });

  test('moves the snapshot and emits selectionChange for a caret move inside a paragraph', () => {
    const { editor } = mount();
    const [first] = paragraphIds(editor);
    caretAt(editor, first!, 3);
    const seen: (EditorSnapshot['selectionRange'] | undefined)[] = [];
    const off = editor.on('selectionChange', (snapshot) => seen.push(snapshot.selectionRange));
    const before = editor.snapshot();
    caretAt(editor, first!, 5);
    off();
    // `selection` addresses paragraphs only, so it does not move; `selectionRange` does.
    expect(editor.snapshot().selection).toBe(before.selection);
    expect(editor.snapshot().selectionRange?.head.offset).toBe(5);
    expect(seen.at(-1)?.head.offset).toBe(5);
  });

  test('moves the offset with text typed before the caret', () => {
    const { editor } = mount();
    const [first] = paragraphIds(editor);
    caretAt(editor, first!, 9);
    caretAt(editor, first!, 0);
    expect(editor.exec({ type: 'insertText', text: 'The ' }).ok).toBe(true);
    expect(editor.getSelectionRange()?.head).toEqual({ blockId: first!, offset: 4 });
  });

  test('stays readable after focus leaves the editor', () => {
    const { editor } = mount();
    const [first] = paragraphIds(editor);
    editor.focus();
    caretAt(editor, first!, 6);
    const outside = document.createElement('input');
    document.body.append(outside);
    cleanups.push(() => outside.remove());
    outside.focus();
    expect(editor.getSelectionRange()?.head).toEqual({ blockId: first!, offset: 6 });
  });

  test('names the story, and a header range round-trips from the body', () => {
    const { editor } = mount(storyParityDocx());
    editor.setActiveScope({ kind: 'headerFooter', rId: HEADER_R_ID });
    const range = editor.getSelectionRange();
    expect(range?.scope).toEqual({ kind: 'headerFooter', rId: HEADER_R_ID });
    editor.setActiveScope({ kind: 'body' });
    expect(editor.getSelectionRange()?.scope).toEqual({ kind: 'body' });
    expect(editor.exec({ type: 'setSelection', range: range! }).ok).toBe(true);
    expect(editor.getSelectionRange()).toEqual(range);
  });

  test('names a text box, and a text box range round-trips from the body', () => {
    const { editor } = mount(textboxDocx());
    const match = editor.findMatches('boxed needle')[0]!;
    expect(match.scope?.kind).toBe('frame');
    editor.setActiveScope(match.scope!);
    caretAt(editor, match.blockId, match.start + 5);
    const range = editor.getSelectionRange();
    expect(range?.scope).toEqual(match.scope!);
    expect(range?.head).toEqual({ blockId: match.blockId, offset: match.start + 5 });
    editor.setActiveScope({ kind: 'body' });
    expect(editor.getSelectionRange()?.scope).toEqual({ kind: 'body' });
    expect(editor.exec({ type: 'setSelection', range: range! }).ok).toBe(true);
    expect(editor.getSelectionRange()).toEqual(range);
    // A body range leaves the open box.
    const body = editor.findMatches('body')[0]!;
    expect(body.scope).toBeUndefined();
    caretAt(editor, body.blockId, body.start);
    expect(editor.getSelectionRange()?.scope).toEqual({ kind: 'body' });
    // A range from the box to the body is in two stories.
    const split = editor.exec({
      type: 'setSelection',
      range: { anchor: range!.head, head: { blockId: body.blockId, offset: body.start } },
    });
    expect(split).toMatchObject({ ok: false, code: 'unsupported' });
  });

  test('a text box range round-trips in viewing mode without opening the box', () => {
    const { editor } = mount(textboxDocx());
    const match = editor.findMatches('boxed needle')[0]!;
    expect(editor.setEditingMode('viewing').ok).toBe(true);
    caretAt(editor, match.blockId, match.start + 2);
    const range = editor.getSelectionRange();
    // A box opens only for editing, so the scope stays on the story around it.
    expect(range).toEqual({
      anchor: { blockId: match.blockId, offset: match.start + 2 },
      head: { blockId: match.blockId, offset: match.start + 2 },
      scope: { kind: 'body' },
    });
    const body = editor.findMatches('body')[0]!;
    caretAt(editor, body.blockId, body.start);
    expect(editor.exec({ type: 'setSelection', range: range! }).ok).toBe(true);
    expect(editor.getSelectionRange()).toEqual(range);
    // Back in editing mode, the same range opens the box.
    expect(editor.setEditingMode('editing').ok).toBe(true);
    expect(editor.exec({ type: 'setSelection', range: range! }).ok).toBe(true);
    expect(editor.getSelectionRange()?.scope).toEqual(match.scope!);
  });

  test('a refused range does not open the story it names', () => {
    const { editor } = mount(textboxDocx(true));
    const match = editor.findMatches('boxed needle')[0]!;
    expect(match.scope).toMatchObject({ kind: 'frame', owner: { kind: 'headerFooter' } });
    expect(editor.getActiveScope()).toEqual({ kind: 'body' });
    const host = (match.scope as { hostParagraphId: string }).hostParagraphId;
    const result = editor.exec({
      type: 'setSelection',
      range: {
        anchor: { blockId: host, offset: 0 },
        head: { blockId: match.blockId, offset: match.start },
      },
    });
    expect(result).toMatchObject({ ok: false, code: 'unsupported' });
    expect(editor.getActiveScope()).toEqual({ kind: 'body' });
  });

  test('is null with no document, a cell block, or a selected drawing', () => {
    const empty = createDocxEditor({});
    cleanups.push(() => empty.destroy());
    expect(empty.getSelectionRange()).toBeNull();
    expect(empty.getCaretRect()).toBeNull();
    expect(empty.snapshot().selectionRange).toBeNull();

    const table = mount(docx(TABLE + p('after'))).editor;
    selectCellRectangle(table.surface!, { row: 0, column: 0 }, { row: 1, column: 0 });
    expect(table.surface!.state().cellSelection).not.toBeNull();
    expect(table.getSelectionRange()).toBeNull();
    expect(table.snapshot().selectionRange).toBeNull();

    const chart = mount(docx(p(''))).editor;
    expect(chart.exec({ type: 'insertChart', chartType: 'columnClustered' }).ok).toBe(true);
    const surface = chart.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    const drawingId = surface.session.part().root.children.flatMap(function walk(node): string[] {
      if (node.kind === 'textValue') return [];
      return [...(node.kind === 'drawing' ? [node.id] : []), ...node.children.flatMap(walk)];
    })[0]!;
    surface.selectDrawing(drawingId, paragraphId);
    expect(chart.snapshot().chart).not.toBeNull();
    expect(chart.getSelectionRange()).toBeNull();
  });
});

describe('reads during buffered typing', () => {
  test('neither flush buffered keystrokes nor run a deferred layout pass early', async () => {
    const { editor } = mount();
    const surface = editor.surface!;
    const [first] = paragraphIds(editor);
    caretAt(editor, first!, 0);
    const nav = globalThis.navigator as Navigator & { scheduling?: unknown };
    Object.defineProperty(nav, 'scheduling', {
      value: { isInputPending: () => true },
      configurable: true,
    });
    try {
      const revision = surface.state().revision;
      for (const key of 'abc') {
        surface.enqueueType(key);
        // A host polling the caret between keystrokes reads the committed position.
        expect(editor.getSelectionRange()?.head).toEqual({ blockId: first!, offset: 0 });
        editor.getCaretRect();
      }
      expect(surface.state().revision).toBe(revision);
    } finally {
      delete nav.scheduling;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    surface.layout();
    expect(editor.getSelectionRange()?.head).toEqual({ blockId: first!, offset: 3 });
  });
});

describe('getCaretRect', () => {
  function paintedCaret(container: HTMLElement): HTMLElement {
    const caret = container.querySelector<HTMLElement>('[data-docx-caret]');
    if (!caret) throw new Error('the caret did not paint');
    return caret;
  }

  test('matches the painted caret, in client coordinates', () => {
    const { editor, container } = mount();
    const [first] = paragraphIds(editor);
    editor.focus();
    caretAt(editor, first!, 4);
    const caret = paintedCaret(container);
    const host = caret.parentElement!;
    host.getBoundingClientRect = () => ({ left: 100, top: 50 }) as DOMRect;
    const rect = editor.getCaretRect();
    expect(rect).not.toBeNull();
    expect(rect!.left).toBeCloseTo(100 + parseFloat(caret.style.left), 5);
    expect(rect!.top).toBeCloseTo(50 + parseFloat(caret.style.top), 5);
    expect(rect!.height).toBeCloseTo(parseFloat(caret.style.height), 5);
    expect(rect!.width).toBe(0);
    expect(rect).toMatchObject({ x: rect!.left, y: rect!.top, bottom: rect!.top + rect!.height });
  });

  test('follows scrolling and zoom', () => {
    const { editor, container } = mount();
    const [first] = paragraphIds(editor);
    editor.focus();
    caretAt(editor, first!, 4);
    const host = paintedCaret(container).parentElement!;
    let top = 50;
    host.getBoundingClientRect = () => ({ left: 0, top }) as DOMRect;
    const before = editor.getCaretRect()!;
    top = -150;
    expect(editor.getCaretRect()!.top).toBeCloseTo(before.top - 200, 5);
    top = 50;
    expect(editor.setZoom(2).ok).toBe(true);
    const page = container.querySelector<HTMLElement>(
      '[data-page-index="0"] > .docx-page-content'
    )!;
    page.getBoundingClientRect = () => ({ left: 0, top: 50 }) as DOMRect;
    const zoomed = editor.getCaretRect()!;
    expect(zoomed.left).toBeCloseTo(before.left * 2, 5);
    expect(zoomed.height).toBeCloseTo(before.height * 2, 5);
  });

  test('reports the selection head for a range, and a caret without focus', () => {
    const { editor } = mount();
    const [first] = paragraphIds(editor);
    caretAt(editor, first!, 8);
    const collapsed = editor.getCaretRect();
    expect(collapsed).not.toBeNull();
    caretAt(editor, first!, 2, 8);
    expect(editor.getCaretRect()?.left).toBeCloseTo(collapsed!.left, 5);
  });

  test('is null when the caret page is not painted or the editor is not attached', () => {
    const { editor, container } = mount();
    const [first] = paragraphIds(editor);
    caretAt(editor, first!, 1);
    expect(editor.getCaretRect()).not.toBeNull();
    // A page outside the materialized window has no content box to place the caret in.
    const page = container.querySelector('[data-page-index="0"] > .docx-page-content')!;
    page.classList.remove('docx-page-content');
    expect(editor.getCaretRect()).toBeNull();
    page.classList.add('docx-page-content');
    editor.detach();
    expect(editor.getCaretRect()).toBeNull();
  });
});
