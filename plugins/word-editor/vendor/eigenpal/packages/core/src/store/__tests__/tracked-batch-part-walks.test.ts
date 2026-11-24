// A batch of tracked replacements, each wrapped in a content control, in one transaction.
//
// Each group used to walk the whole part twice: once to re-find the highest revision id after
// the content control dropped the counter, and once to rebuild the node index for the
// note-stranding gate after the first op moved the index to the working root. On a long
// document that is seconds per transaction. These tests pin both walks and the ids.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { findNode, nodeIndexTestRecorder } from '../package/ooxml-edit.ts';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { revisionIdWalkRecorder } from '../store/tree-op-revision-ids.ts';
import type { TreeDocOp } from '../store/tree-ops.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PARAGRAPHS = 40;
const GROUPS = 20;
const REVISION = { author: 'Reviewer', date: '2026-01-01T00:00:00Z' };

function packageStore(): TreePackageStore {
  const body = Array.from(
    { length: PARAGRAPHS },
    (_, index) => `<w:p><w:r><w:t xml:space="preserve">Sequence ${index} text</w:t></w:r></w:p>`
  ).join('');
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        '</w:footnotes>'
    ),
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return new TreePackageStore(
    loaded.package,
    loaded.package.parts.get(loaded.package.mainDocumentPart)!
  );
}

function paragraphIds(store: TreePackageStore): string[] {
  const ids: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') ids.push(node.id);
    for (const child of node.children) visit(child);
  };
  visit(store.bodyStore().part.root);
  return ids;
}

/** Replace "Se" with "[1]", format the new text, and wrap it in a locked control. */
function citation(paragraphId: string): TreeDocOp[] {
  const range = { paragraphId, start: 2, end: 5 };
  return [
    { op: 'deleteText', paragraphId, start: 0, end: 2, revision: REVISION },
    { op: 'insertText', paragraphId, offset: 2, text: '[1]', revision: REVISION },
    { op: 'setRunProperties', ...range, properties: [{ localName: 'b' }] },
    {
      op: 'insertContentControl',
      ...range,
      type: 'richText',
      tag: 'citation',
      lock: 'contentLocked',
    },
  ] as TreeDocOp[];
}

function revisionIds(store: TreePackageStore): string[] {
  const ids: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if ('localName' in node && (node.localName === 'ins' || node.localName === 'del')) {
      const id = node.attributes.find((attribute) => attribute.localName === 'id')?.value;
      if (id !== undefined) ids.push(id);
    }
    for (const child of node.children) visit(child);
  };
  visit(store.bodyStore().part.root);
  return ids;
}

function applyBatch(store: TreePackageStore, ops: readonly TreeDocOp[]): void {
  const result = store.transact({ kind: 'body' }, (ctx) => {
    for (const op of ops) expect(ctx.apply(op)).toBe(true);
  });
  expect(result.ok).toBe(true);
}

describe('a batch of tracked citations walks the part once', () => {
  test('content controls keep the revision counter, and deletes keep the node index', () => {
    const store = packageStore();
    const ids = paragraphIds(store).slice(0, GROUPS);
    findNode(store.bodyStore().part, ids[0]!);
    const walks = revisionIdWalkRecorder();
    const index = nodeIndexTestRecorder();
    walks.reset();
    index.reset();

    applyBatch(
      store,
      ids.flatMap((id) => citation(id))
    );

    expect(walks.walks).toBe(1);
    expect(index.completeBuilds).toBe(0);
    const written = revisionIds(store);
    expect(written).toHaveLength(GROUPS * 2);
    expect(new Set(written).size).toBe(written.length);
  });

  test('a tracked control mints outside the counter, so the next group walks again', () => {
    const store = packageStore();
    const ids = paragraphIds(store).slice(0, GROUPS);
    const walks = revisionIdWalkRecorder();
    walks.reset();
    applyBatch(
      store,
      ids.flatMap((id) => [
        ...citation(id),
        {
          op: 'insertInlineContentControl',
          paragraphId: id,
          offset: 9,
          tag: 'note',
          text: 'ref',
          revision: REVISION,
        } as TreeDocOp,
      ])
    );
    // One walk for the counter after each tracked control, and one for each control's own id.
    expect(walks.walks).toBe(GROUPS * 2);
    const written = revisionIds(store);
    expect(written).toHaveLength(GROUPS * 3);
    expect(new Set(written).size).toBe(written.length);
  });
});
