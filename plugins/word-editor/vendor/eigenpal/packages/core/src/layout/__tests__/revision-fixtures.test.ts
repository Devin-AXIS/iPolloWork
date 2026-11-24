// The revision projection against real documents.
//
// Hand-written XML proves the rules; it does not prove they survive a document Word actually
// produced. These assert against fixtures carrying thousands of revisions, including cases the
// synthetic tests could not have anticipated — a deletion nested inside another author's
// insertion, and revisions in a header rather than the body.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { paragraphTextOf, readOoxmlPackage, type OoxmlPart } from '@docx-editor.dev/core/store';
import { piecesOfParagraph } from '../field-projection.ts';
import type { RevisionAttribution, RevisionDisplayMode } from '../revision-projection.ts';
import { storyBlocks } from '../story-roots.ts';

const FIXTURES = resolve(import.meta.dir, '../../../../../e2e/fixtures');

function partOf(fixture: string, partName: string): OoxmlPart {
  const bytes = new Uint8Array(readFileSync(resolve(FIXTURES, fixture)));
  const pkg = readOoxmlPackage(bytes);
  if (!pkg.ok) throw new Error(pkg.reason);
  const part = pkg.package.parts.get(partName);
  if (!part) throw new Error(`${fixture} has no ${partName}`);
  return part;
}

interface Projection {
  readonly text: string;
  readonly tracked: number;
  readonly nested: readonly (readonly RevisionAttribution[])[];
}

function project(part: OoxmlPart, mode: RevisionDisplayMode): Projection {
  let text = '';
  let tracked = 0;
  const nested: (readonly RevisionAttribution[])[] = [];
  for (const block of storyBlocks(part, mode)) {
    if (block.kind !== 'paragraph') continue;
    for (const piece of piecesOfParagraph(
      block,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      mode
    )) {
      text += piece.text;
      if (!piece.revisions) continue;
      tracked += 1;
      if (piece.revisions.length > 1) nested.push(piece.revisions);
    }
  }
  return { text, tracked, nested };
}

describe('list-pagination-break.docx', () => {
  const body = partOf('list-pagination-break.docx', '/word/document.xml');

  test('tracked content is laid out rather than dropped', () => {
    const all = project(body, 'all-markup');
    expect(all.tracked).toBeGreaterThan(2000);
    expect(all.text.length).toBeGreaterThan(80_000);
  });

  test('the three display modes disagree, which is the point', () => {
    const all = project(body, 'all-markup').text.length;
    const proposed = project(body, 'proposed').text.length;
    const original = project(body, 'original').text.length;
    // Accepting removes the deletions; rejecting removes the insertions. Both are strictly
    // shorter than the markup view, and they differ from each other.
    expect(proposed).toBeLessThan(all);
    expect(original).toBeLessThan(all);
    expect(proposed).not.toBe(original);
  });

  test('a deletion nested inside another author’s insertion projects both attributions', () => {
    // Not a contrived case: this is what a second review round produces, and it is the
    // direction real files take — someone deletes part of an earlier author's insertion.
    const nested = project(body, 'all-markup').nested;
    expect(nested.length).toBeGreaterThan(0);
    const authors = nested[0]!.map((revision) => `${revision.kind}:${revision.author}`);
    expect(authors).toEqual(['insert:Author', 'delete:John Doe']);
  });

  test('containment governs: the nested pair vanishes from both resolved modes', () => {
    // The inner deletion is accepted away in the proposed result; the outer insertion is
    // rejected away in the original. Neither mode shows it, for opposite reasons.
    expect(project(body, 'proposed').nested).toEqual([]);
    expect(project(body, 'original').nested).toEqual([]);
  });

  test('a header story-level revision is typed and descended, and adds no text of its own', () => {
    // Worth stating precisely, because the raw count of five `w:ins` in `header3.xml` is
    // misleading: two mark paragraph marks (property position, deliberately generic), two wrap
    // a PAGE field inside a drawing's textbox — content this engine does not flow yet — and
    // the one at story level wraps the drawing itself. So the correct expectation is a typed
    // wrapper contributing zero characters, not tracked text.
    const header = partOf('list-pagination-break.docx', '/word/header3.xml');
    const blocks = storyBlocks(header).filter((block) => block.kind === 'paragraph');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.children.map((child) => child.kind)).toContain('revisionInsert');
    expect(project(header, 'all-markup').text).toBe('');
  });

  test('layout offsets stay inside the op offset space on every paragraph', () => {
    // The invariant that keeps the caret on the character under the pointer: layout may show
    // FEWER characters than the model holds (a suppressed revision, hidden text), never more,
    // and never at an offset the ops cannot address.
    for (const block of storyBlocks(body)) {
      if (block.kind !== 'paragraph') continue;
      const modelText = paragraphTextOf(body, block.id) ?? '';
      for (const piece of piecesOfParagraph(
        block,
        [],
        undefined,
        undefined,
        undefined,
        'all-markup'
      )) {
        if (piece.projected) continue;
        expect(piece.end).toBeLessThanOrEqual(modelText.length);
        expect(modelText.slice(piece.start, piece.end)).toBe(piece.text);
      }
    }
  });
});

describe('issue-319-sections.docx', () => {
  test('revisions in a footer story are projected', () => {
    const footer = partOf('issue-319-sections.docx', '/word/footer1.xml');
    expect(project(footer, 'all-markup').tracked).toBeGreaterThan(0);
  });

  test('w:delInstrText is never laid out as ordinary text', () => {
    // Deleted FIELD INSTRUCTIONS are not content in any view. This fixture carries them in
    // both the body and a footer.
    const footer = partOf('issue-319-sections.docx', '/word/footer1.xml');
    expect(project(footer, 'all-markup').text).not.toContain('PAGE');
  });
});

describe('endnotes-tracked-changes.docx', () => {
  test('a revision inside a note part is typed, even though note bodies are not stories yet', () => {
    // `document.xml` has zero revisions here; the only one lives in `endnotes.xml`. Typing is
    // part-agnostic, so the wrapper and its run are already reachable. LAYOUT of note bodies
    // is a separate lane — `storyBlocks` recognizes the body and header/footer roots only —
    // so this asserts the tree, not the projection, and will strengthen when notes land.
    const endnotes = partOf('endnotes-tracked-changes.docx', '/word/endnotes.xml');
    let insertions = 0;
    const walk = (node: (typeof endnotes)['root'] | { kind: 'textValue' }): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'revisionInsert') insertions += 1;
      for (const child of node.children) walk(child);
    };
    walk(endnotes.root);
    expect(insertions).toBe(1);
    expect(storyBlocks(endnotes)).toEqual([]);
  });
});
