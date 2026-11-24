// Page setup writes reach the body from any story the caret is in.
//
// Section geometry lives on the BODY story: `w:sectPr` is a body structure and a header part
// has no `w:body` at all. So the section writer pins `{ kind: 'body' }` rather than inheriting
// the open scope — and the gate that wraps the session for view/suggesting mode dropped that
// argument, handing every one of those writes back to the open story. The write was refused as
// `tree-invariant` while the DIALOG went on reading the correct section: a ruler drag previewed
// and snapped back, and Page Setup's Apply did nothing, with no error anywhere.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { STORY_KINDS } from './story-parity-contract.ts';
import { openStory, PART_OF_STORY, savedParts } from './story-parity-harness.ts';

const MARGIN_TWIPS = 1234;

describe('page setup applies from every story', () => {
  for (const story of STORY_KINDS) {
    test(`${story}: a section margin write lands in the body`, async () => {
      const open = openStory(story);
      try {
        const before = await savedParts(open);
        const result = open.editor.exec({
          type: 'setPageSetup',
          scope: 'section',
          marginRight: MARGIN_TWIPS,
        });
        expect(result.ok, `refused: ${result.ok ? '' : result.reason}`).toBe(true);

        const after = await savedParts(open);
        expect(after.get(PART_OF_STORY.body)).toContain(`w:right="${MARGIN_TWIPS}"`);
        // And it went to the BODY, not to whichever story happened to be open.
        for (const [kind, part] of Object.entries(PART_OF_STORY)) {
          if (kind === 'body') continue;
          expect(after.get(part), `${part} changed`).toBe(before.get(part));
        }
      } finally {
        open.destroy();
      }
    });
  }
});
