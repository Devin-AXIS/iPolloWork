// An export replacement keeps its own namespaces where the new scope binds its prefix to
// another URI, as a live replaceNode does.

import { expect, test } from 'bun:test';
import { replaceNodesForExport } from '../package/export-node-replace.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const VML = 'urn:schemas-microsoft-com:vml';

function part(xml: string, name = '/word/document.xml'): OoxmlPart {
  const loaded = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.part;
}

function find(node: OoxmlNode, localName: string): OoxmlElement {
  const walk = (current: OoxmlNode): OoxmlElement | null => {
    if (current.kind === 'textValue') return null;
    if (current.localName === localName) return current;
    for (const child of current.children) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };
  return walk(node)!;
}

test('a replacement whose prefix the new scope binds elsewhere gets a local binding', () => {
  // A hostile file binds `v` to another URI around the node the repair replaces.
  const live = part(
    `<w:document xmlns:w="${W}"><w:body><w:p xmlns:v="urn:other"><w:r><w:t>old</w:t></w:r>` +
      '</w:p></w:body></w:document>'
  );
  const source = part(
    `<w:document xmlns:w="${W}" xmlns:v="${VML}"><w:body><w:r><v:rect/></w:r></w:body></w:document>`,
    '/word/copy.xml'
  );
  const replacement = find(source.root, 'r');
  const next = replaceNodesForExport(live, new Map([[find(live.root, 'r').id, replacement]]));
  expect(next).not.toBeNull();
  // The saved and reread rect keeps the VML namespace.
  expect(find(part(serializeOoxmlPart(next!)).root, 'rect').namespaceUri).toBe(VML);
});
