import { describe, expect, test } from 'bun:test';
import * as engineCore from '../index.ts';
import {
  XML_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  canonicalOoxmlFingerprint,
  ooxmlTreesEqual,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
  type OoxmlTextElementNode,
} from '../index.ts';

const invariantApi = engineCore as typeof engineCore & {
  readonly validateOoxmlPart: (part: OoxmlPart) =>
    | { readonly ok: true }
    | {
        readonly ok: false;
        readonly issues: readonly { readonly code: string; readonly nodeId?: string }[];
      };
};

const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parse(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, metadata);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function collectIds(node: OoxmlElement): string[] {
  const ids = [node.id];
  for (const child of node.children) {
    ids.push(child.id);
    if (child.kind !== 'textValue') ids.push(...collectIds(child).slice(1));
  }
  return ids;
}

describe('canonical typed OOXML tree', () => {
  test('keeps known and unknown mixed children in source order with stable identities', () => {
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:x="urn:extension">` +
        '<w:body><w:p><w:pPr/><w:r><w:rPr/><w:t>A</w:t><w:tab/><w:br/></w:r>' +
        '<x:widget x:data="007">payload</x:widget><w:r><w:t>B</w:t></w:r></w:p></w:body>' +
        '</w:document>'
    );

    expect(part.root.kind).toBe('document');
    const body = part.root.children[0] as OoxmlElement;
    const paragraph = body.children[0] as OoxmlElement;
    expect(paragraph.children.map((child) => child.kind)).toEqual([
      'paragraphProperties',
      'run',
      'generic',
      'run',
    ]);
    const firstRun = paragraph.children[1] as OoxmlElement;
    expect(firstRun.children.map((child) => child.kind)).toEqual([
      'runProperties',
      'text',
      'tab',
      'hardBreak',
    ]);

    const unknown = paragraph.children[2] as OoxmlElement;
    expect(unknown).toMatchObject({
      kind: 'generic',
      namespaceUri: 'urn:extension',
      localName: 'widget',
      prefix: 'x',
      attributes: [
        {
          namespaceUri: 'urn:extension',
          localName: 'data',
          prefix: 'x',
          value: '007',
        },
      ],
    });
    expect(new Set([part.root.id, body.id, paragraph.id, firstRun.id, unknown.id]).size).toBe(5);
    expect(Object.isFrozen(part.root)).toBe(true);
    expect(Object.isFrozen(paragraph.children)).toBe(true);
  });

  test('preserves w:br w:type="page" as a typed hardBreak with attributes', () => {
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body>` +
        '<w:p><w:r><w:t>before</w:t><w:br w:type="page"/><w:t>after</w:t></w:r></w:p>' +
        '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
        '<w:p><w:r><w:t>tail</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    );
    const body = part.root.children[0] as OoxmlElement;
    const firstParagraph = body.children[0] as OoxmlElement;
    const firstRun = firstParagraph.children.find((child) => child.kind === 'run') as OoxmlElement;
    const pageBreak = firstRun.children.find((child) => child.kind === 'hardBreak') as OoxmlElement;
    expect(pageBreak.kind).toBe('hardBreak');
    expect(pageBreak.attributes).toEqual([
      {
        kind: 'genericExtension',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'type',
        prefix: 'w',
        value: 'page',
      },
    ]);

    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('<w:br w:type="page"/>');
    const reopened = parse(saved);
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(part));
  });

  test('resolves inherited, default, and rebound namespace prefixes', () => {
    const part = parse(
      '<root xmlns="urn:outer" xmlns:a="urn:one">' +
        '<a:item/><scope xmlns="urn:inner" xmlns:a="urn:two"><item a:flag="yes"/></scope>' +
        '<a:item/></root>'
    );
    const first = part.root.children[0] as OoxmlElement;
    const scope = part.root.children[1] as OoxmlElement;
    const inner = scope.children[0] as OoxmlElement;
    const last = part.root.children[2] as OoxmlElement;

    expect([
      part.root.namespaceUri,
      first.namespaceUri,
      scope.namespaceUri,
      inner.namespaceUri,
    ]).toEqual(['urn:outer', 'urn:one', 'urn:inner', 'urn:inner']);
    expect(inner.attributes[0]).toMatchObject({
      namespaceUri: 'urn:two',
      localName: 'flag',
      value: 'yes',
    });
    expect(last.namespaceUri).toBe('urn:one');
    expect(scope.namespaceBindings).toEqual([
      { prefix: '', namespaceUri: 'urn:inner' },
      { prefix: 'a', namespaceUri: 'urn:two' },
    ]);
  });

  test('rejects undeclared prefixes and duplicate expanded-name attributes', () => {
    expect(readOoxmlPart('<p:item/>', metadata)).toMatchObject({
      ok: false,
      reason: 'undeclared-prefix',
    });
    expect(
      readOoxmlPart('<x xmlns:a="urn:same" xmlns:b="urn:same" a:id="1" b:id="2"/>', metadata)
    ).toMatchObject({ ok: false, reason: 'duplicate-expanded-attribute' });
    // Names are shared across reads; a duplicate in a later read of known names still fails.
    for (let read = 0; read < 2; read += 1) {
      expect(
        readOoxmlPart('<x xmlns:a="urn:same" xmlns:b="urn:same" a:id="1" b:id="2"/>', metadata)
      ).toMatchObject({ ok: false, reason: 'duplicate-expanded-attribute' });
    }
  });

  test('a long attribute list finds duplicates in linear time', () => {
    // File input sets the attribute count. A pairwise scan of 50,000 names took seconds.
    const names = Array.from({ length: 50_000 }, (_, index) => `a${index}="x"`).join(' ');
    const started = performance.now();
    expect(readOoxmlPart(`<x ${names}/>`, metadata).ok).toBe(true);
    // Two prefixes for one namespace: a duplicate only the expanded-name check sees.
    const duplicate = `<x xmlns:a="urn:same" xmlns:b="urn:same" ${names} a:id="1" b:id="2"/>`;
    expect(readOoxmlPart(duplicate, metadata)).toMatchObject({
      ok: false,
      reason: 'duplicate-expanded-attribute',
    });
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  test('a rejected name stays rejected on every read', () => {
    // The shared name table stores only names that passed, so a bad name is checked again.
    for (let read = 0; read < 2; read += 1) {
      expect(readOoxmlPart('<x a:b:c="1" xmlns:a="urn:a"/>', metadata)).toMatchObject({
        ok: false,
      });
    }
    const ok = readOoxmlPart('<x xmlns:a="urn:a" a:id="1"/>', metadata);
    const again = readOoxmlPart('<x xmlns:a="urn:a" a:id="2"/>', metadata);
    expect(ok.ok && again.ok).toBe(true);
    if (!ok.ok || !again.ok) return;
    expect(
      again.part.root.attributes.map((attribute) => [attribute.localName, attribute.value])
    ).toEqual([['id', '2']]);
  });

  test('inherits trust-boundary DTD, entity, size, depth, and element limits', () => {
    expect(readOoxmlPart('<!DOCTYPE x><x/>', metadata)).toMatchObject({
      ok: false,
      reason: 'dtd-forbidden',
    });
    expect(readOoxmlPart('<x>&custom;</x>', metadata)).toMatchObject({
      ok: false,
      reason: 'entity-forbidden',
    });
    expect(readOoxmlPart('<x/>', metadata, { maxBytes: 2 })).toMatchObject({
      ok: false,
      reason: 'too-large',
    });
    expect(
      readOoxmlPart('<x><a/><b/></x>', metadata, { maxBytes: 100, maxElements: 2 })
    ).toMatchObject({ ok: false, reason: 'too-many-elements' });
    expect(readOoxmlPart('<x>'.repeat(258) + '</x>'.repeat(258), metadata)).toMatchObject({
      ok: false,
      reason: 'too-deep',
    });
  });
});

describe('post-edit OOXML tree invariants', () => {
  test('accepts equivalent normalized parses with identical initial identities', () => {
    const compact = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r><w:t>A</w:t></w:r></w:p></w:body></w:document>`
    );
    const formatted = parse(
      `<x:document xmlns:x="${WML_NAMESPACE_URI}">\n<x:body><x:p>\n<x:r><x:t>A</x:t></x:r>\n</x:p></x:body>\n</x:document>`
    );

    expect(collectIds(formatted.root)).toEqual(collectIds(compact.root));
    expect(invariantApi.validateOoxmlPart(compact)).toEqual({ ok: true });
  });

  test('rejects duplicate IDs introduced by a copy-modified tree', () => {
    const part = parse('<r xmlns="urn:test"><a/><b/></r>');
    const first = part.root.children[0] as OoxmlElement;
    const second = part.root.children[1] as OoxmlElement;
    const malformed = {
      ...part,
      root: {
        ...part.root,
        children: [first, { ...second, id: first.id }],
      },
    } as OoxmlPart;

    expect(invariantApi.validateOoxmlPart(malformed)).toMatchObject({
      ok: false,
      issues: [{ code: 'duplicate-id', nodeId: first.id }],
    });
  });

  test('rejects malformed names, attributes, text, and known-node copies', () => {
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r><w:t>A</w:t></w:r></w:p></w:body></w:document>`
    );
    const body = part.root.children[0] as OoxmlElement;
    const paragraph = body.children[0] as OoxmlElement;
    const run = paragraph.children[0] as OoxmlElement;
    const text = run.children[0] as OoxmlElement;
    const malformedText = {
      ...text,
      localName: 'bad:name',
      attributes: [
        {
          kind: 'genericExtension',
          namespaceUri: '',
          localName: 'a',
          value: '1',
        },
        {
          kind: 'genericExtension',
          namespaceUri: '',
          localName: 'a',
          value: '2',
        },
      ],
      children: [{ ...text.children[0], value: '\u0000' }, { ...body }],
    };
    const malformed = {
      ...part,
      root: {
        ...part.root,
        children: [
          {
            ...body,
            children: [
              {
                ...paragraph,
                children: [{ ...run, children: [malformedText] }],
              },
            ],
          },
        ],
      },
    } as OoxmlPart;

    const result = invariantApi.validateOoxmlPart(malformed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'invalid-name',
        'duplicate-expanded-attribute',
        'invalid-xml-value',
        'known-node-invariant',
      ])
    );
  });
});

