// WHAT ONE KEYSTROKE IS ALLOWED TO COST.
//
// The painter reuses a page by RECORD IDENTITY, so any lane that rebuilds a page object it
// did not change spends the whole visible document's DOM on every character typed — and
// replacing the nodes the browser's selection lives in is how a repaint came to move the
// caret. The notes lane did exactly that for any file carrying a footnotes part, which is
// nearly every file Word writes, even with no notes in it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const FN = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** Word writes both separators into a footnotes part even when nothing cites a note. */
const FOOTNOTES =
  `<w:footnotes xmlns:w="${W}">` +
  '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
  '<w:footnote w:type="continuationSeparator" w:id="0">' +
  '<w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
  '</w:footnotes>';

function docx(withNotesPart: boolean): Uint8Array {
  const body = Array.from({ length: 160 }, (_, index) => paragraph(`paragraph ${index}`)).join('');
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (withNotesPart
          ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        (withNotesPart ? `<Relationship Id="rId5" Type="${FN}" Target="footnotes.xml"/>` : '') +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  };
  if (withNotesPart) entries['word/footnotes.xml'] = strToU8(FOOTNOTES);
  return zipSync(entries);
}

/** Pages that survive one typed character by identity, and how many there are. */
function keptAcrossAKeystroke(withNotesPart: boolean): { total: number; kept: number } {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(withNotesPart), { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  const surface: PaginatedSurface = opened.surface;
  try {
    const before = new Set(surface.layout().pages);
    const last = surface.session.paragraphIds()[surface.session.paragraphIds().length - 1]!;
    surface.setSelection({
      anchor: { paragraphId: last, offset: 0 },
      head: { paragraphId: last, offset: 0 },
    });
    surface.type('x');
    const after = surface.layout().pages;
    return { total: after.length, kept: after.filter((page) => before.has(page)).length };
  } finally {
    surface.destroy();
    container.remove();
  }
}

describe('typing one character into a long document', () => {
  test('keeps the pages it did not change, notes part or not', () => {
    const withoutNotes = keptAcrossAKeystroke(false);
    const withNotes = keptAcrossAKeystroke(true);

    expect(withoutNotes.total).toBeGreaterThan(2);
    // Everything but the page the edit landed on survives.
    expect(withoutNotes.kept).toBe(withoutNotes.total - 1);
    // And a footnotes part with nothing in it costs nothing.
    expect(withNotes.total).toBe(withoutNotes.total);
    expect(withNotes.kept).toBe(withoutNotes.kept);
  });
});
