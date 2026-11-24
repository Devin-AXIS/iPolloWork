// Where a write LANDS, and WHAT it writes there.
//
// Two questions, because they fail differently and one hides the other.
//
// Where it lands catches the damage: a write aimed at the body while the reader is in a header
// edits content the user cannot see, and a write refused because the gate validated the wrong
// part looks like nothing happened. Asserting on the SAVED PACKAGE rather than a return value
// is deliberate, since a cross-story write reports success and only the bytes disagree.
//
// What it writes catches the subtler half. Increase Indent on a list item DEMOTES it in the
// body (`w:ilvl` 0 to 1, and a level declared in `numbering.xml`) and merely SHIFTS the
// paragraph everywhere else (a bare `w:ind`). Both land in the right part, so a part-identity
// assertion calls that parity when it is two different commands behind one button.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { STORY_KINDS, type StoryKind } from './story-parity-contract.ts';
import { PROBE, PROBE_TEXT } from './story-parity-fixture.ts';
import {
  caretIn,
  changedParts,
  openStory,
  PART_OF_STORY,
  probeParagraphMarkup,
  savedParts,
  selectAcross,
  type OpenStory,
} from './story-parity-harness.ts';

/** One editing gesture, and where the caret has to be for it to mean something. */
interface WriteProbe {
  readonly name: string;
  /** Probe paragraph the caret starts in. */
  readonly paragraphIndex: number;
  readonly run: (open: OpenStory) => void;
  /** The defect that makes this write nothing outside the body today, if there is one. */
  readonly knownBroken?: string;
  /** Legitimately writes nothing outside the body, with the reason it is body-only. */
  readonly bodyOnly?: string;
  /**
   * Compare the RESULTING MARKUP across stories, not just which part changed.
   *
   * Only for gestures that rewrite `w:pPr` and leave the paragraph's text alone: the markup is
   * located by that text, so a gesture that edits it has no stable anchor. The text-editing
   * gestures are covered by the part-identity half above, which is the question that matters
   * for them.
   */
  readonly comparesMarkup?: true;
  /** The defect that makes the resulting markup differ between stories, if it does. */
  readonly markupKnownBroken?: string;
}

const WRITES: readonly WriteProbe[] = [
  { name: 'type("X")', paragraphIndex: PROBE.formatted, run: (o) => o.surface.type('X') },
  { name: 'insertTab', paragraphIndex: PROBE.formatted, run: (o) => o.surface.insertTab() },
  {
    name: 'splitParagraph',
    paragraphIndex: PROBE.formatted,
    run: (o) => o.surface.splitParagraph(),
  },
  {
    name: 'deleteBackward',
    paragraphIndex: PROBE.formatted,
    run: (o) => o.surface.deleteBackward(),
  },
  {
    name: 'insertLineBreak',
    paragraphIndex: PROBE.formatted,
    run: (o) => o.surface.insertLineBreak(),
  },
  {
    // Over a RANGE. At a collapsed caret this arms a pending mark and writes nothing, which is
    // correct in every story and so measures nothing here.
    name: 'toggleRunProperty("b") over a range',
    paragraphIndex: PROBE.plain,
    run: (o) => {
      selectAcross(o, PROBE.plain, PROBE.plain, 4);
      o.surface.toggleRunProperty('b');
    },
  },
  {
    name: 'setParagraphProperty("jc", right)',
    paragraphIndex: PROBE.plain,
    run: (o) => o.surface.setParagraphProperty('jc', { val: 'right' }),
    comparesMarkup: true,
  },
  {
    name: 'adjustIndent("increase") on a plain paragraph',
    paragraphIndex: PROBE.plain,
    run: (o) => {
      o.surface.adjustIndent('increase');
    },
    comparesMarkup: true,
  },
  {
    // THE list-item case. In the body this demotes the item through `setListLevel`; outside it
    // `listLevelOf` reads null, so the same button appends a bare `w:ind` instead. Same part,
    // different command.
    name: 'adjustIndent("increase") on a numbered item',
    paragraphIndex: PROBE.numbered,
    run: (o) => {
      o.surface.adjustIndent('increase');
    },
    comparesMarkup: true,
  },
  {
    // The Paragraph dialog's write, which sets several properties as ONE undo step. Its own
    // suite covers the body and a header; this puts footer, footnote and endnote under the
    // same part-identity and markup assertions as every other write.
    //
    // Routed through `editor.exec` rather than a surface method, because the dialog is an
    // editor command and there is no surface twin to call.
    name: 'setParagraphFormat({ alignment, spaceAfterPt })',
    paragraphIndex: PROBE.plain,
    run: (o) => {
      o.editor.exec({
        type: 'setParagraphFormat',
        alignment: 'center',
        spaceAfterPt: 12,
      });
    },
    comparesMarkup: true,
  },
  {
    name: 'setIndent({ left: 360 })',
    paragraphIndex: PROBE.plain,
    run: (o) => {
      o.surface.setIndent({ left: 360 });
    },
    comparesMarkup: true,
  },
  {
    name: 'toggleList("bullet") on a plain paragraph',
    paragraphIndex: PROBE.plain,
    run: (o) => {
      o.surface.toggleList('bullet');
    },
    comparesMarkup: true,
  },
  {
    // Turning a list OFF, which is the direction the body-only marker read used to make
    // impossible: `listKindOf` answered null outside the body, `turningOff` was always false,
    // and the gesture re-applied the numbering already there while reporting success.
    name: 'toggleList("ordered") on a numbered item',
    paragraphIndex: PROBE.numbered,
    run: (o) => {
      o.surface.toggleList('ordered');
    },
    comparesMarkup: true,
  },
  {
    name: 'clearFormatting over a two-paragraph range',
    paragraphIndex: PROBE.formatted,
    run: (o) => {
      selectAcross(o, PROBE.formatted, PROBE.plain, 4);
      o.surface.clearFormatting();
    },
  },
  {
    name: 'insertTable(2, 2)',
    paragraphIndex: PROBE.plain,
    run: (o) => {
      o.surface.insertTable(2, 2);
    },
  },
  {
    name: 'insertSectionBreak',
    paragraphIndex: PROBE.plain,
    run: (o) => {
      o.surface.insertSectionBreak();
    },
    bodyOnly: "a section break splits the body's own w:sectPr chain",
  },
];

