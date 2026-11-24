// Activation stays correct while the paragraph order index is carried across keystrokes.
//
// The index that classifies the caret into a review card is memoized, and a text-local commit
// re-stamps it instead of rebuilding — every keystroke rebuilt a whole-document map for an
// answer typing cannot change. These tests pin the two sides of that bargain: a text edit must
// not lose activation, and a structural edit must not be served the retained index, because a
// split mints a paragraph id the old map has never seen.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../index.ts';
import type { EditorModule } from '../../contracts/modules.ts';
import { collectReviewItems } from '../../store/index.ts';

function engineReviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems,
      revisionItemsOfParagraph: () => [],
    },
  };
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/** A plain first paragraph and a second one carrying a pending tracked insertion. */
const BODY =
  `<w:p><w:r><w:t>plain leading paragraph</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>` +
  `<w:ins w:author="A" w:date="2026-07-08T11:32:00Z" w:id="1"><w:r><w:t>tracked</w:t></w:r></w:ins>` +
  `<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>`;

function mount(): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: docx(BODY),
    author: 'Grace Hopper',
    modules: [engineReviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function activeKey(editor: DocxEditorInstance): string | null {
  return editor.getReviewItems().find((entry) => entry.isActive)?.key ?? null;
}

describe('review activation across the retained order index', () => {
  test('a text-local edit keeps every card activatable', () => {
    const editor = mount();
    const surface = editor.surface!;
    const key = editor.getReviewItems().find((entry) => entry.activatable)?.key;
    if (!key) throw new Error('the tracked insertion produced no card');

    // Activate once so the order index exists and the retained slot has something to carry.
    expect(editor.setActiveReviewItem(key).ok).toBe(true);
    expect(activeKey(editor)).toBe(key);

    // A keystroke-shaped commit: insert one character into the OTHER paragraph.
    const [firstParagraph, trackedParagraph] = surface.session.paragraphIds();
    const edited = surface.session.applyTreeOps([
      { op: 'insertText', paragraphId: firstParagraph!, offset: 3, text: 'x' },
    ]);
    expect(edited.committed).toBe(true);

    // Through the CARET, not the activation pin: a caret move clears the pin, so this read
    // classifies the position against the re-stamped order index. The pin path never reads
    // the index, so asserting through it would pass even against a broken retention.
    surface.setSelection({
      anchor: { paragraphId: trackedParagraph!, offset: 9 },
      head: { paragraphId: trackedParagraph!, offset: 9 },
    });
    expect(activeKey(editor)).toBe(key);

    expect(editor.setActiveReviewItem(key).ok).toBe(true);
    expect(activeKey(editor)).toBe(key);
    editor.destroy();
  });

  test('a split that moves the tracked run into the minted tail still classifies it', () => {
    // The sharpest probe of drop-on-structural-edit: split the TRACKED paragraph before the
    // `w:ins` run, so the tracked range lands in the paragraph the split just minted. A
    // wrongly retained index has no entry for that paragraph and the caret inside the tracked
    // text classifies to nothing.
    const editor = mount();
    const surface = editor.surface!;
    const key = editor.getReviewItems().find((entry) => entry.activatable)?.key;
    if (!key) throw new Error('the tracked insertion produced no card');
    expect(editor.setActiveReviewItem(key).ok).toBe(true);

    const trackedParagraph = surface.session.paragraphIds()[1];
    const split = surface.session.applyTreeOps([
      { op: 'splitParagraph', paragraphId: trackedParagraph!, offset: 7 },
    ]);
    expect(split.committed).toBe(true);

    const tail = surface.session.paragraphIds()[2];
    expect(tail).toBeDefined();
    // "tracked" now starts the tail; offset 2 is inside it.
    surface.setSelection({
      anchor: { paragraphId: tail!, offset: 2 },
      head: { paragraphId: tail!, offset: 2 },
    });
    const active = activeKey(editor);
    expect(active).not.toBeNull();
    expect(
      editor
        .getReviewItems()
        .filter((entry) => entry.activatable)
        .map((entry) => entry.key)
    ).toContain(active);
    editor.destroy();
  });

  test('a paragraph split rebuilds the index for the minted paragraph', () => {
    const editor = mount();
    const surface = editor.surface!;
    const key = editor.getReviewItems().find((entry) => entry.activatable)?.key;
    if (!key) throw new Error('the tracked insertion produced no card');
    expect(editor.setActiveReviewItem(key).ok).toBe(true);

    // Split the FIRST paragraph. A retained index would still classify the card's paragraph,
    // so the sharper probe is the minted tail: select into it and confirm classification
    // resolves against the new order rather than throwing the card into limbo.
    const [firstParagraph] = surface.session.paragraphIds();
    const split = surface.session.applyTreeOps([
      { op: 'splitParagraph', paragraphId: firstParagraph!, offset: 5 },
    ]);
    expect(split.committed).toBe(true);

    const tail = surface.session.paragraphIds()[1];
    expect(tail).toBeDefined();
    surface.setSelection({
      anchor: { paragraphId: tail!, offset: 0 },
      head: { paragraphId: tail!, offset: 0 },
    });
    // The caret in the minted paragraph covers no card, and the card still activates.
    expect(activeKey(editor)).toBeNull();
    expect(editor.setActiveReviewItem(key).ok).toBe(true);
    expect(activeKey(editor)).toBe(key);
    editor.destroy();
  });
});
