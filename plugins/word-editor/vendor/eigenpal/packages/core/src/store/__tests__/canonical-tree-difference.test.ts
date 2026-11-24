// The incremental canonical comparison behind remote package publication.
//
// The comparison exists so a replica can decide what one received edit changed without
// walking the document. That only pays if it agrees with the fingerprint oracle on the
// verdict, so the first block here is agreement and the rest is classification.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  canonicalOoxmlFingerprint,
  canonicalTreeDifference,
  ooxmlTreesEqual,
} from '../package/ooxml-serialize.ts';
import { readOoxmlPackage, withPart, type OoxmlPackage } from '../package/ooxml-package.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { ORIGIN_IDS } from '../registry/frozen-ids.ts';
import { remotePackageDelta } from '../store/tree-package-remote.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;
const REMOTE = {
  origin: ORIGIN_IDS.mutationRemote,
  actorId: 'bob',
  operationId: 'bob-remote-1',
};

function documentBytes(body: string, documentAttributes = ''): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"${documentAttributes}><w:body>${body}</w:body></w:document>`
    ),
  });
}

function loadPackage(bytes: Uint8Array): OoxmlPackage {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

function mainPart(pkg: OoxmlPackage): OoxmlPart {
  const part = pkg.parts.get(pkg.mainDocumentPart);
  if (!part) throw new Error('no main part');
  return part;
}

function openStore(bytes: Uint8Array): TreePackageStore {
  const pkg = loadPackage(bytes);
  return new TreePackageStore(pkg, mainPart(pkg));
}

function paragraphIds(node: OoxmlNode): string[] {
  if (node.kind === 'textValue') return [];
  const own = node.kind === 'paragraph' ? [node.id] : [];
  return [...own, ...node.children.flatMap(paragraphIds)];
}

/** One package whose main part is `body`, laid over the parts of `base`. */
function bodyOf(base: OoxmlPackage, body: string): OoxmlPackage {
  return withPart(base, mainPart(loadPackage(documentBytes(body))));
}

const PARAGRAPH = '<w:p><w:r><w:t>alpha</w:t></w:r></w:p>';

describe('canonicalTreeDifference agrees with the fingerprint oracle', () => {
  const cases: readonly { readonly name: string; readonly left: string; readonly right: string }[] =
    [
      { name: 'identical bodies', left: PARAGRAPH, right: PARAGRAPH },
      {
        name: 'insignificant whitespace between elements',
        left: `${PARAGRAPH}<w:sectPr/>`,
        right: `\n  ${PARAGRAPH}\n  <w:sectPr/>\n`,
      },
      {
        name: 'attribute order',
        left: '<w:p><w:pPr><w:ind w:left="10" w:right="20"/></w:pPr></w:p>',
        right: '<w:p><w:pPr><w:ind w:right="20" w:left="10"/></w:pPr></w:p>',
      },
      {
        name: 'one character of run text',
        left: PARAGRAPH,
        right: '<w:p><w:r><w:t>alphb</w:t></w:r></w:p>',
      },
      {
        name: 'an added paragraph',
        left: PARAGRAPH,
        right: `${PARAGRAPH}<w:p><w:r><w:t>beta</w:t></w:r></w:p>`,
      },
      {
        name: 'a changed attribute value',
        left: '<w:p><w:pPr><w:ind w:left="10"/></w:pPr></w:p>',
        right: '<w:p><w:pPr><w:ind w:left="11"/></w:pPr></w:p>',
      },
      {
        name: 'significant leading space',
        left: '<w:p><w:r><w:t xml:space="preserve"> a</w:t></w:r></w:p>',
        right: '<w:p><w:r><w:t xml:space="preserve">a</w:t></w:r></w:p>',
      },
    ];

  for (const item of cases) {
    test(item.name, () => {
      const left = mainPart(loadPackage(documentBytes(item.left)));
      const right = mainPart(loadPackage(documentBytes(item.right)));
      const difference = canonicalTreeDifference(left, right);
      expect(difference.undecided).toBe(false);
      expect(difference.equal).toBe(ooxmlTreesEqual(left, right));
    });
  }

  test('a differing prefix set is handed back to the oracle rather than guessed at', () => {
    const left = mainPart(loadPackage(documentBytes(PARAGRAPH)));
    const right = mainPart(
      loadPackage(documentBytes(PARAGRAPH, ` xmlns:x="${R}" xmlns:y="urn:extra"`))
    );
    const difference = canonicalTreeDifference(left, right);
    expect(difference.undecided).toBe(true);
    expect(canonicalOoxmlFingerprint(left)).toBe(canonicalOoxmlFingerprint(right));
  });

  // The verdict is what decides whether a package gets installed, and an install that
  // changes nothing costs the engine every identity-keyed cache it holds. Agreement on the
  // hand-picked cases above only proves the cases somebody thought of, so this walks a few
  // hundred generated pairs — some rewritten in ways the canonical form erases, some
  // genuinely edited — and holds the two answers against each other.
  test('agrees with the oracle on generated pairs', () => {
    let seed = 0x5eed_1234;
    const next = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fff_ffff;
      return seed / 0x8000_0000;
    };
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;

    const runs = (): string => {
      const text = pick(['alpha', 'beta', '', ' ', 'a b', 'x\ty']);
      const space = next() < 0.5 ? ' xml:space="preserve"' : '';
      const inner = pick([
        `<w:t${space}>${text}</w:t>`,
        `<w:t${space}>${text}</w:t><w:tab/>`,
        `<w:br/><w:t${space}>${text}</w:t>`,
        `<w:t${space}>${text}</w:t><w:t>${text}</w:t>`,
      ]);
      const properties = next() < 0.4 ? '<w:rPr><w:b/><w:sz w:val="24"/></w:rPr>' : '';
      return `<w:r>${properties}${inner}</w:r>`;
    };
    const paragraph = (): string => {
      const properties =
        next() < 0.4
          ? '<w:pPr><w:ind w:left="360" w:right="120"/><w:jc w:val="both"/></w:pPr>'
          : '';
      const count = 1 + Math.floor(next() * 3);
      return `<w:p>${properties}${Array.from({ length: count }, runs).join('')}</w:p>`;
    };
    const body = (): string =>
      `${Array.from({ length: 1 + Math.floor(next() * 3) }, paragraph).join('')}<w:sectPr/>`;

    // Rewrites the canonical form is defined to erase. A pair built this way must read equal.
    const rewrites: readonly ((xml: string) => string)[] = [
      (xml) => xml.replace('w:left="360" w:right="120"', 'w:right="120" w:left="360"'),
      (xml) => xml.replaceAll('</w:p><w:p>', '</w:p>\n   <w:p>'),
      (xml) => xml.replace('<w:sectPr/>', '\n\t<w:sectPr/>\n'),
      (xml) => xml.replaceAll('<w:b/>', '<w:b></w:b>'),
    ];
    // Edits that change what the document says.
    const edits: readonly ((xml: string) => string)[] = [
      (xml) => xml.replace('alpha', 'alphb'),
      (xml) => xml.replace('<w:tab/>', ''),
      (xml) => xml.replace('w:val="24"', 'w:val="28"'),
      (xml) => xml.replace('<w:sectPr/>', `${PARAGRAPH}<w:sectPr/>`),
      (xml) => xml.replace('<w:t>', '<w:t xml:space="preserve"> '),
    ];

    let decided = 0;
    for (let iteration = 0; iteration < 300; iteration += 1) {
      const source = body();
      const other = pick(next() < 0.5 ? rewrites : edits)(source);
      const left = mainPart(loadPackage(documentBytes(source)));
      const right = mainPart(loadPackage(documentBytes(other)));
      const difference = canonicalTreeDifference(left, right);
      if (difference.undecided) continue;
      decided += 1;
      expect({ source, other, equal: difference.equal }).toEqual({
        source,
        other,
        equal: ooxmlTreesEqual(left, right),
      });
    }
    expect(decided).toBeGreaterThan(250);
  });

  test('two trees that share nothing exhaust the budget instead of walking the document', () => {
    const body = `${PARAGRAPH.repeat(60)}<w:sectPr/>`;
    const left = mainPart(loadPackage(documentBytes(body)));
    const right = mainPart(loadPackage(documentBytes(body)));
    const difference = canonicalTreeDifference(left, right, 32);
    expect(difference.undecided).toBe(true);
    expect(difference.visited).toBeLessThanOrEqual(33);
  });
});

