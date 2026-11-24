// Actor-scoped decimal id allocation: stripes, solo density, and hostile input.
//
// Two peers that mint by "highest + 1" compute the same id. These cases pin the
// replacement: disjoint residues per actor, Word-like dense ids with no actor, and
// the ceiling / attacker-controlled-input defences the revision minter already had.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  ACTOR_ID_STRIPE,
  actorStripe,
  freePackageRelationshipId,
  MAX_DECIMAL_ID,
  nextDenseDecimalId,
  nextStripedDecimalId,
  partNumberCandidates,
  relationshipIdFromNumber,
  runWithTransactionActor,
} from '../package/actor-scoped-ids.ts';
import { allocateContentControlId } from '../package/content-control-nodes.ts';
import { allocateDrawingPropertyId, withEmbeddedImage } from '../package/drawing-package-edit.ts';
import { allocateNoteId, type NoteKind } from '../package/note-nodes.ts';
import { applyNoteLifecycleOp } from '../package/note-lifecycle.ts';
import { allocateOwnerRelationshipId } from '../package/package-edit.ts';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import { planTocEntries } from '../package/toc-build.ts';
import { parseTocInstruction } from '../package/toc-instruction.ts';
import { readOoxmlPart, type OoxmlPart } from '../package/ooxml-tree.ts';
import { addComment } from '../store/comment-writes.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import { nextBookmarkId } from '../store/tree-op-bookmark-ids.ts';
import { nextRevisionId } from '../store/tree-op-revision-ids.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const ADA = { author: 'Ada Lovelace', date: '2026-01-02T03:04:05Z' };

function revisionPart(body: string): OoxmlPart {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

function firstParagraphId(part: OoxmlPart): string {
  const body = part.root.children.find((child) => child.kind !== 'textValue');
  const found = body && body.kind !== 'textValue' ? body.children[0] : undefined;
  if (!found) throw new Error('no paragraph');
  return found.id;
}

function contentControlIds(part: OoxmlPart): number[] {
  const ids: number[] = [];
  const visit = (node: {
    kind: string;
    localName?: string;
    attributes?: readonly { localName: string; value: string }[];
    children?: readonly unknown[];
  }): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'id') {
      for (const attribute of node.attributes ?? []) {
        if (attribute.localName === 'val' && /^\d+$/.test(attribute.value)) {
          ids.push(Number(attribute.value));
        }
      }
    }
    for (const child of (node.children ?? []) as (typeof node)[]) visit(child);
  };
  visit(part.root as never);
  return ids;
}

function bookmarkIds(part: OoxmlPart): string[] {
  const ids: string[] = [];
  const visit = (node: {
    kind: string;
    localName?: string;
    attributes?: readonly { localName: string; value: string }[];
    children?: readonly unknown[];
  }): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'bookmarkStart') {
      for (const attribute of node.attributes ?? []) {
        if (attribute.localName === 'id') ids.push(attribute.value);
      }
    }
    for (const child of (node.children ?? []) as (typeof node)[]) visit(child);
  };
  visit(part.root as never);
  return ids;
}

function headingParagraphs(store: TreeDocumentStore): { title: string; heading: string } {
  const body = store.part.root.children.find((child) => child.kind === 'body');
  const paragraphs = body?.children.filter((child) => child.kind === 'paragraph') ?? [];
  const title = paragraphs[0];
  const heading = paragraphs[1];
  if (!title || !heading) throw new Error('need title and heading');
  return { title: title.id, heading: heading.id };
}

function insertHeadingBookmark(
  store: TreeDocumentStore,
  name: string,
  actorId?: string
): ReturnType<TreeDocumentStore['transact']> {
  const { title, heading } = headingParagraphs(store);
  return store.transact(
    (ctx) => {
      ctx.apply({
        op: 'insertToc',
        beforeParagraphId: title,
        instruction: 'TOC \\o "1-3" \\h',
        alias: 'TOC',
        entries: [
          {
            level: 0,
            text: 'Heading',
            headingParagraphId: heading,
            bookmarkName: name,
            pageNumberText: '1',
          },
        ],
        bookmarksToCreate: [{ paragraphId: heading, name }],
      });
    },
    actorId === undefined ? {} : { actorId }
  );
}

