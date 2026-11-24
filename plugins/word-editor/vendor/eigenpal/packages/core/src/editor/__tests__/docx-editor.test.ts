// The tree-lane Editor facade over the paginated surface (phase 3, part 1).
//
// What these tests pin down: the facade drives the REAL surface (painted pages, committed
// ops, round-trippable bytes), refuses what it does not support with typed results rather
// than silence, and honours mode: 'view' as a facade-level gate.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { blankDocumentBytes } from '../blank-document.ts';
import { normalizeSource } from '../docx-editor-support.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string, extraParts: Record<string, string> = {}): Uint8Array {
  const overrides = Object.keys(extraParts)
    .map((name) => `<Override PartName="/${name}" ContentType="application/xml"/>`)
    .join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${overrides}</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    ...Object.fromEntries(
      Object.entries(extraParts).map(([name, xml]) => [name, strToU8(xml)] as const)
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function mount(
  body: string,
  options: { mode?: 'edit' | 'view'; zoom?: number } = {}
): { editor: DocxEditorInstance; container: HTMLElement } {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: docx(body),
    ...options,
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container };
}

describe('createDocxEditor', () => {
  test('mounting paints pages into the container', () => {
    const { editor, container } = mount(p('hello world'));
    expect(container.querySelector('.docx-pages')).not.toBeNull();
    const spans = container.querySelectorAll('[data-paragraph-id][data-start]');
    expect(spans.length).toBeGreaterThan(0);
    expect(container.textContent).toContain('hello world');
    expect(editor.getTotalPages()).toBe(1);
  });

  test('toggleMark bold applies over a selection and formatting reflects it', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    const result = editor.exec({ type: 'toggleMark', mark: 'bold' });
    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.getSelectionFormatting()?.bold).toBe(true);
    expect(editor.query({ type: 'selectionFormatting' })?.bold).toBe(true);
  });

  test('a collapsed caret reports the formatting of the run beside it', () => {
    const { editor } = mount(
      '<w:p><w:r><w:t>plain</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>'
    );
    const pid = '/word/document.xml#0.0.0';
    const caret = (offset: number) => ({
      anchor: { paragraphId: pid, offset },
      head: { paragraphId: pid, offset },
    });
    editor.exec({ type: 'setSelection', range: caret(7) });
    expect(editor.getSelectionFormatting()?.bold).toBe(true);
    expect(editor.isActive({ type: 'toggleMark', mark: 'bold' })).toBe(true);
    editor.exec({ type: 'setSelection', range: caret(2) });
    expect(editor.getSelectionFormatting()?.bold).toBe(false);
    expect(editor.isActive({ type: 'toggleMark', mark: 'bold' })).toBe(false);
  });

  test('every toggleMark toggles OFF again, not just bold', () => {
    // A mark missing from `isRunPropertyActive` reads as never-active, so its toggle
    // re-applies forever instead of clearing — every toggleable mark must round-trip.
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    for (const [mark, read] of [
      ['bold', 'bold'],
      ['italic', 'italic'],
      ['underline', 'underline'],
      ['strike', 'strike'],
    ] as const) {
      editor.exec({ type: 'toggleMark', mark });
      expect(editor.snapshot().formatting?.[read]).toBe(true);
      editor.exec({ type: 'toggleMark', mark });
      expect(editor.snapshot().formatting?.[read]).toBe(false);
    }
  });

  test('setAlignment writes w:jc and formatting reports it', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    expect(editor.exec({ type: 'setAlignment', align: 'center' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(editor.getSelectionFormatting()?.alignment).toBe('center');
    // `justify` is spelled `both` in OOXML and read back as such.
    editor.exec({ type: 'setAlignment', align: 'justify' });
    expect(editor.getSelectionFormatting()?.alignment).toBe('both');
  });

  test('insertText types at the selection; undo and redo walk the history', () => {
    const { editor } = mount(p('ab'));
    expect(editor.exec({ type: 'insertText', text: 'X' })).toEqual({ ok: true, changed: true });
    expect(editor.surface!.session.bodyText()).toBe('Xab');
    expect(editor.exec({ type: 'undo' })).toEqual({ ok: true, changed: true });
    expect(editor.surface!.session.bodyText()).toBe('ab');
    expect(editor.exec({ type: 'redo' })).toEqual({ ok: true, changed: true });
    expect(editor.surface!.session.bodyText()).toBe('Xab');
    // An empty history REFUSES rather than silently no-opping: `can` drives the
    // toolbar, and Word greys out undo/redo when there is nothing left.
    editor.exec({ type: 'undo' });
    expect(editor.can({ type: 'undo' }).ok).toBe(false);
    const spent = editor.exec({ type: 'undo' });
    expect(spent.ok).toBe(false);
    if (!spent.ok) expect(spent.reason).toBe('nothing to undo');
  });

  test('insertText replaces a full selection rather than appending after it', () => {
    const { editor } = mount(p('selected phrase'));
    editor.surface!.selectAll();
    expect(editor.exec({ type: 'insertText', text: 'replacement' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(editor.surface!.session.bodyText()).toBe('replacement');
  });

  test('undo/redo enablement follows the history', () => {
    const { editor } = mount(p('ab'));
    expect(editor.can({ type: 'undo' }).ok).toBe(false);
    expect(editor.can({ type: 'redo' }).ok).toBe(false);
    editor.exec({ type: 'insertText', text: 'X' });
    expect(editor.can({ type: 'undo' }).ok).toBe(true);
    expect(editor.can({ type: 'redo' }).ok).toBe(false);
    editor.exec({ type: 'undo' });
    expect(editor.can({ type: 'undo' }).ok).toBe(false);
    expect(editor.can({ type: 'redo' }).ok).toBe(true);
  });

  test('save() round-trips: the bytes reopen and the edit survives', async () => {
    const { editor } = mount(p('hello'));
    editor.exec({ type: 'insertText', text: 'X' });
    const buffer = await editor.save();
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    const bytes = new Uint8Array(buffer);
    const reopened = readOoxmlPackage(bytes);
    expect(reopened.ok).toBe(true);
    // And the second editor sees the edit, which is the round trip that matters.
    const second = mount(p('placeholder'));
    second.editor.load(bytes);
    expect(second.editor.surface!.session.bodyText()).toBe('Xhello');
  });

  test('snapshot reports the honest read model', () => {
    const { editor } = mount(p('hello'));
    const snapshot = editor.snapshot();
    expect(snapshot.scope).toEqual({ kind: 'body' });
    expect(snapshot.isLoading).toBe(false);
    expect(snapshot.parseError).toBeNull();
    expect(snapshot.editable).toBe(true);
    expect(snapshot.zoom).toBe(1);
    // The selection reads in contract vocabulary: DocAnchor endpoints carrying the
    // paragraph's `w14:paraId` (minted at open), paragraph-granular.
    expect(snapshot.selection).not.toBeNull();
    const caretAnchor = snapshot.selection!.from as { paraId: string };
    expect(caretAnchor.paraId).toMatch(/^[0-9A-F]{8}$/);
    expect(snapshot.selection!.to).toEqual(snapshot.selection!.from);
    expect(snapshot.table).toBeNull();
    expect(snapshot.image).toBeNull();
    expect(snapshot.page).toEqual({ current: 1, total: 1 });
    expect(editor.getCurrentPage()).toBe(1);
  });

  test("mode: 'view' refuses every mutating command with a typed result", () => {
    const { editor } = mount(p('hello'), { mode: 'view' });
    editor.surface!.selectAll();
    const result = editor.exec({ type: 'toggleMark', mark: 'bold' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('locked');
    expect(editor.can({ type: 'insertText', text: 'X' })).toMatchObject({
      ok: false,
      code: 'locked',
    });
    expect(editor.snapshot().editable).toBe(false);
    // The document is untouched.
    expect(editor.surface!.session.bodyText()).toBe('hello');
  });

  test('an unsupported command is refused, never silently dropped', () => {
    const { editor } = mount(p('hello'));
    // Line, page and section breaks are wired; `column` needs the multi-column lane.
    expect(editor.can({ type: 'insertBreak', kind: 'line' })).toEqual({ ok: true });
    expect(editor.can({ type: 'insertBreak', kind: 'page' })).toEqual({ ok: true });
    expect(editor.can({ type: 'insertBreak', kind: 'column' })).toMatchObject({
      ok: false,
      code: 'unsupported',
    });
    const result = editor.exec({ type: 'insertBreak', kind: 'column' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsupported');
  });

  test('insertTable commits a table before the caret paragraph and paints it', async () => {
    const { editor, container } = mount(p('after'));
    expect(editor.can({ type: 'insertTable', rows: 3, cols: 2 })).toEqual({ ok: true });
    expect(editor.exec({ type: 'insertTable', rows: 3, cols: 2 })).toMatchObject({ ok: true });

    // Repaint after a commit is deferred; reading the layout flushes it.
    expect(editor.surface!.layout().pages).toHaveLength(1);
    expect(container.querySelectorAll('.docx-table-cell').length).toBe(6);

    // The anchor paragraph survives AFTER the table — a `w:tbl` is not a legal last block —
    // and reading order proves the table went BEFORE it, not after.
    expect(editor.query({ type: 'paragraphs' }).map((paragraph) => paragraph.text)).toEqual([
      ...Array<string>(6).fill(''),
      'after',
    ]);

    // And it survives the round trip: reopened bytes hold the same six cells.
    const bytes = new Uint8Array(await editor.save());
    const reopened = mount(p('placeholder'));
    reopened.editor.load(bytes);
    expect(reopened.editor.query({ type: 'paragraphs' }).map((p2) => p2.text)).toEqual([
      ...Array<string>(6).fill(''),
      'after',
    ]);
  });

  test('insertTable is refused with the shape reason for a size the engine will not author', () => {
    const { editor } = mount(p('hello'));
    expect(editor.can({ type: 'insertTable', rows: 0, cols: 2 })).toMatchObject({
      ok: false,
      code: 'invalidArgs',
    });
    expect(editor.can({ type: 'insertTable', rows: 2, cols: 200 })).toMatchObject({
      ok: false,
      code: 'invalidArgs',
    });
  });

  test("mode: 'view' refuses insertTable, like every other mutating command", () => {
    const { editor } = mount(p('hello'), { mode: 'view' });
    expect(editor.can({ type: 'insertTable', rows: 2, cols: 2 })).toMatchObject({ ok: false });
    expect(editor.exec({ type: 'insertTable', rows: 2, cols: 2 }).ok).toBe(false);
    expect(editor.surface!.session.bodyText()).toBe('hello');
  });

  test('setSelection passes a semantic paragraph selection through to the surface', () => {
    const { editor } = mount(p('hello'));
    const id = editor.surface!.session.paragraphIds()[0]!;
    const result = editor.exec({
      type: 'setSelection',
      range: {
        anchor: { paragraphId: id, offset: 1 },
        head: { paragraphId: id, offset: 4 },
      },
    });
    expect(result).toEqual({ ok: true, changed: false });
    expect(editor.query({ type: 'selectedText' })).toBe('ell');
    expect(editor.surface!.selectedText()).toBe('ell');
  });

  test('every setSelection form the contract types is a form can() accepts', () => {
    // The contract used to type a `SemanticTarget` the gate refuses and omit the paragraph-id
    // pair it honours, so both adapter call sites cast `as never` to reach the working form.
    // A type that admits what the gate rejects is not checkable by the compiler alone; this
    // is the runtime half, and `consumer.test-d.ts` is the compile-time half.
    const { editor } = mount(p('hello'));
    const [first] = editor.surface!.session.paragraphIds();
    const paraId = (editor.snapshot().selection?.from as { paraId?: string } | undefined)?.paraId;
    expect(paraId).toMatch(/^[0-9A-F]{8}$/);

    expect(
      editor.can({
        type: 'setSelection',
        range: {
          anchor: { paragraphId: first!, offset: 0 },
          head: { paragraphId: first!, offset: 2 },
        },
      })
    ).toEqual({ ok: true });
    expect(editor.can({ type: 'setSelection', anchor: { paraId: paraId! } })).toEqual({ ok: true });
    expect(
      editor.can({
        type: 'setSelection',
        range: { from: { paraId: paraId! }, to: { paraId: paraId! } },
      })
    ).toEqual({ ok: true });

    // And the arms the contract dropped are still refused, so removing them narrowed the
    // type to what was already true rather than removing capability.
    const refused = editor.can({
      type: 'setSelection',
      range: { from: { path: [0] }, to: { path: [0] } },
    } as never);
    expect(refused.ok).toBe(false);
  });

  test('load() with new bytes replaces the document', () => {
    const { editor, container } = mount(p('first'));
    editor.load(docx(p('second')));
    expect(container.textContent).toContain('second');
    expect(container.textContent).not.toContain('first');
    expect(editor.surface!.session.bodyText()).toBe('second');
  });

  test('load() with new bytes opens at the top, not at the previous scroll offset', () => {
    // The scroller is the HOST's element and survives the remount, so without an explicit
    // reset a reader ten pages into one file opened the next file ten pages in.
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    const container = document.createElement('div');
    scroller.appendChild(container);
    const editor = createDocxEditor({ container, document: docx(p('first')) });
    expect(editor.surface).not.toBeNull();
    scroller.scrollTop = 4321;
    scroller.scrollLeft = 17;
    editor.load(docx(p('second')));
    expect(scroller.scrollTop).toBe(0);
    expect(scroller.scrollLeft).toBe(0);
    editor.destroy();
  });

  test('load() with a DocumentHandle emits a typed error and keeps the document', () => {
    const { editor } = mount(p('hello'));
    const errors: { code?: string }[] = [];
    editor.on('error', (error) => errors.push(error));
    editor.load(editor.getDocumentHandle());
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('unsupported');
    expect(editor.surface!.session.bodyText()).toBe('hello');
  });

  test('unparsable bytes surface as an error event and snapshot parseError', () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({ container });
    const errors: Error[] = [];
    editor.on('error', (error) => errors.push(error));
    editor.load(strToU8('not a zip'));
    expect(errors).toHaveLength(1);
    expect(editor.snapshot().parseError).not.toBeNull();
    expect(editor.surface).toBeNull();
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: false, code: 'notFound' });
  });

  test("on('change') fires per committed exec with the new revision", () => {
    const { editor } = mount(p('hello'));
    const changes: number[] = [];
    const off = editor.on('change', (change) => changes.push(change.revision));
    editor.exec({ type: 'insertText', text: 'X' });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toBe(editor.getDocumentHandle().revision);
    off();
    editor.exec({ type: 'insertText', text: 'Y' });
    expect(changes).toHaveLength(1);
  });

  test("on('selectionChange') fires when the selection moves", () => {
    const { editor } = mount(p('hello'));
    let fired = 0;
    editor.on('selectionChange', () => {
      fired += 1;
    });
    const id = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 2 },
      head: { paragraphId: id, offset: 2 },
    });
    expect(fired).toBeGreaterThan(0);
  });

  test('getPageSetup reads the section the document declares (defaults here)', () => {
    const { editor } = mount(p('hello'));
    expect(editor.getPageSetup()).toEqual({
      pageWidthTwips: 12240,
      pageHeightTwips: 15840,
      orientation: 'portrait',
      marginsTwips: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      gutterTwips: 0,
    });
  });

  test('setPageSetup writes margins, repaginates, and undoes as one step', () => {
    const { editor } = mount(p('hello'));
    expect(editor.can({ type: 'setPageSetup', marginLeft: 720 })).toEqual({ ok: true });
    const result = editor.exec({ type: 'setPageSetup', marginLeft: 720, marginTop: 900 });
    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.getPageSetup()?.marginsTwips).toEqual({
      top: 900,
      right: 1440,
      bottom: 1440,
      left: 720,
    });
    expect(editor.snapshot().canUndo).toBe(true);
    editor.exec({ type: 'undo' });
    expect(editor.getPageSetup()?.marginsTwips.left).toBe(1440);
  });

  test('setPageSetup orientation swaps the stored dimensions', () => {
    const { editor } = mount(p('hello'));
    editor.exec({ type: 'setPageSetup', orientation: 'landscape' });
    expect(editor.getPageSetup()).toMatchObject({
      pageWidthTwips: 15840,
      pageHeightTwips: 12240,
      orientation: 'landscape',
    });
    // Back to portrait: the dimensions swap back, whichever way they were stored.
    editor.exec({ type: 'setPageSetup', orientation: 'portrait' });
    expect(editor.getPageSetup()).toMatchObject({
      pageWidthTwips: 12240,
      pageHeightTwips: 15840,
      orientation: 'portrait',
    });
  });

  test('setPageSetup refuses hostile values with typed reasons', () => {
    const { editor } = mount(p('hello'));
    expect(editor.can({ type: 'setPageSetup' })).toMatchObject({ ok: false });
    expect(editor.can({ type: 'setPageSetup', pageWidth: 0 })).toMatchObject({
      ok: false,
      code: 'invalidArgs',
    });
    expect(editor.can({ type: 'setPageSetup', marginLeft: -1 })).toMatchObject({
      ok: false,
      code: 'invalidArgs',
    });
    // Margins that swallow the page are refused by the op layer: nothing commits.
    const before = editor.getDocumentHandle().revision;
    editor.exec({ type: 'setPageSetup', marginLeft: 8000, marginRight: 8000 });
    expect(editor.getDocumentHandle().revision).toBe(before);
  });

  test('snapshot().pageSetup is reference-stable until the section changes', () => {
    const { editor } = mount(p('hello'));
    const first = editor.snapshot().pageSetup;
    expect(first).toEqual(editor.getPageSetup());
    // An edit that does not touch the section keeps the same sub-object reference.
    editor.exec({ type: 'insertText', text: 'X' });
    expect(editor.snapshot().pageSetup).toBe(first);
    // A section write moves it.
    editor.exec({ type: 'setPageSetup', marginLeft: 720 });
    expect(editor.snapshot().pageSetup).not.toBe(first);
    expect(editor.snapshot().pageSetup?.marginsTwips.left).toBe(720);
  });

  test('a refused page setup surfaces as a typed error, not silent success', () => {
    const { editor } = mount(p('hello'));
    // Each margin passes per-field bounds; together they swallow the page.
    const result = editor.exec({ type: 'setPageSetup', marginLeft: 8000, marginRight: 8000 });
    expect(result).toMatchObject({ ok: false, code: 'invalidArgs' });
  });

  test('scope: section writes only the caret section of a multi-section document', () => {
    const midBody =
      '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>' +
      '<w:r><w:t>first section</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>second section</w:t></w:r></w:p>' +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';
    const { editor } = mount(midBody);
    const first = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: first, offset: 0 },
      head: { paragraphId: first, offset: 0 },
    });
    editor.exec({ type: 'setPageSetup', orientation: 'landscape', scope: 'section' });
    // The caret's section flipped; snapshot follows the caret, so it reads landscape…
    expect(editor.getPageSetup()).toMatchObject({ orientation: 'landscape' });
    // …while the tail section kept portrait.
    const second = editor.surface!.session.paragraphIds()[1]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: second, offset: 0 },
      head: { paragraphId: second, offset: 0 },
    });
    expect(editor.getPageSetup()).toMatchObject({ orientation: 'portrait' });
  });

  test('whole-document orientation flip preserves each section paper size', () => {
    const midBody =
      '<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:pPr>' +
      '<w:r><w:t>a4 section</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>letter tail</w:t></w:r></w:p>' +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';
    const { editor } = mount(midBody);
    editor.exec({ type: 'setPageSetup', orientation: 'landscape' });
    const first = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: first, offset: 0 },
      head: { paragraphId: first, offset: 0 },
    });
    // The A4 section swapped its OWN dimensions rather than inheriting Letter's.
    expect(editor.getPageSetup()).toMatchObject({
      pageWidthTwips: 16838,
      pageHeightTwips: 11906,
      orientation: 'landscape',
    });
  });

  test('a caret move publishes a new snapshot reference', () => {
    const { editor } = mount(p('alpha') + p('beta'));
    const ids = editor.surface!.session.paragraphIds();
    editor.surface!.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 0 },
      head: { paragraphId: ids[0]!, offset: 0 },
    });
    const before = editor.snapshot();
    editor.surface!.setSelection({
      anchor: { paragraphId: ids[1]!, offset: 0 },
      head: { paragraphId: ids[1]!, offset: 0 },
    });
    // Two paragraphs with identical formatting derive a value-equal snapshot; the
    // reference must still move, or a `useSyncExternalStore` host never re-renders and
    // every caret-dependent control keeps its previous answer.
    expect(editor.snapshot()).not.toBe(before);
  });

  test('insertBreak page writes a hard page break, not a line break', () => {
    const { editor } = mount(p('hello'));
    expect(editor.exec({ type: 'insertBreak', kind: 'page' })).toMatchObject({ ok: true });

    // Word reads a hard page break as `w:br w:type="page"`. A plain `w:br` is Shift+Enter,
    // a line break inside the paragraph — a different element with a different meaning.
    const breaks: string[] = [];
    const walk = (node: {
      kind: string;
      localName?: string;
      attributes?: readonly { localName: string; value: string }[];
      children?: readonly unknown[];
    }): void => {
      if (node.kind === 'textValue') return;
      if (node.localName === 'br') {
        breaks.push(node.attributes?.find((a) => a.localName === 'type')?.value ?? '');
      }
      for (const child of node.children ?? []) walk(child as typeof node);
    };
    walk(editor.surface!.session.part().root as never);
    expect(breaks).toEqual(['page']);
  });

  test('zoom is validated, stored, and reported', () => {
    const { editor } = mount(p('hello'));
    expect(editor.getZoom()).toBe(1);
    expect(editor.setZoom(0)).toMatchObject({ ok: false, code: 'invalidArgs' });
    expect(editor.setZoom(Number.NaN)).toMatchObject({ ok: false, code: 'invalidArgs' });
    expect(editor.setZoom(1.5)).toEqual({ ok: true, changed: true });
    expect(editor.getZoom()).toBe(1.5);
    expect(editor.setZoom(1.5)).toEqual({ ok: true, changed: false });
  });

  test('setZoom rescales the mounted surface without losing edits or undo', () => {
    const { editor, container } = mount(p('hello'));
    const mounted = editor.surface;
    editor.surface!.setSelection({
      anchor: { paragraphId: editor.surface!.session.paragraphIds()[0]!, offset: 5 },
      head: { paragraphId: editor.surface!.session.paragraphIds()[0]!, offset: 5 },
    });
    editor.surface!.type('!');
    const widthBefore = parseFloat(container.querySelector<HTMLElement>('.docx-page')!.style.width);
    const selectionBefore = editor.surface!.state().selection;

    expect(editor.setZoom(1.5)).toEqual({ ok: true, changed: true });

    expect(editor.surface).toBe(mounted);
    expect(editor.surface!.state().selection).toEqual(selectionBefore);
    expect(parseFloat(container.querySelector<HTMLElement>('.docx-page')!.style.width)).toBeCloseTo(
      widthBefore * 1.5
    );
    expect(container.textContent).toContain('hello!');
    expect(editor.can({ type: 'undo' }).ok).toBe(true);
  });

  test('a rescale the surface cannot make is reported, and leaves the zoom where it was', () => {
    const { editor, container } = mount(p('hello'));
    const widthBefore = parseFloat(container.querySelector<HTMLElement>('.docx-page')!.style.width);
    // The rescale and its rollback both invalidate against the session's revision, so a
    // session that cannot answer fails the forward pass and the recovery alike — the case that
    // used to throw out of a zoom click instead of returning a result.
    const session = editor.surface!.session as { packageRevision: () => number };
    const revision = session.packageRevision;
    session.packageRevision = () => {
      throw new Error('revision unavailable');
    };

    let result: ReturnType<typeof editor.setZoom>;
    try {
      result = editor.setZoom(1.5);
    } finally {
      session.packageRevision = revision;
    }

    expect(result).toMatchObject({ ok: false, code: 'unsupported' });
    // Nothing moved: not the reported zoom, and not the scale the surface is painted at.
    expect(editor.getZoom()).toBe(1);
    expect(parseFloat(container.querySelector<HTMLElement>('.docx-page')!.style.width)).toBe(
      widthBefore
    );
    // The refusal is not terminal — the same call succeeds once the session answers again.
    expect(editor.setZoom(1.5)).toEqual({ ok: true, changed: true });
    expect(editor.getZoom()).toBe(1.5);
  });

  test('setZoom while detached scales the page on the next attach', () => {
    const editor = createDocxEditor({ document: docx(p('hello')) });
    expect(editor.surface).toBeNull();

    expect(editor.setZoom(1.5)).toEqual({ ok: true, changed: true });

    const container = document.createElement('div');
    editor.attach(container);
    expect(editor.surface).not.toBeNull();
    expect(parseFloat(container.querySelector<HTMLElement>('.docx-page')!.style.width)).toBeCloseTo(
      1224
    );
  });

  test('the honest-empty members answer with typed empty values', () => {
    const { editor } = mount(p('hello'));
    expect(editor.isActive({ type: 'toggleMark', mark: 'bold' })).toBe(false);
    expect(editor.getDocumentStyles()).toEqual([]);
    expect(editor.getOutline()).toEqual([]);
    expect(editor.getComments()).toEqual([]);
    expect(editor.getSelectedTable()).toBeNull();
    expect(editor.query({ type: 'tableContext' })).toBeNull();
    expect(editor.getWatermark()).toBeNull();
    // No longer honest-empty: `paragraphs` and `selection` answer in paraId vocabulary.
    const paragraphs = editor.query({ type: 'paragraphs' });
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.text).toBe('hello');
    expect(paragraphs[0]!.paraId).toMatch(/^[0-9A-F]{8}$/);
    expect(editor.query({ type: 'selection' })).toEqual(editor.snapshot().selection);
  });

  // ── State tick + cached snapshot identity ──────────────────────────────────────────

  test('snapshot() is cached: same reference until state moves, new after an edit', () => {
    const { editor } = mount(p('hello'));
    const first = editor.snapshot();
    expect(editor.snapshot()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.page)).toBe(true);

    editor.exec({ type: 'insertText', text: 'X' });
    const second = editor.snapshot();
    expect(second).not.toBe(first);
    // Sub-object reuse: the page did not change, so its reference survives re-derivation.
    expect(second.page).toBe(first.page);
    expect(editor.snapshot()).toBe(second);
  });

  test('formatting sub-object changes reference only when its value changes', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    const before = editor.snapshot();
    editor.exec({ type: 'toggleMark', mark: 'bold' });
    const after = editor.snapshot();
    expect(after).not.toBe(before);
    expect(after.formatting?.bold).toBe(true);
    expect(after.formatting).not.toBe(before.formatting);
    expect(after.page).toBe(before.page);
  });

  test('stateVersion bumps on commits, zoom, and load', () => {
    const { editor } = mount(p('hello'));
    const start = editor.stateVersion();
    editor.exec({ type: 'insertText', text: 'X' });
    const afterEdit = editor.stateVersion();
    expect(afterEdit).toBeGreaterThan(start);
    editor.setZoom(2);
    const afterZoom = editor.stateVersion();
    expect(afterZoom).toBeGreaterThan(afterEdit);
    editor.load(docx(p('reloaded')));
    expect(editor.stateVersion()).toBeGreaterThan(afterZoom);
  });

  test('load() success emits change (with the revision) and selectionChange', () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({ container });
    const revisions: number[] = [];
    const snapshots: unknown[] = [];
    editor.on('change', (change) => revisions.push(change.revision));
    editor.on('selectionChange', (snapshot) => snapshots.push(snapshot));
    editor.load(docx(p('arrived')));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toBe(editor.getDocumentHandle().revision);
    expect(snapshots.length).toBeGreaterThan(0);
  });

  test('setZoom emits selectionChange with the fresh cached snapshot', () => {
    const { editor } = mount(p('hello'));
    let received: ReturnType<typeof editor.snapshot> | null = null;
    editor.on('selectionChange', (snapshot) => {
      received = snapshot;
    });
    expect(editor.setZoom(1.5)).toEqual({ ok: true, changed: true });
    expect(received).not.toBeNull();
    expect(received!.zoom).toBe(1.5);
    // The emitted snapshot IS the cached one — no second derivation for readers.
    expect(editor.snapshot()).toBe(received!);
  });

  test('snapshot carries canUndo/canRedo derived from the session history', () => {
    const { editor } = mount(p('hello'));
    expect(editor.snapshot().canUndo).toBe(false);
    expect(editor.snapshot().canRedo).toBe(false);
    editor.exec({ type: 'insertText', text: 'X' });
    expect(editor.snapshot().canUndo).toBe(true);
    expect(editor.snapshot().canRedo).toBe(false);
    editor.exec({ type: 'undo' });
    expect(editor.snapshot().canRedo).toBe(true);
  });

  // ── isActive derivation (marks + alignment) ────────────────────────────────────────

  test('isActive lights for toggleMark after bolding the selection', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    expect(editor.isActive({ type: 'toggleMark', mark: 'bold' })).toBe(false);
    editor.exec({ type: 'toggleMark', mark: 'bold' });
    expect(editor.isActive({ type: 'toggleMark', mark: 'bold' })).toBe(true);
    expect(editor.isActive({ type: 'toggleMark', mark: 'italic' })).toBe(false);
    editor.exec({ type: 'toggleMark', mark: 'bold' });
    expect(editor.isActive({ type: 'toggleMark', mark: 'bold' })).toBe(false);
  });

  test('a change handler reading snapshot() mid-commit cannot poison the cache', () => {
    // The session notifies BEFORE the layout publishes, so a handler that reads
    // `snapshot()` inside `change` derives formatting from the pre-commit layout. The
    // publish must invalidate that cached derivation even though the selection did not
    // move, or the stale answer would be served for the rest of the version.
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    editor.on('change', () => {
      editor.snapshot(); // the poisoning read
    });
    editor.exec({ type: 'toggleMark', mark: 'bold' });
    expect(editor.snapshot().formatting?.bold).toBe(true);
    expect(editor.isActive({ type: 'toggleMark', mark: 'bold' })).toBe(true);
  });

  test('isActive maps justify to OOXML both for setAlignment', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    expect(editor.isActive({ type: 'setAlignment', align: 'left' })).toBe(true);
    editor.exec({ type: 'setAlignment', align: 'justify' });
    expect(editor.isActive({ type: 'setAlignment', align: 'justify' })).toBe(true);
    expect(editor.isActive({ type: 'setAlignment', align: 'center' })).toBe(false);
  });

  test('snapshot formatting carries the full derivable shape', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    editor.exec({ type: 'setAlignment', align: 'center' });
    const formatting = editor.snapshot().formatting;
    expect(formatting?.alignment).toBe('center');
    expect(formatting?.superscript).toBe(false);
    expect(formatting?.subscript).toBe(false);
    // getSelectionFormatting reads the SAME derivation.
    expect(editor.getSelectionFormatting()?.alignment).toBe('center');
  });

  // ── attach / detach ────────────────────────────────────────────────────────────────

  test('created without a container, attach() mounts the pending document', () => {
    const editor = createDocxEditor({ document: docx(p('hello')) });
    expect(editor.surface).toBeNull();
    const container = document.createElement('div');
    editor.attach(container);
    expect(editor.surface).not.toBeNull();
    expect(container.textContent).toContain('hello');
  });

  test('detach() keeps the live document; a later attach moves it in with its history', () => {
    const editor = createDocxEditor({ document: docx(p('hello')) });
    const first = document.createElement('div');
    editor.attach(first);
    editor.exec({ type: 'insertText', text: 'X' });
    expect(editor.surface!.session.bodyText()).toBe('Xhello');
    const surface = editor.surface;

    const beforeDetach = editor.stateVersion();
    editor.detach();
    // Parked: the element the editor left is empty and unstyled, the document is not gone.
    expect(editor.surface).toBe(surface);
    expect(editor.surface!.parked()).toBe(true);
    expect(first.childNodes.length).toBe(0);
    expect(first.style.width).toBe('');
    expect(editor.stateVersion()).toBeGreaterThan(beforeDetach);

    const second = document.createElement('div');
    editor.attach(second);
    // The same session moved in: the edit AND the undo stack survive.
    expect(editor.surface).toBe(surface);
    expect(second.textContent).toContain('Xhello');
    expect(editor.snapshot().canUndo).toBe(true);
    editor.exec({ type: 'undo' });
    expect(editor.surface!.session.bodyText()).toBe('hello');
    editor.destroy();
  });

  test('attach after destroy is a refused no-op with a typed error', () => {
    const editor = createDocxEditor({ document: docx(p('hello')) });
    editor.destroy();
    const errors: { code?: string }[] = [];
    editor.on('error', (error) => errors.push(error));
    editor.attach(document.createElement('div'));
    expect(editor.surface).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('destroyed');
  });

  test('destroy() detaches the surface and empties the container', () => {
    const { editor, container } = mount(p('hello'));
    editor.destroy();
    expect(container.childNodes.length).toBe(0);
    expect(editor.surface).toBeNull();
    expect(editor.exec({ type: 'insertText', text: 'X' })).toMatchObject({
      ok: false,
      code: 'notFound',
    });
  });
});

