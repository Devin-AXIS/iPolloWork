// `getPageGeometry` — the one member that survived a cluster of stubs.
//
// `getPageGeometry` was the ONLY member of the old geometry cluster with a real caller (both
// Vue rulers), and it returned `[]`, so those rulers rendered nothing for as long as they
// shipped. These tests exist so that cannot come back silently: a ruler asking for the page
// box must get a real one.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { rulerPageBox } from '../ruler-ticks.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

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

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

function mount(body: string, options: { mode?: 'edit' | 'view' } = {}): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: docx(body), ...options });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

describe('getPageGeometry', () => {
  test('reports a real page box, not an empty list', () => {
    const editor = mount(p('hello'));
    const pages = editor.getPageGeometry();

    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]!.index).toBe(0);
    expect(pages[0]!.box.width).toBeGreaterThan(0);
    expect(pages[0]!.box.height).toBeGreaterThan(0);
  });

  // The regression this whole member exists for: `rulerPageBox` returns null on an empty
  // list, and both Vue rulers render nothing when it does.
  test('feeds rulerPageBox a box, so the rulers have something to draw', () => {
    const editor = mount(p('hello'));
    const box = rulerPageBox(editor.getPageGeometry());

    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
  });

  test('contentBox is the page inset by the margins, so it is strictly inside the sheet', () => {
    const editor = mount(p('hello'));
    const page = editor.getPageGeometry()[0]!;

    expect(page.contentBox.width).toBeLessThan(page.box.width);
    expect(page.contentBox.height).toBeLessThan(page.box.height);
    expect(page.contentBox.x).toBeGreaterThanOrEqual(page.box.x);
  });

  test('grows with the document', () => {
    const editor = mount(p('hello'));
    const before = editor.getPageGeometry().length;

    editor.exec({ type: 'insertBreak', kind: 'page' });

    expect(editor.getPageGeometry().length).toBeGreaterThan(before);
  });

  test('is empty with no document rather than inventing a page', () => {
    const editor = createDocxEditor({});
    expect(editor.getPageGeometry()).toEqual([]);
  });
});

describe('getCurrentPage', () => {
  test('viewport mode reports the page at the viewport center while caret mode stays put', () => {
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    const positionedWrapper = document.createElement('div');
    const container = document.createElement('div');
    positionedWrapper.append(container);
    scroller.append(positionedWrapper);
    document.body.append(scroller);
    Object.defineProperty(scroller, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(container, 'offsetTop', { value: 40, configurable: true });
    const surfaceTop = 1_000;
    scroller.getBoundingClientRect = () =>
      ({ top: 20, left: 0, right: 800, bottom: 320, width: 800, height: 300 }) as DOMRect;
    container.getBoundingClientRect = () =>
      ({
        top: 20 + surfaceTop - scroller.scrollTop,
        left: 0,
        right: 800,
        bottom: 20 + surfaceTop - scroller.scrollTop + 3_000,
        width: 800,
        height: 3_000,
      }) as DOMRect;

    const editor = createDocxEditor({
      container,
      document: docx(p('first') + pageBreak + p('second') + pageBreak + p('third')),
      zoom: 1.5,
    });
    if (!editor.surface) throw new Error('surface failed to mount');
    const second = editor.surface.layout().pages[1]!;
    const scale = 1.5 * (96 / 72);
    scroller.scrollTop =
      surfaceTop + (second.box.y + second.box.height / 2) * scale - scroller.clientHeight / 2;

    expect(editor.getCurrentPage('viewport')).toBe(2);
    expect(editor.getCurrentPage('caret')).toBe(1);

    editor.destroy();
    scroller.remove();
  });

  test('viewport mode falls back to the caret page without a measurable scroller', () => {
    const editor = mount(p('first') + pageBreak + p('second'));
    expect(editor.getCurrentPage('viewport')).toBe(editor.getCurrentPage('caret'));
    editor.destroy();
  });
});

describe('selectionCollapsed', () => {
  test('true at a caret, false over a range', () => {
    const editor = mount(p('hello world'));
    const id = editor.surface!.session.paragraphIds()[0]!;

    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 3 },
      head: { paragraphId: id, offset: 3 },
    });
    expect(editor.snapshot().selectionCollapsed).toBe(true);

    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 5 },
    });
    expect(editor.snapshot().selectionCollapsed).toBe(false);
  });

  // The reason this is a snapshot field rather than something derived from `selection`:
  // a range INSIDE one paragraph has the same paraId endpoints as a caret there, so the
  // published `DocRange` cannot tell them apart and the cached snapshot would not re-derive.
  test('changes even when the paraId range does not', () => {
    const editor = mount(p('hello world'));
    const id = editor.surface!.session.paragraphIds()[0]!;

    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 5 },
    });
    const ranged = editor.snapshot();

    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 5 },
      head: { paragraphId: id, offset: 5 },
    });
    const caret = editor.snapshot();

    expect(caret.selection).toEqual(ranged.selection!);
    expect(ranged.selectionCollapsed).toBe(false);
    expect(caret.selectionCollapsed).toBe(true);
    expect(caret).not.toBe(ranged);
  });

  test('true with no document', () => {
    expect(createDocxEditor({}).snapshot().selectionCollapsed).toBe(true);
  });
});

