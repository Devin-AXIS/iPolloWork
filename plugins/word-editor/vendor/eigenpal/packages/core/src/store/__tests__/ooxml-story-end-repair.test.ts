// A body, a note and a text box that a file ends with a table read with an empty paragraph
// after it, as reference renderings show: it takes a line below the table and can open a page.
// Headers, footers and cells read as written. Each case saves the paragraph and reads back the
// same.
import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { validateOoxmlPart } from '../package/ooxml-validate.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TABLE =
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
const DOCUMENT = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function read(xml: string, meta: { name: string; contentType: string } = DOCUMENT): OoxmlPart {
  const result = readOoxmlPart(xml, meta);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const body = (content: string) =>
  read(`<w:document xmlns:w="${W}"><w:body>${content}<w:sectPr/></w:body></w:document>`);

function first(node: OoxmlNode, localName: string): OoxmlElement {
  if (node.kind !== 'textValue') {
    if (node.localName === localName) return node;
    for (const child of node.children) {
      const found = first(child, localName);
      if (found) return found;
    }
  }
  return undefined as unknown as OoxmlElement;
}

const names = (node: OoxmlElement) =>
  node.children.map((child) =>
    child.kind === 'textValue' ? 'text' : `${child.localName}:${child.kind}`
  );

/** The part passes the write-time invariants, and a save reads back to the same save. */
function expectStable(part: OoxmlPart, meta = DOCUMENT): void {
  expect(validateOoxmlPart(part)).toEqual({ ok: true });
  const saved = serializeOoxmlPart(part);
  const reread = read(saved, meta);
  expect(validateOoxmlPart(reread)).toEqual({ ok: true });
  expect(serializeOoxmlPart(reread)).toBe(saved);
}

describe('a story that ends with a table', () => {
  test('a body gets an empty paragraph before its section properties, and saves it', () => {
    const part = body(TABLE);
    const root = first(part.root, 'body');
    expect(names(root)).toEqual(['tbl:table', 'p:paragraph', 'sectPr:generic']);
    const paragraph = root.children[1] as OoxmlElement;
    expect(paragraph.children).toEqual([]);
    expect(paragraph.id).toBe(`${(root.children[0] as OoxmlElement).id}~end`);
    expect(serializeOoxmlPart(part)).toContain('</w:tbl><w:p/><w:sectPr/>');
    expectStable(part);
  });

  test('the paragraph follows the range markers that close on the table, so no range grows', () => {
    const root = first(
      body(`<w:bookmarkStart w:id="1" w:name="b"/>${TABLE}<w:bookmarkEnd w:id="1"/>`).root,
      'body'
    );
    expect(names(root)).toEqual([
      'bookmarkStart:bookmarkStart',
      'tbl:table',
      'bookmarkEnd:bookmarkEnd',
      'p:paragraph',
      'sectPr:generic',
    ]);
  });

  test('a table at the end of a block content control ends the story: the paragraph follows the control', () => {
    const part = body(`<w:p/><w:sdt><w:sdtPr/><w:sdtContent>${TABLE}</w:sdtContent></w:sdt>`);
    const root = first(part.root, 'body');
    expect(names(root).slice(-3)).toEqual(['sdt:contentControl', 'p:paragraph', 'sectPr:generic']);
    expect(names(first(part.root, 'sdtContent'))).toEqual(['tbl:table']);
    expectStable(part);
  });

  test('a body that ends with a paragraph reads as written', () => {
    const root = first(body(`${TABLE}<w:p/>`).root, 'body');
    expect(names(root)).toEqual(['tbl:table', 'p:paragraph', 'sectPr:generic']);
  });

  test('a footnote gets the paragraph; a separator does not', () => {
    const part = read(
      `<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1">` +
        `<w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:id="1"><w:p><w:r><w:t>note</w:t></w:r></w:p>${TABLE}</w:footnote></w:footnotes>`,
      {
        name: '/word/footnotes.xml',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
      }
    );
    const notes = (part.root as OoxmlElement).children as OoxmlElement[];
    expect(names(notes[0]!)).toEqual(['p:paragraph']);
    expect(names(notes[1]!)).toEqual(['p:paragraph', 'tbl:table', 'p:paragraph']);
  });

  test('a text box gets the paragraph', () => {
    const part = body(
      `<w:p><w:r><w:pict><w:txbxContent><w:p/>${TABLE}</w:txbxContent></w:pict></w:r></w:p>`
    );
    expect(names(first(part.root, 'txbxContent'))).toEqual([
      'p:paragraph',
      'tbl:table',
      'p:paragraph',
    ]);
  });

  test('a header and a cell keep a final table as written', () => {
    const header = read(`<w:hdr xmlns:w="${W}"><w:p/>${TABLE}</w:hdr>`, {
      name: '/word/header1.xml',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
    });
    expect(names(header.root as OoxmlElement)).toEqual(['p:paragraph', 'tbl:table']);
    const nested = body(
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${TABLE}</w:tc></w:tr></w:tbl><w:p/>`
    );
    expect(names(first(nested.root, 'tc'))).toEqual(['tbl:table']);
  });
  test('a table with its own prefix declaration gives the paragraph that declaration', () => {
    const part = read(
      `<w:document xmlns:w="${W}"><w:body><w:p/>` +
        TABLE.replaceAll('w:', 'x:').replace('<x:tbl>', `<x:tbl xmlns:x="${W}">`) +
        '<w:sectPr/></w:body></w:document>'
    );
    expect(validateOoxmlPart(part)).toEqual({ ok: true });
    expect(serializeOoxmlPart(part)).toMatch(/<\/w:tbl><w:p[ />]/);
  });
});