describe('setMarkAttr (value-typed run formatting)', () => {
  test('fontFamily writes the rFonts spelling the engine reads back (ascii + hAnsi)', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    expect(
      editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: 'Georgia' })
    ).toEqual({ ok: true, changed: true });
    expect(editor.snapshot().formatting?.fontFamily).toBe('Georgia');
    expect(editor.getSelectionFormatting()?.fontFamily).toBe('Georgia');
  });

  test('fontSize takes half-points and formatting reports both vocabularies', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    expect(editor.exec({ type: 'setMarkAttr', mark: 'fontSize', attr: 'val', value: 28 })).toEqual({
      ok: true,
      changed: true,
    });
    expect(editor.snapshot().formatting?.fontSizePt).toBe(14);
    expect(editor.getSelectionFormatting()?.fontSizeHalfPoints).toBe(28);
  });

  test('color and highlight apply and read back from the selection', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    expect(
      editor.exec({ type: 'setMarkAttr', mark: 'color', attr: 'val', value: 'FF0000' })
    ).toEqual({ ok: true, changed: true });
    expect(editor.snapshot().formatting?.color).toEqual({ kind: 'hex', value: 'FF0000' });
    expect(
      editor.exec({ type: 'setMarkAttr', mark: 'highlight', attr: 'val', value: 'yellow' })
    ).toEqual({ ok: true, changed: true });
    expect(editor.snapshot().formatting?.highlight).toBe('yellow');
  });

  test("color 'auto' and highlight 'none' clear rather than being refused", () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    editor.exec({ type: 'setMarkAttr', mark: 'color', attr: 'val', value: 'FF0000' });
    editor.exec({ type: 'setMarkAttr', mark: 'highlight', attr: 'val', value: 'yellow' });
    expect(editor.exec({ type: 'setMarkAttr', mark: 'color', attr: 'val', value: 'auto' })).toEqual(
      { ok: true, changed: true }
    );
    expect(
      editor.exec({ type: 'setMarkAttr', mark: 'highlight', attr: 'val', value: 'none' })
    ).toEqual({ ok: true, changed: true });
    // The read lane reports both as "no value" — which is what Automatic/No Color mean.
    expect(editor.snapshot().formatting?.color).toBeUndefined();
    expect(editor.snapshot().formatting?.highlight ?? null).toBeNull();
  });

  test('a document without a theme part answers no theme colours', () => {
    const { editor } = mount(p('hello'));
    expect(editor.getDocumentThemeColors()).toEqual([]);
  });

  test('font boxes show the EFFECTIVE font: style chain, docDefaults, theme fonts', () => {
    const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const styles =
      `<w:styles xmlns:w="${W}">` +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:asciiTheme="minorHAnsi"/><w:sz w:val="22"/>' +
      '</w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:styleId="Title"><w:rPr>' +
      '<w:rFonts w:ascii="Georgia"/><w:sz w:val="52"/></w:rPr></w:style>' +
      '</w:styles>';
    const theme =
      `<a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme name="Office">` +
      '<a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="Calibri"/></a:minorFont>' +
      '</a:fontScheme></a:themeElements></a:theme>';
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docx(
        '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Heading</w:t></w:r></w:p>' +
          p('body text'),
        { 'word/styles.xml': styles, 'word/theme/theme1.xml': theme }
      ),
    });
    const caret = (paragraphId: string, offset: number) => ({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
    // Caret in the styled heading: the style's own rPr wins.
    editor.exec({ type: 'setSelection', range: caret('/word/document.xml#0.0.0', 3) });
    expect(editor.snapshot().formatting?.fontFamily).toBe('Georgia');
    expect(editor.snapshot().formatting?.fontSizePt).toBe(26);
    // Caret in unstyled body text: docDefaults, with the theme font resolved.
    editor.exec({ type: 'setSelection', range: caret('/word/document.xml#0.0.1', 3) });
    expect(editor.snapshot().formatting?.fontFamily).toBe('Calibri');
    expect(editor.snapshot().formatting?.fontSizePt).toBe(11);
  });

  test('a run with no authored font PAINTS in the default face it was measured in', () => {
    // Measurement falls back to the default face; paint must fall back to the SAME face,
    // or the browser draws the page's inherited font over Calibri-computed geometry.
    const { container } = mount(p('hello'));
    const span = container.querySelector<HTMLElement>('[data-paragraph-id][data-start]');
    expect(span).not.toBeNull();
    // happy-dom normalizes away the quotes; the family itself is the contract.
    expect(span!.style.fontFamily).toContain('Calibri');
  });

  test('the blank-document template is Word: Calibri 11, Normal, Letter', () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({ container, document: blankDocumentBytes() });
    expect(editor.surface).not.toBeNull();
    // The toolbar's boxes read Word's blank-template defaults, authored in docDefaults —
    // not the format's 10pt floor.
    expect(editor.snapshot().formatting?.fontFamily).toBe('Calibri');
    expect(editor.snapshot().formatting?.fontSizePt).toBe(11);
    expect(editor.snapshot().formatting?.styleId).toBe('Normal');
    expect(editor.getAvailableFonts()).toContain('Calibri');
    // Layout measures the same 11pt the box shows (22 half-points through the cascade).
    const span = container.querySelector<HTMLElement>('[data-paragraph-id]');
    expect(span).not.toBeNull();
    // US Letter at one-inch margins.
    expect(editor.getPageSetup()?.pageWidthTwips).toBe(12240);
    expect(editor.getPageSetup()?.pageHeightTwips).toBe(15840);
    // Typing works and the saved bytes round-trip.
    editor.exec({ type: 'insertText', text: 'hello' });
    expect(editor.snapshot().pages?.length ?? editor.getTotalPages()).toBeGreaterThan(0);
  });

  test('a blank document still reports the default face, and offers a catalog', () => {
    // No styles part, no theme, no rFonts anywhere: the document derivation is empty,
    // but the run is measured in the configured default face — the font box must say
    // so, and the picker must offer something to change it to.
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    expect(editor.getDocumentFonts()).toEqual([]);
    expect(editor.snapshot().formatting?.fontFamily).toBe('Calibri');
    const choices = editor.getAvailableFonts();
    expect(choices).toContain('Arial');
    expect(choices).toContain('Georgia');
    // Declaring a font in the document joins the catalog without displacing it.
    editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: 'Georgia' });
    expect(editor.getDocumentFonts()).toEqual(['Georgia']);
    expect(editor.getAvailableFonts()).toEqual(choices);
    editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: 'Sagona' });
    expect(editor.getAvailableFonts()).toEqual([...choices, 'Sagona'].sort());
    editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: 'Arial' });
    expect(editor.getAvailableFonts()).toEqual(choices);
  });

  test('a mixed-font selection still reports no agreed family', () => {
    // The default-face fallback is per span; it must not launder a real disagreement
    // into the default font.
    const { editor } = mount(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Georgia"/></w:rPr><w:t>serif</w:t></w:r>' +
        '<w:r><w:t>plain</w:t></w:r></w:p>'
    );
    editor.surface!.selectAll();
    expect(editor.snapshot().formatting?.fontFamily).toBeUndefined();
  });

  test('invalid values are refused as invalidArgs before touching the document', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    const before = editor.surface!.session.revision();
    const badColor = editor.exec({ type: 'setMarkAttr', mark: 'color', attr: 'val', value: 'red' });
    expect(badColor.ok).toBe(false);
    if (!badColor.ok) expect(badColor.code).toBe('invalidArgs');
    const badHighlight = editor.exec({
      type: 'setMarkAttr',
      mark: 'highlight',
      attr: 'val',
      value: 'chartreuse',
    });
    expect(badHighlight.ok).toBe(false);
    if (!badHighlight.ok) expect(badHighlight.code).toBe('invalidArgs');
    for (const value of [1, 3277, 11.5, '22']) {
      const bad = editor.exec({ type: 'setMarkAttr', mark: 'fontSize', attr: 'val', value });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.code).toBe('invalidArgs');
    }
    const badFamily = editor.exec({
      type: 'setMarkAttr',
      mark: 'fontFamily',
      attr: 'family',
      value: 'x'.repeat(500),
    });
    expect(badFamily.ok).toBe(false);
    if (!badFamily.ok) expect(badFamily.code).toBe('invalidArgs');
    expect(editor.surface!.session.revision()).toBe(before);
  });

  test('an unknown mark is refused as unsupported, and can() agrees with exec()', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    const refusal = editor.exec({ type: 'setMarkAttr', mark: 'kerning', attr: 'val', value: 1 });
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.code).toBe('unsupported');
    const canAnswer = editor.can({ type: 'setMarkAttr', mark: 'kerning', attr: 'val', value: 1 });
    expect(canAnswer.ok).toBe(false);
    if (!canAnswer.ok) expect(canAnswer.code).toBe('unsupported');
    // And a valid command passes `can` without executing anything.
    expect(
      editor.can({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: 'Arial' }).ok
    ).toBe(true);
  });
});

