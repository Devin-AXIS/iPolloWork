// Editing around a no-break space that sits in its own run.
//
// The glue must hold through typing, undo and a save/reopen, and every one of those must
// keep the authored characters and runs: the caret addresses the U+00A0 as one UTF-16
// offset, and the retained layout after an edit agrees with a fresh open of the saved bytes.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  diffSemanticDigests,
  readOoxmlPackage,
  semanticDigest,
} from '@docx-editor.dev/core/store';
import { caretAt, createFixedMeasurer, linesOf } from '@docx-editor.dev/core/layout';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { docx, putCaret } from './paginated-surface-fixtures.ts';

const NBSP = '\u00a0';
const measurer = createFixedMeasurer(6, 14);
const run = (text: string, properties = '') =>
  `<w:r><w:rPr><w:sz w:val="22"/>${properties}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
// 96pt page with 18pt side margins: a 60pt measure, ten 6pt characters to a line.
const SECTION =
  '<w:sectPr><w:pgSz w:w="1920" w:h="4000"/>' +
  '<w:pgMar w:top="360" w:right="360" w:bottom="360" w:left="360" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
// "aa bbbb" + U+00A0 + "cc" exactly fills the first line; one more character in front of it
// must move "bbbb" + U+00A0 + "cc" to the next line together.
const BODY =
  `<w:p>${run('aa ')}${run('bbbb', '<w:b/>')}${run(NBSP, '<w:i/>')}${run('cc dd')}</w:p>` + SECTION;
const RUNS = ['aa ', 'bbbb', NBSP, 'cc dd'];

function open(bytes: Uint8Array): PaginatedSurface {
  const result = mountPaginatedSurface(document.createElement('div'), bytes, {
    scale: 1,
    measurer,
  });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.surface;
}

const lineTexts = (surface: PaginatedSurface): string[] => {
  const paragraphId = surface.session.paragraphIds()[0]!;
  return linesOf(surface.layout())
    .filter((line) => line.range.paragraphId === paragraphId)
    .map((line) => line.spans.map((span) => span.text).join(''));
};

const brokenAtGlue = (lines: readonly string[]) =>
  lines.some(
    (line, index) =>
      index + 1 < lines.length && (line.endsWith(NBSP) || lines[index + 1]!.startsWith(NBSP))
  );

/** Text of each run in the first body paragraph, read from the canonical tree. */
function runTexts(bytes: Uint8Array): string[] {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) throw new Error(read.reason);
  const body = read.package.parts.get(read.package.mainDocumentPart)!.root.children[0]!;
  const paragraph = body.children.find((child) => child.kind === 'paragraph')!;
  const textOf = (node: { kind: string; value?: string; children?: readonly unknown[] }): string =>
    node.kind === 'textValue'
      ? (node.value ?? '')
      : ((node.children ?? []) as never[]).map(textOf).join('');
  return paragraph.children.filter((child) => child.kind === 'run').map(textOf as never);
}

describe('a no-break space in its own run', () => {
  test('lays out glued to both neighbours and keeps its runs', () => {
    const surface = open(docx(BODY));
    expect(surface.session.editable).toBe(true);
    expect(lineTexts(surface)).toEqual([`aa bbbb${NBSP}cc `, 'dd']);
    expect(runTexts(surface.session.save())).toEqual(RUNS);
  });

  test('the caret steps over the glue one offset at a time on one line', () => {
    const surface = open(docx(BODY));
    const paragraphId = surface.session.paragraphIds()[0]!;
    const layout = surface.layout();
    const lineIds = [6, 7, 8].map(
      (offset) => caretAt(layout, { paragraphId, offset }, measurer)!.lineId
    );
    expect(new Set(lineIds).size).toBe(1);
    const xs = [6, 7, 8].map((offset) => caretAt(layout, { paragraphId, offset }, measurer)!.x);
    expect(xs[1]! - xs[0]!).toBeCloseTo(6, 5);
    expect(xs[2]! - xs[1]!).toBeCloseTo(6, 5);

    putCaret(surface, 6);
    surface.navigate('right');
    expect(surface.state().selection.head.offset).toBe(7);
    surface.navigate('right', true);
    const selection = surface.state().selection;
    expect([selection.anchor.offset, selection.head.offset]).toEqual([7, 8]);
  });

  test('typing reflows without breaking at the glue, and undo restores the layout', () => {
    const surface = open(docx(BODY));
    const original = surface.session.bodyText();
    const originalLines = lineTexts(surface);

    // One character in front pushes the glued group past the margin: it moves whole.
    putCaret(surface, 0);
    surface.type('x');
    expect(surface.session.bodyText()).toBe(`xaa bbbb${NBSP}cc dd`);
    const edited = lineTexts(surface);
    expect(brokenAtGlue(edited)).toBe(false);
    expect(edited).toEqual(['xaa ', `bbbb${NBSP}cc dd`]);
    // The retained layout agrees with a fresh open of the saved bytes.
    expect(lineTexts(open(surface.session.save()))).toEqual(edited);

    // Typing right after the glue lands in the paragraph text and stays glued.
    putCaret(surface, 9);
    surface.type('Z');
    expect(surface.session.bodyText()).toBe(`xaa bbbb${NBSP}Zcc dd`);
    expect(brokenAtGlue(lineTexts(surface))).toBe(false);
    expect(lineTexts(open(surface.session.save()))).toEqual(lineTexts(surface));

    surface.session.undo();
    surface.session.undo();
    expect(surface.session.bodyText()).toBe(original);
    expect(lineTexts(surface)).toEqual(originalLines);
    expect(runTexts(surface.session.save())).toEqual(RUNS);
  });

  test('an unedited save and reopen passes both fidelity oracles', () => {
    const surface = open(docx(BODY));
    const before = surface.session.part();
    const saved = surface.session.save();
    const reopened = readOoxmlPackage(saved);
    if (!reopened.ok) throw new Error(reopened.reason);
    const after = reopened.package.parts.get(reopened.package.mainDocumentPart)!;
    expect(canonicalOoxmlFingerprint(after)).toBe(canonicalOoxmlFingerprint(before));
    expect(diffSemanticDigests(semanticDigest([before]), semanticDigest([after]))).toEqual([]);
    expect(lineTexts(open(saved))).toEqual(lineTexts(surface));
  });
});
