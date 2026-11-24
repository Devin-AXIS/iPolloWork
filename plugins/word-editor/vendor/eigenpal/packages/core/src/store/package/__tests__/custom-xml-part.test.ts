// The data part this authors has to be the one Word already accepts. `sdt-custom-tag-word-roundtrip.docx`
// is Word for the web's own output for a document carrying one, so it is the reference: the
// same part names, the same two relationship types, the same content type, and properties
// carrying a `ds:itemID` in the shape `w:storeItemID` will have to quote back.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readOoxmlPackage, writeOoxmlPackage } from '../ooxml-package.ts';
import { relationshipsOf, resolveContentTypeOf } from '../package-edit.ts';
import {
  CUSTOM_XML_PROPS_REL,
  CUSTOM_XML_PROPS_TYPE,
  CUSTOM_XML_REL,
  customXmlDataParts,
  findCustomXmlDataPart,
  withCustomXmlDataPart,
} from '../custom-xml-part.ts';
import type { OoxmlPackage } from '../ooxml-package.ts';

const STORY = '/word/document.xml';
const NS = 'http://docx-editor.dev/ns';

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(resolve(import.meta.dir, '../../../../../../e2e/fixtures', name))
  );
}

function fixture(name: string): OoxmlPackage {
  const read = readOoxmlPackage(fixtureBytes(name));
  if (!read.ok) throw new Error(read.reason);
  return read.package;
}

/**
 * A fixture with entries added, removed or rewritten — a package crafted the way a sender can.
 *
 * The guards below are about what a HOSTILE package can talk this module into, and a fixture
 * this project wrote cannot carry the attack. Rebuilding the zip is the only way to hand the
 * reader bytes it would actually have to defend against.
 */
function crafted(name: string, edit: (entries: Record<string, Uint8Array>) => void): OoxmlPackage {
  const entries = unzipSync(fixtureBytes(name));
  edit(entries);
  const read = readOoxmlPackage(zipSync(entries));
  if (!read.ok) throw new Error(read.reason);
  return read.package;
}

/** The document's relationships, with more appended before the closing tag. */
function withStoryRelationships(entries: Record<string, Uint8Array>, extra: string): void {
  const name = 'word/_rels/document.xml.rels';
  entries[name] = strToU8(
    strFromU8(entries[name]!).replace('</Relationships>', `${extra}</Relationships>`)
  );
}

/** An Override appended to `[Content_Types].xml`. */
function withOverride(entries: Record<string, Uint8Array>, partName: string, type: string): void {
  entries['[Content_Types].xml'] = strToU8(
    strFromU8(entries['[Content_Types].xml']!).replace(
      '</Types>',
      `<Override PartName="${partName}" ContentType="${type}"/></Types>`
    )
  );
}

const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/customXml';

describe('reading the stores a document already carries', () => {
  test("Word's own output is read back as one store, with its item id", () => {
    const parts = customXmlDataParts(fixture('sdt-custom-tag-word-roundtrip.docx'), STORY);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.partName).toBe('/customXml/item1.xml');
    expect(parts[0]?.propsPartName).toBe('/customXml/itemProps1.xml');
    expect(parts[0]?.namespaceUri).toBe(NS);
    // Braced and upper-case: `w:storeItemID` has to quote it back exactly.
    expect(parts[0]?.itemId).toMatch(/^\{[0-9A-F-]{36}\}$/);
  });

  test('a document with no store reads as none rather than failing', () => {
    expect(
      customXmlDataParts(fixture('comprehensive-word-element-test.docx'), STORY).filter(
        (p) => p.namespaceUri === NS
      )
    ).toEqual([]);
  });
});

describe('authoring a store', () => {
  test('it lands as the same wiring Word writes', () => {
    const pkg = fixture('comprehensive-word-element-test.docx');
    const { pkg: next, part } = withCustomXmlDataPart(pkg, STORY, NS, 'docxEditor');
    if (!part) throw new Error('no part authored');

    expect(next.parts.has(part.partName)).toBe(true);
    expect(next.parts.has(part.propsPartName)).toBe(true);
    // itemN.xml rides the package's `xml` default; only the properties need an Override.
    expect(resolveContentTypeOf(next, part.propsPartName)).toBe(CUSTOM_XML_PROPS_TYPE);

    const fromStory = relationshipsOf(next, STORY).find((r) => r.type === CUSTOM_XML_REL);
    expect(fromStory?.rawTarget).toBe('../customXml/item1.xml');
    const toProps = relationshipsOf(next, part.partName).find(
      (r) => r.type === CUSTOM_XML_PROPS_REL
    );
    expect(toProps?.rawTarget).toBe('itemProps1.xml');

    // The whole point: it reads back as a store, so the write and the read agree.
    expect(findCustomXmlDataPart(next, STORY, NS)?.itemId).toBe(part.itemId);
  });

  test('a second call adds nothing — one namespace, one store', () => {
    const pkg = fixture('comprehensive-word-element-test.docx');
    const once = withCustomXmlDataPart(pkg, STORY, NS, 'docxEditor');
    const twice = withCustomXmlDataPart(once.pkg, STORY, NS, 'docxEditor');
    expect(twice.pkg.parts.size).toBe(once.pkg.parts.size);
    expect(twice.part?.itemId).toBe(once.part?.itemId);
  });

  test('it does not overwrite a store the document already had', () => {
    // The Word fixture already holds item1; a second namespace has to become item2.
    const pkg = fixture('sdt-custom-tag-word-roundtrip.docx');
    const { pkg: next, part } = withCustomXmlDataPart(pkg, STORY, 'urn:other', 'other');
    expect(part?.partName).toBe('/customXml/item2.xml');
    expect(next.parts.get('/customXml/item1.xml')).toBe(pkg.parts.get('/customXml/item1.xml'));
  });

  test('the package it produces still writes', () => {
    const pkg = fixture('comprehensive-word-element-test.docx');
    const { pkg: next } = withCustomXmlDataPart(pkg, STORY, NS, 'docxEditor');
    const reopened = readOoxmlPackage(writeOoxmlPackage(next));
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(findCustomXmlDataPart(reopened.package, STORY, NS)?.namespaceUri).toBe(NS);
  });
});

