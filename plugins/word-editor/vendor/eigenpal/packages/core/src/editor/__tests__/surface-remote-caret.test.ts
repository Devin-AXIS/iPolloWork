import { describe, expect, test } from 'bun:test';
import type { SemanticSelection } from '@docx-editor.dev/core/layout';
import { createRemoteCaret, mapSelectionAcrossText } from '../surface-remote-caret.ts';

const caret = (paragraphId: string, offset: number): SemanticSelection => ({
  anchor: { paragraphId, offset },
  head: { paragraphId, offset },
});

/** A screen whose text the test rewrites between `note` and `map`, as a layout pass would. */
function screen(initial: Record<string, string>, carried?: () => CarriedSelection | null) {
  let texts = { ...initial };
  const caretOf = createRemoteCaret({
    textOf: (id) => texts[id] ?? null,
    order: () => Object.keys(texts),
    ...(carried ? { carried } : {}),
  });
  return {
    caretOf,
    show(next: Record<string, string>) {
      texts = { ...next };
    },
  };
}

interface CarriedSelection {
  readonly from: SemanticSelection;
  readonly to: SemanticSelection;
}

describe('mapSelectionAcrossText', () => {
  test('moves a caret after an insertion and keeps one before it', () => {
    expect(mapSelectionAcrossText(caret('p', 5), 'p', 'Alpha beta', 'Big Alpha beta').head).toEqual(
      { paragraphId: 'p', offset: 9 }
    );
    expect(mapSelectionAcrossText(caret('p', 2), 'p', 'Alpha beta', 'Alpha big beta').head).toEqual(
      { paragraphId: 'p', offset: 2 }
    );
  });

  test('keeps a caret next to its character when one update changed text on both sides', () => {
    // A reconnect brings two peers' edits at once: one typed before the caret, one after it.
    // Treating the whole changed stretch as one change put the caret at its start.
    expect(
      mapSelectionAcrossText(caret('p', 5), 'p', 'Alpha beta', 'XAlpha betaY gamma').head
    ).toEqual({ paragraphId: 'p', offset: 6 });
    expect(
      mapSelectionAcrossText(caret('p', 7), 'p', 'one two three', 'onX twoY threZe').head
    ).toEqual({ paragraphId: 'p', offset: 7 });
  });

  test('keeps text a peer inserted exactly at the caret after it, also beside another change', () => {
    // Alone, an insert at the caret goes after it. With another change earlier in the
    // paragraph, the caret sits where the unchanged end starts, and it must not jump over
    // the peer's text.
    expect(mapSelectionAcrossText(caret('p', 3), 'p', 'abcXY', 'abcpeerXY').head.offset).toBe(3);
    expect(mapSelectionAcrossText(caret('p', 3), 'p', 'abcXY', 'ZabcpeerXY').head.offset).toBe(4);
  });

  test('keeps a caret in place in a long paragraph changed at both ends', () => {
    // Too large to align character by character: the text beside the caret places it.
    const before = Array.from({ length: 160 }, (_, at) => `w${at} `).join('');
    const after = `A${before}Z`;
    expect(mapSelectionAcrossText(caret('p', 301), 'p', before, after).head.offset).toBe(302);
  });

  test('collapses a caret inside deleted text to where the deletion began', () => {
    expect(mapSelectionAcrossText(caret('p', 4), 'p', 'Alpha beta', 'Alta').head).toEqual({
      paragraphId: 'p',
      offset: 2,
    });
  });
});