describe('remotePackageDelta classifies what one received package changed', () => {
  test('a text edit is text-local and names the paragraph it touched', () => {
    const store = openStore(documentBytes(`${PARAGRAPH}<w:sectPr/>`));
    const current = store.currentPackage();
    const next = bodyOf(current, '<w:p><w:r><w:t>alphaX</w:t></w:r></w:p><w:sectPr/>');
    const delta = remotePackageDelta(next, current);
    expect(delta.equal).toBe(false);
    expect(delta.impact).toBe('text-local');
    expect(delta.dirty).toEqual([paragraphIds(mainPart(next).root)[0]!]);
  });

  test('a run added beside another run is still text-local', () => {
    const store = openStore(documentBytes(`${PARAGRAPH}<w:sectPr/>`));
    const current = store.currentPackage();
    const next = bodyOf(
      current,
      '<w:p><w:r><w:t>alpha</w:t></w:r><w:r><w:t>X</w:t></w:r></w:p><w:sectPr/>'
    );
    expect(remotePackageDelta(next, current).impact).toBe('text-local');
  });

  test('a page break added inside the paragraph is not text-local', () => {
    const store = openStore(documentBytes(`${PARAGRAPH}<w:sectPr/>`));
    const current = store.currentPackage();
    const next = bodyOf(
      current,
      '<w:p><w:r><w:t>alpha</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p><w:sectPr/>'
    );
    const delta = remotePackageDelta(next, current);
    expect(delta.equal).toBe(false);
    expect(delta.impact).toBe('flow-structural');
  });

  test('paragraph properties are not text-local', () => {
    const store = openStore(documentBytes(`${PARAGRAPH}<w:sectPr/>`));
    const current = store.currentPackage();
    const next = bodyOf(
      current,
      '<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t>alpha</w:t></w:r></w:p><w:sectPr/>'
    );
    expect(remotePackageDelta(next, current).impact).toBe('flow-structural');
  });

  test('an added paragraph is wholesale', () => {
    const store = openStore(documentBytes(`${PARAGRAPH}<w:sectPr/>`));
    const current = store.currentPackage();
    const next = bodyOf(current, `${PARAGRAPH}<w:p><w:r><w:t>beta</w:t></w:r></w:p><w:sectPr/>`);
    const delta = remotePackageDelta(next, current);
    expect(delta.equal).toBe(false);
    expect(delta.impact).toBe('global');
    expect(delta.dirty).toEqual([]);
  });

  test('a package that says the same thing is never installed', () => {
    const bytes = documentBytes(`${PARAGRAPH}<w:sectPr/>`);
    const store = openStore(bytes);
    const current = store.currentPackage();
    // A separate parse of the same bytes shares no object with the installed package, so only
    // a content comparison can tell that installing it would change nothing while busting
    // every identity-keyed cache in the engine.
    const twin = withPart(current, mainPart(loadPackage(bytes)));
    expect(mainPart(twin)).not.toBe(mainPart(current));
    expect(remotePackageDelta(twin, current).equal).toBe(true);

    let publications = 0;
    store.subscribe(() => {
      publications += 1;
    });
    expect(store.publishRemotePackage(twin, REMOTE)).toEqual({ ok: true, change: null });
    expect(store.currentPackage()).toBe(current);
    expect(publications).toBe(0);
  });

  test('equal content under a renamed id installs, also when another part changed', () => {
    const bytes = documentBytes(`${PARAGRAPH}<w:sectPr/>`);
    const store = openStore(bytes);
    const current = store.currentPackage();
    // Every part of a separate parse is a new object, so more than one part "changed".
    const twin = loadPackage(bytes);
    const main = mainPart(twin);
    const renamed = JSON.parse(JSON.stringify(main.root)) as {
      children: { children: { id: string }[] }[];
    };
    const run = renamed.children[0]!.children[0]!.children[0]!;
    run.id = `${run.id}~renamed`;
    const next = withPart(twin, { ...main, root: renamed as unknown as OoxmlNode });
    expect(remotePackageDelta(next, current).equal).toBe(false);
  });

  test('a received text edit publishes what a local one publishes', () => {
    const store = openStore(documentBytes(`${PARAGRAPH}<w:sectPr/>`));
    const next = bodyOf(
      store.currentPackage(),
      '<w:p><w:r><w:t>alphaX</w:t></w:r></w:p><w:sectPr/>'
    );
    const result = store.publishRemotePackage(next, REMOTE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.change?.impact).toBe('text-local');
    expect(result.change?.dirty).toHaveLength(1);
    expect(result.change?.created).toEqual([]);
    expect(result.change?.deleted).toEqual([]);
    expect(result.change?.splitJoin).toEqual([]);
    expect(result.change?.dependencyKeys).toHaveLength(1);
  });
});
