// Which card is OPEN, when two cards cover the same characters.
//
// Activation round-trips through the caret: `setActiveReviewItem` puts the caret at the item's
// range start and the surface classifies that position back into a card. The round trip is lossy the
// moment two cards cover one span, and OOXML writes that shape routinely — `w:ins` wrapping
// `w:del` is content one reviewer added and another struck, and the insertion and the deletion
// carry one identical range. Every click on either card came back as whichever the queue listed
// first, so one of the two was unreachable and the reader watched the wrong card light up.
//
// The second half is neighbouring ranges. Tracked edits meet end-to-start by construction, and
// a range that merely ENDS at the caret used to outrank the range that contains it whenever the
// toucher was narrower — which a one-character insertion beside a six-character one always is.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../index.ts';
import type { EditorModule } from '../../contracts/modules.ts';
import { collectReviewItems } from '../../store/index.ts';

/**
 * The engine's OWN queue behind a review contribution, which is what gates it.
 *
 * `stubReviewModule` derives nothing, and the seam tests beside it do not need it to. This one
 * does: the question here is which of several real cards a click resolves to, so the cards have
 * to be real. The derivation is the store's, not pro's — pro adds custom-node cards on top and
 * core must not depend on it even in a test.
 */
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

function mount(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: docx(body),
    author: 'Grace Hopper',
    modules: [engineReviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

/**
 * A paragraph of interleaved tracked changes, as a real reviewed contract carries them.
 *
 * `w:id=3` and `w:id=5` each wrap a deletion inside an insertion: A added the words, B struck
 * them. Both halves stay pending, so both are cards, and their ranges are identical. The tail
 * insertions meet the nested pair end-to-start.
 */
const NESTED = `<w:p>
<w:r><w:t>This</w:t></w:r>
<w:r><w:t xml:space="preserve"> is a</w:t></w:r>
<w:del w:author="A" w:date="2026-07-08T11:32:00Z" w:id="1"><w:r><w:delText>n original paragraph</w:delText></w:r></w:del>
<w:ins w:author="A" w:date="2026-07-08T11:32:00Z" w:id="2"><w:r><w:t xml:space="preserve"> </w:t></w:r></w:ins>
<w:ins w:author="B" w:date="2026-07-08T09:33:37Z" w:id="3"><w:del w:author="C" w:date="2026-08-10T14:34:17Z" w:id="4"><w:r><w:delText>nested</w:delText></w:r></w:del></w:ins>
<w:ins w:author="A" w:date="2026-07-08T11:32:00Z" w:id="5"><w:del w:author="B" w:date="2026-07-08T09:33:36Z" w:id="6"><w:r><w:delText>tracked</w:delText></w:r></w:del></w:ins>
<w:ins w:author="C" w:date="2026-08-10T14:34:17Z" w:id="7"><w:r><w:t>lorem ipsum</w:t></w:r></w:ins>
<w:ins w:author="A" w:date="2026-07-08T11:32:00Z" w:id="8"><w:r><w:t xml:space="preserve"> </w:t></w:r></w:ins>
<w:ins w:author="A" w:date="2026-07-08T11:32:00Z" w:id="9"><w:r><w:t>change</w:t></w:r></w:ins>
</w:p>`;

function activeKey(editor: DocxEditorInstance): string | null {
  return editor.getReviewItems().find((entry) => entry.isActive)?.key ?? null;
}

type Spans = {
  ranges: readonly {
    start: { paragraphId: string; offset: number };
    end: { paragraphId: string; offset: number };
  }[];
};

function firstRange(card: { item: unknown }): Spans['ranges'][number] {
  return (card.item as Spans).ranges[0]!;
}

function paragraphOf(editor: DocxEditorInstance): string {
  return firstRange(editor.getReviewItems()[0]!).start.paragraphId;
}

describe('overlapping review cards', () => {
  test('the queue holds both halves of every nested change', () => {
    const editor = mount(NESTED);
    const cards = editor.getReviewItems();
    // Two identical ranges for each nested pair: the wrapper insertion and the deletion in it.
    const spans = cards
      .filter((card) => card.kind === 'revision')
      .map((card) =>
        (
          card.item as { ranges: readonly { start: { offset: number }; end: { offset: number } }[] }
        ).ranges
          .map((range) => `${range.start.offset}-${range.end.offset}`)
          .join(',')
      );
    expect(spans.filter((span) => span === '30-36')).toHaveLength(2);
    expect(spans.filter((span) => span === '36-43')).toHaveLength(2);
    editor.destroy();
  });

  test('every card activates ITSELF, including two on one span', () => {
    const editor = mount(NESTED);
    const keys = editor
      .getReviewItems()
      .filter((card) => card.activatable)
      .map((card) => card.key);
    expect(keys.length).toBeGreaterThan(4);
    for (const key of keys) {
      expect(editor.setActiveReviewItem(key).ok).toBe(true);
      // Was: the caret reclassified to whichever card the queue listed first, so five of the
      // seven cards in this paragraph opened one of their neighbours instead of themselves.
      expect(activeKey(editor)).toBe(key);
    }
    editor.destroy();
  });

  test('activation gives the answer back to the caret once the reader moves it', () => {
    const editor = mount(NESTED);
    const cards = editor.getReviewItems().filter((card) => card.activatable);
    const last = cards[cards.length - 1]!;
    expect(editor.setActiveReviewItem(last.key).ok).toBe(true);
    expect(activeKey(editor)).toBe(last.key);

    // Clicking away from the change closes its card. A pin that outlived its own selection
    // would have held the card open over text it does not cover.
    const paragraphId = (last.item as { ranges: readonly { start: { paragraphId: string } }[] })
      .ranges[0]!.start.paragraphId;
    editor.exec({
      type: 'setSelection',
      range: { anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 0 } },
    });
    expect(activeKey(editor)).toBe(null);
    editor.destroy();
  });

  test('a caret inside a range beats a neighbour that only ends there', () => {
    const editor = mount(NESTED);
    const cards = editor.getReviewItems();
    const paragraphId = (
      cards[0]!.item as { ranges: readonly { start: { paragraphId: string } }[] }
    ).ranges[0]!.start.paragraphId;
    // Offset 30 is where the nested pair STARTS and where the replacement before it ENDS.
    editor.exec({
      type: 'setSelection',
      range: { anchor: { paragraphId, offset: 30 }, head: { paragraphId, offset: 30 } },
    });
    const open = editor.getReviewItems().find((entry) => entry.isActive);
    expect(open).toBeDefined();
    // Was: the replacement's second range is one character wide and ends at 30, so it won on
    // width and claimed every click on the six characters that start there.
    const ranges = (
      open!.item as { ranges: readonly { start: { offset: number }; end: { offset: number } }[] }
    ).ranges;
    expect(ranges[0]!.start.offset).toBe(30);
    expect(ranges[0]!.end.offset).toBe(36);
    editor.destroy();
  });

  test('a click on struck text opens the DELETION, as Word reads it', () => {
    const editor = mount(NESTED);
    const paragraphId = paragraphOf(editor);
    // Offsets 30..36 are "nested": author B added the word, author C struck it. The word is
    // struck on the page BECAUSE of C's deletion, and accepting the change under the caret
    // performs that deletion — so the deletion is the change the caret is in.
    for (const offset of [30, 33, 36 - 1]) {
      editor.exec({
        type: 'setSelection',
        range: { anchor: { paragraphId, offset }, head: { paragraphId, offset } },
      });
      const open = editor.getReviewItems().find((entry) => entry.isActive);
      // Was: the wrapping `w:ins` came first out of the tree walk and won the tie by sort
      // stability, so clicking struck text opened an "Added" card and the deletion doing the
      // striking could not be reached from the document at all.
      expect(open?.kind).toBe('revision');
      expect((open as { revisionKind?: string }).revisionKind).toBe('delete');
      expect((open as { author?: string }).author).toBe('C');
    }
    editor.destroy();
  });

  test('a plain click never revives the card the rail opened at that offset', () => {
    // The pin activation raises now holds a CARET, and a caret is exactly what a click
    // produces — so a pin retired only by value comparison came back to life whenever the
    // reader clicked the offset it was raised at. The pin outranks the caret rule, so the
    // left edge of a nested change — the most natural place to click it — reopened the
    // OUTER card instead of the inner one the position classifies to.
    const editor = mount(NESTED);
    const paragraphId = paragraphOf(editor);
    const clickAt = (offset: number): void => {
      editor.exec({
        type: 'setSelection',
        range: { anchor: { paragraphId, offset }, head: { paragraphId, offset } },
      });
    };
    const openAuthor = (): string | undefined =>
      (editor.getReviewItems().find((entry) => entry.isActive) as { author?: string } | undefined)
        ?.author;

    // The rail opens the enclosing insertion, which the caret alone would never pick.
    const insertion = editor
      .getReviewItems()
      .find((entry) => (entry as { author?: string }).author === 'B')!;
    expect(editor.setActiveReviewItem(insertion.key).ok).toBe(true);
    expect(openAuthor()).toBe('B');

    // Move away, then click back onto the very offset the rail sent the caret to.
    clickAt(33);
    expect(openAuthor()).toBe('C');
    clickAt(30);
    expect(openAuthor()).toBe('C');
    editor.destroy();
  });

  test('the enclosing insertion stays reachable behind the deletion', () => {
    const editor = mount(NESTED);
    // Innermost-first must not mean the wrapper is gone: it is still a listed card, still
    // activatable by key, and accepting or rejecting it is a separate decision by a separate
    // author.
    const wrapper = editor
      .getReviewItems()
      .find(
        (card) =>
          (card as { revisionKind?: string }).revisionKind === 'insert' &&
          (card as { author?: string }).author === 'B'
      );
    expect(wrapper).toBeDefined();
    expect(wrapper!.activatable).toBe(true);
    expect(editor.setActiveReviewItem(wrapper!.key).ok).toBe(true);
    expect(activeKey(editor)).toBe(wrapper!.key);
    editor.destroy();
  });

  test('closing both cards on one span closes them, instead of alternating forever', () => {
    const editor = mount(NESTED);
    const twins = editor
      .getReviewItems()
      .filter((card) => firstRange(card).start.offset === 30 && firstRange(card).end.offset === 36);
    expect(twins).toHaveLength(2);

    expect(editor.setActiveReviewItem(twins[0]!.key).ok).toBe(true);
    expect(activeKey(editor)).toBe(twins[0]!.key);

    // Closing a card reveals whatever else covers the caret, which is right — the twin, and
    // then the replacement whose span ends at 30. What matters is that it TERMINATES and never
    // offers the same card twice. Was: one dismissal slot, so closing the open card promoted
    // its twin, closing the twin brought the first one back, and it alternated for as long as
    // the reader kept pressing. The only escape was to move the caret off the change.
    const closed: string[] = [];
    for (let press = 0; press < 8; press += 1) {
      const open = activeKey(editor);
      if (open === null) break;
      expect(closed).not.toContain(open);
      closed.push(open);
      editor.setActiveReviewItem(null);
    }
    expect(activeKey(editor)).toBe(null);
    expect(closed).toContain(twins[0]!.key);
    expect(closed).toContain(twins[1]!.key);
    editor.destroy();
  });

  test('a closed card reopens when the reader clicks it again', () => {
    const editor = mount(NESTED);
    const card = editor.getReviewItems().find((entry) => entry.activatable)!;
    expect(editor.setActiveReviewItem(card.key).ok).toBe(true);
    editor.setActiveReviewItem(null);
    expect(activeKey(editor)).not.toBe(card.key);
    // Dismissing leaves the caret inside the range, so re-activating moves nothing. The card
    // has to reopen anyway, or it refuses however many times it is clicked.
    expect(editor.setActiveReviewItem(card.key).ok).toBe(true);
    expect(activeKey(editor)).toBe(card.key);
    editor.destroy();
  });

  test('opening a card offers no comment, because it selects nothing', () => {
    const editor = mount(NESTED);
    const card = editor.getReviewItems().find((entry) => entry.activatable)!;
    expect(editor.setActiveReviewItem(card.key).ok).toBe(true);
    // The "comment on this" affordance keys on a RANGE, and activation now leaves a collapsed
    // caret — so opening a card cannot offer to add a comment over the card it just opened.
    expect(editor.getSelectionPlacement()).toBe(null);
    editor.destroy();
  });
});
