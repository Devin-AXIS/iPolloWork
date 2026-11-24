import { expect, test } from 'bun:test';
import {
  bodyStoryRoot,
  readOoxmlPart,
  storyParagraphs,
  type OoxmlNode,
  type OoxmlPart,
} from '../index.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function parse(body: string) {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${body}</w:p></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function contains(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    (node.localName === localName || node.children.some((child) => contains(child, localName)))
  );
}

function text(node: OoxmlNode): string {
  return node.kind === 'textValue' ? node.value : node.children.map(text).join('');
}

function firstParagraph(source: OoxmlPart) {
  const paragraph = storyParagraphs(bodyStoryRoot(source)!)[0];
  if (paragraph?.kind !== 'paragraph') throw Error('The fixture paragraph is missing');
  return paragraph;
}

for (const kind of ['footnote', 'endnote'] as const) {
  test(`typing after a terminal ${kind} reference uses a separate ordinary run`, () => {
    const reference =
      `<w:r><w:rPr><w:rStyle w:val="${kind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference'}"/>` +
      `<w:vertAlign w:val="superscript"/></w:rPr><w:${kind}Reference w:id="1"/></w:r>`;
    const before = parse(`<w:r><w:t>Text</w:t></w:r>${reference}`);
    const paragraph = firstParagraph(before);
    const result = applyTreeOp(before, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 5,
      text: '#',
    });
    if (!result.ok) throw new Error(result.reason);
    const after = firstParagraph(result.part);
    const typed = after.children.find((node) => node.kind === 'run' && text(node).endsWith('#'));
    expect(typed).toBeDefined();
    expect(contains(typed!, `${kind}Reference`)).toBe(false);
    expect(contains(typed!, 'rStyle')).toBe(false);
    expect(contains(typed!, 'vertAlign')).toBe(false);
    expect(after.children.filter((node) => contains(node, `${kind}Reference`))).toHaveLength(1);
  });
}

test('ordinary terminal typing retains its authored character formatting', () => {
  const before = parse('<w:r><w:rPr><w:b/></w:rPr><w:t>Text</w:t></w:r>');
  const paragraph = firstParagraph(before);
  const result = applyTreeOp(before, {
    op: 'insertText',
    paragraphId: paragraph.id,
    offset: 4,
    text: '#',
  });
  if (!result.ok) throw new Error(result.reason);
  const after = firstParagraph(result.part);
  const typed = after.children.find((node) => node.kind === 'run' && text(node).endsWith('#'));
  expect(typed).toBeDefined();
  expect(contains(typed!, 'b')).toBe(true);
});
