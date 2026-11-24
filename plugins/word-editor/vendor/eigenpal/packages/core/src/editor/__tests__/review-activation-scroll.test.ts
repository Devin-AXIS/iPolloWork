// Whether activating a review item moves the viewport, measured on the scroller.
//
// `reveal: false` documents "open it without scrolling at all", but activation moves the caret
// to the item, and the caret follow then scrolled to it anyway. A host whose own list drives
// the scroll saw the page jump on every activation.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  collectReviewItems as engineCollectReviewItems,
  findNode,
  revisionItemsOf,
} from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { EditorModule } from '../../contracts/modules.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** A long document with one insertion far below the first screen. */
const BODY = Array.from(
  { length: 200 },
  (_, index) =>
    `<w:p><w:r><w:t>line ${index}</w:t></w:r>` +
    (index === 180
      ? '<w:ins w:id="9" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">' +
        '<w:r><w:t>far change</w:t></w:r></w:ins>'
      : '') +
    '</w:p>'
).join('');

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${BODY}</w:body></w:document>`
    ),
  });
}

function reviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems: engineCollectReviewItems,
      revisionItemsOfParagraph: (part, paragraphId) => {
        const paragraph = findNode(part, paragraphId);
        if (!paragraph || paragraph.kind !== 'paragraph') return [];
        return revisionItemsOf({ ...part, root: paragraph });
      },
    },
  };
}

/** An editor in a scroll container whose geometry is stated, as happy-dom reports none. */
function mount(): { editor: DocxEditorInstance; scroller: HTMLElement; dispose(): void } {
  const scroller = document.createElement('div');
  scroller.className = 'docx-editor__scroll-container';
  const container = document.createElement('div');
  scroller.append(container);
  document.body.append(scroller);
  Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(scroller, 'scrollHeight', { value: 100_000, configurable: true });
  let scrollTop = 0;
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
    },
    configurable: true,
  });
  scroller.scrollTo = ((options: ScrollToOptions) => {
    scrollTop = options.top ?? 0;
  }) as HTMLElement['scrollTo'];
  const editor = createDocxEditor({
    container,
    document: docx(),
    author: 'Grace Hopper',
    modules: [reviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  // The pages hold focus, so any caret follow is free to scroll.
  editor.focus();
  return {
    editor,
    scroller,
    dispose() {
      editor.destroy();
      scroller.remove();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function farItem(editor: DocxEditorInstance) {
  const card = editor.getReviewItems().find((item) => item.kind === 'revision');
  if (!card || card.item.kind !== 'revision') throw new Error('expected the far insertion');
  return { key: card.key, paragraphId: card.item.ranges[0]!.start.paragraphId };
}

describe('activation and the viewport', () => {
  test('reveal: false activates an off-screen item without scrolling, now or later', async () => {
    const { editor, scroller, dispose } = mount();
    try {
      // Typing queued at an on-screen caret: activation lands it first, and that commit owes a
      // follow that a later repaint must not spend on the activated caret.
      editor.surface!.enqueueType('x');
      const { key, paragraphId } = farItem(editor);
      expect(scroller.scrollTop).toBe(0);

      expect(editor.setActiveReviewItem(key, { reveal: false }).ok).toBe(true);
      expect(editor.surface!.state().selection.head.paragraphId).toBe(paragraphId);
      expect(editor.getActivatedReviewItemKey()).toBe(key);
      expect(scroller.scrollTop).toBe(0);

      // Deferred paints and the next repaint follow nothing either.
      await settle();
      scroller.dispatchEvent(new Event('scroll'));
      await settle();
      expect(scroller.scrollTop).toBe(0);
    } finally {
      dispose();
    }
  });

  test("the default placement scrolls to the item, and 'nearest' scrolls less", () => {
    const { editor, scroller, dispose } = mount();
    try {
      const { key } = farItem(editor);
      expect(editor.setActiveReviewItem(key).ok).toBe(true);
      const centred = scroller.scrollTop;
      expect(centred).toBeGreaterThan(0);

      editor.setActiveReviewItem(null);
      const first = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId: first, offset: 0 },
        head: { paragraphId: first, offset: 0 },
      });
      scroller.scrollTop = 0;
      expect(editor.setActiveReviewItem(key, { reveal: 'nearest' }).ok).toBe(true);
      expect(scroller.scrollTop).toBeGreaterThan(0);
      expect(scroller.scrollTop).toBeLessThan(centred);
    } finally {
      dispose();
    }
  });

  // The caret sits at the item, off screen. Resolving it must not scroll there either.
  for (const action of ['accept', 'reject'] as const) {
    test(`${action}ing an item opened with reveal: false does not scroll`, async () => {
      const { editor, scroller, dispose } = mount();
      try {
        const { key } = farItem(editor);
        expect(editor.setActiveReviewItem(key, { reveal: false }).ok).toBe(true);
        const result =
          action === 'accept' ? editor.acceptReviewItem(key) : editor.rejectReviewItem(key);
        expect(result.ok).toBe(true);
        await settle();
        scroller.dispatchEvent(new Event('scroll'));
        await settle();
        expect(scroller.scrollTop).toBe(0);
      } finally {
        dispose();
      }
    });
  }
});
