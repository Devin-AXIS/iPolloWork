// Round-trip regression: w:fldSimple/@w:instr must stay an exact string scalar.
// A non-scalar coerced with String(value) becomes the literal "[object Object]" and
// then survives save as if it were authored — Word Online rejects that package shape
// when combined with other save-normalization issues. This suite pins scalar-only
// attribute emission and OPC default-xmlns relationship serialization.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { semanticDigest, diffSemanticDigests } from '../package/ooxml-digest.ts';
import { readOoxmlPackage, writeOoxmlPackage, withPart } from '../package/ooxml-package.ts';
import { escapeXmlChecked, isValidXmlText } from '../package/sinks.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const FIXTURE = `${import.meta.dir}/../../../../../e2e/fixtures/comprehensive-word-element-test.docx`;

const FIELD_INSTRUCTIONS = [
  'PAGE',
  'NUMPAGES',
  'TITLE',
  'AUTHOR',
  'DATE',
  'TIME',
  'FILENAME',
] as const;

function parseDocument(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(`document read failed: ${result.reason}`);
  return result.part;
}

function collectFldSimple(root: OoxmlNode): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'fldSimple' && node.namespaceUri === W) found.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

function instrOf(node: OoxmlElement): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === 'instr')?.value;
}

function mapTree(node: OoxmlNode, mapElement: (element: OoxmlElement) => OoxmlElement): OoxmlNode {
  if (node.kind === 'textValue') return node;
  const mappedChildren = node.children.map((child) => mapTree(child, mapElement));
  return mapElement({ ...node, children: mappedChildren });
}

function withFldSimpleInstructions(part: OoxmlPart, instructions: readonly string[]): OoxmlPart {
  let index = 0;
  const root = mapTree(part.root, (element) => {
    if (element.localName !== 'fldSimple' || element.namespaceUri !== W) return element;
    const instr = instructions[index];
    index += 1;
    if (instr === undefined) return element;
    return {
      ...element,
      attributes: element.attributes.map((attribute) =>
        attribute.localName === 'instr' ? { ...attribute, value: instr } : attribute
      ),
    };
  }) as OoxmlElement;
  if (index !== instructions.length) {
    throw new Error(`expected ${instructions.length} fldSimple nodes, found ${index}`);
  }
  return { ...part, root };
}

describe('scalar attribute emission (no [object Object])', () => {
  test('escapeXmlChecked rejects non-string values instead of coercing', () => {
    expect(isValidXmlText({} as unknown as string)).toBe(false);
    expect(() => escapeXmlChecked({} as unknown as string, 'attribute w:instr')).toThrow(
      /string scalar/
    );
    expect(escapeXmlChecked('PAGE & co', 'attribute w:instr')).toBe('PAGE &amp; co');
  });

  test('serialize rejects a non-string attribute value planted on a tree node', () => {
    const part = parseDocument(
      `<w:document xmlns:w="${W}"><w:body><w:p>` +
        `<w:fldSimple w:instr="PAGE"/>` +
        `</w:p></w:body></w:document>`
    );
    const poisoned = {
      ...part,
      root: mapTree(part.root, (element) =>
        element.localName === 'fldSimple' && element.namespaceUri === W
          ? {
              ...element,
              attributes: element.attributes.map((attribute) =>
                attribute.localName === 'instr'
                  ? { ...attribute, value: { code: 'PAGE' } as unknown as string }
                  : attribute
              ),
            }
          : element
      ) as OoxmlElement,
    };
    expect(() => serializeOoxmlPart(poisoned)).toThrow(/string scalar/);
  });
});

