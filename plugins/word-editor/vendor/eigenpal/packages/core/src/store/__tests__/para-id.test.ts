// `w14:paraId` value rules, deterministic minting, and load-time normalization
// (para-id.ts): every paragraph of an opened main part carries a valid, part-unique
// identity; documents that already do are returned by reference, byte-stable.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  validateOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import {
  isValidParaId,
  mintParaId,
  normalizeParagraphIdentity,
  paraIdOf,
  usedParaIds,
  w14RootPrefix,
} from '../package/para-id.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

const FIXTURES = join(import.meta.dir, '../../../../../e2e/fixtures');

function loadDocument(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function mainPartOf(fixture: string): OoxmlPart {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, fixture)));
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('no main part');
  return main;
}

function wmlParagraphs(part: OoxmlPart): OoxmlElement[] {
  const paragraphs: OoxmlElement[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === W && node.localName === 'p') paragraphs.push(node);
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return paragraphs;
}

describe('isValidParaId', () => {
  test('accepts 8-hex values in (0, 0x80000000)', () => {
    expect(isValidParaId('00000001')).toBe(true);
    expect(isValidParaId('7FFFFFFF')).toBe(true);
    expect(isValidParaId('4c2a91e0')).toBe(true); // lowercase hex is legal
    expect(isValidParaId('19481808')).toBe(true);
  });

  test('rejects zero, the high-bit range, and malformed tokens', () => {
    expect(isValidParaId('00000000')).toBe(false); // Word treats as absent
    expect(isValidParaId('80000000')).toBe(false);
    expect(isValidParaId('FFFFFFFF')).toBe(false);
    expect(isValidParaId('1234567')).toBe(false); // 7 chars
    expect(isValidParaId('123456789')).toBe(false); // 9 chars
    expect(isValidParaId('1234567G')).toBe(false);
    expect(isValidParaId('')).toBe(false);
  });
});

describe('mintParaId', () => {
  test('deterministic, uppercase, in range', () => {
    const first = mintParaId('seed', new Set());
    expect(mintParaId('seed', new Set())).toBe(first);
    expect(first).toMatch(/^[0-9A-F]{8}$/);
    expect(isValidParaId(first)).toBe(true);
  });

  test('collision bump is deterministic too', () => {
    const first = mintParaId('seed', new Set());
    const bumped = mintParaId('seed', new Set([first]));
    expect(bumped).not.toBe(first);
    expect(isValidParaId(bumped)).toBe(true);
    expect(mintParaId('seed', new Set([first]))).toBe(bumped);
  });

  test('terminates with a valid id under a saturated used-set', () => {
    // Poison every value the 64 hash attempts could produce, forcing the linear probe.
    const used = new Set<string>();
    for (let attempt = 0; attempt < 64; attempt += 1) {
      used.add(mintParaId('x', used));
    }
    const minted = mintParaId('x', used);
    expect(isValidParaId(minted)).toBe(true);
    expect(used.has(minted)).toBe(false);
  });
});

