// A suggested REPLACEMENT: typing over a selection, or `Range.insertText(…, 'Replace')` in
// suggesting mode. The deletion lands first and the insertion joins it in the SAME
// transaction, and what the file says about the pair is what every other reader — Word
// first — goes by: struck words first, then what takes their place, each half under its own
// revision id (#691).
//
// Applied through `TreeDocumentStore.transact`, not `applyTreeOp` alone: the store lends its
// ops the transaction's minter, and the insertion relocates past a strike only when that
// strike is the transaction's own. Aimed at the strike's front edge (the automation lane) or
// past it (the keyboard), the same transaction must write the same markup.

import { describe, expect, test } from 'bun:test';
import type { OoxmlParagraphNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { revisionItemsOf } from '../store/review-reads.ts';
import { trackedInsertionLanding } from '../store/tree-op-tracked-adjacency.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import type { TreeDocOp } from '../store/tree-op-validate.ts';
import { ADA, apply, paragraphId, part, xml } from './tracked-edit-fixture.ts';

const WML = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Strike `[start, end)` of the only paragraph and insert `text` at `aim`, in ONE transaction. */
function replaced(
  before: OoxmlPart,
  start: number,
  end: number,
  aim: number,
  text: string,
  revision: { author: string; date: string } = ADA
): OoxmlPart {
  const id = paragraphId(before);
  return transacted(before, [
    { op: 'deleteText', paragraphId: id, start, end, revision },
    { op: 'insertText', paragraphId: id, offset: aim, text, revision },
  ]);
}

function transacted(before: OoxmlPart, ops: readonly TreeDocOp[]): OoxmlPart {
  const store = new TreeDocumentStore(before);
  const result = store.transact((tx) => {
    for (const op of ops) tx.apply(op);
  });
  if (!result.ok) throw new Error(`transaction refused: ${result.reason} ${result.detail ?? ''}`);
  return store.part;
}

/** The fixture's only paragraph, as a node. */
function paragraphNode(source: OoxmlPart): OoxmlParagraphNode {
  const body = source.root.children.find((child) => child.kind === 'body');
  if (!body || body.kind === 'textValue') throw new Error('no body');
  const first = body.children[0];
  if (!first || first.kind !== 'paragraph') throw new Error('no paragraph');
  return first;
}

/** Every revision id in the paragraph, in document order. */
const revisionIds = (out: string): string[] =>
  [...out.matchAll(/<w:(?:ins|del)[^>]*w:id="(\d+)"/g)].map((match) => match[1]!);

describe('a replacement', () => {
  test('the halves carry distinct ids, one date, and read in Word order', () => {
    const before = part('<w:p><w:r><w:t>alpha beta</w:t></w:r></w:p>');
    const out = xml(replaced(before, 0, 5, 0, 'omega'));
    // Struck text first, then what takes its place — Word's arrangement, and the order that
    // reads as a sentence. Before it, the replacement would read "omega alpha".
    expect(out).toMatch(
      /<w:del[^>]*><w:r><w:delText>alpha<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t>omega<\/w:t><\/w:r><\/w:ins>/
    );
    // TWO ids, as Word writes them: it numbers every revision element uniquely, and a reader
    // keyed on the id saw one collided revision when the halves shared one. The pair is
    // still one moment — the insert adopts the deletion's date — and the review lane pairs
    // it on adjacency, so accept and reject resolve both halves together (#691).
    const ids = revisionIds(out);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const dates = [...out.matchAll(/<w:(?:ins|del)[^>]*w:date="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(dates).size).toBe(1);
  });

  test("an OLD deletion by the same author is not absorbed into today's edit", () => {
    const before = part(
      `<w:p><w:del w:id="5" w:author="Ada Lovelace" w:date="2020-01-01T00:00:00Z">` +
        `<w:r><w:delText>old</w:delText></w:r></w:del><w:r><w:t>new</w:t></w:r></w:p>`
    );
    const after = apply(before, {
      op: 'deleteText',
      paragraphId: paragraphId(before),
      start: 3,
      end: 6,
      revision: ADA,
    });
    const out = xml(after);
    // Two decisions. Joining them would backdate today's edit into a revision from 2020 and
    // make rejecting one reject the other.
    expect(out.match(/<w:del\b/g)?.length).toBe(2);
    expect(out).toContain('w:date="2020-01-01T00:00:00Z"');
    expect(out).toContain(`w:date="${ADA.date}"`);
  });

  test('a mid-paragraph replacement aimed at the front of the strike lands after it', () => {
    // The range starts where a run ENDS. That run used to take the words at its end
    // boundary, so `w:ins` came out in front of `w:del` — the reverse of Word's order, and
    // read back as an Inserted card and a Deleted card instead of one Replaced.
    const before = part(
      '<w:p><w:r><w:t xml:space="preserve">The Receiving Party shall</w:t></w:r></w:p>'
    );
    const out = xml(replaced(before, 4, 19, 4, 'Recipient'));
    expect(out).toMatch(
      /<w:t xml:space="preserve">The <\/w:t><\/w:r><w:del[^>]*><w:r><w:delText>Receiving Party<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t>Recipient<\/w:t><\/w:r><\/w:ins><w:r><w:t xml:space="preserve"> shall<\/w:t>/
    );
    expect(new Set(revisionIds(out)).size).toBe(2);
  });

  test('aimed at the front or at the end of the strike, the replacement lands in one place', () => {
    const before = part(
      '<w:p><w:r><w:t xml:space="preserve">The Receiving Party shall</w:t></w:r></w:p>'
    );
    expect(xml(replaced(before, 4, 19, 4, 'Recipient'))).toBe(
      xml(replaced(before, 4, 19, 19, 'Recipient'))
    );
  });

  test('typing after Backspace keeps the typed text in FRONT of the struck character', () => {
    // Two transactions, not one: the strike a keystroke ago is adjacent too, but it is not
    // this edit's replacement. Word keeps the caret before the struck character there, and
    // the typed text goes where the caret is.
    const before = part('<w:p><w:r><w:t>abc</w:t></w:r></w:p>');
    const id = paragraphId(before);
    const struck = transacted(before, [
      { op: 'deleteText', paragraphId: id, start: 2, end: 3, revision: ADA },
    ]);
    const typed = transacted(struck, [
      { op: 'insertText', paragraphId: id, offset: 2, text: 'x', revision: ADA },
    ]);
    expect(xml(typed)).toMatch(
      /<w:ins[^>]*><w:r><w:t>x<\/w:t><\/w:r><\/w:ins><w:del[^>]*><w:r><w:delText>c<\/w:delText>/
    );
  });

  test('a strike that JOINS one from a moment ago still takes the replacement after it', () => {
    // The second strike mints no id — it joins the first, and the two merge into one `w:del`.
    // It is still this transaction's strike, and the words replacing it go after the merged
    // wrapper, which is also where the keyboard's landing rule puts them.
    const before = part('<w:p><w:r><w:t>abcdef</w:t></w:r></w:p>');
    const id = paragraphId(before);
    const earlier = transacted(before, [
      { op: 'deleteText', paragraphId: id, start: 3, end: 5, revision: ADA },
    ]);
    const out = xml(
      transacted(earlier, [
        { op: 'deleteText', paragraphId: id, start: 2, end: 3, revision: ADA },
        { op: 'insertText', paragraphId: id, offset: 2, text: 'X', revision: ADA },
      ])
    );
    expect(out).toMatch(
      /<w:del[^>]*><w:r><w:delText>cde<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t>X<\/w:t>/
    );
  });

  test('typing after Backspace goes in FRONT wherever the strike sits in the paragraph', () => {
    // The same gesture must read the same way at the paragraph's head as in the middle of it.
    // The boundary rule answered this question separately from the relocation, so a strike the
    // typed text happened to start on took the words after it and the two disagreed.
    const before = part('<w:p><w:r><w:t>abcdef</w:t></w:r></w:p>');
    const id = paragraphId(before);
    const atHead = transacted(
      transacted(before, [{ op: 'deleteText', paragraphId: id, start: 0, end: 2, revision: ADA }]),
      [{ op: 'insertText', paragraphId: id, offset: 0, text: 'X', revision: ADA }]
    );
    expect(xml(atHead)).toMatch(
      /<w:ins[^>]*><w:r><w:t>X<\/w:t><\/w:r><\/w:ins><w:del[^>]*><w:r><w:delText>ab<\/w:delText>/
    );
  });

  test('replacement formatting uses full revision identity despite imported ID collisions', () => {
    const before = part(
      `<w:p><w:del w:id="0" w:author="Grace Hopper" w:date="${ADA.date}">` +
        '<w:r><w:rPr><w:b/></w:rPr><w:delText>ab</w:delText></w:r></w:del><w:r><w:t>cd</w:t></w:r>' +
        `<w:del w:id="0" w:author="Ada Lovelace" w:date="${ADA.date}">` +
        '<w:r><w:delText>ef</w:delText></w:r></w:del><w:r><w:t>gh</w:t></w:r></w:p>'
    );
    const out = xml(replaced(before, 6, 8, 8, 'X'));
    expect(out).toMatch(/<w:ins[^>]*><w:r><w:t>X<\/w:t><\/w:r><\/w:ins>/);
  });

  test('replacement formatting uses the adjacent piece when disconnected revisions share identity', () => {
    const before = part(
      `<w:p><w:del w:id="0" w:author="Ada Lovelace" w:date="${ADA.date}">` +
        '<w:r><w:rPr><w:b/></w:rPr><w:delText>ab</w:delText></w:r></w:del><w:r><w:t>cd</w:t></w:r>' +
        `<w:del w:id="0" w:author="Ada Lovelace" w:date="${ADA.date}">` +
        '<w:r><w:delText>ef</w:delText></w:r></w:del><w:r><w:t>gh</w:t></w:r></w:p>'
    );
    const out = xml(replaced(before, 6, 8, 8, 'X'));
    expect(out).toMatch(/<w:ins[^>]*><w:r><w:t>X<\/w:t><\/w:r><\/w:ins>/);
  });

  test("another author's strike under the SAME id does not carry the replacement past it", () => {
    // `@w:id` comes out of the file and nothing makes it unique, so a foreign `w:del` can
    // reuse one. Reading the strike's end by id alone dropped the typed words past text this
    // edit never touched; the full `CT_TrackChange` identity decides membership.
    const before = part(
      `<w:p><w:del w:id="0" w:author="Ada Lovelace" w:date="${ADA.date}">` +
        '<w:r><w:delText>ab</w:delText></w:r></w:del><w:r><w:t>cd</w:t></w:r>' +
        `<w:del w:id="0" w:author="Grace Hopper" w:date="${ADA.date}">` +
        '<w:r><w:delText>ef</w:delText></w:r></w:del><w:r><w:t>gh</w:t></w:r></w:p>'
    );
    const id = paragraphId(before);
    const out = xml(
      transacted(before, [
        { op: 'deleteText', paragraphId: id, start: 2, end: 4, revision: ADA },
        { op: 'insertText', paragraphId: id, offset: 2, text: 'X', revision: ADA },
      ])
    );
    // After Ada's own merged strike, and BEFORE Grace's.
    expect(out).toMatch(
      /<w:delText>abcd<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t>X<\/w:t><\/w:r><\/w:ins><w:del[^>]*w:author="Grace Hopper"/
    );
  });

  test('retyping your OWN pending insertion beside a strike keeps it where it was', () => {
    // The range covers only this author's insertion, so it retracts and no `w:del` is
    // written. Counting the joined id as a strike anyway sent the retyped word to the far
    // side of the struck words beside it.
    const before = part(
      `<w:p><w:ins w:id="1" w:author="Ada Lovelace" w:date="${ADA.date}">` +
        '<w:r><w:t>abc</w:t></w:r></w:ins>' +
        `<w:del w:id="0" w:author="Ada Lovelace" w:date="${ADA.date}">` +
        '<w:r><w:delText>DEF</w:delText></w:r></w:del><w:r><w:t>ghi</w:t></w:r></w:p>'
    );
    const id = paragraphId(before);
    const out = xml(
      transacted(before, [
        { op: 'deleteText', paragraphId: id, start: 0, end: 3, revision: ADA },
        { op: 'insertText', paragraphId: id, offset: 0, text: 'X', revision: ADA },
      ])
    );
    expect(out).toMatch(
      /<w:ins[^>]*><w:r><w:t>X<\/w:t><\/w:r><\/w:ins><w:del[^>]*><w:r><w:delText>DEF<\/w:delText>/
    );
  });

  test('driven straight through the appliers, a replacement still reads in Word order', () => {
    // No transaction, so no bookkeeping to consult: an adjacent strike by this author IS the
    // one being replaced, which is what a caller pairing `deleteText` with `insertText` at one
    // offset means. `applyTreeOp` is public API, and it must not write the reversed order.
    const before = part(
      '<w:p><w:r><w:t xml:space="preserve">The Receiving Party shall</w:t></w:r></w:p>'
    );
    const id = paragraphId(before);
    const struck = apply(before, {
      op: 'deleteText',
      paragraphId: id,
      start: 4,
      end: 19,
      revision: ADA,
    });
    const out = xml(
      apply(struck, {
        op: 'insertText',
        paragraphId: id,
        offset: 4,
        text: 'Recipient',
        revision: ADA,
      })
    );
    expect(out).toMatch(
      /<w:delText>Receiving Party<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t>Recipient<\/w:t>/
    );
  });

  test('a far piece under the same id, with live words between, is a different decision', () => {
    // A Word redline reuses one `@w:id` across an editing burst, so two `w:del` under one
    // identity can have untouched words standing between them. Reading the strike's end as
    // the paragraph-wide maximum carried the replacement past those words: the accepted text
    // came out "AAFFXEE" instead of "AAXFFEE".
    const before = part(
      '<w:p><w:r><w:t>AA</w:t></w:r>' +
        `<w:del w:id="3" w:author="Ada Lovelace" w:date="${ADA.date}">` +
        '<w:r><w:delText>BB</w:delText></w:r></w:del>' +
        '<w:r><w:t>CCFF</w:t></w:r>' +
        `<w:del w:id="3" w:author="Ada Lovelace" w:date="${ADA.date}">` +
        '<w:r><w:delText>DD</w:delText></w:r></w:del>' +
        '<w:r><w:t>EE</w:t></w:r></w:p>'
    );
    const id = paragraphId(before);
    const out = transacted(before, [
      { op: 'deleteText', paragraphId: id, start: 4, end: 6, revision: ADA },
      { op: 'insertText', paragraphId: id, offset: 6, text: 'X', revision: ADA },
    ]);
    // The words go after the strike they replace, and BEFORE the untouched "FF".
    expect(xml(out)).toMatch(
      /<w:delText>BBCC<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t>X<\/w:t><\/w:r><\/w:ins><w:r><w:t>FF<\/w:t>/
    );
    const accepted = xml(apply(out, { op: 'acceptAllRevisions' }));
    expect([...accepted.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')).toBe(
      'AAXFFEE'
    );
  });

  test('an unrelated op between the halves does not invert them', () => {
    // The transaction's ID COUNTER goes stale across an op that can import ids, but the
    // record of what this transaction wrote cannot. Dropping both together made the
    // insertion stop recognising its own strike, and it came out in front of it.
    const before = part(
      '<w:p><w:r><w:t>alpha</w:t></w:r></w:p><w:p><w:r><w:t>x</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>y</w:t></w:r></w:p>'
    );
    const bodyNode = before.root.children.find((child) => child.kind === 'body');
    if (!bodyNode || bodyNode.kind === 'textValue') throw new Error('no body');
    const [first, second, third] = bodyNode.children;
    const out = xml(
      transacted(before, [
        { op: 'deleteText', paragraphId: first!.id, start: 0, end: 5, revision: ADA },
        { op: 'joinParagraphs', firstId: second!.id, secondId: third!.id },
        { op: 'insertText', paragraphId: first!.id, offset: 0, text: 'omega', revision: ADA },
      ])
    );
    expect(out).toMatch(
      /<w:del[^>]*><w:r><w:delText>alpha<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t>omega<\/w:t>/
    );
    // And DISTINCT ids. The counter is dropped across that middle op, and a walk bound to the
    // part it first saw re-walked that stale snapshot — handing the insertion the id the
    // strike had already taken, which is the collision this whole change removes.
    const ids = revisionIds(out);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  test('with a same-author strike at EACH edge, the words join the one the strike joins', () => {
    // `applyDeleteTracked` asks about both edges and joins the FIRST deletion in document
    // order, so the strike touching the range's start wins. A landing rule that asked about
    // the end alone picked the other one and wrote the words past a deletion this edit never
    // joined — folding it into the replacement's card, and its Accept with it.
    const before = part(
      `<w:p><w:del w:id="1" w:author="Ada Lovelace" w:date="${ADA.date}">` +
        '<w:r><w:delText>a</w:delText></w:r></w:del><w:r><w:t>bc</w:t></w:r>' +
        `<w:del w:id="2" w:author="Ada Lovelace" w:date="${ADA.date}">` +
        '<w:r><w:delText>de</w:delText></w:r></w:del></w:p>'
    );
    const id = paragraphId(before);
    // The landing the surface predicts, from the range the strike will ask about.
    const paragraph = paragraphNode(before);
    expect(
      trackedInsertionLanding(paragraph, { start: 1, end: 3 }, 3, ADA.author, ADA.date)
    ).toMatchObject({ landing: 3 });

    const out = transacted(before, [
      { op: 'deleteText', paragraphId: id, start: 1, end: 3, revision: ADA },
      { op: 'insertText', paragraphId: id, offset: 3, text: 'X', revision: ADA },
    ]);
    expect(xml(out)).toMatch(
      /<w:delText>abc<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t>X<\/w:t><\/w:r><\/w:ins><w:del[^>]*><w:r><w:delText>de<\/w:delText>/
    );
    // The addition and both deletions remain separate review decisions.
    const items = revisionItemsOf(out);
    expect(items.map((item) => item.revisionKind)).toEqual(['delete', 'insert', 'delete']);
    expect(items.map((item) => item.text)).toEqual(['abc', 'X', 'de']);
  });

  test('a strike split by a bookmark edge keeps the replacement after its LAST piece', () => {
    // Zero-width furniture between two pieces of one deletion is looked past: the words go
    // after the whole strike, not between its halves.
    const before = part(
      '<w:p><w:r><w:t>ab</w:t></w:r><w:bookmarkStart w:id="7" w:name="mark"/>' +
        '<w:r><w:t>cd</w:t></w:r><w:bookmarkEnd w:id="7"/><w:r><w:t>ef</w:t></w:r></w:p>'
    );
    const out = xml(replaced(before, 0, 4, 0, 'X'));
    // Both pieces first, then the insertion, then the untouched tail.
    expect(out.indexOf('<w:ins')).toBeGreaterThan(out.lastIndexOf('</w:del>'));
    expect(out.indexOf('<w:ins')).toBeLessThan(out.indexOf('<w:t>ef</w:t>'));
  });

  test("a strike interrupted by another author's deletion lands after its LAST piece", () => {
    // Grace already struck "cd"; Ada's range covers "b", the struck "cd" and "e". Her strike
    // is two pieces around Grace's, and the replacement follows the second whichever edge
    // the caller aimed at.
    const before = part(
      '<w:p><w:r><w:t>ab</w:t></w:r>' +
        '<w:del w:id="9" w:author="Grace Hopper" w:date="2020-01-01T00:00:00Z">' +
        '<w:r><w:delText>cd</w:delText></w:r></w:del><w:r><w:t>ef</w:t></w:r></w:p>'
    );
    const atFront = replaced(before, 1, 5, 1, 'Q');
    expect(xml(atFront)).toBe(xml(replaced(before, 1, 5, 5, 'Q')));
    expect(xml(atFront)).toMatch(
      /<w:delText>e<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t>Q<\/w:t><\/w:r><\/w:ins><w:r><w:t>f<\/w:t>/
    );
    // The intervening author's deletion separates the two source decisions.
    const items = revisionItemsOf(atFront);
    expect(items.map((item) => item.revisionKind).sort()).toEqual([
      'delete',
      'delete',
      'delete',
      'insert',
    ]);
    expect(
      items
        .filter((item) => item.author === 'Ada Lovelace' && item.revisionKind === 'delete')
        .map((item) => item.text)
    ).toEqual(['b', 'e']);
    expect(items.find((item) => item.revisionKind === 'insert')).toMatchObject({ text: 'Q' });
  });

  test('a replacement inside a formatted run keeps the formatting from either edge', () => {
    const before = part(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">The Receiving Party shall</w:t></w:r></w:p>'
    );
    const atFront = xml(replaced(before, 4, 19, 4, 'Recipient'));
    expect(atFront).toBe(xml(replaced(before, 4, 19, 19, 'Recipient')));
    expect(atFront).toMatch(
      /<w:ins[^>]*><w:r><w:rPr><w:b\/><\/w:rPr><w:t>Recipient<\/w:t><\/w:r><\/w:ins>/
    );
  });

  test('a strike spilling outside a link, aimed at its front, lands after the link', () => {
    // The replacement stands in for the whole struck range and is not linked, whichever
    // edge the caller aimed at.
    const before = part(
      '<w:p><w:r><w:t xml:space="preserve">word </w:t></w:r>' +
        '<w:hyperlink w:anchor="x"><w:r><w:t>link</w:t></w:r></w:hyperlink>' +
        '<w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>'
    );
    const atFront = xml(replaced(before, 0, 9, 0, 'New'));
    expect(atFront).toMatch(/<\/w:hyperlink><w:ins[^>]*><w:r><w:t[^>]*>New<\/w:t>/);
    expect(atFront).toBe(xml(replaced(before, 0, 9, 9, 'New')));
  });

  test('a strike ending INSIDE a link, aimed at its front, lands inside after the struck text', () => {
    // "word li" of "word link" is struck: the replacement follows the last struck character,
    // or the accepted text would read "nk New".
    const before = part(
      '<w:p><w:r><w:t xml:space="preserve">word </w:t></w:r>' +
        '<w:hyperlink w:anchor="x"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>'
    );
    const out = replaced(before, 0, 7, 0, 'New');
    expect(xml(out)).toMatch(
      /<w:delText>li<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t>New<\/w:t><\/w:r><\/w:ins><w:r><w:t>nk<\/w:t><\/w:r><\/w:hyperlink>/
    );
    expect(xml(out)).toBe(xml(replaced(before, 0, 7, 7, 'New')));
    const accepted = xml(apply(out, { op: 'acceptAllRevisions' }));
    expect(accepted.indexOf('<w:t>New</w:t>')).toBeLessThan(accepted.indexOf('<w:t>nk</w:t>'));
  });

  test('a strike that BEGINS inside a link and runs past it lands after its last piece', () => {
    const before = part(
      '<w:p><w:hyperlink w:anchor="x"><w:r><w:t>link</w:t></w:r></w:hyperlink>' +
        '<w:r><w:t xml:space="preserve"> more tail</w:t></w:r></w:p>'
    );
    const atFront = xml(replaced(before, 0, 9, 0, 'New'));
    expect(atFront).toMatch(
      /<\/w:hyperlink><w:del[^>]*><w:r><w:delText[^>]*> more<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t>New<\/w:t><\/w:r><\/w:ins><w:r><w:t[^>]*> tail<\/w:t>/
    );
    expect(atFront).toBe(xml(replaced(before, 0, 9, 9, 'New')));
  });

  test("a strike reaching the end of another author's w:ins lands outside it, from either edge", () => {
    // The replacement is Ada's own, not something Grace can reject with her insertion.
    const before = part(
      '<w:p><w:ins w:id="1" w:author="Grace Hopper" w:date="2026-01-02T03:04:05Z">' +
        '<w:r><w:t>hello</w:t></w:r></w:ins><w:r><w:t xml:space="preserve"> world</w:t></w:r></w:p>'
    );
    const atFront = xml(replaced(before, 2, 5, 2, 'XYZ'));
    expect(atFront).toMatch(
      /<\/w:del><\/w:ins><w:ins[^>]*w:author="Ada Lovelace"[^>]*><w:r><w:t>XYZ<\/w:t>/
    );
    expect(atFront).toBe(xml(replaced(before, 2, 5, 5, 'XYZ')));
  });

  test('the review lane keeps a tracked replacement as two decisions', () => {
    // A replacement writes distinct source revisions and keeps their decisions separate.
    const before = part(
      '<w:p><w:r><w:t xml:space="preserve">The Receiving Party shall</w:t></w:r></w:p>'
    );
    const items = revisionItemsOf(replaced(before, 4, 19, 4, 'Recipient'));
    expect(items.map((item) => item.revisionKind)).toEqual(['delete', 'insert']);
    expect(items.map((item) => item.text)).toEqual(['Receiving Party', 'Recipient']);
    expect(items.every((item) => item.addresses.length === 1)).toBe(true);
    expect(new Set(items.map((item) => item.address.id)).size).toBe(2);
  });

  test('a replacement with a shared ID still reads as two decisions', () => {
    // Source element kinds keep decisions separate when their revision addresses match.
    const legacy = part(
      '<w:p><w:r><w:t xml:space="preserve">The </w:t></w:r>' +
        `<w:del w:id="0" w:author="Ada Lovelace" w:date="${ADA.date}">` +
        '<w:r><w:delText>old</w:delText></w:r></w:del>' +
        `<w:ins w:id="0" w:author="Ada Lovelace" w:date="${ADA.date}">` +
        '<w:r><w:t>new</w:t></w:r></w:ins><w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>'
    );
    const items = revisionItemsOf(legacy);
    expect(items.map((item) => item.revisionKind)).toEqual(['delete', 'insert']);
    expect(items.map((item) => item.text)).toEqual(['old', 'new']);
    expect(items.every((item) => item.addresses.length === 1)).toBe(true);
    const accepted = xml(
      apply(legacy, {
        op: 'acceptRevision',
        revision: { id: '0', author: 'Ada Lovelace', date: ADA.date },
      })
    );
    expect(accepted).toContain('<w:t>new</w:t>');
    expect(accepted).not.toContain('old');
  });

  test('a tracked format change and a tracked insertion in one transaction never share an id', () => {
    // Every tracked lane draws from ONE minter per part per transaction. Two counters, one of
    // them caching its walk, handed the `w:ins` the id the `w:rPrChange` had just taken.
    const before = part('<w:p><w:r><w:t>alpha beta</w:t></w:r></w:p>');
    const id = paragraphId(before);
    const out = xml(
      transacted(before, [
        { op: 'insertText', paragraphId: id, offset: 0, text: 'A', revision: ADA },
        {
          op: 'setRunProperties',
          paragraphId: id,
          start: 3,
          end: 6,
          properties: [{ localName: 'b', namespaceUri: WML, attributes: [] }],
          revision: ADA,
        },
        { op: 'insertText', paragraphId: id, offset: 11, text: 'Z', revision: ADA },
      ])
    );
    const ids = [...out.matchAll(/<w:(?:ins|rPrChange)\b[^>]*w:id="(\d+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  test('typing on inside your own insertion mints no id and walks nothing', () => {
    // The id is minted for the first wrapper only: the second keystroke extends the wrapper
    // it finds, so the file holds one `w:ins` under one id.
    let current = part('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>');
    const id = paragraphId(current);
    current = apply(current, {
      op: 'insertText',
      paragraphId: id,
      offset: 5,
      text: 'X',
      revision: ADA,
    });
    current = apply(current, {
      op: 'insertText',
      paragraphId: id,
      offset: 6,
      text: 'Y',
      revision: ADA,
    });
    const out = xml(current);
    expect(out.match(/<w:ins /g)).toHaveLength(1);
    expect(out).toContain('<w:t>XY</w:t>');
  });
});
