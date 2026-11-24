// Paragraph identity for content that enters a document from outside it.
//
// `insertFragment` (paste), TOC builds, and placeholder materialization all clone or build
// paragraphs and run them through `withFreshParaIds`. A host part that carries identities
// must keep every paragraph addressable afterwards, whether or not the source had ids.

import { describe, expect, test } from 'bun:test';
import { runWithTransactionActor } from '../package/actor-scoped-ids.ts';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { isValidParaId, normalizeParagraphIdentity, paraIdOf } from '../package/para-id.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function part(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** A normalized host: every paragraph has an id, the root binds w14 under `prefix`. */
function identifiedHost(prefix = 'w14'): OoxmlPart {
  return normalizeParagraphIdentity(
    part(
      `<w:document xmlns:w="${W}" xmlns:${prefix}="${W14}"><w:body>` +
        '<w:p><w:r><w:t>Host</w:t></w:r></w:p><w:p><w:r><w:t>Tail</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    )
  );
}

/** Body blocks of a fragment document, as `insertFragment` receives them. */
function blocks(bodyXml: string, extraXmlns = ''): readonly OoxmlNode[] {
  const fragment = part(
    `<w:document xmlns:w="${W}"${extraXmlns}><w:body>${bodyXml}</w:body></w:document>`
  );
  const body = fragment.root.children.find((child) => child.kind === 'body') as OoxmlElement;
  return body.children;
}

function paragraphs(root: OoxmlNode): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === W && node.localName === 'p') found.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

function paste(host: OoxmlPart, fragmentBlocks: readonly OoxmlNode[]): OoxmlPart {
  const first = paragraphs(host.root)[1]!;
  const result = applyTreeOp(host, {
    op: 'insertFragment',
    paragraphId: first.id,
    offset: 0,
    blocks: fragmentBlocks,
    lastMarkCovered: true,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const ID_LESS_LIST =
  '<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>' +
  '<w:tbl><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid><w:tr><w:tc>' +
  '<w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
  '<w:p><w:r><w:t>three</w:t></w:r></w:p>';

describe('insertFragment paragraph identity', () => {
  test('mints a unique id for every pasted paragraph, cells included, when the source has none', () => {
    const after = paste(identifiedHost(), blocks(ID_LESS_LIST));
    const ids = paragraphs(after.root).map(paraIdOf);
    expect(ids).toHaveLength(6);
    expect(ids.every((id) => id !== null && isValidParaId(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('mints under the prefix the host binds, not the fragment', () => {
    const after = paste(identifiedHost('x14'), blocks(ID_LESS_LIST));
    for (const paragraph of paragraphs(after.root)) {
      const identity = paragraph.attributes.find((attribute) => attribute.localName === 'paraId');
      expect(identity?.namespaceUri).toBe(W14);
      expect(identity?.prefix).toBe('x14');
    }
  });

  test('a host part without identities keeps id-less pasted paragraphs id-less', () => {
    const host = part(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Host</w:t></w:r></w:p>` +
        '<w:p><w:r><w:t>Tail</w:t></w:r></w:p></w:body></w:document>'
    );
    const after = paste(host, blocks(ID_LESS_LIST));
    expect(
      paragraphs(after.root)
        .map(paraIdOf)
        .every((id) => id === null)
    ).toBe(true);
  });

  test('a fragment that rebinds the host prefix gets no identity under the foreign namespace', () => {
    const after = paste(
      identifiedHost(),
      blocks(
        '<w:sdt xmlns:w14="urn:not-w14"><w:sdtContent><w:p><w:r><w:t>in</w:t></w:r></w:p></w:sdtContent></w:sdt>'
      )
    );
    for (const paragraph of paragraphs(after.root)) {
      for (const attribute of paragraph.attributes) {
        if (attribute.prefix === 'w14') expect(attribute.namespaceUri).toBe(W14);
      }
    }
  });

  test('two actors pasting at one position mint different identities; no actor is deterministic', () => {
    const hostIds = new Set(paragraphs(identifiedHost().root).map(paraIdOf));
    // Every id the paste minted: the pasted paragraphs and the split tail of the host.
    const mintedAs = (actor: string | undefined) =>
      runWithTransactionActor(actor, () =>
        paragraphs(paste(identifiedHost(), blocks(ID_LESS_LIST)).root)
          .map(paraIdOf)
          .filter((id) => !hostIds.has(id))
      );
    expect(mintedAs(undefined)).toEqual(mintedAs(undefined));
    const alice = mintedAs('alice');
    const bob = mintedAs('bob');
    expect(alice).toHaveLength(4);
    expect(alice.filter((id) => bob.includes(id))).toEqual([]);
  });
});
