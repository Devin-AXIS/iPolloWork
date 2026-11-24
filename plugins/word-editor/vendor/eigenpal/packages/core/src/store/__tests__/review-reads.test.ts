// The review queue, derived in the STORE lane.
//
// The queue used to live in the layout lane, which meant anything that could not import layout —
// the automation lane, a headless host — had no way to answer "what comments does this document
// hold" without deriving it a second time. Two derivations of a reviewer's queue is how a comment
// comes to be listed by one surface and not the other, so the derivation moved here.
//
// These tests verify that the store barrel answers and that a comment inside a note — a story the
// old layout reader never reached through this path — is anchored rather than dropped.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addComment,
  collectReviewItems,
  commentBodyText,
  commentPartNameOf,
  commentsOfPart,
  commentsExtendedPartNameOf,
  deepParagraphOrderOfPart,
  locateSites,
  paragraphOrderOfPart,
  readOoxmlPackage,
  readOoxmlPart,
  revisionItemsOf,
  TreeDocumentStore,
  type OoxmlPackage,
  type OoxmlPart,
} from '../index.ts';

const FIXTURE = resolve(
  import.meta.dir,
  '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
);

function fixture(): OoxmlPackage {
  const pkg = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
  if (!pkg.ok) throw new Error(pkg.reason);
  return pkg.package;
}

function open(): TreeDocumentStore {
  const pkg = fixture();
  return new TreeDocumentStore(pkg, pkg.mainDocumentPart);
}

function paragraphWithText(story: OoxmlPart, length: number): string {
  const body = story.root.children.find((child) => child.kind === 'body');
  if (!body || body.kind === 'textValue') throw new Error('no body');
  for (const block of body.children) {
    if (block.kind !== 'paragraph') continue;
    let text = '';
    const visit = (node: { kind: string; children?: readonly unknown[]; value?: string }): void => {
      if (node.kind === 'textValue') text += node.value ?? '';
      for (const child of (node.children ?? []) as (typeof node)[]) visit(child);
    };
    visit(block as never);
    if (text.length >= length) return block.id;
  }
  throw new Error('no paragraph long enough');
}

describe('the store lane answers the review queue', () => {
  test('a comment written through the store is read back through the store', () => {
    const store = open();
    const paragraphId = paragraphWithText(store.part, 10);
    const added = addComment(store, {
      anchor: { paragraphId, start: 0, end: 5 },
      author: 'QA Reviewer',
      initials: 'QR',
      date: '2026-08-05T10:00:00Z',
      text: 'Check this claim.',
    });
    expect(added.ok).toBe(true);

    const pkg = store.package;
    const commentsPart = pkg.parts.get(commentPartNameOf(pkg, store.part.name));
    const items = collectReviewItems({
      storyPart: store.part,
      commentsPart,
      commentsExtendedPart: pkg.parts.get(commentsExtendedPartNameOf(pkg, store.part.name)),
    });
    const comment = items.find(
      (item) => item.kind === 'comment' && item.comment.author === 'QA Reviewer'
    );
    expect(comment).toBeDefined();
    if (comment?.kind !== 'comment') throw new Error('not a comment');
    expect(commentBodyText(comment.comment)).toBe('Check this claim.');
    expect(comment.resolved).toBe(false);
    expect(comment.orphaned).toBe(false);
    expect(comment.range?.start).toEqual({ paragraphId, offset: 0 });
    expect(comment.range?.end).toEqual({ paragraphId, offset: 5 });
  });
});

