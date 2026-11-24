import type { DocxEditorPopups } from '../src/editor/popup-config';
// Note scope chrome against the real engine: banner, inserts, preview, navigation,
// context menu, properties dialog, ARIA, and selector stability.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8, strFromU8, unzipSync } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorNotesChrome, useNoteScopeProbe } from '../src/editor/DocxEditorNotes.tsx';
import {
  useNotePropertiesState,
  type NotePropertiesState,
} from '../src/editor/useNoteScopeState.ts';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function footnoteDoc(noteText = 'Note text', settings?: string): Uint8Array {
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
        (settings === undefined
          ? ''
          : '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        (settings === undefined
          ? ''
          : `<Relationship Id="rIdSet" Type="${R}/settings" Target="settings.xml"/>`) +
        '</Relationships>'
    ),
    ...(settings === undefined
      ? {}
      : { 'word/settings.xml': strToU8(`<w:settings xmlns:w="${W}">${settings}</w:settings>`) }),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${footnotes}</w:footnotes>`),
  });
}

function dualNoteDoc(): Uint8Array {
  const body =
    `<w:p><w:r><w:t>Body</w:t></w:r>` +
    `<w:r><w:footnoteReference w:id="1"/></w:r>` +
    `<w:r><w:endnoteReference w:id="1"/></w:r>` +
    `<w:r><w:endnoteReference w:id="2"/></w:r></w:p>`;
  const footnotes =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>Fn</w:t></w:r></w:p></w:footnote>`;
  const endnotes =
    `<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>` +
    `<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>` +
    `<w:endnote w:id="1"><w:p><w:r><w:endnoteRef/><w:t>En one</w:t></w:r></w:p></w:endnote>` +
    `<w:endnote w:id="2"><w:p><w:r><w:endnoteRef/><w:t>En two</w:t></w:r></w:p></w:endnote>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        '<Relationship Id="rIdFn" Type="' +
        R +
        '/footnotes" Target="footnotes.xml"/>' +
        '<Relationship Id="rIdEn" Type="' +
        R +
        '/endnotes" Target="endnotes.xml"/>' +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${footnotes}</w:footnotes>`),
    'word/endnotes.xml': strToU8(`<w:endnotes xmlns:w="${W}">${endnotes}</w:endnotes>`),
  });
}

function mountChrome(
  source: Uint8Array,
  extra?: ReactNode,
  popups?: DocxEditorPopups
): { editor: () => DocxEditorInstance; view: ReturnType<typeof render>; container: HTMLElement } {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      popups={popups}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorToolbar>
        <DocxEditorToolbar.Button slot="insert.footnote" />
        <DocxEditorToolbar.Button slot="insert.endnote" />
      </DocxEditorToolbar>
      {extra}
      <DocxEditorViewport>
        <DocxEditorNotesChrome />
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const container = view.container.querySelector('.docx-pages') as HTMLElement;
  return { view, editor: () => instance!, container };
}

function SelectorProbe(): null {
  const state = useNoteScopeProbe();
  (globalThis as unknown as { __notesProbe?: unknown }).__notesProbe = state;
  return null;
}

function PropertiesProbe(): null {
  const state = useNotePropertiesState();
  (globalThis as unknown as { __notePropsProbe?: unknown }).__notePropsProbe = state;
  return null;
}

async function enterFootnote(editor: DocxEditorInstance): Promise<void> {
  await act(async () => {
    editor.setActiveScope({ kind: 'note', id: 'footnote:1' });
  });
}

afterEach(() => {
  cleanup();
  delete (globalThis as unknown as { __notesProbe?: unknown }).__notesProbe;
  delete (globalThis as unknown as { __notePropsProbe?: unknown }).__notePropsProbe;
});

