// A selection that starts in a footnote extends into the next footnote (issue #2010).
//
// All footnotes are one story in the footnotes part, and all endnotes are one story in the
// endnotes part (ECMA-376 Part 1 §17.11). Drag, Shift+click and
// Shift+arrow cross from one note to the next; copy and formatting work over the range, and
// typing, deletion, paste and cut over it are refused rather than merging the notes.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { gateCommand } from '../docx-editor-derive.ts';
import { CROSS_NOTE_EDIT_REFUSAL, followNoteOfHead, sameNoteStory } from '../surface-note-story.ts';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  SemanticPosition,
} from '@docx-editor.dev/core/layout';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NOTE_TEXTS = ['Alpha note.', 'Bravo note.', 'Charlie note.'];

function notesDoc(): Uint8Array {
  const ref = (kind: 'footnote' | 'endnote', id: number) =>
    `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:${kind}Reference w:id="${id}"/></w:r>`;
  const body =
    NOTE_TEXTS.map(
      (_, i) => `<w:p><w:r><w:t>Body ${i + 1}</w:t></w:r>${ref('footnote', i + 1)}</w:p>`
    ).join('') + `<w:p><w:r><w:t>Body end</w:t></w:r>${ref('endnote', 1)}</w:p>`;
  const special = (kind: 'footnote' | 'endnote') =>
    `<w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}>` +
    `<w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>`;
  const footnotes =
    special('footnote') +
    NOTE_TEXTS.map(
      (text, i) =>
        `<w:footnote w:id="${i + 1}"><w:p><w:r><w:footnoteRef/><w:t xml:space="preserve"> ${text}</w:t></w:r></w:p></w:footnote>`
    ).join('');
  const endnotes =
    special('endnote') +
    `<w:endnote w:id="1"><w:p><w:r><w:endnoteRef/><w:t xml:space="preserve"> Delta endnote.</w:t></w:r></w:p></w:endnote>`;
  const type = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="${type}.document.main+xml"/>` +
        `<Override PartName="/word/footnotes.xml" ContentType="${type}.footnotes+xml"/>` +
        `<Override PartName="/word/endnotes.xml" ContentType="${type}.endnotes+xml"/>` +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${footnotes}</w:footnotes>`),
    'word/endnotes.xml': strToU8(`<w:endnotes xmlns:w="${W}">${endnotes}</w:endnotes>`),
  });
}

const mounted: PaginatedSurface[] = [];
afterEach(() => {
  for (const surface of mounted.splice(0)) surface.destroy();
  document.body.replaceChildren();
});

function mount(): { surface: PaginatedSurface; container: HTMLElement; pages: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, notesDoc(), { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  mounted.push(result.surface);
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  // happy-dom has no layout: with the pages layer at the client origin and scale 1, a client
  // point is a sheet point.
  Object.defineProperty(pages, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, right: 2000, bottom: 4000, width: 2000, height: 4000 }),
  });
  pages.focus();
  return { surface: result.surface, container, pages };
}

function noteRecord(surface: PaginatedSurface, scopeId: string) {
  for (const page of surface.layout().pages) {
    for (const note of [...(page.footnotes?.notes ?? []), ...(page.endnotes?.notes ?? [])]) {
      if (note.scopeId === scopeId) return { page, note };
    }
  }
  throw new Error(`note ${scopeId} is not painted`);
}

function noteParagraph(surface: PaginatedSurface, scopeId: string): ParagraphFragmentRecord {
  const fragment = noteRecord(surface, scopeId).note.fragments.find(
    (block): block is ParagraphFragmentRecord => block.kind === 'paragraph'
  );
  if (!fragment) throw new Error(`note ${scopeId} has no paragraph`);
  return fragment;
}

/** A position in a note's text: `offset` counted from the end of its leading mark. */
function inNote(surface: PaginatedSurface, scopeId: string, offset: number): SemanticPosition {
  return { paragraphId: noteParagraph(surface, scopeId).paragraphId, offset: 1 + offset };
}

/** The sheet point of a text offset in a note's first line. */
function notePoint(surface: PaginatedSurface, scopeId: string, offset: number) {
  const { note } = noteRecord(surface, scopeId);
  const line = noteParagraph(surface, scopeId).lines[0]!;
  const span = line.spans.find((candidate) => !candidate.projected && candidate.text.length > 0)!;
  const ratio = Math.min(offset / span.text.length, 1);
  return {
    x: note.box.x + span.box.x + span.box.width * ratio,
    y: note.box.y + line.box.y + line.box.height / 2,
  };
}