describe('reviewed namespace, identity, and typing invariants', () => {
  const MC_NAMESPACE_URI = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
  const XSI_NAMESPACE_URI = 'http://www.w3.org/2001/XMLSchema-instance';

  test('preserves QName-valued compatibility bindings through normalized save and reopen', () => {
    const source =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:mc="${MC_NAMESPACE_URI}" ` +
      'xmlns:w14="urn:word14" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'mc:Ignorable="w14" mc:ProcessContent="w14:widget" ' +
      'mc:PreserveElements="w14:keep" mc:PreserveAttributes="w14:flag">' +
      '<w:body><w:p><w14:widget xsi:type="w14:Widget"/></w:p></w:body></w:document>';
    const part = parse(source);

    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('xmlns:w14="urn:word14"');
    expect(saved).not.toMatch(/xmlns:ns\d+="urn:word14"/);
    expect(saved).toContain('mc:Ignorable="w14"');
    expect(saved).toContain('xsi:type="w14:Widget"');

    const reopened = parse(saved);
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(part));
  });

  test('canonicalizes known QName attribute values independently of prefix spelling', () => {
    const left = parse(
      `<r xmlns:mc="${MC_NAMESPACE_URI}" xmlns:xsi="${XSI_NAMESPACE_URI}" xmlns:a="urn:feature" ` +
        'mc:Ignorable="a" mc:ProcessContent="a:widget" mc:PreserveElements="a:keep" ' +
        'mc:PreserveAttributes="a:flag" xsi:type="a:Kind"/>'
    );
    const right = parse(
      `<r xmlns:q="urn:unused" xmlns:b="urn:feature" xmlns:xsi="${XSI_NAMESPACE_URI}" ` +
        `xmlns:m="${MC_NAMESPACE_URI}" xsi:type="b:Kind" m:PreserveAttributes="b:flag" ` +
        'm:PreserveElements="b:keep" m:ProcessContent="b:widget" m:Ignorable="b"/>'
    );

    expect(ooxmlTreesEqual(left, right)).toBe(true);
  });

  test('preserves nested prefix rebinding at the scope where it was authored', () => {
    const part = parse(
      '<a:root xmlns:a="urn:outer"><a:item/><scope xmlns:a="urn:inner">' +
        '<a:item xsi:type="a:Inner" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>' +
        '</scope><a:item/></a:root>'
    );

    const saved = serializeOoxmlPart(part);
    expect(saved).toMatch(/xmlns:ns\d+="urn:outer"/);
    expect(saved).toContain('<scope xmlns:a="urn:inner">');
    expect(saved).not.toContain('<a:');
    expect(saved).toMatch(/xsi:type="ns\d+:Inner"/);
    expect(ooxmlTreesEqual(part, parse(saved))).toBe(true);
  });

  test('retains mixed-content whitespace when sibling character data makes it significant', () => {
    const withSpace = parse('<r xmlns="urn:mixed">a<i/> <b/>z</r>');
    const withoutSpace = parse('<r xmlns="urn:mixed">a<i/><b/>z</r>');

    expect(ooxmlTreesEqual(withSpace, withoutSpace)).toBe(false);
    const saved = serializeOoxmlPart(withSpace);
    expect(saved).toContain('a<');
    expect(saved).toContain('/> <');
    expect(ooxmlTreesEqual(withSpace, parse(saved))).toBe(true);
  });

  test('assigns structural IDs after insignificant whitespace canonicalization', () => {
    const compact = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p>` +
        '<w:r><w:t>A</w:t></w:r><w:r><w:t>B</w:t></w:r>' +
        '</w:p></w:body></w:document>'
    );
    const alternate = parse(
      `<x:document xmlns:x="${WML_NAMESPACE_URI}">\n  <x:body>\n    <x:p>\n` +
        '      <x:r><x:t>A</x:t></x:r>\n      <x:r><x:t>B</x:t></x:r>\n' +
        '    </x:p>\n  </x:body>\n</x:document>'
    );

    expect(collectIds(alternate.root)).toEqual(collectIds(compact.root));
    expect(collectIds(parse(serializeOoxmlPart(alternate)).root)).toEqual(collectIds(compact.root));
  });

  test('classifies known names with invalid first-slice children as generic', () => {
    const invalidTab = parse(`<w:tab xmlns:w="${WML_NAMESPACE_URI}"><w:t>x</w:t></w:tab>`);
    const invalidText = parse(`<w:t xmlns:w="${WML_NAMESPACE_URI}"><w:br/></w:t>`);
    const invalidDocument = parse(`<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:p/></w:document>`);

    expect(invalidTab.root.kind).toBe('generic');
    expect(invalidText.root.kind).toBe('generic');
    expect(invalidDocument.root.kind).toBe('generic');
  });
});

describe('round-two canonical namespace and typing behavior', () => {
  const MC_NAMESPACE_URI = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

  test('uses one stable binding per URI, preferring authored prefixes', () => {
    const part = parse(
      `<a:document xmlns:a="${WML_NAMESPACE_URI}" xmlns:e="urn:extension">` +
        '<a:body><a:p e:flag="yes"><e:item/></a:p></a:body></a:document>'
    );

    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('<w:document');
    expect(saved).toContain('<e:item');
    expect(saved).toContain('e:flag="yes"');
    expect(saved).toContain(`xmlns:w="${WML_NAMESPACE_URI}"`);
    expect(saved).toContain('xmlns:e="urn:extension"');
    expect(saved).not.toContain(`xmlns:a="${WML_NAMESPACE_URI}"`);
    expect(saved).not.toContain('<a:document');
    expect(saved).not.toMatch(/xmlns:ns\d+="urn:extension"/);
  });

  test('rewrites known QName values to the single controlled prefix per URI', () => {
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${MC_NAMESPACE_URI}" ` +
        'xmlns:x="urn:feature" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" ' +
        'm:Ignorable="x"><w:body><w:p><x:item i:type="x:Kind"/></w:p></w:body></w:document>'
    );

    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('mc:Ignorable="x"');
    expect(saved).toContain('xsi:type="x:Kind"');
    expect(saved).toContain('xmlns:x="urn:feature"');
    expect(saved).toContain(`xmlns:mc="${MC_NAMESPACE_URI}"`);
    expect(saved).not.toContain(`xmlns:m="${MC_NAMESPACE_URI}"`);
    expect(saved).not.toMatch(/xmlns:ns\d+="urn:feature"/);
    expect(ooxmlTreesEqual(part, parse(saved))).toBe(true);
  });

  test('canonicalizes mc Choice Requires prefix lists', () => {
    const left = parse(
      `<mc:Choice xmlns:mc="${MC_NAMESPACE_URI}" xmlns:a="urn:feature" Requires="a"/>`
    );
    const right = parse(
      `<m:Choice xmlns:m="${MC_NAMESPACE_URI}" xmlns:b="urn:feature" Requires="b"/>`
    );

    expect(ooxmlTreesEqual(left, right)).toBe(true);
    const saved = serializeOoxmlPart(left);
    expect(saved).toContain('<mc:Choice');
    expect(saved).toContain('Requires="a"');
    expect(saved).toContain('xmlns:a="urn:feature"');
    expect(saved).not.toMatch(/xmlns:ns\d+="urn:feature"/);
  });

  test('canonicalizes mc MustUnderstand prefix lists', () => {
    const left = parse(
      `<r xmlns:mc="${MC_NAMESPACE_URI}" xmlns:a="urn:feature" mc:MustUnderstand="a"/>`
    );
    const right = parse(
      `<r xmlns:m="${MC_NAMESPACE_URI}" xmlns:b="urn:feature" m:MustUnderstand="b"/>`
    );

    expect(ooxmlTreesEqual(left, right)).toBe(true);
    const saved = serializeOoxmlPart(left);
    expect(saved).toContain('mc:MustUnderstand="a"');
    expect(saved).toContain('xmlns:a="urn:feature"');
    expect(saved).not.toMatch(/xmlns:ns\d+="urn:feature"/);
    expect(
      readOoxmlPart(`<r xmlns:mc="${MC_NAMESPACE_URI}" mc:MustUnderstand="missing"/>`, metadata)
    ).toMatchObject({ ok: false, reason: 'undeclared-prefix' });
  });

  test('deduplicates supported MC prefix lists as namespace sets', () => {
    for (const localName of ['Ignorable', 'MustUnderstand']) {
      const single = parse(
        `<r xmlns:mc="${MC_NAMESPACE_URI}" xmlns:a="urn:feature" mc:${localName}="a"/>`
      );
      const duplicated = parse(
        `<r xmlns:mc="${MC_NAMESPACE_URI}" xmlns:a="urn:feature" mc:${localName}="a a"/>`
      );
      expect(canonicalOoxmlFingerprint(duplicated)).toBe(canonicalOoxmlFingerprint(single));
      expect(serializeOoxmlPart(duplicated)).toBe(serializeOoxmlPart(single));
    }

    const choice = parse(
      `<mc:Choice xmlns:mc="${MC_NAMESPACE_URI}" xmlns:a="urn:feature" Requires="a"/>`
    );
    const duplicateChoice = parse(
      `<mc:Choice xmlns:mc="${MC_NAMESPACE_URI}" xmlns:a="urn:feature" Requires="a a"/>`
    );
    expect(canonicalOoxmlFingerprint(duplicateChoice)).toBe(canonicalOoxmlFingerprint(choice));
    expect(serializeOoxmlPart(duplicateChoice)).toBe(serializeOoxmlPart(choice));
  });

  test('keeps nested authored aliases while controlled names survive rebinding', () => {
    const part = parse(
      '<a:root xmlns:a="urn:outer"><a:item/><scope xmlns:a="urn:inner">' +
        '<a:item xsi:type="a:Inner" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>' +
        '</scope><a:item/></a:root>'
    );

    const saved = serializeOoxmlPart(part);
    expect(saved).toMatch(/xmlns:ns\d+="urn:outer"/);
    expect(saved).toContain('<scope xmlns:a="urn:inner"');
    expect(saved).not.toContain('<a:');
    expect(saved).toMatch(/xsi:type="ns\d+:Inner"/);
    expect(ooxmlTreesEqual(part, parse(saved))).toBe(true);
  });

  test('rejects undeclared tokens in all explicitly known QName attributes', () => {
    expect(
      readOoxmlPart(`<mc:Choice xmlns:mc="${MC_NAMESPACE_URI}" Requires="missing"/>`, metadata)
    ).toMatchObject({ ok: false, reason: 'undeclared-prefix' });
    expect(
      readOoxmlPart(
        `<r xmlns:mc="${MC_NAMESPACE_URI}" mc:ProcessContent="missing:item"/>`,
        metadata
      )
    ).toMatchObject({ ok: false, reason: 'undeclared-prefix' });
  });

  test('merges adjacent text and CDATA before assigning structural IDs', () => {
    const split = parse('<r xmlns="urn:text">a<![CDATA[b]]>c</r>');
    const merged = parse('<r xmlns="urn:text">abc</r>');

    expect(split.root.children).toHaveLength(1);
    expect(split.root.children[0]).toMatchObject({ kind: 'textValue', value: 'abc' });
    expect(canonicalOoxmlFingerprint(split)).toBe(canonicalOoxmlFingerprint(merged));
    expect(collectIds(split.root)).toEqual(collectIds(merged.root));
    expect(collectIds(parse(serializeOoxmlPart(split)).root)).toEqual(collectIds(split.root));
  });

  test('keeps entity spelling inside CDATA literal through save and reopen', () => {
    const part = parse('<r xmlns="urn:text">a<![CDATA[&#0;]]>b</r>');

    expect(part.root.children).toHaveLength(1);
    expect(part.root.children[0]).toMatchObject({
      kind: 'textValue',
      value: 'a&#0;b',
    });
    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('a&amp;#0;b');
    const reopened = parse(saved);
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(part));
    expect(collectIds(reopened.root)).toEqual(collectIds(part.root));
  });

  test('keeps legal paragraph-mark run properties typed', () => {
    const part = parse(
      `<w:pPr xmlns:w="${WML_NAMESPACE_URI}"><w:rPr><w:b w:val="true"/></w:rPr></w:pPr>`
    );

    expect(part.root.kind).toBe('paragraphProperties');
    expect((part.root.children[0] as OoxmlElement).kind).toBe('runProperties');
  });

  test('discriminates modeled and extension attributes without widening known text nodes', () => {
    const part = parse(
      `<w:t xmlns:w="${WML_NAMESPACE_URI}" xmlns:x="urn:extension" ` +
        'xml:space="preserve" x:flag="yes"> text </w:t>'
    );
    const text = part.root as OoxmlTextElementNode;
    expect(text.kind).toBe('text');
    expect(text.attributes.map((attribute) => attribute.kind)).toEqual([
      'xmlSpace',
      'genericExtension',
    ]);

    const property = parse(`<w:b xmlns:w="${WML_NAMESPACE_URI}" w:val="true"/>`);
    expect(property.root.attributes[0]).toMatchObject({
      kind: 'wmlVal',
      value: 'true',
    });
    expect(
      readOoxmlPart(`<w:t xmlns:w="${WML_NAMESPACE_URI}" xml:space="sometimes">x</w:t>`, metadata)
    ).toMatchObject({ ok: true });
    const invalid = parse(`<w:t xmlns:w="${WML_NAMESPACE_URI}" xml:space="sometimes">x</w:t>`);
    expect(invalid.root.kind).toBe('generic');
  });
});