describe('comment thread identity', () => {
  test('uses the last comment paragraph paraId, as commentsExtended requires', () => {
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
    const result = readOoxmlPart(
      `<w:comments xmlns:w="${W_NS}" xmlns:w14="${W14_NS}">` +
        `<w:comment w:id="0" w:author="QA">` +
        `<w:p w14:paraId="11111111"><w:r><w:t>first</w:t></w:r></w:p>` +
        `<w:p w14:paraId="22222222"><w:r><w:t>last</w:t></w:r></w:p>` +
        `</w:comment></w:comments>`,
      {
        name: '/word/comments.xml',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    expect(commentsOfPart(result.part)[0]?.paraId).toBe('22222222');
  });
});

describe('tracked rows inside a textbox keep their anchors', () => {
  // A paragraph CAN hold table rows: a textbox in a run carries block content, tables
  // included. The site walk memoizes paragraph subtrees rather than pruning them — a
  // prune here silently turned the row's card rangeless (no band, no local patch).
  test('a tracked row deletion in a textbox table gets a range', () => {
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W_NS}" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>` +
        `<w:p><w:r><w:pict><v:textbox><w:txbxContent>` +
        `<w:tbl><w:tr>` +
        `<w:trPr><w:del w:id="9" w:author="Ada Reviewer" w:date="2026-01-01T00:00:00Z"/></w:trPr>` +
        `<w:tc><w:tcPr><w:cellDel w:id="9" w:author="Ada Reviewer" w:date="2026-01-01T00:00:00Z"/></w:tcPr>` +
        `<w:p><w:r><w:t>in the box</w:t></w:r></w:p></w:tc>` +
        `</w:tr></w:tbl>` +
        `</w:txbxContent></v:textbox></w:pict></w:r></w:p>` +
        `</w:body></w:document>`,
      {
        name: '/word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const part = result.part;

    const boxParagraphId = (() => {
      let inCell: string | null = null;
      const visit = (node: (typeof part)['root'], insideCell: boolean): void => {
        if (node.kind === 'textValue') return;
        if (node.kind === 'paragraph' && insideCell && inCell === null) {
          inCell = node.id;
          return;
        }
        for (const child of node.children) visit(child, insideCell || node.kind === 'tableCell');
      };
      visit(part.root, false);
      if (inCell === null) throw new Error('no textbox cell paragraph');
      return inCell;
    })();

    const located = locateSites(part);
    const cards = revisionItemsOf(part);
    const card = cards.find((item) => item.revisionKind === 'structural');
    expect(card).toBeDefined();
    expect(card!.ranges.length).toBeGreaterThan(0);
    expect(card!.ranges[0]!.start.paragraphId).toBe(boxParagraphId);
    // The memoized index answers repeat reads with the same instance.
    expect(locateSites(part)).toBe(located);
  });
});

describe('the deep paragraph order reaches paragraphs the shallow one cannot', () => {
  test('retains empty paragraphs beside property leaves', () => {
    const result = readOoxmlPart(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:p/><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Text</w:t></w:r></w:p>' +
        '<w:p/></w:body></w:document>',
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const order = deepParagraphOrderOfPart(result.part);
    expect(order.size).toBe(3);
    expect([...order]).toEqual([...paragraphOrderOfPart(result.part)]);
    expect(deepParagraphOrderOfPart(result.part)).toBe(order);
  });

  // A position the order index cannot see is an item that can never become active: the
  // surface resolves both the caret's and a range's paragraphs through it. The shallow
  // order stops at the host paragraph, so a tracked change inside a textbox was
  // permanently unactivatable.
  test('a textbox paragraph is ordered right after its host, and never reorders the body', () => {
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W_NS}" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>` +
        `<w:p><w:r><w:t>first</w:t></w:r></w:p>` +
        `<w:p><w:r><w:pict><v:textbox><w:txbxContent>` +
        `<w:p><w:r><w:t>in the box</w:t></w:r></w:p>` +
        `</w:txbxContent></v:textbox></w:pict></w:r></w:p>` +
        `<w:p><w:r><w:t>last</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const part = result.part;

    const shallow = paragraphOrderOfPart(part);
    const deep = deepParagraphOrderOfPart(part);
    expect(deep.size).toBe(shallow.size + 1);
    for (const id of shallow.keys()) expect(deep.has(id)).toBe(true);

    // The nested paragraph sits between its host and the block after it.
    const hostId = [...shallow.keys()][1]!;
    const afterId = [...shallow.keys()][2]!;
    const nestedId = [...deep.keys()].find((id) => !shallow.has(id))!;
    expect(deep.get(nestedId)!).toBeGreaterThan(deep.get(hostId)!);
    expect(deep.get(nestedId)!).toBeLessThan(deep.get(afterId)!);

    // Repeat reads are memoized on the immutable root.
    expect(deepParagraphOrderOfPart(part)).toBe(deep);
  });

  test('a textbox comment stays between the body comments surrounding its host', () => {
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const V_NS = 'urn:schemas-microsoft-com:vml';
    const story = readOoxmlPart(
      `<w:document xmlns:w="${W_NS}" xmlns:v="${V_NS}"><w:body>` +
        '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>before</w:t></w:r><w:commentRangeEnd w:id="0"/></w:p>' +
        '<w:p><w:r><w:pict><v:textbox><w:txbxContent>' +
        '<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>inside</w:t></w:r><w:commentRangeEnd w:id="1"/></w:p>' +
        '</w:txbxContent></v:textbox></w:pict></w:r></w:p>' +
        '<w:p><w:commentRangeStart w:id="2"/><w:r><w:t>after</w:t></w:r><w:commentRangeEnd w:id="2"/></w:p>' +
        '</w:body></w:document>',
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    const comments = readOoxmlPart(
      `<w:comments xmlns:w="${W_NS}">` +
        [0, 1, 2]
          .map(
            (id) =>
              `<w:comment w:id="${id}" w:author="QA"><w:p><w:r><w:t>C${id}</w:t></w:r></w:p></w:comment>`
          )
          .join('') +
        '</w:comments>',
      { name: '/word/comments.xml', contentType: 'app/xml' }
    );
    if (!story.ok || !comments.ok) throw new Error('failed to parse review fixture');

    expect(
      collectReviewItems({ storyPart: story.part, commentsPart: comments.part })
        .filter((item) => item.kind === 'comment')
        .map((item) => item.kind === 'comment' && item.comment.id)
    ).toEqual(['0', '1', '2']);
  });
});

describe('a card id names the part it lives in', () => {
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  function storyWith(name: string, body: string): OoxmlPart {
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`,
      { name, contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    return result.part;
  }

  // The SAME triple in two parts. `@w:id` is unique within a part and nowhere else, and
  // Word numbers each part from 1, so this is what an ordinary document looks like — not a
  // contrived collision.
  const TRACKED =
    `<w:p><w:ins w:id="1" w:author="QA" w:date="2024-01-01T00:00:00Z">` +
    `<w:r><w:t>alpha</w:t></w:r></w:ins></w:p>`;

  test('the body and a header do not share one card id', () => {
    const body = storyWith('/word/document.xml', TRACKED);
    const header = storyWith('/word/header1.xml', TRACKED);
    const items = collectReviewItems({ storyPart: body, furnitureParts: [header] });
    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
  });

  test('a rail keyed by id can still reach both cards', () => {
    // The failure this prevents is not the duplicate id itself: it is what every consumer
    // does with one. A `Map` keyed by id kept the last writer, so the body's card was
    // unreachable — no activation, no accept, no reject.
    const body = storyWith('/word/document.xml', TRACKED);
    const header = storyWith('/word/header1.xml', TRACKED);
    const items = collectReviewItems({ storyPart: body, furnitureParts: [header] });
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.size).toBe(2);
    const parts = [...byId.values()].map((item) =>
      item.kind === 'revision' ? item.ranges[0]?.partName : undefined
    );
    expect(new Set(parts)).toEqual(new Set(['/word/document.xml', '/word/header1.xml']));
  });

  test('the id is stable across reads, because a React key and an active card depend on it', () => {
    const body = storyWith('/word/document.xml', TRACKED);
    expect(revisionItemsOf(body)[0]!.id).toBe(revisionItemsOf({ ...body })[0]!.id);
  });
});

describe('a document with no tracked changes', () => {
  // The read answers [] without building the site-location index — so the guard here is
  // that the shortcut is taken only when there is truly nothing, and a tracked insertion
  // written afterwards still surfaces.
  test('reads an empty array, and a tracked insertion then surfaces', () => {
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W_NS}"><w:body>` +
        `<w:p><w:r><w:t>plain words only</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const store = new TreeDocumentStore(result.part);
    expect(revisionItemsOf(store.part)).toEqual([]);

    const paragraphId = [...deepParagraphOrderOfPart(store.part).keys()][0]!;
    const applied = store.transact((tx) => {
      tx.apply({
        op: 'insertText',
        paragraphId,
        offset: 5,
        text: 'MORE',
        revision: { author: 'QA Reviewer', date: '2026-01-01T00:00:00Z' },
      });
    });
    expect(applied.ok).toBe(true);

    const items = revisionItemsOf(store.part);
    expect(items).toHaveLength(1);
    expect(items[0]!.revisionKind).toBe('insert');
    expect(items[0]!.text).toBe('MORE');
    expect(items[0]!.ranges[0]!.start.paragraphId).toBe(paragraphId);
  });

  // A tab or a break has no `w:t`, so its card read as EMPTY — the reviewer was asked to
  // accept content they were never shown. The card projects the same character the offset
  // model counts for the element.
  test('a tracked tab derives a card with the tab character, not empty text', () => {
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W_NS}"><w:body>` +
        `<w:p><w:r><w:t>plain words only</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const store = new TreeDocumentStore(result.part);
    const paragraphId = [...deepParagraphOrderOfPart(store.part).keys()][0]!;
    const applied = store.transact((tx) => {
      tx.apply({
        op: 'insertTab',
        paragraphId,
        offset: 5,
        revision: { author: 'QA Reviewer', date: '2026-01-01T00:00:00Z' },
      });
    });
    expect(applied.ok).toBe(true);
    const items = revisionItemsOf(store.part);
    expect(items).toHaveLength(1);
    expect(items[0]!.revisionKind).toBe('insert');
    expect(items[0]!.text).toBe('\t');
  });
});

describe('the revision-card memo is keyed on the part, not just its root', () => {
  test('two parts sharing one root under different names each get their own part name', () => {
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W_NS}"><w:body>` +
        `<w:p><w:ins w:id="1" w:author="QA" w:date="2024-01-01T00:00:00Z">` +
        `<w:r><w:t>alpha</w:t></w:r></w:ins></w:p>` +
        `</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const part = result.part;
    // The items embed `ranges[*].partName`; a root-only cache key would hand the second
    // part the first part's stamped ranges.
    const first = revisionItemsOf(part);
    expect(first[0]!.ranges[0]!.partName).toBe('/word/document.xml');
    const renamed = revisionItemsOf({ ...part, name: '/word/header1.xml' });
    expect(renamed[0]!.ranges[0]!.partName).toBe('/word/header1.xml');
    // And the original still answers with its own name (recomputed or re-cached — either
    // way, never the other part's).
    expect(revisionItemsOf(part)[0]!.ranges[0]!.partName).toBe('/word/document.xml');
  });
});
