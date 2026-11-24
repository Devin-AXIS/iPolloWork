// Range deletion that reaches across blocks, and where the caret lands after it.
//
// A body paragraph and a cell paragraph have different parents, so the paragraph lane can
// only ever empty a table it spans. The plan removes one outright when the range fully
// contains it, and promotes the surviving paragraph when the range began inside a table it
// is about to remove — otherwise the very next op names a paragraph the same transaction
// deleted, and one refused op vetoes the whole atomic transaction.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import type { OoxmlNode } from '../../store/package/ooxml-tree.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string): string => `<w:tc>${p(text)}</w:tc>`;
const TABLE = `<w:tbl><w:tr>${cell('A1')}${cell('B1')}</w:tr><w:tr>${cell('A2')}${cell('B2')}</w:tr></w:tbl>`;

function mount(body: string): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  const result = mountPaginatedSurface(container, docx(body), { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return { surface: result.surface, container };
}

/** The text of every paragraph the session addresses, in reading order. */
function texts(surface: PaginatedSurface): string[] {
  const part = surface.session.part();
  return surface.session.paragraphIds().map((id) => paragraphTextOf(part, id) ?? '');
}

function pasteInto(container: HTMLElement, text: string): void {
  const pages = container.querySelector('.docx-pages');
  if (!pages) throw new Error('no pages layer');
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (flavour: string) => (flavour === 'text/plain' ? text : '') },
  });
  pages.dispatchEvent(event);
}

describe('inert body-level siblings do not veto structural delete', () => {
  // A misplaced `w:pBdr` between body paragraphs is preserved as generic. Join planning that
  // treated it as transparent planned `joinParagraphs` the store refuses (`not-adjacent-
  // siblings`), and one refused op vetoed the atomic transaction — Select All then Delete
  // left every table standing. Barriers keep the joins honest so deleteBlock still lands.
  test('Select All then Delete removes a table despite an orphaned body-level w:pBdr', () => {
    const orphan =
      '<w:pBdr><w:bottom w:val="single" w:color="auto" w:sz="6" w:space="1"/></w:pBdr>';
    const { surface } = mount(p('above') + orphan + TABLE + orphan + p('below'));
    const countTables = (): number => {
      let tables = 0;
      const walk = (node: OoxmlNode): void => {
        if (node.kind === 'textValue') return;
        if (node.kind === 'table') tables += 1;
        for (const child of node.children) walk(child);
      };
      walk(surface.session.part().root);
      return tables;
    };
    expect(countTables()).toBe(1);
    surface.selectAll();
    expect(surface.deleteSelection()).toBe(true);
    expect(countTables()).toBe(0);
  });
});

describe('a range that fully contains a table removes it', () => {
  test('Select All then Delete leaves one empty paragraph', () => {
    const { surface, container } = mount(p('intro') + TABLE + p('outro'));
    surface.selectAll();
    surface.deleteSelection();
    expect(texts(surface)).toEqual(['']);
    expect(container.querySelectorAll('.docx-table-cell')).toHaveLength(0);
  });

  test('the join reaches across the removed table', () => {
    // The two body paragraphs are not siblings of anything the range emptied inside the
    // table — they become adjacent only because the table between them is gone.
    const { surface } = mount(p('head') + TABLE + p('tail'));
    surface.selectAll();
    surface.deleteSelection();
    expect(surface.session.paragraphIds()).toHaveLength(1);
  });

  test('two tables both go', () => {
    const { surface } = mount(p('a') + TABLE + p('b') + TABLE + p('c'));
    surface.selectAll();
    surface.deleteSelection();
    expect(texts(surface)).toEqual(['']);
  });
});

