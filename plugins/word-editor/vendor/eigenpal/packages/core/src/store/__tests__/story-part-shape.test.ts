// "Is this part shaped to hold stories" is not "does it hold editable ones".
//
// Two callers ask the first question — the custom-node payload sweep and the export strip — and
// both DELETE what they conclude nothing names. They asked it with `storyRootsOf(part).length`,
// which counts EDITABLE stories. Once `w:separator` and `w:continuationSeparator` stopped being
// stories, a notes part holding only those counted zero and was skipped whole. That is the
// footnotes part Word writes into every document that ever held a footnote.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../package/ooxml-tree.ts';
import { isStoryPart, storyRootsOf } from '../package/story-blocks.ts';
import type { OoxmlPart } from '../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const SEPARATORS =
  '<w:footnote w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
  '<w:footnote w:id="0" w:type="continuationSeparator">' +
  '<w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';

function part(xml: string, name: string, contentType: string): OoxmlPart {
  const read = readOoxmlPart(xml, { name, contentType });
  if (!read.ok) throw new Error(`${name}: ${read.reason}`);
  return read.part;
}

const NOTES_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
const HEADER_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const MAIN_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

describe('a part is a story part by shape, not by editable content', () => {
  test('a notes part holding only separators is still a notes part', () => {
    const notes = part(
      `<w:footnotes xmlns:w="${W}">${SEPARATORS}</w:footnotes>`,
      '/word/footnotes.xml',
      NOTES_TYPE
    );
    // The premise: no EDITABLE story here, which is what the old guard measured.
    expect(storyRootsOf(notes)).toHaveLength(0);
    // And the answer the callers actually need. Getting this wrong skipped the part whole, and
    // the callers that ask delete what they conclude nothing names.
    expect(isStoryPart(notes), 'a separator-only notes part was not seen as a story part').toBe(
      true
    );
  });

  test('a notes part with a real note is one too', () => {
    const notes = part(
      `<w:footnotes xmlns:w="${W}">${SEPARATORS}` +
        '<w:footnote w:id="1"><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:footnote></w:footnotes>',
      '/word/footnotes.xml',
      NOTES_TYPE
    );
    expect(storyRootsOf(notes)).toHaveLength(1);
    expect(isStoryPart(notes)).toBe(true);
  });

  test('a header and a body are story parts', () => {
    expect(
      isStoryPart(
        part(
          `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>H</w:t></w:r></w:p></w:hdr>`,
          '/word/header1.xml',
          HEADER_TYPE
        )
      )
    ).toBe(true);
    expect(
      isStoryPart(
        part(
          `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`,
          '/word/document.xml',
          MAIN_TYPE
        )
      )
    ).toBe(true);
  });

  test('a part that holds no story at all is not one', () => {
    // `styles.xml` is a real part with real content and no story anywhere in it.
    const styles = part(
      `<w:styles xmlns:w="${W}"><w:style w:styleId="Normal"/></w:styles>`,
      '/word/styles.xml',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'
    );
    expect(isStoryPart(styles), 'styles.xml was mistaken for a story part').toBe(false);
  });
});
