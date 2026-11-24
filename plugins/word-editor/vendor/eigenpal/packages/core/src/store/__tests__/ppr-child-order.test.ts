// `w:pPr` child order follows CT_PPr (ECMA-376 17.3.1.26), not "rPr last".
//
// CT_PPr is CT_PPrBase, then `w:rPr`, then `w:sectPr`, then `w:pPrChange`. The shape rule
// used to require the paragraph MARK to be the last child, so the `w:pPr` of every
// section-ending paragraph — and of every paragraph carrying a tracked property change —
// was demoted to a generic node on read. Generic round-trips losslessly, which is why the
// D9 digests stayed quiet, but a demoted container is invisible to everything that reads a
// paragraph's own style, alignment, indent or numbering.
//
// It also made the engine produce documents it could not read back: writing the paragraph
// mark onto a section-ending paragraph yields exactly `[..., rPr, sectPr]`.

import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { applyTreeOp, type TreeDocOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const SECT_PR =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function firstParagraph(part: OoxmlPart): OoxmlNode {
  const visit = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'paragraph') return node;
    for (const child of node.children) {
      const hit = visit(child);
      if (hit) return hit;
    }
    return null;
  };
  const found = visit(part.root);
  if (!found) throw new Error('no paragraph');
  return found;
}

/** The kind the reader gave the paragraph's own `w:pPr`. */
function propertiesKind(part: OoxmlPart): string | undefined {
  const paragraph = firstParagraph(part);
  if (paragraph.kind === 'textValue') return undefined;
  const properties = paragraph.children.find(
    (child) => child.kind !== 'textValue' && child.localName === 'pPr'
  );
  return properties?.kind;
}

describe('CT_PPr child order', () => {
  test('a paragraph mark FOLLOWED by a section mark keeps a typed w:pPr', () => {
    const part = load(
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:rPr><w:b/></w:rPr>${SECT_PR}</w:pPr>` +
        '<w:r><w:t>section end</w:t></w:r></w:p>'
    );
    expect(propertiesKind(part)).toBe('paragraphProperties');
  });

  test('a paragraph mark FOLLOWED by w:pPrChange keeps a typed w:pPr', () => {
    const part = load(
      '<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:b/></w:rPr>' +
        '<w:pPrChange w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:pPr/></w:pPrChange>' +
        '</w:pPr><w:r><w:t>tracked</w:t></w:r></w:p>'
    );
    expect(propertiesKind(part)).toBe('paragraphProperties');
  });

  test('a paragraph mark as the LAST child still keeps a typed w:pPr', () => {
    const part = load(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:rPr><w:b/></w:rPr></w:pPr>' +
        '<w:r><w:t>plain</w:t></w:r></w:p>'
    );
    expect(propertiesKind(part)).toBe('paragraphProperties');
  });

  test('an ordinary property after the mark opens in schema order and stays typed', () => {
    // Only `w:sectPr` and `w:pPrChange` follow `w:rPr` in CT_PPr. The reader puts anything
    // else back before the mark, so the alignment stays visible and saves where it belongs.
    const part = load(
      '<w:p><w:pPr><w:rPr><w:b/></w:rPr><w:jc w:val="center"/></w:pPr>' +
        '<w:r><w:t>out of order</w:t></w:r></w:p>'
    );
    expect(propertiesKind(part)).toBe('paragraphProperties');
    expect(serializeOoxmlPart(part)).toContain(
      '<w:pPr><w:jc w:val="center"/><w:rPr><w:b/></w:rPr></w:pPr>'
    );
  });

  test('a foreign-namespace element after the mark demotes', () => {
    const part = load(
      '<w:p><w:pPr><w:rPr><w:b/></w:rPr>' +
        '<x:sectPr xmlns:x="urn:not-wordprocessingml"/></w:pPr>' +
        '<w:r><w:t>foreign</w:t></w:r></w:p>'
    );
    expect(propertiesKind(part)).toBe('generic');
  });
});

describe('writing the paragraph mark on a section-ending paragraph round-trips', () => {
  const SOURCE =
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>` +
    `${SECT_PR}</w:pPr><w:r><w:t>last paragraph of the section</w:t></w:r></w:p>`;

  function markWritten(): OoxmlPart {
    const part = load(SOURCE);
    const op: TreeDocOp = {
      op: 'setParagraphMarkProperties',
      paragraphId: firstParagraph(part).id,
      properties: [{ localName: 'sz', attributes: { val: '32' } }],
    };
    const applied = applyTreeOp(part, op);
    if (!applied.ok) throw new Error(`op rejected: ${applied.reason} ${applied.detail ?? ''}`);
    return applied.part;
  }

  test('the written document reopens with a TYPED w:pPr', () => {
    const reopened = load(
      serializeOoxmlPart(markWritten()).replace(/^[\s\S]*?<w:body>|<\/w:body>[\s\S]*$/g, '')
    );
    expect(propertiesKind(reopened)).toBe('paragraphProperties');
  });

  test('the section mark, the style and the numbering all survive the write', () => {
    const written = markWritten();
    const xml = serializeOoxmlPart(written);
    expect(xml).toContain('<w:sectPr>');
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('<w:numPr>');
    expect(xml).toContain('w:val="32"');
    // The mark sits BEFORE the section mark, the order CT_PPr requires.
    expect(xml.indexOf('<w:rPr>')).toBeLessThan(xml.indexOf('<w:sectPr>'));
  });

  test('both D9 oracles hold across save and reopen', () => {
    const written = markWritten();
    const reopened = load(
      serializeOoxmlPart(written).replace(/^[\s\S]*?<w:body>|<\/w:body>[\s\S]*$/g, '')
    );
    expect(canonicalOoxmlFingerprint(reopened.root)).toBe(canonicalOoxmlFingerprint(written.root));
    expect(diffSemanticDigests(semanticDigest([written]), semanticDigest([reopened]))).toEqual([]);
  });
});