describe('normalized OOXML serialization and canonical oracle', () => {
  test('normalizes attribute order while preserving safe authored namespace bindings', () => {
    const left = parse(
      `<a:document xmlns:a="${WML_NAMESPACE_URI}" xmlns:e="urn:extension">` +
        '<a:body><a:p e:z="2" plain="&quot;&lt;&amp;" e:a="1"><e:item>safe &amp; sound</e:item></a:p></a:body>' +
        '</a:document>'
    );
    const right = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:q="urn:extension"><w:body>` +
        "<w:p q:a='1' plain='&quot;&lt;&amp;' q:z='2'>\n<q:item>safe &amp; sound</q:item>\n</w:p>" +
        '</w:body></w:document>'
    );

    expect(canonicalOoxmlFingerprint(left)).toBe(canonicalOoxmlFingerprint(right));
    expect(ooxmlTreesEqual(left, right)).toBe(true);
    expect(serializeOoxmlPart(left)).toContain('plain="&quot;&lt;&amp;" e:a="1" e:z="2"');
    expect(serializeOoxmlPart(left)).toContain('safe &amp; sound');
    expect(serializeOoxmlPart(left)).toContain(`xmlns:w="${WML_NAMESPACE_URI}"`);
    expect(serializeOoxmlPart(left)).toContain('xmlns:e="urn:extension"');
    expect(serializeOoxmlPart(left)).not.toContain(`xmlns:a="${WML_NAMESPACE_URI}"`);
    expect(serializeOoxmlPart(right)).toContain('xmlns:q="urn:extension"');
    expect(serializeOoxmlPart(right)).not.toMatch(/xmlns:ns\d+="urn:extension"/);
  });

  test('preserves significant text including xml:space whitespace', () => {
    const preserved = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r>` +
        `<w:t xml:space="preserve">  </w:t><w:t>word</w:t>` +
        '</w:r></w:p></w:body></w:document>'
    );
    const changed = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r>` +
        `<w:t xml:space="preserve"> </w:t><w:t>word</w:t>` +
        '</w:r></w:p></w:body></w:document>'
    );

    const run = ((preserved.root.children[0] as OoxmlElement).children[0] as OoxmlElement)
      .children[0] as OoxmlElement;
    const text = run.children[0] as OoxmlElement;
    expect(text.attributes[0]).toMatchObject({
      namespaceUri: XML_NAMESPACE_URI,
      localName: 'space',
      value: 'preserve',
    });
    expect((text.children[0] as { value: string }).value).toBe('  ');
    expect(ooxmlTreesEqual(preserved, changed)).toBe(false);
  });

  test('ignores insignificant inter-element whitespace and lexical empty-element spelling', () => {
    const compact = parse('<r xmlns="urn:test"><a/><b></b></r>');
    const spaced = parse("<x:r xmlns:x='urn:test'>\n  <x:a></x:a>\n  <x:b/>\n</x:r>");

    expect(ooxmlTreesEqual(compact, spaced)).toBe(true);
  });

  test('detects significant child order and text changes', () => {
    expect(
      ooxmlTreesEqual(
        parse('<r xmlns="urn:test"><a/><b/></r>'),
        parse('<r xmlns="urn:test"><b/><a/></r>')
      )
    ).toBe(false);
    expect(
      ooxmlTreesEqual(
        parse('<r xmlns="urn:test">alpha<a/></r>'),
        parse('<r xmlns="urn:test">beta<a/></r>')
      )
    ).toBe(false);
  });

  test('rejects malicious names, duplicate attributes, and invalid XML 1.0 values on save', () => {
    const part = parse('<r xmlns="urn:test" safe="yes"/>');
    const badName = {
      ...part,
      root: { ...part.root, localName: 'r><injected' },
    } as OoxmlPart;
    const duplicateAttribute = {
      ...part,
      root: {
        ...part.root,
        attributes: [...part.root.attributes, ...part.root.attributes],
      },
    } as OoxmlPart;
    const invalidValue = {
      ...part,
      root: {
        ...part.root,
        attributes: [{ ...part.root.attributes[0], value: 'bad\u0000value' }],
      },
    } as OoxmlPart;

    expect(() => serializeOoxmlPart(badName)).toThrow('invalid local name');
    expect(() => serializeOoxmlPart(duplicateAttribute)).toThrow('duplicate expanded attribute');
    expect(() => serializeOoxmlPart(invalidValue)).toThrow('XML 1.0');
  });

  test('root-default URI referenced by MC/XSI values keeps a non-empty controlled alias', () => {
    const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
    const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
    const part = parse(
      `<r xmlns="urn:feature" xmlns:f="urn:feature" xmlns:mc="${MC}" xmlns:xsi="${XSI}" ` +
        'mc:Ignorable="f" mc:MustUnderstand="f" mc:ProcessContent="f:widget" ' +
        'mc:PreserveElements="f:keep" mc:PreserveAttributes="f:flag" xsi:type="f:Kind"/>'
    );
    const saved = serializeOoxmlPart(part);
    expect(saved.startsWith('<r xmlns="urn:feature"')).toBe(true);
    expect(saved).not.toMatch(/<ns\d+:r\b/);
    expect(saved).toMatch(/mc:Ignorable="f"/);
    expect(saved).not.toContain('mc:Ignorable=""');
    expect(saved).toContain('mc:ProcessContent="f:widget"');
    expect(saved).toContain('xsi:type="f:Kind"');
    expect(ooxmlTreesEqual(part, parse(saved))).toBe(true);
  });

  test('injects xml:space preserve for boundary whitespace on w:t', () => {
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r>` +
        '<w:t xml:space="preserve"> leading</w:t><w:t xml:space="preserve">trailing </w:t>' +
        '<w:t xml:space="preserve">\tnewline\n</w:t>' +
        '</w:r></w:p></w:body></w:document>'
    );
    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('<w:t xml:space="preserve"> leading</w:t>');
    expect(saved).toContain('<w:t xml:space="preserve">trailing </w:t>');
    // A line break in text reads as a space.
    expect(saved).toContain('<w:t xml:space="preserve">\tnewline </w:t>');
    const reopened = parse(saved);
    expect(ooxmlTreesEqual(part, reopened)).toBe(true);
  });

  test('omits redundant xml:space preserve when boundary whitespace is gone', () => {
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r>` +
        '<w:t xml:space="preserve">word</w:t>' +
        '</w:r></w:p></w:body></w:document>'
    );
    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('<w:t>word</w:t>');
    expect(saved).not.toContain('xml:space');
    const redundant = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r>` +
        '<w:t xml:space="preserve">word</w:t>' +
        '</w:r></w:p></w:body></w:document>'
    );
    expect(canonicalOoxmlFingerprint(part)).toBe(canonicalOoxmlFingerprint(redundant));
  });

  test('keeps generic authored attributes while normalizing xml:space on w:t', () => {
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:x="urn:extension"><w:body><w:p><w:r>` +
        '<w:t xml:space="preserve" x:flag="yes"> edge </w:t>' +
        '</w:r></w:p></w:body></w:document>'
    );
    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('x:flag="yes"');
    expect(saved).toContain('<w:t xml:space="preserve" x:flag="yes"> edge </w:t>');
    expect(ooxmlTreesEqual(part, parse(saved))).toBe(true);
  });

  test('escapes hostile text and still marks boundary whitespace for preserve', () => {
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r>` +
        '<w:t xml:space="preserve"> &lt;script&gt;</w:t>' +
        '</w:r></w:p></w:body></w:document>'
    );
    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('<w:t xml:space="preserve"> &lt;script&gt;</w:t>');
    expect(saved).not.toContain('<script>');
    const reopened = parse(saved);
    const body = reopened.root.children[0] as OoxmlElement;
    const paragraph = body.children[0] as OoxmlElement;
    const run = paragraph.children[0] as OoxmlElement;
    const text = run.children[0] as OoxmlElement;
    expect((text.children[0] as { value: string }).value).toBe(' <script>');
  });

  test('whitespace-only w:t nodes always serialize with xml:space preserve', () => {
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r>` +
        '<w:t xml:space="preserve">  </w:t><w:t xml:space="preserve">\t</w:t>' +
        '</w:r></w:p></w:body></w:document>'
    );
    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('<w:t xml:space="preserve">  </w:t>');
    expect(saved).toContain('<w:t xml:space="preserve">\t</w:t>');
    expect(ooxmlTreesEqual(part, parse(saved))).toBe(true);
  });
});

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

function inlinePictureDrawing(
  options: {
    readonly extent?: string;
    readonly extraInlineChild?: string;
    readonly extraDrawingChild?: string;
    readonly graphicDataUri?: string;
    readonly embed?: string;
  } = {}
): string {
  const extent = options.extent ?? 'cx="152400" cy="152400"';
  const embed = options.embed ?? 'rId14';
  const graphicDataUri = options.graphicDataUri ?? PIC_URI;
  const extra = options.extraInlineChild ?? '';
  const extraDrawing = options.extraDrawingChild ?? '';
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p><w:r><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent ${extent}/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:docPr id="1" name="green" descr="Green square" title="Green"/>' +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${graphicDataUri}">` +
    '<pic:pic>' +
    '<pic:nvPicPr><pic:cNvPr id="0" name="" descr=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill><a:blip r:embed="${embed}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="152400" cy="152400"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic>' +
    extra +
    '</wp:inline>' +
    extraDrawing +
    '</w:drawing></w:r></w:p></w:body></w:document>'
  );
}

function findFirst(node: OoxmlElement, kind: string): OoxmlElement {
  const stack: OoxmlElement[] = [node];
  while (stack.length > 0) {
    const current = stack.shift()!;
    if (current.kind === kind) return current;
    for (const child of current.children) {
      if (child.kind !== 'textValue') stack.push(child);
    }
  }
  throw new Error(`missing ${kind}`);
}

function findByLocalName(node: OoxmlElement, localName: string): OoxmlElement {
  const stack: OoxmlElement[] = [node];
  while (stack.length > 0) {
    const current = stack.shift()!;
    if (current.localName === localName) return current;
    for (const child of current.children) {
      if (child.kind !== 'textValue') stack.push(child);
    }
  }
  throw new Error(`missing ${localName}`);
}

