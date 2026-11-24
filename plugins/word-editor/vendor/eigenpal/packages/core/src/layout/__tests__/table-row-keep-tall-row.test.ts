// Keeps beside a `w:cantSplit` row that is taller than a page (§17.3.1.15, §17.4.6).
//
// Below other content, such a row moves to a fresh page and splits there. A `w:keepNext`
// paragraph before the table, a chain of them, or a kept row before it, cannot stay beside
// it anywhere: the kept content moves to the next page once, and the row starts on the page
// after it. That holds for one row or several, for a header row that is taller than a page,
// and in compatibility modes 14 and 15. Content that already opens its page stays there.
//
// Authored header rows above such a row do not hold it, also when they open the page: the
// row starts on the next page. Compatibility mode 14 repeats the header rows above it there;
// mode 15 gives the row that whole page and repeats them on the page after. In mode 15,
// header rows keep with the first body row (and a kept group that opens the body), so header
// rows below other content move to the next page first.
//
// The page shapes come from captured probes. The fixture page holds twelve 14pt lines; a
// 14-line row is taller than it.

import { describe, expect, test } from 'bun:test';
import { TreeDocumentStore } from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import {
  lay,
  load,
  measurer,
  P8,
  pages,
  para,
  row,
  styleCascade,
  table,
  TAIL,
} from './table-row-keep-fixtures.ts';

const CAP = para('CAP', 1, { keep: true });
/** A `w:cantSplit` row of `lines` first-cell lines; 14 lines are taller than a page. */
const tall = (name: string, lines = 14, options: { header?: boolean; cantSplit?: boolean } = {}) =>
  row(name, { lines, cantSplit: options.cantSplit ?? true, header: options.header });

/** The page, from 1, that holds `text`. */
const pageOf = (placed: readonly string[], text: string): number =>
  placed.findIndex((page) => page.split(' ').includes(text)) + 1;

const MODES = [14, 15] as const;

describe('kept content before a cantSplit row taller than a page', () => {
  for (const mode of MODES) {
    test(`mode ${mode}: a caption before a one-row table moves to the next page`, () => {
      const placed = pages(lay(load(P8 + CAP + table([tall('R1')]) + TAIL), mode));
      expect(pageOf(placed, 'P8')).toBe(1);
      expect(pageOf(placed, 'CAP1')).toBe(2);
      expect(pageOf(placed, 'R1c1-1')).toBe(3);
      expect(placed[1]).toBe('CAP1');
    });

    test(`mode ${mode}: a caption before a two-row table moves to the next page`, () => {
      const placed = pages(lay(load(P8 + CAP + table([tall('R1'), row('R2')]) + TAIL), mode));
      expect(pageOf(placed, 'CAP1')).toBe(2);
      expect(pageOf(placed, 'R1c1-1')).toBe(3);
    });

    test(`mode ${mode}: a chain of two kept paragraphs moves to the next page`, () => {
      const chain = para('CAPA', 1, { keep: true }) + para('CAPB', 1, { keep: true });
      const placed = pages(lay(load(P8 + chain + table([tall('R1')]) + TAIL), mode));
      expect(placed[1]).toBe('CAPA1 CAPB1');
      expect(pageOf(placed, 'R1c1-1')).toBe(3);
    });

    test(`mode ${mode}: a kept row before the tall row moves to the next page`, () => {
      const body = P8 + table([row('K', { keep: [true, true] }), tall('R1')]) + TAIL;
      const placed = pages(lay(load(body), mode));
      expect(pageOf(placed, 'P8')).toBe(1);
      expect(placed[1]).toBe('Kc1-1 Kc2-1');
      expect(pageOf(placed, 'R1c1-1')).toBe(3);
    });

    test(`mode ${mode}: a caption before a header row taller than a page moves`, () => {
      const body = P8 + CAP + table([tall('H', 14, { header: true })]) + TAIL;
      const placed = pages(lay(load(body), mode));
      expect(placed[1]).toBe('CAP1');
      expect(pageOf(placed, 'Hc1-1')).toBe(3);
    });

    test(`mode ${mode}: a caption at the page top stays and the row starts the next page`, () => {
      const placed = pages(lay(load(CAP + table([tall('R1')]) + TAIL), mode));
      expect(placed[0]).toBe('CAP1');
      expect(pageOf(placed, 'R1c1-1')).toBe(2);
      expect(pageOf(placed, 'TAIL1')).toBe(placed.length);
    });

    test(`mode ${mode}: a caption stays beside a tall row that may split`, () => {
      const body = P8 + CAP + table([tall('R1', 14, { cantSplit: false })]) + TAIL;
      const placed = pages(lay(load(body), mode));
      expect(pageOf(placed, 'CAP1')).toBe(1);
      expect(pageOf(placed, 'R1c1-1')).toBe(1);
    });

    test(`mode ${mode}: a caption moves with a cantSplit row that fits a page`, () => {
      const placed = pages(lay(load(P8 + CAP + table([tall('R1', 6)]) + TAIL), mode));
      expect(placed[1]!.startsWith('CAP1 R1c1-1')).toBe(true);
    });
  }
});

