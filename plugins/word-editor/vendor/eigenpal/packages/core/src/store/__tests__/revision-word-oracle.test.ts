import { expect, test } from 'bun:test';
import { applyTreeOp, readOoxmlPart, type OoxmlElement, type OoxmlNode } from '../index.ts';
import {
  structuralWordCases,
  structuralWordXmlParts,
  WORD_NS,
} from './fixtures/structural-word-cases.ts';
import oracle from './fixtures/structural-word-oracle.json';

// Recorded from clean native Word AcceptAllChangesInDoc / RejectAllChangesInDoc output.
// Compare content/topology, ignoring run splitting, generated IDs and explicit defaults.
// Column widths are not compared here: Word autofits nested-table inputs on opening.
// Empty SDT placeholder spaces normalize to an empty paragraph.
function child(node: OoxmlElement, name: string): OoxmlElement | undefined {
  return node.children.find(
    (n): n is OoxmlElement =>
      n.kind !== 'textValue' && n.namespaceUri === WORD_NS && n.localName === name
  );
}
function value(node: OoxmlElement, path: string[], fallback: string): string {
  let current: OoxmlElement | undefined = node;
  for (const name of path) current = current && child(current, name);
  return (
    current?.attributes.find((a) => a.namespaceUri === WORD_NS && a.localName === 'val')?.value ??
    fallback
  );
}
function text(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  if (['pPr', 'rPr', 'instrText', 'delInstrText'].includes(node.localName)) return '';
  return node.children.map(text).join('');
}
function blocks(node: OoxmlElement): unknown[] {
  return [...node.children].flatMap((c): unknown[] => {
    if (c.kind === 'textValue') return [];
    if (c.localName === 'p')
      return [
        {
          p: text(c),
          align: value(c, ['pPr', 'jc'], 'left'),
        },
      ];
    if (c.localName === 'tbl')
      return [
        {
          grid: child(c, 'tblGrid')!.children.length,
          rows: [...c.children]
            .filter((n): n is OoxmlElement => n.kind !== 'textValue' && n.localName === 'tr')
            .map((tr) =>
              [...tr.children]
                .filter((n): n is OoxmlElement => n.kind !== 'textValue' && n.localName === 'tc')
                .map((tc) => ({
                  span: value(tc, ['tcPr', 'gridSpan'], '1'),
                  blocks: blocks(tc),
                }))
            ),
        },
      ];
    if (c.localName === 'sdt') return [{ sdt: blocks(child(c, 'sdtContent')!) }];
    return [];
  });
}
for (const action of ['accept', 'reject'] as const) {
  for (const [name, expected] of Object.entries(oracle[action])) {
    test(`Word oracle ${action}: ${name}`, () => {
      const fixture = structuralWordCases.find((c) => c.name === name)!;
      const read = readOoxmlPart(structuralWordXmlParts([fixture])['word/document.xml']!, {
        name: '/word/document.xml',
        contentType: 'application/xml',
      });
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      const result = applyTreeOp(read.part, {
        op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const content = child(child(child(result.part.root, 'body')!, 'sdt')!, 'sdtContent')!;
      expect(blocks(content)).toEqual(expected);
    });
  }
}
