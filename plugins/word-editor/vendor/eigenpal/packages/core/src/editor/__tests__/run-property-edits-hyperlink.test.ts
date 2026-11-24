// `runPropertyEdits` addresses the runs INSIDE a `w:hyperlink`.
//
// This is the plan step between "the user selected this range and pressed a button" and the
// `setRunProperties` ops that carry it out. It walks the paragraph's children accumulating
// offsets, and it used to skip a `w:hyperlink` outright — which was wrong twice over:
//
//   the link's own text could not be formatted AT ALL, because no edit ever named its runs; and
//   the offset did not advance across the link either, so every run AFTER one was addressed as
//   if the link's characters did not exist.
//
// The second is the damaging one. Colouring `Visit [example] today` planned a single edit at
// 6..12 carrying the ` today` run's properties — the applier resolved those offsets against the
// real segment map, so ` today`'s formatting landed on six of the link's seven characters and
// the seventh kept the old colour. Nothing was added or lost, so no census, digest or
// fingerprint guard could see it. Only asking what the plan ADDRESSES can.
//
// The offsets asserted here are the ones `segmentsOf` publishes, because those are the ones the
// applier resolves; the two walks have to descend in exactly the same places.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { runPropertyEdits } from '../surface-formatting.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PARAGRAPH = '/word/document.xml#0.0.0';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const RED = { localName: 'color', attributes: { val: 'FF0000' } } as const;

/** The ranges a plan addresses, as `start..end` — the shape a failure can be read from. */
const ranges = (part: OoxmlPart, start: number, end: number): string[] =>
  runPropertyEdits(part, PARAGRAPH, start, end, RED).map((edit) => `${edit.start}..${edit.end}`);

/** `Visit ` + a link around `example` + ` today` — offsets 0..6, 6..13, 13..19. */
const LINKED = load(
  '<w:p>' +
    '<w:r><w:t xml:space="preserve">Visit </w:t></w:r>' +
    '<w:hyperlink r:id="rId9">' +
    '<w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>example</w:t></w:r>' +
    '</w:hyperlink>' +
    '<w:r><w:t xml:space="preserve"> today</w:t></w:r>' +
    '</w:p>'
);

describe('a range edit crossing a link addresses every run it covers', () => {
  test('the whole paragraph plans one edit per run, links included, with no gap', () => {
    // Three runs, three edits, contiguous and covering 0..19. A gap would be text the user
    // selected that no op will ever reach.
    expect(ranges(LINKED, 0, 19)).toEqual(['0..6', '6..13', '13..19']);
  });

  test('selecting only the link plans an edit over exactly the link’s text', () => {
    expect(ranges(LINKED, 6, 13)).toEqual(['6..13']);
  });

  test('the run after a link is addressed at its real offsets, not the link’s', () => {
    // The regression, stated directly: ` today` starts at 13. Skipping the link without
    // advancing put it at 6 — inside the link.
    expect(ranges(LINKED, 13, 19)).toEqual(['13..19']);
  });

  test('a selection ending inside the link stops inside the link', () => {
    expect(ranges(LINKED, 3, 9)).toEqual(['3..6', '6..9']);
  });

  test('the link’s edit carries the LINK run’s own properties, not a neighbour’s', () => {
    const linked = load(
      '<w:p>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Visit </w:t></w:r>' +
        '<w:hyperlink r:id="rId9">' +
        '<w:r><w:rPr><w:i/></w:rPr><w:t>example</w:t></w:r>' +
        '</w:hyperlink>' +
        '<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve"> today</w:t></w:r>' +
        '</w:p>'
    );
    const names = runPropertyEdits(linked, PARAGRAPH, 0, 19, RED).map((edit) =>
      edit.properties
        .map((property) => property.localName)
        .sort()
        .join('+')
    );
    // `setRunProperties` REPLACES the container, so each edit restates its OWN run's
    // properties. Handing the link's runs the following run's bag was how a colour change
    // silently italicised or underlined text it had no business touching.
    expect(names).toEqual(['b+color', 'color+i', 'color+u']);
  });

  test('two links in one paragraph both get edits, in document order', () => {
    const twoLinks = load(
      '<w:p>' +
        '<w:hyperlink w:anchor="a"><w:r><w:t>one</w:t></w:r></w:hyperlink>' +
        '<w:r><w:t xml:space="preserve"> and </w:t></w:r>' +
        '<w:hyperlink w:anchor="b"><w:r><w:t>two</w:t></w:r></w:hyperlink>' +
        '</w:p>'
    );
    expect(ranges(twoLinks, 0, 11)).toEqual(['0..3', '3..8', '8..11']);
  });

  test('a link holding several runs contributes one edit each', () => {
    const split = load(
      '<w:p>' +
        '<w:hyperlink w:anchor="a">' +
        '<w:r><w:t>ex</w:t></w:r>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>ample</w:t></w:r>' +
        '</w:hyperlink>' +
        '<w:r><w:t>!</w:t></w:r>' +
        '</w:p>'
    );
    expect(ranges(split, 0, 8)).toEqual(['0..2', '2..7', '7..8']);
  });

  test('bookmark markers around a link measure nothing and shift no offset', () => {
    // `segmentsOf` gives bookmarks zero width, so this plan must too — otherwise every
    // offset past a bookmarked heading would drift.
    const bookmarked = load(
      '<w:p>' +
        '<w:bookmarkStart w:id="1" w:name="here"/>' +
        '<w:r><w:t xml:space="preserve">Visit </w:t></w:r>' +
        '<w:hyperlink w:anchor="here"><w:r><w:t>example</w:t></w:r></w:hyperlink>' +
        '<w:bookmarkEnd w:id="1"/>' +
        '<w:r><w:t xml:space="preserve"> today</w:t></w:r>' +
        '</w:p>'
    );
    expect(ranges(bookmarked, 0, 19)).toEqual(['0..6', '6..13', '13..19']);
  });
});
