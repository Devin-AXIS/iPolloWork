// Bounded per-paragraph reads of one published layout.
//
// Range operations (delete, cut, copy, rectangle clears) ask about every paragraph they span.
// Answering each by scanning every page made them cost paragraphs × pages. These tests pin
// the bound, the identity of answers across the switch to the complete index, every story
// the index covers, and the merged-member reads copy uses beside it.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import {
  paragraphLinesFor,
  paragraphLinesIndex,
  paragraphLinesPageTraversals,
  type PlacedLine,
} from '../paragraph-lines.ts';
import { fragmentParagraphs, mergedPredecessorsOf } from '../line-segments.ts';
import { paragraphFragmentsOf, type SemanticLayout } from '../semantic-records.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const SMALL = { width: 120, height: 80, margin: { top: 10, bottom: 10, left: 10, right: 10 } };

function load(body: string, name = '/word/document.xml'): OoxmlPart {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name,
    contentType: 'app/xml',
  });
  if (!read.ok) throw Error(read.reason);
  return read.part;
}

const plain = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const marked = (text: string) =>
  `<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const lay = (part: OoxmlPart, displayMode: RevisionDisplayMode = 'all-markup') =>
  layoutSemanticDocument(part, 1, { measurer, geometry: SMALL, displayMode });

function paragraphIds(part: OoxmlPart): string[] {
  const found: string[] = [];
  const visit = (node: OoxmlPart['root'] | OoxmlPart['root']['children'][number]): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') found.push(node.id);
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return found;
}

const shape = (lines: readonly PlacedLine[] | undefined) =>
  (lines ?? []).map((placed) => `${placed.pageIndex}:${placed.line.id}`);

const MANY = Array.from({ length: 120 }, (_, index) => plain(`paragraph ${index}`)).join('');

describe('bulk paragraph reads', () => {
  test('reading every paragraph visits O(pages) pages, not paragraphs × pages', () => {
    const part = load(MANY);
    const ids = paragraphIds(part);
    const layout = lay(part);
    const pages = layout.pages.length;
    expect(pages).toBeGreaterThan(20);
    const before = paragraphLinesPageTraversals();
    for (const id of ids) paragraphLinesFor(layout, id);
    for (const id of ids) paragraphLinesFor(layout, id);
    const visited = paragraphLinesPageTraversals() - before;
    // At most the bounded lazy reads plus one complete build.
    expect(visited).toBeLessThanOrEqual(33 * pages);
    expect(visited).toBeLessThan((ids.length * pages) / 2);
  });

  test('answers before and after the switch are the index answers, one array per paragraph', () => {
    const part = load(MANY);
    const ids = paragraphIds(part);
    const layout = lay(part);
    const reference = paragraphLinesIndex(lay(part));
    const first = ids.map((id) => paragraphLinesFor(layout, id));
    for (const [index, id] of ids.entries()) {
      expect(shape(first[index])).toEqual(shape(reference.get(id)));
      expect(paragraphLinesFor(layout, id)).toBe(first[index]!);
      expect(paragraphLinesIndex(layout).get(id)).toBe(first[index] as PlacedLine[]);
    }
    expect(paragraphLinesFor(layout, 'absent')).toEqual([]);
  });

  test('a few reads stay lazy; the complete index is built only past the bound', () => {
    const part = load(MANY);
    const ids = paragraphIds(part);
    const layout = lay(part);
    const pages = layout.pages.length;
    const before = paragraphLinesPageTraversals();
    for (const id of ids.slice(0, 5)) paragraphLinesFor(layout, id);
    expect(paragraphLinesPageTraversals() - before).toBe(5 * pages);
  });
});

describe('every story the index covers', () => {
  /**
   * The body layout's pages, each carrying the SAME header and footer fragments (a shared
   * header paints on every sheet) and the first page a footnote area.
   */
  function withStories(): SemanticLayout {
    const body = lay(load(MANY));
    const header = lay(load(plain('Header text'), '/word/header1.xml')).pages[0]!.fragments;
    const footer = lay(load(plain('Footer text'), '/word/footer1.xml')).pages[0]!.fragments;
    const note = lay(load(plain('Note text'), '/word/footnotes.xml')).pages[0]!.fragments;
    return {
      ...body,
      pages: body.pages.map((page, index) => ({
        ...page,
        header: { ...(page.header ?? {}), fragments: header },
        footer: { ...(page.footer ?? {}), fragments: footer },
        ...(index === 0 ? { footnotes: { notes: [{ fragments: note }] } } : {}),
      })),
    } as unknown as SemanticLayout;
  }

  test('header, footer and note paragraphs read the same lines lazily and from the index', () => {
    const layout = withStories();
    const reference = paragraphLinesIndex(withStories());
    const stories = [...reference.keys()].filter((id) => !id.startsWith('/word/document.xml'));
    expect(stories.length).toBe(3);
    // Story reads first (lazy), then enough body reads to switch, then the stories again.
    const lazy = stories.map((id) => paragraphLinesFor(layout, id));
    for (const id of reference.keys()) paragraphLinesFor(layout, id);
    for (const [index, id] of stories.entries()) {
      expect(shape(lazy[index])).toEqual(shape(reference.get(id)));
      expect(paragraphLinesFor(layout, id)).toBe(lazy[index]!);
    }
    const header = stories.find((id) => id.startsWith('/word/header1.xml'))!;
    expect(paragraphLinesFor(layout, header).length).toBe(layout.pages.length);
  });
});

describe('merged predecessors', () => {
  /** The scan this memo replaced, kept as the oracle for exact semantics. */
  function scanned(layout: SemanticLayout, paragraphId: string): readonly string[] {
    for (const page of layout.pages) {
      for (const fragment of paragraphFragmentsOf(page)) {
        const at = fragmentParagraphs(fragment).indexOf(paragraphId);
        if (at > 0) return fragmentParagraphs(fragment).slice(0, at).reverse();
      }
    }
    return [];
  }

  test('a merged chain names its predecessors nearest first; ordinary paragraphs none', () => {
    const part = load(marked('One ') + marked('two ') + plain('three') + plain('four'));
    const [a, b, c, d] = paragraphIds(part);
    const layout = lay(part, 'proposed');
    expect(mergedPredecessorsOf(layout, c!)).toEqual([b!, a!]);
    expect(mergedPredecessorsOf(layout, b!)).toEqual([a!]);
    expect(mergedPredecessorsOf(layout, a!)).toEqual([]);
    expect(mergedPredecessorsOf(layout, d!)).toEqual([]);
    // A caller's copy is its own.
    (mergedPredecessorsOf(layout, c!) as string[]).push('changed');
    expect(mergedPredecessorsOf(layout, c!)).toEqual([b!, a!]);
    // All-markup draws every paragraph on its own; nothing is merged.
    expect(mergedPredecessorsOf(lay(part), c!)).toEqual([]);
  });

  for (const mode of ['proposed', 'original', 'all-markup'] as const) {
    test(`a long merged run across pages matches the page scan exactly (${mode})`, () => {
      const body =
        Array.from({ length: 30 }, (_, index) => marked(`member ${index} `.repeat(4))).join('') +
        plain('survivor') +
        Array.from({ length: 20 }, (_, index) => plain(`after ${index}`)).join('') +
        marked('second run ') +
        plain('second survivor');
      const part = load(body);
      const layout = lay(part, mode);
      const ids = paragraphIds(part);
      for (const id of [...ids, 'absent']) {
        expect(mergedPredecessorsOf(layout, id)).toEqual(scanned(lay(part, mode), id));
      }
      // The proposed view merges across many pages, and some members open a continuation
      // fragment at position 0; the other views merge nothing.
      const named = ids.filter((id) => mergedPredecessorsOf(layout, id).length > 0).length;
      const mergedPages = layout.pages.filter((page) =>
        paragraphFragmentsOf(page).some((fragment) => fragmentParagraphs(fragment).length > 1)
      ).length;
      if (mode === 'proposed') {
        expect(mergedPages).toBeGreaterThan(5);
        expect(named).toBeGreaterThan(10);
      } else expect(named).toBe(0);
    });
  }
});
