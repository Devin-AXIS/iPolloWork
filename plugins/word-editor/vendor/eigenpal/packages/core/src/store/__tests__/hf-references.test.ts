// Header/footer reference resolution (phase 2 of the legacy-lane retirement).
//
// The package already parses every part and every rels file; these tests pin the CONNECTING
// logic: sectPr references by variant, rel-type filtering, fail-open dangling refs, and the
// evenAndOddHeaders gate — plus the D9 oracles over a package that carries header parts.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { canonicalOoxmlFingerprint } from '../package/ooxml-tree.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { readOoxmlPackage, withPart, writeOoxmlPackage } from '../package/ooxml-package.ts';
import {
  resolveHeaderFooterParts,
  resolveHeaderFooterPartsBySection,
  resolveHeaderFooterResolutionBySection,
} from '../package/hf-references.ts';
import { applyTreeOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

interface BuildOptions {
  readonly references?: string;
  readonly headerParts?: Record<string, string>;
  readonly rels?: string;
  readonly settings?: string;
  readonly overrides?: string;
  readonly body?: string;
}

function build(options: BuildOptions = {}): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (options.overrides ?? '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        (options.body ??
          '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
            `<w:sectPr>${options.references ?? ''}</w:sectPr>`) +
        '</w:body></w:document>'
    ),
  };
  if (options.rels) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${options.rels}</Relationships>`
    );
  }
  for (const [name, xml] of Object.entries(options.headerParts ?? {})) {
    entries[name] = strToU8(xml);
  }
  if (options.settings) entries['word/settings.xml'] = strToU8(options.settings);
  return zipSync(entries);
}

const HEADER_XML = `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>HEADER</w:t></w:r></w:p></w:hdr>`;
const FOOTER_XML = `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>FOOTER</w:t></w:r></w:p></w:ftr>`;
const HEADER_OVERRIDE =
  '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>';
const FOOTER_OVERRIDE =
  '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>';
const SETTINGS_OVERRIDE =
  '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>';

function load(bytes: Uint8Array) {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(`package read failed: ${result.reason}`);
  return result.package;
}

function twoSectionBody(firstSectPr: string, secondSectPr: string): string {
  return (
    `<w:p><w:pPr><w:sectPr>${firstSectPr}</w:sectPr></w:pPr><w:r><w:t>one</w:t></w:r></w:p>` +
    '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
    `<w:sectPr>${secondSectPr}</w:sectPr>`
  );
}

const DEFAULT_HEADER_REF = '<w:headerReference w:type="default" r:id="rId7"/>';
const DEFAULT_RELS = `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>`;

describe('header/footer reference resolution', () => {
  test('default header and footer resolve through the main part rels', () => {
    const pkg = load(
      build({
        references:
          '<w:headerReference w:type="default" r:id="rId7"/>' +
          '<w:footerReference w:type="default" r:id="rId8"/>',
        rels:
          `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>` +
          `<Relationship Id="rId8" Type="${R}/footer" Target="footer1.xml"/>`,
        headerParts: { 'word/header1.xml': HEADER_XML, 'word/footer1.xml': FOOTER_XML },
        overrides: HEADER_OVERRIDE + FOOTER_OVERRIDE,
      })
    );
    const resolved = resolveHeaderFooterParts(pkg);
    expect(resolved.headers.get('default')?.name).toBe('/word/header1.xml');
    expect(resolved.footers.get('default')?.name).toBe('/word/footer1.xml');
    expect(resolved.evenAndOddHeaders).toBe(false);
  });

  test('a dangling reference or a wrong-typed rel resolves to nothing (fail open)', () => {
    const pkg = load(
      build({
        references:
          '<w:headerReference w:type="default" r:id="rId99"/>' +
          '<w:headerReference w:type="first" r:id="rId7"/>',
        // rId7 exists but with the FOOTER type URI — the header reference must not take it.
        rels: `<Relationship Id="rId7" Type="${R}/footer" Target="header1.xml"/>`,
        headerParts: { 'word/header1.xml': HEADER_XML },
        overrides: HEADER_OVERRIDE,
      })
    );
    const resolved = resolveHeaderFooterParts(pkg);
    expect(resolved.headers.size).toBe(0);
  });

  test('evenAndOddHeaders is read from settings.xml', () => {
    const pkg = load(
      build({
        references: '<w:headerReference w:type="even" r:id="rId7"/>',
        rels:
          `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>` +
          `<Relationship Id="rId9" Type="${R}/settings" Target="settings.xml"/>`,
        headerParts: { 'word/header1.xml': HEADER_XML },
        settings: `<w:settings xmlns:w="${W}"><w:evenAndOddHeaders/></w:settings>`,
        overrides: HEADER_OVERRIDE + SETTINGS_OVERRIDE,
      })
    );
    const resolved = resolveHeaderFooterParts(pkg);
    expect(resolved.evenAndOddHeaders).toBe(true);
    expect(resolved.headers.get('even')?.name).toBe('/word/header1.xml');
  });

  test('a document with no sectPr references resolves to nothing', () => {
    const resolved = resolveHeaderFooterParts(load(build()));
    expect(resolved.headers.size).toBe(0);
    expect(resolved.footers.size).toBe(0);
    expect(resolved.titlePage).toBe(false);
  });
});

describe('titlePg on/off semantics', () => {
  test.each([
    ['omitted', '', false],
    ['empty element', '<w:titlePg/>', true],
    ['val=1', '<w:titlePg w:val="1"/>', true],
    ['val=true', '<w:titlePg w:val="true"/>', true],
    ['val=on', '<w:titlePg w:val="on"/>', true],
    ['val=0', '<w:titlePg w:val="0"/>', false],
    ['val=false', '<w:titlePg w:val="false"/>', false],
    ['val=off', '<w:titlePg w:val="off"/>', false],
  ] as const)('%s resolves titlePage=%s', (_label, titlePg, expected) => {
    const resolved = resolveHeaderFooterParts(load(build({ references: titlePg })));
    expect(resolved.titlePage).toBe(expected);
  });

  test('titlePg does not inherit across adjacent sections', () => {
    const pkg = load(
      build({
        body: twoSectionBody('<w:titlePg/>', ''),
        rels: DEFAULT_RELS,
        headerParts: { 'word/header1.xml': HEADER_XML },
        overrides: HEADER_OVERRIDE,
      })
    );
    const bySection = resolveHeaderFooterPartsBySection(pkg);
    expect(bySection).toHaveLength(2);
    expect(bySection[0]!.titlePage).toBe(true);
    expect(bySection[1]!.titlePage).toBe(false);
  });

  test('titlePg turns on independently in a later section', () => {
    const pkg = load(
      build({
        body: twoSectionBody('', '<w:titlePg w:val="1"/>'),
        rels: DEFAULT_RELS,
        headerParts: { 'word/header1.xml': HEADER_XML },
        overrides: HEADER_OVERRIDE,
      })
    );
    const bySection = resolveHeaderFooterPartsBySection(pkg);
    expect(bySection[0]!.titlePage).toBe(false);
    expect(bySection[1]!.titlePage).toBe(true);
  });

  test('explicit titlePg off in a later section does not inherit from the prior section', () => {
    const pkg = load(
      build({
        body: twoSectionBody('<w:titlePg/>', '<w:titlePg w:val="0"/>'),
        rels: DEFAULT_RELS,
        headerParts: { 'word/header1.xml': HEADER_XML },
        overrides: HEADER_OVERRIDE,
      })
    );
    const bySection = resolveHeaderFooterPartsBySection(pkg);
    expect(bySection[0]!.titlePage).toBe(true);
    expect(bySection[1]!.titlePage).toBe(false);
  });

  test('header references still inherit when titlePg is omitted in a later section', () => {
    const pkg = load(
      build({
        body: twoSectionBody(`${DEFAULT_HEADER_REF}<w:titlePg/>`, '<w:titlePg w:val="false"/>'),
        rels: DEFAULT_RELS,
        headerParts: { 'word/header1.xml': HEADER_XML },
        overrides: HEADER_OVERRIDE,
      })
    );
    const bySection = resolveHeaderFooterPartsBySection(pkg);
    expect(bySection[0]!.titlePage).toBe(true);
    expect(bySection[0]!.headers.get('default')?.name).toBe('/word/header1.xml');
    expect(bySection[1]!.titlePage).toBe(false);
    expect(bySection[1]!.headers.get('default')?.name).toBe('/word/header1.xml');
  });
});

describe('fidelity with header parts', () => {
  const packed = () =>
    build({
      references: '<w:headerReference w:type="default" r:id="rId7"/>',
      rels: `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>`,
      headerParts: { 'word/header1.xml': HEADER_XML },
      overrides: HEADER_OVERRIDE,
    });

  test('the package round-trips the canonical fingerprint with its header part intact', () => {
    const pkg = load(packed());
    const reopened = load(writeOoxmlPackage(pkg));
    for (const [name, before] of pkg.parts) {
      expect(canonicalOoxmlFingerprint(reopened.parts.get(name)!)).toBe(
        canonicalOoxmlFingerprint(before)
      );
    }
  });

  test('header and footer parts survive save/reopen semantic digest', () => {
    const bytes = build({
      references:
        '<w:headerReference w:type="default" r:id="rId7"/>' +
        '<w:footerReference w:type="default" r:id="rId8"/>',
      rels:
        `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rId8" Type="${R}/footer" Target="footer1.xml"/>`,
      headerParts: { 'word/header1.xml': HEADER_XML, 'word/footer1.xml': FOOTER_XML },
      overrides: HEADER_OVERRIDE + FOOTER_OVERRIDE,
    });
    const pkg = load(bytes);
    const header = pkg.parts.get('/word/header1.xml')!;
    const footer = pkg.parts.get('/word/footer1.xml')!;
    const beforeDigest = semanticDigest([header, footer]);
    const reopened = load(writeOoxmlPackage(pkg));
    const reopenedHeader = reopened.parts.get('/word/header1.xml')!;
    const reopenedFooter = reopened.parts.get('/word/footer1.xml')!;
    expect(
      diffSemanticDigests(beforeDigest, semanticDigest([reopenedHeader, reopenedFooter]))
    ).toEqual([]);
    expect(canonicalOoxmlFingerprint(reopenedHeader)).toBe(canonicalOoxmlFingerprint(header));
    expect(canonicalOoxmlFingerprint(reopenedFooter)).toBe(canonicalOoxmlFingerprint(footer));
  });

  test('editing the body leaves the header part fingerprint-identical', () => {
    const pkg = load(packed());
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const headerBefore = canonicalOoxmlFingerprint(pkg.parts.get('/word/header1.xml')!);
    const paragraphId = JSON.stringify(main).match(
      /"(\/word\/document\.xml#[0-9.]+)","kind":"paragraph"/
    )?.[1];
    if (!paragraphId) throw new Error('no paragraph id found');
    const edited = applyTreeOp(main, { op: 'insertText', paragraphId, offset: 0, text: 'Z' });
    if (!edited.ok) throw new Error(edited.reason);
    const reopened = load(writeOoxmlPackage(withPart(pkg, edited.part)));
    expect(canonicalOoxmlFingerprint(reopened.parts.get('/word/header1.xml')!)).toBe(headerBefore);
  });

  test('editing body text reuses header and footer resolution', () => {
    const pkg = load(packed());
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const paragraphId = JSON.stringify(main).match(
      /"(\/word\/document\.xml#[0-9.]+)","kind":"paragraph"/
    )?.[1];
    if (!paragraphId) throw new Error('no paragraph id found');
    const beforeResolution = resolveHeaderFooterResolutionBySection(pkg);
    const beforeParts = resolveHeaderFooterPartsBySection(pkg);

    const edited = applyTreeOp(main, {
      op: 'insertText',
      paragraphId,
      offset: 0,
      text: 'Z',
    });
    if (!edited.ok) throw new Error(edited.reason);
    const editedPackage = withPart(pkg, edited.part);

    expect(resolveHeaderFooterResolutionBySection(editedPackage)).toBe(beforeResolution);
    expect(resolveHeaderFooterPartsBySection(editedPackage)).toBe(beforeParts);
  });
});
