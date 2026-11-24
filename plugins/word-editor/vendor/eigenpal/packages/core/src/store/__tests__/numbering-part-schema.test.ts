// The list definitions this engine MINTS have to be schema-valid, or Word calls
// `numbering.xml` unreadable content, repairs the file, and drops the part — and every
// list in the document with it.
//
// Three separate ways that happened, all on the first-bullet path of a document that never
// had numbering:
//
//   * `w:lvl` children were emitted `numFmt, lvlText, start, lvlJc, pPr` — `CT_Lvl`
//     (ECMA-376 17.9.6) is a strict `xsd:sequence` starting `start, numFmt, ...`.
//   * new `w:abstractNum` / `w:num` were placed "after the last sibling of my own kind"
//     rather than at their `CT_Numbering` (17.9.16) sequence position, so a part holding a
//     `w:numPicBullet` or a `w:numIdMacAtCleanup` came out of order.
//   * the `[Content_Types].xml` override was appended by string surgery that returned the
//     package UNCHANGED on failure — while `/word/numbering.xml` was already in `parts`,
//     so the package was written with a part that had no declared content type.
//
// These tests assert the EMITTED CHILD ORDER against the schema sequence, not merely that
// the elements are present.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../package/ooxml-package.ts';
import {
  ACTOR_ID_STRIPE,
  actorStripe,
  runWithTransactionActor,
} from '../package/actor-scoped-ids.ts';
import {
  ensureListDefinition,
  type ListDefinitionGeometry,
  type ListKind,
} from '../package/numbering-part.ts';
import { serializeOoxmlPart } from '../package/ooxml-tree.ts';
import type { OoxmlElement, OoxmlNode } from '../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUMBERING_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const NUMBERING_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
const CONTENT_TYPES_PART = '/[Content_Types].xml';
const NUMBERING_PART = '/word/numbering.xml';

/** `CT_Lvl` (wml.xsd, ECMA-376 17.9.6) — a strict `xsd:sequence`, in order. */
const CT_LVL_SEQUENCE = [
  'start',
  'numFmt',
  'lvlRestart',
  'pStyle',
  'isLgl',
  'suff',
  'lvlText',
  'lvlPicBulletId',
  'lvlJc',
  'pPr',
  'rPr',
] as const;

/** `CT_Numbering` (wml.xsd, ECMA-376 17.9.16) — a strict `xsd:sequence`, in order. */
const CT_NUMBERING_SEQUENCE = ['numPicBullet', 'abstractNum', 'num', 'numIdMacAtCleanup'] as const;

// ── fixtures ────────────────────────────────────────────────────────────────────────────

const DOCUMENT = `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>`;

const ROOT_RELS =
  `<Relationships xmlns="${REL_NS}">` +
  `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
  '</Relationships>';

const DOC_RELS = `<Relationships xmlns="${REL_NS}"></Relationships>`;

/** `rootPrefix` writes the whole part under a prefix, the shape OPC permits and Word does not. */
function contentTypes(extra = '', rootPrefix = ''): string {
  const q = (name: string): string => (rootPrefix ? `${rootPrefix}:${name}` : name);
  const xmlns = rootPrefix ? `xmlns:${rootPrefix}="${CT_NS}"` : `xmlns="${CT_NS}"`;
  return (
    `<${q('Types')} ${xmlns}>` +
    `<${q('Default')} Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<${q('Override')} PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    extra +
    `</${q('Types')}>`
  );
}

interface BuildOptions {
  readonly numbering?: string;
  readonly types?: string;
  readonly docRels?: string;
}

function load(options: BuildOptions = {}): OoxmlPackage {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      options.types ??
        contentTypes(
          options.numbering
            ? `<Override PartName="${NUMBERING_PART}" ContentType="${NUMBERING_CONTENT_TYPE}"/>`
            : ''
        )
    ),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/_rels/document.xml.rels': strToU8(options.docRels ?? DOC_RELS),
    'word/document.xml': strToU8(DOCUMENT),
  };
  if (options.numbering) entries['word/numbering.xml'] = strToU8(options.numbering);
  const result = readOoxmlPackage(zipSync(entries));
  if (!result.ok) throw new Error(`fixture rejected: ${result.reason} ${result.detail ?? ''}`);
  return result.package;
}