function revisionIds(part: OoxmlPart): string[] {
  const ids: string[] = [];
  const visit = (node: {
    kind: string;
    localName?: string;
    attributes?: readonly { localName: string; value: string; namespaceUri: string }[];
    children?: readonly unknown[];
  }): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'ins' || node.localName === 'del') {
      for (const attribute of node.attributes ?? []) {
        if (attribute.localName === 'id' && attribute.namespaceUri === W) ids.push(attribute.value);
      }
    }
    for (const child of (node.children ?? []) as (typeof node)[]) visit(child);
  };
  visit(part.root as never);
  return ids;
}

function storeOf(
  body = '<w:p><w:r><w:t>Hello world</w:t></w:r></w:p><w:sectPr/>'
): TreeDocumentStore {
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
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return new TreeDocumentStore(loaded.package, loaded.package.mainDocumentPart);
}

describe('actor stripes are disjoint', () => {
  test('alice and bob hash to different residues', () => {
    expect(actorStripe('alice')).not.toBe(actorStripe('bob'));
    expect(actorStripe('alice')).toBeLessThan(ACTOR_ID_STRIPE);
    expect(actorStripe('bob')).toBeLessThan(ACTOR_ID_STRIPE);
  });

  test('two actors minting from the same used set never share an id', () => {
    const used = new Set<string>();
    const alice: string[] = [];
    const bob: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      const left = nextStripedDecimalId(used, 'alice', MAX_DECIMAL_ID);
      used.add(left);
      alice.push(left);
      const right = nextStripedDecimalId(used, 'bob', MAX_DECIMAL_ID);
      used.add(right);
      bob.push(right);
    }
    expect(new Set([...alice, ...bob]).size).toBe(40);
    const aliceStripe = actorStripe('alice');
    for (const id of alice) expect(Number(id) % ACTOR_ID_STRIPE).toBe(aliceStripe);
    const bobStripe = actorStripe('bob');
    for (const id of bob) expect(Number(id) % ACTOR_ID_STRIPE).toBe(bobStripe);
  });

  test('the stripe space is wide enough that a real room rarely shares a class', () => {
    // Same-stripe actors mint the SAME id, so the count is a birthday problem, not a style
    // choice. This was 16, where a five-person room collided half the time. The bound below is
    // what keeps that from being reintroduced as a "keep ids small" tidy-up.
    const room = 8;
    const pairs = (room * (room - 1)) / 2;
    // Rough birthday bound: expected colliding pairs is pairs / classes. At 16 this was 1.75.
    expect(pairs / ACTOR_ID_STRIPE).toBeLessThan(0.005);
  });

  test('actor ids of the shape hosts mint spread across the space', () => {
    // Deterministic sample, so this measures our modulus rather than the platform's RNG.
    const stripes = new Set<number>();
    for (let index = 0; index < 200; index += 1) {
      stripes.add(
        actorStripe(`Reviewer ${index}:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f${index % 10}`)
      );
    }
    // At 65,536 classes, 200 draws expect ~0.3 collisions; demanding near-perfect spread here
    // would be testing FNV, so this only catches a modulus that collapses the space.
    expect(stripes.size).toBeGreaterThan(190);
  });
});