describe('minimal fldSimple round-trip', () => {
  test('preserves exact w:instr strings through serialize → reopen', () => {
    const instructions = [' PAGE ', 'DATE \\@ "yyyy-MM-dd"', 'FILENAME \\p'];
    const xml =
      `<w:document xmlns:w="${W}"><w:body>` +
      instructions
        .map(
          (instr) =>
            `<w:p><w:fldSimple w:instr="${instr
              .replace(/&/g, '&amp;')
              .replace(/"/g, '&quot;')}"><w:r><w:t>x</w:t></w:r></w:fldSimple></w:p>`
        )
        .join('') +
      `</w:body></w:document>`;
    const original = parseDocument(xml);
    expect(collectFldSimple(original.root).map(instrOf)).toEqual([...instructions]);

    const saved = serializeOoxmlPart(original);
    expect(saved).not.toContain('[object Object]');
    for (const instr of instructions) {
      expect(saved).toContain(`w:instr="${instr.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`);
    }

    const reopened = parseDocument(saved);
    expect(collectFldSimple(reopened.root).map(instrOf)).toEqual([...instructions]);
    expect(canonicalOoxmlFingerprint(original)).toBe(canonicalOoxmlFingerprint(reopened));
    expect(diffSemanticDigests(semanticDigest([original]), semanticDigest([reopened]))).toEqual([]);
  });

  test('OPC relationship parts re-emit default xmlns without a dual ns1 prefix', () => {
    const result = readOoxmlPart(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
        `</Relationships>`,
      {
        name: '/_rels/.rels',
        contentType: 'application/vnd.openxmlformats-package.relationships+xml',
      }
    );
    if (!result.ok) throw new Error(result.reason);
    const saved = serializeOoxmlPart(result.part);
    expect(saved.startsWith(`<Relationships xmlns="${REL}">`)).toBe(true);
    expect(saved).not.toContain('xmlns:ns1=');
    expect(saved).not.toContain('ns1:Relationships');
    expect(saved).toContain('<Relationship Id="rId1"');
  });

  test('document.xml.rels re-emit default xmlns without a dual ns1 prefix', () => {
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const result = readOoxmlPart(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId5" Type="${R}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId6" Type="${R}/header" Target="header1.xml"/>` +
        `</Relationships>`,
      {
        name: '/word/_rels/document.xml.rels',
        contentType: 'application/vnd.openxmlformats-package.relationships+xml',
      }
    );
    if (!result.ok) throw new Error(result.reason);
    const saved = serializeOoxmlPart(result.part);
    expect(saved.startsWith(`<Relationships xmlns="${REL}">`)).toBe(true);
    expect(saved).not.toContain('xmlns:ns1=');
    expect(saved).not.toContain('ns1:Relationships');
    expect(saved).toContain('<Relationship Id="rId5"');
    expect(saved).toContain('<Relationship Id="rId6"');
  });
});

describe('header fldSimple round-trip', () => {
  test('preserves exact w:instr in header parts through package save', () => {
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
    const OD = `${R}/officeDocument`;
    const instr = 'PAGE \\* MERGEFORMAT';
    const headerXml =
      `<w:hdr xmlns:w="${W}"><w:p>` +
      `<w:fldSimple w:instr="${instr}"><w:r><w:t>1</w:t></w:r></w:fldSimple>` +
      `</w:p></w:hdr>`;
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
          '<w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr>' +
          '</w:body></w:document>'
      ),
      'word/header1.xml': strToU8(headerXml),
    });

    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const header = loaded.package.parts.get('/word/header1.xml')!;
    expect(collectFldSimple(header.root).map(instrOf)).toEqual([instr]);

    const saved = writeOoxmlPackage(loaded.package);
    const reopened = readOoxmlPackage(saved);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    const reopenedHeader = reopened.package.parts.get('/word/header1.xml')!;
    expect(collectFldSimple(reopenedHeader.root).map(instrOf)).toEqual([instr]);
    expect(canonicalOoxmlFingerprint(reopenedHeader)).toBe(canonicalOoxmlFingerprint(header));
    expect(diffSemanticDigests(semanticDigest([header]), semanticDigest([reopenedHeader]))).toEqual(
      []
    );

    const docRels = new TextDecoder().decode(
      reopened.package.partBytes.get('/word/_rels/document.xml.rels')!
    );
    expect(docRels).toContain(`xmlns="${REL}"`);
    expect(docRels).not.toMatch(/<ns\d+:Relationships/);
  });
});

describe('package-level relationship xmlns emission', () => {
  test('root and document rels re-emit a single default xmlns after package save', () => {
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
    const OD = `${R}/officeDocument`;
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rId5" Type="${R}/styles" Target="styles.xml"/>` +
          '</Relationships>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`
      ),
      'word/styles.xml': strToU8(
        `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal"/></w:styles>`
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const saved = writeOoxmlPackage(loaded.package);
    const reopened = readOoxmlPackage(saved);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    for (const relsPath of ['/_rels/.rels', '/word/_rels/document.xml.rels'] as const) {
      const relsXml = new TextDecoder().decode(reopened.package.partBytes.get(relsPath)!);
      expect(relsXml).toContain(`xmlns="${REL}"`);
      expect(relsXml).not.toMatch(/<ns\d+:Relationships/);
      expect(relsXml).not.toContain('xmlns:ns1=');
      expect(relsXml.startsWith(`<Relationships xmlns="${REL}">`)).toBe(true);
    }
  });
});

