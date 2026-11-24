// Footnote references around merged text carried past a head-row page break
// (`table-vmerge-boundary.ts`). The zero-height head-row continuation that holds the carried
// text is not a row of its own for footnote bands: the head row is complete on its page, and
// the carried text breaks together with the row below it (`table-carried-head-row.ts`).
//
// The page is 350pt by 210pt with 20pt margins: a 170pt body of exact 14pt lines. The merged
// paragraph has 6pt before it and widow control. Footnote lines are exact 14pt lines.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import type { OoxmlNode, OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { TreeDocumentStore } from '../../store/index.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { BlockFragmentRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SECT =
  '<w:sectPr><w:pgSz w:w="7000" w:h="4200"/><w:pgMar w:top="400" w:bottom="400" ' +
  'w:left="400" w:right="400" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
const exact = (before = 0) =>
  `<w:spacing w:before="${before}" w:after="0" w:line="280" w:lineRule="exact"/>`;

interface ParagraphOptions {
  readonly note?: number;
  readonly before?: number;
  readonly widow?: boolean;
}
const paragraph = (lines: readonly string[], options: ParagraphOptions = {}) =>
  `<w:p><w:pPr>${options.widow ? '<w:widowControl/>' : '<w:widowControl w:val="0"/>'}` +
  `${exact(options.before)}</w:pPr>` +
  lines
    .map(
      (text, index) =>
        `${index ? '<w:r><w:br/></w:r>' : ''}<w:r><w:t>${text}</w:t></w:r>` +
        (options.note !== undefined && index === 0
          ? `<w:r><w:footnoteReference w:id="${options.note}"/></w:r>`
          : '')
    )
    .join('') +
  '</w:p>';
const cell = (content: string, tcPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${tcPr}</w:tcPr>${content}</w:tc>`;
const numbered = (label: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${label}${index + 1}`);

interface Shape {
  /** Body lines above the table. */
  readonly fill: number;
  /** Lines of merged text. */
  readonly merged: number;
  /** Lines of a repeated header row. */
  readonly header?: number;
  /** Lines of the note cited in the head row's own cell. */
  readonly noteInHead?: number;
  /** Lines of the note cited in the carrying row's first line. */
  readonly noteInNext?: number;
}

function body(shape: Shape): string {
  const rowHeight = '<w:trPr><w:trHeight w:val="560"/></w:trPr>';
  const header = shape.header
    ? `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell(paragraph(numbered('HD', shape.header)))}` +
      `${cell(paragraph(['HDB']))}</w:tr>`
    : '';
  const above = `<w:tr>${cell(paragraph(['PA']))}${cell(paragraph(['PB']))}</w:tr>`;
  const head =
    `<w:tr>${rowHeight}${cell(paragraph(['ROWA'], { note: shape.noteInHead ? 1 : undefined }))}` +
    cell(paragraph(numbered('M', shape.merged), { before: 120, widow: true }), RESTART) +
    '</w:tr>';
  const next =
    `<w:tr>${rowHeight}${cell(paragraph(['ROWB'], { note: shape.noteInNext ? 2 : undefined }))}` +
    `${cell(paragraph([]), CONTINUE)}</w:tr>`;
  const after = `<w:tr>${cell(paragraph(['NA']))}${cell(paragraph(['NB']))}</w:tr>`;
  const table =
    '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
    '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    `${header}${above}${head}${next}${after}</w:tbl>`;
  const fill = numbered('F', shape.fill)
    .map((text) => paragraph([text]))
    .join('');
  return `${fill}${table}${paragraph(['TAIL'])}`;
}
const RESTART = '<w:vMerge w:val="restart"/>';
const CONTINUE = '<w:vMerge/>';

function docx(shape: Shape): Uint8Array {
  const notes: [number, number][] = [];
  if (shape.noteInHead) notes.push([1, shape.noteInHead]);
  if (shape.noteInNext) notes.push([2, shape.noteInNext]);
  const noteXml = notes
    .map(
      ([id, count]) =>
        `<w:footnote w:id="${id}"><w:p><w:pPr>${exact()}</w:pPr><w:r><w:footnoteRef/></w:r>` +
        `<w:r>${numbered(`N${id}-`, count)
          .map((text) => `<w:t>${text}</w:t>`)
          .join('<w:br/>')}</w:r></w:p></w:footnote>`
    )
    .join('');
  const separator = (type: string, id: number) =>
    `<w:footnote w:type="${type}" w:id="${id}"><w:p><w:pPr>${exact()}</w:pPr>` +
    `<w:r><w:${type}/></w:r></w:p></w:footnote>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body(shape)}${SECT}</w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">${separator('separator', -1)}` +
        `${separator('continuationSeparator', 0)}${noteXml}</w:footnotes>`
    ),
  });
}

const measurer = createFixedMeasurer(6, 14);

function open(shape: Shape) {
  const loaded = readOoxmlPackage(docx(shape));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const footnote = resolveFootnoteProperties(undefined, undefined);
  const endnote = resolveEndnoteProperties(undefined, undefined);
  const notes = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: [footnote],
    endnotePropsBySection: [endnote],
    documentFootnoteProps: footnote,
    documentEndnoteProps: endnote,
    measurer,
    producer: 'test',
    compatibilityMode: 15,
  };
  return { part, notes };
}

