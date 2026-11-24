// A comment marker lands where the OFFSET AUTHORITY says, for every element it counts.
//
// `insertCommentMarker` used to measure the paragraph with a walk of its own, and anything the
// authority counted and that walk did not put the two out of step. The visible half was a
// refusal — `offset-out-of-range` for offsets past a drawing, a field, an inline content
// control — and the invisible half was worse: an offset that still resolved placed the marker
// on the wrong character, so the saved comment covered text nobody had selected.
//
// So the test is not "these offsets are accepted". It is: for EVERY offset in the paragraph,
// the marker lands at the same offset the authority reports for it. That is the property a
// second implementation cannot satisfy by accident.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  paragraphOffsetIndex,
  readOoxmlPackage,
  TreeDocumentStore,
  type OoxmlParagraphNode,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/**
 * A REAL package, zipped and read back. A hand-assembled one is refused by the package
 * invariants (`missing-content-type`) on the first write, which would make every case below
 * pass by being refused rather than by landing correctly.
 */
function storeOf(body: string): TreeDocumentStore {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}"><w:body>${body}</w:body></w:document>`
    ),
  });
  const pkg = readOoxmlPackage(bytes);
  if (!pkg.ok) throw new Error(pkg.reason);
  return new TreeDocumentStore(pkg.package, pkg.package.mainDocumentPart);
}

