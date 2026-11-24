// A word does not span a struck half (fixes the double-click over a tracked replacement).
//
// Word writes a replacement as a deletion immediately followed by an insertion, with no
// separator between them. In All Markup both halves paint, so the view's text reads
// `...ALL CAPSfsdfsd...` — and the word walk, which is a walk over exactly that text, took
// `CAPSfsdfsd` as one word. Double-clicking the struck text selected the proposed text with
// it, across a decision the reader had not taken.
//
// Deleted text is the one thing on screen that is not in the document the reader is heading
// towards: it is the other version, spliced in beside the proposal so the two can be compared.
// Its characters are not adjacent to their neighbours in any single version, so its edges stop
// a word. Everything else about the walk is unchanged, which the surviving-text cases pin.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  deletedTextBoundaries,
  paragraphTextFromLayout,
  wordBoundary,
} from '../../layout/semantic-interaction.ts';
import type { RevisionDisplayMode } from '../../layout/revision-projection.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { docx } from './paginated-surface-fixtures.ts';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const del = (text: string) =>
  '<w:del w:id="1" w:author="Ada" w:date="2026-01-01T00:00:00Z">' +
  `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
const ins = (text: string) =>
  '<w:ins w:id="2" w:author="Bea" w:date="2026-01-02T00:00:00Z">' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:ins>`;

function withSurface(
  body: string,
  visit: (surface: PaginatedSurface) => void,
  displayMode: RevisionDisplayMode = 'all-markup'
): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body), {
    revisionDisplayMode: displayMode,
  });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    visit(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

/** The word a double-click at `offset` selects — the pointer lane's own rule, spelled once. */
function wordAt(surface: PaginatedSurface, offset: number): string {
  const id = surface.session.paragraphIds()[0]!;
  const layout = surface.layout();
  const text = paragraphTextFromLayout(layout, id);
  const stops = deletedTextBoundaries(layout, id);
  return text.slice(
    wordBoundary(text, offset + 1, -1, stops),
    wordBoundary(text, offset, 1, stops)
  );
}

describe('word selection over a tracked replacement', () => {
  // `PS and ALL CAPSfsdfsd formatting.` — `ALL CAPS` struck, `fsdfsd` proposed.
  const REPLACEMENT = `<w:p>${run('PS and ')}${del('ALL CAPS')}${ins('fsdfsd')}${run(' formatting.')}</w:p>`;

  test('the struck word and the proposed word are two words', () => {
    withSurface(REPLACEMENT, (surface) => {
      expect(paragraphTextFromLayout(surface.layout(), surface.session.paragraphIds()[0]!)).toBe(
        'PS and ALL CAPSfsdfsd formatting.'
      );
      // Inside the struck text.
      expect(wordAt(surface, 12)).toBe('CAPS');
      // Inside the proposed text, which abuts it with no separator.
      expect(wordAt(surface, 18)).toBe('fsdfsd');
    });
  });

  test('a word inside the struck half does not reach the text before it either', () => {
    withSurface(REPLACEMENT, (surface) => {
      expect(wordAt(surface, 8)).toBe('ALL');
      expect(wordAt(surface, 4)).toBe('and');
    });
  });

  test('the word after the replacement is untouched', () => {
    withSurface(REPLACEMENT, (surface) => {
      expect(wordAt(surface, 23)).toBe('formatting');
    });
  });

  test('a deletion abutting surviving text on both sides is its own word', () => {
    // `AL` survives, `L` is struck, ` x` survives: three pieces, no space at the seam.
    withSurface(`<w:p>${run('AL')}${del('L')}${run(' x')}</w:p>`, (surface) => {
      expect(wordAt(surface, 0)).toBe('AL');
      expect(wordAt(surface, 2)).toBe('L');
    });
  });

  test('an insertion abutting surviving text stays ONE word', () => {
    // No deletion here, so no seam: `hel` plus proposed `lo` is the word `hello`, which is
    // what the reader sees and what a double-click should take.
    withSurface(`<w:p>${run('hel')}${ins('lo')}${run(' there')}</w:p>`, (surface) => {
      expect(wordAt(surface, 1)).toBe('hello');
      expect(wordAt(surface, 4)).toBe('hello');
    });
  });

  test('the resolved view has no seams at all', () => {
    // `proposed` paints no deletion, so there is nothing to stop a word — and the text it
    // walks has no struck half in it to run into.
    withSurface(
      REPLACEMENT,
      (surface) => {
        const id = surface.session.paragraphIds()[0]!;
        // The struck half pads rather than closing up, so offsets keep meaning what the
        // model says they mean — the documented rule for this reconstruction.
        expect(paragraphTextFromLayout(surface.layout(), id)).toBe(
          'PS and         fsdfsd formatting.'
        );
        expect([...deletedTextBoundaries(surface.layout(), id)]).toEqual([]);
        expect(wordAt(surface, 16)).toBe('fsdfsd');
      },
      'proposed'
    );
  });

  test('a moveFrom half stops a word the way a deletion does', () => {
    const moveFrom =
      '<w:moveFrom w:id="3" w:author="Ada" w:date="2026-01-01T00:00:00Z">' +
      '<w:r><w:delText xml:space="preserve">gone</w:delText></w:r></w:moveFrom>';
    withSurface(`<w:p>${run('a ')}${moveFrom}${run('here')}</w:p>`, (surface) => {
      expect(wordAt(surface, 3)).toBe('gone');
      expect(wordAt(surface, 7)).toBe('here');
    });
  });
});