/** Swap one raw part's bytes, to reach the content-type failure branches. */
function withBytes(pkg: OoxmlPackage, name: string, xml: string | null): OoxmlPackage {
  const bytes = new Map(pkg.partBytes);
  if (xml === null) bytes.delete(name);
  else bytes.set(name, strToU8(xml));
  return Object.freeze({ ...pkg, partBytes: bytes });
}

// ── tree helpers ────────────────────────────────────────────────────────────────────────

const elements = (node: OoxmlElement): OoxmlElement[] =>
  node.children.filter((child): child is OoxmlElement => child.kind !== 'textValue');

const named = (node: OoxmlElement, localName: string): OoxmlElement[] =>
  elements(node).filter((child) => child.localName === localName);

const attribute = (node: OoxmlElement, localName: string): string | undefined =>
  node.attributes.find((entry) => entry.localName === localName)?.value;

const childNames = (node: OoxmlElement): string[] => elements(node).map((child) => child.localName);

function ensured(pkg: OoxmlPackage, kind: ListKind): { pkg: OoxmlPackage; numId: string } {
  const result = ensureListDefinition(pkg, kind);
  if (!result) throw new Error('ensureListDefinition refused');
  return result;
}

function numberingRoot(pkg: OoxmlPackage): OoxmlElement {
  const part = pkg.parts.get(NUMBERING_PART);
  if (!part) throw new Error('no numbering part');
  return part.root;
}

/** True when every name appears in `sequence` and the names never go backwards in it. */
function isSequenceOrdered(names: readonly string[], sequence: readonly string[]): boolean {
  let floor = -1;
  for (const name of names) {
    const rank = sequence.indexOf(name);
    if (rank === -1 || rank < floor) return false;
    floor = rank;
  }
  return true;
}

// ── A1: CT_Lvl child order ──────────────────────────────────────────────────────────────

describe('A1 — minted w:lvl children follow CT_Lvl (17.9.6)', () => {
  for (const kind of ['bullet', 'ordered'] as const) {
    test(`every one of the nine ${kind} levels is in CT_Lvl sequence order`, () => {
      const next = ensured(load(), kind).pkg;
      const abstract = named(numberingRoot(next), 'abstractNum')[0]!;
      const levels = named(abstract, 'lvl');
      expect(levels).toHaveLength(9);
      for (const level of levels) {
        const names = childNames(level);
        // The real assertion: the EMITTED order, checked against the schema sequence.
        expect({ ilvl: attribute(level, 'ilvl'), ordered: true }).toEqual({
          ilvl: attribute(level, 'ilvl'),
          ordered: isSequenceOrdered(names, CT_LVL_SEQUENCE),
        });
      }
    });
  }

  test('a bullet level emits exactly start, numFmt, lvlText, lvlJc, pPr, rPr', () => {
    const next = ensured(load(), 'bullet').pkg;
    const abstract = named(numberingRoot(next), 'abstractNum')[0]!;
    expect(childNames(named(abstract, 'lvl')[0]!)).toEqual([
      'start',
      'numFmt',
      'lvlText',
      'lvlJc',
      'pPr',
      'rPr',
    ]);
  });

  test('an ordered level emits exactly start, numFmt, lvlText, lvlJc, pPr', () => {
    const next = ensured(load(), 'ordered').pkg;
    const abstract = named(numberingRoot(next), 'abstractNum')[0]!;
    expect(childNames(named(abstract, 'lvl')[0]!)).toEqual([
      'start',
      'numFmt',
      'lvlText',
      'lvlJc',
      'pPr',
    ]);
  });

  test('CT_AbstractNum order holds too: multiLevelType before every lvl', () => {
    const next = ensured(load(), 'bullet').pkg;
    const abstract = named(numberingRoot(next), 'abstractNum')[0]!;
    const names = childNames(abstract);
    expect(names[0]).toBe('multiLevelType');
    expect(names.slice(1).every((name) => name === 'lvl')).toBe(true);
  });
});

// ── A2: CT_Numbering child order ────────────────────────────────────────────────────────