describe('a package that lies about its stores', () => {
  test('a relationships part presented as a store is not one', () => {
    // The package below is built so that EVERY other check passes: the `customXml`
    // relationship resolves, the target part exists, it has its own `.rels` naming a real
    // properties part, and that part carries the properties content type and a `ds:itemID`.
    // The one thing wrong with it is that the "store" is `/word/_rels/document.xml.rels` —
    // and without the guard a caller writes payload nodes straight into it, shipping a
    // relationships part with foreign children for Word to repair away.
    const pkg = crafted('comprehensive-word-element-test.docx', (entries) => {
      withStoryRelationships(
        entries,
        `<Relationship Id="rIdEvil" Type="${CUSTOM_XML_REL}" Target="_rels/document.xml.rels"/>`
      );
      entries['word/_rels/_rels/document.xml.rels.rels'] = strToU8(
        `<Relationships xmlns="${RELS_NS}">` +
          `<Relationship Id="rId1" Type="${CUSTOM_XML_PROPS_REL}" Target="../evilProps.xml"/>` +
          '</Relationships>'
      );
      entries['word/evilProps.xml'] = strToU8(
        `<ds:datastoreItem ds:itemID="{11111111-1111-1111-1111-111111111111}" xmlns:ds="${DS_NS}"/>`
      );
      withOverride(entries, '/word/evilProps.xml', CUSTOM_XML_PROPS_TYPE);
    });

    const relsName = '/word/_rels/document.xml.rels';
    // The relationship IS there — this is not a test of the package being rejected.
    expect(relationshipsOf(pkg, STORY).some((r) => r.type === CUSTOM_XML_REL)).toBe(true);
    expect(customXmlDataParts(pkg, STORY).some((p) => p.partName === relsName)).toBe(false);
    const { part } = withCustomXmlDataPart(pkg, STORY, NS, 'docxEditor');
    expect(part?.partName).toBe('/customXml/item1.xml');
  });

  test('a store is not adopted unless its properties really are properties', () => {
    // The props part decides the `ds:itemID` a binding quotes, so a planted one that is not
    // TYPED as properties would let the sender choose which store Word binds the control to.
    // Everything here is well formed except the content type, which is left as the package's
    // `xml` default.
    const pkg = crafted('comprehensive-word-element-test.docx', (entries) => {
      withStoryRelationships(
        entries,
        `<Relationship Id="rIdPlanted" Type="${CUSTOM_XML_REL}" Target="../customXml/item9.xml"/>`
      );
      entries['customXml/item9.xml'] = strToU8(`<planted xmlns="urn:planted"/>`);
      entries['customXml/_rels/item9.xml.rels'] = strToU8(
        `<Relationships xmlns="${RELS_NS}">` +
          `<Relationship Id="rId1" Type="${CUSTOM_XML_PROPS_REL}" Target="itemProps9.xml"/>` +
          '</Relationships>'
      );
      entries['customXml/itemProps9.xml'] = strToU8(
        `<ds:datastoreItem ds:itemID="{22222222-2222-2222-2222-222222222222}" xmlns:ds="${DS_NS}"/>`
      );
      // Deliberately NO Override: the part reads as `application/xml`.
    });

    expect(resolveContentTypeOf(pkg, '/customXml/itemProps9.xml')).not.toBe(CUSTOM_XML_PROPS_TYPE);
    expect(customXmlDataParts(pkg, STORY)).toEqual([]);
    // And the same package WITH the Override is adopted, so the refusal above is the content
    // type and not something incidental about how this was built.
    const declared = crafted('comprehensive-word-element-test.docx', (entries) => {
      withStoryRelationships(
        entries,
        `<Relationship Id="rIdPlanted" Type="${CUSTOM_XML_REL}" Target="../customXml/item9.xml"/>`
      );
      entries['customXml/item9.xml'] = strToU8(`<planted xmlns="urn:planted"/>`);
      entries['customXml/_rels/item9.xml.rels'] = strToU8(
        `<Relationships xmlns="${RELS_NS}">` +
          `<Relationship Id="rId1" Type="${CUSTOM_XML_PROPS_REL}" Target="itemProps9.xml"/>` +
          '</Relationships>'
      );
      entries['customXml/itemProps9.xml'] = strToU8(
        `<ds:datastoreItem ds:itemID="{22222222-2222-2222-2222-222222222222}" xmlns:ds="${DS_NS}"/>`
      );
      withOverride(entries, '/customXml/itemProps9.xml', CUSTOM_XML_PROPS_TYPE);
    });
    expect(customXmlDataParts(declared, STORY).map((p) => p.partName)).toEqual([
      '/customXml/item9.xml',
    ]);
  });

  test('a namespace that cannot be written is refused, not rewritten', () => {
    // Stripping instead of refusing meant the store never matched on read, so every call
    // authored another pair until the document passed the reader's part cap.
    const pkg = fixture('comprehensive-word-element-test.docx');
    const hostile = 'urn:host\u0001store';
    const once = withCustomXmlDataPart(pkg, STORY, hostile, 'docxEditor');
    expect(once.part).toBeNull();
    expect(once.pkg).toBe(pkg);
  });

  test('a root name is a name, not a place to inject attributes', () => {
    const pkg = fixture('comprehensive-word-element-test.docx');
    const injected = withCustomXmlDataPart(pkg, STORY, NS, 'evil xmlns:q="urn:q" q:attr="1"');
    expect(injected.part).toBeNull();
    expect(injected.pkg).toBe(pkg);
  });

  test('an id the package already carries is not reused', () => {
    // The derivation is public, so a sender can precompute the id this module WOULD mint and
    // plant a store holding it — two stores, one `ds:itemID`, and Word binds the control to
    // whichever it prefers. The id is taken from an authoring run against the untouched
    // fixture, then planted in a copy of it: the seed reads the main part, `core.xml` and
    // `settings.xml`, none of which the planted parts change, so the second run mints exactly
    // the same id unless the collision check moves it.
    const clean = fixture('comprehensive-word-element-test.docx');
    const wouldMint = withCustomXmlDataPart(clean, STORY, NS, 'docxEditor').part?.itemId;
    expect(wouldMint).toBeDefined();

    const planted = crafted('comprehensive-word-element-test.docx', (entries) => {
      entries['customXml/itemProps7.xml'] = strToU8(
        `<ds:datastoreItem ds:itemID="${wouldMint!}" xmlns:ds="${DS_NS}"/>`
      );
      withOverride(entries, '/customXml/itemProps7.xml', CUSTOM_XML_PROPS_TYPE);
    });
    const { part } = withCustomXmlDataPart(planted, STORY, NS, 'docxEditor');
    expect(part).not.toBeNull();
    expect(part?.itemId).not.toBe(wouldMint);
  });
});