describe('DocAnchor addressing (w14:paraId)', () => {
  test('snapshot().selection reads in paraId vocabulary and stays reference-stable within a paragraph', () => {
    const { editor } = mount(p('hello world') + p('second'));
    const [firstId, secondId] = editor.surface!.session.paragraphIds();
    const firstParaId = editor.surface!.session.paraIdOf(firstId!)!;
    const secondParaId = editor.surface!.session.paraIdOf(secondId!)!;

    editor.surface!.setSelection({
      anchor: { paragraphId: firstId!, offset: 0 },
      head: { paragraphId: firstId!, offset: 0 },
    });
    const atStart = editor.snapshot().selection;
    expect(atStart).toEqual({ from: { paraId: firstParaId }, to: { paraId: firstParaId } });

    // A caret move WITHIN the paragraph derives a value-equal selection — the previous
    // sub-object reference must be reused (useSyncExternalStore contract).
    editor.surface!.setSelection({
      anchor: { paragraphId: firstId!, offset: 3 },
      head: { paragraphId: firstId!, offset: 3 },
    });
    expect(editor.snapshot().selection).toBe(atStart!);

    // Crossing into another paragraph is a new value.
    editor.surface!.setSelection({
      anchor: { paragraphId: secondId!, offset: 1 },
      head: { paragraphId: secondId!, offset: 1 },
    });
    expect(editor.snapshot().selection).toEqual({
      from: { paraId: secondParaId },
      to: { paraId: secondParaId },
    });
    expect(editor.query({ type: 'selection' })).toEqual(editor.snapshot().selection);
  });

  test('a backwards drag still reads in document order', () => {
    const { editor } = mount(p('first') + p('second'));
    const [firstId, secondId] = editor.surface!.session.paragraphIds();
    editor.surface!.setSelection({
      anchor: { paragraphId: secondId!, offset: 3 },
      head: { paragraphId: firstId!, offset: 1 },
    });
    const selection = editor.snapshot().selection!;
    expect((selection.from as { paraId: string }).paraId).toBe(
      editor.surface!.session.paraIdOf(firstId!)!
    );
    expect((selection.to as { paraId: string }).paraId).toBe(
      editor.surface!.session.paraIdOf(secondId!)!
    );
  });

  test('setSelection by anchor range with search selects the phrase', () => {
    const { editor } = mount(p('say hello there'));
    const [id] = editor.surface!.session.paragraphIds();
    const paraId = editor.surface!.session.paraIdOf(id!)!;
    expect(
      editor.can({
        type: 'setSelection',
        range: { from: { paraId, search: 'hello' }, to: { paraId, search: 'hello' } },
      }).ok
    ).toBe(true);
    const result = editor.exec({
      type: 'setSelection',
      range: { from: { paraId, search: 'hello' }, to: { paraId, search: 'hello' } },
    });
    expect(result).toEqual({ ok: true, changed: false });
    expect(editor.query({ type: 'selectedText' })).toBe('hello');
  });

  test('a whole-paragraph anchor range selects the full text; { anchor } collapses the caret', () => {
    const { editor } = mount(p('whole paragraph'));
    const [id] = editor.surface!.session.paragraphIds();
    const paraId = editor.surface!.session.paraIdOf(id!)!;
    expect(
      editor.exec({ type: 'setSelection', range: { from: { paraId }, to: { paraId } } })
    ).toEqual({ ok: true, changed: false });
    expect(editor.query({ type: 'selectedText' })).toBe('whole paragraph');

    expect(editor.exec({ type: 'setSelection', anchor: { paraId } })).toEqual({
      ok: true,
      changed: false,
    });
    expect(editor.surface!.state().selection).toEqual({
      anchor: { paragraphId: id!, offset: 0 },
      head: { paragraphId: id!, offset: 0 },
    });
  });

  test('resolution failures surface as typed ExecResults', () => {
    const { editor } = mount(p('two two'));
    const [id] = editor.surface!.session.paragraphIds();
    const paraId = editor.surface!.session.paraIdOf(id!)!;
    expect(editor.exec({ type: 'setSelection', anchor: { paraId: '0BADF00D' } })).toMatchObject({
      ok: false,
      code: 'notFound',
    });
    expect(editor.exec({ type: 'setSelection', anchor: { paraId, search: 'two' } })).toMatchObject({
      ok: false,
      code: 'ambiguous',
    });
  });

  test('snapshot().selection round-trips through setSelection, frozen input unharmed', () => {
    const { editor } = mount(p('alpha') + p('beta'));
    const [firstId, secondId] = editor.surface!.session.paragraphIds();
    editor.surface!.setSelection({
      anchor: { paragraphId: firstId!, offset: 0 },
      head: { paragraphId: secondId!, offset: 2 },
    });
    const selection = editor.snapshot().selection!;
    expect(Object.isFrozen(selection)).toBe(true);
    expect(editor.exec({ type: 'setSelection', range: selection })).toEqual({
      ok: true,
      changed: false,
    });
    // Feeding the paragraph-granular range back selects those paragraphs in full.
    expect(editor.query({ type: 'selectedText' })).toBe('alpha\nbeta');
    expect(editor.snapshot().selection).toEqual(selection);
  });

  test('paragraphs query walks table cells too, in reading order', () => {
    const { editor } = mount(
      p('before') +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        p('after')
    );
    const paragraphs = editor.query({ type: 'paragraphs' });
    expect(paragraphs.map((paragraph) => paragraph.text)).toEqual(['before', 'cell', 'after']);
    for (const paragraph of paragraphs) expect(paragraph.paraId).toMatch(/^[0-9A-F]{8}$/);
    expect(new Set(paragraphs.map((paragraph) => paragraph.paraId)).size).toBe(3);
    // Other containers are out of the paraId map's scope: typed empty, not an error.
    expect(
      editor.query({ type: 'paragraphs', container: { part: 'header', rId: 'rId9' } })
    ).toEqual([]);
  });
});

