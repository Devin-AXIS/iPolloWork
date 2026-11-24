// `snapshot().selection` round-trips through `exec({type:'setSelection'})`, in every story.
//
// The contract promises exactly that, and the promise became reachable for furniture the moment
// the paraId index spanned every story. It was not kept: the index widened and its two readers
// did not follow. `resolveDocAnchor` read the paragraph's text out of the BODY part, got `''`,
// and returned `ok` with a zero-length span — so the caret landed on a paragraph the open scope
// had never heard of, and every keystroke after it was dropped with no refusal at all.
//
// A silently-dropped edit is worse than a refused one, so this asserts the whole loop: address,
// re-select, and then TYPE — because only typing proves the caret and the scope agree.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { STORY_KINDS } from './story-parity-contract.ts';
import { PROBE } from './story-parity-fixture.ts';
import { caretIn, openStory, PART_OF_STORY, savedParts } from './story-parity-harness.ts';

describe('a selection round-trips through setSelection', () => {
  for (const story of STORY_KINDS) {
    test(`a ${story} selection is re-selectable and still accepts typing`, async () => {
      const open = openStory(story);
      try {
        caretIn(open, PROBE.plain);
        const selection = open.editor.snapshot().selection;
        expect(selection, `no selection reported in the ${story}`).not.toBeNull();

        // Leave the story, exactly as a reader does by clicking back into the body.
        open.surface.exitNote?.();
        open.surface.exitHeaderFooter?.();

        const applied = open.editor.exec({ type: 'setSelection', range: selection! });
        expect(applied.ok, `setSelection refused in the ${story}`).toBe(true);

        // The caret is where it was asked to go...
        expect(open.surface.state().selection.head.paragraphId).toBe(
          open.paragraphIds[PROBE.plain]
        );

        // ...and the scope agrees with it, which is the half that used to be missing. Typing is
        // the only proof: a caret in one story under another story's scope accepts the command,
        // reports nothing, and writes nothing.
        const before = await savedParts(open);
        open.surface.type('RT');
        const after = await savedParts(open);
        expect(
          after.get(PART_OF_STORY[story]),
          `typing after a round-trip wrote nothing in the ${story}`
        ).not.toBe(before.get(PART_OF_STORY[story]));
        expect(after.get(PART_OF_STORY[story])).toContain('RT');
      } finally {
        open.destroy();
      }
    });
  }

  test('a selection spanning two stories is refused, not half-applied', () => {
    const open = openStory('header');
    try {
      const headerParagraph = open.paragraphIds[PROBE.plain]!;
      const bodyParagraph = open.surface.session.paragraphIdsIn({ kind: 'body' })[0]!;
      const anchors = open.surface.session.paragraphAnchors();
      const from = anchors.paraIdByNode.get(bodyParagraph);
      const to = anchors.paraIdByNode.get(headerParagraph);
      expect(from && to).toBeTruthy();

      const applied = open.editor.exec({
        type: 'setSelection',
        range: { from: { paraId: from! }, to: { paraId: to! } },
      });
      // There is no scope in which both endpoints are addressable, and a caret split across two
      // stores is the state that swallows input. Refusing says so.
      //
      // The REASON is pinned, not just the refusal: a refusal for some unrelated cause — an
      // unresolvable paraId, a locked story — would satisfy `ok === false` while proving
      // nothing about the cross-story guard.
      expect(applied.ok).toBe(false);
      if (applied.ok) return;
      expect(applied.reason).toBe('a selection cannot span two stories');
    } finally {
      open.destroy();
    }
  });
});