describe('authored header rows before a cantSplit row taller than a page', () => {
  const HEAD = row('H', { header: true });
  const HEADER = 'Hc1-1 Hc2-1';

  test('mode 15: the header rows move, and the row opens the next page without a repeat', () => {
    const placed = pages(lay(load(P8 + table([HEAD, tall('R1')]) + TAIL), 15));
    expect(placed[0]).toBe('P1 P2 P3 P4 P5 P6 P7 P8');
    expect(placed[1]).toBe(HEADER);
    expect(placed[2]!.startsWith('R1c1-1')).toBe(true);
    // The repeat returns on the page where the row continues.
    expect(placed[3]!.startsWith(`${HEADER} R1c1-`)).toBe(true);
  });

  test('mode 15: a tall row after a row that splits opens its page without a repeat', () => {
    // The ordinary 20-line row splits across pages 1 and 2, below the header rows each time.
    const body = table([HEAD, row('O', { lines: 20 }), tall('R1')]) + TAIL;
    const placed = pages(lay(load(body), 15));
    expect(placed[0]!.startsWith(`${HEADER} Oc1-1`)).toBe(true);
    expect(placed[1]!.startsWith(`${HEADER} Oc1-`)).toBe(true);
    expect(placed[2]!.startsWith('R1c1-1')).toBe(true);
    expect(placed[3]!.startsWith(`${HEADER} R1c1-`)).toBe(true);
  });

  test('mode 15: the tall-row page and the exact last row page both omit the repeat', () => {
    // A 155pt exact last row fits below a 14pt repeat in the 170pt band only without its
    // 1.5pt bottom rule, so that page omits the repeat too; without borders it keeps it.
    const BORDERS =
      '<w:tblBorders>' +
      ['top', 'left', 'bottom', 'right']
        .map((side) => `<w:${side} w:val="single" w:sz="12"/>`)
        .join('') +
      '</w:tblBorders>';
    const rows = [HEAD, tall('R1'), row('X', { cantSplit: true, exactTwips: 3100 })];
    const layOut = (tblPr: string) =>
      pages(lay(load(P8 + table(rows, tblPr) + TAIL), 15)).map((page) => page.split(' '));
    for (const [tblPr, terminalRepeat] of [
      [BORDERS, false],
      ['', true],
    ] as const) {
      const placed = layOut(tblPr);
      const start = placed.findIndex((page) => page.includes('R1c1-1'));
      expect(placed[start]![0]).toBe('R1c1-1');
      expect(placed[start + 1]!.slice(0, 2)).toEqual(['Hc1-1', 'Hc2-1']);
      const last = placed.findIndex((page) => page.includes('Xc1-1'));
      expect(last).toBeGreaterThan(start + 1);
      expect(placed[last]![0] === 'Hc1-1').toBe(terminalRepeat);
    }
  });

  test('mode 15: the header rows and a kept first body row move before the tall row', () => {
    const body = P8 + table([HEAD, row('K', { keep: [true, true] }), tall('R1')]) + TAIL;
    const placed = pages(lay(load(body), 15));
    expect(placed[0]).toBe('P1 P2 P3 P4 P5 P6 P7 P8');
    expect(placed[1]).toBe(`${HEADER} Kc1-1 Kc2-1`);
    expect(placed[2]!.startsWith('R1c1-1')).toBe(true);
  });

  test('mode 14: header rows and a kept first body row stay, and the kept row moves', () => {
    const body = P8 + table([HEAD, row('K', { keep: [true, true] }), tall('R1')]) + TAIL;
    const placed = pages(lay(load(body), 14));
    expect(placed[0]).toBe(`P1 P2 P3 P4 P5 P6 P7 P8 ${HEADER}`);
    expect(placed[1]).toBe(`${HEADER} Kc1-1 Kc2-1`);
    expect(placed[2]!.startsWith(`${HEADER} R1c1-1`)).toBe(true);
  });

  test('mode 14: the header rows stay, and the row starts below their repeat', () => {
    const placed = pages(lay(load(P8 + table([HEAD, tall('R1')]) + TAIL), 14));
    expect(placed[0]).toBe(`P1 P2 P3 P4 P5 P6 P7 P8 ${HEADER}`);
    expect(placed[1]!.startsWith(`${HEADER} R1c1-1`)).toBe(true);
  });

  for (const mode of MODES) {
    test(`mode ${mode}: header rows at the page top stay there alone`, () => {
      const placed = pages(lay(load(table([HEAD, tall('R1')]) + TAIL), mode));
      expect(placed[0]).toBe(HEADER);
      // Mode 14 repeats the header rows above the row; mode 15 gives the row the whole page.
      expect(placed[1]!.startsWith(mode === 14 ? `${HEADER} R1c1-1` : 'R1c1-1')).toBe(true);
    });
  }

  test('mode 15: a caption, the header rows, and the row each start a page', () => {
    const placed = pages(lay(load(P8 + CAP + table([HEAD, tall('R1')]) + TAIL), 15));
    expect(placed.slice(1, 3)).toEqual(['CAP1', HEADER]);
    expect(pageOf(placed, 'R1c1-1')).toBe(4);
  });

  test('mode 14: a caption keeps with the header rows only', () => {
    const placed = pages(lay(load(P8 + CAP + table([HEAD, tall('R1')]) + TAIL), 14));
    expect(placed[0]).toBe(`P1 P2 P3 P4 P5 P6 P7 P8 CAP1 ${HEADER}`);
    expect(pageOf(placed, 'R1c1-1')).toBe(2);
  });
});

