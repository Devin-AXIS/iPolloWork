// Serialization reuses the markup of paragraphs and table rows an edit did not rebuild. These
// tests hold the memo to one rule: the output is always what a cold serialization of the same
// tree produces. A cold serialization here is one of a structural clone, whose nodes no
// earlier save has seen.
import { describe, expect, test } from 'bun:test';
import { replaceNode } from '../ooxml-edit.ts';
import { canonicalSerializeNodeVisits } from '../ooxml-serialize.ts';
import { serializeOoxmlPartSteps } from '../ooxml-serialize-steps.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(xml: string): OoxmlPart {
  const read = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

function documentXml(body: string, rootAttributes = ''): string {
  return `<w:document xmlns:w="${W}"${rootAttributes}><w:body>${body}</w:body></w:document>`;
}

const XML_SPACE_PRESERVE = {
  kind: 'genericExtension',
  namespaceUri: 'http://www.w3.org/XML/1998/namespace',
  localName: 'space',
  value: 'preserve',
} as const;

function bodyOf(value: OoxmlPart): OoxmlElement {
  const body = value.root.children.find((child) => child.kind !== 'textValue');
  if (!body || body.kind === 'textValue') throw new Error('no body');
  return body;
}

/** `value` with new body children and, optionally, extra body attributes. */
function withBodyChildren(
  value: OoxmlPart,
  children: readonly OoxmlNode[],
  attributes: readonly object[] = []
): OoxmlPart {
  const body = bodyOf(value);
  const next = { ...body, children, attributes: [...body.attributes, ...attributes] };
  return {
    ...value,
    root: {
      ...value.root,
      children: value.root.children.map((child) => (child === body ? next : child)),
    } as OoxmlElement,
  };
}

function cold(value: OoxmlPart): string {
  return serializeOoxmlPart({ ...value, root: structuredClone(value.root) });
}

function elements(node: OoxmlNode, localName: string, found: OoxmlElement[] = []): OoxmlElement[] {
  if (node.kind === 'textValue') return found;
  if (node.localName === localName) found.push(node);
  for (const child of node.children) elements(child, localName, found);
  return found;
}

/** Replace the text of the `index`th `w:t` through the store's own edit path. */
function editText(value: OoxmlPart, index: number, text: string): OoxmlPart {
  const target = elements(value.root, 't')[index]!;
  const edited = replaceNode(value, target.id, {
    ...target,
    children: [{ ...(target.children[0] as OoxmlNode & { kind: 'textValue' }), value: text }],
  } as OoxmlElement);
  if (!edited.ok) throw new Error(JSON.stringify(edited.issues));
  return edited.part;
}

function paragraphs(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `<w:p><w:r><w:t>p${index}</w:t></w:r></w:p>`
  ).join('');
}

function table(rows: number): string {
  const row = (index: number) =>
    `<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>` +
    `</w:tcPr><w:p><w:r><w:t>cell ${index}</w:t></w:r></w:p></w:tc></w:tr>`;
  return `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>${Array.from(
    { length: rows },
    (_, index) => row(index)
  ).join('')}</w:tbl>`;
}

describe('serialization memo', () => {
  test('a save after an edit equals a cold save, and re-serializes only the edited block', () => {
    const original = part(documentXml(paragraphs(200) + table(50)));
    serializeOoxmlPart(original);
    const coldVisits = (() => {
      const before = canonicalSerializeNodeVisits();
      cold(original);
      return canonicalSerializeNodeVisits() - before;
    })();

    const editedParagraph = editText(original, 10, 'changed paragraph');
    const before = canonicalSerializeNodeVisits();
    const warm = serializeOoxmlPart(editedParagraph);
    const warmVisits = canonicalSerializeNodeVisits() - before;
    expect(warm).toBe(cold(editedParagraph));
    expect(warm).toContain('changed paragraph');
    expect(warmVisits).toBeLessThan(coldVisits / 4);

    const editedCell = editText(editedParagraph, 220, 'changed cell');
    expect(serializeOoxmlPart(editedCell)).toBe(cold(editedCell));
    expect(serializeOoxmlPart(editedCell)).toContain('changed cell');
  });

  test('a block reused under a different prefix map is serialized again', () => {
    const plain = part(documentXml(paragraphs(3)));
    const before = serializeOoxmlPart(plain);
    expect(before).toContain('<w:p>');
    // A sibling that binds `w` to another namespace takes the prefix away from WordprocessingML
    // for the whole part, so the same paragraph objects must now be written with another one.
    const rebound = part(
      documentXml(`<x:marker xmlns:x="urn:example:x" xmlns:w="urn:example:w"/>`)
    );
    const moved = withBodyChildren(rebound, [
      ...bodyOf(plain).children,
      ...bodyOf(rebound).children,
    ]);
    const after = serializeOoxmlPart(moved);
    expect(after).toBe(cold(moved));
    expect(after).not.toContain('<w:p>');
  });

  test('a block reused under a different xml:space is serialized again', () => {
    const value = part(documentXml('<w:p><w:r><w:t>a</w:t></w:r><w:r><w:t>b</w:t></w:r></w:p>'));
    const body = bodyOf(value);
    const paragraph = body.children[0] as OoxmlElement;
    // Whitespace between two runs is insignificant unless an ancestor preserves it.
    const spaced = {
      ...paragraph,
      children: [
        paragraph.children[0]!,
        { kind: 'textValue', id: `${paragraph.id}-space`, value: ' ' },
        paragraph.children[1]!,
      ],
    } as OoxmlElement;
    const outside = withBodyChildren(value, [spaced]);
    const plainMarkup = serializeOoxmlPart(outside);
    const inside = withBodyChildren(value, [spaced], [XML_SPACE_PRESERVE]);
    const preservedMarkup = serializeOoxmlPart(inside);
    expect(preservedMarkup).toBe(cold(inside));
    expect(preservedMarkup).toContain('</w:r> <w:r>');
    expect(plainMarkup).not.toContain('</w:r> <w:r>');
  });

  test('serializing in steps yields between blocks and returns the same markup', () => {
    const value = part(documentXml(paragraphs(40) + table(10)));
    const steps = serializeOoxmlPartSteps(value);
    let yields = 0;
    let next = steps.next();
    while (!next.done) {
      yields += 1;
      next = steps.next();
    }
    expect(yields).toBeGreaterThan(50);
    expect(new TextDecoder().decode(next.value)).toBe(cold(value));
  });
});