describe('types legal drawing vocabulary', () => {
  test('types drawing → inlineDrawing → picture, preserves unknowns, and round-trips', () => {
    const xml = inlinePictureDrawing({
      extraInlineChild: '<x:ext xmlns:x="urn:task2:extension" x:flag="1">keep</x:ext>',
    });
    const part = parse(xml);
    const drawing = findFirst(part.root, 'drawing');
    expect(drawing.kind).toBe('drawing');
    expect(drawing.children).toHaveLength(1);
    const inline = drawing.children[0] as OoxmlElement;
    expect(inline.kind).toBe('inlineDrawing');
    expect(inline.localName).toBe('inline');
    expect(inline.namespaceUri).toBe(WP);
    expect(findFirst(inline, 'drawingExtent').kind).toBe('drawingExtent');
    expect(findFirst(inline, 'drawingDocPr').kind).toBe('drawingDocPr');
    expect(findFirst(inline, 'drawingGraphic').kind).toBe('drawingGraphic');
    const picture = findFirst(part.root, 'picture');
    expect(picture.localName).toBe('pic');
    expect(picture.namespaceUri).toBe(PIC);
    expect(findFirst(picture, 'pictureBlip').kind).toBe('pictureBlip');
    expect(findFirst(picture, 'pictureSrcRect').kind).toBe('pictureSrcRect');
    expect(findFirst(picture, 'pictureTransform').kind).toBe('pictureTransform');
    expect(findFirst(picture, 'pictureTransformOffset').kind).toBe('pictureTransformOffset');
    expect(findFirst(picture, 'pictureTransformExtent').kind).toBe('pictureTransformExtent');
    expect(findFirst(picture, 'picturePresetGeometry').kind).toBe('picturePresetGeometry');
    const extension = inline.children.find(
      (child) => child.kind === 'generic' && child.localName === 'ext'
    ) as OoxmlElement;
    expect(extension.attributes[0]).toMatchObject({
      localName: 'flag',
      value: '1',
    });
    const saved = serializeOoxmlPart(part);
    const reopened = parse(saved);
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(part));
    expect(saved).toContain('<a:srcRect/>');
  });

  test('demotes malformed known drawing structures to generic without rejecting the part', () => {
    const topLevel = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}"><w:body>` +
        `<w:drawing><wp:inline><wp:extent cx="1" cy="1"/></wp:inline></w:drawing>` +
        '</w:body></w:document>'
    );
    expect(findByLocalName(topLevel.root, 'drawing').kind).toBe('generic');

    const inlineOutside = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}"><w:body><w:p>` +
        `<wp:inline><wp:extent cx="1" cy="1"/></wp:inline>` +
        '</w:p></w:body></w:document>'
    );
    const inlineParagraph = (inlineOutside.root.children[0] as OoxmlElement)
      .children[0] as OoxmlElement;
    expect(inlineParagraph.kind).toBe('paragraph');
    expect(inlineParagraph.children[0]?.kind).toBe('generic');
    expect(inlineParagraph.children[0]?.localName).toBe('inline');

    const picOutside = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:body><w:p><w:r>` +
        `<pic:pic><pic:nvPicPr/></pic:pic>` +
        '</w:r></w:p></w:body></w:document>'
    );
    expect(findByLocalName(picOutside.root, 'pic').kind).toBe('generic');

    const badExtent = parse(inlinePictureDrawing({ extent: 'cx="wide" cy="152400"' }));
    expect(findByLocalName(badExtent.root, 'drawing').kind).toBe('generic');

    const missingCNvPr = parse(
      inlinePictureDrawing().replace(
        '<pic:nvPicPr><pic:cNvPr id="0" name="" descr=""/><pic:cNvPicPr/></pic:nvPicPr>',
        '<pic:nvPicPr><pic:cNvPicPr/></pic:nvPicPr>'
      )
    );
    expect(findByLocalName(missingCNvPr.root, 'pic').kind).toBe('generic');

    const twoInline = parse(
      inlinePictureDrawing({
        extraDrawingChild: `<wp:inline><wp:extent cx="1" cy="1"/></wp:inline>`,
      })
    );
    expect(findByLocalName(twoInline.root, 'drawing').kind).toBe('generic');

    const chartPayload = parse(
      inlinePictureDrawing({
        graphicDataUri: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
      })
    );
    const inline = findFirst(chartPayload.root, 'inlineDrawing');
    expect(inline.kind).toBe('inlineDrawing');
    expect(() => findFirst(chartPayload.root, 'picture')).toThrow();
    const graphicData = findByLocalName(inline, 'graphicData');
    expect(findByLocalName(graphicData, 'pic').kind).toBe('generic');
  });

  test('keeps w:object and w:altChunk generic, inert, and fingerprinted', () => {
    const objectXml =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="${R}">` +
      '<w:body><w:p><w:r>' +
      '<w:object o:progId="Word.Document.8" r:id="rId5"><o:OLEObject Type="Embed" ProgID="Word.Document.8"/></w:object>' +
      '</w:r></w:p></w:body></w:document>';
    const altChunkXml =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:r="${R}"><w:body>` +
      '<w:altChunk r:id="rId9"/>' +
      '</w:body></w:document>';
    const objectPart = parse(objectXml);
    const altChunkPart = parse(altChunkXml);
    expect(findByLocalName(objectPart.root, 'object').kind).toBe('generic');
    const altChunkBody = altChunkPart.root.children[0] as OoxmlElement;
    expect(altChunkBody.kind).toBe('body');
    expect(findByLocalName(altChunkBody, 'altChunk').kind).toBe('generic');
    expect(canonicalOoxmlFingerprint(objectPart.root)).toContain('object');
    expect(canonicalOoxmlFingerprint(altChunkPart.root)).toContain('altChunk');
    expect(JSON.stringify(objectPart)).toContain('rId5');
    expect(JSON.stringify(altChunkPart)).toContain('rId9');
  });
});

describe('drawing semantic digest', () => {
  test('reports drawing-path differences when embed, docPr, or graphic payload children are lost', () => {
    const { diffSemanticDigests, semanticDigest } = engineCore as typeof engineCore & {
      readonly diffSemanticDigests: typeof import('../package/ooxml-digest.ts').diffSemanticDigests;
      readonly semanticDigest: typeof import('../package/ooxml-digest.ts').semanticDigest;
    };
    const before = parse(inlinePictureDrawing());
    const saved = serializeOoxmlPart(before);
    const withoutEmbed = parse(saved.replace(/ r:embed="rId14"/, ''));
    const withoutDocPr = parse(saved.replace(/<wp:docPr[^>]*\/>/, ''));
    const withoutPicture = parse(saved.replace(/<pic:pic>[\s\S]*?<\/pic:pic>/, ''));

    const embedDiff = diffSemanticDigests(semanticDigest([before]), semanticDigest([withoutEmbed]));
    expect(embedDiff.some((entry) => entry.path.includes('genericStructure'))).toBe(true);

    const docPrDiff = diffSemanticDigests(semanticDigest([before]), semanticDigest([withoutDocPr]));
    expect(docPrDiff.some((entry) => entry.path.includes('genericStructure'))).toBe(true);

    const payloadDiff = diffSemanticDigests(
      semanticDigest([before]),
      semanticDigest([withoutPicture])
    );
    expect(payloadDiff.some((entry) => entry.path.includes('genericStructure'))).toBe(true);
  });
});

function countKind(root: OoxmlElement, kind: string): number {
  let count = 0;
  const stack: OoxmlElement[] = [root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.kind === kind) count += 1;
    for (const child of node.children) {
      if (child.kind !== 'textValue') stack.push(child);
    }
  }
  return count;
}

describe('typed drawing fix round 1', () => {
  test('demotes w:drawing when immediate parent is not w:r', () => {
    const wrapped = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}"><w:body><w:p><w:r>` +
        '<w:ins><w:drawing><wp:inline><wp:extent cx="1" cy="1"/>' +
        `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC_URI}"><pic:pic xmlns:pic="${PIC}"/></a:graphicData></a:graphic>` +
        '</wp:inline></w:drawing></w:ins></w:r></w:p></w:body></w:document>'
    );
    expect(findByLocalName(wrapped.root, 'drawing').kind).toBe('generic');

    const genericWrapper = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:x="urn:wrap"><w:body><w:p><w:r>` +
        '<x:holder><w:drawing><wp:inline><wp:extent cx="1" cy="1"/></wp:inline></w:drawing></x:holder>' +
        '</w:r></w:p></w:body></w:document>'
    );
    expect(findByLocalName(genericWrapper.root, 'drawing').kind).toBe('generic');
  });

  test('rejects foreign-namespace lookalike uri and extent attributes', () => {
    const foreignUri = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:evil="urn:evil"><w:body><w:p><w:r><w:drawing>` +
        `<wp:inline><wp:extent cx="1" cy="1"/>` +
        `<a:graphic><a:graphicData evil:uri="${PIC_URI}"><pic:pic/></a:graphicData></a:graphic>` +
        '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
    );
    expect(findByLocalName(foreignUri.root, 'drawing').kind).toBe('drawing');
    expect(findByLocalName(foreignUri.root, 'graphicData').kind).toBe('generic');
    expect(findByLocalName(foreignUri.root, 'pic').kind).toBe('generic');

    const foreignExtent = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:evil="urn:evil"><w:body><w:p><w:r><w:drawing>` +
        `<wp:inline><wp:extent evil:cx="1" cy="1"/><a:graphic xmlns:a="${A}"/></wp:inline>` +
        '</w:drawing></w:r></w:p></w:body></w:document>'
    );
    expect(findByLocalName(foreignExtent.root, 'drawing').kind).toBe('generic');
  });

  test('types anchored wrap and position descendants', () => {
    const anchored = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
        `<wp:anchor distT="0" distB="0" distL="114300" distR="0" simplePos="0" allowOverlap="1" behindDoc="0" locked="0" layoutInCell="1" relativeHeight="952500">` +
        `<wp:simplePos x="0" y="0"/>` +
        `<wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>` +
        `<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
        `<wp:extent cx="952500" cy="952500"/>` +
        `<wp:wrapSquare wrapText="bothSides" distL="114300"/>` +
        `<wp:docPr id="7" name="float" descr="Floating image"/>` +
        `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic>` +
        `<pic:blipFill><a:blip r:embed="rId15"/><a:srcRect/></pic:blipFill>` +
        `<pic:spPr><a:xfrm rot="0" flipH="0" flipV="0"><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>` +
        `</pic:pic></a:graphicData></a:graphic>` +
        '</wp:anchor></w:drawing></w:r></w:p></w:body></w:document>'
    );
    const anchor = findFirst(anchored.root, 'anchoredDrawing');
    expect(findFirst(anchor, 'drawingPositionH').kind).toBe('drawingPositionH');
    expect(findFirst(anchor, 'drawingPositionAlign').kind).toBe('drawingPositionAlign');
    expect(findFirst(anchor, 'drawingPositionV').kind).toBe('drawingPositionV');
    expect(findFirst(anchor, 'drawingPositionOffset').kind).toBe('drawingPositionOffset');
    expect(findFirst(anchor, 'drawingWrapSquare').kind).toBe('drawingWrapSquare');
    expect(
      findFirst(anchor, 'drawingWrapSquare').attributes.some((a) => a.localName === 'wrapText')
    ).toBe(true);
    expect(invariantApi.validateOoxmlPart(anchored).ok).toBe(true);
  });

  test('validateOoxmlPart rejects malformed typed drawing cardinality', () => {
    const part = parse(inlinePictureDrawing());
    const inline = findFirst(part.root, 'inlineDrawing');
    const broken = {
      ...part,
      root: {
        ...part.root,
        children: part.root.children.map((body) =>
          body.kind !== 'body'
            ? body
            : {
                ...body,
                children: body.children.map((paragraph) =>
                  paragraph.kind !== 'paragraph'
                    ? paragraph
                    : {
                        ...paragraph,
                        children: paragraph.children.map((run) =>
                          run.kind !== 'run'
                            ? run
                            : {
                                ...run,
                                children: run.children.map((drawing) =>
                                  drawing.kind !== 'drawing'
                                    ? drawing
                                    : {
                                        ...drawing,
                                        children: [
                                          {
                                            ...inline,
                                            children: inline.children.filter(
                                              (child) => child.kind !== 'drawingExtent'
                                            ),
                                          },
                                        ],
                                      }
                                ),
                              }
                        ),
                      }
                ),
              }
        ),
      },
    } as OoxmlPart;
    expect(invariantApi.validateOoxmlPart(broken).ok).toBe(false);
  });

  test('drawing semantic digest traversal stays bounded at MAX_XML_DEPTH', async () => {
    const { MAX_XML_DEPTH } = await import('../package/xml-reader.ts');
    const { semanticDigest } = await import('../package/ooxml-digest.ts');

    const shallow = semanticDigest([parse(inlinePictureDrawing())]);
    expect(shallow.stories[0]?.paragraphs[0]?.genericStructure.length).toBeGreaterThan(0);

    function deepDrawingGraphic(depth: number): OoxmlElement {
      if (depth >= MAX_XML_DEPTH + 2) {
        return {
          id: `leaf-${depth}`,
          kind: 'drawingGraphicData',
          namespaceUri: A,
          localName: 'graphicData',
          namespaceBindings: [],
          attributes: [{ kind: 'generic', namespaceUri: '', localName: 'uri', value: PIC_URI }],
          children: [],
        };
      }
      return {
        id: `graphic-${depth}`,
        kind: 'drawingGraphic',
        namespaceUri: A,
        localName: 'graphic',
        namespaceBindings: [],
        attributes: [],
        children: [deepDrawingGraphic(depth + 1)],
      };
    }

    const part = parse(inlinePictureDrawing());
    const drawing = findFirst(part.root, 'drawing');
    const inline = findFirst(part.root, 'inlineDrawing');
    const deepInline = {
      ...inline,
      children: inline.children.map((child) =>
        child.kind === 'drawingGraphic' ? deepDrawingGraphic(0) : child
      ),
    };
    const deepDrawing = { ...drawing, children: [deepInline] };
    const body = part.root.children[0] as OoxmlElement;
    const paragraph = body.children[0] as OoxmlElement;
    const run = paragraph.children[0] as OoxmlElement;
    const deepPart = {
      ...part,
      root: {
        ...part.root,
        children: [
          {
            ...body,
            children: [
              {
                ...paragraph,
                children: [{ ...run, children: [deepDrawing] }],
              },
            ],
          },
        ],
      },
    } as OoxmlPart;

    const deepDigest = semanticDigest([deepPart]);
    const token = deepDigest.stories[0]?.paragraphs[0]?.genericStructure[0] ?? '';
    expect(token.length).toBeGreaterThan(0);
    expect(token.length).toBeLessThan(20_000);
    expect(token).toContain('{http://schemas.openxmlformats.org/drawingml/2006/main}graphic');
  });
});

