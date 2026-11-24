// Removing a part, and giving one somewhere to put its relationships.
//
// Both are load-bearing for the payload store — it is two parts, two relationships and a
// content-type Override, created together and removed together — and both FAIL CLOSED in a way
// that only shows up on a package whose `.rels` are bytes rather than trees. A package like that
// is legal and loads fine: omit `Default Extension="rels"` and the reader keeps the markup as
// bytes it will write back untouched. Editing the model then would leave the saved file
// disagreeing with it, with nothing anywhere reporting the difference.

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readOoxmlPackage, writeOoxmlPackage, type OoxmlPackage } from '../ooxml-package.ts';
import {
  relationshipsOf,
  relsPartNameFor,
  resolveContentTypeOf,
  withoutPart,
  withRelationshipsPartFor,
} from '../package-edit.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const NOTES_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';

const STORY = '/word/document.xml';

interface Options {
  /** Omit `Default Extension="rels"`, so every `.rels` loads as bytes rather than a tree. */
  readonly relsAsBytes?: boolean;
  /** Give the story a footnotes relationship and the part it names. */
  readonly withNotes?: boolean;
}

function open(options: Options = {}): OoxmlPackage {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        (options.relsAsBytes
          ? ''
          : '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>') +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="${STORY}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        (options.withNotes
          ? `<Override PartName="/word/footnotes.xml" ContentType="${NOTES_TYPE}"/>`
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`
    ),
  };
  if (options.withNotes) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NOTES_REL}" Target="footnotes.xml"/></Relationships>`
    );
    entries['word/footnotes.xml'] = strToU8(`<w:footnotes xmlns:w="${W}"/>`);
  }
  const read = readOoxmlPackage(zipSync(entries));
  if (!read.ok) throw new Error(read.reason);
  return read.package;
}

describe('withoutPart', () => {
  test('it takes the part, its own rels, the Override and every reference to it', () => {
    const pkg = open({ withNotes: true });
    expect(resolveContentTypeOf(pkg, '/word/footnotes.xml')).toBe(NOTES_TYPE);

    const removed = withoutPart(pkg, '/word/footnotes.xml');
    expect(removed.ok).toBe(true);
    expect(removed.pkg.parts.has('/word/footnotes.xml')).toBe(false);
    // The reference goes with the part: a relationship naming a part that is gone is exactly
    // what Word offers to repair.
    expect(relationshipsOf(removed.pkg, STORY).some((r) => r.type === NOTES_REL)).toBe(false);
    // And the Override, which otherwise names a part the package no longer holds.
    const entries = unzipSync(writeOoxmlPackage(removed.pkg));
    expect(strFromU8(entries['[Content_Types].xml']!)).not.toContain('footnotes.xml');
    expect(strFromU8(entries['word/_rels/document.xml.rels']!)).not.toContain('footnotes.xml');
    expect(Object.keys(entries)).not.toContain('word/footnotes.xml');
  });

  test('a part the package does not hold is a success with nothing to do', () => {
    const pkg = open();
    const removed = withoutPart(pkg, '/word/nothing.xml');
    expect(removed.ok).toBe(true);
    expect(removed.pkg.parts.size).toBe(pkg.parts.size);
  });

  test('a name that is not a part name is refused rather than normalized into one', () => {
    const pkg = open();
    const removed = withoutPart(pkg, '../../etc/passwd');
    expect(removed.ok).toBe(false);
    expect(removed.pkg).toBe(pkg);
  });

  test('it refuses rather than half-removing when an owner rels is bytes only', () => {
    // THE CASE THAT MATTERS. `pkg.relationships` lists the record, but the markup lives only in
    // `partBytes` and is written back untouched — so dropping the record alone saves a file
    // still pointing at a part that is gone, and the model looks clean.
    const pkg = open({ withNotes: true, relsAsBytes: true });
    expect(pkg.parts.has(relsPartNameFor(STORY))).toBe(false);
    expect(relationshipsOf(pkg, STORY).some((r) => r.type === NOTES_REL)).toBe(true);

    const removed = withoutPart(pkg, '/word/footnotes.xml');
    expect(removed.ok).toBe(false);
    expect(removed.pkg).toBe(pkg);
  });
});

describe('withRelationshipsPartFor', () => {
  test('it mints an empty rels part for an owner that has none', () => {
    const pkg = open();
    const relsName = relsPartNameFor(STORY);
    expect(pkg.parts.has(relsName)).toBe(false);

    const next = withRelationshipsPartFor(pkg, STORY);
    const minted = next.parts.get(relsName);
    expect(minted?.root.localName).toBe('Relationships');
    expect(minted?.root.children).toEqual([]);
    // The DEFAULT prefix, as every `.rels` Word writes uses. Without the binding the serializer
    // invents one, and this part alone comes out `<ns1:Relationships …>`.
    expect(
      strFromU8(unzipSync(writeOoxmlPackage(next))['word/_rels/document.xml.rels']!)
    ).toContain(`<Relationships xmlns="${REL}"`);
  });

  test('an owner that already has one comes back untouched', () => {
    const pkg = open({ withNotes: true });
    expect(withRelationshipsPartFor(pkg, STORY)).toBe(pkg);
  });

  test('it does not mint over rels the package holds as bytes', () => {
    // Minting a tree here would be serialized OVER those bytes on save, destroying
    // relationships `pkg.relationships` still lists. Fail closed and let the caller refuse.
    const pkg = open({ withNotes: true, relsAsBytes: true });
    expect(withRelationshipsPartFor(pkg, STORY)).toBe(pkg);
  });

  test('a name that is not a part name mints nothing', () => {
    const pkg = open();
    expect(withRelationshipsPartFor(pkg, '../../elsewhere.xml')).toBe(pkg);
  });
});