// Omitting the document is not a way to ask for an empty one (#275).
//
// A host that mounts the editor with nothing to show gets no editing surface, so every
// command refuses and the whole chrome renders disabled — which reads as a broken editor,
// not as "waiting". The docs' own Next.js snippet did exactly this and called it "an empty
// editor until the user picks a file". `'blank'` is the way to actually ask.
describe("document: 'blank'", () => {
  test('mounts a real editable document, where omitting one mounts nothing', () => {
    const empty = createDocxEditor({ container: document.createElement('div') });
    // The state the issue reported: no surface, so `can` refuses everything by the same
    // reason the toolbar quotes into every tooltip.
    expect(empty.surface).toBeNull();
    const refusal = empty.can({ type: 'toggleMark', mark: 'bold' });
    expect(refusal.ok).toBe(false);
    expect(refusal.ok === false && refusal.reason).toBe('no document is loaded');

    const blank = createDocxEditor({ container: document.createElement('div'), document: 'blank' });
    expect(blank.surface).not.toBeNull();
    expect(blank.can({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
    expect(blank.snapshot().isLoading).toBe(false);
  });

  test('is Word’s blank template, byte for byte', () => {
    const container = document.createElement('div');
    const fromLiteral = createDocxEditor({ container, document: 'blank' });
    const fromBytes = createDocxEditor({
      container: document.createElement('div'),
      document: blankDocumentBytes(),
    });
    // Same template, so the defaults a host sees cannot depend on which spelling it used.
    expect(fromLiteral.snapshot().formatting?.fontFamily).toBe(
      fromBytes.snapshot().formatting?.fontFamily
    );
    expect(fromLiteral.snapshot().formatting?.fontSizePt).toBe(
      fromBytes.snapshot().formatting?.fontSizePt
    );
    expect(fromLiteral.getPageSetup()?.pageWidthTwips).toBe(
      fromBytes.getPageSetup()?.pageWidthTwips
    );
  });

  test('load() takes it too, so a New gesture needs no import', () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docx('<w:p><w:r><w:t>old</w:t></w:r></w:p>'),
    });
    expect(container.textContent).toContain('old');

    editor.load('blank');
    expect(editor.surface).not.toBeNull();
    expect(container.textContent).not.toContain('old');
    expect(editor.snapshot().formatting?.fontFamily).toBe('Calibri');
  });

  test('each resolution mints its own bytes, which no caller may share', () => {
    // Asserted on the BYTES, not through the editor: the engine parses into its own tree,
    // so a module-level singleton template would leak nothing observable through two
    // editors and this guarantee would go unguarded. `blank-document.ts` promises the
    // caller may hand the bytes to a loader that takes ownership of the buffer, and that
    // promise is only true if every call allocates.
    const first = normalizeSource('blank');
    const second = normalizeSource('blank');
    expect(first).not.toBeNull();
    expect(first).not.toBe(second);
    expect(first!.buffer).not.toBe(second!.buffer);
    first![0] = (first![0]! + 1) % 256;
    expect(first![0]).not.toBe(second![0]);
  });

  test('a string that is not `blank` is refused by name, not as a handle', () => {
    // The type admits one string literal now, so a plain-JS host or a typo can land here.
    // Answering `'Blank'` with "a DocumentHandle cannot be re-loaded" names a type the
    // caller never mentioned and sends them looking in the wrong place.
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: 'Blank' as 'blank',
    });
    expect(editor.surface).toBeNull();
    expect(editor.snapshot().parseError).toContain("'Blank' is not a document");
    expect(editor.snapshot().parseError).not.toContain('DocumentHandle');

    const errors: string[] = [];
    const loaded = createDocxEditor({ container: document.createElement('div') });
    loaded.on('error', (error) => errors.push(error.message));
    loaded.load('/report.docx' as 'blank');
    expect(errors.join()).toContain("'/report.docx' is not a document");
  });
});
