// The caret moves freely through visible deleted content — Word's rule.
//
// All-markup shows the struck words, so the reader can put the caret between any two of
// them, character by character. What the caret space excludes is a deleted offset the
// display mode resolved AWAY: in the proposed result those characters paint nothing, and an
// offset-by-offset walk would stop at invisible positions. Keeping the tree valid is the
// WRITE path's job, not navigation's: an insert aimed inside a deletion relocates past it
// (`positionPastDeletion`, and the same rule in the store).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { caretStops, moveCaret, positionPastDeletion } from '../semantic-interaction.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
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

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const delRun = (text: string) => `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;
const del = (id: string, inner: string) =>
  `<w:del w:id="${id}" w:author="Dev" w:date="2026-03-26T11:00:00Z">${inner}</w:del>`;
const ins = (id: string, inner: string) =>
  `<w:ins w:id="${id}" w:author="QA" w:date="2026-03-26T11:00:00Z">${inner}</w:ins>`;

/** `AB` + deleted `CDE` + `FG` — model offsets 0..7, with 2..5 deleted. */
const MIXED = `<w:p>${run('AB')}${del('1', delRun('CDE'))}${run('FG')}</w:p>`;

const ALL = [0, 1, 2, 3, 4, 5, 6, 7];

function offsets(body: string, mode: RevisionDisplayMode = 'all-markup'): number[] {
  const layout = layoutSemanticDocument(load(body), 1, { measurer, displayMode: mode });
  return caretStops(layout).map((stop) => stop.position.offset);
}

describe('visible deleted content is fully navigable', () => {
  test('every offset of a shown deletion is a caret stop', () => {
    expect(offsets(MIXED)).toEqual(ALL);
  });

  test('inserted content stays fully addressable', () => {
    expect(offsets(`<w:p>${run('AB')}${ins('1', run('CDE'))}${run('FG')}</w:p>`)).toEqual(ALL);
  });

  test('a moveFrom is navigable exactly like a deletion', () => {
    const moved =
      `<w:p>${run('AB')}<w:moveFrom w:id="1" w:author="QA">` +
      `${delRun('CDE')}</w:moveFrom>${run('FG')}</w:p>`;
    expect(offsets(moved)).toEqual(ALL);
  });

  test('arrows step through struck text one character at a time', () => {
    const layout = layoutSemanticDocument(load(MIXED), 1, { measurer });
    const paragraphId = caretStops(layout)[0]!.position.paragraphId;
    expect(moveCaret(layout, { paragraphId, offset: 2 }, 'right')?.position.offset).toBe(3);
    expect(moveCaret(layout, { paragraphId, offset: 4 }, 'left')?.position.offset).toBe(3);
  });

  test('the ORIGINAL view lays deleted text out as live, so it stays navigable', () => {
    expect(offsets(MIXED, 'original')).toEqual(ALL);
  });

  test('the PROPOSED view paints no glyphs for the deletion, so its interior is skipped', () => {
    // 2 and 5 survive as the positions beside the (invisible) deletion; 3 and 4 would be
    // caret stops between characters nothing paints.
    expect(offsets(MIXED, 'proposed')).toEqual([0, 1, 2, 5, 6, 7]);
  });

  test('an unowned position still navigates instead of dying', () => {
    // In the proposed view offset 3 is not a stop. A caret can still be parked there — a
    // stale selection, a host call — and arrows resolve in the direction of travel.
    const layout = layoutSemanticDocument(load(MIXED), 1, {
      measurer,
      displayMode: 'proposed',
    });
    const paragraphId = caretStops(layout)[0]!.position.paragraphId;
    expect(moveCaret(layout, { paragraphId, offset: 3 }, 'right')?.position.offset).toBe(5);
    expect(moveCaret(layout, { paragraphId, offset: 3 }, 'left')?.position.offset).toBe(2);
  });

  test('a wholly deleted paragraph is navigable end to end', () => {
    expect(offsets(`<w:p>${del('1', delRun('all gone'))}</w:p>`)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  test('a deletion that wraps across lines keeps every interior stop', () => {
    const long = 'word '.repeat(40).trimEnd(); // 199 chars, wraps at the fixed 6pt advance
    const body = `<w:p>${run('AB ')}${del('1', delRun(long))}${run('YZ')}</w:p>`;
    const stops = offsets(body);
    for (const probe of [50, 100, 150]) expect(stops).toContain(probe);
  });

  test('nested revisions (ins wrapping del) walk the same way', () => {
    const nested =
      `<w:p>${run('AB')}${ins('1', del('2', delRun('CD')))}` +
      `${ins('3', del('4', delRun('EF')))}${run('GH')}</w:p>`;
    expect(offsets(nested)).toEqual(ALL.concat(8));
  });
});

describe('inserts relocate past the deletion the caret rests in', () => {
  const layout = layoutSemanticDocument(load(MIXED), 1, { measurer });
  const paragraphId = caretStops(layout)[0]!.position.paragraphId;

  test('an interior insertion point resolves to the region end', () => {
    expect(positionPastDeletion(layout, { paragraphId, offset: 3 })).toEqual({
      paragraphId,
      offset: 5,
    });
  });

  test('boundaries and live text stay where they are', () => {
    for (const offset of [0, 2, 5, 7]) {
      expect(positionPastDeletion(layout, { paragraphId, offset }).offset).toBe(offset);
    }
  });

  test('a wrapping deletion is one region, not one slice per line', () => {
    const long = 'word '.repeat(40).trimEnd();
    const body = `<w:p>${run('AB ')}${del('1', delRun(long))}${run('YZ')}</w:p>`;
    const wrapped = layoutSemanticDocument(load(body), 1, { measurer });
    const id = caretStops(wrapped)[0]!.position.paragraphId;
    // Mid-region, past the first wrap boundary: the answer is the TRUE end of the deletion,
    // never the nearest per-line slice edge.
    expect(positionPastDeletion(wrapped, { paragraphId: id, offset: 100 }).offset).toBe(
      3 + long.length
    );
  });
});
