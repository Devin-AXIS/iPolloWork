// The losslessness oracle for a tracked edit: a proposal taken back leaves NOTHING behind.
//
// Tracking is the one editing mode whose whole promise is that the document is not changed
// yet, which makes reject-after-edit a fidelity oracle as strong as an unedited round trip.
// Whatever the writer did to the tree — split a run, wrap a field, re-label text — rejecting
// it has to give back the document that was there, through a save and a reopen.
//
// The comparison is the D9 SEMANTIC DIGEST with adjacent identical runs collapsed. Not the
// canonical fingerprint: rejecting an insertion leaves the run it split standing as two
// halves, which is a different tree saying exactly the same thing, and Word's own files carry
// that residue too. Everything a reader can observe — the characters, their order, the
// properties they carry, the structure holding them — has to match, and does.
//
// The baseline is the document with its OWN revisions resolved the same way, because a
// reject-all resolves what the file already carried as well as what this edit added.
//
// The shapes are the ones whose offsets the tracked writer had wrong: a hyperlink, a note
// reference, a complex field, a simple field, a tab. Every one is a paragraph Word writes.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, semanticDigest, serializeOoxmlPart, type OoxmlPart } from '../index.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import { paragraphLength } from '../store/tree-op-segments.ts';
import type { TreeDocOp } from '../store/tree-op-validate.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const ADA = { author: 'Ada Lovelace', date: '2026-01-02T03:04:05Z' };

function part(body: string): OoxmlPart {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!read.ok) throw new Error(`fixture did not parse: ${read.reason}`);
  return read.part;
}

function paragraphOf(source: OoxmlPart) {
  const body = source.root.children.find((child) => child.kind === 'body');
  if (!body || body.kind === 'textValue') throw new Error('no body');
  const paragraph = body.children.find((child) => child.kind === 'paragraph');
  if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('no paragraph');
  return paragraph;
}

function apply(source: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(source, op);
  if (!result.ok) throw new Error(`op refused: ${result.reason} ${result.detail ?? ''}`);
  return result.part;
}

/** Re-read a part from its own serialization, the way a save and a reopen would. */
function reopen(source: OoxmlPart): OoxmlPart {
  const read = readOoxmlPart(serializeOoxmlPart(source), {
    name: source.name,
    contentType: source.contentType,
  });
  if (!read.ok) throw new Error(`save/reopen failed: ${read.reason}`);
  return read.part;
}

/**
 * The D9 digest of a saved and reopened part, with adjacent identical run properties
 * collapsed.
 *
 * Only the run SPLIT is normalized away. Two runs carrying different properties never
 * collapse, so a lost `w:b` or a mislabelled run still moves the digest.
 */
function observable(source: OoxmlPart): string {
  const digest = semanticDigest([reopen(source)]);
  return JSON.stringify({
    stories: digest.stories.map((story) => ({
      ...story,
      paragraphs: story.paragraphs.map((paragraph) => ({
        ...paragraph,
        runProperties: paragraph.runProperties.filter(
          (properties, index) =>
            index === 0 ||
            JSON.stringify(properties) !== JSON.stringify(paragraph.runProperties[index - 1])
        ),
      })),
    })),
  });
}

/**
 * Resolve every revision, or hand the part back when it carries none.
 *
 * `acceptAllRevisions` / `rejectAllRevisions` refuse `unknown-revision` on a document with
 * nothing to resolve, which is the right answer for a command and the wrong one here: the
 * baseline for "a document with no revisions, all resolved" is that document.
 */
function resolveAll(source: OoxmlPart, action: 'accept' | 'reject'): OoxmlPart {
  const result = applyTreeOp(source, {
    op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions',
  });
  if (result.ok) return result.part;
  if (result.reason === 'unknown-revision') return source;
  throw new Error(`resolve refused: ${result.reason} ${result.detail ?? ''}`);
}

const rejectAll = (source: OoxmlPart): OoxmlPart => resolveAll(source, 'reject');
const acceptAll = (source: OoxmlPart): OoxmlPart => resolveAll(source, 'accept');

/**
 * Every paragraph shape whose offsets the tracked writer used to get wrong.
 *
 * `carriesRevisions` marks the two the accept-equivalence check leaves out. An untracked
 * `deleteText` refuses over text that is already struck, so there is no untracked edit to
 * compare a tracked one against — and resolving another author's revision at the same time
 * changes what "the same edit" would even mean.
 */
