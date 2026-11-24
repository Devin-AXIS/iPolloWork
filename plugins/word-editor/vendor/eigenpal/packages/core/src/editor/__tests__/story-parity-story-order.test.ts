// `everyStoryOrder` serves a selection in any story.
//
// `selectionRects` and `spansInSelection` take the ACTIVE story's paragraph order, and it is
// REQUIRED: any default is one story's order, and it is wrong for every caret outside that
// story. It used to default to the BODY's, which is what made a multi-paragraph selection in a
// header come back empty — both endpoints ranked -1 against a list they were not in, the walk
// gave up, and the size box emptied on a two-paragraph header selection.
//
// `everyStoryOrder` is what a caller with no story in hand PASSES. This asserts it is correct
// for all five: a selection cannot span two stories, so only the order WITHIN one is ever
// compared, and the shared list gets that right for each.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { everyStoryOrder, selectionRects, spansInSelection } from '@docx-editor.dev/core/layout';
import { STORY_KINDS } from './story-parity-contract.ts';
import { PROBE } from './story-parity-fixture.ts';
import { openStory, partOfNodeId, scopeOf } from './story-parity-harness.ts';

describe('everyStoryOrder serves a selection in any story', () => {
  for (const story of STORY_KINDS) {
    test(`${story}: a two-paragraph selection reads through the shared order`, () => {
      const open = openStory(story);
      try {
        const from = open.paragraphIds[PROBE.formatted]!;
        const to = open.paragraphIds[PROBE.plain]!;
        open.surface.setSelection({
          anchor: { paragraphId: from, offset: 0 },
          head: { paragraphId: to, offset: 1 },
        });
        const layout = open.surface.publishedLayout();
        const selection = open.surface.state().selection;

        // `everyStoryOrder` is what a caller with no story in hand passes. Against the body's
        // order this came back empty for every story but the body: both endpoints ranked -1
        // against a list they were not in and the walk gave up.
        const every = everyStoryOrder(layout);
        expect(spansInSelection(layout, selection, every).length, 'no spans').toBeGreaterThan(0);

        // And it agrees with the story's OWN order, which is what makes the shared list
        // correct rather than merely non-empty.
        const scoped = every.filter((id) => partOfNodeId(id) === partOfNodeId(from));
        expect(spansInSelection(layout, selection, every)).toEqual(
          spansInSelection(layout, selection, scoped)
        );

        // `selectionRects` asserts EQUALITY with the story's own order, not non-emptiness:
        // bands do not paint in furniture, so both sides are empty there and only the body
        // proves anything. `not.toThrow()` stood here and proved nothing at all — the pre-fix
        // failure was an empty return, never a throw.
        expect(selectionRects(layout, selection, every)).toEqual(
          selectionRects(layout, selection, scoped)
        );
      } finally {
        open.destroy();
      }
    });
  }
});

describe('the tree and the layout agree on what is selectable', () => {
  for (const story of STORY_KINDS) {
    test(`${story}: every paragraph the story holds is in the order`, () => {
      const open = openStory(story);
      try {
        const order = new Set(everyStoryOrder(open.surface.publishedLayout()));
        const held = open.surface.session.paragraphIdsIn(scopeOf(story));
        expect(held.length, 'the story holds no paragraphs').toBeGreaterThan(0);

        // A paragraph the tree offers but the layout never publishes ranks -1 in any order
        // derived from the layout, and a selection ordered against -1 silently collapses to
        // one paragraph. The `w:separator` and `w:continuationSeparator` notes were exactly
        // that: the story walk counted them, the paint never did.
        expect(
          held.filter((id) => !order.has(id)),
          'held but unorderable'
        ).toEqual([]);
      } finally {
        open.destroy();
      }
    });
  }
});