describe('DocxEditor.NotesChrome', () => {
  test('note banner anchors through the shared story-label chrome hook', async () => {
    // Footnote/endnote chrome uses `useScopedChromeAnchor(..., 'story-label')` — the same
    // path as header/footer. Gutter regression coverage lives with that hook; this pins the
    // notes banner to the shared placement mode so a future fork cannot silently diverge.
    const { view, editor } = mountChrome(footnoteDoc());
    await enterFootnote(editor());
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const banner = view.getByTestId('docx-notes-banner');
    expect(banner.style.position).toBe('absolute');
    expect(banner.style.visibility).toBe('visible');
    expect(banner.style.left).toMatch(/^\d+(\.\d+)?px$/);
    expect(banner.style.width).toMatch(/^\d+(\.\d+)?px$/);
  });

  test('banner hidden in body, visible in note scope with label and scope id', async () => {
    const { view, editor } = mountChrome(footnoteDoc());
    expect(view.getByTestId('docx-notes-chrome')).toBeTruthy();
    expect(view.queryByTestId('docx-notes-banner')).toBeNull();

    await enterFootnote(editor());
    const banner = view.getByTestId('docx-notes-banner');
    expect(banner).toBeTruthy();
    expect(banner.getAttribute('data-note-scope')).toBe('footnote:1');
    expect(banner.getAttribute('aria-label')).toBe('Note editing');
    expect(banner.textContent).toContain('Footnote');
    expect(banner.textContent).toContain('1');
  });

  test('endnote scope shows endnote label', async () => {
    const { view, editor } = mountChrome(dualNoteDoc());
    await act(async () => {
      editor().setActiveScope({ kind: 'note', id: 'endnote:1' });
    });
    const banner = view.getByTestId('docx-notes-banner');
    expect(banner.getAttribute('data-note-scope')).toBe('endnote:1');
    expect(banner.textContent).toContain('Endnote');
  });

  test('endnote bar stays above its note area when selection changes', async () => {
    const { view, editor } = mountChrome(dualNoteDoc());
    await act(async () => {
      editor().setActiveScope({ kind: 'note', id: 'endnote:1' });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const banner = view.getByTestId('docx-notes-banner');
    const initialLeft = banner.style.left;
    const initialTop = banner.style.top;

    await act(async () => {
      editor().setActiveScope({ kind: 'note', id: 'endnote:2' });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(banner.getAttribute('data-note-scope')).toBe('endnote:2');
    expect(banner.style.left).toBe(initialLeft);
    expect(banner.style.top).toBe(initialTop);
  });

  test('note scope keeps insertion in the main toolbar instead of duplicating disabled icons', async () => {
    const { view, editor } = mountChrome(footnoteDoc());
    const footnoteSlot = () =>
      view.container.querySelector('[data-slot="insert.footnote"]') as HTMLButtonElement | null;
    const endnoteSlot = () =>
      view.container.querySelector('[data-slot="insert.endnote"]') as HTMLButtonElement | null;

    expect(footnoteSlot()?.disabled).toBe(false);
    expect(endnoteSlot()?.disabled).toBe(false);
    expect(editor().can({ type: 'insertNote', noteKind: 'footnote' }).ok).toBe(true);

    await enterFootnote(editor());
    expect(view.getByTestId('docx-notes-banner').querySelector('[data-slot]')).toBeNull();
    expect(footnoteSlot()?.disabled).toBe(true);
    expect(endnoteSlot()?.disabled).toBe(true);
    expect(editor().can({ type: 'insertNote', noteKind: 'footnote' }).ok).toBe(false);
    expect(editor().can({ type: 'insertNote', noteKind: 'footnote' }).reason).toContain(
      'body scope'
    );
  });

  test('toolbar insert slots dispatch atomic insertNote commands in body', async () => {
    const { view, editor } = mountChrome(footnoteDoc());
    const before = editor().snapshot().scope;
    expect(before).toEqual({ kind: 'body' });

    await act(async () => {
      fireEvent.click(
        view.container.querySelector('[data-slot="insert.endnote"]') as HTMLButtonElement
      );
    });
    expect(editor().getActiveScope().kind).toBe('note');
    expect(editor().getActiveScope()).toEqual(
      expect.objectContaining({ kind: 'note', id: expect.stringMatching(/^endnote:\d+$/) })
    );
    const refs = view.container.querySelectorAll('[data-docx-note-ref]');
    expect(refs.length).toBeGreaterThan(0);
  });

  test('close and Escape return to body scope', async () => {
    const { view, editor, container } = mountChrome(footnoteDoc());
    await enterFootnote(editor());
    expect(editor().getActiveScope().kind).toBe('note');

    await act(async () => {
      fireEvent.click(view.getByTestId('docx-notes-options'));
    });
    await act(async () => {
      fireEvent.click(view.getByTestId('docx-notes-close'));
    });
    expect(editor().getActiveScope()).toEqual({ kind: 'body' });
    expect(view.queryByTestId('docx-notes-banner')).toBeNull();

    await enterFootnote(editor());
    await act(async () => {
      fireEvent.keyDown(container, { key: 'Escape', bubbles: true });
    });
    expect(editor().getActiveScope()).toEqual({ kind: 'body' });
  });

  test('reference hover preview shows safe text; mousedown does not steal caret', async () => {
    const { view, editor, container } = mountChrome(footnoteDoc('Safe preview text'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const ref = container.querySelector('[data-docx-note-ref]') as HTMLElement;
    expect(ref).toBeTruthy();
    expect(editor().getNotePreviewText('footnote:1')).toContain('Safe preview text');

    await act(async () => {
      fireEvent.pointerOver(ref);
      await new Promise((resolve) => setTimeout(resolve, 450));
    });

    const preview = view.getByTestId('docx-notes-preview');
    expect(preview.textContent).toContain('Safe preview text');
    expect(preview.textContent).not.toContain('<');

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    let prevented = false;
    event.preventDefault = () => {
      prevented = true;
    };
    preview.dispatchEvent(event);
    expect(prevented).toBe(true);

    await act(async () => {
      fireEvent.click(ref);
    });
    expect(view.queryByTestId('docx-notes-preview')).toBeNull();
  });

  test('touch primary skips hover preview', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('coarse'),
      media: query,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;

    const { view, container } = mountChrome(footnoteDoc('Touch only'));
    const ref = container.querySelector('[data-docx-note-ref]') as HTMLElement;

    await act(async () => {
      fireEvent.pointerOver(ref);
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(view.queryByTestId('docx-notes-preview')).toBeNull();

    window.matchMedia = original;
  });

  test('click reference enters note scope; mark-back returns to body', async () => {
    const { editor, container } = mountChrome(footnoteDoc());
    const ref = container.querySelector('[data-docx-note-ref]') as HTMLElement;
    await act(async () => {
      fireEvent.click(ref);
    });
    expect(editor().getActiveScope()).toEqual({ kind: 'note', id: 'footnote:1' });

    const markBack = container.querySelector('[data-docx-note-mark-back]') as HTMLElement;
    expect(markBack).toBeTruthy();
    await act(async () => {
      fireEvent.click(markBack);
    });
    expect(editor().getActiveScope()).toEqual({ kind: 'body' });
  });

  test('context menu convert dispatches convertNote', async () => {
    const { view, editor, container } = mountChrome(dualNoteDoc());
    const noteEl = container.querySelector('[data-docx-note-scope="footnote:1"]') as HTMLElement;
    await act(async () => {
      fireEvent.contextMenu(noteEl);
    });
    await act(async () => {
      fireEvent.click(view.getByTestId('docx-notes-menu-convert'));
    });
    expect(editor().can({ type: 'convertNote', fromKind: 'footnote', noteId: 1 }).ok).toBe(true);
  });

  test('context menu convert-all dispatches convertAllNotes', async () => {
    const { view, editor, container } = mountChrome(footnoteDoc());
    const noteEl = container.querySelector('[data-docx-note-scope="footnote:1"]') as HTMLElement;
    await act(async () => {
      fireEvent.contextMenu(noteEl);
    });
    await act(async () => {
      fireEvent.click(view.getByTestId('docx-notes-menu-convert-all'));
    });
    expect(editor().can({ type: 'convertAllNotes', fromKind: 'footnote' }).ok).toBe(true);
  });

  test('context menu delete dispatches deleteNote', async () => {
    const { view, editor, container } = mountChrome(footnoteDoc());
    const noteEl = container.querySelector('[data-docx-note-scope="footnote:1"]') as HTMLElement;
    await act(async () => {
      fireEvent.contextMenu(noteEl);
    });
    await act(async () => {
      fireEvent.click(view.getByTestId('docx-notes-menu-delete'));
    });
    expect(editor().can({ type: 'deleteNote', noteKind: 'footnote', noteId: 1 }).ok).toBe(true);
  });

  test('context menu entries surface engine disabled reasons', async () => {
    const { view, editor, container } = mountChrome(footnoteDoc());
    await enterFootnote(editor());
    // The reference mark in the body opens the note menu, even while the note is edited.
    const refEl = container.querySelector('[data-docx-note-ref]') as HTMLElement;

    await act(async () => {
      fireEvent.contextMenu(refEl);
    });
    const deleteBtn = view.getByTestId('docx-notes-menu-delete') as HTMLButtonElement;
    const gate = editor().can({ type: 'deleteNote', noteKind: 'footnote', noteId: 1 });
    expect(deleteBtn.disabled).toBe(!gate.ok);
    if (!gate.ok) {
      expect(deleteBtn.title).toBe(gate.reason);
    }
  });

  test('properties dialog reads engine state and applies setNoteProperties', async () => {
    const { view, editor } = mountChrome(footnoteDoc());
    const props = editor().getNotePropertiesState();
    expect(props).toBeTruthy();
    expect(props!.footnote.resolved.numFmt).toBe('decimal');

    await enterFootnote(editor());
    await act(async () => {
      fireEvent.click(view.getByTestId('docx-notes-options'));
    });
    await act(async () => {
      fireEvent.click(view.getByTestId('docx-notes-properties'));
    });
    const dialog = view.getByTestId('docx-notes-properties-dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Footnote & Endnote Properties');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.querySelectorAll('.docx-note-properties__section')).toHaveLength(2);
    expect(dialog.querySelector('.docx-note-properties__button--primary')).toBeTruthy();
    expect(dialog.textContent).toContain('(inherited)');

    const positionSelect = view.getByTestId('docx-notes-endnote-position') as HTMLSelectElement;
    const options = Array.from(positionSelect.options).map((o) => o.value);
    expect(options).toEqual(['docEnd', 'sectEnd']);
    expect(options).not.toContain('pageBottom');

    await act(async () => {
      fireEvent.click(view.getByTestId('docx-notes-properties-apply'));
    });
    expect(
      editor().can({
        type: 'setNoteProperties',
        scope: 'document',
        footnote: { numFmt: 'decimal' },
      }).ok
    ).toBe(true);
  });

  test('properties dialog marks values inherited unless the section authors them', async () => {
    // settings.xml numbering does not apply, so it does not count as an authored value.
    const { view, editor } = mountChrome(
      footnoteDoc('Note text', '<w:footnotePr><w:numFmt w:val="chicago"/></w:footnotePr>')
    );
    await enterFootnote(editor());
    await act(async () => {
      fireEvent.click(view.getByTestId('docx-notes-options'));
    });
    await act(async () => {
      fireEvent.click(view.getByTestId('docx-notes-properties'));
    });
    const dialog = view.getByTestId('docx-notes-properties-dialog');
    expect(dialog.querySelectorAll('.docx-note-properties__badge')).toHaveLength(2);
    expect(editor().getNotePropertiesState()!.footnote.resolved.numFmt).toBe('decimal');
  });

  test('properties dialog Apply with nothing changed leaves the document as it was', async () => {
    const { view, editor } = mountChrome(footnoteDoc());
    const before = unzipSync(new Uint8Array(await editor().save()));
    await enterFootnote(editor());
    await act(async () => {
      fireEvent.click(view.getByTestId('docx-notes-options'));
    });
    await act(async () => {
      fireEvent.click(view.getByTestId('docx-notes-properties'));
    });
    await act(async () => {
      fireEvent.click(view.getByTestId('docx-notes-properties-apply'));
    });
    const after = unzipSync(new Uint8Array(await editor().save()));
    expect(strFromU8(after['word/document.xml']!)).toBe(strFromU8(before['word/document.xml']!));
    expect(after['word/settings.xml']).toBeUndefined();
  });

  test('engine refuses endnote pageBottom for setNoteProperties', () => {
    const { editor } = mountChrome(footnoteDoc());
    const refused = editor().can({
      type: 'setNoteProperties',
      scope: 'document',
      endnote: { position: 'pageBottom' },
    });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain('endnote-pageBottom');
    const exec = editor().exec({
      type: 'setNoteProperties',
      scope: 'document',
      endnote: { position: 'pageBottom' },
    });
    expect(exec.ok).toBe(false);
  });

  test('useNoteScopeProbe keeps reference when unrelated state moves', async () => {
    const { editor } = mountChrome(footnoteDoc(), <SelectorProbe />);
    await enterFootnote(editor());
    const first = (globalThis as unknown as { __notesProbe?: unknown }).__notesProbe;
    expect(first).not.toBeNull();
    await act(async () => {
      editor().setZoom(1.1);
    });
    const second = (globalThis as unknown as { __notesProbe?: unknown }).__notesProbe;
    expect(first).toBe(second);
  });

  test('useNotePropertiesState updates when documentAuthored appears', async () => {
    const { editor } = mountChrome(footnoteDoc(), <PropertiesProbe />);
    const first = (globalThis as unknown as { __notePropsProbe?: NotePropertiesState | null })
      .__notePropsProbe;
    expect(first).toBeTruthy();
    expect(first!.footnote.documentAuthored).toBeUndefined();

    await act(async () => {
      editor().exec({
        type: 'setNoteProperties',
        scope: 'document',
        footnote: { numFmt: 'upperRoman' },
      });
    });

    const second = (globalThis as unknown as { __notePropsProbe?: NotePropertiesState | null })
      .__notePropsProbe;
    expect(second).not.toBe(first);
    expect(second!.footnote.documentAuthored?.numFmt).toBe('upperRoman');
    expect(second!.footnote.resolved.numFmt).toBe('upperRoman');
  });

  test('useNotePropertiesState updates when resolved numStart changes', async () => {
    const { editor } = mountChrome(footnoteDoc(), <PropertiesProbe />);
    const first = (globalThis as unknown as { __notePropsProbe?: NotePropertiesState | null })
      .__notePropsProbe;
    expect(first).toBeTruthy();
    const firstStart = first!.footnote.resolved.numStart;

    await act(async () => {
      editor().exec({
        type: 'setNoteProperties',
        scope: 'document',
        footnote: { numStart: firstStart + 1 },
      });
    });

    const second = (globalThis as unknown as { __notePropsProbe?: NotePropertiesState | null })
      .__notePropsProbe;
    expect(second).not.toBe(first);
    expect(second!.footnote.resolved.numStart).toBe(firstStart + 1);
  });

  test('useNotePropertiesState keeps reference when unrelated state moves', async () => {
    const { editor } = mountChrome(footnoteDoc(), <PropertiesProbe />);
    const first = (globalThis as unknown as { __notePropsProbe?: NotePropertiesState | null })
      .__notePropsProbe;
    expect(first).toBeTruthy();
    await act(async () => {
      editor().setZoom(1.1);
    });
    const second = (globalThis as unknown as { __notePropsProbe?: NotePropertiesState | null })
      .__notePropsProbe;
    expect(first).toBe(second);
  });
});

for (const disabled of [false, true]) {
  test(`note popup callbacks and false control automatic rendering (${disabled})`, async () => {
    const { view, editor } = mountChrome(footnoteDoc(), undefined, {
      notesContextMenu: disabled
        ? false
        : (props) => (
            <button data-testid="custom-note-menu" onClick={props.onOpenProperties}>
              {props.scopeId}
            </button>
          ),
      noteProperties: disabled
        ? false
        : (props) => (
            <button data-testid="custom-note-properties" onClick={props.onClose}>
              Close properties
            </button>
          ),
      notePreview: false,
    });
    await enterFootnote(editor());
    const note = view.container.querySelector('[data-docx-note-scope]')!;
    await act(async () => {
      fireEvent.contextMenu(note);
    });
    expect(!!view.queryByTestId('custom-note-menu')).toBe(!disabled);
    expect(view.queryByTestId('docx-notes-menu')).toBeNull();
    await act(async () => {
      fireEvent.click(view.getByTestId('docx-notes-options'));
    });
    await act(async () => {
      fireEvent.click(view.getByTestId('docx-notes-properties'));
    });
    expect(!!view.queryByTestId('custom-note-properties')).toBe(!disabled);
    expect(view.queryByTestId('docx-notes-properties-dialog')).toBeNull();
    if (!disabled) {
      await act(async () => {
        fireEvent.click(view.getByTestId('custom-note-properties'));
      });
      expect(view.queryByTestId('custom-note-properties')).toBeNull();
    }
  });
}

test('note popup requests stay with the owning editor', async () => {
  const first = mountChrome(footnoteDoc(), undefined, {
    notesContextMenu: (props) => <div data-testid="first-note-menu">{props.scopeId}</div>,
  });
  const second = mountChrome(footnoteDoc(), undefined, {
    notesContextMenu: (props) => <div data-testid="second-note-menu">{props.scopeId}</div>,
  });
  await enterFootnote(second.editor());
  await act(async () => {
    fireEvent.contextMenu(second.view.container.querySelector('[data-docx-note-scope]')!);
  });
  expect(second.view.container.querySelector('[data-testid="second-note-menu"]')).not.toBeNull();
  expect(first.view.container.querySelector('[data-testid="first-note-menu"]')).toBeNull();
});

for (const disabled of [false, true]) {
  test(`note preview callback and false retain owning hover state (${disabled})`, async () => {
    const { view, container } = mountChrome(footnoteDoc('Custom preview text'), undefined, {
      notePreview: disabled
        ? false
        : (props) => <div data-testid="custom-note-preview">{props.text}</div>,
    });
    await act(async () => {
      fireEvent.pointerOver(container.querySelector('[data-docx-note-ref]')!);
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(!!view.queryByTestId('custom-note-preview')).toBe(!disabled);
    if (!disabled)
      expect(view.getByTestId('custom-note-preview').textContent).toContain('Custom preview text');
    expect(view.queryByTestId('docx-notes-preview')).toBeNull();
  });
}
