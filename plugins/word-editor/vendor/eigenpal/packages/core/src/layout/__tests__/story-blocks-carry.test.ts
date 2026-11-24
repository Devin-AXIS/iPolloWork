// A keystroke makes a new story root whose children are the previous objects but the edited
// paragraph. The story's block list is carried from the previous one with that paragraph's
// block swapped in, and must equal the list built from scratch, with what list numbering
// reads alongside it.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { numberingFlowBlocks } from '../hidden-paragraph-mark.ts';
import { storyBlocks } from '../story-roots.ts';
import { paragraphsWithOrdinaryMoves } from '../../store/store/revision-move-ranges.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(body: string): OoxmlPart {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

const numbered = (text: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
/** An empty numbered paragraph whose mark is hidden: it leaves the flow, and still counts. */
const hiddenNumbered =
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:rPr><w:vanish/></w:rPr></w:pPr></w:p>';
const plain = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** The same tree, every node a new object: no cache can answer for it. */
function cold(source: OoxmlPart): OoxmlPart {
  return { ...source, root: JSON.parse(JSON.stringify(source.root)) as OoxmlNode };
}

const ids = (blocks: readonly { readonly id: string }[]) => blocks.map((block) => block.id);

describe('story blocks after a keystroke', () => {
  test('keep the paragraphs a hidden mark took out of the flow in the numbering list', () => {
    const before = part(
      numbered('one') + hiddenNumbered + numbered('two') + plain('typed here') + plain('end')
    );
    const first = storyBlocks(before);
    expect(numberingFlowBlocks(first).length).toBe(first.length + 1);
    const typed = first.findIndex((block) => JSON.stringify(block).includes('typed here'));
    const typedId = first[typed]!.id;
    const edited = applyTreeOp(before, {
      op: 'insertText',
      paragraphId: typedId,
      offset: 5,
      text: 'x',
    });
    if (!edited.ok) throw new Error('edit refused');
    const carried = storyBlocks(edited.part);
    expect(carried).not.toBe(first);
    expect(carried[0]).toBe(first[0]);
    const fresh = storyBlocks(cold(edited.part));
    expect(ids(carried)).toEqual(ids(fresh));
    expect(ids(numberingFlowBlocks(carried))).toEqual(ids(numberingFlowBlocks(fresh)));
  });
});

describe('story blocks after an edit to a table of contents field', () => {
  const field = (type: string) => `<w:r><w:fldChar w:fldCharType="${type}"/></w:r>`;
  const begin =
    '<w:p>' +
    field('begin') +
    '<w:r><w:instrText> TOC \\o "1-3" </w:instrText></w:r>' +
    field('separate') +
    '<w:r><w:t>entry</w:t></w:r></w:p>';
  // A style separator: its hidden mark joins the next paragraph, unless a TOC holds it.
  const separator =
    '<w:p><w:pPr><w:rPr><w:vanish/><w:specVanish/></w:rPr></w:pPr><w:r><w:t>Heading</w:t></w:r></w:p>';

  test('lay the neighbours out again when the field changes', () => {
    const before = part(
      begin + separator + plain('after') + `<w:p>${field('end')}</w:p>` + plain('tail')
    );
    const first = storyBlocks(before);
    const without = part(begin + separator + plain('after') + plain('x') + plain('tail'));
    const body = (source: OoxmlPart) =>
      source.root.children.find((child) => child.kind === 'body') as OoxmlElement;
    const children = [...body(before).children];
    const replacement = body(without).children[3]!;
    expect(replacement.id).toBe(children[3]!.id);
    children[3] = replacement;
    const edited: OoxmlPart = {
      ...before,
      root: {
        ...(before.root as OoxmlElement),
        children: before.root.children.map((child) =>
          child.kind === 'body' ? { ...child, children } : child
        ),
      } as OoxmlNode,
    };
    const carried = storyBlocks(edited);
    const fresh = storyBlocks(cold(edited));
    expect(fresh.length).toBe(first.length - 1);
    expect(ids(carried)).toEqual(ids(fresh));
  });
});

describe('the paragraphs that hold an ordinary move range', () => {
  const stamp = 'w:author="Ada" w:date="2026-01-01T00:00:00Z"';
  test('a range inside a paragraph names that paragraph', () => {
    const root = part(
      `<w:p><w:moveFromRangeStart w:id="1" w:name="m" ${stamp}/><w:moveFrom w:id="2" ${stamp}><w:r><w:t>moved</w:t></w:r></w:moveFrom><w:moveFromRangeEnd w:id="1"/></w:p>` +
        plain('elsewhere')
    ).root;
    const found = paragraphsWithOrdinaryMoves(root);
    expect(found).not.toBe('everywhere');
    expect(found === 'everywhere' ? 0 : found.size).toBeLessThanOrEqual(1);
  });

  test('a range between blocks reaches every card', () => {
    const root = part(
      `<w:moveFromRangeStart w:id="1" w:name="m" ${stamp}/>` +
        `<w:p><w:del w:id="2" ${stamp}><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>` +
        `<w:moveFromRangeEnd w:id="1"/>` +
        plain('elsewhere')
    ).root;
    expect(paragraphsWithOrdinaryMoves(root)).toBe('everywhere');
  });
});

describe('story blocks after a table edit', () => {
  const table =
    '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
    '<w:tr><w:tc>' +
    plain('cell') +
    '</w:tc></w:tr></w:tbl>';

  test('does not revisit unrelated paragraphs when a visible table changes', () => {
    const source = part(plain('before') + hiddenNumbered + table + plain('after'));
    const body = source.root.children.find((node) => node.kind === 'body') as OoxmlElement;
    let siblingReads = 0;
    const watched = new Proxy(body.children[0]!, {
      get(target, property, receiver) {
        if (property === 'kind') siblingReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const before: OoxmlPart = {
      ...source,
      root: {
        ...source.root,
        children: source.root.children.map((node) =>
          node === body
            ? {
                ...body,
                children: [watched, ...body.children.slice(1)],
              }
            : node
        ),
      },
    };
    const first = storyBlocks(before);
    const tableBlock = first.find((block) => block.kind === 'table')!;
    const findParagraph = (node: OoxmlNode): OoxmlNode | undefined =>
      node.kind === 'paragraph'
        ? node
        : node.kind === 'textValue'
          ? undefined
          : node.children.map(findParagraph).find(Boolean);
    const edited = applyTreeOp(before, {
      op: 'insertText',
      paragraphId: findParagraph(tableBlock)!.id,
      offset: 2,
      text: 'x',
    });
    if (!edited.ok) throw Error(edited.reason);
    siblingReads = 0;
    const carried = storyBlocks(edited.part);
    expect(siblingReads).toBe(0);
    const fresh = storyBlocks(cold(edited.part));
    expect(carried).toEqual(fresh);
    expect(numberingFlowBlocks(carried)).toEqual(numberingFlowBlocks(fresh));
    expect(carried[0]).toBe(first[0]);
  });
});
