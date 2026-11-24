// Two document-wide operations that stopped at the body.
//
// Inserting a picture mints a relationship on the story that holds it, and the helper that
// mints one fails closed when the owner has no `.rels` part. A header, a footer or a notes part
// that carries no relationship yet has no `.rels` entry at all — ordinary for a plain-text
// header, near-universal for a notes part — so Insert Picture was refused in every story but
// the body, which always has one. It refused silently: nothing was written and nothing said why.
//
// The font catalog enumerated the stories it reads and stopped one short of the note parts, so
// a family declared only in a footnote was never reported to the host that loads faces, never
// offered in the font picker, and never counted as a substitution.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { STORY_KINDS, type StoryKind } from './story-parity-contract.ts';
import { storyParityDocx } from './story-parity-fixture.ts';
import { openStory, PART_OF_STORY, savedParts } from './story-parity-harness.ts';
import { validateRasterHeader } from '../../store/package/image-resources.ts';
import type { ImageDecodePort } from '../../store/package/image-resources.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';

/** A 1×1 PNG. Small enough to inline, real enough to pass the image reader. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function pngBytes(): Uint8Array {
  const binary = atob(PNG_BASE64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Decodes the probe PNG's header without a browser. */
function testDecodePort(): ImageDecodePort {
  return Object.freeze({
    async decode(bytes: Uint8Array, mime: Parameters<ImageDecodePort['decode']>[1]) {
      const header = validateRasterHeader(bytes, mime);
      if (!header) throw new Error('invalid image');
      void resolveImageResourceLimits();
      return Object.freeze({
        pixelWidth: header.pixelWidth,
        pixelHeight: header.pixelHeight,
        dpiX: 96,
        dpiY: 96,
      });
    },
  });
}

/** The `.rels` entry name for a story part, in zip-entry spelling. */
function relsOf(part: string): string {
  const slash = part.lastIndexOf('/');
  return `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`;
}

describe('inserting a picture works in every story', () => {
  for (const story of STORY_KINDS) {
    test(`${story}: the image lands in this story and gets a relationship`, async () => {
      const open = openStory(story);
      try {
        const before = await savedParts(open);
        const part = PART_OF_STORY[story];
        // The premise: every story but the body starts with NO relationships part, which is
        // exactly the condition the write used to fail closed on.
        if (story !== 'body') {
          expect(before.has(relsOf(part)), `${story} unexpectedly starts with a .rels`).toBe(false);
        }

        const result = await open.surface.session.insertImage(open.surface.storyScope(), {
          paragraphId: open.paragraphIds[0]!,
          offset: 0,
          bytes: pngBytes(),
          mime: 'image/png',
          widthPoints: 72,
          heightPoints: 72,
          decodePort: testDecodePort(),
          expectedPackageRevision: open.surface.session.packageRevision(),
        });
        expect(result.ok, result.ok ? '' : `refused: ${String(result.reason)}`).toBe(true);

        const after = await savedParts(open);
        expect(after.get(part), 'the story part did not change').not.toBe(before.get(part));
        // And the relationship is on THIS story, not on the main document.
        expect(after.get(relsOf(part)) ?? '', 'no image relationship on the story').toContain(
          '/image'
        );
      } finally {
        open.destroy();
      }
    });
  }
});

/** A `w:rFonts` on one run of each story, so every story declares a family only it uses. */
function distinctFontPerStoryDocx(): Uint8Array {
  const entries = unzipSync(storyParityDocx());
  const stamp = (entry: string, family: string): void => {
    const xml = strFromU8(entries[entry]!);
    // `Beta` is the plain run: `Alpha` already carries an `rPr`, and a second one is invalid.
    const patched = xml.replace(
      '<w:r><w:t>Beta</w:t></w:r>',
      `<w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/></w:rPr>` +
        '<w:t>Beta</w:t></w:r>'
    );
    if (patched === xml) throw new Error(`no Beta run to stamp in ${entry}`);
    entries[entry] = strToU8(patched);
  };
  for (const story of STORY_KINDS) stamp(PART_OF_STORY[story], familyOf(story));
  return zipSync(entries);
}

function familyOf(story: StoryKind): string {
  return `Parity${story.charAt(0).toUpperCase()}${story.slice(1)}Face`;
}

describe('the font catalog covers every story', () => {
  test('a family declared only in a note is reported', () => {
    const open = openStory('body', distinctFontPerStoryDocx());
    try {
      const families = open.surface.session.documentFonts();
      for (const story of STORY_KINDS) {
        // Notes were the two the list stopped short of, and a family nobody reports is a
        // family nobody loads — so the note painted with a fallback face.
        expect(families, `${story}'s family is missing from the catalog`).toContain(
          familyOf(story)
        );
      }
    } finally {
      open.destroy();
    }
  });
});
