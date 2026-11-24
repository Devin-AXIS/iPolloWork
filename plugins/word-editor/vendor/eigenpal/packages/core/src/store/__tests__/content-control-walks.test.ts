// Consistency walks for typed and generic content controls across store projections.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { semanticDigest } from '../package/ooxml-digest.ts';
import { collectSectionPropertyNodes } from '../package/hf-references.ts';
import {
  contentControlContentOf,
  isContentControl,
  MAX_CONTENT_CONTROL_NESTING,
  walkAllStoryParagraphs,
  walkStoryBlocks,
} from '../package/content-control-walk.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function bodyOf(part: OoxmlPart): Extract<OoxmlNode, { kind: 'body' }> {
  const visit = (node: OoxmlNode): Extract<OoxmlNode, { kind: 'body' }> | null => {
    if (node.kind === 'body') return node;
    if (node.kind === 'textValue') return null;
    for (const child of node.children) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  const body = visit(part.root);
  if (!body) throw new Error('no body');
  return body;
}

/** Simulate typed nodes once the reader emits `contentControl` / `contentControlContent`. */
function asTypedControl(genericSdt: OoxmlNode): OoxmlNode {
  if (genericSdt.kind === 'textValue' || genericSdt.localName !== 'sdt') return genericSdt;
  return {
    ...genericSdt,
    kind: 'contentControl' as typeof genericSdt.kind,
    children: genericSdt.children.map((child) => {
      if (child.kind === 'textValue' || child.localName !== 'sdtContent') return child;
      return {
        ...child,
        kind: 'contentControlContent' as typeof child.kind,
      };
    }),
  };
}

const BLOCK_XML =
  '<w:p><w:r><w:t>before</w:t></w:r></w:p>' +
  '<w:sdt><w:sdtPr><w:alias w:val="Name"/></w:sdtPr><w:sdtContent>' +
  '<w:p><w:r><w:t>inside control</w:t></w:r></w:p>' +
  '</w:sdtContent></w:sdt>' +
  '<w:tbl><w:tr><w:tc>' +
  '<w:sdt><w:sdtContent><w:p><w:r><w:t>cell control</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
  '</w:tc></w:tr></w:tbl>';