/** A part holding BOTH bookends of `CT_Numbering`, plus an existing bullet definition. */
const BUSY_NUMBERING =
  `<w:numbering xmlns:w="${W}">` +
  '<w:numPicBullet w:numPicBulletId="0"><w:lvlPicBulletId w:val="0"/></w:numPicBullet>' +
  '<w:abstractNum w:abstractNumId="4"><w:multiLevelType w:val="hybridMultilevel"/>' +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/>' +
  '<w:lvlText w:val="&#xF0B7;"/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum>' +
  '<w:num w:numId="7"><w:abstractNumId w:val="4"/></w:num>' +
  '<w:numIdMacAtCleanup w:val="9"/>' +
  '</w:numbering>';

describe('A2 — new abstractNum/num land at their CT_Numbering (17.9.16) position', () => {
  test('a part with numPicBullet and numIdMacAtCleanup stays in sequence order', () => {
    const next = ensured(load({ numbering: BUSY_NUMBERING }), 'ordered').pkg;
    const names = childNames(numberingRoot(next));
    expect(names).toEqual([
      'numPicBullet',
      'abstractNum',
      'abstractNum',
      'num',
      'num',
      'numIdMacAtCleanup',
    ]);
    expect(isSequenceOrdered(names, CT_NUMBERING_SEQUENCE)).toBe(true);
  });

  test('a part whose only child is numPicBullet does not get abstractNum before it', () => {
    const numbering =
      `<w:numbering xmlns:w="${W}">` +
      '<w:numPicBullet w:numPicBulletId="0"><w:lvlPicBulletId w:val="0"/></w:numPicBullet>' +
      '</w:numbering>';
    const names = childNames(numberingRoot(ensured(load({ numbering }), 'bullet').pkg));
    expect(names).toEqual(['numPicBullet', 'abstractNum', 'num']);
  });

  test('an empty numbering part is still ordered abstractNum then num', () => {
    const names = childNames(numberingRoot(ensured(load(), 'bullet').pkg));
    expect(names).toEqual(['abstractNum', 'num']);
    expect(isSequenceOrdered(names, CT_NUMBERING_SEQUENCE)).toBe(true);
  });

  test('whitespace between elements does not push the insert to the front', () => {
    const numbering =
      `<w:numbering xmlns:w="${W}">\n  ` +
      '<w:numPicBullet w:numPicBulletId="0"><w:lvlPicBulletId w:val="0"/></w:numPicBullet>\n  ' +
      '<w:numIdMacAtCleanup w:val="3"/>\n' +
      '</w:numbering>';
    const names = childNames(numberingRoot(ensured(load({ numbering }), 'bullet').pkg));
    expect(names).toEqual(['numPicBullet', 'abstractNum', 'num', 'numIdMacAtCleanup']);
  });

  test('a template the document authored is not borrowed', () => {
    const first = ensured(load({ numbering: BUSY_NUMBERING }), 'bullet');
    expect(first.numId).toBe('8');
    expect(childNames(numberingRoot(first.pkg))).toEqual([
      'numPicBullet',
      'abstractNum',
      'abstractNum',
      'num',
      'num',
      'numIdMacAtCleanup',
    ]);
  });

  test('its own template is reused with a fresh counter instance', () => {
    const first = ensured(load({ numbering: BUSY_NUMBERING }), 'bullet');
    const second = ensured(first.pkg, 'bullet');
    expect(second.numId).toBe('9');
    const root = numberingRoot(second.pkg);
    expect(named(root, 'abstractNum')).toHaveLength(2);
    const nums = named(root, 'num');
    expect(nums.map((num) => attribute(named(num, 'abstractNumId')[0]!, 'val'))).toEqual([
      '4',
      '5',
      '5',
    ]);
  });
});

// ── A3: the content-type override fails CLOSED ──────────────────────────────────────────

