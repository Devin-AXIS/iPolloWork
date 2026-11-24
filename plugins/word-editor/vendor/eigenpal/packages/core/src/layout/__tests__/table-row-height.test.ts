// `w:trHeight` / `w:hRule` (17.4.81): auto, atLeast, exact — parse + layout + pagination.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { MAX_TABLE_ROW_HEIGHT_PT, readTableStructure } from '../semantic-table.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function loadPart(bodyXml: string): OoxmlPart {
  const xml = `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`part read failed: ${result.reason}`);
  return result.part;
}

function tableNode(bodyXml: string): OoxmlElement {
  const part = loadPart(bodyXml);
  const found = part.root.children
    .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
    .find((child) => child.kind === 'table');
  if (!found) throw new Error('no table');
  return found as OoxmlElement;
}

function structureOf(bodyXml: string) {
  return readTableStructure(tableNode(bodyXml), 468, 0)!;
}

function layout(part: OoxmlPart) {
  return layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer() });
}

function allTables(result: ReturnType<typeof layout>): TableFragmentRecord[] {
  return result.pages.flatMap((page) =>
    page.fragments.filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
  );
}

// The measurer's 14pt line base describes an 11pt run, so cells author `w:sz="22"` rather
// than resolving to the 10pt terminal fallback (see `DEFAULT_RUN_STYLE`).
const p = (text: string) =>
  `<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc>${tcPr}${content}</w:tc>`;
const tr = (cells: string, trPr = '') => `<w:tr>${trPr}${cells}</w:tr>`;
const trHeight = (val: string, hRule?: string) =>
  hRule === undefined
    ? `<w:trPr><w:trHeight w:val="${val}"/></w:trPr>`
    : `<w:trPr><w:trHeight w:val="${val}" w:hRule="${hRule}"/></w:trPr>`;

describe('w:trHeight parse', () => {
  test('absent trHeight is auto', () => {
    const structure = structureOf(`<w:tbl>${tr(tc(p('x')))}</w:tbl>`);
    expect(structure.rows[0]!.height).toEqual({ rule: 'auto' });
  });

  test('explicit auto ignores val', () => {
    const structure = structureOf(`<w:tbl>${tr(tc(p('x')), trHeight('2840', 'auto'))}</w:tbl>`);
    expect(structure.rows[0]!.height).toEqual({ rule: 'auto' });
  });

  test('omitted hRule with val is atLeast (Word quirk; 14.2pt Form025U shape)', () => {
    // 284 twips = 14.2pt — the Form025U bare-val rows.
    const structure = structureOf(`<w:tbl>${tr(tc(p('x')), trHeight('284'))}</w:tbl>`);
    expect(structure.rows[0]!.height).toEqual({ rule: 'atLeast', valuePt: 14.2 });
  });

  test('explicit atLeast and exact resolve to points', () => {
    const atLeast = structureOf(`<w:tbl>${tr(tc(p('x')), trHeight('720', 'atLeast'))}</w:tbl>`);
    expect(atLeast.rows[0]!.height).toEqual({ rule: 'atLeast', valuePt: 36 });
    const exact = structureOf(`<w:tbl>${tr(tc(p('x')), trHeight('1440', 'exact'))}</w:tbl>`);
    expect(exact.rows[0]!.height).toEqual({ rule: 'exact', valuePt: 72 });
  });

  test('hostile and zero values demote to auto; oversized val clamps', () => {
    expect(
      structureOf(`<w:tbl>${tr(tc(p('x')), trHeight('0', 'atLeast'))}</w:tbl>`).rows[0]!.height
    ).toEqual({
      rule: 'auto',
    });
    expect(
      structureOf(`<w:tbl>${tr(tc(p('x')), trHeight('not-a-number', 'exact'))}</w:tbl>`).rows[0]!
        .height
    ).toEqual({ rule: 'auto' });
    expect(
      structureOf(`<w:tbl>${tr(tc(p('x')), trHeight('999999999', 'atLeast'))}</w:tbl>`).rows[0]!
        .height
    ).toEqual({ rule: 'atLeast', valuePt: MAX_TABLE_ROW_HEIGHT_PT });
  });
});

describe('w:trHeight layout', () => {
  test('atLeast floors a short content row without inventing the old 20pt pad', () => {
    // Fixed measurer: one line ≈ 14pt; tight tcMar keeps content under 14.2 without the floor.
    const part = loadPart(
      '<w:tbl>' +
        tr(
          tc(
            p('x'),
            '<w:tcPr><w:tcMar>' +
              '<w:top w:w="0" w:type="dxa"/>' +
              '<w:bottom w:w="0" w:type="dxa"/>' +
              '<w:left w:w="0" w:type="dxa"/>' +
              '<w:right w:w="0" w:type="dxa"/>' +
              '</w:tcMar></w:tcPr>'
          ),
          trHeight('284', 'atLeast')
        ) +
        '</w:tbl>'
    );
    const row = allTables(layout(part))[0]!.rows[0]!;
    expect(row.box.height).toBeCloseTo(14.2, 5);
    expect(row.box.height).toBeGreaterThanOrEqual(14.2 - 1e-6);
  });

  test('atLeast grows with taller content', () => {
    const many = Array.from({ length: 4 }, (_, i) => p(`line-${i}`)).join('');
    const part = loadPart(`<w:tbl>${tr(tc(many), trHeight('284', 'atLeast'))}</w:tbl>`);
    const row = allTables(layout(part))[0]!.rows[0]!;
    expect(row.box.height).toBeGreaterThan(14.2 + 10);
  });

  test('auto stays content-sized below the removed 20pt floor', () => {
    const part = loadPart(
      '<w:tbl>' +
        tr(
          tc(
            p('x'),
            '<w:tcPr><w:tcMar>' +
              '<w:top w:w="40" w:type="dxa"/>' +
              '<w:bottom w:w="20" w:type="dxa"/>' +
              '<w:left w:w="40" w:type="dxa"/>' +
              '<w:right w:w="40" w:type="dxa"/>' +
              '</w:tcMar></w:tcPr>'
          )
        ) +
        '</w:tbl>'
    );
    const row = allTables(layout(part))[0]!.rows[0]!;
    // 2 + 14 + 1 = 17 — content-sized, not the old ~20pt invented floor.
    expect(row.box.height).toBeCloseTo(17, 5);
    expect(row.box.height).toBeLessThan(19);
  });

  test('exact fixes height and clips overflow content (no continuation)', () => {
    const many = Array.from({ length: 8 }, (_, i) => p(`line-${i}`)).join('');
    const part = loadPart(`<w:tbl>${tr(tc(many), trHeight('400', 'exact'))}</w:tbl>`);
    const tables = allTables(layout(part));
    expect(tables).toHaveLength(1);
    const row = tables[0]!.rows[0]!;
    expect(row.box.height).toBeCloseTo(20, 5); // 400 twips
    expect(row.isContinuation).toBeUndefined();
    const lineCount = row.cells[0]!.blocks.reduce(
      (n, block) => n + (block.kind === 'paragraph' ? block.lines.length : 0),
      0
    );
    // Eight natural lines cannot all fit in a 20pt exact box.
    expect(lineCount).toBeLessThan(8);
    expect(lineCount).toBeGreaterThan(0);
  });

  test('exact row taller than the page fills the page, and the next block starts a page', () => {
    // Default page content height is well under 2000pt; 40000 twips = 2000pt.
    const part = loadPart(
      `<w:tbl>${tr(tc(p('x')), trHeight('40000', 'exact'))}</w:tbl>${p('after')}`
    );
    const result = layout(part);
    const [table] = allTables(result);
    const contentHeight = result.pages[0]!.contentBox.height;
    // The row keeps no continuation: it is clipped at the bottom of the content box.
    expect(table!.rows).toHaveLength(1);
    expect(table!.rows[0]!.box.height).toBeCloseTo(contentHeight, 3);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[1]!.fragments.some((fragment) => fragment.kind === 'paragraph')).toBe(true);
  });
});

describe('Form025U row-height regression', () => {
  test('authored 14.2pt atLeast rows never render below their minimum', () => {
    const bytes = readFileSync(`${import.meta.dir}/../../../../../e2e/fixtures/Form025U.docx`);
    const result = readOoxmlPackage(bytes);
    if (!result.ok) throw new Error(result.reason);
    const part = result.package.parts.get(result.package.mainDocumentPart)!;

    const tables: OoxmlElement[] = [];
    const walk = (node: OoxmlElement): void => {
      if (node.kind === 'table') tables.push(node);
      for (const child of node.children) {
        if (child.kind !== 'textValue') walk(child);
      }
    };
    walk(part.root);

    const authoredAtLeastIds = new Set<string>();
    for (const table of tables) {
      const structure = readTableStructure(table, 468, 0);
      if (!structure) continue;
      for (const row of structure.rows) {
        if (row.height.rule === 'atLeast' && Math.abs(row.height.valuePt - 14.2) < 0.05) {
          authoredAtLeastIds.add(row.id);
        }
      }
    }
    expect(authoredAtLeastIds.size).toBeGreaterThan(0);

    const shortRows = allTables(layout(part))
      .flatMap((table) => table.rows)
      .filter((row) => authoredAtLeastIds.has(row.id));
    expect(shortRows.length).toBeGreaterThan(0);
    for (const row of shortRows) {
      expect(row.box.height).toBeGreaterThanOrEqual(14.2 - 0.05);
    }
  });
});