function anchoredWrapDrawing(wrapXml: string): string {
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" allowOverlap="1" behindDoc="0" locked="0" layoutInCell="1" relativeHeight="0">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="margin"><wp:align>left</wp:align></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="952500" cy="952500"/>` +
    wrapXml +
    `<wp:docPr id="1" name="n" descr="d"/>` +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

function polygonXml(): string {
  return (
    '<wp:wrapPolygon edited="0">' +
    '<wp:start x="0" y="0"/><wp:lineTo x="100" y="0"/><wp:lineTo x="100" y="100"/>' +
    '</wp:wrapPolygon>'
  );
}

describe('typed drawing fix round 2', () => {
  test('types wrap polygon points and transform off/ext descendants', () => {
    const part = parse(
      anchoredWrapDrawing(`<wp:wrapTight wrapText="bothSides">${polygonXml()}</wp:wrapTight>`)
    );
    const polygon = findFirst(part.root, 'drawingWrapPolygon');
    expect(findFirst(polygon, 'drawingWrapPolygonStart').kind).toBe('drawingWrapPolygonStart');
    expect(findFirst(polygon, 'drawingWrapPolygonLineTo').kind).toBe('drawingWrapPolygonLineTo');
    const xfrm = findFirst(part.root, 'pictureTransform');
    expect(findFirst(xfrm, 'pictureTransformOffset').localName).toBe('off');
    expect(findFirst(xfrm, 'pictureTransformExtent').localName).toBe('ext');
  });

  test('demotes typed descendants when malformed parent becomes generic', () => {
    const badInline = parse(inlinePictureDrawing({ extent: 'cx="not-a-number" cy="1"' }));
    expect(findByLocalName(badInline.root, 'drawing').kind).toBe('generic');
    expect(countKind(badInline.root, 'drawingExtent')).toBe(0);
    expect(countKind(badInline.root, 'inlineDrawing')).toBe(0);
    expect(countKind(badInline.root, 'picture')).toBe(0);
    const inlineEl = findByLocalName(badInline.root, 'inline');
    expect(inlineEl.kind).toBe('generic');
    expect(findByLocalName(inlineEl, 'extent').kind).toBe('generic');
  });

  test('rejects owner-namespace and unqualified relationship lookalikes', () => {
    const evilCx = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:evil="urn:evil"><w:body><w:p><w:r><w:drawing>` +
        `<wp:inline><wp:extent evil:cx="1" cy="1"/><a:graphic xmlns:a="${A}"/></wp:inline>` +
        '</w:drawing></w:r></w:p></w:body></w:document>'
    );
    expect(findByLocalName(evilCx.root, 'drawing').kind).toBe('generic');

    const unqualifiedEmbed = parse(
      inlinePictureDrawing().replace('r:embed="rId14"', 'embed="rId14"')
    );
    expect(findByLocalName(unqualifiedEmbed.root, 'blip').kind).toBe('generic');

    const ownerEmbed = parse(
      inlinePictureDrawing().replace('r:embed="rId14"', `a:embed="rId14" xmlns:a="${A}"`)
    );
    expect(findByLocalName(ownerEmbed.root, 'blip').kind).toBe('generic');
  });

  test('exercises wrap vocabulary, wrapText values, and polygon requirements', () => {
    for (const wrapText of ['bothSides', 'left', 'right', 'largest'] as const) {
      const part = parse(
        anchoredWrapDrawing(
          `<wp:wrapSquare wrapText="${wrapText}" distT="0" distB="0" distL="0" distR="0"/>`
        )
      );
      expect(findFirst(part.root, 'drawingWrapSquare').kind).toBe('drawingWrapSquare');
      expect(invariantApi.validateOoxmlPart(part).ok).toBe(true);
    }
    expect(
      findFirst(parse(anchoredWrapDrawing('<wp:wrapNone/>')).root, 'drawingWrapNone').kind
    ).toBe('drawingWrapNone');
    expect(
      findFirst(parse(anchoredWrapDrawing('<wp:wrapTopAndBottom/>')).root, 'drawingWrapTopBottom')
        .kind
    ).toBe('drawingWrapTopBottom');
    expect(
      findFirst(
        parse(
          anchoredWrapDrawing(`<wp:wrapTight wrapText="bothSides">${polygonXml()}</wp:wrapTight>`)
        ).root,
        'drawingWrapTight'
      ).kind
    ).toBe('drawingWrapTight');
    expect(
      findFirst(
        parse(
          anchoredWrapDrawing(
            `<wp:wrapThrough wrapText="bothSides">${polygonXml()}</wp:wrapThrough>`
          )
        ).root,
        'drawingWrapThrough'
      ).kind
    ).toBe('drawingWrapThrough');

    const badWrapText = parse(
      anchoredWrapDrawing(
        '<wp:wrapSquare wrapText="diagonal" distT="0" distB="0" distL="0" distR="0"/>'
      )
    );
    expect(findByLocalName(badWrapText.root, 'wrapSquare').kind).toBe('generic');

    const tightWithoutPolygon = parse(anchoredWrapDrawing('<wp:wrapTight wrapText="bothSides"/>'));
    expect(findByLocalName(tightWithoutPolygon.root, 'wrapTight').kind).toBe('generic');

    const polygonMissingStart = parse(
      anchoredWrapDrawing(
        '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon><wp:lineTo x="1" y="1"/></wp:wrapPolygon></wp:wrapTight>'
      )
    );
    expect(findByLocalName(polygonMissingStart.root, 'wrapTight').kind).toBe('generic');

    const overLimitPoints = '<wp:start x="0" y="0"/>' + '<wp:lineTo x="1" y="1"/>'.repeat(600);
    const overLimitPolygon = parse(
      anchoredWrapDrawing(
        `<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0">${overLimitPoints}</wp:wrapPolygon></wp:wrapTight>`
      )
    );
    expect(findByLocalName(overLimitPolygon.root, 'wrapTight').kind).toBe('generic');
  });

  test('exercises position relativeFrom, align, and posOffset validation', () => {
    for (const relativeFrom of ['margin', 'page', 'column', 'character'] as const) {
      const part = parse(
        anchoredWrapDrawing('<wp:wrapNone/>')
          .replace(
            '<wp:positionH relativeFrom="margin"><wp:align>left</wp:align></wp:positionH>',
            `<wp:positionH relativeFrom="${relativeFrom}"><wp:align>center</wp:align></wp:positionH>`
          )
          .replace(
            '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>',
            '<wp:positionV relativeFrom="paragraph"><wp:posOffset>114300</wp:posOffset></wp:positionV>'
          )
      );
      expect(findFirst(part.root, 'drawingPositionH').kind).toBe('drawingPositionH');
      expect(invariantApi.validateOoxmlPart(part).ok).toBe(true);
    }

    const misordered = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
        `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" allowOverlap="1" behindDoc="0" locked="0" layoutInCell="1" relativeHeight="0">` +
        `<wp:extent cx="1" cy="1"/>` +
        `<wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH>` +
        `<wp:positionV relativeFrom="paragraph"><wp:posOffset>114300</wp:posOffset></wp:positionV>` +
        `<wp:wrapNone/>` +
        `<wp:docPr id="1" name="n"/>` +
        `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic/></a:graphicData></a:graphic>` +
        '</wp:anchor></w:drawing></w:r></w:p></w:body></w:document>'
    );
    expect(findByLocalName(misordered.root, 'anchor').kind).toBe('generic');

    const badRelative = parse(
      anchoredWrapDrawing('<wp:wrapNone/>').replace(
        'relativeFrom="margin"',
        'relativeFrom="galaxy"'
      )
    );
    expect(findByLocalName(badRelative.root, 'positionH').kind).toBe('generic');

    const badAlign = parse(
      anchoredWrapDrawing('<wp:wrapNone/>').replace(
        '<wp:align>left</wp:align>',
        '<wp:align>galaxy</wp:align>'
      )
    );
    expect(findByLocalName(badAlign.root, 'positionH').kind).toBe('generic');

    const badOffset = parse(
      anchoredWrapDrawing('<wp:wrapNone/>').replace(
        '<wp:posOffset>0</wp:posOffset>',
        '<wp:posOffset>wide</wp:posOffset>'
      )
    );
    expect(findByLocalName(badOffset.root, 'positionV').kind).toBe('generic');
  });

  test('validateOoxmlPart rejects synthetic typed drawing with bad blip or graphicData uri', () => {
    const part = parse(inlinePictureDrawing());
    const inline = findFirst(part.root, 'inlineDrawing');
    const blip = findFirst(part.root, 'pictureBlip');
    const brokenBlip = {
      ...part,
      root: {
        ...part.root,
        children: part.root.children.map((body) =>
          body.kind !== 'body'
            ? body
            : {
                ...body,
                children: body.children.map((paragraph) =>
                  paragraph.kind !== 'paragraph'
                    ? paragraph
                    : {
                        ...paragraph,
                        children: paragraph.children.map((run) =>
                          run.kind !== 'run'
                            ? run
                            : {
                                ...run,
                                children: run.children.map((drawing) =>
                                  drawing.kind !== 'drawing'
                                    ? drawing
                                    : {
                                        ...drawing,
                                        children: [
                                          {
                                            ...inline,
                                            children: inline.children.map((child) =>
                                              child.kind !== 'drawingGraphic'
                                                ? child
                                                : {
                                                    ...child,
                                                    children: child.children.map((graphicData) =>
                                                      graphicData.kind !== 'drawingGraphicData'
                                                        ? graphicData
                                                        : {
                                                            ...graphicData,
                                                            children: graphicData.children.map(
                                                              (picture) =>
                                                                picture.kind !== 'picture'
                                                                  ? picture
                                                                  : {
                                                                      ...picture,
                                                                      children:
                                                                        picture.children.map(
                                                                          (fill) =>
                                                                            fill.kind !==
                                                                            'pictureBlipFill'
                                                                              ? fill
                                                                              : {
                                                                                  ...fill,
                                                                                  children: [
                                                                                    {
                                                                                      ...blip,
                                                                                      attributes:
                                                                                        [],
                                                                                    },
                                                                                  ],
                                                                                }
                                                                        ),
                                                                    }
                                                            ),
                                                          }
                                                    ),
                                                  }
                                            ),
                                          },
                                        ],
                                      }
                                ),
                              }
                        ),
                      }
                ),
              }
        ),
      },
    } as OoxmlPart;
    expect(invariantApi.validateOoxmlPart(brokenBlip).ok).toBe(false);
  });
});

