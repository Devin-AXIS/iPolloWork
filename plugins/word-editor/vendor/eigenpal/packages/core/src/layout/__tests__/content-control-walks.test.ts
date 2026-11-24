// Revision visibility walks inline content controls the same way as hyperlinks.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { revisionRemovesParagraph } from '../revision-visibility.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function firstParagraph(part: OoxmlPart): OoxmlNode {
  const visit = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'paragraph') return node;
    if (node.kind === 'textValue') return null;
    for (const child of node.children) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  const paragraph = visit(part.root);
  if (!paragraph) throw new Error('no paragraph');
  return paragraph;
}

function asTypedInlineControl(node: OoxmlNode): OoxmlNode {
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

function paragraphWithTypedInline(part: OoxmlPart): OoxmlNode {
  const paragraph = firstParagraph(part);
  if (paragraph.kind === 'textValue') throw new Error('expected paragraph');
  return {
    ...paragraph,
    children: paragraph.children.map((child) =>
      child.kind !== 'textValue' && child.localName === 'sdt' ? asTypedInlineControl(child) : child
    ),
  };
}

describe('revision visibility and inline content controls', () => {
  test('text inside a generic inline SDT prevents mark-deleted suppression', () => {
    const part = load(
      '<w:p>' +
        '<w:pPr><w:rPr><w:del w:id="1" w:author="a" w:date="2020-01-01T00:00:00Z"/></w:rPr></w:pPr>' +
        '<w:sdt><w:sdtContent><w:r><w:t>visible</w:t></w:r></w:sdtContent></w:sdt>' +
        '</w:p>'
    );
    expect(revisionRemovesParagraph(firstParagraph(part))).toBe(false);
  });

  test('text inside a typed inline control prevents mark-deleted suppression', () => {
    const part = load(
      '<w:p>' +
        '<w:pPr><w:rPr><w:del w:id="1" w:author="a" w:date="2020-01-01T00:00:00Z"/></w:rPr></w:pPr>' +
        '<w:sdt><w:sdtContent><w:r><w:t>visible</w:t></w:r></w:sdtContent></w:sdt>' +
        '</w:p>'
    );
    expect(revisionRemovesParagraph(paragraphWithTypedInline(part))).toBe(false);
  });

  test('mark-deleted paragraph with no renderable inline content is suppressed', () => {
    const part = load(
      '<w:p>' +
        '<w:pPr><w:rPr><w:del w:id="1" w:author="a" w:date="2020-01-01T00:00:00Z"/></w:rPr></w:pPr>' +
        '<w:sdt><w:sdtContent/></w:sdt>' +
        '</w:p>'
    );
    expect(revisionRemovesParagraph(firstParagraph(part))).toBe(true);
  });
});
