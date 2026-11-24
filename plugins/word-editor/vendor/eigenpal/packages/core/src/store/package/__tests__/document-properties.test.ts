// `docProps/core.xml` and `docProps/app.xml` metadata, which document-property fields render.
//
// Every string here is attacker-controlled: the reader caps length, matches only known
// (namespace, localName) pairs, and never keys an object by a file-supplied element name.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';
import { MAX_DOCUMENT_PROPERTY_CHARS, readDocumentProperties } from '../document-properties.ts';

const CP = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const DC = 'http://purl.org/dc/elements/1.1/';
const EP = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';

function coreRoot(inner: string): OoxmlNode {
  const result = readOoxmlPart(
    `<cp:coreProperties xmlns:cp="${CP}" xmlns:dc="${DC}">${inner}</cp:coreProperties>`,
    { name: '/docProps/core.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

function appRoot(inner: string): OoxmlNode {
  const result = readOoxmlPart(`<Properties xmlns="${EP}">${inner}</Properties>`, {
    name: '/docProps/app.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

describe('reading core.xml', () => {
  test('parses every mapped property', () => {
    const props = readDocumentProperties(
      coreRoot(
        '<dc:title>Sample Title</dc:title>' +
          '<dc:creator>A. Author</dc:creator>' +
          '<dc:subject>Sample Subject</dc:subject>' +
          '<dc:description>Sample Comments</dc:description>' +
          '<cp:keywords>alpha, beta</cp:keywords>' +
          '<cp:lastModifiedBy>B. Editor</cp:lastModifiedBy>'
      )
    );
    expect(props).toEqual({
      title: 'Sample Title',
      creator: 'A. Author',
      subject: 'Sample Subject',
      description: 'Sample Comments',
      keywords: 'alpha, beta',
      lastModifiedBy: 'B. Editor',
    });
  });

  test('a missing element reads as undefined', () => {
    const props = readDocumentProperties(coreRoot('<dc:title>Only Title</dc:title>'));
    expect(props.title).toBe('Only Title');
    expect(props.creator).toBeUndefined();
    expect(props.subject).toBeUndefined();
  });

  test('an empty or whitespace-only element reads as undefined', () => {
    const props = readDocumentProperties(
      coreRoot('<dc:title>   </dc:title><dc:creator></dc:creator>')
    );
    expect(props.title).toBeUndefined();
    expect(props.creator).toBeUndefined();
  });

  test('whitespace around a value is trimmed', () => {
    expect(readDocumentProperties(coreRoot('<dc:title>  Trimmed  </dc:title>')).title).toBe(
      'Trimmed'
    );
  });

  test('XML entities decode to their characters (no markup leaks in)', () => {
    const props = readDocumentProperties(
      coreRoot('<dc:title>A &amp; B &lt;tag&gt; "q"</dc:title>')
    );
    expect(props.title).toBe('A & B <tag> "q"');
  });
});

describe('reading app.xml', () => {
  test('parses Company and Manager', () => {
    const props = readDocumentProperties(
      coreRoot('<dc:title>T</dc:title>'),
      appRoot('<Company>Sample Co</Company><Manager>C. Manager</Manager>')
    );
    expect(props.title).toBe('T');
    expect(props.company).toBe('Sample Co');
    expect(props.manager).toBe('C. Manager');
  });
});

describe('missing parts', () => {
  test('no core part reads as an empty object', () => {
    expect(readDocumentProperties(null)).toEqual({});
    expect(readDocumentProperties(undefined)).toEqual({});
    expect(readDocumentProperties(null, null)).toEqual({});
  });
});

describe('hostile input', () => {
  test('an over-cap string is clamped', () => {
    const huge = 'x'.repeat(MAX_DOCUMENT_PROPERTY_CHARS + 1000);
    const title = readDocumentProperties(coreRoot(`<dc:title>${huge}</dc:title>`)).title;
    expect(title).toBeDefined();
    expect(title!.length).toBe(MAX_DOCUMENT_PROPERTY_CHARS);
  });

  test('a hostile element name is ignored and pollutes no prototype', () => {
    const before = Object.getPrototypeOf({});
    const props = readDocumentProperties(
      coreRoot('<cp:__proto__>polluted</cp:__proto__><dc:title>Safe</dc:title>')
    );
    // The only recognized element is the title; the __proto__-named element matched nothing.
    expect(props).toEqual({ title: 'Safe' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(before);
  });

  test('nested markup inside a value is not read as the value', () => {
    // A single textValue child is read; wrapped markup contributes nothing.
    const props = readDocumentProperties(
      coreRoot('<dc:title><dc:inner>nested</dc:inner></dc:title>')
    );
    expect(props.title).toBeUndefined();
  });
});
