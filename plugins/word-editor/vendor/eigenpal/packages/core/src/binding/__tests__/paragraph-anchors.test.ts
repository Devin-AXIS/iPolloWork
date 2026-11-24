// The paraId ↔ node-id index (paragraph-anchors.ts): built over the editable set,
// verbatim values out, case-insensitive lookups in, reading-order ordinals.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { buildParagraphAnchorIndex } from '../paragraph-anchors.ts';
import { allParagraphs } from '../tree-binding.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

describe('buildParagraphAnchorIndex', () => {
  test('covers body, table-cell and block-SDT paragraphs with reading-order ordinals', () => {
    const part = load(
      '<w:p w14:paraId="4C000001"><w:r><w:t>one</w:t></w:r></w:p>' +
        '<w:tbl><w:tr><w:tc><w:p w14:paraId="4C000002"><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        '<w:sdt><w:sdtContent><w:p w14:paraId="4C000003"><w:r><w:t>sdt</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
        '<w:p w14:paraId="4C000004"><w:r><w:t>last</w:t></w:r></w:p>'
    );
    const index = buildParagraphAnchorIndex([part]);
    const ids = allParagraphs(part).map((paragraph) => paragraph.id);
    expect(ids).toHaveLength(4);
    ids.forEach((nodeId, ordinal) => {
      expect(index.ordinalByNode.get(nodeId)).toBe(ordinal);
    });
    expect(ids.map((nodeId) => index.paraIdByNode.get(nodeId))).toEqual([
      '4C000001',
      '4C000002',
      '4C000003',
      '4C000004',
    ]);
    expect(index.nodeByParaId.get('4C000002')).toBe(ids[1]!);
  });

  test('values stay verbatim; lookup keys are uppercased', () => {
    const part = load('<w:p w14:paraId="4c00aa0e"><w:r><w:t>x</w:t></w:r></w:p>');
    const index = buildParagraphAnchorIndex([part]);
    const [nodeId] = allParagraphs(part).map((paragraph) => paragraph.id);
    expect(index.paraIdByNode.get(nodeId!)).toBe('4c00aa0e');
    expect(index.nodeByParaId.get('4C00AA0E')).toBe(nodeId!);
    expect(index.nodeByParaId.has('4c00aa0e')).toBe(false);
  });

  test('duplicates: first occurrence wins the reverse map, both keep forward entries', () => {
    const part = load(
      '<w:p w14:paraId="4C000001"><w:r><w:t>a</w:t></w:r></w:p>' +
        '<w:p w14:paraId="4C000001"><w:r><w:t>b</w:t></w:r></w:p>'
    );
    const index = buildParagraphAnchorIndex([part]);
    const [first, second] = allParagraphs(part).map((paragraph) => paragraph.id);
    expect(index.nodeByParaId.get('4C000001')).toBe(first!);
    expect(index.paraIdByNode.get(second!)).toBe('4C000001');
  });

  test('a paragraph without a paraId keeps its ordinal but is absent from the id maps', () => {
    const part = load(
      '<w:p><w:r><w:t>bare</w:t></w:r></w:p><w:p w14:paraId="4C000001"><w:r><w:t>x</w:t></w:r></w:p>'
    );
    const index = buildParagraphAnchorIndex([part]);
    const [bare, identified] = allParagraphs(part).map((paragraph) => paragraph.id);
    expect(index.ordinalByNode.get(bare!)).toBe(0);
    expect(index.paraIdByNode.has(bare!)).toBe(false);
    expect(index.paraIdByNode.get(identified!)).toBe('4C000001');
  });
});