function footnoteText(surface: PaginatedSurface): string {
  return surface.session.storyText({ kind: 'notesPart', noteKind: 'footnote' });
}

function selectAcrossNotes(surface: PaginatedSurface): void {
  expect(surface.enterNote('footnote:1')).toBe(true);
  surface.setSelection({
    anchor: inNote(surface, 'footnote:1', 3),
    head: inNote(surface, 'footnote:3', 4),
  });
}

const pointer = (type: string, point: { x: number; y: number }, shiftKey = false) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    pointerId: 1,
    pointerType: 'mouse',
    clientX: point.x,
    clientY: point.y,
    shiftKey,
  });

describe('note story selection (issue #2010)', () => {
  test('notes of one kind are one story; footnotes and endnotes are two', () => {
    expect(sameNoteStory('footnote:1', 'footnote:5')).toBe(true);
    expect(sameNoteStory('endnote:2', 'endnote:3')).toBe(true);
    expect(sameNoteStory('footnote:1', 'endnote:1')).toBe(false);
    expect(sameNoteStory('footnote:1', 'not-a-note')).toBe(false);
  });

  test('Shift+Down from footnote 1 extends across footnotes 2 and 3', () => {
    const { surface } = mount();
    expect(surface.enterNote('footnote:1')).toBe(true);
    const anchor = inNote(surface, 'footnote:1', 2);
    surface.setSelection({ anchor, head: anchor });
    surface.navigate('down', true);
    surface.navigate('down', true);
    const { selection } = surface.state();
    expect(selection.anchor).toEqual(anchor);
    expect(selection.head.paragraphId).toBe(noteParagraph(surface, 'footnote:3').paragraphId);
    // The open note follows the head, so its frame, label and caret host name note 3.
    expect(surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:3' });
  });

  test('a plain arrow moves the caret into the next note and the caret follows it', () => {
    const { surface, container } = mount();
    expect(surface.enterNote('footnote:1')).toBe(true);
    surface.navigate('down');
    expect(surface.state().selection.head.paragraphId).toBe(
      noteParagraph(surface, 'footnote:2').paragraphId
    );
    expect(surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:2' });
    const caret = container.querySelector<HTMLElement>('[data-docx-caret]');
    expect(caret?.parentElement?.dataset.docxNoteScope).toBe('footnote:2');
  });

  test('arrows stay in the footnote story and never reach the endnotes', () => {
    const { surface } = mount();
    expect(surface.enterNote('footnote:1')).toBe(true);
    for (let step = 0; step < 6; step += 1) surface.navigate('down', true);
    const { head } = surface.state().selection;
    expect(head.paragraphId).toBe(noteParagraph(surface, 'footnote:3').paragraphId);
    expect(surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:3' });
  });

  test('a drag from footnote 1 extends into footnote 3', () => {
    const { surface, pages } = mount();
    expect(surface.enterNote('footnote:1')).toBe(true);
    const from = notePoint(surface, 'footnote:1', 3);
    const to = notePoint(surface, 'footnote:3', 4);
    pages.dispatchEvent(pointer('pointerdown', from));
    document.dispatchEvent(pointer('pointermove', to));
    document.dispatchEvent(pointer('pointerup', to));
    const { selection } = surface.state();
    expect(selection.anchor.paragraphId).toBe(noteParagraph(surface, 'footnote:1').paragraphId);
    expect(selection.head.paragraphId).toBe(noteParagraph(surface, 'footnote:3').paragraphId);
    expect(surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:3' });
  });

  test('a drag past the last note clamps to it instead of stopping in the first note', () => {
    const { surface, pages } = mount();
    expect(surface.enterNote('footnote:1')).toBe(true);
    const from = notePoint(surface, 'footnote:1', 3);
    const last = noteRecord(surface, 'footnote:3').note.box;
    const below = { x: from.x, y: last.y + last.height + 4 };
    pages.dispatchEvent(pointer('pointerdown', from));
    document.dispatchEvent(pointer('pointermove', below));
    document.dispatchEvent(pointer('pointerup', below));
    expect(surface.state().selection.head.paragraphId).toBe(
      noteParagraph(surface, 'footnote:3').paragraphId
    );
  });

  test('Shift+click in another footnote extends the selection instead of reopening', () => {
    const { surface, pages } = mount();
    expect(surface.enterNote('footnote:1')).toBe(true);
    const anchor = inNote(surface, 'footnote:1', 2);
    surface.setSelection({ anchor, head: anchor });
    const target = notePoint(surface, 'footnote:2', 3);
    pages.dispatchEvent(pointer('pointerdown', target, true));
    document.dispatchEvent(pointer('pointerup', target, true));
    const { selection } = surface.state();
    expect(selection.anchor).toEqual(anchor);
    expect(selection.head.paragraphId).toBe(noteParagraph(surface, 'footnote:2').paragraphId);
  });

  test('typing, Backspace and paste over notes are refused and change nothing', () => {
    const { surface } = mount();
    selectAcrossNotes(surface);
    const before = footnoteText(surface);
    const selection = surface.state().selection;

    surface.deleteBackward();
    expect(surface.state().lastRejection).toBe(CROSS_NOTE_EDIT_REFUSAL);
    surface.type('x');
    surface.pasteRich('pasted', null);
    surface.deleteSelection();

    expect(footnoteText(surface)).toBe(before);
    expect(surface.state().selection).toEqual(selection);
    // Each note keeps its own mark and text: nothing merged or emptied.
    for (const [index, text] of NOTE_TEXTS.entries()) {
      expect(
        noteParagraph(surface, `footnote:${index + 1}`)
          .lines[0]!.spans.map((s) => s.text)
          .join('')
      ).toContain(text);
    }
  });

  test('bold and copy still work across notes', () => {
    const { surface } = mount();
    selectAcrossNotes(surface);
    const copied = surface.copyFlavours();
    expect(copied.reason).toBeFalsy();
    expect(copied.text).toContain('pha note.');
    expect(copied.text).toContain('Bravo note.');
    expect(copied.text).toContain('Cha');

    expect(surface.toggleRunProperty('b')).toBeNull();
    const inside = inNote(surface, 'footnote:2', 2);
    surface.setSelection({ anchor: inside, head: inside });
    expect(surface.formatting().bold).toBe(true);
  });

  test('edits inside one note are unaffected', () => {
    const { surface } = mount();
    expect(surface.enterNote('footnote:2')).toBe(true);
    surface.setSelection({
      anchor: inNote(surface, 'footnote:2', 0),
      head: inNote(surface, 'footnote:2', 6),
    });
    surface.deleteBackward();
    expect(surface.state().lastRejection).toBeNull();
    expect(footnoteText(surface)).not.toContain('Bravo');
    expect(footnoteText(surface)).toContain('note.');
  });

  test('Cut and Delete report the refusal before they run; Copy stays available', () => {
    const { surface } = mount();
    selectAcrossNotes(surface);
    expect(gateCommand({ type: 'copy' }, surface, 'edit').ok).toBe(true);
    for (const type of ['cut', 'deleteText'] as const) {
      const gate = gateCommand({ type }, surface, 'edit');
      expect(gate.ok ? null : gate.refusal.reason).toBe(CROSS_NOTE_EDIT_REFUSAL);
    }
  });

  test('every command that replaces the selection is disabled across notes; formatting is not', () => {
    const { surface } = mount();
    selectAcrossNotes(surface);
    for (const command of [
      { type: 'paste', text: 'x' },
      { type: 'insertText', text: 'x' },
      { type: 'insertBreak', kind: 'line' },
    ] as const) {
      const gate = gateCommand(command as never, surface, 'edit');
      expect(gate.ok ? null : gate.refusal.reason).toBe(CROSS_NOTE_EDIT_REFUSAL);
    }
    expect(gateCommand({ type: 'toggleMark', mark: 'bold' }, surface, 'edit').ok).toBe(true);
  });

  test('Delete at the end of a note and Backspace at its start stay in that note', () => {
    const { surface } = mount();
    expect(surface.enterNote('footnote:1')).toBe(true);
    const paragraph = noteParagraph(surface, 'footnote:1').paragraphId;
    const end = { paragraphId: paragraph, offset: 1 + ' Alpha note.'.length };
    surface.setSelection({ anchor: end, head: end });
    const before = footnoteText(surface);
    surface.deleteForward();
    expect(footnoteText(surface)).toBe(before);
    expect(surface.state().lastRejection).toBeNull();
    expect(surface.state().selection.head).toEqual(end);

    expect(surface.enterNote('footnote:2')).toBe(true);
    const start = { paragraphId: noteParagraph(surface, 'footnote:2').paragraphId, offset: 0 };
    surface.setSelection({ anchor: start, head: start });
    surface.deleteBackward();
    expect(surface.state().selection.head.paragraphId).toBe(start.paragraphId);
    expect(surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:2' });
  });

  test('a range from a footnote into an endnote is refused for edits too', () => {
    const { surface } = mount();
    expect(surface.enterNote('footnote:3')).toBe(true);
    const before = footnoteText(surface);
    surface.setSelection({
      anchor: inNote(surface, 'footnote:3', 2),
      head: inNote(surface, 'endnote:1', 3),
    });
    surface.type('x');
    expect(surface.state().lastRejection).toBe(CROSS_NOTE_EDIT_REFUSAL);
    expect(footnoteText(surface)).toBe(before);
  });

  test('a bookmark over notes is refused rather than split across them', () => {
    const { surface } = mount();
    selectAcrossNotes(surface);
    const gate = gateCommand({ type: 'insertBookmark', name: 'Across' } as never, surface, 'edit');
    expect(gate.ok ? null : gate.refusal.reason).toBe(CROSS_NOTE_EDIT_REFUSAL);
  });

  test('a selection set from a snapshot round-trips across notes', () => {
    const { surface } = mount();
    selectAcrossNotes(surface);
    const saved = surface.state().selection;
    surface.exitNote();
    expect(surface.enterNote('footnote:2')).toBe(true);
    surface.setSelection(saved);
    expect(surface.state().selection).toEqual(saved);
    expect(surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:3' });
  });

  test('a cut over notes copies nothing, because it deletes nothing', () => {
    const { surface, pages } = mount();
    selectAcrossNotes(surface);
    const before = footnoteText(surface);
    const data = new DataTransfer();
    const event = new ClipboardEvent('cut', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    pages.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(data.getData('text/plain')).toBe('');
    expect(footnoteText(surface)).toBe(before);
    expect(surface.state().lastRejection).toBe(CROSS_NOTE_EDIT_REFUSAL);
  });
});

describe('the open note follows the head onto the page it is on', () => {
  // Footnote 1 continues from page 0 onto page 1; footnote 2 is on page 1.
  const fragment = (paragraphId: string) =>
    ({ kind: 'paragraph', paragraphId, lines: [] }) as unknown as ParagraphFragmentRecord;
  const area = (notes: readonly [string, string][]) => ({
    kind: 'footnotes',
    placement: 'pageBottom',
    box: { x: 0, y: 700, width: 100, height: 40 },
    notes: notes.map(([scopeId, paragraphId]) => ({
      noteKind: 'footnote',
      noteId: Number(scopeId.split(':')[1]),
      scopeId,
      mark: scopeId.split(':')[1],
      box: { x: 0, y: 700, width: 100, height: 20 },
      fragments: [fragment(paragraphId)],
    })),
  });
  const layout = {
    revision: 1,
    pages: [
      { index: 0, footnotes: area([['footnote:1', 'p1']]) },
      {
        index: 1,
        footnotes: area([
          ['footnote:1', 'p1'],
          ['footnote:2', 'p2'],
        ]),
      },
    ],
  } as unknown as SemanticLayout;
  const caretIn = (paragraphId: string) => ({
    anchor: { paragraphId: 'p1', offset: 1 },
    head: { paragraphId, offset: 2 },
  });

  test('a pointer on the continuation page of the open note moves its page', () => {
    const moves: [string, number][] = [];
    followNoteOfHead(
      layout,
      { scopeId: 'footnote:1', pageIndex: 0 },
      caretIn('p1'),
      (...move) => moves.push(move),
      1
    );
    expect(moves).toEqual([['footnote:1', 1]]);
  });

  test('without a pointer page, the open note keeps its page', () => {
    const moves: [string, number][] = [];
    followNoteOfHead(layout, { scopeId: 'footnote:1', pageIndex: 0 }, caretIn('p1'), (...move) =>
      moves.push(move)
    );
    expect(moves).toEqual([]);
  });

  test('a head in another note opens that note on the page the pointer named', () => {
    const moves: [string, number][] = [];
    followNoteOfHead(
      layout,
      { scopeId: 'footnote:1', pageIndex: 0 },
      caretIn('p2'),
      (...move) => moves.push(move),
      1
    );
    expect(moves).toEqual([['footnote:2', 1]]);
  });
});