describe('the survivor is promoted when the range starts inside a removed table', () => {
  test('a document that starts with a table', () => {
    const { surface, container } = mount(TABLE + p('after'));
    surface.selectAll();
    surface.deleteSelection();
    expect(texts(surface)).toEqual(['']);
    expect(container.querySelectorAll('.docx-table-cell')).toHaveLength(0);
  });

  test('typing over the selection lands in the promoted survivor', () => {
    const { surface } = mount(TABLE + p('after'));
    surface.selectAll();
    surface.type('X');
    // Addressing the range's start would have named a cell paragraph the same transaction
    // removed, and the refused insert would have vetoed the delete along with it.
    expect(texts(surface)).toEqual(['X']);
  });

  test('pasting over the selection lands in the promoted survivor', () => {
    const { surface, container } = mount(TABLE + p('after'));
    surface.selectAll();
    pasteInto(container, 'one\ntwo');
    expect(texts(surface)).toEqual(['one', 'two']);
  });

  test('Enter over the selection splits the promoted survivor', () => {
    const { surface } = mount(TABLE + p('after'));
    surface.selectAll();
    surface.splitParagraph();
    expect(texts(surface)).toEqual(['', '']);
  });

  test('a tab over the selection lands in the promoted survivor', () => {
    const { surface } = mount(TABLE + p('after'));
    surface.selectAll();
    surface.insertTab();
    expect(texts(surface)).toEqual(['\t']);
  });
});

describe('a table stays when nothing else could host the caret', () => {
  test('an empty trailing paragraph is enough to host the promoted caret', () => {
    const { surface, container } = mount(TABLE + p(''));
    const ids = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 0 },
      // The trailing paragraph is empty, so ending at offset zero still covers it whole.
      head: { paragraphId: ids.at(-1)!, offset: 0 },
    });
    surface.deleteSelection();
    expect(container.querySelectorAll('.docx-table-cell')).toHaveLength(0);
    expect(texts(surface)).toEqual(['']);
  });

  test('a body that ends with the table reads a paragraph after it, which hosts the caret', () => {
    const { surface, container } = mount(TABLE);
    surface.selectAll();
    surface.deleteSelection();
    expect(container.querySelectorAll('.docx-table-cell')).toHaveLength(0);
    expect(texts(surface)).toEqual(['']);
  });
});

describe('the comprehensive fixture', () => {
  const FIXTURE = resolve(
    import.meta.dir,
    '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
  );

  interface Census {
    readonly tables: number;
    readonly paragraphs: number;
    readonly characters: number;
    readonly pages: number;
  }

  function census(surface: PaginatedSurface): Census {
    const part = surface.session.part();
    let tables = 0;
    let paragraphs = 0;
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'table') tables += 1;
      if (node.kind === 'paragraph') paragraphs += 1;
      for (const child of node.children) walk(child);
    };
    walk(part.root);
    const characters = surface.session
      .paragraphIds()
      .reduce((sum, id) => sum + (paragraphTextOf(part, id) ?? '').length, 0);
    return { tables, paragraphs, characters, pages: surface.layout().pages.length };
  }

  test('Select All then Delete empties the document instead of leaving table skeletons', () => {
    const container = document.createElement('div');
    const mounted = mountPaginatedSurface(container, new Uint8Array(readFileSync(FIXTURE)), {
      scale: 1,
    });
    if (!mounted.ok) throw new Error(`${mounted.reason}: ${mounted.detail ?? ''}`);
    const surface = mounted.surface;

    const before = census(surface);
    expect(before.tables).toBe(15);
    expect(before.pages).toBeGreaterThan(20);

    surface.selectAll();
    surface.deleteSelection();
    const after = census(surface);

    // What used to survive was 15 tables over 7 pages of blank skeletons. Before content
    // controls participated in layout, two tables whose paragraphs lived only inside SDTs
    // were invisible to select-all and stayed (with their text). Typed content-control
    // layout now emits those paragraphs, so the gesture clears their cells and removes
    // the form table entirely. One emptied six-row table shell still cannot be said to be
    // fully covered for structural removal, and residual checkbox controls remain join
    // boundaries — hence a handful of empty paragraphs beside them.
    expect(after.tables).toBe(1);
    expect(after.pages).toBeLessThan(before.pages / 5);
    expect(after.paragraphs).toBeLessThan(before.paragraphs / 10);
    // Residual characters are checkbox-control markers layout still hosts, not body copy.
    expect(after.characters).toBeLessThan(before.characters / 100);

    // And the document is still editable afterwards. The first surviving paragraph may host
    // a field (TOC) whose projected object-replacement marker stays in the store text, so
    // assert the typed characters land rather than exact paragraph equality.
    surface.type('after');
    expect(paragraphTextOf(surface.session.part(), surface.session.paragraphIds()[0]!)).toContain(
      'after'
    );
  });
});