function firstParagraph(store: TreeDocumentStore): OoxmlParagraphNode {
  let found: OoxmlParagraphNode | null = null;
  const walk = (node: { kind: string; id: string; children?: readonly unknown[] }): void => {
    if (found || node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      found = node as unknown as OoxmlParagraphNode;
      return;
    }
    for (const child of (node.children ?? []) as (typeof node)[]) walk(child);
  };
  walk(store.part.root as never);
  if (!found) throw new Error('no paragraph');
  return found;
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const DRAWING =
  `<w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/>` +
  `<wp:docPr id="1" name="p"/><a:graphic><a:graphicData uri="u"/></a:graphic>` +
  `</wp:inline></w:drawing></w:r>`;
const FLD_SIMPLE = `<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple>`;
const COMPLEX_FIELD =
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
  `<w:r><w:t>12</w:t></w:r>` +
  `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const INLINE_SDT =
  `<w:sdt><w:sdtPr><w:tag w:val="t"/></w:sdtPr>` +
  `<w:sdtContent>${run('XY')}</w:sdtContent></w:sdt>`;

/**
 * Where the marker actually landed, in the authority's offsets, or null when refused.
 *
 * Read back from the SAVED tree rather than from the op: the whole failure being pinned is a
 * marker that reports success and sits somewhere else.
 */
function markerOffset(body: string, offset: number): number | null {
  const store = storeOf(body);
  const paragraph = firstParagraph(store);
  const result = store.transact((ctx) => {
    ctx.apply({
      op: 'insertCommentMarker',
      paragraphId: paragraph.id,
      offset,
      commentId: '1',
      marker: 'start',
    });
  });
  if (!result.ok) return null;

  const after = firstParagraph(store);
  const index = paragraphOffsetIndex(after);
  // The marker measures nothing, so its own span start IS the offset it was placed at.
  let landed: number | null = null;
  const walk = (node: { kind: string; id: string; children?: readonly unknown[] }): void => {
    if (landed !== null || node.kind === 'textValue') return;
    if (node.kind === 'commentRangeStart') {
      landed = index.spanOf(node.id as string)?.start ?? null;
      return;
    }
    for (const child of (node.children ?? []) as (typeof node)[]) walk(child);
  };
  walk(after as never);
  return landed;
}

function lengthOfBody(body: string): number {
  const store = storeOf(body);
  return paragraphOffsetIndex(firstParagraph(store)).length;
}

describe('a marker lands at the offset it was asked for', () => {
  const cases: readonly { readonly name: string; readonly body: string }[] = [
    { name: 'text only', body: `<w:p>${run('abcd')}</w:p>` },
    {
      name: 'an inline drawing between words',
      body: `<w:p>${run('ab')}${DRAWING}${run('cd')}</w:p>`,
    },
    { name: 'a simple field', body: `<w:p>${FLD_SIMPLE}${run('cd')}</w:p>` },
    {
      name: 'a complex field with a cached result',
      body: `<w:p>${COMPLEX_FIELD}${run('cd')}</w:p>`,
    },
    { name: 'an inline content control', body: `<w:p>${INLINE_SDT}${run('cd')}</w:p>` },
    { name: 'a drawing at the very end', body: `<w:p>${run('ab')}${DRAWING}</w:p>` },
    {
      name: 'a footnote mark leading the paragraph',
      body: `<w:p><w:r><w:footnoteRef/></w:r>${run('note text')}</w:p>`,
    },
    { name: 'an inline content control', body: `<w:p>${INLINE_SDT}${run('cd')}</w:p>` },
    {
      name: 'a control holding two runs',
      body:
        `<w:p><w:sdt><w:sdtPr><w:tag w:val="t"/></w:sdtPr><w:sdtContent>` +
        `${run('AB')}${run('CD')}</w:sdtContent></w:sdt>${run('ef')}</w:p>`,
    },
    {
      name: 'a link inside a tracked insertion inside a control',
      body:
        `<w:p><w:sdt><w:sdtPr><w:tag w:val="t"/></w:sdtPr><w:sdtContent>` +
        `<w:ins w:id="9" w:author="A" w:date="D"><w:hyperlink>${run('link')}</w:hyperlink></w:ins>` +
        `</w:sdtContent></w:sdt>${run('after')}</w:p>`,
    },
  ];

  for (const { name, body } of cases) {
    test(`${name}: every offset resolves to itself`, () => {
      const length = lengthOfBody(body);
      expect(length).toBeGreaterThan(0);
      for (let offset = 0; offset <= length; offset += 1) {
        // LANDS, at the offset asked for. Not "does not land wrong": a skipped refusal is
        // how the first version of this test managed to assert nothing at all.
        expect({ offset, landed: markerOffset(body, offset) }).toEqual({ offset, landed: offset });
      }
    });
  }

  test('an offset past the end is refused rather than clamped', () => {
    const body = `<w:p>${run('ab')}${DRAWING}${run('cd')}</w:p>`;
    const length = lengthOfBody(body);
    expect(markerOffset(body, length + 1)).toBeNull();
  });

  test('the end of a paragraph carrying a drawing is reachable', () => {
    // The old walk counted the drawing as nothing, so the paragraph measured two short and
    // the last two offsets — including the end, where a comment on the final word closes —
    // were refused outright.
    const body = `<w:p>${run('ab')}${DRAWING}${run('cd')}</w:p>`;
    expect(lengthOfBody(body)).toBe(5);
    expect(markerOffset(body, 5)).toBe(5);
  });
});

describe('a marker never lands inside an indivisible group', () => {
  test('an offset after a complex field clears the whole field, not just its begin', () => {
    // A complex field is ONE offset unit spread over five nodes, four of which measure
    // nothing. A boundary that matched the first zero-length sibling put the marker between
    // the field's begin and its instruction — a place Word discards the next time it
    // rebuilds the field, so the comment silently disappeared on a round trip.
    const body = `<w:p>${COMPLEX_FIELD}${run('cd')}</w:p>`;
    const store = storeOf(body);
    const paragraph = firstParagraph(store);
    const applied = store.transact((ctx) => {
      ctx.apply({
        op: 'insertCommentMarker',
        paragraphId: paragraph.id,
        offset: 1,
        commentId: '1',
        marker: 'start',
      });
    });
    expect(applied.ok).toBe(true);

    const after = firstParagraph(store);
    const kinds = after.children.map((child) => child.kind);
    const marker = kinds.indexOf('commentRangeStart');
    expect(marker).toBeGreaterThan(-1);
    // Everything before the marker that belongs to the field is present: the marker sits
    // after the field's `end`, not among its parts.
    const fieldChars = after.children
      .slice(0, marker)
      .filter((child) => child.kind === 'run').length;
    expect(fieldChars).toBe(5);
  });
});

describe('coincident markers keep Word classic order', () => {
  test('a second range on the same span nests starts/ends and trails references', () => {
    // Same insertion biases `addComment` uses for a reply. Interleaved end→ref pairs here
    // are exactly what made Word drop thread parent links on export.
    const store = storeOf(`<w:p>${run('abcdef')}</w:p>`);
    const paragraph = firstParagraph(store);
    const place = (commentId: string) => {
      const applied = store.transact((ctx) => {
        ctx.apply({
          op: 'insertCommentMarker',
          paragraphId: paragraph.id,
          offset: 6,
          commentId,
          marker: 'reference',
        });
        ctx.apply({
          op: 'insertCommentMarker',
          paragraphId: paragraph.id,
          offset: 6,
          commentId,
          marker: 'end',
        });
        ctx.apply({
          op: 'insertCommentMarker',
          paragraphId: paragraph.id,
          offset: 0,
          commentId,
          marker: 'start',
        });
      });
      expect(applied.ok).toBe(true);
    };
    place('1');
    place('2');

    const after = firstParagraph(store);
    const shape: string[] = [];
    for (const child of after.children) {
      if (child.kind === 'commentRangeStart' || child.kind === 'commentRangeEnd') {
        const id = child.attributes.find((entry) => entry.localName === 'id')?.value;
        shape.push(`${child.kind}#${id ?? '?'}`);
        continue;
      }
      if (
        child.kind === 'run' &&
        child.children.some((inner) => inner.kind === 'commentReference')
      ) {
        const ref = child.children.find((inner) => inner.kind === 'commentReference');
        const id =
          ref && ref.kind !== 'textValue'
            ? ref.attributes.find((entry) => entry.localName === 'id')?.value
            : undefined;
        shape.push(`commentReference#${id ?? '?'}`);
      }
    }
    expect(shape).toEqual([
      'commentRangeStart#1',
      'commentRangeStart#2',
      'commentRangeEnd#2',
      'commentRangeEnd#1',
      'commentReference#1',
      'commentReference#2',
    ]);
  });
});
