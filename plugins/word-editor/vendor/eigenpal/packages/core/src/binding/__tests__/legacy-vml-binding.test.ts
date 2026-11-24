import { describe, expect, test } from 'bun:test';
import type { Node as PMNode } from 'prosemirror-model';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { findNode } from '../../store/package/ooxml-edit.ts';
import { TreeDocumentStore } from '../../store/store/tree-store.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import { bodyParagraphs, docToTreeOps, treeToDoc } from '../tree-binding.ts';
import { treeSchema } from '../tree-schema.ts';

const PICTURE = '<w:pict><v:rect style="width:100pt;height:100pt" stroked="f"/></w:pict>';

function load(content = `<w:p><w:r>${PICTURE}<w:t>A</w:t></w:r></w:p>`): OoxmlPart {
  const result = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>' +
      content +
      '</w:body></w:document>',
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function pictures(root: OoxmlNode): OoxmlNode[] {
  if (root.kind === 'textValue') return [];
  if (root.localName === 'pict') return [root];
  return root.children.flatMap(pictures);
}

function paragraph(
  original: PMNode,
  content: readonly PMNode[],
  nodeId = original.attrs.nodeId
): PMNode {
  return treeSchema.node('paragraph', { ...original.attrs, nodeId }, content);
}

function document(content: readonly PMNode[]): PMNode {
  return treeSchema.node('doc', null, content);
}

function commit(part: OoxmlPart, doc: PMNode): OoxmlPart {
  const mapped = docToTreeOps(part, doc);
  expect(mapped.ok).toBe(true);
  if (!mapped.ok) throw new Error(mapped.reason);
  const store = new TreeDocumentStore(part);
  const result = store.transact((ctx) => {
    for (const op of mapped.ops) ctx.apply(op);
  });
  expect(result.ok).toBe(true);
  for (const picture of pictures(part.root)) {
    const preserved = findNode(store.part, picture.id);
    expect(preserved).not.toBeNull();
    expect(canonicalOoxmlFingerprint(preserved!)).toBe(canonicalOoxmlFingerprint(picture));
  }
  return store.part;
}

describe('native VML binding model offsets', () => {
  test.each([
    '<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Photo"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="urn:clip"/></a:graphic></wp:inline></w:drawing>',
    '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent>',
  ])('replacing text also preserves existing drawing atom offsets: %s', (atom) => {
    const part = load(`<w:p><w:r>${atom}<w:t>A</w:t></w:r></w:p>`);
    const projected = treeToDoc(part).child(0);
    const changed = document([paragraph(projected, [projected.child(0), treeSchema.text('B')])]);
    const mapped = docToTreeOps(part, changed);
    expect(mapped.ok && mapped.ops).toEqual([
      { op: 'deleteText', paragraphId: projected.attrs.nodeId, start: 1, end: 2 },
      { op: 'insertText', paragraphId: projected.attrs.nodeId, offset: 1, text: 'B' },
    ]);
    expect(paragraphTextOf(commit(part, changed), projected.attrs.nodeId)).toBe('\ufffcB');
  });

  test('replacing text after a VML atom does not delete the picture', () => {
    const part = load(),
      projected = treeToDoc(part).child(0);
    const changed = document([paragraph(projected, [projected.child(0), treeSchema.text('B')])]);
    const mapped = docToTreeOps(part, changed);
    expect(mapped.ok && mapped.ops).toEqual([
      { op: 'deleteText', paragraphId: projected.attrs.nodeId, start: 1, end: 2 },
      { op: 'insertText', paragraphId: projected.attrs.nodeId, offset: 1, text: 'B' },
    ]);
    expect(paragraphTextOf(commit(part, changed), projected.attrs.nodeId)).toBe('\ufffcB');
  });

  test('typing before a VML atom shifts its model position without replacing it', () => {
    const part = load(`<w:p><w:r><w:t>A</w:t>${PICTURE}<w:t>B</w:t></w:r></w:p>`);
    const projected = treeToDoc(part).child(0);
    const changed = document([
      paragraph(projected, [treeSchema.text('A😀'), projected.child(1), projected.child(2)]),
    ]);
    expect(paragraphTextOf(commit(part, changed), projected.attrs.nodeId)).toBe('A😀\ufffcB');
  });

  test('formatting adjacent text excludes the picture model unit', () => {
    const part = load(),
      projected = treeToDoc(part).child(0);
    const bold = treeSchema.marks.runProps.create({ props: [{ localName: 'b' }] });
    const changed = document([
      paragraph(projected, [projected.child(0), treeSchema.text('A', [bold])]),
    ]);
    const mapped = docToTreeOps(part, changed);
    expect(mapped.ok && mapped.ops).toEqual([
      {
        op: 'setRunProperties',
        paragraphId: projected.attrs.nodeId,
        start: 1,
        end: 2,
        properties: [{ localName: 'b', attributes: {} }],
      },
    ]);
    commit(part, changed);
  });

  for (const splitAfterPicture of [false, true]) {
    test(`splitting ${splitAfterPicture ? 'after' : 'before'} a picture preserves its node`, () => {
      const part = load(`<w:p><w:r><w:t>A</w:t>${PICTURE}<w:t>B</w:t></w:r></w:p>`);
      const projected = treeToDoc(part).child(0);
      const head = splitAfterPicture
        ? [projected.child(0), projected.child(1)]
        : [projected.child(0)];
      const tail = splitAfterPicture
        ? [projected.child(2)]
        : [projected.child(1), projected.child(2)];
      const after = commit(
        part,
        document([paragraph(projected, head), paragraph(projected, tail, null)])
      );
      const texts = bodyParagraphs(after).map((p) => paragraphTextOf(after, p.id));
      expect(texts).toEqual(splitAfterPicture ? ['A\ufffc', 'B'] : ['A', '\ufffcB']);
    });
  }

  test('joining paragraphs preserves pictures on both sides', () => {
    const part = load(
      `<w:p><w:r><w:t>A</w:t>${PICTURE}</w:r></w:p><w:p><w:r>${PICTURE}<w:t>B</w:t></w:r></w:p>`
    );
    const projected = treeToDoc(part),
      first = projected.child(0),
      second = projected.child(1);
    const after = commit(
      part,
      document([
        paragraph(first, [first.child(0), first.child(1), second.child(0), second.child(1)]),
      ])
    );
    expect(paragraphTextOf(after, first.attrs.nodeId)).toBe('A\ufffc\ufffcB');
  });

  test('forged unknownInline attributes cannot override canonical atom length', () => {
    const part = load(),
      projected = treeToDoc(part).child(0);
    const forged = treeSchema.node('unknownInline', {
      ...projected.child(0).attrs,
      modelLength: 0,
      length: 0,
      label: 'not a picture',
    });
    const after = commit(part, document([paragraph(projected, [forged, treeSchema.text('B')])]));
    expect(paragraphTextOf(after, projected.attrs.nodeId)).toBe('\ufffcB');
  });

  test('refuses missing, substituted or duplicated atom ids', () => {
    const part = load(),
      projected = treeToDoc(part).child(0);
    const alien = treeSchema.node('unknownInline', { nodeId: 'forged', modelLength: 1 });
    for (const content of [
      [projected.child(1)],
      [alien, projected.child(1)],
      [projected.child(0), projected.child(0), projected.child(1)],
    ]) {
      expect(docToTreeOps(part, document([paragraph(projected, content)])).ok).toBe(false);
    }
  });

  test('refuses a replacement that crosses a retained picture', () => {
    const part = load(`<w:p><w:r><w:t>A</w:t>${PICTURE}<w:t>B</w:t></w:r></w:p>`);
    const projected = treeToDoc(part).child(0);
    expect(
      docToTreeOps(
        part,
        document([
          paragraph(projected, [treeSchema.text('X'), projected.child(1), treeSchema.text('Y')]),
        ])
      ).ok
    ).toBe(false);
  });

  test('split and join refuse reordered or missing pictures', () => {
    const part = load(`<w:p><w:r><w:t>A</w:t>${PICTURE}${PICTURE}<w:t>B</w:t></w:r></w:p>`);
    const projected = treeToDoc(part).child(0);
    expect(
      docToTreeOps(
        part,
        document([
          paragraph(projected, [projected.child(0), projected.child(2)]),
          paragraph(projected, [projected.child(1), projected.child(3)], null),
        ])
      ).ok
    ).toBe(false);
    const separate = load(`<w:p><w:r>${PICTURE}</w:r></w:p><w:p><w:r>${PICTURE}</w:r></w:p>`);
    const doc = treeToDoc(separate);
    expect(
      docToTreeOps(
        separate,
        document([paragraph(doc.child(0), [doc.child(1).child(0), doc.child(0).child(0)])])
      ).ok
    ).toBe(false);
  });

  test('unsupported floating VML retains its previous zero-length model', () => {
    const part = load(
      `<w:p><w:r>${PICTURE.replace('width:100pt;', 'position:absolute;rotation:90;width:100pt;')}<w:t>A</w:t></w:r></w:p>`
    );
    const projected = treeToDoc(part).child(0);
    const changed = document([paragraph(projected, [projected.child(0), treeSchema.text('B')])]);
    expect(paragraphTextOf(commit(part, changed), projected.attrs.nodeId)).toBe('B');
  });

  test('unsupported VML on the line keeps one placeholder atom through a text edit', () => {
    const part = load(
      `<w:p><w:r>${PICTURE.replace('width:100pt;', 'rotation:90;width:100pt;')}<w:t>A</w:t></w:r></w:p>`
    );
    const projected = treeToDoc(part).child(0);
    const changed = document([paragraph(projected, [projected.child(0), treeSchema.text('B')])]);
    expect(paragraphTextOf(commit(part, changed), projected.attrs.nodeId)).toBe('\uFFFCB');
  });
});

test('editing text beside a framed object preserves the object atom', () => {
  const object =
    '<w:object xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><v:shape type="#_x0000_t75" style="width:10pt;height:56pt"><v:imagedata r:id="preview"/></v:shape></w:object>';
  const part = load(
    `<w:p><w:pPr><w:framePr w:y="-854"/></w:pPr><w:r>${object}<w:t>A</w:t></w:r></w:p>`
  );
  const projected = treeToDoc(part).child(0);
  const changed = document([paragraph(projected, [projected.child(0), treeSchema.text('B')])]);
  expect(paragraphTextOf(commit(part, changed), projected.attrs.nodeId)).toBe('\ufffcB');
});
