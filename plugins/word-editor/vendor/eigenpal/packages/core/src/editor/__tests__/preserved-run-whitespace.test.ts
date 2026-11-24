// A run written as `<w:r xml:space="preserve">` with its children on indented lines holds
// only a no-break space. The indentation is not content, so the run lays out, takes the
// caret, edits, undoes and saves exactly as the compact spelling of the same run does.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  diffSemanticDigests,
  readOoxmlPackage,
  semanticDigest,
} from '@docx-editor.dev/core/store';
import { linesOf } from '@docx-editor.dev/core/layout';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { docx } from './paginated-surface-fixtures.ts';

const NBSP = ' ';
const LABEL = '<w:r><w:t>(i)</w:t></w:r>';
const BODY_RUN = '<w:r><w:t>a b</w:t></w:r>';
const RUN_PROPERTIES = '<w:rPr><w:rFonts w:ascii="Sans"/></w:rPr>';
const INDENTED = `<w:p>${LABEL}<w:r xml:space="preserve">${RUN_PROPERTIES}\n\t\t\t<w:t>${NBSP}</w:t>\n\t\t</w:r>${BODY_RUN}</w:p>`;
const COMPACT = `<w:p>${LABEL}<w:r xml:space="preserve">${RUN_PROPERTIES}<w:t>${NBSP}</w:t></w:r>${BODY_RUN}</w:p>`;
const TEXT = `(i)${NBSP}a b`;

function mount(source: Uint8Array): PaginatedSurface {
  const result = mountPaginatedSurface(document.createElement('div'), source, { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.surface;
}

function firstParagraphText(surface: PaginatedSurface): string | null {
  return paragraphTextOf(surface.session.part(), surface.session.paragraphIds()[0]!);
}

function putCaret(surface: PaginatedSurface, offset: number): void {
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

function spanTexts(surface: PaginatedSurface): string[] {
  return linesOf(surface.layout()).flatMap((line) => line.spans.map((span) => span.text));
}

function spanGeometry(surface: PaginatedSurface) {
  return linesOf(surface.layout()).flatMap((line) =>
    line.spans.map((span) => ({ text: span.text, range: span.range, x: span.x, width: span.width }))
  );
}

describe('an indented run under xml:space="preserve"', () => {
  test('lays out its no-break space exactly as the compact spelling does', () => {
    const indented = mount(docx(INDENTED));
    const compact = mount(docx(COMPACT));
    expect(firstParagraphText(indented)).toBe(TEXT);
    expect(spanTexts(indented).join('')).toBe(TEXT);
    expect(spanTexts(indented)).toContain(NBSP);
    expect(spanGeometry(indented)).toEqual(spanGeometry(compact));
  });

  test('the caret steps across the no-break space and typing lands after it', () => {
    const surface = mount(docx(INDENTED));
    expect(surface.session.editable).toBe(true);
    putCaret(surface, 3);
    surface.navigate('right');
    expect(surface.state().selection.head.offset).toBe(4);
    surface.type('X');
    expect(firstParagraphText(surface)).toBe(`(i)${NBSP}Xa b`);
    surface.session.undo();
    expect(firstParagraphText(surface)).toBe(TEXT);
  });

  test('deleting the no-break space removes it and undo restores it', () => {
    const surface = mount(docx(INDENTED));
    putCaret(surface, 4);
    surface.deleteBackward();
    expect(firstParagraphText(surface)).toBe('(i)a b');
    surface.session.undo();
    expect(firstParagraphText(surface)).toBe(TEXT);
    expect(spanTexts(surface)).toContain(NBSP);
  });

  test('save and reopen keep the text, and both oracles agree', () => {
    const surface = mount(docx(INDENTED));
    const before = surface.session.part();
    const saved = surface.session.save();
    const reopened = readOoxmlPackage(saved);
    if (!reopened.ok) throw new Error(reopened.reason);
    const after = reopened.package.parts.get(reopened.package.mainDocumentPart)!;

    expect(canonicalOoxmlFingerprint(after)).toBe(canonicalOoxmlFingerprint(before));
    expect(diffSemanticDigests(semanticDigest([before]), semanticDigest([after]))).toEqual([]);
    expect(firstParagraphText(mount(saved))).toBe(TEXT);
  });
});
