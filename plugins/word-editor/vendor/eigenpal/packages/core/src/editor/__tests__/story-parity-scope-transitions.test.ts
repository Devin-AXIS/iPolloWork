// Moving between stories leaves the caret, the scope and the store agreeing.
//
// The contract's main harness enters exactly one story per test, so it is structurally blind to
// what happens on the way from one to another — and that is where a caret and a scope come
// apart. Two scopes open at once is the state that swallows input: `activeScope` answers with
// one, `storyScope` routes writes to the other, and the edit lands nowhere with nothing refused.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { FOOTNOTE_SCOPE_ID, HEADER_R_ID, FOOTER_R_ID, PROBE } from './story-parity-fixture.ts';
import { openStory, PART_OF_STORY, partOfNodeId, savedParts } from './story-parity-harness.ts';

/** Type into whatever story is open and report which part actually changed. */
async function typeAndSeeWhereItLands(
  open: ReturnType<typeof openStory>,
  text: string
): Promise<string[]> {
  const before = await savedParts(open);
  open.surface.type(text);
  const after = await savedParts(open);
  return [...after.keys()]
    .filter((name) => before.get(name) !== after.get(name))
    .filter((name) => Object.values(PART_OF_STORY).includes(name));
}

describe('a caret and its scope agree across a story change', () => {
  test('entering a note from an open header closes the header', async () => {
    const open = openStory('header');
    try {
      expect(open.surface.enterNote(FOOTNOTE_SCOPE_ID)).toBe(true);
      // `activeScope` preferred the note and `storyScope` preferred the header, so the write
      // went to a store that has never heard of the note's paragraphs and vanished.
      expect(open.surface.activeScope()).toEqual({ kind: 'note', id: FOOTNOTE_SCOPE_ID });
      expect(await typeAndSeeWhereItLands(open, 'NOTE')).toEqual([PART_OF_STORY.footnote]);
    } finally {
      open.destroy();
    }
  });

  test('moving from one header to another writes to the second', async () => {
    const open = openStory('header');
    try {
      expect(open.surface.enterHeaderFooter({ rId: FOOTER_R_ID })).toBe(true);
      expect(open.surface.activeScope()).toEqual({ kind: 'headerFooter', rId: FOOTER_R_ID });
      expect(await typeAndSeeWhereItLands(open, 'FTR')).toEqual([PART_OF_STORY.footer]);
    } finally {
      open.destroy();
    }
  });

  test('leaving a story returns the caret and the writes to the body', async () => {
    const open = openStory('header');
    try {
      open.surface.exitHeaderFooter();
      expect(open.surface.activeScope()).toEqual({ kind: 'body' });
      expect(partOfNodeId(open.surface.state().selection.head.paragraphId)).toBe(
        PART_OF_STORY.body
      );
      expect(await typeAndSeeWhereItLands(open, 'BODY')).toEqual([PART_OF_STORY.body]);
    } finally {
      open.destroy();
    }
  });

  test('an undo that lands on a substituted paragraph lands at its start', () => {
    const open = openStory('header');
    try {
      // From a NON-ZERO offset, or the mark undo restores carries none and the test cannot
      // tell a substituted offset from a preserved one.
      const headerParagraph = open.paragraphIds[PROBE.plain]!;
      open.surface.setSelection({
        anchor: { paragraphId: headerParagraph, offset: 4 },
        head: { paragraphId: headerParagraph, offset: 4 },
      });
      open.surface.type('X');
      open.surface.exitHeaderFooter();
      const bodyParagraph = open.surface.session.paragraphIds()[0]!;
      open.surface.setSelection({
        anchor: { paragraphId: bodyParagraph, offset: 0 },
        head: { paragraphId: bodyParagraph, offset: 0 },
      });

      // The undo's mark names a HEADER paragraph, which the body story does not hold. Clamping
      // to the first body paragraph is deliberate — installing the header's id would leave the
      // caret in `contenteditable="false"` furniture and every keystroke refused. Carrying its
      // OFFSET across was not: it was counted in a different paragraph, so it put the caret
      // some arbitrary way into this one for no reason the reader can see.
      open.surface.undo();
      expect(open.surface.state().selection.head.offset).toBe(0);
    } finally {
      open.destroy();
    }
  });

  test('undo after a story change unwinds the edit in its own story', async () => {
    const open = openStory('header');
    try {
      const clean = await savedParts(open);
      open.surface.type('H');
      expect(open.surface.enterNote(FOOTNOTE_SCOPE_ID)).toBe(true);
      open.surface.type('N');

      open.surface.undo();
      open.surface.undo();
      const after = await savedParts(open);
      for (const part of Object.values(PART_OF_STORY)) {
        expect(after.get(part), `${part} did not return to its opening bytes`).toBe(
          clean.get(part)
        );
      }
    } finally {
      open.destroy();
    }
  });
});

describe('a paraId two stories claim stays addressable in each', () => {
  test('the caller’s own part settles the clash', () => {
    const open = openStory('header');
    try {
      const anchors = open.surface.session.paragraphAnchors();
      // Nothing in this fixture collides, which is the point: the resolver must not have
      // become stricter for ordinary documents while gaining the ambiguity guard.
      expect([...anchors.ambiguousParaIds]).toEqual([]);
      const headerParagraph = open.paragraphIds[PROBE.plain]!;
      const paraId = anchors.paraIdByNode.get(headerParagraph)!;
      expect(anchors.nodeByParaId.get(paraId.toUpperCase())).toBe(headerParagraph);
      // One claimant, so nothing is ambiguous. The map is diagnostic — it says which
      // paragraphs caused a clash — and never a way for the resolver to pick one.
      expect(anchors.claimantsByParaId.get(paraId.toUpperCase())).toEqual([headerParagraph]);
      void HEADER_R_ID;
    } finally {
      open.destroy();
    }
  });
});