describe('OPC rels root default xmlns with nested rebinding', () => {
  const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
  const RELS_CT = 'application/vnd.openxmlformats-package.relationships+xml';

  function parseRels(xml: string, name: string): OoxmlPart {
    const result = readOoxmlPart(xml, { name, contentType: RELS_CT });
    if (!result.ok) throw new Error(result.reason);
    return result.part;
  }

  function assertCleanRelsRoot(saved: string): void {
    expect(saved.startsWith(`<Relationships xmlns="${REL}"`)).toBe(true);
    expect(saved).not.toMatch(/<ns\d+:Relationships/);
    // Dual default+prefixed declarations for the relationships URI with a prefixed
    // root is the Word Online corrupt shape; a secondary alias for attrs/MC is fine.
    expect(saved).not.toMatch(/<ns\d+:Relationships[^>]*xmlns="/);
  }

  test.each([
    {
      name: '/_rels/.rels',
      xml:
        `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="http://x" Target="word/document.xml"/>` +
        `<x xmlns=""/><scope xmlns="urn:other"><item/></scope>` +
        `</Relationships>`,
    },
    {
      name: '/word/_rels/document.xml.rels',
      xml:
        `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId5" Type="http://x" Target="styles.xml"/>` +
        `<a xmlns="urn:a"><b xmlns=""/></a>` +
        `</Relationships>`,
    },
    {
      name: '/word/_rels/header1.xml.rels',
      xml:
        `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="http://x" Target="media/image1.png"/>` +
        `<nested xmlns="urn:n"><inner xmlns=""/></nested>` +
        `</Relationships>`,
    },
  ])('keeps unprefixed Relationships for $name with nested default rebinds', ({ name, xml }) => {
    const original = parseRels(xml, name);
    const saved = serializeOoxmlPart(original);
    assertCleanRelsRoot(saved);
    expect(saved).toContain('xmlns=""');
    const reopened = parseRels(saved, name);
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(original));
    expect(diffSemanticDigests(semanticDigest([original]), semanticDigest([reopened]))).toEqual([]);
  });

  test('AlternateContent under Relationships keeps default xmlns root', () => {
    const original = parseRels(
      `<Relationships xmlns="${REL}" xmlns:mc="${MC}">` +
        `<Relationship Id="rId1" Type="http://x" Target="a.xml"/>` +
        `<mc:AlternateContent>` +
        `<mc:Choice Requires="x" xmlns:x="urn:x"><z xmlns="urn:x"/></mc:Choice>` +
        `<mc:Fallback/>` +
        `</mc:AlternateContent>` +
        `</Relationships>`,
      '/_rels/.rels'
    );
    const saved = serializeOoxmlPart(original);
    assertCleanRelsRoot(saved);
    expect(saved).toContain('mc:AlternateContent');
    expect(saved).toMatch(/Requires="ns\d+"|Requires="x"/);
    const reopened = parseRels(saved, '/_rels/.rels');
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(original));
    expect(diffSemanticDigests(semanticDigest([original]), semanticDigest([reopened]))).toEqual([]);
  });

  test('root-default URI in MC prefix/QName lists keeps a non-empty controlled alias', () => {
    const original = parseRels(
      `<Relationships xmlns="${REL}" xmlns:mc="${MC}" xmlns:r="${REL}" ` +
        `mc:Ignorable="r" mc:ProcessContent="r:widget" mc:PreserveElements="r:keep" ` +
        `mc:PreserveAttributes="r:flag">` +
        `<Relationship Id="rId1" Type="http://x" Target="a.xml"/>` +
        `</Relationships>`,
      '/_rels/.rels'
    );
    const saved = serializeOoxmlPart(original);
    assertCleanRelsRoot(saved);
    expect(saved).toContain(`xmlns:r="${REL}"`);
    expect(saved).toMatch(/mc:Ignorable="r"/);
    expect(saved).not.toContain('mc:Ignorable=""');
    expect(saved).toContain('mc:ProcessContent="r:widget"');
    expect(saved).not.toContain('mc:ProcessContent="widget"');
    const reopened = parseRels(saved, '/_rels/.rels');
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(original));
    expect(diffSemanticDigests(semanticDigest([original]), semanticDigest([reopened]))).toEqual([]);
  });

  test('root namespace used by an attribute keeps default element form plus a non-empty alias', () => {
    const original = parseRels(
      `<Relationships xmlns="${REL}" xmlns:r="${REL}" r:id="x">` +
        `<Relationship Id="rId1" Type="http://x" Target="a.xml"/>` +
        `</Relationships>`,
      '/_rels/.rels'
    );
    const saved = serializeOoxmlPart(original);
    assertCleanRelsRoot(saved);
    expect(saved).toContain(`xmlns:r="${REL}"`);
    expect(saved).toContain('r:id="x"');
    const reopened = parseRels(saved, '/_rels/.rels');
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(original));
    expect(diffSemanticDigests(semanticDigest([original]), semanticDigest([reopened]))).toEqual([]);
  });
});

