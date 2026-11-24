import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  TreeDocumentStore,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { treeSchema } from '../tree-schema.ts';
import { bodyParagraphs, docToTreeOps, treeToDoc } from '../tree-binding.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:mc="${MC}" xmlns:e="urn:foreign" mc:Ignorable="e">` +
      `<w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const FOREIGN_RUN =
  '<w:p><w:r><w:rPr><e:b/><w:i/><w:sz w:val="24" e:val="48"/></w:rPr><w:t>styled</w:t></w:r></w:p>';

describe('projected run property namespaces', () => {
  test('only qualified children and attributes project as run properties', () => {
    const text = treeToDoc(load(FOREIGN_RUN)).child(0).child(0);
    const mark = text.marks.find((candidate) => candidate.type.name === 'runProps');
    expect(mark?.attrs.props).toEqual([
      { localName: 'i' },
      { localName: 'sz', attributes: { val: '24' } },
    ]);
  });

  test('a formatting edit keeps foreign extensions and writes only qualified properties', () => {
    const part = load(FOREIGN_RUN);
    const id = bodyParagraphs(part)[0]!.id;
    const doc = treeSchema.node('doc', null, [
      treeSchema.node('paragraph', { nodeId: id, props: [] }, [
        treeSchema.text('styled', [
          treeSchema.marks.runProps.create({
            props: [{ localName: 'b' }, { localName: 'sz', attributes: { val: '24' } }],
          }),
        ]),
      ]),
    ]);
    const mapped = docToTreeOps(part, doc);
    if (!mapped.ok) throw new Error(mapped.reason);
    const store = new TreeDocumentStore(part);
    const result = store.transact((ctx) => {
      for (const op of mapped.ops) ctx.apply(op);
    });
    if (!result.ok) throw new Error(result.reason);
    const xml = serializeOoxmlPart(store.part);
    expect(xml).toContain('<e:b/>');
    expect(xml).toContain('<w:b/>');
    expect(xml).not.toContain('<w:i/>');
    expect(xml).toContain('w:val="24"');
  });
});