describe('solo allocation stays Word-like', () => {
  test('dense ids start at zero and climb by one', () => {
    expect(nextDenseDecimalId(-1, undefined, MAX_DECIMAL_ID)).toBe('0');
    expect(nextDenseDecimalId(0, undefined, MAX_DECIMAL_ID)).toBe('1');
    expect(nextDenseDecimalId(7, undefined, MAX_DECIMAL_ID)).toBe('8');
  });

  test('a revision without an actor is one past the highest in use', () => {
    const before = revisionPart(
      `<w:p><w:ins w:id="7" w:author="Alan Turing"><w:r><w:t>ab</w:t></w:r></w:ins>` +
        `<w:r><w:t>cd</w:t></w:r></w:p>`
    );
    expect(nextRevisionId(before)()).toBe('8');
  });

  test('a tracked insert without an actor still mints w:id="0" on an empty part', () => {
    const before = revisionPart('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>');
    const result = applyTreeOp(before, {
      op: 'insertText',
      paragraphId: firstParagraphId(before),
      offset: 0,
      text: 'X',
      revision: ADA,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(revisionIds(result.part)).toEqual(['0']);
  });

  test('a comment without an actor still mints w:id="0"', () => {
    const store = storeOf();
    const paragraph = store.part.root.children
      .find((child) => child.kind === 'body')
      ?.children.find((child) => child.kind === 'paragraph');
    if (!paragraph) throw new Error('no paragraph');
    const added = addComment(store, {
      anchor: { paragraphId: paragraph.id, start: 0, end: 5 },
      author: 'Solo',
      text: 'note',
    });
    if (!added.ok) throw new Error(added.reason);
    expect(added.commentId).toBe('0');
  });

  test('a relationship without an actor is still rId${max+1}', () => {
    const store = storeOf();
    expect(freePackageRelationshipId(store.package)).toBe('rId2');
    expect(allocateOwnerRelationshipId(store.package, store.package.mainDocumentPart)).toBe('rId1');
  });
});

describe('ceiling and hostile input stay ignored for seeding', () => {
  test('a 23-digit bookmark id does not seed the next revision', () => {
    const before = revisionPart(
      `<w:p><w:bookmarkStart w:id="10000000000000000000000" w:name="x"/>` +
        `<w:r><w:t>ab</w:t></w:r></w:p>`
    );
    expect(nextRevisionId(before)()).toBe('0');
  });

  test("a revision id past Word's signed 32-bit range is ignored", () => {
    const before = revisionPart(
      `<w:p><w:ins w:id="2147483648" w:author="X"><w:r><w:t>ab</w:t></w:r></w:ins>` +
        `<w:r><w:t>cd</w:t></w:r></w:p>`
    );
    expect(nextRevisionId(before)()).toBe('0');
  });

  test('a non-numeric revision id is ignored', () => {
    const before = revisionPart(
      `<w:p><w:ins w:id="not-a-number" w:author="X"><w:r><w:t>ab</w:t></w:r></w:ins>` +
        `<w:r><w:t>cd</w:t></w:r></w:p>`
    );
    expect(nextRevisionId(before)()).toBe('0');
  });

  test('past the ceiling the solo minter wraps to the lowest unused id', () => {
    const before = revisionPart(
      `<w:p><w:ins w:id="${MAX_DECIMAL_ID}" w:author="X"><w:r><w:t>ab</w:t></w:r></w:ins>` +
        `<w:r><w:t>cd</w:t></w:r></w:p>`
    );
    expect(nextRevisionId(before)()).toBe('0');
  });

  test('a striped mint past the ceiling refuses rather than colliding', () => {
    const used = new Set<string>();
    const stripe = actorStripe('alice');
    used.add(String(stripe));
    expect(() => nextStripedDecimalId(used, 'alice', stripe)).toThrow('no free decimal id');
  });

  test('a huge comment @w:id is ignored for seeding', () => {
    const commentsRel =
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${commentsRel}" Target="comments.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>` +
          '<w:p><w:r><w:t>Hello world</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'
      ),
      'word/comments.xml': strToU8(
        `<w:comments xmlns:w="${W}">` +
          '<w:comment w:id="9999999999" w:author="X"><w:p><w:r><w:t>old</w:t></w:r></w:p></w:comment>' +
          '</w:comments>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const store = new TreeDocumentStore(loaded.package, loaded.package.mainDocumentPart);
    const paragraph = store.part.root.children
      .find((child) => child.kind === 'body')
      ?.children.find((child) => child.kind === 'paragraph');
    if (!paragraph) throw new Error('no paragraph');
    const added = addComment(store, {
      anchor: { paragraphId: paragraph.id, start: 0, end: 5 },
      author: 'B',
      text: 'two',
    });
    if (!added.ok) throw new Error(added.reason);
    expect(added.commentId).toBe('0');
  });
});

describe('an attached actor stripes through the store transaction', () => {
  test('two transact actors mint different revision ids from one part', () => {
    const store = storeOf();
    const paragraph = store.part.root.children
      .find((child) => child.kind === 'body')
      ?.children.find((child) => child.kind === 'paragraph');
    if (!paragraph) throw new Error('no paragraph');
    const left = store.transact(
      (ctx) => {
        ctx.apply({
          op: 'insertText',
          paragraphId: paragraph.id,
          offset: 0,
          text: 'A',
          revision: ADA,
        });
      },
      { actorId: 'alice' }
    );
    if (!left.ok) throw new Error(left.reason);
    const rightStore = storeOf();
    const rightParagraph = rightStore.part.root.children
      .find((child) => child.kind === 'body')
      ?.children.find((child) => child.kind === 'paragraph');
    if (!rightParagraph) throw new Error('no paragraph');
    const right = rightStore.transact(
      (ctx) => {
        ctx.apply({
          op: 'insertText',
          paragraphId: rightParagraph.id,
          offset: 0,
          text: 'B',
          revision: ADA,
        });
      },
      { actorId: 'bob' }
    );
    if (!right.ok) throw new Error(right.reason);
    const leftIds = revisionIds(store.part);
    const rightIds = revisionIds(rightStore.part);
    expect(leftIds).toHaveLength(1);
    expect(rightIds).toHaveLength(1);
    expect(leftIds[0]).not.toBe(rightIds[0]);
    expect(leftIds[0]).toBe(String(actorStripe('alice')));
    expect(rightIds[0]).toBe(String(actorStripe('bob')));
  });

  test('two comment actors mint different ids from one empty part', () => {
    const left = storeOf();
    const right = storeOf();
    const paragraphOf = (store: TreeDocumentStore) => {
      const paragraph = store.part.root.children
        .find((child) => child.kind === 'body')
        ?.children.find((child) => child.kind === 'paragraph');
      if (!paragraph) throw new Error('no paragraph');
      return paragraph.id;
    };
    const leftAdded = addComment(left, {
      anchor: { paragraphId: paragraphOf(left), start: 0, end: 5 },
      author: 'Alice',
      text: 'A',
      actorId: 'alice',
    });
    const rightAdded = addComment(right, {
      anchor: { paragraphId: paragraphOf(right), start: 0, end: 5 },
      author: 'Bob',
      text: 'B',
      actorId: 'bob',
    });
    if (!leftAdded.ok || !rightAdded.ok) throw new Error('comment refused');
    expect(leftAdded.commentId).not.toBe(rightAdded.commentId);
    expect(leftAdded.commentId).toBe(String(actorStripe('alice')));
    expect(rightAdded.commentId).toBe(String(actorStripe('bob')));
  });

  test('two relationship actors mint different rIds from one package', () => {
    const left = storeOf();
    const right = storeOf();
    const leftId = runWithTransactionActor('alice', () => freePackageRelationshipId(left.package));
    const rightId = runWithTransactionActor('bob', () => freePackageRelationshipId(right.package));
    expect(leftId).not.toBe(rightId);
    expect(leftId).toBe(relationshipIdFromNumber(actorStripe('alice')));
    expect(rightId).toBe(relationshipIdFromNumber(actorStripe('bob')));
  });
});

describe('byte-identical solo regression', () => {
  test('the same input without an actor mints the ids this file minted before striping', () => {
    const withRevision = revisionPart(
      `<w:p><w:ins w:id="7" w:author="Alan Turing"><w:r><w:t>ab</w:t></w:r></w:ins>` +
        `<w:r><w:t>cd</w:t></w:r></w:p>`
    );
    const minted = applyTreeOp(withRevision, {
      op: 'insertText',
      paragraphId: firstParagraphId(withRevision),
      offset: 3,
      text: 'X',
      revision: ADA,
    });
    if (!minted.ok) throw new Error(minted.reason);
    expect(revisionIds(minted.part).sort((left, right) => Number(left) - Number(right))).toEqual([
      '7',
      '8',
    ]);

    const store = storeOf();
    const paragraph = store.part.root.children
      .find((child) => child.kind === 'body')
      ?.children.find((child) => child.kind === 'paragraph');
    if (!paragraph) throw new Error('no paragraph');
    const comment = addComment(store, {
      anchor: { paragraphId: paragraph.id, start: 0, end: 5 },
      author: 'Solo',
      text: 'note',
    });
    if (!comment.ok) throw new Error(comment.reason);
    expect(comment.commentId).toBe('0');
    expect(freePackageRelationshipId(store.package)).toBe('rId2');
  });
});

describe('bookmark ids stay lowest-free without an actor', () => {
  test('an empty part mints 1, then 2 — not 0 and not highest-plus-one', () => {
    const before = revisionPart('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const mint = nextBookmarkId(before);
    expect(mint()).toBe('1');
    expect(mint()).toBe('2');
  });

  test('a gap at 2 is filled instead of counting past the highest id', () => {
    const before = revisionPart(
      `<w:p><w:bookmarkStart w:id="1" w:name="a"/>` +
        `<w:r><w:t>ab</w:t></w:r>` +
        `<w:bookmarkEnd w:id="1"/>` +
        `<w:bookmarkStart w:id="3" w:name="c"/>` +
        `<w:bookmarkEnd w:id="3"/></w:p>`
    );
    expect(nextBookmarkId(before)()).toBe('2');
  });

  test('an existing 5 does not make the next id 6', () => {
    const before = revisionPart(
      `<w:p><w:bookmarkStart w:id="5" w:name="x"/>` +
        `<w:r><w:t>ab</w:t></w:r>` +
        `<w:bookmarkEnd w:id="5"/></w:p>`
    );
    expect(nextBookmarkId(before)()).toBe('1');
  });

  test('insertToc without an actor still writes w:id="1"', () => {
    const store = storeOf(
      '<w:p><w:r><w:t>Title</w:t></w:r></w:p><w:p><w:r><w:t>Heading</w:t></w:r></w:p><w:sectPr/>'
    );
    const result = insertHeadingBookmark(store, '_Toc1');
    if (!result.ok) throw new Error(result.reason);
    expect(bookmarkIds(store.part)).toEqual(['1']);
  });
});

describe('hostile bookmark ids are ignored for seeding', () => {
  test('a 23-digit bookmark id does not seed the next bookmark', () => {
    const before = revisionPart(
      `<w:p><w:bookmarkStart w:id="10000000000000000000000" w:name="x"/>` +
        `<w:r><w:t>ab</w:t></w:r>` +
        `<w:bookmarkEnd w:id="10000000000000000000000"/></w:p>`
    );
    expect(nextBookmarkId(before)()).toBe('1');
  });

  test('a bookmark id past Word signed 32-bit range is ignored', () => {
    const before = revisionPart(
      `<w:p><w:bookmarkStart w:id="2147483648" w:name="x"/>` +
        `<w:r><w:t>ab</w:t></w:r>` +
        `<w:bookmarkEnd w:id="2147483648"/></w:p>`
    );
    expect(nextBookmarkId(before)()).toBe('1');
  });

  test('a non-numeric bookmark id is ignored', () => {
    const before = revisionPart(
      `<w:p><w:bookmarkStart w:id="not-a-number" w:name="x"/>` +
        `<w:r><w:t>ab</w:t></w:r>` +
        `<w:bookmarkEnd w:id="not-a-number"/></w:p>`
    );
    expect(nextBookmarkId(before)()).toBe('1');
  });
});

describe('an attached actor stripes bookmark ids', () => {
  test('two actors mint different bookmark ids from one part', () => {
    const empty = revisionPart('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const alice = nextBookmarkId(empty, 'alice')();
    const bob = nextBookmarkId(empty, 'bob')();
    expect(alice).not.toBe(bob);
    expect(alice).toBe(String(actorStripe('alice')));
    expect(bob).toBe(String(actorStripe('bob')));
  });

  test('two transact actors mint different bookmark ids through insertToc', () => {
    const body =
      '<w:p><w:r><w:t>Title</w:t></w:r></w:p><w:p><w:r><w:t>Heading</w:t></w:r></w:p><w:sectPr/>';
    const left = storeOf(body);
    const right = storeOf(body);
    const leftResult = insertHeadingBookmark(left, '_TocAlice', 'alice');
    const rightResult = insertHeadingBookmark(right, '_TocBob', 'bob');
    if (!leftResult.ok) throw new Error(leftResult.reason);
    if (!rightResult.ok) throw new Error(rightResult.reason);
    const leftIds = bookmarkIds(left.part);
    const rightIds = bookmarkIds(right.part);
    expect(leftIds).toEqual([String(actorStripe('alice'))]);
    expect(rightIds).toEqual([String(actorStripe('bob'))]);
    expect(leftIds[0]).not.toBe(rightIds[0]);
  });
});

const TOC_INSTRUCTION = parseTocInstruction('TOC \\o "1-3" \\h');
if (!TOC_INSTRUCTION) throw new Error('TOC instruction');

function planHeadingToc(part: OoxmlPart, headingId: string, actorId?: string) {
  return planTocEntries(
    part,
    [{ text: 'Heading', level: 0, blockId: headingId }],
    TOC_INSTRUCTION,
    new Map([[headingId, '1']]),
    new Set(),
    actorId
  );
}

describe('TOC bookmark names stay Word-like without an actor', () => {
  test('an empty part still mints _Toc1600000000, then _Toc1600000001', () => {
    const before = revisionPart('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const heading = firstParagraphId(before);
    const first = planHeadingToc(before, heading);
    expect(first.bookmarksToCreate.map((bookmark) => bookmark.name)).toEqual(['_Toc1600000000']);
    const second = planTocEntries(
      before,
      [
        { text: 'One', level: 0, blockId: heading },
        { text: 'Two', level: 0, blockId: `${heading}-b` },
      ],
      TOC_INSTRUCTION,
      new Map([
        [heading, '1'],
        [`${heading}-b`, '1'],
      ]),
      new Set()
    );
    expect(second.bookmarksToCreate.map((bookmark) => bookmark.name)).toEqual([
      '_Toc1600000000',
      '_Toc1600000001',
    ]);
  });

  test('one existing bookmark still seeds from count, not from the name', () => {
    const before = revisionPart(
      `<w:p><w:bookmarkStart w:id="1" w:name="Keep"/>` +
        `<w:r><w:t>ab</w:t></w:r>` +
        `<w:bookmarkEnd w:id="1"/></w:p>`
    );
    const plan = planHeadingToc(before, firstParagraphId(before));
    expect(plan.bookmarksToCreate.map((bookmark) => bookmark.name)).toEqual(['_Toc1600000001']);
  });
});

describe('an attached actor stripes TOC bookmark names', () => {
  test('two actors mint different _Toc names from one part', () => {
    const empty = revisionPart('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const heading = firstParagraphId(empty);
    const alice = planHeadingToc(empty, heading, 'alice');
    const bob = planHeadingToc(empty, heading, 'bob');
    const aliceName = alice.bookmarksToCreate[0]?.name;
    const bobName = bob.bookmarksToCreate[0]?.name;
    expect(aliceName).toBe(`_Toc${actorStripe('alice')}`);
    expect(bobName).toBe(`_Toc${actorStripe('bob')}`);
    expect(aliceName).not.toBe(bobName);
  });
});

describe('content-control ids stay one-past-max without an actor', () => {
  test('an empty part still mints 1', () => {
    const before = revisionPart('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    expect(allocateContentControlId(before.root)).toBe(1);
  });

  test('an existing 90210 still mints 90211', () => {
    const before = revisionPart(
      `<w:sdt><w:sdtPr><w:id w:val="90210"/></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>x</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    expect(allocateContentControlId(before.root)).toBe(90211);
  });

  test('insertContentControl without an actor still writes w:id="1"', () => {
    const before = revisionPart('<w:p><w:r><w:t>hello</w:t></w:r></w:p>');
    const result = applyTreeOp(before, {
      op: 'insertContentControl',
      paragraphId: firstParagraphId(before),
      start: 0,
      end: 5,
      type: 'plainText',
      tag: 'solo',
    });
    if (!result.ok) throw new Error(result.reason);
    expect(contentControlIds(result.part)).toEqual([1]);
    expect(allocateContentControlId(result.part.root)).toBe(2);
  });

  test('a 23-digit content-control id is ignored for seeding', () => {
    const before = revisionPart(
      `<w:sdt><w:sdtPr><w:id w:val="10000000000000000000000"/></w:sdtPr>` +
        `<w:sdtContent><w:p/></w:sdtContent></w:sdt>`
    );
    expect(allocateContentControlId(before.root)).toBe(1);
  });

  test('an id past Word signed 32-bit range is ignored for seeding', () => {
    const before = revisionPart(
      `<w:sdt><w:sdtPr><w:id w:val="2147483648"/></w:sdtPr>` +
        `<w:sdtContent><w:p/></w:sdtContent></w:sdt>`
    );
    expect(allocateContentControlId(before.root)).toBe(1);
  });
});

const FOOTNOTES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
/** The furniture `ensureNotesPart` writes: reserved ids `-1` and `0`, never allocated. */
const NOTE_SEPARATORS =
  '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
  '<w:footnote w:type="continuationSeparator" w:id="0">' +
  '<w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';

function footnotesPart(notes = ''): OoxmlPart {
  const read = readOoxmlPart(
    `<w:footnotes xmlns:w="${W}">${NOTE_SEPARATORS}${notes}</w:footnotes>`,
    { name: '/word/footnotes.xml', contentType: FOOTNOTES_CT }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

/** The id a peer's FIRST note takes, minted the way the session binds the actor. */
function insertFirstNote(store: TreeDocumentStore, noteKind: NoteKind, actorId?: string): number {
  const paragraphId = firstParagraphId(store.part);
  const result = runWithTransactionActor(actorId, () =>
    applyNoteLifecycleOp(store.package, { op: 'insertNote', noteKind, paragraphId, offset: 0 })
  );
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  if (result.noteId === undefined) throw new Error('no note id');
  return result.noteId;
}

/** Deterministic actor whose residue is `target`, so stripe 0 is testable at all. */
function actorWithStripe(target: number): string {
  for (let index = 0; index < 1_000_000; index += 1) {
    const candidate = `stripe-probe-${index}`;
    if (actorStripe(candidate) === target) return candidate;
  }
  throw new Error('no actor for stripe');
}

describe('note ids stay one-past-max without an actor', () => {
  test('a part holding only separators still mints 1', () => {
    expect(allocateNoteId(footnotesPart().root)).toBe(1);
  });

  test('an existing 7 still mints 8', () => {
    expect(allocateNoteId(footnotesPart('<w:footnote w:id="7"><w:p/></w:footnote>').root)).toBe(8);
  });

  test('insertNote without an actor still writes w:id="1"', () => {
    expect(insertFirstNote(storeOf(), 'footnote')).toBe(1);
    expect(insertFirstNote(storeOf(), 'endnote')).toBe(1);
  });
});

describe('an attached actor stripes note ids', () => {
  test('two actors mint different ids from one notes part', () => {
    const part = footnotesPart();
    const alice = allocateNoteId(part.root, 'alice');
    const bob = allocateNoteId(part.root, 'bob');
    expect(alice).toBe(actorStripe('alice'));
    expect(bob).toBe(actorStripe('bob'));
    expect(alice).not.toBe(bob);
  });

  test('two transact actors adding a first footnote mint different w:id', () => {
    // The defect this pins: both peers took `w:id="1"`, so after the merge both
    // `w:footnoteReference` marks resolved to one body and the other note was unreachable.
    const alice = insertFirstNote(storeOf(), 'footnote', 'alice');
    const bob = insertFirstNote(storeOf(), 'footnote', 'bob');
    expect(alice).toBe(actorStripe('alice'));
    expect(bob).toBe(actorStripe('bob'));
    expect(alice).not.toBe(bob);
  });

  test('two transact actors adding a first endnote mint different w:id', () => {
    const alice = insertFirstNote(storeOf(), 'endnote', 'alice');
    const bob = insertFirstNote(storeOf(), 'endnote', 'bob');
    expect(alice).not.toBe(bob);
  });

  test('a stripe that lands on 0 skips the continuation-separator id', () => {
    // `w:id="0"` owns the continuation separator and `-1` the separator rule. A striped
    // mint that handed either back would rewrite Word's note furniture.
    const actor = actorWithStripe(0);
    expect(allocateNoteId(footnotesPart().root, actor)).toBe(ACTOR_ID_STRIPE);
  });
});

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (character) => character.charCodeAt(0)
);

/** A package whose body carries one `wp:docPr`, or none when `id` is omitted. */
function docPrPackage(id?: string): TreeDocumentStore['package'] {
  const drawing =
    id === undefined
      ? ''
      : `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}">` +
        `<wp:extent cx="914400" cy="914400"/><wp:docPr id="${id}" name="pic"/>` +
        '</wp:inline></w:drawing></w:r></w:p>';
  return storeOf(`${drawing}<w:p><w:r><w:t>Hello world</w:t></w:r></w:p><w:sectPr/>`).package;
}

/** The `wp:docPr/@id` a peer's FIRST inserted picture takes, actor bound as a session binds it. */
function insertFirstPicture(store: TreeDocumentStore, actorId?: string): number {
  const embedded = runWithTransactionActor(actorId, () =>
    withEmbeddedImage(store.package, store.package.mainDocumentPart, {
      bytes: PNG_1X1,
      mime: 'image/png',
    })
  );
  if (!embedded.ok) throw new Error(embedded.reason);
  return embedded.docPrId;
}

describe('drawing property ids stay one-past-max without an actor', () => {
  test('a package carrying no drawing still mints 1', () => {
    expect(allocateDrawingPropertyId(docPrPackage())).toEqual({ ok: true, id: 1 });
  });

  test('an existing 7 still mints 8', () => {
    expect(allocateDrawingPropertyId(docPrPackage('7'))).toEqual({ ok: true, id: 8 });
  });

  test('a docPr id past the unsigned-int range is ignored for seeding', () => {
    expect(allocateDrawingPropertyId(docPrPackage('4294967296'))).toEqual({ ok: true, id: 1 });
  });

  test('inserting a picture without an actor still writes id="1"', () => {
    expect(insertFirstPicture(storeOf())).toBe(1);
  });
});

describe('an attached actor stripes drawing property ids', () => {
  test('two actors mint different ids from one package', () => {
    const pkg = docPrPackage();
    const alice = allocateDrawingPropertyId(pkg, 'alice');
    const bob = allocateDrawingPropertyId(pkg, 'bob');
    expect(alice).toEqual({ ok: true, id: actorStripe('alice') });
    expect(bob).toEqual({ ok: true, id: actorStripe('bob') });
  });

  test('two transact actors inserting a first picture mint different wp:docPr ids', () => {
    // The defect this pins: both peers took `id="1"`, so the merged document held two
    // drawings under one document-global id and Word renumbered them on open.
    const alice = insertFirstPicture(storeOf(), 'alice');
    const bob = insertFirstPicture(storeOf(), 'bob');
    expect(alice).toBe(actorStripe('alice'));
    expect(bob).toBe(actorStripe('bob'));
    expect(alice).not.toBe(bob);
  });

  test('a stripe that lands on 0 skips the unusable docPr id', () => {
    // `wp:docPr/@id` is `xsd:unsignedInt` but 0 names no drawing: the solo mint is
    // `highest + 1` and can never reach it, so a striped mint must not either.
    const actor = actorWithStripe(0);
    expect(allocateDrawingPropertyId(docPrPackage(), actor)).toEqual({
      ok: true,
      id: ACTOR_ID_STRIPE,
    });
  });
});

describe('an attached actor stripes content-control ids', () => {
  test('two actors mint different ids from one part', () => {
    const empty = revisionPart('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const alice = allocateContentControlId(empty.root, 'alice');
    const bob = allocateContentControlId(empty.root, 'bob');
    expect(alice).toBe(actorStripe('alice'));
    expect(bob).toBe(actorStripe('bob'));
    expect(alice).not.toBe(bob);
  });

  test('two transact actors mint different ids through insertContentControl', () => {
    const body = '<w:p><w:r><w:t>hello</w:t></w:r></w:p><w:sectPr/>';
    const left = storeOf(body);
    const right = storeOf(body);
    const paragraphOf = (store: TreeDocumentStore) => {
      const paragraph = store.part.root.children
        .find((child) => child.kind === 'body')
        ?.children.find((child) => child.kind === 'paragraph');
      if (!paragraph) throw new Error('no paragraph');
      return paragraph.id;
    };
    const leftResult = left.transact(
      (ctx) => {
        ctx.apply({
          op: 'insertContentControl',
          paragraphId: paragraphOf(left),
          start: 0,
          end: 5,
          type: 'plainText',
          tag: 'alice',
        });
      },
      { actorId: 'alice' }
    );
    const rightResult = right.transact(
      (ctx) => {
        ctx.apply({
          op: 'insertContentControl',
          paragraphId: paragraphOf(right),
          start: 0,
          end: 5,
          type: 'plainText',
          tag: 'bob',
        });
      },
      { actorId: 'bob' }
    );
    if (!leftResult.ok) throw new Error(leftResult.reason);
    if (!rightResult.ok) throw new Error(rightResult.reason);
    expect(contentControlIds(left.part)).toEqual([actorStripe('alice')]);
    expect(contentControlIds(right.part)).toEqual([actorStripe('bob')]);
  });
});

describe('part numbers', () => {
  /** The first three numbers a new part would try, with `actor` bound. */
  const firstOf = (actor?: string): number[] =>
    runWithTransactionActor(actor, () => {
      const numbers: number[] = [];
      for (const value of partNumberCandidates(99_999)) {
        numbers.push(value);
        if (numbers.length === 3) break;
      }
      return numbers;
    });

  test('a solo document numbers new parts 1, 2, 3', () => {
    expect(firstOf()).toEqual([1, 2, 3]);
  });

  test('two collaborators adding a part from one snapshot take different numbers', () => {
    const alice = firstOf('alice');
    const bob = firstOf('bob');
    expect(alice.filter((value) => bob.includes(value))).toEqual([]);
    expect(alice.every((value) => value <= 99_999)).toBe(true);
  });
});
