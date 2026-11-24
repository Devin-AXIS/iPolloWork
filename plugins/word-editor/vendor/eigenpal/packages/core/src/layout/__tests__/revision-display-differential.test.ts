// The differential that ties the display modes to accept/reject.
//
// Specifying the resolved modes as equal to accept-all and reject-all OUTPUT is what makes them
// checkable without either one mutating anything. It also checks the two implementations against
// each other: the layout projection suppresses by containment, the op rebuilds the tree, and if
// they ever disagree about what a revision means, this fails rather than shipping a "show final"
// view that differs from what accepting would actually produce.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  applyTreeOp,
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  readOoxmlPart,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** Laid-out text per line, which is what a reader actually sees. */
function laidOut(part: OoxmlPart, mode: RevisionDisplayMode = 'all-markup'): string[] {
  return linesOf(layoutSemanticDocument(part, 1, { measurer, displayMode: mode })).map((line) =>
    line.spans.map((span) => span.text).join('')
  );
}

function resolveAll(part: OoxmlPart, action: 'accept' | 'reject'): OoxmlPart {
  const result = applyTreeOp(part, {
    op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const delRun = (text: string) => `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;
const ins = (id: string, inner: string) =>
  `<w:ins w:id="${id}" w:author="QA" w:date="2026-03-26T11:00:00Z">${inner}</w:ins>`;
const del = (id: string, inner: string) =>
  `<w:del w:id="${id}" w:author="Dev" w:date="2026-03-26T12:00:00Z">${inner}</w:del>`;

/** Insertions, deletions, a nested pair, and enough text to wrap across several lines. */
const MIXED =
  `<w:p>${run('The quick brown fox ')}${ins('1', run('very quickly '))}` +
  `${del('2', delRun('slowly '))}${run('jumps over the lazy dog.')}</w:p>` +
  `<w:p>${del('3', ins('4', run('a second round of review ')))}${run('remains.')}</w:p>` +
  `<w:p>${ins('5', run('an entirely inserted paragraph of text goes here'))}</w:p>`;

describe('display modes equal what resolving would produce', () => {
  test('the proposed result equals the layout after accept-all', () => {
    const part = load(MIXED);
    expect(laidOut(part, 'proposed')).toEqual(laidOut(resolveAll(part, 'accept')));
  });

  test('the original equals the layout after reject-all', () => {
    const part = load(MIXED);
    expect(laidOut(part, 'original')).toEqual(laidOut(resolveAll(part, 'reject')));
  });

  test('the two resolved views differ, so the test is not passing vacuously', () => {
    const part = load(MIXED);
    expect(laidOut(part, 'proposed')).not.toEqual(laidOut(part, 'original'));
    expect(laidOut(part, 'all-markup')).not.toEqual(laidOut(part, 'proposed'));
  });

  test('viewing a mode leaves the package fingerprint-identical', () => {
    const part = load(MIXED);
    const before = canonicalOoxmlFingerprint(part);
    laidOut(part, 'proposed');
    laidOut(part, 'original');
    expect(canonicalOoxmlFingerprint(part)).toBe(before);
    // Resolving, by contrast, is supposed to change the document.
    expect(canonicalOoxmlFingerprint(resolveAll(part, 'accept'))).not.toBe(before);
  });

  test('resolving is idempotent: nothing is left to resolve afterwards', () => {
    const accepted = resolveAll(load(MIXED), 'accept');
    const again = applyTreeOp(accepted, { op: 'acceptAllRevisions' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('unknown-revision');
  });
});

describe('the differential holds on a real document', () => {
  const FIXTURE = resolvePath(
    import.meta.dir,
    '../../../../../e2e/fixtures/issue-319-sections.docx'
  );

  function bodyPart(): OoxmlPart {
    const pkg = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
    if (!pkg.ok) throw new Error(pkg.reason);
    const part = pkg.package.parts.get('/word/document.xml');
    if (!part) throw new Error('no document part');
    return part;
  }

  /** What a reader reads, ignoring where the lines happen to break. */
  const readingText = (lines: readonly string[]): string => lines.join('');

  test('proposed content equals accept-all content across 85 insertions and 106 deletions', () => {
    const part = bodyPart();
    expect(readingText(laidOut(part, 'proposed'))).toBe(
      readingText(laidOut(resolveAll(part, 'accept')))
    );
  });

  test('original content equals reject-all content on the same document', () => {
    const part = bodyPart();
    expect(readingText(laidOut(part, 'original'))).toBe(
      readingText(laidOut(resolveAll(part, 'reject')))
    );
  });

  test('the projection agrees LINE FOR LINE, not only on what the words are', () => {
    // This was a documented gap: accepting a deleted paragraph mark merges the paragraph with
    // the next one, and the op did that while the projection left an empty block behind. It
    // closed when block-level projection landed — a paragraph whose mark is struck and which
    // renders nothing in the proposed result is now dropped from the flow rather than kept as
    // a blank line. Asserting the LINE ARRAY rather than the joined text is what keeps it
    // closed: a content-only comparison would pass with the blank lines back.
    const part = bodyPart();
    expect(laidOut(part, 'proposed')).toEqual(laidOut(resolveAll(part, 'accept')));
  });
});

// Section addressing and the block list are ONE list.
//
// `blockStart` / `blockEndExclusive` index into `storyBlocks`, and that list changes shape with
// the display mode: `proposed` drops a paragraph whose mark AND content a revision removed.
// Enumerating sections over the unfiltered list and then slicing the filtered one lands body
// text under another section's page geometry. The comment above `revisionRemovesParagraph`
// predicted exactly this before it happened.
describe('sections are addressed in the mode the blocks were filtered in', () => {
  const A5_PORTRAIT = '<w:pgSz w:w="8391" w:h="11906"/>';
  const LETTER_LANDSCAPE = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>';
  /** A paragraph the proposed view removes: its mark is struck and its content is deleted. */
  const REMOVED =
    `<w:p><w:pPr><w:rPr><w:del w:id="90" w:author="QA" w:date="D"/></w:rPr></w:pPr>` +
    `${del('91', delRun('gone'))}</w:p>`;
  const part = load(
    `${REMOVED}` +
      `<w:p><w:pPr><w:sectPr>${A5_PORTRAIT}</w:sectPr></w:pPr>${run('first section')}</w:p>` +
      `<w:p>${run('second section')}</w:p>` +
      `<w:sectPr>${LETTER_LANDSCAPE}</w:sectPr>`
  );

  test('the second section keeps its own page size in the proposed view', () => {
    const layout = layoutSemanticDocument(part, 1, { measurer, displayMode: 'proposed' });
    const pageOf = (text: string): (typeof layout.pages)[number] | undefined =>
      layout.pages.find((page) =>
        page.fragments.some(
          (fragment) =>
            fragment.kind === 'paragraph' &&
            fragment.lines.some((line) =>
              line.spans
                .map((span) => span.text)
                .join('')
                .includes(text)
            )
        )
      );
    // A5 portrait is 8391 twips wide; Letter landscape is 15840. Sliced with unfiltered
    // indices, "second section" fell inside the FIRST section's range and paginated onto A5.
    expect(pageOf('first section')?.box.width).toBeCloseTo(8391 / 20, 5);
    expect(pageOf('second section')?.box.width).toBeCloseTo(15840 / 20, 5);
  });

  test('all-markup, where nothing is filtered, agrees with it', () => {
    const layout = layoutSemanticDocument(part, 1, { measurer, displayMode: 'all-markup' });
    const last = layout.pages[layout.pages.length - 1]!;
    expect(last.box.width).toBeCloseTo(15840 / 20, 5);
  });
});

// Nesting is the cheapest unbounded axis in a file an attacker wrote, so every walk over one
// is capped. The caps have to AGREE: two walks over the same tree with different limits means
// one of them is describing a document the other one is not.
describe('the emptiness test and the layout walk cap nesting at the same depth', () => {
  /** `w:ins` wrappers, `depth` deep, around one run of real text. */
  function nested(depth: number, inner: string): string {
    let markup = inner;
    for (let level = 0; level < depth; level += 1) {
      markup = `<w:ins w:id="${100 + level}" w:author="QA" w:date="D">${markup}</w:ins>`;
    }
    return markup;
  }

  test('a mark-deleted paragraph whose content is nested deeply still renders it', () => {
    const part = load(
      `<w:p><w:pPr><w:rPr><w:del w:id="99" w:author="QA" w:date="D"/></w:rPr></w:pPr>` +
        `${nested(12, run('deeply nested but visible'))}</w:p>`
    );
    // Below the layout walk's own limit, so layout emits these spans. At a local cap of 8 the
    // emptiness test called the paragraph empty, the block was dropped from the story, and
    // visible text left the page for no reason a reader could see.
    expect(laidOut(part, 'proposed').join('')).toContain('deeply nested but visible');
  });
});
