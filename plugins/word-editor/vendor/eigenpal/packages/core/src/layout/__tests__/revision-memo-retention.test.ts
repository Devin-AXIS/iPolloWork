// Memos must not keep an answer for every revision the undo history keeps alive.
//
// The undo history holds old tree revisions, so a cache keyed by node identity keeps an entry
// for every revision of an edited node. When the answer grows with the subtree (a table's
// structure, every id under the body), each edit kept another copy. And a closure that names
// an older memo entry keeps it, and what it reaches, for as long as the newer answer lives.

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  openHeadlessDocument,
  readOoxmlPart,
  type OoxmlElement,
} from '@docx-editor.dev/core/store';
import type { OoxmlNode } from '../../store/package/ooxml-tree.ts';
import {
  createSubtreeAggregateMemo,
  LARGE_SUBTREE_ANSWER,
} from '../../store/package/subtree-memo-policy.ts';
import { createDocumentFurnitureSource } from '../document-furniture-source.ts';
import { createDocumentLinkProjectors } from '../document-link-projector.ts';
import { createDocumentStyleDependencies } from '../document-style-deps.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { NumberingIndex } from '../numbering-index.ts';
import { readTableStructure } from '../semantic-table.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Runs `make` in its own frame, so nothing on this stack keeps its result alive. */
function released(make: () => object): () => boolean {
  const ref = new WeakRef(make());
  return () => {
    Bun.gc(true);
    return ref.deref() === undefined;
  };
}

test('a large answer stays only for the latest revision of its node', () => {
  const memo = createSubtreeAggregateMemo<object>();
  const node = (children: number): OoxmlNode =>
    ({ kind: 'table', id: 'part#0.1', children: new Array(children) }) as unknown as OoxmlNode;
  const before = node(3);
  const after = node(4);
  const gone = released(() => {
    const answer = { ids: new Array(LARGE_SUBTREE_ANSWER) };
    memo.set(before, answer, LARGE_SUBTREE_ANSWER);
    return answer;
  });
  expect(memo.get(before)).toBeDefined();
  memo.set(after, { ids: [] }, LARGE_SUBTREE_ANSWER);
  // The older revision is still alive here, as the undo history keeps it.
  expect(memo.get(before)).toBeUndefined();
  expect(memo.get(after)).toBeDefined();
  expect(gone()).toBe(true);

  const small = node(1);
  memo.set(small, { ids: ['a'] }, 1);
  expect(memo.get(small)).toEqual({ ids: ['a'] });
});

test('a large answer that holds its own node does not keep the node alive', () => {
  const memo = createSubtreeAggregateMemo<object>();
  // A prepared table holds the table node it was prepared from. Once the document closes,
  // nothing else holds the node, and the memo must not either.
  const gone = released(() => {
    const table = { kind: 'table', id: 'part#0.1', children: [] } as unknown as OoxmlNode;
    memo.set(table, { table, rows: new Array(LARGE_SUBTREE_ANSWER) }, LARGE_SUBTREE_ANSWER);
    return table;
  });
  expect(gone()).toBe(true);
});

function tableXml(rows: number, text: string): string {
  let xml =
    '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>';
  for (let row = 0; row < rows; row += 1) {
    xml += `<w:tr><w:tc><w:p><w:r><w:t>${text} ${row}</w:t></w:r></w:p></w:tc></w:tr>`;
  }
  return `${xml}</w:tbl>`;
}

test('an edited table keeps only its two latest structures', () => {
  const table = (text: string) => {
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>${tableXml(40, text)}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const body = read.part.root.children[0] as OoxmlElement;
    return body.children[0] as OoxmlElement;
  };
  const before = table('Before');
  // An edit rebuilds the table node and shares its unchanged `w:tblPr`.
  const fresh = table('After');
  const after = {
    ...fresh,
    children: fresh.children.map((child) =>
      child.localName === 'tblPr' ? before.children[0]! : child
    ),
  } as OoxmlElement;
  const gone = released(() => readTableStructure(before, 400, 0)!);
  const previousGone = released(() => readTableStructure(after, 400, 0)!);
  const third = table('Newest');
  const newest = {
    ...third,
    children: third.children.map((child) =>
      child.localName === 'tblPr' ? before.children[0]! : child
    ),
  } as OoxmlElement;
  expect(readTableStructure(newest, 400, 0)).not.toBeNull();
  // The two update inputs stay cached. Older structures leave even while undo holds their trees.
  expect(before.kind).toBe('table');
  expect(after.kind).toBe('table');
  expect(gone()).toBe(true);
  expect(previousGone()).toBe(false);
});

function headerDocument() {
  const main = `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p/><w:sectPr><w:headerReference w:type="default" r:id="header"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720"/></w:sectPr></w:body></w:document>`;
  const loaded = openHeadlessDocument(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="header" Type="${R}/header" Target="header.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(main),
      'word/header.xml': strToU8(
        `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:hdr>`
      ),
    })
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.view;
}

test('a header laid out again does not keep the header story it replaced', () => {
  const view = headerDocument();
  let numbering = { abstractNums: new Map(), nums: new Map() } as unknown as NumberingIndex;
  const source = createDocumentFurnitureSource({
    view,
    measurer: createFixedMeasurer(6, 14),
    producer: 'retention-test',
    cache: createParagraphLayoutCache(),
    ...createDocumentStyleDependencies(view),
    numberingIndex: () => numbering,
    linkProjectors: createDocumentLinkProjectors(view),
    displayMode: 'proposed',
    drawingTokenForParagraphForPart: () => '',
  });
  const gone = released(() => source.furniture()!.headers.get('default')!);
  // A numbering edit lays the header out again; the new story's callbacks must not reach the
  // memo entry that held the old one.
  numbering = { abstractNums: new Map(), nums: new Map() } as unknown as NumberingIndex;
  const next = source.furniture()!.headers.get('default')!;
  expect(next.fragments.length).toBeGreaterThan(0);
  expect(gone()).toBe(true);
});