const SHAPES: readonly {
  readonly name: string;
  readonly body: string;
  readonly carriesRevisions?: boolean;
  /**
   * What a rejected deletion over `[atomStart, atomEnd)` gives back, when it is not `body`.
   * A struck simple field is written in its complex form, because `w:del` cannot hold a
   * `w:fldSimple`, and rejecting the deletion keeps that equivalent form.
   */
  readonly rejectedAtom?: { readonly start: number; readonly end: number; readonly body: string };
}[] = [
  { name: 'plain text', body: '<w:p><w:r><w:t>alpha beta gamma</w:t></w:r></w:p>' },
  {
    name: 'a hyperlink',
    body:
      '<w:p><w:r><w:t xml:space="preserve">see </w:t></w:r>' +
      '<w:hyperlink r:id="rId9"><w:r><w:t>the link</w:t></w:r></w:hyperlink>' +
      '<w:r><w:t xml:space="preserve"> and after</w:t></w:r></w:p>',
  },
  {
    name: 'a footnote reference',
    body:
      '<w:p><w:r><w:t>before</w:t></w:r>' +
      '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>' +
      '<w:footnoteReference w:id="1"/></w:r>' +
      '<w:r><w:t>after</w:t></w:r></w:p>',
  },
  {
    name: 'a complex field',
    body:
      '<w:p><w:r><w:t xml:space="preserve">page </w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>7</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:r><w:t xml:space="preserve"> of many</w:t></w:r></w:p>',
  },
  {
    name: 'a simple field',
    body:
      '<w:p><w:r><w:t xml:space="preserve">page </w:t></w:r>' +
      '<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple>' +
      '<w:r><w:t xml:space="preserve"> of many</w:t></w:r></w:p>',
    rejectedAtom: {
      start: 5,
      end: 6,
      body:
        '<w:p><w:r><w:t xml:space="preserve">page </w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>7</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '<w:r><w:t xml:space="preserve"> of many</w:t></w:r></w:p>',
    },
  },
  {
    name: 'a tab and a break',
    body: '<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>',
  },
  {
    name: 'formatted runs',
    body:
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>' +
      '<w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r></w:p>',
  },
  {
    name: "another author's insertion",
    carriesRevisions: true,
    body:
      '<w:p><w:r><w:t xml:space="preserve">kept </w:t></w:r>' +
      '<w:ins w:id="4" w:author="Alan Turing" w:date="2026-01-01T00:00:00Z">' +
      '<w:r><w:t>proposed</w:t></w:r></w:ins>' +
      '<w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>',
  },
  {
    name: "another author's deletion",
    carriesRevisions: true,
    body:
      '<w:p><w:r><w:t xml:space="preserve">kept </w:t></w:r>' +
      '<w:del w:id="5" w:author="Alan Turing" w:date="2026-01-01T00:00:00Z">' +
      '<w:r><w:delText>struck</w:delText></w:r></w:del>' +
      '<w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>',
  },
];

/** The rejected baseline for a deletion over `[start, end)`. */
function rejectedBaseline(shape: (typeof SHAPES)[number]): (start: number, end: number) => string {
  const plain = observable(rejectAll(part(shape.body)));
  const atom = shape.rejectedAtom;
  if (!atom) return () => plain;
  const rewritten = observable(rejectAll(part(atom.body)));
  return (start, end) => (start <= atom.start && end >= atom.end ? rewritten : plain);
}

describe('rejecting a tracked edit gives the document back', () => {
  for (const shape of SHAPES) {
    test(`${shape.name}: an insert at every position`, () => {
      const before = part(shape.body);
      const baseline = observable(rejectAll(before));
      const id = paragraphOf(before).id;
      const length = paragraphLength(paragraphOf(before));

      for (let offset = 0; offset <= length; offset += 1) {
        const edited = apply(before, {
          op: 'insertText',
          paragraphId: id,
          offset,
          text: 'XY',
          revision: ADA,
        });
        expect(observable(rejectAll(edited))).toBe(baseline);
      }
    });

    test(`${shape.name}: a delete over every range`, () => {
      const before = part(shape.body);
      const baselineFor = rejectedBaseline(shape);
      const id = paragraphOf(before).id;
      const length = paragraphLength(paragraphOf(before));

      for (let start = 0; start < length; start += 1) {
        for (let end = start + 1; end <= length; end += 1) {
          const baseline = baselineFor(start, end);
          const edited = apply(before, {
            op: 'deleteText',
            paragraphId: id,
            start,
            end,
            revision: ADA,
          });
          expect(observable(rejectAll(edited))).toBe(baseline);
        }
      }
    });

    test(`${shape.name}: a replacement over every range`, () => {
      // Typing over a selection: a delete and an insert in one transaction, which is where
      // the two writers meet and where the halves can disagree about the offset space.
      const before = part(shape.body);
      const baselineFor = rejectedBaseline(shape);
      const id = paragraphOf(before).id;
      const length = paragraphLength(paragraphOf(before));

      for (let start = 0; start < length; start += 1) {
        for (let end = start + 1; end <= length; end += 1) {
          const baseline = baselineFor(start, end);
          const struck = apply(before, {
            op: 'deleteText',
            paragraphId: id,
            start,
            end,
            revision: ADA,
          });
          const replaced = apply(struck, {
            op: 'insertText',
            paragraphId: id,
            offset: start,
            text: 'XY',
            revision: ADA,
          });
          expect(observable(rejectAll(replaced))).toBe(baseline);
        }
      }
    });
  }
});

describe('accepting a tracked delete performs the delete, and only the delete', () => {
  for (const shape of SHAPES.filter((entry) => !entry.carriesRevisions)) {
    test(`${shape.name}: every range matches the untracked edit`, () => {
      const before = part(shape.body);
      const id = paragraphOf(before).id;
      const length = paragraphLength(paragraphOf(before));

      for (let start = 0; start < length; start += 1) {
        for (let end = start + 1; end <= length; end += 1) {
          const tracked = acceptAll(
            apply(before, { op: 'deleteText', paragraphId: id, start, end, revision: ADA })
          );
          const untracked = acceptAll(
            apply(before, { op: 'deleteText', paragraphId: id, start, end })
          );
          // The proposal, once agreed, is the same edit the user would have made outright.
          // More would mean the tracked path took something it was not asked for; less would
          // mean it left something the reviewer agreed to remove.
          expect(observable(tracked)).toBe(observable(untracked));
        }
      }
    });
  }
});
