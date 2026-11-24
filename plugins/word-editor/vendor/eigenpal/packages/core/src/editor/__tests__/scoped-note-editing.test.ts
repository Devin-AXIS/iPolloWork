// Scoped footnote/endnote editing on the paginated surface.
//
// Entering a painted note binds EditorScope { kind: 'note', id: 'footnote:N' },
// routes the body input path through notesPart, and Escape restores body selection.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { MAX_NOTE_PREVIEW_CHARS } from '../surface-note-state.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function noteDoc(noteText = 'Note text'): Uint8Array {
  const body =
    `<w:p><w:r><w:t>Body</w:t></w:r>` +
    `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
    `<w:footnoteReference w:id="1"/></w:r></w:p>`;
  const footnotes =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>${noteText}</w:t></w:r></w:p></w:footnote>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${footnotes}</w:footnotes>`),
  });
}

function mount(bytes: Uint8Array): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return { surface: result.surface, container };
}

describe('scoped note editing', () => {
  test('painted notes are not HF furniture and carry scope attrs', () => {
    const { container, surface } = mount(noteDoc());
    const note = container.querySelector(
      '[data-docx-note][data-docx-note-scope="footnote:1"]'
    ) as HTMLElement;
    expect(note).toBeTruthy();
    expect(note.closest('[data-docx-hf]')).toBeNull();
    expect(note.getAttribute('role')).toBe('doc-footnote');
    const sep = container.querySelector('[data-docx-note-separator]');
    expect(sep?.getAttribute('contenteditable')).toBe('false');
    const ref = container.querySelector('[data-docx-note-ref]') as HTMLElement;
    expect(ref?.dataset.docxNoteScope).toBe('footnote:1');
    surface.destroy();
  });

  test('enterNote opens notesPart scope; typing stays in the note', () => {
    const { surface } = mount(noteDoc());
    expect(surface.enterNote('footnote:1')).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:1' });
    // The generated noteRef atom occupies offset 0; editing starts after the mark.
    expect(surface.state().selection).toEqual({
      anchor: { paragraphId: '/word/footnotes.xml#0.2.0', offset: 1 },
      head: { paragraphId: '/word/footnotes.xml#0.2.0', offset: 1 },
    });
    surface.type('!');
    const noteText = surface.session.storyText({ kind: 'notesPart', noteKind: 'footnote' });
    expect(noteText).toContain('!');
    expect(surface.session.bodyText()).toContain('Body');
    expect(surface.session.bodyText()).not.toContain('!');
    surface.destroy();
  });

  test('note caret is parented into the note story instead of body page content', () => {
    const { container, surface } = mount(noteDoc());
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    pages.focus();
    expect(surface.enterNote('footnote:1')).toBe(true);
    const caret = container.querySelector<HTMLElement>('[data-docx-caret]');
    expect(caret).toBeTruthy();
    expect(caret?.parentElement?.dataset.docxNoteScope).toBe('footnote:1');
    expect(caret?.parentElement?.matches('[data-docx-note]')).toBe(true);
    surface.destroy();
  });

  test('Escape / exitNote restores prior body selection', () => {
    const { surface } = mount(noteDoc());
    const bodyIds = surface.session.paragraphIds();
    const first = bodyIds[0]!;
    surface.setSelection({
      anchor: { paragraphId: first, offset: 0 },
      head: { paragraphId: first, offset: 4 },
    });
    const saved = surface.state().selection;
    expect(surface.enterNote('footnote:1')).toBe(true);
    surface.exitNote();
    expect(surface.activeScope()).toEqual({ kind: 'body' });
    expect(surface.state().selection).toEqual(saved);
    surface.destroy();
  });

  test('select-all stays inside the open note story', () => {
    const { surface } = mount(noteDoc());
    expect(surface.enterNote('footnote:1')).toBe(true);
    surface.selectAll();
    const { anchor, head } = surface.state().selection;
    // Layout-scoped order (not whole notesPart) keeps separator notes out.
    const note = surface
      .layout()
      .pages.flatMap((p) => p.footnotes?.notes ?? [])
      .find((n) => n.scopeId === 'footnote:1');
    const noteIds = new Set(
      (note?.fragments ?? []).filter((f) => f.kind === 'paragraph').map((f) => f.paragraphId)
    );
    expect(noteIds.has(anchor.paragraphId)).toBe(true);
    expect(noteIds.has(head.paragraphId)).toBe(true);
    surface.destroy();
  });

  test('arrow navigation stays inside the open note story', () => {
    const { surface } = mount(noteDoc());
    expect(surface.enterNote('footnote:1')).toBe(true);
    const before = surface.state().selection.head;
    surface.navigate('right');
    const after = surface.state().selection.head;
    expect(after.paragraphId).toBe(before.paragraphId);
    expect(after.offset).toBe(before.offset + 1);
    surface.destroy();
  });

  test('formatting applies inside the note scope', () => {
    const { surface } = mount(noteDoc());
    expect(surface.enterNote('footnote:1')).toBe(true);
    const note = surface
      .layout()
      .pages.flatMap((p) => p.footnotes?.notes ?? [])
      .find((n) => n.scopeId === 'footnote:1');
    const fragment = note?.fragments.find((f) => f.kind === 'paragraph');
    expect(fragment).toBeTruthy();
    if (!fragment || fragment.kind !== 'paragraph') throw new Error('missing note paragraph');
    // Skip projected noteRef span; format the authored text run.
    const textSpan = fragment.lines
      .flatMap((line) => line.spans)
      .find((span) => span.text.includes('Note') && !span.projected);
    expect(textSpan).toBeTruthy();
    surface.setSelection({
      anchor: { paragraphId: fragment.paragraphId, offset: textSpan!.range.start },
      head: { paragraphId: fragment.paragraphId, offset: textSpan!.range.end },
    });
    surface.toggleRunProperty('b');
    expect(surface.formatting().bold).toBe(true);
    surface.destroy();
  });

  test('insertNote / deleteNote wire through Editor facade', () => {
    const bytes = noteDoc();
    const editor = createDocxEditor({ document: bytes });
    const host = document.createElement('div');
    document.body.append(host);
    editor.attach(host);
    expect(editor.can({ type: 'insertNote', noteKind: 'endnote' }).ok).toBe(true);
    expect(editor.exec({ type: 'insertNote', noteKind: 'endnote' }).ok).toBe(true);
    const snap = editor.snapshot();
    expect(snap).toBeTruthy();
    editor.detach();
  });

  test('note preview text is bounded before React hover chrome receives it', () => {
    const editor = createDocxEditor({ document: noteDoc('x'.repeat(MAX_NOTE_PREVIEW_CHARS * 3)) });
    const host = document.createElement('div');
    document.body.append(host);
    editor.attach(host);
    const preview = editor.getNotePreviewText('footnote:1');
    expect(preview).not.toBeNull();
    expect(preview!.length).toBe(MAX_NOTE_PREVIEW_CHARS);
    editor.detach();
  });

  test('insertNote opens the new note after its generated mark', () => {
    const { surface } = mount(noteDoc());
    expect(surface.insertNote('endnote')).toBe(true);
    const scope = surface.activeScope();
    expect(scope.kind).toBe('note');
    if (scope.kind !== 'note') throw new Error('new note did not open');
    expect(scope.id).toMatch(/^endnote:\d+$/);
    expect(surface.state().selection.anchor.offset).toBe(1);
    surface.type('New endnote');
    expect(surface.session.storyText({ kind: 'notesPart', noteKind: 'endnote' })).toContain(
      'New endnote'
    );
    surface.destroy();
  });

  test('undo reverts a note-scoped type in one step', () => {
    const { surface } = mount(noteDoc());
    expect(surface.enterNote('footnote:1')).toBe(true);
    const before = surface.session.storyText({ kind: 'notesPart', noteKind: 'footnote' });
    surface.type('Z');
    expect(surface.session.storyText({ kind: 'notesPart', noteKind: 'footnote' })).not.toBe(before);
    surface.undo();
    expect(surface.session.storyText({ kind: 'notesPart', noteKind: 'footnote' })).toBe(before);
    surface.destroy();
  });

  test('root listener: body note-ref pointerdown enters note scope; Escape returns body', () => {
    const { container, surface } = mount(noteDoc());
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    Object.defineProperty(pages, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 2000,
        width: 1000,
        height: 2000,
        x: 0,
        y: 0,
      }),
    });
    pages.focus();
    const ref = container.querySelector('[data-docx-note-ref]') as HTMLElement;
    expect(ref?.dataset.docxNoteScope).toBe('footnote:1');
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 10,
      clientY: 10,
    });
    ref.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:1' });
    pages.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    expect(surface.activeScope()).toEqual({ kind: 'body' });
    surface.destroy();
  });

  test('entering a citation reveals its note instead of leaving an off-screen scope open', () => {
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    document.body.append(scroller);
    const { container, surface } = mount(noteDoc());
    scroller.append(container);
    Object.defineProperty(scroller, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(scroller, 'scrollHeight', { value: 10_000, configurable: true });
    let revealedTop: number | null = null;
    scroller.scrollTo = ((options: ScrollToOptions) => {
      revealedTop = options.top ?? null;
    }) as typeof scroller.scrollTo;

    expect(surface.enterNote('footnote:1')).toBe(true);
    expect(revealedTop).not.toBeNull();
    expect(revealedTop!).toBeGreaterThan(0);
    expect(surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:1' });

    surface.destroy();
    scroller.remove();
  });

  test('note hyperlink owns footnotes rels; undo restores; no stray body relationship', () => {
    const { surface } = mount(noteDoc('Note text'));
    expect(surface.enterNote('footnote:1')).toBe(true);
    const paragraphId = surface.state().selection.head.paragraphId;
    // Skip the projected noteRef atom at offset 0; wrap "Note".
    surface.setSelection({
      anchor: { paragraphId, offset: 1 },
      head: { paragraphId, offset: 5 },
    });
    expect(surface.hyperlinks.applyHyperlink({ url: 'https://example.com/note' })).toBe(true);

    const pkg = surface.session.currentPackage();
    const notesPart = surface.session.partFor({ kind: 'notesPart', noteKind: 'footnote' })!;
    expect(
      pkg.externalTargets.some(
        (entry) =>
          entry.ownerPart === notesPart.name && entry.rawTarget === 'https://example.com/note'
      )
    ).toBe(true);
    expect(
      pkg.externalTargets.some(
        (entry) =>
          entry.ownerPart === pkg.mainDocumentPart && entry.rawTarget === 'https://example.com/note'
      )
    ).toBe(false);
    expect(JSON.stringify(notesPart.root)).toContain('"kind":"hyperlink"');
    // Place the caret inside the wrapped range so linkAtCaret does not depend on the
    // post-insert boundary the commit lands on.
    surface.setSelection({
      anchor: { paragraphId, offset: 2 },
      head: { paragraphId, offset: 2 },
    });
    expect(surface.hyperlinks.linkAtCaret()?.href).toBe('https://example.com/note');

    surface.undo();
    expect(surface.hyperlinks.linkAtCaret()).toBeNull();
    expect(
      JSON.stringify(surface.session.partFor({ kind: 'notesPart', noteKind: 'footnote' })!.root)
    ).not.toContain('"kind":"hyperlink"');
    expect(
      surface.session
        .currentPackage()
        .externalTargets.some(
          (entry) =>
            entry.ownerPart === pkg.mainDocumentPart &&
            entry.rawTarget === 'https://example.com/note'
        )
    ).toBe(false);
    surface.destroy();
  });

  test('arrow navigation across note continuations retargets caret host page', () => {
    const noteParas = Array.from(
      { length: 40 },
      (_, i) => `<w:p><w:r><w:t>Note line ${i} ${'x'.repeat(40)}</w:t></w:r></w:p>`
    ).join('');
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          `<w:p><w:r><w:t>Body</w:t></w:r>` +
          `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
          `<w:footnoteReference w:id="1"/></w:r></w:p>` +
          '<w:sectPr><w:pgSz w:w="12240" w:h="7200"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>' +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:id="1">${noteParas}</w:footnote>` +
          '</w:footnotes>'
      ),
    });
    const { surface, container } = mount(bytes);
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    pages.focus();

    const occurrences = surface
      .layout()
      .pages.flatMap((page) =>
        (page.footnotes?.notes ?? [])
          .filter((note) => note.scopeId === 'footnote:1')
          .map((note) => ({ pageIndex: page.index, continuation: !!note.continuation }))
      );
    expect(occurrences.length).toBeGreaterThan(1);
    expect(occurrences.some((entry) => entry.continuation)).toBe(true);

    const firstPage = occurrences[0]!.pageIndex;
    expect(surface.enterNote('footnote:1', undefined, firstPage)).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:1' });

    const caretPage = () => {
      const caret = container.querySelector<HTMLElement>('[data-docx-caret]');
      expect(caret).toBeTruthy();
      return Number(caret!.closest<HTMLElement>('[data-page-index]')?.dataset.pageIndex);
    };
    expect(caretPage()).toBe(firstPage);

    let crossed = false;
    for (let step = 0; step < 400; step += 1) {
      const before = surface.state().selection.head;
      surface.navigate('down');
      const after = surface.state().selection.head;
      if (after.paragraphId === before.paragraphId && after.offset === before.offset) break;
      const hostPage = caretPage();
      if (hostPage !== firstPage) {
        crossed = true;
        expect(surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:1' });
        expect(hostPage).toBeGreaterThan(firstPage);
        break;
      }
    }
    expect(crossed).toBe(true);
    surface.destroy();
  });
});