describe('createRemoteCaret', () => {
  test('does nothing without a remote commit', () => {
    const { caretOf } = screen({ a: 'Alpha' });
    const selection = caret('a', 3);
    expect(caretOf.map(selection)).toBe(selection);
  });

  test('one burst of remote commits maps from the text on screen before the first', () => {
    const view = screen({ a: 'Alpha' });
    view.caretOf.note(caret('a', 5), [], true);
    // A second commit in the same burst must not take a new baseline.
    view.caretOf.note(caret('a', 5), [], true);
    view.show({ a: 'XY Alpha' });
    expect(view.caretOf.map(caret('a', 5)).head).toEqual({ paragraphId: 'a', offset: 8 });
  });

  test('a selection the host set after a remote commit is not carried', () => {
    const view = screen({ a: 'Alpha' });
    view.caretOf.note(caret('a', 0), [], true);
    view.caretOf.discard();
    view.show({ a: 'XY Alpha' });
    const chosen = caret('a', 1);
    expect(view.caretOf.map(chosen)).toBe(chosen);
  });

  test('a remote edit that does not move the caret returns the same selection', () => {
    // The surface takes a new selection as a caret move, which drops the line the caret was
    // painted on: a peer typing elsewhere must not do that.
    const view = screen({ a: 'Alpha', b: 'Bravo' });
    const held = caret('a', 3);
    view.caretOf.note(held, [], true);
    view.show({ a: 'Alpha', b: 'Bravo charlie' });
    expect(view.caretOf.map(held)).toBe(held);
  });

  test('a split that arrives with other edits still carries the caret with its text', () => {
    // One burst: a peer presses Enter before the caret, and another types at the start of the
    // paragraph. The head no longer starts the old text, so the split check misses.
    const view = screen({ a: 'Alpha bravo charlie delta' });
    view.caretOf.note(caret('a', 19), [], true);
    view.show({ a: 'New Alpha bravo', b: ' charlie delta' });
    expect(view.caretOf.map(caret('a', 19)).head).toEqual({ paragraphId: 'b', offset: 8 });
  });

  test('a deletion before the caret keeps it where the deletion was, not in a neighbor', () => {
    // The text before the caret is gone; the next paragraph happens to hold its end. The text
    // after the caret is still there, so the mapping stands.
    const view = screen({ a: 'Alpha paragraph', b: 'Second paragraph' });
    view.caretOf.note(caret('a', 10), [], true);
    view.show({ a: 'Alragraph', b: 'Second paragraph' });
    expect(view.caretOf.map(caret('a', 10)).head).toEqual({ paragraphId: 'a', offset: 4 });
  });

  test('a caret the user moves before the layout is not put back by a peer edit', () => {
    const view = screen({ a: 'Alpha bravo charlie delta echo', b: 'Other' });
    view.caretOf.note(caret('a', 20), [], true);
    view.show({ a: 'Alpha bravo charlie delta echo', b: 'Other!' });
    expect(view.caretOf.map(caret('a', 4)).head).toEqual({ paragraphId: 'a', offset: 4 });
  });

  test('an edit right before the caret does not send it to a paragraph with the same text', () => {
    const view = screen({ a: 'Subtotal: 100', b: 'Total: 100' });
    view.caretOf.note(caret('b', 10), [], true);
    view.show({ a: 'Subtotal: 100', b: 'Total: 200' });
    expect(view.caretOf.map(caret('b', 10)).head.paragraphId).toBe('b');
    const same = screen({ a: 'Net 100 then Gross 100' });
    same.caretOf.note(caret('a', 22), [], true);
    same.show({ a: 'Net 100 then Gross 250' });
    expect(same.caretOf.map(caret('a', 22)).head).toEqual({ paragraphId: 'a', offset: 22 });
  });

  test('a joined paragraph carries the caret into the one before it', () => {
    const view = screen({ a: 'Alpha', b: 'Bravo' });
    view.caretOf.note(caret('b', 2), [], true);
    view.show({ a: 'AlphaBravo' });
    expect(view.caretOf.map(caret('b', 2)).head).toEqual({ paragraphId: 'a', offset: 7 });
  });

  test('a deleted paragraph moves the caret to the next one, or the end of the last', () => {
    const middle = screen({ a: 'Alpha', b: 'Bravo', c: 'Charlie' });
    middle.caretOf.note(caret('b', 2), [], true);
    middle.show({ a: 'Alpha', c: 'Charlie' });
    expect(middle.caretOf.map(caret('b', 2)).head).toEqual({ paragraphId: 'c', offset: 0 });

    const last = screen({ a: 'Alpha', b: 'Bravo' });
    last.caretOf.note(caret('b', 2), [], true);
    last.show({ a: 'Alpha' });
    expect(last.caretOf.map(caret('b', 2)).head).toEqual({ paragraphId: 'a', offset: 5 });
  });

  test('an undo puts the caret at the change, wherever the user had moved to', () => {
    const view = screen({ a: 'AlphaXYZ beta', b: 'Bravo' });
    view.caretOf.expectHistory(true);
    view.caretOf.note(caret('b', 3), ['a'], true);
    view.caretOf.expectHistory(false);
    view.show({ a: 'Alpha beta', b: 'Bravo' });
    expect(view.caretOf.map(caret('b', 3)).head).toEqual({ paragraphId: 'a', offset: 5 });
  });

  test('a peer commit after a refused undo is not taken for history', () => {
    const view = screen({ a: 'Alpha', b: 'Bravo' });
    view.caretOf.expectHistory(true);
    view.caretOf.expectHistory(false);
    view.caretOf.note(caret('b', 3), ['a'], true);
    view.show({ a: 'Alpha!', b: 'Bravo' });
    expect(view.caretOf.map(caret('b', 3)).head).toEqual({ paragraphId: 'b', offset: 3 });
  });

  test('a layout behind a local commit is no baseline, so the caret is not moved twice', () => {
    // The user typed "XY" into "Al|pha" and layout is deferred: the caret is already at 4,
    // but the screen still reads "Alpha". Mapping from that text would add the typing again.
    const view = screen({ a: 'Alpha', b: 'Bravo' });
    view.caretOf.note(caret('a', 4), ['b'], false);
    view.show({ a: 'AlXYpha', b: 'QBravo' });
    expect(view.caretOf.map(caret('a', 4)).head).toEqual({ paragraphId: 'a', offset: 4 });
  });

  test('a peer pressing Enter before the caret carries the caret into the new paragraph', () => {
    // "Alpha para|graph" splits after "Alp".
    const view = screen({ a: 'Alpha paragraph', b: 'Bravo' });
    view.caretOf.note(caret('a', 10), ['a'], true);
    view.show({ a: 'Alp', n: 'ha paragraph', b: 'Bravo' });
    expect(view.caretOf.map(caret('a', 10)).head).toEqual({ paragraphId: 'n', offset: 7 });
  });

  test('a split after the caret leaves it where it is', () => {
    const view = screen({ a: 'Alpha paragraph' });
    view.caretOf.note(caret('a', 2), ['a'], true);
    view.show({ a: 'Alpha', n: ' paragraph' });
    expect(view.caretOf.map(caret('a', 2)).head).toEqual({ paragraphId: 'a', offset: 2 });
  });

  test('a local edit before the remote layout leaves the caret where the edit put it', () => {
    // Peer inserts "XY" at 0; before layout, the user types "z" at the caret's old offset.
    const view = screen({ a: 'abcdef' });
    view.caretOf.note(caret('a', 3), ['a'], true);
    view.caretOf.noteLocal();
    view.show({ a: 'XYazbcdef' });
    expect(view.caretOf.map(caret('a', 4)).head).toEqual({ paragraphId: 'a', offset: 4 });
  });

  test('an undo over several paragraphs lands on the first one that changed', () => {
    const view = screen({ a: 'Alpha', b: 'BravoXYZ', c: 'Charlie' });
    view.caretOf.expectHistory(true);
    view.caretOf.note(caret('c', 2), ['a', 'b'], true);
    view.show({ a: 'Alpha', b: 'Bravo', c: 'Charlie' });
    expect(view.caretOf.map(caret('c', 2)).head).toEqual({ paragraphId: 'b', offset: 5 });
  });

  test('an undo right after a peer commit in the same burst still finds its change', () => {
    const view = screen({ a: 'AlphaXYZ', b: 'Bravo' });
    view.caretOf.note(caret('b', 1), ['b'], true);
    view.caretOf.expectHistory(true);
    view.caretOf.note(caret('b', 1), ['a'], true);
    view.show({ a: 'Alpha', b: 'Bravo!' });
    expect(view.caretOf.map(caret('b', 1)).head).toEqual({ paragraphId: 'a', offset: 5 });
  });
});

