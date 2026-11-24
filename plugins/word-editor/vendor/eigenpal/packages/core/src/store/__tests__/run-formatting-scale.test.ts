// Formatting a paragraph emits one `setRunProperties` op per run it covers. Each op used to
// re-walk the whole paragraph several times and search every run for each split, so one press
// over a paragraph of many runs cost its run count squared or worse.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import { serializeOoxmlPart } from '../package/ooxml-tree.ts';
import { findNode } from '../package/ooxml-edit.ts';
import { countContentControlScansForTest } from '../package/content-control-nodes.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { runPropertyEdits } from '../store/direct-properties.ts';
import {
  countParagraphWalksForTest,
  segmentsOf,
  segmentsOfCopy,
  transientParagraphOffsetIndex,
} from '../store/tree-op-segments.ts';
import type { OoxmlParagraphNode } from '../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PROPS = [
  '<w:b/>',
  '<w:u w:val="single"/>',
  '<w:color w:val="C00000"/>',
  '<w:sz w:val="24"/>',
  '',
];

function storeOf(paragraphXml: string): TreeDocumentStore {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${paragraphXml}</w:body></w:document>`
    ),
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return new TreeDocumentStore(loaded.package, loaded.package.mainDocumentPart);
}

const manyRuns = (count: number): string =>
  `<w:p>${Array.from(
    { length: count },
    (_, index) =>
      `<w:r><w:rPr>${PROPS[index % PROPS.length]}</w:rPr><w:t xml:space="preserve">abc </w:t></w:r>`
  ).join('')}</w:p>`;

function firstParagraph(store: TreeDocumentStore): OoxmlParagraphNode {
  const body = store.part.root.children.find((node) => node.kind === 'body')!;
  return (body as { children: readonly OoxmlParagraphNode[] }).children.find(
    (node) => node.kind === 'paragraph'
  )!;
}

/** Italicize `[start, end)` the way the editor does: one op per covered run, one transaction. */
function italicize(store: TreeDocumentStore, start: number, end: number): void {
  const paragraphId = firstParagraph(store).id;
  const edits = runPropertyEdits(store.part, paragraphId, start, end, { localName: 'i' });
  const result = store.transact((ctx) => {
    for (const edit of edits) {
      ctx.apply({
        op: 'setRunProperties',
        paragraphId,
        start: edit.start,
        end: edit.end,
        properties: edit.properties,
        ...(edit.targetRunIds ? { targetRunIds: edit.targetRunIds } : {}),
      });
    }
  });
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result)}`);
}

describe('formatting a paragraph of many runs', () => {
  test('every covered run gains the property and keeps its own', () => {
    const store = storeOf(manyRuns(40));
    // Mid-run edges: both ends split.
    italicize(store, 1, 40 * 4 - 1);
    const xml = serializeOoxmlPart(store.part);
    expect(xml.match(/<w:i\/>/g)?.length).toBe(40);
    expect(
      xml.match(/<w:color w:val="C00000"\/><w:i\/>|<w:i\/><w:color w:val="C00000"\/>/g)?.length
    ).toBe(8);
    // The split ends keep their own formatting outside the range.
    expect(xml).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t>a</w:t></w:r>');
    expect(xml).toContain('<w:r><w:rPr/><w:t xml:space="preserve"> </w:t></w:r>');
  });

  test('the segments handed across a property write match a fresh walk', () => {
    const store = storeOf(
      '<w:p>' +
        '<w:r><w:t xml:space="preserve">one </w:t></w:r>' +
        `<w:hyperlink w:anchor="x"><w:r><w:rPr><w:b/></w:rPr><w:t>link</w:t></w:r></w:hyperlink>` +
        '<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent><w:r><w:t>field</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:tab/><w:t xml:space="preserve"> two </w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>3</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '<w:ins w:id="1" w:author="a"><w:r><w:t xml:space="preserve"> added</w:t></w:r></w:ins>' +
        '<w:del w:id="2" w:author="a"><w:r><w:delText xml:space="preserve"> gone</w:delText></w:r></w:del>' +
        '<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> end</w:t></w:r>' +
        '</w:p>'
    );
    const before = firstParagraph(store);
    const length = segmentsOf(before).at(-1)!.end;
    italicize(store, 0, length);
    const after = findNode(store.part, before.id) as OoxmlParagraphNode;
    expect(after).not.toBe(before);
    const fresh = transientParagraphOffsetIndex(after).segments;
    const strip = (segments: ReturnType<typeof segmentsOf>) =>
      segments.map((segment) => ({
        runId: segment.runId,
        nodeId: segment.node.id,
        start: segment.start,
        end: segment.end,
      }));
    expect(strip(segmentsOf(after))).toEqual(strip(fresh));
    // And the nodes the memo names are the nodes in the new tree.
    for (const segment of segmentsOf(after)) {
      expect(findNode(store.part, segment.node.id)).toBe(segment.node);
    }
  });

  test('a press walks the paragraph a fixed number of times, whatever its run count', () => {
    const walksFor = (count: number): number => {
      const store = storeOf(manyRuns(count));
      return countParagraphWalksForTest(() => italicize(store, 1, count * 4 - 1));
    };
    // Each op used to walk the whole paragraph again: walks grew with the run count.
    const small = walksFor(50);
    expect(walksFor(500)).toBe(small);
    expect(small).toBeLessThan(20);
  });

  test('a press scans the paragraph for controls a fixed number of times', () => {
    const scansFor = (count: number): number => {
      const store = storeOf(manyRuns(count));
      return countContentControlScansForTest(() => italicize(store, 1, count * 4 - 1));
    };
    expect(scansFor(500)).toBe(scansFor(50));
  });

  test('a simple field keeps its own nodes when its result run is formatted', () => {
    const store = storeOf(
      '<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>' +
        '<w:fldSimple w:instr=" PAGE "><w:r><w:t>3</w:t></w:r></w:fldSimple>' +
        '<w:r><w:t xml:space="preserve"> of many</w:t></w:r></w:p>'
    );
    const before = firstParagraph(store);
    italicize(store, 0, segmentsOf(before).at(-1)!.end);
    const after = findNode(store.part, before.id) as OoxmlParagraphNode;
    expect(serializeOoxmlPart(store.part).match(/<w:i\/>/g)?.length).toBe(3);
    // Every node a segment names is the node in the new tree, the field included.
    for (const segment of segmentsOf(after)) {
      expect(findNode(store.part, segment.node.id)).toBe(segment.node);
    }
  });

  test('a host owns the segments the public entry point returns', () => {
    const store = storeOf(manyRuns(3));
    const paragraph = firstParagraph(store);
    const copy = segmentsOfCopy(paragraph);
    (copy[0] as { end: number }).end += 100;
    expect(segmentsOf(paragraph)[0]!.end).toBe(4);
  });
});