describe('page geometry units', () => {
  // The one that matters: layout works in POINTS, every consumer works in 96dpi content
  // pixels. Handing points straight out made a Letter page measure 612 against a painted
  // 816, so the Vue ruler drew a strip a quarter short of its page and labelled 8.5 inches
  // as six. Rendering wrong is worse than the `[]` it replaced.
  test('reports content pixels at 96dpi, not layout points', () => {
    const editor = mount(p('hello'));
    const page = editor.getPageGeometry()[0]!;

    // US Letter: 8.5in x 11in -> 816 x 1056 at 96dpi (it is 612 x 792 in points).
    expect(Math.round(page.box.width)).toBe(816);
    expect(Math.round(page.box.height)).toBe(1056);
    // One-inch margins.
    expect(Math.round(page.contentBox.x)).toBe(96);
    expect(Math.round(page.contentBox.width)).toBe(624);
  });

  test('does not bake zoom in — that is the caller-s multiplier', () => {
    const editor = mount(p('hello'));
    const before = editor.getPageGeometry()[0]!.box.width;

    editor.setZoom(2);

    expect(editor.getPageGeometry()[0]!.box.width).toBe(before);
  });
});

// The op gate and the DOM affordance are different things: the engine refusing a write
// still leaves a `contenteditable` pages layer, which draws a caret, opens an IME, and
// tells a screen reader the document is writable.
describe('viewing turns the pages layer read-only, not just the commands', () => {
  /** Mount and hand back the pages layer — the element the affordance lands on. */
  function mountLayer(options: { mode?: 'edit' | 'view' } = {}): {
    editor: DocxEditorInstance;
    layer: HTMLElement;
  } {
    const container = document.createElement('div');
    const editor = createDocxEditor({ container, document: docx(p('hello')), ...options });
    if (!editor.surface) throw new Error('surface failed to mount');
    const layer = container.querySelector<HTMLElement>('[contenteditable]');
    if (!layer) throw new Error('no contenteditable pages layer');
    return { editor, layer };
  }

  test('a document opened for viewing comes up non-editable', () => {
    const { layer } = mountLayer({ mode: 'view' });

    expect(layer.getAttribute('contenteditable')).toBe('false');
    expect(layer.getAttribute('aria-readonly')).toBe('true');
  });

  test('switching to viewing at runtime takes the affordance with it, and back', () => {
    const { editor, layer } = mountLayer();
    expect(layer.getAttribute('contenteditable')).toBe('true');

    editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    expect(layer.getAttribute('contenteditable')).toBe('false');
    expect(layer.getAttribute('aria-readonly')).toBe('true');

    editor.exec({ type: 'setEditingMode', mode: 'editing' });
    expect(layer.getAttribute('contenteditable')).toBe('true');
    expect(layer.getAttribute('aria-readonly')).toBe('false');
  });
});

describe('rows that would do nothing are refused', () => {
  test('deleteText is gated on the selection, like cut and copy', () => {
    const editor = mount(p('hello world'));
    const id = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 3 },
      head: { paragraphId: id, offset: 3 },
    });

    // It used to say yes here and then no-op — the exact defect the cut/copy gate exists
    // to prevent, left open on their sibling row in the same menu.
    expect(editor.can({ type: 'deleteText' })).toEqual({
      ok: false,
      code: 'unsupported',
      reason: 'nothing is selected',
    });

    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 5 },
    });
    expect(editor.can({ type: 'deleteText' })).toEqual({ ok: true });
  });

  // `paste` REPLACES the selection, so "paste nothing" over a select-all is a whole-document
  // delete wearing the wrong name — and an empty clipboard is the ordinary way to reach it.
  test('an empty paste is refused rather than run as a delete', () => {
    const editor = mount(p('hello world'));
    editor.exec({ type: 'selectAll' });

    expect(editor.can({ type: 'paste', text: '' })).toEqual({
      ok: false,
      code: 'invalidArgs',
      reason: 'there is nothing to paste',
    });
    expect(editor.exec({ type: 'paste', text: '' }).ok).toBe(false);
    // The selection it would have replaced is still there.
    expect(editor.query({ type: 'selectedText' })).toContain('hello world');
  });
});
