// Whole-table insertion through TreeDocumentStore.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp, validateTreeOp } from '../store/tree-ops.ts';
import { isValidParaId, paraIdOf } from '../package/para-id.ts';
import {
  MAX_INSERT_TABLE_CELLS,
  MIN_TABLE_COLUMN_WIDTH_TWIPS,
} from '../store/table-constraints.ts';
import type { TreeDocOp } from '../store/tree-op-types.ts';

const W = WML_NAMESPACE_URI;
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function load(body: string, extraBindings = ''): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"${extraBindings}><w:body>${body}</w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function collectByKind(root: OoxmlNode, kind: OoxmlElement['kind']): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === kind) found.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return found;
}

function firstParagraphId(part: OoxmlPart): string {
  return collectByKind(part.root, 'paragraph')[0]!.id;
}

function insertOp(part: OoxmlPart, over: Partial<Extract<TreeDocOp, { op: 'insertTable' }>> = {}) {
  return {
    op: 'insertTable' as const,
    beforeParagraphId: firstParagraphId(part),
    rows: 2,
    cols: 3,
    columnWidthTwips: 3120,
    ...over,
  };
}

function applied(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.part;
}

describe('insertTable', () => {
  test('authors a full grid before the anchor paragraph and leaves the caret in cell one', () => {
    const part = load('<w:p><w:r><w:t>after</w:t></w:r></w:p>');
    const op = insertOp(part);
    const result = applyTreeOp(part, op);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const body = result.part.root.children[0] as OoxmlElement;
    expect(
      body.children.map((child) => (child.kind === 'textValue' ? '#' : child.localName))
    ).toEqual(['tbl', 'p']);

    const table = collectByKind(result.part.root, 'table')[0]!;
    const rows = table.children.filter((child) => child.kind === 'tableRow');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.children.filter((child) => child.kind === 'tableCell')).toHaveLength(3);
    }
    const grid = collectByKind(result.part.root, 'tableGrid')[0]!;
    expect(grid.children).toHaveLength(3);
    for (const column of grid.children) {
      expect(column.attributes.find((a) => a.localName === 'w')?.value).toBe('3120');
    }

    // Every cell holds exactly one empty paragraph, which is what makes the table editable.
    const cells = collectByKind(result.part.root, 'tableCell');
    expect(cells).toHaveLength(6);
    for (const cell of cells) {
      expect(cell.children.filter((child) => child.kind === 'paragraph')).toHaveLength(1);
    }

    const firstCellParagraph = cells[0]!.children.find((child) => child.kind === 'paragraph')!;
    expect(result.effect.caret?.paragraphId).toBe(firstCellParagraph.id);
    expect(result.effect.impact).toBe('flow-structural');
  });

  test('borders are explicit, so a document with no table style still shows the table', () => {
    const part = load('<w:p/>');
    const next = applied(part, insertOp(part));
    const xml = serializeOoxmlPart(next);
    // Serialization normalizes attribute order, so the expectation states the canonical form.
    for (const side of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) {
      expect(xml).toContain(`<w:${side} w:color="auto" w:space="0" w:sz="4" w:val="single"/>`);
    }
    expect(xml).toContain('<w:tblW w:type="auto" w:w="0"/>');
    expect(xml).not.toContain('w:tblStyle');
  });

  test('cell paragraphs get minted w14:paraId when the document binds w14', () => {
    const part = load('<w:p/>', ` xmlns:w14="${W14}"`);
    const next = applied(part, insertOp(part, { rows: 1, cols: 2 }));
    const cellParagraphs = collectByKind(next.root, 'tableCell').map((cell) =>
      cell.children.find((child) => child.kind === 'paragraph')!
    );
    const ids = cellParagraphs.map((paragraph) => paraIdOf(paragraph));
    expect(ids.every((id) => id !== null && isValidParaId(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('a separating paragraph is authored when the anchor already follows a table', () => {
    // Two adjacent `w:tbl` are ONE table on reopen, so the op has to break them apart itself.
    const part = load(
      '<w:tbl><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl><w:p/>'
    );
    const anchor = collectByKind(part.root, 'paragraph').find((paragraph) =>
      collectByKind(part.root, 'tableCell')[0]!.children.every((c) => c.id !== paragraph.id)
    )!;
    const next = applied(part, insertOp(part, { beforeParagraphId: anchor.id, rows: 1, cols: 1 }));
    const body = next.root.children[0] as OoxmlElement;
    expect(
      body.children.map((child) => (child.kind === 'textValue' ? '#' : child.localName))
    ).toEqual(['tbl', 'p', 'tbl', 'p']);
  });

  test('refuses sizes, widths and anchors the engine will not author', () => {
    const part = load('<w:p/>');
    const anchor = firstParagraphId(part);
    const refusal = (over: Partial<Extract<TreeDocOp, { op: 'insertTable' }>>) =>
      validateTreeOp(part, insertOp(part, over));

    expect(refusal({ rows: 0 })).toBe('invalidArgs');
    expect(refusal({ cols: 0 })).toBe('invalidArgs');
    expect(refusal({ rows: 1.5 })).toBe('invalidArgs');
    expect(refusal({ cols: 64 })).toBe('invalidArgs');
    // The cell cap binds on the PRODUCT, not on either dimension alone.
    expect(refusal({ rows: MAX_INSERT_TABLE_CELLS, cols: 2 })).toBe('resource-limit');
    expect(refusal({ columnWidthTwips: MIN_TABLE_COLUMN_WIDTH_TWIPS - 1 })).toBe(
      'invalid-property-value'
    );
    // 63 columns at the widest legal single column is far past any page.
    expect(refusal({ cols: 63, columnWidthTwips: 31_680 })).toBe('invalid-property-value');
    expect(refusal({ beforeParagraphId: 'nope' })).toBe('unknown-paragraph');
    expect(validateTreeOp(part, insertOp(part, { beforeParagraphId: anchor }))).toBeNull();
  });

  test('refuses an anchor that is not a block-level paragraph', () => {
    // A paragraph inside a run-level revision container is not a body block, and a `w:tbl`
    // dropped beside it is corruption that would survive validation.
    const part = load('<w:p><w:ins w:id="1" w:author="a"><w:r><w:t>x</w:t></w:r></w:ins></w:p>');
    const run = collectByKind(part.root, 'run')[0]!;
    expect(validateTreeOp(part, insertOp(part, { beforeParagraphId: run.id }))).toBe(
      'not-a-paragraph'
    );
  });

  test('inserts into a table cell, so a nested table is reachable', () => {
    const part = load(
      '<w:tbl><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl><w:p/>'
    );
    const cell = collectByKind(part.root, 'tableCell')[0]!;
    const cellParagraph = cell.children.find((child) => child.kind === 'paragraph')!;
    const next = applied(
      part,
      insertOp(part, { beforeParagraphId: cellParagraph.id, rows: 1, cols: 1 })
    );
    const nestedIn = collectByKind(next.root, 'tableCell')[0]!;
    expect(
      nestedIn.children.map((child) => (child.kind === 'textValue' ? '#' : child.localName))
    ).toEqual(['tbl', 'p']);
  });

  test('the inserted table round-trips through serialize and re-read', () => {
    const part = load('<w:p><w:r><w:t>after</w:t></w:r></w:p>');
    const next = applied(part, insertOp(part));
    const reread = readOoxmlPart(serializeOoxmlPart(next), {
      name: part.name,
      contentType: part.contentType,
    });
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    expect(collectByKind(reread.part.root, 'tableCell')).toHaveLength(6);
    expect(collectByKind(reread.part.root, 'tableGrid')[0]!.children).toHaveLength(3);
  });
});