describe('A3 — the [Content_Types].xml override fails closed', () => {
  test('no content-types part at all refuses the operation', () => {
    const pkg = withBytes(load(), CONTENT_TYPES_PART, null);
    expect(ensureListDefinition(pkg, 'bullet')).toBeNull();
  });

  test('a content-types root that cannot be patched refuses the operation', () => {
    // A legal, empty, self-closing root: there is no closing tag to insert before.
    const pkg = withBytes(load(), CONTENT_TYPES_PART, `<Types xmlns="${CT_NS}"/>`);
    expect(ensureListDefinition(pkg, 'bullet')).toBeNull();
  });

  test('a root that is not a content-types root refuses the operation', () => {
    const pkg = withBytes(load(), CONTENT_TYPES_PART, '<Types xmlns="urn:not-opc"></Types>');
    expect(ensureListDefinition(pkg, 'bullet')).toBeNull();
  });

  test('unparseable content-types bytes refuse the operation', () => {
    const pkg = withBytes(load(), CONTENT_TYPES_PART, '<Types');
    expect(ensureListDefinition(pkg, 'bullet')).toBeNull();
  });

  test('a LEGALLY PREFIXED content-types root is patched, not skipped', () => {
    const pkg = load({ types: contentTypes('', 'ct') });
    const next = ensured(pkg, 'bullet').pkg;
    expect(next.contentTypes.overrides.get(NUMBERING_PART.toLowerCase())).toBe(
      NUMBERING_CONTENT_TYPE
    );
    const patched = new TextDecoder().decode(next.partBytes.get(CONTENT_TYPES_PART)!);
    expect(patched).toContain(`PartName="${NUMBERING_PART}"`);
    expect(patched.endsWith('</ct:Types>')).toBe(true);
  });

  test('a package this refuses never gains a numbering part', () => {
    // The failure that mattered: the part was already in `parts` when the override bailed.
    const pkg = withBytes(load(), CONTENT_TYPES_PART, `<Types xmlns="${CT_NS}"/>`);
    expect(ensureListDefinition(pkg, 'bullet')).toBeNull();
    expect(pkg.parts.has(NUMBERING_PART)).toBe(false);
  });

  test('the ordinary path declares the override in bytes and in the index', () => {
    const next = ensured(load(), 'bullet').pkg;
    expect(next.contentTypes.overrides.get(NUMBERING_PART.toLowerCase())).toBe(
      NUMBERING_CONTENT_TYPE
    );
    const patched = new TextDecoder().decode(next.partBytes.get(CONTENT_TYPES_PART)!);
    expect(patched).toContain(
      `<Override PartName="${NUMBERING_PART}" ContentType="${NUMBERING_CONTENT_TYPE}"/>`
    );
    // Reopening the written package resolves the numbering part's type from the override.
    expect(patched.indexOf('/word/document.xml')).toBeLessThan(patched.indexOf(NUMBERING_PART));
  });

  test('an existing numbering part needs no content-type patch', () => {
    const pkg = load({ numbering: BUSY_NUMBERING });
    const next = ensured(pkg, 'ordered').pkg;
    expect(next.partBytes.get(CONTENT_TYPES_PART)).toEqual(pkg.partBytes.get(CONTENT_TYPES_PART));
  });
});

// ── A4: the relationship reaches pkg.relationships ──────────────────────────────────────

describe('A4 — the minted relationship is recorded in memory, not only on disk', () => {
  test('pkg.relationships gains the numbering record', () => {
    const next = ensured(load(), 'bullet').pkg;
    const records = next.relationships.get(next.mainDocumentPart) ?? [];
    const numbering = records.find((record) => record.type === NUMBERING_REL_TYPE);
    expect(numbering).toBeDefined();
    expect(numbering!.rawTarget).toBe('numbering.xml');
    expect(numbering!.targetMode).toBe('Internal');
    expect(numbering!.ownerPart).toBe(next.mainDocumentPart);
  });

  test('the next relationship id cannot collide with the one just minted', () => {
    const docRels =
      `<Relationships xmlns="${REL_NS}">` +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';
    const next = ensured(load({ docRels }), 'bullet').pkg;
    const records = next.relationships.get(next.mainDocumentPart) ?? [];
    const ids = records.map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('rId4');
    // The ids in the map match the ids actually written into the rels part.
    const relsPart = next.parts.get('/word/_rels/document.xml.rels')!;
    const written = elements(relsPart.root).map((node) => attribute(node, 'Id'));
    expect(written).toEqual(ids);
  });
});

// ── the whole thing, through save and reopen ────────────────────────────────────────────

