// The equation snippet reader and the insertEquation op: the accepted shape, the canonical
// nodes it answers, every refusal, and the tracked and untracked tree shapes.
import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import { readEquationSnippet, MAX_EQUATION_SNIPPET_BYTES } from '../store/equation-snippet.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import { validateTreeOp } from '../store/tree-op-validate.ts';
import {
  documentPart,
  equationPackage,
  flatOpc,
  RELS_PART,
  X_SQUARED,
} from './equation-snippet-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

const firstParagraphId = (part: OoxmlPart): string => {
  const body = part.root.children.find((node) => node.kind === 'body')!;
  return (body.kind === 'textValue' ? '' : body.children[0]!.id) as string;
};

describe('readEquationSnippet', () => {
  test('accepts one inline equation with plain runs, with or without the rels part', () => {
    for (const ooxml of [
      equationPackage(`<w:r><w:t>a</w:t></w:r>${X_SQUARED}<w:r><w:tab/></w:r>`),
      flatOpc(
        documentPart(
          `<w:p w14:paraId="1A2B3C4D">${X_SQUARED}</w:p>`,
          ' xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"'
        )
      ),
    ]) {
      const read = readEquationSnippet(ooxml);
      expect(read.ok).toBe(true);
      if (!read.ok) continue;
      expect(
        read.snippet.nodes.filter((node) => node.kind !== 'textValue' && node.localName === 'oMath')
      ).toHaveLength(1);
    }
    const read = readEquationSnippet(equationPackage(`<w:r><w:t>ab</w:t></w:r>${X_SQUARED}`));
    expect(read.ok && read.snippet.length).toBe(3);
  });

  test('accepts a package that binds its prefixes on the package root', () => {
    const ooxml = flatOpc(
      RELS_PART +
        '<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml">' +
        `<pkg:xmlData><q:document xmlns:q="${W}" xmlns:mm="http://schemas.openxmlformats.org/officeDocument/2006/math">` +
        '<q:body><q:p><mm:oMath><mm:r><mm:t>y</mm:t></mm:r></mm:oMath></q:p></q:body></q:document></pkg:xmlData></pkg:part>'
    );
    const read = readEquationSnippet(ooxml);
    expect(read.ok).toBe(true);
  });

  const refusals: readonly [string, unknown, string][] = [
    ['not a string', 42, 'ooxml-invalid'],
    ['malformed', '<pkg:package', 'ooxml-invalid'],
    ['a DTD', '<!DOCTYPE x [<!ENTITY a "b">]><x/>', 'ooxml-invalid'],
    ['an unbound prefix', '<pkg:package/>', 'ooxml-invalid'],
    ['oversize', 'x'.repeat(MAX_EQUATION_SNIPPET_BYTES + 1), 'resource-limit'],
    [
      'a style part',
      flatOpc(
        documentPart(`<w:p>${X_SQUARED}</w:p>`) +
          '<pkg:part pkg:name="/word/styles.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"><pkg:xmlData><w:styles xmlns:w="' +
          W +
          '"/></pkg:xmlData></pkg:part>'
      ),
      'ooxml-unsupported',
    ],
    [
      'two document parts',
      flatOpc(documentPart(`<w:p>${X_SQUARED}</w:p>`) + documentPart(`<w:p>${X_SQUARED}</w:p>`)),
      'ooxml-unsupported',
    ],
    [
      'a second relationship',
      flatOpc(
        RELS_PART.replace(
          '</Relationships>',
          '<Relationship Id="rId2" Type="x" Target="y"/></Relationships>'
        ) + documentPart(`<w:p>${X_SQUARED}</w:p>`)
      ),
      'ooxml-unsupported',
    ],
    [
      'math text outside m:t',
      equationPackage('<m:oMath>loose<m:r><m:t>x</m:t></m:r></m:oMath>'),
      'ooxml-unsupported',
    ],
    [
      'an attribute on w:rPr children from another namespace',
      equationPackage(
        `<w:r><w:rPr><w:b xmlns:x="urn:x" x:a="1"/></w:rPr><w:t>a</w:t></w:r>${X_SQUARED}`
      ),
      'ooxml-unsupported',
    ],
    [
      'run properties outside the allowlist',
      equationPackage(
        `<w:r><w:rPr><w:rPrChange w:id="1" w:author="a"/></w:rPr><w:t>a</w:t></w:r>${X_SQUARED}`
      ),
      'ooxml-unsupported',
    ],
    [
      'document math settings',
      equationPackage('<m:oMath><m:mathPr/><m:r><m:t>x</m:t></m:r></m:oMath>'),
      'ooxml-unsupported',
    ],
  ];
  for (const [name, input, reason] of refusals) {
    test(`refuses ${name}`, () => {
      expect(readEquationSnippet(input)).toEqual({ ok: false, reason } as never);
    });
  }
});