describe('content-control walk helpers', () => {
  test('recognises generic and typed wrappers', () => {
    const part = load('<w:sdt><w:sdtContent><w:p/></w:sdtContent></w:sdt>');
    const sdt = bodyOf(part).children[0]!;
    expect(isContentControl(sdt)).toBe(true);
    expect(contentControlContentOf(sdt)?.some((child) => child.kind === 'paragraph')).toBe(true);
    const typed = asTypedControl(sdt);
    expect(isContentControl(typed)).toBe(true);
    expect(contentControlContentOf(typed)?.some((child) => child.kind === 'paragraph')).toBe(true);
  });

  test('foreign-namespace sdt stays opaque and is not a control', () => {
    const X = 'http://example.com/foreign';
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W}" xmlns:x="${X}"><w:body>` +
        `<w:p><w:r><w:t>before</w:t></w:r></w:p>` +
        `<x:sdt><x:sdtContent><w:p><w:r><w:t>foreign</w:t></w:r></w:p></x:sdtContent></x:sdt>` +
        `<w:p><w:r><w:t>after</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const foreign = bodyOf(result.part).children[1]!;
    expect(foreign.kind).toBe('generic');
    expect(isContentControl(foreign)).toBe(false);
    expect(contentControlContentOf(foreign)).toBeNull();

    // Foreign wrapper is not flattened — only the sibling Word paragraphs participate.
    const blocks: string[] = [];
    walkStoryBlocks(bodyOf(result.part).children, 0, (block) => {
      blocks.push(block.kind);
    });
    expect(blocks).toEqual(['paragraph', 'paragraph']);
    // Structure is preserved for round-trip.
    expect(foreign.localName).toBe('sdt');
    expect((foreign as { namespaceUri: string }).namespaceUri).toBe(X);
    expect(foreign.kind !== 'textValue' && foreign.children[0]?.localName).toBe('sdtContent');
  });

  test('stops flattening past the nesting bound', () => {
    let depth = 0;
    const open = '<w:sdt><w:sdtContent>';
    const close = '</w:sdtContent></w:sdt>';
    const nested =
      open.repeat(MAX_CONTENT_CONTROL_NESTING + 4) +
      '<w:p/>' +
      close.repeat(MAX_CONTENT_CONTROL_NESTING + 4);
    const part = load(nested);
    walkStoryBlocks(bodyOf(part).children, 0, () => {
      depth += 1;
    });
    expect(depth).toBe(0);
  });
});

describe('store projections descend block content controls', () => {
  test('all shared story walks descend through block customXml', () => {
    const part = load(
      '<w:customXml><w:p><w:r><w:t>one</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>two</w:t></w:r></w:p></w:customXml>'
    );
    const blocks: string[] = [];
    walkStoryBlocks(bodyOf(part).children, 0, (block) => blocks.push(block.id));
    const paragraphs: string[] = [];
    walkAllStoryParagraphs(bodyOf(part).children, 0, (paragraph) => paragraphs.push(paragraph.id));
    expect(blocks).toEqual(paragraphs);
    expect(blocks).toHaveLength(2);
  });

  test('digest reaches paragraphs inside generic block SDTs and table cells', () => {
    const digest = semanticDigest([load(BLOCK_XML)]);
    const texts = digest.stories[0]!.paragraphs.map((paragraph) => paragraph.text);
    // The body ends with a table, so it reads an empty paragraph after it.
    expect(texts).toEqual(['before', 'inside control', 'cell control', '']);
  });

  test('digest reaches paragraphs inside typed block controls', () => {
    const part = load(BLOCK_XML);
    const body = bodyOf(part);
    const typedBody = {
      ...body,
      children: body.children.map((child) =>
        child.kind !== 'textValue' && child.localName === 'sdt' ? asTypedControl(child) : child
      ),
    };
    const typedPart = { ...part, root: { ...part.root, children: [typedBody] } };
    const digest = semanticDigest([typedPart]);
    const texts = digest.stories[0]!.paragraphs.map((paragraph) => paragraph.text);
    // The body ends with a table, so it reads an empty paragraph after it.
    expect(texts).toEqual(['before', 'inside control', 'cell control', '']);
  });

  test('digest collects text inside block and inline controls', () => {
    const inline =
      '<w:p><w:r><w:t xml:space="preserve">prefix </w:t></w:r>' +
      '<w:sdt><w:sdtContent><w:r><w:t>inline</w:t></w:r></w:sdtContent></w:sdt>' +
      '<w:r><w:t xml:space="preserve"> suffix</w:t></w:r></w:p>';
    const digest = semanticDigest([load(BLOCK_XML + inline)]);
    const texts = digest.stories[0]!.paragraphs.map((paragraph) => paragraph.text);
    expect(texts).toContain('inside control');
    expect(texts).toContain('prefix inline suffix');
    const inlineParagraph = digest.stories[0]!.paragraphs.find((paragraph) =>
      paragraph.text.includes('inline')
    );
    expect(inlineParagraph?.genericStructure.some((token) => token.includes('sdt'))).toBe(true);
  });

  test('section enumeration flattens block SDTs like storyBlocks', () => {
    const part = load(
      BLOCK_XML +
        '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr><w:r><w:t>end</w:t></w:r></w:p>'
    );
    const sections = collectSectionPropertyNodes(part.root);
    expect(sections.length).toBeGreaterThan(0);
    const paragraphs: string[] = [];
    walkAllStoryParagraphs(bodyOf(part).children, 0, (paragraph) => {
      const text = paragraph.children
        .flatMap((child) => (child.kind === 'run' ? child.children : []))
        .flatMap((child) => (child.kind === 'text' ? child.children : []))
        .map((child) => (child.kind === 'textValue' ? child.value : ''))
        .join('');
      paragraphs.push(text);
    });
    expect(paragraphs).toEqual(['before', 'inside control', 'cell control', 'end']);
  });
});