describe('the item id', () => {
  // Randomness here would make the same document save to different bytes each time.
  test('differs between documents, or Word dedupes two stores into one', () => {
    // Word's data store keys on `ds:itemID`. One id for every document we write means a bound
    // control pasted from one into another silently binds to the host's payload.
    const a = withCustomXmlDataPart(
      fixture('comprehensive-word-element-test.docx'),
      STORY,
      NS,
      'docxEditor'
    );
    const b = withCustomXmlDataPart(
      fixture('sdt-custom-tag-word-roundtrip.docx'),
      STORY,
      'urn:x',
      'x'
    );
    expect(a.part?.itemId).not.toBe(b.part?.itemId);
  });

  test('differs between two documents made from one template', () => {
    // The narrower case, and the one that survived the first fix: two files from one corporate
    // template have byte-identical BODY content when opened, so a seed of body bytes alone
    // hands them the same GUID and Word binds a pasted control to the wrong payload.
    const template = fixture('comprehensive-word-element-test.docx');
    const edited = {
      ...template,
      partBytes: new Map(template.partBytes).set(
        '/docProps/core.xml',
        new TextEncoder().encode(
          '<cp:coreProperties><cp:revision>7</cp:revision></cp:coreProperties>'
        )
      ),
    };
    const a = withCustomXmlDataPart(template, STORY, 'urn:same', 'same');
    const b = withCustomXmlDataPart(edited, STORY, 'urn:same', 'same');
    expect(a.part?.itemId).toBeTruthy();
    expect(a.part?.itemId).not.toBe(b.part?.itemId);
  });

  test('is stable for one document, so a save is a fixed point', () => {
    const pkg = fixture('comprehensive-word-element-test.docx');
    const first = withCustomXmlDataPart(pkg, STORY, NS, 'docxEditor');
    const second = withCustomXmlDataPart(pkg, STORY, NS, 'docxEditor');
    expect(first.part?.itemId).toBe(second.part?.itemId ?? '');
  });
});