describe('insertEquation', () => {
  const snippet = () => {
    const read = readEquationSnippet(equationPackage());
    if (!read.ok) throw new Error(read.reason);
    return read.snippet;
  };

  test('untracked, the equation lands inline and binds the math prefix', () => {
    const part = load('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const { nodes, length } = snippet();
    const op = {
      op: 'insertEquation' as const,
      paragraphId: firstParagraphId(part),
      offset: 1,
      nodes,
      length,
    };
    expect(validateTreeOp(part, op)).toBeNull();
    const applied = applyTreeOp(part, op);
    if (!applied.ok) throw new Error(applied.reason);
    const xml = serializeOoxmlPart(applied.part);
    expect(xml).toContain('xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"');
    expect(xml).toMatch(/<w:t>a<\/w:t><\/w:r><m:oMath>.*<\/m:oMath><w:r><w:t>b<\/w:t>/);
  });

  test('tracked, the equation goes into one w:ins by the author', () => {
    const part = load('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const { nodes, length } = snippet();
    const applied = applyTreeOp(part, {
      op: 'insertEquation',
      paragraphId: firstParagraphId(part),
      offset: 2,
      nodes,
      length,
      revision: { author: 'Ada', date: '2026-01-01T00:00:00Z' },
    });
    if (!applied.ok) throw new Error(applied.reason);
    expect(serializeOoxmlPart(applied.part)).toMatch(
      /<w:ins w:author="Ada" w:date="2026-01-01T00:00:00Z" w:id="[^"]+"><m:oMath>.*<\/m:oMath><\/w:ins>/
    );
  });

  test('refuses another shape, a wrong length, and an empty author', () => {
    const part = load('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const { nodes, length } = snippet();
    const paragraphId = firstParagraphId(part);
    const base = { op: 'insertEquation' as const, paragraphId, offset: 1, nodes, length };
    expect(validateTreeOp(part, { ...base, nodes: [...nodes, ...nodes] })).toBe(
      'fragment-invalid-block'
    );
    expect(validateTreeOp(part, { ...base, length: length + 1 })).toBe('invalidArgs');
    expect(validateTreeOp(part, { ...base, offset: 9 })).toBe('offset-out-of-range');
    expect(validateTreeOp(part, { ...base, revision: { author: ' ' } })).toBe(
      'invalid-property-value'
    );
  });
});

describe('snippet limits and the op shape check', () => {
  const nested = (count: number) =>
    '<m:oMath>' +
    '<m:d><m:e>'.repeat(count) +
    '<m:r><m:t>x</m:t></m:r>' +
    '</m:e></m:d>'.repeat(count) +
    '</m:oMath>';

  test('a long text value and deep nesting refuse as resource limits', () => {
    expect(
      readEquationSnippet(
        equationPackage(`<m:oMath><m:r><m:t>${'a'.repeat(5000)}</m:t></m:r></m:oMath>`)
      )
    ).toEqual({ ok: false, reason: 'resource-limit' });
    expect(readEquationSnippet(equationPackage(nested(70)))).toEqual({
      ok: false,
      reason: 'resource-limit',
    });
    expect(readEquationSnippet(equationPackage(nested(20))).ok).toBe(true);
  });

  test('hostile markup without closing brackets is refused in linear time', () => {
    for (const hostile of ['<a'.repeat(120_000), '<a '.repeat(85_000), '<'.repeat(250_000)]) {
      const started = performance.now();
      expect(readEquationSnippet(hostile).ok).toBe(false);
      expect(performance.now() - started).toBeLessThan(500);
    }
  });

  test('an equation the reader admits passes the op shape check', () => {
    const runs = '<m:r><m:t>x</m:t></m:r>'.repeat(3000);
    const read = readEquationSnippet(equationPackage(`<m:oMath>${runs}</m:oMath>`));
    if (!read.ok) throw new Error(read.reason);
    const part = load('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const op = {
      op: 'insertEquation' as const,
      paragraphId: firstParagraphId(part),
      offset: 1,
      nodes: read.snippet.nodes,
      length: read.snippet.length,
    };
    expect(validateTreeOp(part, op)).toBeNull();
  });

  test('many plain runs are accepted by the reader and the op alike', () => {
    const runs = '<w:r><w:t>a</w:t></w:r>'.repeat(200);
    const read = readEquationSnippet(equationPackage(runs + X_SQUARED));
    if (!read.ok) throw new Error(read.reason);
    const part = load('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const op = {
      op: 'insertEquation' as const,
      paragraphId: firstParagraphId(part),
      offset: 1,
      nodes: read.snippet.nodes,
      length: read.snippet.length,
    };
    expect(validateTreeOp(part, op)).toBeNull();
  });

  test('the op refuses math outside the allowlist and malformed nodes without throwing', () => {
    const read = readEquationSnippet(equationPackage());
    if (!read.ok) throw new Error(read.reason);
    const part = load('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const equation = read.snippet.nodes[0]!;
    if (equation.kind === 'textValue') throw new Error('fixture');
    const foreign = {
      ...equation,
      children: [{ ...equation.children[0]!, localName: 'script' } as OoxmlNode],
    } as OoxmlNode;
    const base = { op: 'insertEquation' as const, paragraphId: firstParagraphId(part), offset: 1 };
    expect(validateTreeOp(part, { ...base, nodes: [foreign], length: 1 })).toBe(
      'fragment-invalid-block'
    );
    const hollowRun = {
      id: 'r',
      kind: 'run',
      namespaceUri: W,
      localName: 'r',
    } as unknown as OoxmlNode;
    expect(validateTreeOp(part, { ...base, nodes: [hollowRun, equation], length: 1 })).toBe(
      'fragment-invalid-block'
    );
  });
});