describe('retained layout', () => {
  type Node = { readonly kind: string; readonly id?: string; readonly children?: readonly Node[] };
  const paragraphId = (node: Node, text: string): string | undefined => {
    if (node.kind === 'paragraph' && JSON.stringify(node).includes(`"${text}`)) return node.id;
    for (const child of node.children ?? []) {
      const found = paragraphId(child, text);
      if (found) return found;
    }
    return undefined;
  };

  for (const mode of MODES) {
    test(`mode ${mode}: growing a row past a page moves the caption, and shrinking returns it`, () => {
      const store = new TreeDocumentStore(load(P8 + CAP + table([tall('R1', 6)]) + TAIL));
      const session = createLayoutSession();
      const layOut = (revision: number) =>
        pages(
          layoutSemanticDocument(store.part, revision, {
            measurer,
            styleCascade,
            compatibilityMode: mode,
            session,
          })
        );
      expect(pageOf(layOut(1), 'CAP1')).toBe(2);
      const id = paragraphId(store.part.root as unknown as Node, 'R1c1-1')!;
      // Eight wrapped lines of 25 characters make the six-line row taller than a page.
      const GROWTH = 'wwww '.repeat(40);
      const edit = (grow: boolean) =>
        store.transact((tx) => {
          tx.apply(
            grow
              ? { op: 'insertText', paragraphId: id, offset: 0, text: GROWTH }
              : { op: 'deleteText', paragraphId: id, start: 0, end: GROWTH.length }
          );
        }).ok;
      expect(edit(true)).toBe(true);
      const grown = layOut(2);
      expect(grown).toEqual(pages(lay(structuredClone(store.part), mode)));
      expect(grown[1]).toBe('CAP1');
      expect(edit(false)).toBe(true);
      const shrunk = layOut(3);
      expect(shrunk).toEqual(pages(lay(structuredClone(store.part), mode)));
      expect(pageOf(shrunk, 'CAP1')).toBe(2);
      expect(pageOf(shrunk, 'R1c1-1')).toBe(2);
    });
  }
});