describe('typed drawing fix round 3', () => {
  test('requires schema-valid wrapText on wrapSquare, wrapTight, and wrapThrough', () => {
    const missingSquare = parse(
      anchoredWrapDrawing('<wp:wrapSquare distT="0" distB="0" distL="0" distR="0"/>')
    );
    expect(findByLocalName(missingSquare.root, 'wrapSquare').kind).toBe('generic');

    const missingTight = parse(anchoredWrapDrawing(`<wp:wrapTight>${polygonXml()}</wp:wrapTight>`));
    expect(findByLocalName(missingTight.root, 'wrapTight').kind).toBe('generic');

    const missingThrough = parse(
      anchoredWrapDrawing(`<wp:wrapThrough>${polygonXml()}</wp:wrapThrough>`)
    );
    expect(findByLocalName(missingThrough.root, 'wrapThrough').kind).toBe('generic');

    for (const wrapText of ['bothSides', 'left', 'right', 'largest'] as const) {
      const tight = parse(
        anchoredWrapDrawing(`<wp:wrapTight wrapText="${wrapText}">${polygonXml()}</wp:wrapTight>`)
      );
      expect(findFirst(tight.root, 'drawingWrapTight').kind).toBe('drawingWrapTight');
      const through = parse(
        anchoredWrapDrawing(
          `<wp:wrapThrough wrapText="${wrapText}">${polygonXml()}</wp:wrapThrough>`
        )
      );
      expect(findFirst(through.root, 'drawingWrapThrough').kind).toBe('drawingWrapThrough');
    }
  });

  test('rejects malformed polygon order and missing start', () => {
    const lineBeforeStart = parse(
      anchoredWrapDrawing(
        '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon><wp:lineTo x="1" y="1"/><wp:start x="0" y="0"/></wp:wrapPolygon></wp:wrapTight>'
      )
    );
    expect(findByLocalName(lineBeforeStart.root, 'wrapTight').kind).toBe('generic');

    const startAfterLineTo = parse(
      anchoredWrapDrawing(
        '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon><wp:start x="0" y="0"/><wp:lineTo x="1" y="1"/><wp:start x="2" y="2"/></wp:wrapPolygon></wp:wrapTight>'
      )
    );
    expect(findByLocalName(startAfterLineTo.root, 'wrapTight').kind).toBe('generic');
  });

  test('separates signed coordinates from non-negative dimensions', () => {
    const negativeExtent = parse(inlinePictureDrawing({ extent: 'cx="-1" cy="1"' }));
    expect(findByLocalName(negativeExtent.root, 'drawing').kind).toBe('generic');
    expect(invariantApi.validateOoxmlPart(negativeExtent).ok).toBe(true);

    const negativeTransformExt = parse(
      inlinePictureDrawing().replace('<a:ext cx="152400" cy="152400"/>', '<a:ext cx="-1" cy="1"/>')
    );
    expect(findByLocalName(negativeTransformExt.root, 'ext').kind).toBe('generic');

    const signedOffset = parse(
      anchoredWrapDrawing('<wp:wrapNone/>').replace(
        '<wp:posOffset>0</wp:posOffset>',
        '<wp:posOffset>-114300</wp:posOffset>'
      )
    );
    expect(findFirst(signedOffset.root, 'drawingPositionOffset').kind).toBe(
      'drawingPositionOffset'
    );

    const signedSimplePos = parse(
      anchoredWrapDrawing('<wp:wrapNone/>').replace(
        '<wp:simplePos x="0" y="0"/>',
        '<wp:simplePos x="-1" y="-2"/>'
      )
    );
    expect(findFirst(signedSimplePos.root, 'drawingSimplePos').kind).toBe('drawingSimplePos');

    const signedPolygon = parse(
      anchoredWrapDrawing(
        `<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon><wp:start x="-1" y="-2"/><wp:lineTo x="100" y="100"/><wp:lineTo x="50" y="50"/></wp:wrapPolygon></wp:wrapTight>`
      )
    );
    expect(findFirst(signedPolygon.root, 'drawingWrapPolygonStart').kind).toBe(
      'drawingWrapPolygonStart'
    );
  });

  test('exercises all schema relativeFrom, align, and signed posOffset values', () => {
    for (const relativeFrom of [
      'character',
      'column',
      'insideMargin',
      'leftMargin',
      'margin',
      'outsideMargin',
      'page',
      'rightMargin',
    ] as const) {
      const part = parse(
        anchoredWrapDrawing('<wp:wrapNone/>').replace(
          '<wp:positionH relativeFrom="margin"><wp:align>left</wp:align></wp:positionH>',
          `<wp:positionH relativeFrom="${relativeFrom}"><wp:align>center</wp:align></wp:positionH>`
        )
      );
      expect(findFirst(part.root, 'drawingPositionH').kind).toBe('drawingPositionH');
      expect(invariantApi.validateOoxmlPart(part).ok).toBe(true);
    }
    for (const relativeFrom of [
      'bottomMargin',
      'insideMargin',
      'line',
      'margin',
      'outsideMargin',
      'page',
      'paragraph',
      'topMargin',
    ] as const) {
      const part = parse(
        anchoredWrapDrawing('<wp:wrapNone/>').replace(
          '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>',
          `<wp:positionV relativeFrom="${relativeFrom}"><wp:posOffset>-10</wp:posOffset></wp:positionV>`
        )
      );
      expect(findFirst(part.root, 'drawingPositionV').kind).toBe('drawingPositionV');
      expect(invariantApi.validateOoxmlPart(part).ok).toBe(true);
    }
    for (const align of ['center', 'inside', 'left', 'outside', 'right'] as const) {
      const part = parse(
        anchoredWrapDrawing('<wp:wrapNone/>').replace(
          '<wp:align>left</wp:align>',
          `<wp:align>${align}</wp:align>`
        )
      );
      expect(findFirst(part.root, 'drawingPositionAlign').kind).toBe('drawingPositionAlign');
    }
    for (const align of ['bottom', 'center', 'inside', 'outside', 'top'] as const) {
      const part = parse(
        anchoredWrapDrawing('<wp:wrapNone/>').replace(
          '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>',
          `<wp:positionV relativeFrom="paragraph"><wp:align>${align}</wp:align></wp:positionV>`
        )
      );
      expect(findFirst(part.root, 'drawingPositionAlign').kind).toBe('drawingPositionAlign');
    }
  });

  test('validateOoxmlPart rejects illegal drawing parent contexts', () => {
    const part = parse(inlinePictureDrawing());
    const body = part.root.children[0] as OoxmlElement;
    const inline = findFirst(part.root, 'inlineDrawing');
    const extent = findFirst(part.root, 'drawingExtent');
    const picture = findFirst(part.root, 'picture');

    const inlineOutsideDrawing = {
      ...part,
      root: {
        ...part.root,
        children: [{ ...body, children: [inline] }],
      },
    } as OoxmlPart;
    expect(invariantApi.validateOoxmlPart(inlineOutsideDrawing).ok).toBe(false);

    const paragraph = body.children[0] as OoxmlElement;
    const run = paragraph.children[0] as OoxmlElement;
    const drawing = run.children[0] as OoxmlElement;
    const drawingUnderGeneric = {
      ...part,
      root: {
        ...part.root,
        children: [
          {
            ...body,
            children: [
              {
                ...paragraph,
                children: [
                  {
                    ...run,
                    children: [
                      {
                        id: 'generic-wrap',
                        kind: 'generic',
                        namespaceUri: 'urn:wrap',
                        localName: 'holder',
                        namespaceBindings: [],
                        attributes: [],
                        children: [drawing],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    } as OoxmlPart;
    expect(invariantApi.validateOoxmlPart(drawingUnderGeneric).ok).toBe(false);

    const pictureOutsideGraphicData = {
      ...part,
      root: {
        ...part.root,
        children: [
          {
            ...body,
            children: [
              {
                ...paragraph,
                children: [
                  {
                    ...run,
                    children: [{ ...drawing, children: [{ ...inline, children: [picture] }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    } as OoxmlPart;
    expect(invariantApi.validateOoxmlPart(pictureOutsideGraphicData).ok).toBe(false);

    const typedChildUnderGenericInline = {
      ...part,
      root: {
        ...part.root,
        children: [
          {
            ...body,
            children: [
              {
                ...paragraph,
                children: [
                  {
                    ...run,
                    children: [
                      {
                        ...drawing,
                        children: [{ ...inline, kind: 'generic', children: [extent] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    } as OoxmlPart;
    expect(invariantApi.validateOoxmlPart(typedChildUnderGenericInline).ok).toBe(false);
  });
});

describe('typed drawing fix round 4', () => {
  test('rejects wrapPolygon with only one lineTo and accepts two lineTo points', () => {
    const oneLineTo = parse(
      anchoredWrapDrawing(
        '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon><wp:start x="0" y="0"/><wp:lineTo x="100" y="100"/></wp:wrapPolygon></wp:wrapTight>'
      )
    );
    expect(findByLocalName(oneLineTo.root, 'wrapTight').kind).toBe('generic');

    const twoLineTo = parse(
      anchoredWrapDrawing(
        '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon><wp:start x="0" y="0"/><wp:lineTo x="100" y="0"/><wp:lineTo x="100" y="100"/></wp:wrapPolygon></wp:wrapTight>'
      )
    );
    expect(findFirst(twoLineTo.root, 'drawingWrapTight').kind).toBe('drawingWrapTight');
    const polygon = findFirst(twoLineTo.root, 'drawingWrapPolygon');
    expect(findFirst(polygon, 'drawingWrapPolygonStart').kind).toBe('drawingWrapPolygonStart');
    expect(countKind(polygon, 'drawingWrapPolygonLineTo')).toBe(2);
    expect(invariantApi.validateOoxmlPart(twoLineTo).ok).toBe(true);
  });

  test('types optional effectExtent under wrapSquare and wrapTopAndBottom at most once', () => {
    const squareWithEffect = parse(
      anchoredWrapDrawing(
        '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"><wp:effectExtent l="0" t="0" r="0" b="0"/></wp:wrapSquare>'
      )
    );
    const wrapSquare = findFirst(squareWithEffect.root, 'drawingWrapSquare');
    expect(wrapSquare.kind).toBe('drawingWrapSquare');
    expect(findFirst(wrapSquare, 'drawingEffectExtent').kind).toBe('drawingEffectExtent');
    expect(invariantApi.validateOoxmlPart(squareWithEffect).ok).toBe(true);

    const topBottomWithEffect = parse(
      anchoredWrapDrawing(
        '<wp:wrapTopAndBottom><wp:effectExtent l="1" t="2" r="3" b="4"/></wp:wrapTopAndBottom>'
      )
    );
    const wrapTopBottom = findFirst(topBottomWithEffect.root, 'drawingWrapTopBottom');
    expect(wrapTopBottom.kind).toBe('drawingWrapTopBottom');
    expect(findFirst(wrapTopBottom, 'drawingEffectExtent').kind).toBe('drawingEffectExtent');
    expect(invariantApi.validateOoxmlPart(topBottomWithEffect).ok).toBe(true);

    const duplicateEffect = parse(
      anchoredWrapDrawing(
        '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0">' +
          '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:effectExtent l="1" t="1" r="1" b="1"/>' +
          '</wp:wrapSquare>'
      )
    );
    expect(findByLocalName(duplicateEffect.root, 'wrapSquare').kind).toBe('generic');

    const misplacedEffect = parse(
      anchoredWrapDrawing(
        `<wp:wrapTight wrapText="bothSides">${polygonXml()}<wp:effectExtent l="0" t="0" r="0" b="0"/></wp:wrapTight>`
      )
    );
    expect(findByLocalName(misplacedEffect.root, 'wrapTight').kind).toBe('generic');
  });

  test('validateOoxmlPart rejects duplicate effectExtent under typed wrapSquare', () => {
    const part = parse(
      anchoredWrapDrawing(
        '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"><wp:effectExtent l="0" t="0" r="0" b="0"/></wp:wrapSquare>'
      )
    );
    const wrapSquare = findFirst(part.root, 'drawingWrapSquare');
    const effectExtent = findFirst(wrapSquare, 'drawingEffectExtent');
    const broken = {
      ...part,
      root: {
        ...part.root,
        children: part.root.children.map((body) =>
          body.kind !== 'body'
            ? body
            : {
                ...body,
                children: body.children.map((paragraph) =>
                  paragraph.kind !== 'paragraph'
                    ? paragraph
                    : {
                        ...paragraph,
                        children: paragraph.children.map((run) =>
                          run.kind !== 'run'
                            ? run
                            : {
                                ...run,
                                children: run.children.map((drawing) =>
                                  drawing.kind !== 'drawing'
                                    ? drawing
                                    : {
                                        ...drawing,
                                        children: drawing.children.map((anchor) =>
                                          anchor.kind !== 'anchoredDrawing'
                                            ? anchor
                                            : {
                                                ...anchor,
                                                children: anchor.children.map((child) =>
                                                  child.kind !== 'drawingWrapSquare'
                                                    ? child
                                                    : {
                                                        ...child,
                                                        children: [
                                                          effectExtent,
                                                          { ...effectExtent, id: 'dup' },
                                                        ],
                                                      }
                                                ),
                                              }
                                        ),
                                      }
                                ),
                              }
                        ),
                      }
                ),
              }
        ),
      },
    } as OoxmlPart;
    expect(invariantApi.validateOoxmlPart(broken).ok).toBe(false);
  });
});

describe('typed drawing fix round 5', () => {
  test('rejects effectExtent under wrapNone, wrapTight, and wrapThrough', () => {
    const wrapNoneWithEffect = parse(
      anchoredWrapDrawing('<wp:wrapNone><wp:effectExtent l="0" t="0" r="0" b="0"/></wp:wrapNone>')
    );
    expect(findByLocalName(wrapNoneWithEffect.root, 'wrapNone').kind).toBe('generic');

    const wrapTightGenericEffect = parse(
      anchoredWrapDrawing(
        `<wp:wrapTight wrapText="bothSides">${polygonXml()}<wp:effectExtent l="0" t="0" r="0" b="0"/></wp:wrapTight>`
      )
    );
    expect(findByLocalName(wrapTightGenericEffect.root, 'wrapTight').kind).toBe('generic');

    const wrapThroughWithEffect = parse(
      anchoredWrapDrawing(
        `<wp:wrapThrough wrapText="left">${polygonXml()}<wp:effectExtent l="1" t="2" r="3" b="4"/></wp:wrapThrough>`
      )
    );
    expect(findByLocalName(wrapThroughWithEffect.root, 'wrapThrough').kind).toBe('generic');
  });

  test('requires schema-valid signed l/t/r/b on typed effectExtent', () => {
    const missingL = parse(inlinePictureDrawing().replace('l="0"', ''));
    expect(findByLocalName(missingL.root, 'inline').kind).toBe('generic');

    const foreignLookalike = parse(
      inlinePictureDrawing().replace(
        'l="0" t="0" r="0" b="0"',
        'evil:l="0" t="0" r="0" b="0" xmlns:evil="urn:evil"'
      )
    );
    expect(findByLocalName(foreignLookalike.root, 'inline').kind).toBe('generic');

    const nonNumeric = parse(
      inlinePictureDrawing().replace('l="0" t="0" r="0" b="0"', 'l="nope" t="0" r="0" b="0"')
    );
    expect(findByLocalName(nonNumeric.root, 'inline').kind).toBe('generic');

    const signedNegative = parse(
      inlinePictureDrawing().replace('l="0" t="0" r="0" b="0"', 'l="-1" t="-2" r="-3" b="-4"')
    );
    const inline = findFirst(signedNegative.root, 'inlineDrawing');
    expect(inline.kind).toBe('inlineDrawing');
    expect(findFirst(inline, 'drawingEffectExtent').kind).toBe('drawingEffectExtent');
    expect(invariantApi.validateOoxmlPart(signedNegative).ok).toBe(true);

    const badWrapParent = parse(
      anchoredWrapDrawing(
        '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0">' +
          '<wp:effectExtent l="bad" t="0" r="0" b="0"/>' +
          '</wp:wrapSquare>'
      )
    );
    expect(findByLocalName(badWrapParent.root, 'wrapSquare').kind).toBe('generic');

    const goodWrapParent = parse(
      anchoredWrapDrawing(
        '<wp:wrapTopAndBottom><wp:effectExtent l="-1" t="0" r="0" b="0"/></wp:wrapTopAndBottom>'
      )
    );
    expect(findFirst(goodWrapParent.root, 'drawingWrapTopBottom').kind).toBe(
      'drawingWrapTopBottom'
    );
    expect(findFirst(goodWrapParent.root, 'drawingEffectExtent').kind).toBe('drawingEffectExtent');
    expect(invariantApi.validateOoxmlPart(goodWrapParent).ok).toBe(true);
  });

  test('validateOoxmlPart rejects malformed effectExtent on inline and wrapSquare', () => {
    const inlinePart = parse(inlinePictureDrawing());
    const inline = findFirst(inlinePart.root, 'inlineDrawing');
    const effectExtent = findFirst(inline, 'drawingEffectExtent');
    const inlineMissingCoord = {
      ...inlinePart,
      root: {
        ...inlinePart.root,
        children: inlinePart.root.children.map((body) =>
          body.kind !== 'body'
            ? body
            : {
                ...body,
                children: body.children.map((paragraph) =>
                  paragraph.kind !== 'paragraph'
                    ? paragraph
                    : {
                        ...paragraph,
                        children: paragraph.children.map((run) =>
                          run.kind !== 'run'
                            ? run
                            : {
                                ...run,
                                children: run.children.map((drawing) =>
                                  drawing.kind !== 'drawing'
                                    ? drawing
                                    : {
                                        ...drawing,
                                        children: drawing.children.map((child) =>
                                          child.kind !== 'inlineDrawing'
                                            ? child
                                            : {
                                                ...child,
                                                children: child.children.map((inlineChild) =>
                                                  inlineChild.id === effectExtent.id
                                                    ? {
                                                        ...effectExtent,
                                                        attributes: effectExtent.attributes.filter(
                                                          (attribute) => attribute.localName !== 'b'
                                                        ),
                                                      }
                                                    : inlineChild
                                                ),
                                              }
                                        ),
                                      }
                                ),
                              }
                        ),
                      }
                ),
              }
        ),
      },
    } as OoxmlPart;
    expect(invariantApi.validateOoxmlPart(inlineMissingCoord).ok).toBe(false);

    const wrapPart = parse(
      anchoredWrapDrawing(
        '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"><wp:effectExtent l="0" t="0" r="0" b="0"/></wp:wrapSquare>'
      )
    );
    const wrapSquare = findFirst(wrapPart.root, 'drawingWrapSquare');
    const wrapEffectExtent = findFirst(wrapSquare, 'drawingEffectExtent');
    const wrapNonNumeric = {
      ...wrapPart,
      root: {
        ...wrapPart.root,
        children: wrapPart.root.children.map((body) =>
          body.kind !== 'body'
            ? body
            : {
                ...body,
                children: body.children.map((paragraph) =>
                  paragraph.kind !== 'paragraph'
                    ? paragraph
                    : {
                        ...paragraph,
                        children: paragraph.children.map((run) =>
                          run.kind !== 'run'
                            ? run
                            : {
                                ...run,
                                children: run.children.map((drawing) =>
                                  drawing.kind !== 'drawing'
                                    ? drawing
                                    : {
                                        ...drawing,
                                        children: drawing.children.map((anchor) =>
                                          anchor.kind !== 'anchoredDrawing'
                                            ? anchor
                                            : {
                                                ...anchor,
                                                children: anchor.children.map((child) =>
                                                  child.kind !== 'drawingWrapSquare'
                                                    ? child
                                                    : {
                                                        ...child,
                                                        children: child.children.map((wrapChild) =>
                                                          wrapChild.id === wrapEffectExtent.id
                                                            ? {
                                                                ...wrapEffectExtent,
                                                                attributes:
                                                                  wrapEffectExtent.attributes.map(
                                                                    (attribute) =>
                                                                      attribute.localName === 'l'
                                                                        ? {
                                                                            ...attribute,
                                                                            value: 'not-a-number',
                                                                          }
                                                                        : attribute
                                                                  ),
                                                              }
                                                            : wrapChild
                                                        ),
                                                      }
                                                ),
                                              }
                                        ),
                                      }
                                ),
                              }
                        ),
                      }
                ),
              }
        ),
      },
    } as OoxmlPart;
    expect(invariantApi.validateOoxmlPart(wrapNonNumeric).ok).toBe(false);
  });
});

describe('comprehensive fixture drawing round trip', () => {
  test('preserves all eleven drawings, empty a:srcRect, and canonical fingerprint', async () => {
    const { readFileSync } = await import('node:fs');
    const { readOoxmlPackage, writeOoxmlPackage } = await import('../package/ooxml-package.ts');
    const bytes = readFileSync(
      `${import.meta.dir}/../../../../../e2e/fixtures/comprehensive-word-element-test.docx`
    );
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const beforeFingerprint = canonicalOoxmlFingerprint(
      loaded.package.parts.get('/word/document.xml')!.root
    );
    const saved = writeOoxmlPackage(loaded.package);
    const reopened = readOoxmlPackage(saved);
    if (!reopened.ok) throw new Error(reopened.reason);
    const document = reopened.package.parts.get('/word/document.xml')!;
    const serialized = serializeOoxmlPart(document);
    expect((serialized.match(/<a:srcRect\/>/g) ?? []).length).toBe(11);
    expect(canonicalOoxmlFingerprint(document.root)).toBe(beforeFingerprint);
    expect(countKind(document.root, 'drawing')).toBe(11);
    expect(countKind(document.root, 'inlineDrawing')).toBe(10);
    expect(countKind(document.root, 'anchoredDrawing')).toBe(1);
    expect(countKind(document.root, 'picture')).toBe(11);
    expect(countKind(document.root, 'pictureSrcRect')).toBe(11);
    expect(invariantApi.validateOoxmlPart(document).ok).toBe(true);
  });
});

describe('drawing is one atomic segment', () => {
  test('A + drawing + B uses offsets 0, 1, 2, 3 and deletes exactly at [1, 2)', async () => {
    const { segmentsOf } = await import('../store/tree-op-segments.ts');
    const { applyTreeOp, paragraphTextOf } = await import('../store/tree-ops.ts');
    const { validateTreeOp } = await import('../store/tree-op-validate.ts');
    const { FIELD_ATOM_CHAR } = await import('../package/field-nodes.ts');

    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p>` +
        '<w:r><w:t>A</w:t></w:r>' +
        '<w:r>' +
        inlinePictureDrawing().match(/<w:drawing>[\s\S]*<\/w:drawing>/)![0] +
        '</w:r>' +
        '<w:r><w:t>B</w:t></w:r>' +
        '</w:p></w:body></w:document>'
    );
    const body = part.root.children[0] as OoxmlElement;
    const paragraph = body.children[0] as OoxmlElement;
    const segments = segmentsOf(paragraph as never);
    expect(segments.map((segment) => [segment.start, segment.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(paragraphTextOf(part, paragraph.id)).toBe(`A${FIELD_ATOM_CHAR}B`);
    expect(
      validateTreeOp(part, {
        op: 'setRunProperties',
        paragraphId: paragraph.id,
        start: 1,
        end: 2,
        properties: [{ localName: 'b', attributes: {} }],
      })
    ).toBeNull();
    expect(
      validateTreeOp(part, {
        op: 'setRunProperties',
        paragraphId: paragraph.id,
        start: 0,
        end: 1,
        properties: [{ localName: 'b', attributes: {} }],
      })
    ).toBeNull();
    const deleted = applyTreeOp(part, {
      op: 'deleteText',
      paragraphId: paragraph.id,
      start: 1,
      end: 2,
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(paragraphTextOf(deleted.part, paragraph.id)).toBe('AB');
    expect(serializeOoxmlPart(deleted.part).includes('<w:drawing')).toBe(false);
  });

  test('drawing stays atomic inside hyperlink and revision wrappers', async () => {
    const { segmentsOf } = await import('../store/tree-op-segments.ts');
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p>` +
        '<w:hyperlink r:id="rId99"><w:r><w:t>A</w:t></w:r></w:hyperlink>' +
        '<w:ins w:author="x"><w:r>' +
        inlinePictureDrawing().match(/<w:drawing>[\s\S]*<\/w:drawing>/)![0] +
        '</w:r></w:ins>' +
        '<w:r><w:t>B</w:t></w:r>' +
        '</w:p></w:body></w:document>'
    );
    const paragraph = (part.root.children[0] as OoxmlElement).children[0] as OoxmlElement;
    const segments = segmentsOf(paragraph as never);
    expect(segments.map((segment) => [segment.start, segment.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(segments[1]!.removeNodeIds).toEqual([segments[1]!.node.id]);
  });

  test('run-level MC wrapper is one atomic segment', async () => {
    const { segmentsOf } = await import('../store/tree-op-segments.ts');
    const { validateTreeOp } = await import('../store/tree-op-validate.ts');
    const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
    const drawingInner = inlinePictureDrawing().match(/<w:drawing>[\s\S]*<\/w:drawing>/)![0];
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:mc="${MC}" xmlns:w14="urn:word14" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p>` +
        '<w:r><w:t>A</w:t></w:r>' +
        '<w:r>' +
        `<mc:AlternateContent xmlns:mc="${MC}">` +
        `<mc:Choice Requires="w14">${drawingInner}</mc:Choice>` +
        `<mc:Fallback>${drawingInner}</mc:Fallback>` +
        '</mc:AlternateContent>' +
        '</w:r>' +
        '<w:r><w:t>B</w:t></w:r>' +
        '</w:p></w:body></w:document>'
    );
    const paragraph = (part.root.children[0] as OoxmlElement).children[0] as OoxmlElement;
    const segments = segmentsOf(paragraph as never);
    expect(segments.map((segment) => [segment.start, segment.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(segments[1]!.node.kind).toBe('generic');
    expect(segments[1]!.removeNodeIds).toHaveLength(1);
    expect(
      validateTreeOp(part, { op: 'splitParagraph', paragraphId: paragraph.id, offset: 1 })
    ).toBeNull();
    expect(
      validateTreeOp(part, { op: 'splitParagraph', paragraphId: paragraph.id, offset: 2 })
    ).toBeNull();
    expect(
      validateTreeOp(part, { op: 'splitParagraphMany', paragraphId: paragraph.id, offsets: [2] })
    ).toBeNull();
  });

  test('splitParagraph at drawing boundaries for direct drawing atom', async () => {
    const { validateTreeOp } = await import('../store/tree-op-validate.ts');
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p>` +
        '<w:r><w:t>A</w:t></w:r>' +
        '<w:r>' +
        inlinePictureDrawing().match(/<w:drawing>[\s\S]*<\/w:drawing>/)![0] +
        '</w:r>' +
        '<w:r><w:t>B</w:t></w:r>' +
        '</w:p></w:body></w:document>'
    );
    const paragraph = (part.root.children[0] as OoxmlElement).children[0] as OoxmlElement;
    expect(
      validateTreeOp(part, { op: 'splitParagraph', paragraphId: paragraph.id, offset: 1 })
    ).toBeNull();
    expect(
      validateTreeOp(part, { op: 'splitParagraph', paragraphId: paragraph.id, offset: 2 })
    ).toBeNull();
    expect(
      validateTreeOp(part, { op: 'splitParagraphMany', paragraphId: paragraph.id, offsets: [0, 2] })
    ).toBeNull();
  });

  test('run-level MC branch-limit refusal still emits one inert atomic segment', async () => {
    const { segmentsOf } = await import('../store/tree-op-segments.ts');
    const { applyTreeOp, paragraphTextOf } = await import('../store/tree-ops.ts');
    const { validateTreeOp } = await import('../store/tree-op-validate.ts');
    const { resolveRunLevelMcAtom } = await import('../package/drawing-projection.ts');
    const { FIELD_ATOM_CHAR } = await import('../package/field-nodes.ts');
    const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
    const choices = Array.from(
      { length: 70 },
      () =>
        `<mc:Choice Requires="w14"><w:drawing><wp:inline><wp:extent cx="1" cy="1"/></wp:inline></w:drawing></mc:Choice>`
    ).join('');
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:mc="${MC}" xmlns:w14="urn:word14" xmlns:wp="${WP}"><w:body><w:p>` +
        '<w:r><w:t>A</w:t></w:r>' +
        '<w:r>' +
        `<mc:AlternateContent xmlns:mc="${MC}">${choices}<mc:Fallback><w:drawing><wp:inline><wp:extent cx="1" cy="1"/></wp:inline></w:drawing></mc:Fallback></mc:AlternateContent>` +
        '</w:r>' +
        '<w:r><w:t>B</w:t></w:r>' +
        '</w:p></w:body></w:document>'
    );
    const paragraph = (part.root.children[0] as OoxmlElement).children[0] as OoxmlElement;
    const segments = segmentsOf(paragraph as never);
    expect(segments.map((segment) => [segment.start, segment.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(segments[1]!.node.kind).toBe('generic');
    expect(segments[1]!.removeNodeIds).toEqual([segments[1]!.node.id]);
    const atom = resolveRunLevelMcAtom(
      segments[1]!.node as never,
      new Map(),
      new Set(['urn:word14']),
      {
        maxCompatibilityBranches: 2,
        maxVisitedElements: 4096,
        maxDrawingDepth: 64,
      }
    );
    expect(atom.drawing).toBeNull();
    expect(atom.removeNodeIds).toEqual([segments[1]!.node.id]);
    expect(paragraphTextOf(part, paragraph.id)).toBe(`A${FIELD_ATOM_CHAR}B`);
    expect(
      validateTreeOp(part, { op: 'splitParagraph', paragraphId: paragraph.id, offset: 1 })
    ).toBeNull();
    expect(
      validateTreeOp(part, { op: 'splitParagraph', paragraphId: paragraph.id, offset: 2 })
    ).toBeNull();
    const deleted = applyTreeOp(part, {
      op: 'deleteText',
      paragraphId: paragraph.id,
      start: 1,
      end: 2,
    });
    expect(deleted.ok).toBe(true);
    if (deleted.ok) {
      expect(paragraphTextOf(deleted.part, paragraph.id)).toBe('AB');
      expect(serializeOoxmlPart(deleted.part).includes('mc:AlternateContent')).toBe(false);
    }
  });

  test('run-level MC with no supported branch emits inert atomic segment', async () => {
    const { segmentsOf } = await import('../store/tree-op-segments.ts');
    const { validateTreeOp } = await import('../store/tree-op-validate.ts');
    const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:mc="${MC}" xmlns:w14="urn:not-supported" xmlns:wp="${WP}"><w:body><w:p>` +
        '<w:r>' +
        `<mc:AlternateContent xmlns:mc="${MC}">` +
        `<mc:Choice Requires="w14"><w:drawing><wp:inline><wp:extent cx="1" cy="1"/></wp:inline></w:drawing></mc:Choice>` +
        '</mc:AlternateContent>' +
        '</w:r></w:p></w:body></w:document>'
    );
    const paragraph = (part.root.children[0] as OoxmlElement).children[0] as OoxmlElement;
    const segments = segmentsOf(paragraph as never);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.start).toBe(0);
    expect(segments[0]!.end).toBe(1);
    expect(segments[0]!.removeNodeIds).toEqual([segments[0]!.node.id]);
    expect(
      validateTreeOp(part, { op: 'splitParagraph', paragraphId: paragraph.id, offset: 1 })
    ).toBeNull();
  });

  test('run-level MC visit-limit refusal still emits one inert atomic segment', async () => {
    const { segmentsOf } = await import('../store/tree-op-segments.ts');
    const { validateTreeOp } = await import('../store/tree-op-validate.ts');
    const { applyTreeOp, paragraphTextOf } = await import('../store/tree-ops.ts');
    const { FIELD_ATOM_CHAR } = await import('../package/field-nodes.ts');
    const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
    let picInner =
      '<pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>';
    for (let index = 0; index < 80; index += 1) {
      picInner = `<a:extra xmlns:a="${A}">${picInner}</a:extra>`;
    }
    const drawingInner =
      `<w:drawing><wp:inline><wp:extent cx="152400" cy="152400"/>` +
      '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
      '<wp:docPr id="1" name="x"/>' +
      '<wp:cNvGraphicFramePr/>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic>${picInner}</pic:pic></a:graphicData></a:graphic>` +
      '</wp:inline></w:drawing>';
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:mc="${MC}" xmlns:w14="urn:word14" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p>` +
        '<w:r><w:t>A</w:t></w:r>' +
        '<w:r>' +
        `<mc:AlternateContent xmlns:mc="${MC}">` +
        `<mc:Choice Requires="w14">${drawingInner}</mc:Choice>` +
        `<mc:Fallback>${drawingInner}</mc:Fallback>` +
        '</mc:AlternateContent>' +
        '</w:r>' +
        '<w:r><w:t>B</w:t></w:r>' +
        '</w:p></w:body></w:document>'
    );
    const paragraph = (part.root.children[0] as OoxmlElement).children[0] as OoxmlElement;
    const segments = segmentsOf(paragraph as never);
    expect(segments.map((segment) => [segment.start, segment.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(segments[1]!.removeNodeIds).toEqual([segments[1]!.node.id]);
    expect(paragraphTextOf(part, paragraph.id)).toBe(`A${FIELD_ATOM_CHAR}B`);
    expect(
      validateTreeOp(part, { op: 'splitParagraph', paragraphId: paragraph.id, offset: 1 })
    ).toBeNull();
    const deleted = applyTreeOp(part, {
      op: 'deleteText',
      paragraphId: paragraph.id,
      start: 1,
      end: 2,
    });
    expect(deleted.ok).toBe(true);
  });
});
