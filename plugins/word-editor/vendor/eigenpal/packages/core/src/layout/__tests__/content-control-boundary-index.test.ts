// Indexed content-control boundary generation: exact page records, identity reuse, and
// deterministic resource bounds under attacker-controlled control/span counts.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  attachContentControlBoundaries,
  createFixedMeasurer,
  layoutSemanticDocument,
  type ContentControlBoundaryWork,
} from '../semantic-layout.ts';
import type { PageGeometry, SemanticLayout } from '../semantic-records.ts';
import { MAX_CONTENT_CONTROL_NESTING } from '../../store/package/content-control-walk.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(1, 10);
const geometry: PageGeometry = {
  width: 20_020,
  height: 20_020,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

// 22 half-points = 11pt, the size the fixed measurer's base advance describes, so exact
// coordinate assertions stay whole numbers regardless of the engine's default font size.
const run = (text: string) => `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r>`;
const paragraph = (content: string) => `<w:p>${content}</w:p>`;
const control = (alias: string, content: string) =>
  `<w:sdt><w:sdtPr><w:alias w:val="${alias}"/></w:sdtPr>` +
  `<w:sdtContent>${content}</w:sdtContent></w:sdt>`;

function emptyWork(): ContentControlBoundaryWork {
  return {
    geometryEntries: 0,
    blockLookups: 0,
    blockCandidates: 0,
    paragraphLookups: 0,
    spanCandidates: 0,
    pageFragments: 0,
  };
}

function indexedAgain(
  part: OoxmlPart,
  layout: SemanticLayout
): {
  readonly result: SemanticLayout;
  readonly work: ContentControlBoundaryWork;
} {
  const work = emptyWork();
  return {
    result: attachContentControlBoundaries(layout, part, layout.controlContextToken, work),
    work,
  };
}

describe('content-control boundary indexes', () => {
  test('a document without controls skips the page-geometry index', () => {
    const part = load(Array.from({ length: 100 }, () => paragraph(run('plain'))).join(''));
    const layout = layoutSemanticDocument(part, 1, { measurer, geometry });
    const { result, work } = indexedAgain(part, layout);

    expect(result).toBe(layout);
    expect(work.geometryEntries).toBe(0);
    expect(work.blockLookups).toBe(0);
    expect(work.paragraphLookups).toBe(0);
  });

  test('an empty inline range keeps exact caret geometry at a span boundary', () => {
    const part = load(paragraph(`${run('ab')}${control('empty', '')}${run('cd')}`));
    const layout = layoutSemanticDocument(part, 1, { measurer, geometry });
    const boundary = layout.contentControls![0]!;

    expect(boundary.fragments).toHaveLength(1);
    expect(boundary.fragments[0]!.box).toMatchObject({ x: 2, width: 0, height: 10 });
    expect(layout.pages[0]!.contentControls?.[0]?.fragments).toEqual(boundary.fragments);
  });

  test('many sibling inline controls use bounded paragraph-range queries', () => {
    const count = 1_024;
    const body = paragraph(
      Array.from({ length: count }, (_, index) => control(`i${index}`, run('x'))).join('')
    );
    const part = load(body);
    const layout = layoutSemanticDocument(part, 1, { measurer, geometry });
    const { result, work } = indexedAgain(part, layout);

    expect(result).toBe(layout);
    expect(layout.contentControls).toHaveLength(count);
    expect(layout.contentControls!.map((entry) => entry.alias)).toEqual(
      Array.from({ length: count }, (_, index) => `i${index}`)
    );
    expect(work.paragraphLookups).toBe(count);
    expect(work.blockLookups).toBe(0);
    // Includes binary-search probes plus matching/terminating candidates. This pins
    // O(controls * log(spans) + intersecting spans), not the former controls * spans scan.
    const perQueryBound = Math.ceil(Math.log2(count + 1)) + 3;
    expect(work.spanCandidates).toBeLessThanOrEqual(count * perQueryBound);
    expect(work.geometryEntries).toBeLessThanOrEqual(count + 2);
    expect(work.pageFragments).toBe(count);
    expect(layout.pages[0]!.contentControls?.map((entry) => entry.id)).toEqual(
      layout.contentControls!.map((entry) => entry.id)
    );
  });

  test('many sibling block controls visit only their indexed block fragments', () => {
    const count = 1_024;
    const part = load(
      Array.from({ length: count }, (_, index) => control(`b${index}`, paragraph(run('x')))).join(
        ''
      )
    );
    const layout = layoutSemanticDocument(part, 1, { measurer, geometry });
    const { result, work } = indexedAgain(part, layout);

    expect(result).toBe(layout);
    expect(layout.contentControls).toHaveLength(count);
    expect(work.blockLookups).toBe(count);
    expect(work.blockCandidates).toBe(count);
    expect(work.paragraphLookups).toBe(0);
    expect(work.geometryEntries).toBeLessThanOrEqual(count * 2);
    expect(work.pageFragments).toBe(count);
  });

  test('nested records preserve outer-first ordering and exact shared geometry', () => {
    const nesting = 12;
    let nested = paragraph(run('bounded'));
    for (let depth = 0; depth < nesting; depth += 1) {
      nested = control(`depth-${depth}`, nested);
    }
    const part = load(nested);
    const layout = layoutSemanticDocument(part, 1, { measurer, geometry });
    const { result, work } = indexedAgain(part, layout);

    expect(result).toBe(layout);
    expect(layout.contentControls).toHaveLength(nesting);
    expect(layout.contentControls!.map((entry) => entry.nestingDepth)).toEqual(
      Array.from({ length: nesting }, (_, index) => index)
    );
    expect(layout.pages[0]!.contentControls?.map((entry) => entry.id)).toEqual(
      layout.contentControls!.map((entry) => entry.id)
    );
    expect(work.blockCandidates).toBe(nesting);
    expect(
      new Set(layout.contentControls!.map((entry) => JSON.stringify(entry.fragments))).size
    ).toBe(1);
  });

  test('controls beyond the shared nesting limit remain opaque', () => {
    let nested = paragraph(run('hidden'));
    for (let depth = 0; depth < MAX_CONTENT_CONTROL_NESTING + 4; depth += 1) {
      nested = control(`depth-${depth}`, nested);
    }
    const part = load(nested);
    const layout = layoutSemanticDocument(part, 1, { measurer, geometry });
    const { work } = indexedAgain(part, layout);

    expect(layout.contentControls!.length).toBeLessThanOrEqual(MAX_CONTENT_CONTROL_NESTING);
    expect(layout.contentControls!.every((entry) => entry.fragments.length === 0)).toBe(true);
    expect(layout.pages.every((page) => (page.contentControls?.length ?? 0) === 0)).toBe(true);
    expect(work.blockCandidates).toBe(0);
  });
});
