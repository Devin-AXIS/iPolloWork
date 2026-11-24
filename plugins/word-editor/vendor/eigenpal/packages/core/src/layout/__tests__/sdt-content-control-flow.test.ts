// Transparent content-control flow: body, table cell, nested, and inline geometry/text.
//
// These pin the layout correctness the typed-content-controls change needs before chrome:
// flattening joins content in place, inline runs contribute exact UTF-16 offsets, and the
// shared nesting budget fails closed. Boundary geometry records are deliberately absent —
// see `content-control-walk.ts` in the store package.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import {
  collectFlowBlocks,
  isContentControl,
  MAX_CONTENT_CONTROL_NESTING,
} from '../../store/package/content-control-walk.ts';
import { piecesOfParagraph } from '../field-projection.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { readTableStructure } from '../semantic-table.ts';
import type { StyleSpanRecord, TableFragmentRecord } from '../semantic-records.ts';
import { storyBlocks } from '../story-roots.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(xml: string, name = '/word/document.xml'): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const documentOf = (bodyXml: string) =>
  part(`<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`);

const sdt = (inner: string) => `<w:sdt><w:sdtPr/><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;

function spansOf(layout: ReturnType<typeof layoutSemanticDocument>): StyleSpanRecord[] {
  const spans: StyleSpanRecord[] = [];
  const walk = (blocks: readonly { kind: string }[]): void => {
    for (const block of blocks) {
      if (block.kind === 'table') {
        for (const row of (block as TableFragmentRecord).rows) {
          for (const cell of row.cells) walk(cell.blocks);
        }
        continue;
      }
      for (const line of (block as { lines: { spans: StyleSpanRecord[] }[] }).lines) {
        spans.push(...line.spans);
      }
    }
  };
  for (const page of layout.pages) walk(page.fragments);
  return spans;
}

function paintedText(layout: ReturnType<typeof layoutSemanticDocument>): string {
  return spansOf(layout)
    .slice()
    .sort((a, b) => {
      if (a.range.paragraphId !== b.range.paragraphId) {
        return a.range.paragraphId < b.range.paragraphId ? -1 : 1;
      }
      return a.range.start - b.range.start;
    })
    .map((span) => span.text)
    .join('');
}

function firstParagraph(doc: OoxmlPart): OoxmlElement {
  const blocks = storyBlocks(doc);
  const paragraph = blocks.find((block) => block.kind === 'paragraph');
  if (!paragraph) throw new Error('no paragraph');
  return paragraph;
}

describe('shared SDT nesting budget', () => {
  test('MAX_CONTENT_CONTROL_NESTING is 32 and matches the historical storyBlocks bound', () => {
    expect(MAX_CONTENT_CONTROL_NESTING).toBe(32);
  });

  test('collectFlowBlocks stops flattening past the bound', () => {
    let nested = p('deep');
    for (let i = 0; i < MAX_CONTENT_CONTROL_NESTING + 1; i += 1) nested = sdt(nested);
    const doc = documentOf(nested);
    const body = doc.root.children.find((child) => child.kind === 'body');
    if (!body || body.kind === 'textValue') throw new Error('no body');
    expect(collectFlowBlocks(body.children)).toEqual([]);
    expect(storyBlocks(doc)).toEqual([]);
  });

  test('collectFlowBlocks flattens nested controls within the bound', () => {
    const doc = documentOf(sdt(sdt(p('inner'))));
    const blocks = storyBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('paragraph');
  });
});

describe('body block SDT flattening', () => {
  test('a block control joins the story in reading order', () => {
    const doc = documentOf(`${p('before')}${sdt(p('inside'))}${p('after')}`);
    const blocks = storyBlocks(doc);
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    const layout = layoutSemanticDocument(doc, 0, { measurer: createFixedMeasurer(6, 14) });
    expect(paintedText(layout)).toBe('beforeinsideafter');
  });

  test('removing the wrapper does not change painted geometry height', () => {
    const wrapped = documentOf(sdt(p('same')));
    const bare = documentOf(p('same'));
    const measurer = createFixedMeasurer(6, 14);
    const a = layoutSemanticDocument(wrapped, 0, { measurer });
    const b = layoutSemanticDocument(bare, 0, { measurer });
    expect(a.pages[0]!.fragments).toHaveLength(1);
    expect(b.pages[0]!.fragments).toHaveLength(1);
    const boxA = (a.pages[0]!.fragments[0] as { box: { height: number } }).box;
    const boxB = (b.pages[0]!.fragments[0] as { box: { height: number } }).box;
    expect(boxA.height).toBe(boxB.height);
    expect(paintedText(a)).toBe(paintedText(b));
  });
});

describe('table-cell SDT flattening', () => {
  test('a control wrapping a cell paragraph is measured like a bare paragraph', () => {
    const cellWith = `<w:tc>${sdt(p('cell'))}</w:tc>`;
    const cellBare = `<w:tc>${p('cell')}</w:tc>`;
    const grid = '<w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid>';
    const wrapped = documentOf(`<w:tbl><w:tblPr/>${grid}<w:tr>${cellWith}</w:tr></w:tbl>`);
    const bare = documentOf(`<w:tbl><w:tblPr/>${grid}<w:tr>${cellBare}</w:tr></w:tbl>`);
    const tableWrapped = wrapped.root.children
      .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
      .find((child) => child.kind === 'table') as OoxmlElement;
    const structure = readTableStructure(tableWrapped, 468, 0)!;
    expect(structure.rows[0]!.cells[0]!.blocks).toHaveLength(1);
    expect(structure.rows[0]!.cells[0]!.blocks[0]!.kind).toBe('paragraph');

    const measurer = createFixedMeasurer(6, 14);
    const layoutWrapped = layoutSemanticDocument(wrapped, 0, { measurer });
    const layoutBare = layoutSemanticDocument(bare, 0, { measurer });
    expect(paintedText(layoutWrapped)).toBe('cell');
    expect(paintedText(layoutBare)).toBe('cell');
  });
});

describe('inline SDT run projection', () => {
  test('inline control runs contribute contiguous UTF-16 offsets', () => {
    const doc = documentOf(`<w:p>${run('A')}${sdt(run('B') + run('C'))}${run('D')}</w:p>`);
    const paragraph = firstParagraph(doc);
    const pieces = piecesOfParagraph(paragraph);
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'B', 'C', 'D']);
    expect(pieces.map((piece) => [piece.start, piece.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
  });

  test('inline control creates no extra piece or break at its boundary', () => {
    const doc = documentOf(`<w:p>${run('hi')}${sdt(run('there'))}${run('!')}</w:p>`);
    const pieces = piecesOfParagraph(firstParagraph(doc));
    expect(pieces).toHaveLength(3);
    expect(pieces.map((piece) => piece.text).join('')).toBe('hithere!');
    // Contiguous ranges: no zero-width boundary piece between hi / there / !
    expect(pieces[0]!.end).toBe(pieces[1]!.start);
    expect(pieces[1]!.end).toBe(pieces[2]!.start);
  });

  test('nested inline controls flatten under the shared budget', () => {
    const doc = documentOf(`<w:p>${sdt(sdt(run('x')))}</w:p>`);
    const pieces = piecesOfParagraph(firstParagraph(doc));
    expect(pieces.map((piece) => piece.text)).toEqual(['x']);
    expect(pieces[0]!.start).toBe(0);
    expect(pieces[0]!.end).toBe(1);
  });

  test('layout paints inline control text with the same geometry as bare runs', () => {
    const wrapped = documentOf(`<w:p>${run('ab')}${sdt(run('cd'))}${run('ef')}</w:p>`);
    const bare = documentOf(`<w:p>${run('ab')}${run('cd')}${run('ef')}</w:p>`);
    const measurer = createFixedMeasurer(6, 14);
    const a = layoutSemanticDocument(wrapped, 0, { measurer });
    const b = layoutSemanticDocument(bare, 0, { measurer });
    expect(paintedText(a)).toBe('abcdef');
    expect(paintedText(b)).toBe('abcdef');
    const spansA = spansOf(a);
    const spansB = spansOf(b);
    expect(spansA.map((span) => [span.range.start, span.range.end, span.text])).toEqual(
      spansB.map((span) => [span.range.start, span.range.end, span.text])
    );
  });
});

describe('isContentControl recognition', () => {
  test('generic w:sdt is recognised', () => {
    const doc = documentOf(sdt(p('x')));
    const body = doc.root.children.find((child) => child.kind === 'body');
    if (!body || body.kind === 'textValue') throw new Error('no body');
    const control = body.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'sdt'
    );
    expect(control && isContentControl(control)).toBe(true);
  });
});
