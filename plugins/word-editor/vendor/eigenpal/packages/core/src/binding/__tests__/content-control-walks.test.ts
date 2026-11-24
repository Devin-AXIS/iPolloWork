// Binding walks descend content controls transparently for paragraph and inline tokens.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { allParagraphs } from '../tree-binding.ts';
import { collectTextMatches } from '../document-search.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function asTypedControl(node: OoxmlNode): OoxmlNode {
  if (node.kind === 'textValue' || node.localName !== 'sdt') return node;
  return {
    ...node,
    kind: 'contentControl' as typeof node.kind,
    children: node.children.map((child) => {
      if (child.kind === 'textValue' || child.localName !== 'sdtContent') return child;
      return { ...child, kind: 'contentControlContent' as typeof child.kind };
    }),
  };
}

function typedPart(part: OoxmlPart): OoxmlPart {
  const visit = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    return {
      ...node,
      children: node.children.map((child) => {
        const next = visit(child);
        return child.kind !== 'textValue' && child.localName === 'sdt'
          ? asTypedControl(next)
          : next;
      }),
    };
  };
  return { ...part, root: visit(part.root) as OoxmlPart['root'] };
}

const BODY =
  '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
  '<w:sdt><w:sdtContent><w:p><w:r><w:t>sdt paragraph</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
  '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

const INLINE =
  '<w:p><w:r><w:t xml:space="preserve">start </w:t></w:r>' +
  '<w:sdt><w:sdtContent><w:r><w:t>control word</w:t></w:r></w:sdtContent></w:sdt>' +
  '<w:r><w:t xml:space="preserve"> end</w:t></w:r></w:p>';

describe('binding content-control walks', () => {
  test('allParagraphs includes paragraphs inside generic block SDTs and tables', () => {
    const texts = allParagraphs(load(BODY)).map((paragraph) => {
      const run =
        paragraph.kind === 'textValue'
          ? undefined
          : paragraph.children.find((c) => c.kind === 'run');
      const text = run?.kind === 'run' ? run.children.find((c) => c.kind === 'text') : undefined;
      return text?.kind === 'text'
        ? text.children.map((value) => (value.kind === 'textValue' ? value.value : '')).join('')
        : '';
    });
    // The body ends with a table, so it reads an empty paragraph after it.
    expect(texts).toEqual(['body', 'sdt paragraph', 'cell', '']);
  });

  test('allParagraphs includes paragraphs inside typed block controls', () => {
    const texts = allParagraphs(typedPart(load(BODY))).map((paragraph) => {
      const run =
        paragraph.kind === 'textValue'
          ? undefined
          : paragraph.children.find((c) => c.kind === 'run');
      const text = run?.kind === 'run' ? run.children.find((c) => c.kind === 'text') : undefined;
      return text?.kind === 'text'
        ? text.children.map((value) => (value.kind === 'textValue' ? value.value : '')).join('')
        : '';
    });
    // The body ends with a table, so it reads an empty paragraph after it.
    expect(texts).toEqual(['body', 'sdt paragraph', 'cell', '']);
  });

  test('search run addressing crosses inline generic SDTs', () => {
    const { matches } = collectTextMatches(load(INLINE), 'control');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.start).toBe(6);
    expect(matches[0]!.runIndex).toBe(1);
    expect(matches[0]!.runOffset).toBe(0);
  });

  test('search run addressing crosses inline typed controls', () => {
    const { matches } = collectTextMatches(typedPart(load(INLINE)), 'control');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.start).toBe(6);
    expect(matches[0]!.runIndex).toBe(1);
  });
});
