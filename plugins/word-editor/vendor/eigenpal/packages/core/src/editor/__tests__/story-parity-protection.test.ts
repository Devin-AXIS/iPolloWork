// A protected document is protected in every story.
//
// `w:documentProtection w:edit="forms"` lets a reader fill form fields and nothing else. The
// gate that enforces it reads `settings.xml`, which lives one part up from the op — and a story
// store is built from a PART, whose synthetic one-part package holds no settings at all. So the
// lookup answered "not protected" for every story but the body, and a header, a footer and both
// note parts accepted every write the body correctly refused.
//
// The other half matters just as much: form fields inside those stories must still be fillable.
// A fix that locked furniture outright would pass a refusal test and break the feature.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync, strFromU8 } from 'fflate';
import { STORY_KINDS, type StoryKind } from './story-parity-contract.ts';
import { PROBE, storyParityDocx } from './story-parity-fixture.ts';
import { openStory, PART_OF_STORY, savedParts } from './story-parity-harness.ts';

const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const SETTINGS =
  `<w:settings xmlns:w="${W}">` +
  '<w:documentProtection w:edit="forms" w:enforcement="1"/>' +
  '</w:settings>';

/** The parity fixture, plus a `settings.xml` that enforces forms protection. */
function protectedDocx(): Uint8Array {
  const entries = unzipSync(storyParityDocx());
  entries['word/settings.xml'] = strToU8(SETTINGS);
  entries['[Content_Types].xml'] = strToU8(
    strFromU8(entries['[Content_Types].xml']!).replace(
      '</Types>',
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.settings+xml"/></Types>'
    )
  );
  entries['word/_rels/document.xml.rels'] = strToU8(
    strFromU8(entries['word/_rels/document.xml.rels']!).replace(
      '</Relationships>',
      `<Relationship Id="rId30" Type="${R}/settings" Target="settings.xml"/></Relationships>`
    )
  );
  return zipSync(entries);
}

/** Which story parts differ between two saves. */
function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  return Object.values(PART_OF_STORY).filter((part) => before.get(part) !== after.get(part));
}

describe('forms protection is enforced in every story', () => {
  for (const story of STORY_KINDS) {
    test(`${story}: an edit outside a form field is refused`, async () => {
      const open = openStory(story, protectedDocx());
      try {
        const before = await savedParts(open);
        const paragraphId = open.paragraphIds[PROBE.plain]!;
        open.surface.setSelection({
          anchor: { paragraphId, offset: 1 },
          head: { paragraphId, offset: 1 },
        });
        open.surface.type('X');
        expect(changed(before, await savedParts(open))).toEqual([]);
      } finally {
        open.destroy();
      }
    });

    test(`${story}: a form field is still fillable`, async () => {
      const open = openStory(story, protectedDocx());
      try {
        const before = await savedParts(open);
        const paragraphId = open.controlParagraphId;
        open.surface.setSelection({
          anchor: { paragraphId, offset: 1 },
          head: { paragraphId, offset: 1 },
        });
        open.surface.type('X');
        // Protection that refuses the form field too is not protection, it is read-only —
        // and a refusal test alone would call that a pass.
        expect(changed(before, await savedParts(open))).toEqual([PART_OF_STORY[story]]);
      } finally {
        open.destroy();
      }
    });
  }
});