describe('createRemoteCaret with a selection the session carried', () => {
  test('takes the carried selection over a guess from the text', () => {
    // "Alpha p|aragraph" gains a "p" the text cannot place: the session knows it went after.
    const carried = { from: caret('a', 7), to: caret('a', 7) };
    const view = screen({ a: 'Alpha paragraph' }, () => carried);
    view.caretOf.note(caret('a', 7), [], true);
    view.show({ a: 'Alpha pparagraph' });
    expect(view.caretOf.map(caret('a', 7))).toEqual(carried.to);
  });

  test('maps by text when the session carried another selection', () => {
    const view = screen({ a: 'Alpha beta' }, () => ({ from: caret('a', 2), to: caret('a', 9) }));
    view.caretOf.note(caret('a', 5), [], true);
    view.show({ a: 'Big Alpha beta' });
    expect(view.caretOf.map(caret('a', 5)).head).toEqual({ paragraphId: 'a', offset: 9 });
  });

  test('maps by text when the carried paragraph is not on screen', () => {
    const view = screen({ a: 'Alpha beta' }, () => ({ from: caret('a', 5), to: caret('z', 1) }));
    view.caretOf.note(caret('a', 5), [], true);
    view.show({ a: 'Big Alpha beta' });
    expect(view.caretOf.map(caret('a', 5)).head).toEqual({ paragraphId: 'a', offset: 9 });
  });

  test('takes the carried selection when the screen was behind the model', () => {
    const carried = { from: caret('a', 5), to: caret('a', 9) };
    const view = screen({ a: 'Alpha beta' }, () => carried);
    view.caretOf.note(caret('a', 5), [], false);
    view.show({ a: 'Big Alpha beta' });
    expect(view.caretOf.map(caret('a', 5))).toBe(carried.to);
  });

  test('maps by text when nothing was carried', () => {
    const view = screen({ a: 'Alpha beta' }, () => null);
    view.caretOf.note(caret('a', 5), [], true);
    view.show({ a: 'Big Alpha beta' });
    expect(view.caretOf.map(caret('a', 5)).head).toEqual({ paragraphId: 'a', offset: 9 });
  });
});