describe('the saved package reopens with the list intact', () => {
  test('write -> read gives back the numbering part, its type and its relationship', () => {
    const next = ensured(load(), 'bullet').pkg;
    const reopened = readOoxmlPackage(writeOoxmlPackage(next));
    if (!reopened.ok) throw new Error(`reopen rejected: ${reopened.reason}`);
    const pkg = reopened.package;
    // The content-type override survived, so the part came back as a TREE, not raw bytes.
    expect(pkg.parts.has(NUMBERING_PART)).toBe(true);
    const relationship = (pkg.relationships.get(pkg.mainDocumentPart) ?? []).find(
      (record) => record.type === NUMBERING_REL_TYPE
    );
    expect(relationship?.rawTarget).toBe('numbering.xml');
  });

  test('the SERIALIZED part carries the CT_Lvl order, not just the in-memory tree', () => {
    const next = ensured(load(), 'bullet').pkg;
    const xml = serializeOoxmlPart(next.parts.get(NUMBERING_PART)!);
    // What Word actually reads: the emitted bytes, in schema order.
    expect(xml).toContain(
      '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText'
    );
    expect(xml.indexOf('<w:abstractNum')).toBeLessThan(xml.indexOf('<w:num '));

    const reopened = readOoxmlPackage(writeOoxmlPackage(next));
    if (!reopened.ok) throw new Error(reopened.reason);
    const root = numberingRoot(reopened.package);
    expect(isSequenceOrdered(childNames(root), CT_NUMBERING_SEQUENCE)).toBe(true);
    const abstract = named(root, 'abstractNum')[0]!;
    for (const level of named(abstract, 'lvl')) {
      expect(isSequenceOrdered(childNames(level), CT_LVL_SEQUENCE)).toBe(true);
    }
  });

  test('a second disconnected list reuses the template with a fresh counter', () => {
    const first = ensured(load(), 'bullet');
    const second = ensured(first.pkg, 'bullet');
    expect(second.numId).not.toBe(first.numId);
    expect(named(numberingRoot(second.pkg), 'abstractNum')).toHaveLength(1);
    expect(named(numberingRoot(second.pkg), 'num')).toHaveLength(2);
    // A bullet list can become numbered later, so its fresh instance restarts every level too.
    const overrides = named(named(numberingRoot(second.pkg), 'num')[1]!, 'lvlOverride');
    expect(overrides.map((override) => attribute(override, 'ilvl'))).toEqual(
      Array.from({ length: 9 }, (_, ilvl) => String(ilvl))
    );
    for (const override of overrides) {
      expect(attribute(named(override, 'startOverride')[0]!, 'val')).toBe('1');
    }
  });

  test('a second ordered list on the reused template restarts every numbered level', () => {
    const first = ensured(load(), 'ordered');
    const second = ensured(first.pkg, 'ordered');
    expect(named(numberingRoot(second.pkg), 'abstractNum')).toHaveLength(1);
    const [firstNum, secondNum] = named(numberingRoot(second.pkg), 'num');
    // The first list owns the template; the counter it shares starts at the level start.
    expect(named(firstNum!, 'lvlOverride')).toHaveLength(0);
    const overrides = named(secondNum!, 'lvlOverride');
    expect(overrides.map((override) => attribute(override, 'ilvl'))).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
    ]);
    for (const override of overrides) {
      expect(attribute(named(override, 'startOverride')[0]!, 'val')).toBe('1');
    }
  });

  test('bullet then ordered gives two definitions, still in sequence order', () => {
    const first = ensured(load(), 'bullet');
    const second = ensured(first.pkg, 'ordered');
    expect(second.numId).not.toBe(first.numId);
    expect(childNames(numberingRoot(second.pkg))).toEqual([
      'abstractNum',
      'abstractNum',
      'num',
      'num',
    ]);
  });
});

// ── B15: Word's own bullet codepoints ───────────────────────────────────────────────────

describe('B15 — minted bullet glyphs are the codepoints Word writes', () => {
  test('levels 0/1/2 are U+F0B7 Symbol, o Courier New, U+F0A7 Wingdings', () => {
    const next = ensured(load(), 'bullet').pkg;
    const abstract = named(numberingRoot(next), 'abstractNum')[0]!;
    const levels = named(abstract, 'lvl');
    const glyphs = levels.map((level) => attribute(named(level, 'lvlText')[0]!, 'val'));
    const fonts = levels.map((level) => {
      const rPr = named(level, 'rPr')[0]!;
      return attribute(named(rPr, 'rFonts')[0]!, 'ascii');
    });
    expect(glyphs.slice(0, 3)).toEqual(['\uF0B7', 'o', '\uF0A7']);
    expect(fonts.slice(0, 3)).toEqual(['Symbol', 'Courier New', 'Wingdings']);
    // The cycle repeats every three, all nine levels.
    expect(glyphs).toEqual([
      '\uF0B7',
      'o',
      '\uF0A7',
      '\uF0B7',
      'o',
      '\uF0A7',
      '\uF0B7',
      'o',
      '\uF0A7',
    ]);
  });
});