describe('normalizeParagraphIdentity', () => {
  test('mints for every paragraph shape: body, table cell, demoted-generic', () => {
    const part = loadDocument(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:r><w:t>plain</w:t></w:r></w:p>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        // A w:p with a w:val attribute demotes to generic — still a paragraph to Word.
        '<w:p w:val="bogus"><w:r><w:t>demoted</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    );
    const normalized = normalizeParagraphIdentity(part);
    expect(normalized).not.toBe(part);
    const paragraphs = wmlParagraphs(normalized);
    expect(paragraphs).toHaveLength(3);
    const ids = paragraphs.map((paragraph) => paraIdOf(paragraph));
    for (const id of ids) expect(isValidParaId(id!)).toBe(true);
    expect(new Set(ids).size).toBe(3);
    // The pair is written together, with textId mirroring paraId.
    const serialized = serializeOoxmlPart(normalized);
    for (const id of ids) expect(serialized).toContain(`w14:paraId="${id}" w14:textId="${id}"`);
    // Root binding added exactly once.
    expect(w14RootPrefix(normalized.root)).toBe('w14');
    expect(serialized.match(/xmlns:w14=/g)).toHaveLength(1);
  });

  test('deterministic across parses and idempotent', () => {
    const xml = `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>a</w:t></w:r></w:p><w:p/></w:body></w:document>`;
    const first = normalizeParagraphIdentity(loadDocument(xml));
    const second = normalizeParagraphIdentity(loadDocument(xml));
    expect(serializeOoxmlPart(first)).toBe(serializeOoxmlPart(second));
    expect(normalizeParagraphIdentity(first)).toBe(first);
  });

  test('a document whose paragraphs all carry valid unique ids returns BY REFERENCE', () => {
    const part = loadDocument(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>` +
        '<w:p w14:paraId="4C000001" w14:textId="4C000001"/>' +
        '<w:p w14:paraId="4C000002" w14:textId="4C000002"/>' +
        '</w:body></w:document>'
    );
    expect(normalizeParagraphIdentity(part)).toBe(part);
  });

  test('real Word fixtures with full identity normalize to the same reference', () => {
    for (const fixture of ['example-with-image.docx', 'issue-319-sections.docx']) {
      const main = mainPartOf(fixture);
      expect(normalizeParagraphIdentity(main)).toBe(main);
    }
  });

  test('keeps valid ids verbatim; re-mints duplicates, zero, out-of-range and malformed', () => {
    const part = loadDocument(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>` +
        '<w:p w14:paraId="4c00aa01" w14:textId="4c00aa01"/>' + // valid, lowercase — kept verbatim
        '<w:p w14:paraId="4C00AA01" w14:textId="4C00AA01"/>' + // duplicate (case-insensitive) — re-minted
        '<w:p w14:paraId="00000000" w14:textId="00000000"/>' + // zero = absent
        '<w:p w14:paraId="FFFFFFFF" w14:textId="FFFFFFFF"/>' + // out of range
        '<w:p w14:paraId="nothex!!" w14:textId="nothex!!"/>' + // malformed
        '</w:body></w:document>'
    );
    const normalized = normalizeParagraphIdentity(part);
    const ids = wmlParagraphs(normalized).map((paragraph) => paraIdOf(paragraph)!);
    expect(ids[0]).toBe('4c00aa01');
    for (const id of ids.slice(1)) {
      expect(isValidParaId(id)).toBe(true);
      expect(id.toUpperCase()).not.toBe('4C00AA01');
    }
    expect(new Set(ids.map((id) => id.toUpperCase())).size).toBe(5);
    // The stale textId of a re-minted paragraph is replaced along with its paraId.
    expect(serializeOoxmlPart(normalized)).not.toContain('FFFFFFFF');
  });

  test('a kept paraId without a root binding still gains the root binding', () => {
    // Legal-but-unseen: w14 declared per-paragraph only. Split minting needs the ROOT
    // binding, so normalization adds it even though no paragraph needed a mint.
    const part = loadDocument(
      `<w:document xmlns:w="${W}"><w:body>` +
        `<w:p xmlns:w14="${W14}" w14:paraId="4C000001" w14:textId="4C000001"/>` +
        '</w:body></w:document>'
    );
    const normalized = normalizeParagraphIdentity(part);
    expect(normalized).not.toBe(part);
    expect(w14RootPrefix(normalized.root)).toBe('w14');
    expect(paraIdOf(wmlParagraphs(normalized)[0]!)).toBe('4C000001');
  });

  test('reuses an existing root binding for the URI under another prefix', () => {
    const part = loadDocument(
      `<w:document xmlns:w="${W}" xmlns:wx="${W14}"><w:body><w:p/></w:body></w:document>`
    );
    const normalized = normalizeParagraphIdentity(part);
    expect(w14RootPrefix(normalized.root)).toBe('wx');
    expect(serializeOoxmlPart(normalized)).toContain('wx:paraId=');
  });

  test('an authored root w14 binding shadowed mid-tree falls back to a fresh alias', () => {
    // The root binds w14 correctly, but a hostile subtree rebinds it. Minting under
    // the authored prefix would fail validation for the shadowed paragraph and the
    // fail-open would strip identity from the WHOLE document — instead the pass mints
    // under an alias that is valid at every depth.
    const part = loadDocument(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>` +
        '<w:p/>' +
        '<w:sdt xmlns:w14="urn:evil"><w:sdtContent><w:p/></w:sdtContent></w:sdt>' +
        '</w:body></w:document>'
    );
    const normalized = normalizeParagraphIdentity(part);
    expect(normalized).not.toBe(part);
    const ids = wmlParagraphs(normalized).map((paragraph) => paraIdOf(paragraph)!);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(isValidParaId(id)).toBe(true);
    expect(validateOoxmlPart(normalized).ok).toBe(true);
    expect(serializeOoxmlPart(normalized)).toContain('w14a:paraId=');
  });

  test('a hostile mid-tree xmlns:w14 pushes minting to a fallback prefix', () => {
    const part = loadDocument(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:r><w:rPr><w:evil xmlns:w14="urn:evil"/></w:rPr></w:r></w:p>' +
        '</w:body></w:document>'
    );
    const normalized = normalizeParagraphIdentity(part);
    expect(normalized).not.toBe(part);
    expect(w14RootPrefix(normalized.root)).toBe('w14a');
    expect(validateOoxmlPart(normalized).ok).toBe(true);
    // Round-trips: serialize → reparse → fingerprint-identical.
    const reopened = loadDocument(serializeOoxmlPart(normalized));
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(normalized));
  });

  test('mc:Ignorable gains the prefix token only when the attribute already exists', () => {
    const withIgnorable = normalizeParagraphIdentity(
      loadDocument(
        `<w:document xmlns:w="${W}" xmlns:mc="${MC}" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w15"><w:body><w:p/></w:body></w:document>`
      )
    );
    const ignorable = withIgnorable.root.attributes.find(
      (attribute) => attribute.namespaceUri === MC && attribute.localName === 'Ignorable'
    );
    expect(ignorable?.value).toBe('w15 w14');

    const without = normalizeParagraphIdentity(
      loadDocument(`<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`)
    );
    expect(
      without.root.attributes.some(
        (attribute) => attribute.namespaceUri === MC && attribute.localName === 'Ignorable'
      )
    ).toBe(false);
  });

  test('normalized output validates, serializes and round-trips the fingerprint', () => {
    const part = loadDocument(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p><w:p/></w:body></w:document>`
    );
    const normalized = normalizeParagraphIdentity(part);
    expect(validateOoxmlPart(normalized).ok).toBe(true);
    const reopened = loadDocument(serializeOoxmlPart(normalized));
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(normalized));
    expect(usedParaIds(reopened.root)).toEqual(usedParaIds(normalized.root));
  });
});

describe('usedParaIds', () => {
  test('after a store split, the memoized set over the new root equals a full walk', () => {
    // `usedParaIds` composes from per-subtree memos, and a split shares the untouched
    // sibling paragraph by reference — so a stale entry would surface exactly here, as a
    // set that misses the id the split just minted against it.
    const part = loadDocument(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>` +
        '<w:p w14:paraId="4C000001" w14:textId="4C000001"><w:r><w:t>alphaomega</w:t></w:r></w:p>' +
        '<w:p w14:paraId="4C000002" w14:textId="4C000002"><w:r><w:t>second</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    );
    const store = new TreeDocumentStore(part);
    // Warm the memo on the pre-split root, so the post-split read cannot pass by
    // recomputing from scratch.
    expect(usedParaIds(store.part.root)).toEqual(new Set(['4C000001', '4C000002']));
    const firstParagraphId = wmlParagraphs(store.part)[0]!.id;
    const result = store.transact((tx) => {
      tx.apply({ op: 'splitParagraph', paragraphId: firstParagraphId, offset: 5 });
    });
    expect(result.ok).toBe(true);

    // The oracle: an unmemoized full walk of the new root.
    const walked = new Set<string>();
    const visit = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      const value = paraIdOf(node);
      if (value !== null && isValidParaId(value)) walked.add(value.toUpperCase());
      for (const child of node.children) visit(child);
    };
    visit(store.part.root);

    expect(usedParaIds(store.part.root)).toEqual(walked);
    expect(walked.size).toBe(3);
    const minted = [...walked].filter((id) => id !== '4C000001' && id !== '4C000002');
    expect(minted).toHaveLength(1);
    expect(isValidParaId(minted[0]!)).toBe(true);
  });
});