const lay = (shape: Shape): SemanticLayout => {
  const { part, notes } = open(shape);
  return layoutSemanticDocument(part, 1, {
    measurer,
    notes,
    session: createLayoutSession(),
    producer: 'test',
    compatibilityMode: 15,
  });
};

const words = (block: BlockFragmentRecord): string[] =>
  block.kind === 'paragraph'
    ? block.lines.map((line) =>
        line.spans
          .map((span) => span.text)
          .join('')
          .trim()
      )
    : block.rows
        .filter((row) => !row.isHeaderRepeat)
        .flatMap((row) => row.cells.flatMap((placed) => placed.blocks.flatMap(words)));
const bodyWords = (layout: SemanticLayout) =>
  layout.pages.map((page) => page.fragments.flatMap(words).filter((word) => word !== ''));

/** The reference page, the page the note opens on, and pages whose body is empty. */
function notePages(layout: SemanticLayout, label: string, noteId: number) {
  const pages = bodyWords(layout);
  return {
    reference: pages.findIndex((page) => page.some((word) => word.startsWith(label))),
    opening: layout.pages.findIndex((page) =>
      (page.footnotes?.notes ?? []).some((note) => note.noteId === noteId && !note.continuation)
    ),
    emptyBodies: pages.flatMap((page, index) => (page.length === 0 ? [index] : [])),
  };
}

function expectEveryWordOnce(layout: SemanticLayout, shape: Shape): void {
  const painted = bodyWords(layout).flat();
  const expected = [
    ...numbered('F', shape.fill),
    'PA',
    'PB',
    'ROWA',
    ...numbered('M', shape.merged),
    'ROWB',
    'NA',
    'NB',
    'TAIL',
  ];
  // A citing line ends in its note mark.
  const cites = new Set(['ROWA', 'ROWB']);
  for (const word of expected) {
    const seen = painted.filter(
      (text) => text === word || (cites.has(word) && text.startsWith(word))
    );
    expect(seen).toHaveLength(1);
  }
}

describe('footnotes around carried merged text', () => {
  test('a note cited in the head row opens on its reference page', () => {
    // The head row ends page 1 with its merged text carried; its note does not fit there.
    const shape: Shape = { fill: 9, merged: 5, noteInHead: 2 };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    const pages = notePages(layout, 'ROWA', 1);
    expect(pages.opening).toBe(pages.reference);
    expect(pages.emptyBodies).toEqual([]);
  });

  test('a note cited at the top of the carrying row opens on its reference page', () => {
    const shape: Shape = { fill: 9, merged: 9, noteInNext: 2 };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    const pages = notePages(layout, 'ROWB', 2);
    expect(pages.reference).toBe(1);
    expect(pages.opening).toBe(1);
    expect(pages.emptyBodies).toEqual([]);
    // The carrying row splits below its reference line; the carried text continues after it.
    const merged = bodyWords(layout).map((page) => page.filter((word) => /^M\d+$/.test(word)));
    expect(merged[1]!.length).toBeGreaterThan(0);
    expect(merged[2]!.length).toBeGreaterThan(0);
  });

  test('a note cited at the top of the carrying row below repeated header rows', () => {
    const shape: Shape = { fill: 6, merged: 6, header: 3, noteInNext: 2 };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    const pages = notePages(layout, 'ROWB', 2);
    expect(pages.opening).toBe(pages.reference);
    expect(pages.emptyBodies).toEqual([]);
  });

  test('an edit above the table reaches the same pages warm as cold', () => {
    const shape: Shape = { fill: 8, merged: 9, noteInNext: 2 };
    const { part, notes } = open(shape);
    const store = new TreeDocumentStore(part);
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    const options = { measurer, notes, producer: 'test', compatibilityMode: 15 };
    const shapeOf = (layout: SemanticLayout) =>
      layout.pages.map((page) => ({
        body: page.fragments.flatMap(words).filter((word) => word !== ''),
        notes: (page.footnotes?.notes ?? []).map(
          (note) => `${note.noteId}${note.continuation ? 'c' : ''}`
        ),
      }));
    layoutSemanticDocument(store.part, 1, { ...options, session, cache });
    const target = findParagraph(store.part, 'F2');
    const result = store.transact((tx) => {
      tx.apply({ op: 'splitParagraph', paragraphId: target, offset: 1 });
    });
    expect(result.ok).toBe(true);
    const warm = layoutSemanticDocument(store.part, 2, { ...options, session, cache });
    const cold = layoutSemanticDocument(structuredClone(store.part), 1, {
      ...options,
      session: createLayoutSession(),
    });
    expect(shapeOf(warm)).toEqual(shapeOf(cold));
    const pages = notePages(cold, 'ROWB', 2);
    expect(pages.opening).toBe(pages.reference);
  });
});

/** The id of the body paragraph whose text is `text`. */
function findParagraph(part: OoxmlPart, text: string): string {
  const textOf = (node: OoxmlNode): string =>
    node.kind === 'textValue' ? node.value : node.children.map(textOf).join('');
  let found: string | undefined;
  const visit = (node: OoxmlNode): void => {
    if (found || node.kind === 'textValue') return;
    if (node.kind === 'paragraph' && textOf(node) === text) found = node.id;
    else node.children.forEach(visit);
  };
  visit(part.root);
  if (!found) throw new Error(`no paragraph ${text}`);
  return found;
}