// ── required content, checked while we are here ─────────────────────────────────────────

describe('the minted definition carries the content CT_AbstractNum/CT_Num require', () => {
  test('ilvl runs 0..8 — CT_AbstractNum bounds w:lvl at maxOccurs 9', () => {
    const next = ensured(load(), 'ordered').pkg;
    const abstract = named(numberingRoot(next), 'abstractNum')[0]!;
    expect(named(abstract, 'lvl').map((level) => attribute(level, 'ilvl'))).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
    ]);
  });

  test('multiLevelType is one of the three ST_MultiLevelType values', () => {
    for (const kind of ['bullet', 'ordered'] as const) {
      const abstract = named(numberingRoot(ensured(load(), kind).pkg), 'abstractNum')[0]!;
      const value = attribute(named(abstract, 'multiLevelType')[0]!, 'val');
      expect(['singleLevel', 'multilevel', 'hybridMultilevel']).toContain(value);
    }
  });

  test('the ids are positive integers and the num points at the abstractNum', () => {
    const next = ensured(load({ numbering: BUSY_NUMBERING }), 'ordered').pkg;
    const root = numberingRoot(next);
    const abstracts = named(root, 'abstractNum');
    const nums = named(root, 'num');
    const minted = abstracts[abstracts.length - 1]!;
    const mintedNum = nums[nums.length - 1]!;
    const abstractId = attribute(minted, 'abstractNumId')!;
    const numId = attribute(mintedNum, 'numId')!;
    expect(Number(abstractId)).toBeGreaterThan(0);
    // `w:numId` 0 is Word's "no numbering" sentinel; a minted id must never be it.
    expect(Number(numId)).toBeGreaterThan(0);
    expect(attribute(named(mintedNum, 'abstractNumId')[0]!, 'val')).toBe(abstractId);
    // No id collides with the ones already in the part.
    expect(abstracts.map((node) => attribute(node, 'abstractNumId'))).toEqual(['4', abstractId]);
    expect(nums.map((node) => attribute(node, 'numId'))).toEqual(['7', numId]);
  });

  test('every w:abstractNum precedes every w:num', () => {
    const root = numberingRoot(ensured(load({ numbering: BUSY_NUMBERING }), 'ordered').pkg);
    const names = childNames(root);
    expect(names.lastIndexOf('abstractNum')).toBeLessThan(names.indexOf('num'));
  });

  test('the grafted subtree gets ids that do not collide with the part it joins', () => {
    const next = ensured(load({ numbering: BUSY_NUMBERING }), 'ordered').pkg;
    const ids: string[] = [];
    const walk = (node: OoxmlNode): void => {
      ids.push(node.id);
      if (node.kind !== 'textValue') node.children.forEach(walk);
    };
    walk(numberingRoot(next));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('an attached actor stripes numbering ids', () => {
  test('two actors mint different numIds from the same empty numbering snapshot', () => {
    const start = load();
    const left = runWithTransactionActor('alice', () => ensureListDefinition(start, 'bullet'));
    const right = runWithTransactionActor('bob', () => ensureListDefinition(start, 'bullet'));
    if (!left || !right) throw new Error('ensureListDefinition refused');
    expect(left.numId).not.toBe(right.numId);
    expect(left.numId).toBe(stripedNumberingId('alice'));
    expect(right.numId).toBe(stripedNumberingId('bob'));
  });
});

/** `w:numId` 0 is Word's "no numbering" sentinel, so stripe 0 advances one class. */
function stripedNumberingId(actorId: string): string {
  const stripe = actorStripe(actorId);
  return String(stripe === 0 ? ACTOR_ID_STRIPE : stripe);
}

// ── A6: definitions that keep an existing list's geometry ───────────────────────────────

describe('A6 — a definition minted with level geometry', () => {
  const indentOf = (level: OoxmlElement): Record<string, string> | null => {
    const ind = named(named(level, 'pPr')[0] ?? level, 'ind')[0];
    if (!ind || named(level, 'pPr').length === 0) return null;
    return Object.fromEntries(ind.attributes.map((entry) => [entry.localName, entry.value]));
  };

  const minted = (kind: ListKind, geometry: ListDefinitionGeometry, pkg = load()) => {
    const result = ensureListDefinition(pkg, kind, geometry);
    if (!result) throw new Error('ensureListDefinition refused');
    const abstracts = named(numberingRoot(result.pkg), 'abstractNum');
    return { ...result, levels: named(abstracts[abstracts.length - 1]!, 'lvl') };
  };

  test('writes the stated indent, suffix and alignment in CT_Lvl order', () => {
    const { levels } = minted('ordered', [
      { left: 360, hanging: 360, suffix: 'space', align: 'right' },
      { left: 1000, firstLine: 200 },
      {},
    ]);
    expect(childNames(levels[0]!)).toEqual(['start', 'numFmt', 'suff', 'lvlText', 'lvlJc', 'pPr']);
    expect(levels.every((level) => isSequenceOrdered(childNames(level), CT_LVL_SEQUENCE))).toBe(
      true
    );
    expect(indentOf(levels[0]!)).toEqual({ left: '360', hanging: '360' });
    expect(attribute(named(levels[0]!, 'lvlJc')[0]!, 'val')).toBe('right');
    expect(indentOf(levels[1]!)).toEqual({ left: '1000', firstLine: '200' });
    // A level that stated no indent leaves the paragraph style's indent in charge.
    expect(named(levels[2]!, 'pPr')).toHaveLength(0);
    // A level the old list never declared takes the stock geometry.
    expect(indentOf(levels[3]!)).toEqual({ left: '2880', hanging: '360' });
  });

  test('drops values outside the schema range instead of writing them', () => {
    const { levels } = minted('bullet', [
      { left: 0.5, hanging: -10, right: 99_999 },
      { left: -720, hanging: 360, firstLine: 100 },
    ]);
    expect(named(levels[0]!, 'pPr')).toHaveLength(0);
    // `w:hanging` and `w:firstLine` are one slot: the hanging indent wins.
    expect(indentOf(levels[1]!)).toEqual({ left: '-720', hanging: '360' });
  });

  test('carries the old level paragraph properties around the authored indent', () => {
    const source = load({
      numbering:
        `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
        '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
        '<w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:numId w:val="9"/></w:numPr><w:bidi/>' +
        '<w:ind w:left="9999"/><w:jc w:val="both"/><w:rPr><w:b/></w:rPr></w:pPr></w:lvl>' +
        '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
    });
    const level = named(named(numberingRoot(source), 'abstractNum')[0]!, 'lvl')[0]!;
    const paragraphProperties = named(level, 'pPr')[0]!;
    const { levels } = minted('bullet', [{ left: 360, hanging: 360, paragraphProperties }], source);
    expect(childNames(named(levels[0]!, 'pPr')[0]!)).toEqual(['bidi', 'ind', 'jc']);
    expect(indentOf(levels[0]!)).toEqual({ left: '360', hanging: '360' });
    // Copied, not shared: the old level keeps its own properties.
    expect(childNames(paragraphProperties)).toContain('numPr');
  });

  test('reuses a definition with the same levels, never one with other geometry', () => {
    const geometry: ListDefinitionGeometry = [{ left: 360, hanging: 360 }];
    const stock = ensured(load(), 'bullet');
    const first = minted('bullet', geometry, stock.pkg);
    const again = minted('bullet', geometry, first.pkg);
    const abstracts = (pkg: OoxmlPackage) => named(numberingRoot(pkg), 'abstractNum');
    expect(abstracts(first.pkg)).toHaveLength(2);
    expect(abstracts(again.pkg)).toHaveLength(2);
    expect(again.numId).not.toBe(first.numId);
    const num = named(numberingRoot(again.pkg), 'num').find(
      (node) => attribute(node, 'numId') === again.numId
    )!;
    expect(attribute(named(num, 'abstractNumId')[0]!, 'val')).toBe(
      attribute(abstracts(first.pkg)[1]!, 'abstractNumId')
    );
    // The reused definition still restarts its counters for the new list.
    expect(named(num, 'lvlOverride').length).toBeGreaterThan(0);
  });
});