describe('comprehensive fixture root namespace declaration hygiene', () => {
  function rootXmlnsByUri(xml: string): Map<string, string[]> {
    const open = xml.match(/^<[^>]+>/)?.[0] ?? '';
    const byUri = new Map<string, string[]>();
    for (const match of open.matchAll(/xmlns(?::([A-Za-z_][\w.-]*))?="([^"]*)"/g)) {
      const prefix = match[1] ?? '';
      const uri = match[2]!;
      const prefixes = byUri.get(uri) ?? [];
      prefixes.push(prefix);
      byUri.set(uri, prefixes);
    }
    return byUri;
  }

  test('save does not introduce redundant URI→multiple-prefix root declarations', () => {
    const loaded = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
    if (!main) throw new Error('missing main document');
    const beforeFp = canonicalOoxmlFingerprint(main);
    const beforeDigest = semanticDigest([main]);

    const savedXml = serializeOoxmlPart(main);
    const byUri = rootXmlnsByUri(savedXml);
    const duplicates = [...byUri.entries()].filter(([, prefixes]) => prefixes.length > 1);
    expect(duplicates).toEqual([]);

    // w14/w15/wp14-class namespaces must keep a single authored-style binding.
    for (const prefix of ['w14', 'w15', 'wp14', 'w16', 'wne', 'wp', 'r', 'm'] as const) {
      const uriMatch = savedXml.match(new RegExp(`xmlns:${prefix}="([^"]*)"`));
      if (!uriMatch) continue;
      const uri = uriMatch[1]!;
      expect(byUri.get(uri)).toEqual([prefix]);
      expect(savedXml).not.toMatch(
        new RegExp(`xmlns:ns\\d+="${uri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`)
      );
    }

    const bytes = writeOoxmlPackage(loaded.package);
    const reopened = readOoxmlPackage(bytes);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const reopenedMain = reopened.package.parts.get(reopened.package.mainDocumentPart);
    if (!reopenedMain) throw new Error('missing reopened main');
    expect(canonicalOoxmlFingerprint(reopenedMain)).toBe(beforeFp);
    expect(diffSemanticDigests(beforeDigest, semanticDigest([reopenedMain]))).toEqual([]);
    expect(rootXmlnsByUri(serializeOoxmlPart(reopenedMain))).toEqual(byUri);
  });
});

describe('comprehensive fixture fldSimple round-trip', () => {
  test('load → repair instr to scalars → save preserves exact strings and package validity', () => {
    const loaded = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
    if (!main) throw new Error('missing main document');
    // Fixture quirk (pre-existing, also opens in Word Online): instr values are already
    // the literal "[object Object]". Repair in-memory only — do not rewrite the fixture.
    const repairedPart = withFldSimpleInstructions(main, FIELD_INSTRUCTIONS);
    expect(collectFldSimple(repairedPart.root).map(instrOf)).toEqual([...FIELD_INSTRUCTIONS]);

    const repairedPkg = withPart(loaded.package, repairedPart);
    const bytes = writeOoxmlPackage(repairedPkg);
    const reopened = readOoxmlPackage(bytes);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    const reopenedMain = reopened.package.parts.get(reopened.package.mainDocumentPart);
    if (!reopenedMain) throw new Error('missing reopened main document');
    const instrs = collectFldSimple(reopenedMain.root).map(instrOf);
    expect(instrs).toEqual([...FIELD_INSTRUCTIONS]);
    expect(instrs.every((value) => typeof value === 'string')).toBe(true);
    expect(instrs).not.toContain('[object Object]');

    const relsXml = new TextDecoder().decode(reopened.package.partBytes.get('/_rels/.rels')!);
    expect(relsXml).toContain(`xmlns="${REL}"`);
    expect(relsXml).not.toMatch(/<ns\d+:Relationships/);
    expect(
      diffSemanticDigests(semanticDigest([repairedPart]), semanticDigest([reopenedMain]))
    ).toEqual([]);
  });
});
