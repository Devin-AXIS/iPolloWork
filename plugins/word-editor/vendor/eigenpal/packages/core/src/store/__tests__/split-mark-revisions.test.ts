// A split keeps the original paragraph mark, and its revisions, on the last piece only.
import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../package/ooxml-tree.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import { storyParagraphs } from '../package/story-blocks.ts';
import { attributeTrackedOps } from '../../editor/surface-tracked-ops.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import type { TreeDocOp } from '../store/tree-ops.ts';
import { withoutOriginalMark } from '../store/tree-op-split-mark.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): { part: OoxmlPart; paragraphId: string } {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const body2 = read.part.root.children.find((node) => node.kind === 'body')!;
  return { part: read.part, paragraphId: storyParagraphs(body2)[0]!.id };
}

const DELETED_MARK = (inner = '') =>
  `<w:p><w:pPr>${inner}<w:rPr><w:del w:id="9" w:author="Other" w:date="2026-01-01T00:00:00Z"/>` +
  '</w:rPr></w:pPr><w:r><w:t>Hello world</w:t></w:r></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p>';

function apply(part: OoxmlPart, ops: readonly TreeDocOp[]): OoxmlPart {
  let current = part;
  for (const op of ops) {
    const result = applyTreeOp(current, op);
    if (!result.ok) throw new Error(result.reason);
    current = result.part;
  }
  return current;
}

const ids = (xml: string) => [...xml.matchAll(/w:id="([^"]+)"/g)].map((match) => match[1]);

describe('split marks', () => {
  test('Enter in suggesting mode at a paragraph whose mark another author deleted', () => {
    const { part, paragraphId } = load(DELETED_MARK('<w:jc w:val="center"/>'));
    const ops = attributeTrackedOps(
      [{ op: 'splitParagraph', paragraphId, offset: 6 }],
      { author: 'Bob', date: '2026-01-02T00:00:00Z' },
      true
    );
    const xml = serializeOoxmlPart(apply(part, ops));
    const [head, tail] = xml.split('</w:p>');
    expect(head).toContain('<w:jc w:val="center"/>');
    expect(head).toMatch(/<w:rPr><w:ins w:author="Bob"/);
    expect(head).not.toContain('Other');
    expect(tail).toContain('<w:jc w:val="center"/>');
    expect(tail).toMatch(
      /<w:rPr><w:del w:author="Other" w:date="2026-01-01T00:00:00Z" w:id="9"\/>/
    );
    expect(new Set(ids(xml)).size).toBe(ids(xml).length);
  });

  test('a many-split keeps the deleted mark on the last piece only, tracked or not', () => {
    for (const revision of [undefined, { author: 'Bob', date: '2026-01-02T00:00:00Z' }]) {
      const { part, paragraphId } = load(DELETED_MARK());
      const xml = serializeOoxmlPart(
        apply(part, [
          {
            op: 'splitParagraphMany',
            paragraphId,
            offsets: [2, 6],
            ...(revision ? { revision } : {}),
          },
        ])
      );
      expect(xml.match(/w:author="Other"/g)).toHaveLength(1);
      const pieces = xml.split('</w:p>');
      expect(pieces[2]).toContain('w:author="Other"');
      // The original mark's id is never copied. The new marks of one split are one proposal.
      expect(ids(xml).filter((id) => id === '9')).toHaveLength(1);
    }
  });

  test('withoutOriginalMark keeps formatting and drops what belongs to the mark', () => {
    const { part } = load(
      '<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:b/><w:ins w:id="1" w:author="A"/></w:rPr>' +
        '<w:sectPr/></w:pPr></w:p>'
    );
    const paragraph = storyParagraphs(part.root.children.find((node) => node.kind === 'body')!)[0]!;
    const pPr = paragraph.kind === 'textValue' ? undefined : paragraph.children[0];
    const kept = withoutOriginalMark(pPr!);
    const names = (node: typeof kept) =>
      node && node.kind !== 'textValue'
        ? node.children.map((child) => (child.kind === 'textValue' ? '' : child.localName))
        : [];
    expect(names(kept)).toEqual(['jc', 'rPr']);
    const rPr = kept && kept.kind !== 'textValue' ? kept.children[1] : undefined;
    expect(names(rPr)).toEqual(['b']);
  });
});