describe('a write lands in the story the caret is in', () => {
  for (const probe of WRITES) {
    for (const story of STORY_KINDS) {
      const outsideBody = story !== 'body';
      const expectRefused = Boolean(probe.knownBroken ?? probe.bodyOnly) && outsideBody;
      const known = Boolean(probe.knownBroken) && outsideBody;
      const label = `${probe.name} in the ${story}${known ? ' (known broken)' : ''}`;

      test(label, async () => {
        const open = openStory(story);
        try {
          caretIn(open, probe.paragraphIndex);
          const before = await savedParts(open);
          probe.run(open);
          const after = await savedParts(open);
          const changed = changedParts(before, after);
          const ownPart = PART_OF_STORY[story];

          if (expectRefused) {
            // Refused outside the body today. Assert it STAYS refused, so the entry cannot rot
            // once the defect is fixed.
            expect(
              changed,
              `${probe.name} now writes in the ${story}: drop its knownBroken`
            ).toEqual([]);
            return;
          }

          // The gesture did something...
          expect(changed, `${probe.name} changed nothing in the ${story}`).not.toEqual([]);
          // ...to this story's part...
          expect(changed).toContain(ownPart);
          // ...and to no other story's.
          const foreign = changed.filter(
            (name) => name !== ownPart && Object.values(PART_OF_STORY).includes(name)
          );
          expect(foreign, `${probe.name} in the ${story} also wrote ${foreign.join(', ')}`).toEqual(
            []
          );
        } finally {
          open.destroy();
        }
      });
    }
  }
});

describe('a write puts the same markup in every story', () => {
  for (const probe of WRITES) {
    if (!probe.comparesMarkup) continue;
    // A gesture that writes nothing outside the body has no markup there to compare.
    if (probe.knownBroken ?? probe.bodyOnly) continue;
    const broken = probe.markupKnownBroken;

    test(`${probe.name}${broken ? ' (known broken)' : ''}`, async () => {
      const text = PROBE_TEXT[probe.paragraphIndex]!;
      const markupByStory = new Map<StoryKind, string>();
      for (const story of STORY_KINDS) {
        const open = openStory(story);
        try {
          caretIn(open, probe.paragraphIndex);
          probe.run(open);
          const parts = await savedParts(open);
          markupByStory.set(story, probeParagraphMarkup(parts.get(PART_OF_STORY[story])!, text));
        } finally {
          open.destroy();
        }
      }

      const body = markupByStory.get('body')!;
      const differing = STORY_KINDS.filter(
        (story) => story !== 'body' && markupByStory.get(story) !== body
      );

      if (broken) {
        expect(
          differing.length,
          `${probe.name} now writes the same markup everywhere: drop its markupKnownBroken`
        ).toBeGreaterThan(0);
        return;
      }
      for (const story of differing) {
        expect(markupByStory.get(story), `${story} differs from the body`).toBe(body);
      }
    });
  }
});

// The gate has to stop the WRITE, not only the probe. `can` and `exec` are separate entry
// points and a host is not required to ask before it acts, so a refusal that lives in `can`
// alone leaves the damage exactly where it was.
//
// Page break is the case: only the body paginates, so `w:br w:type="page"` in `header1.xml` or
// `footnotes.xml` changes the part and changes nothing on screen. Before the gate, exec
// returned ok and the bytes moved.
describe('a page break is refused outside the body, and writes nothing there', () => {
  for (const story of STORY_KINDS) {
    if (story === 'body') continue;

    test(`exec in the ${story} refuses and leaves its part unchanged`, async () => {
      const open = openStory(story);
      try {
        caretIn(open, 0);
        const before = await savedParts(open);
        const result = open.editor.exec({ type: 'insertBreak', kind: 'page' });
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason).toContain('editable document body');
        const after = await savedParts(open);
        // No part at all, not merely "not this story's" — a refused command must not move
        // the body either.
        expect(changedParts(before, after)).toEqual([]);
      } finally {
        open.destroy();
      }
    });
  }

  test('the body still takes one', async () => {
    const open = openStory('body');
    try {
      caretIn(open, 0);
      const before = await savedParts(open);
      expect(open.editor.exec({ type: 'insertBreak', kind: 'page' }).ok).toBe(true);
      const after = await savedParts(open);
      expect(changedParts(before, after)).toEqual([PART_OF_STORY.body]);
      expect(after.get(PART_OF_STORY.body)).toContain('w:type="page"');
    } finally {
      open.destroy();
    }
  });
});
