import { describe, expect, test } from 'bun:test';
import {
  OFFICE_MATH_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  canonicalOoxmlFingerprint,
  createNodeIdAllocator,
  equationExpressionToLinearMath,
  findNode,
  insertChildren,
  linearMathToOmml,
  parseLinearMath,
  projectOmmlEquation,
  readOoxmlPart,
  serializeOoxmlPart,
  validateOoxmlPart,
  type EquationExpression,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../index.ts';

const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function readDocument(paragraphContent: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}">` +
      `<w:body><w:p>${paragraphContent}</w:p></w:body></w:document>`,
    metadata
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function equationOf(part: OoxmlPart): OoxmlElement {
  const body = part.root.children[0];
  if (!body || body.kind === 'textValue') throw new Error('missing body');
  const paragraph = body.children[0];
  if (!paragraph || paragraph.kind === 'textValue') throw new Error('missing paragraph');
  const equation = paragraph.children.find(
    (node) =>
      node.kind !== 'textValue' &&
      node.namespaceUri === OFFICE_MATH_NAMESPACE_URI &&
      node.localName === 'oMath'
  );
  if (!equation || equation.kind === 'textValue') throw new Error('missing equation');
  return equation;
}

function paragraphOf(part: OoxmlPart): OoxmlElement {
  const body = part.root.children[0];
  if (!body || body.kind === 'textValue') throw new Error('missing body');
  const paragraph = body.children[0];
  if (!paragraph || paragraph.kind === 'textValue') throw new Error('missing paragraph');
  return paragraph;
}

function expressionKinds(expression: EquationExpression): string[] {
  switch (expression.kind) {
    case 'row':
      return expression.items.flatMap(expressionKinds);
    case 'fraction':
      return [
        expression.kind,
        ...expressionKinds(expression.numerator),
        ...expressionKinds(expression.denominator),
      ];
    case 'radical':
      return [expression.kind, ...expressionKinds(expression.radicand)];
    case 'script':
      return [expression.kind, ...expressionKinds(expression.base)];
    case 'nary':
      return [expression.kind, ...expressionKinds(expression.body)];
    default:
      return [expression.kind];
  }
}

function allNodes(node: OoxmlNode): OoxmlNode[] {
  if (node.kind === 'textValue') return [node];
  return [node, ...node.children.flatMap(allNodes)];
}

describe('bounded OMML equation projection', () => {
  test('projects runs, fractions, radicals, superscripts, and n-ary limits', () => {
    const part = readDocument(
      '<m:oMath>' +
        '<m:r><m:t>E=mc</m:t></m:r>' +
        '<m:sSup><m:e><m:r><m:t>2</m:t></m:r></m:e>' +
        '<m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>' +
        '<m:f><m:fPr><m:type m:val="bar"/></m:fPr>' +
        '<m:num><m:r><m:t>a+b</m:t></m:r></m:num>' +
        '<m:den><m:r><m:t>2</m:t></m:r></m:den></m:f>' +
        '<m:rad><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad>' +
        '<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr>' +
        '<m:sub><m:r><m:t>i=0</m:t></m:r></m:sub>' +
        '<m:sup><m:r><m:t>n</m:t></m:r></m:sup>' +
        '<m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary>' +
        '</m:oMath>'
    );

    const projection = projectOmmlEquation(equationOf(part));
    expect(projection).not.toBeNull();
    expect(projection?.truncated).toBe(false);
    expect(expressionKinds(projection!.expression)).toEqual(
      expect.arrayContaining(['text', 'script', 'fraction', 'radical', 'nary'])
    );
    const nary =
      projection?.expression.kind === 'row'
        ? projection.expression.items.find((child) => child.kind === 'nary')
        : undefined;
    expect(nary).toMatchObject({
      kind: 'nary',
      operator: '∑',
      lowerLimit: { kind: 'text', value: 'i=0' },
      upperLimit: { kind: 'text', value: 'n' },
    });
  });

  test('uses descendant text for unsupported OMML without changing source', () => {
    const part = readDocument(
      '<m:oMath><m:groupChr><m:e><m:r><m:t>&lt;img onerror="x"&gt;</m:t></m:r>' +
        '</m:e></m:groupChr></m:oMath>'
    );
    const before = canonicalOoxmlFingerprint(part);
    const projection = projectOmmlEquation(equationOf(part));

    expect(projection).toMatchObject({
      truncated: false,
      fallbackText: '<img onerror="x">',
      expression: { kind: 'fallback', text: '<img onerror="x">' },
    });
    expect(canonicalOoxmlFingerprint(part)).toBe(before);
  });

  test.each([
    [
      'unknown child',
      '<m:f><m:num><m:r><m:t>a</m:t></m:r></m:num>' +
        '<m:den><m:r><m:t>b</m:t></m:r></m:den>' +
        '<m:box><m:r><m:t>extra</m:t></m:r></m:box></m:f>',
      'abextra',
    ],
    [
      'duplicate numerator',
      '<m:f><m:num><m:r><m:t>a</m:t></m:r></m:num>' +
        '<m:num><m:r><m:t>duplicate</m:t></m:r></m:num>' +
        '<m:den><m:r><m:t>b</m:t></m:r></m:den></m:f>',
      'aduplicateb',
    ],
    [
      'unsupported fraction property',
      '<m:f><m:fPr><m:type m:val="lin"/></m:fPr>' +
        '<m:num><m:r><m:t>a</m:t></m:r></m:num>' +
        '<m:den><m:r><m:t>b</m:t></m:r></m:den></m:f>',
      'ab',
    ],
  ])('falls back for structured OMML with an %s', (_, content, fallbackText) => {
    const projection = projectOmmlEquation(
      equationOf(readDocument(`<m:oMath>${content}</m:oMath>`))
    );
    expect(projection).toMatchObject({
      expression: { kind: 'fallback', text: fallbackText },
      fallbackText,
      truncated: false,
    });
  });

  test('reuses the immutable default projection by source-node identity', () => {
    const equation = equationOf(readDocument('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>'));
    const first = projectOmmlEquation(equation);
    expect(projectOmmlEquation(equation)).toBe(first);
    expect(projectOmmlEquation(equation, { maxNodes: 256 })).not.toBe(first);
  });

  test('stops at depth, node, and text budgets with a safe fallback', () => {
    const deep = `${'<m:box>'.repeat(30)}<m:r><m:t>hidden</m:t></m:r>${'</m:box>'.repeat(30)}`;
    const depthProjection = projectOmmlEquation(
      equationOf(readDocument(`<m:oMath>${deep}</m:oMath>`)),
      {
        maxDepth: 8,
      }
    );
    expect(depthProjection).toMatchObject({
      truncated: true,
      expression: { kind: 'fallback' },
    });

    const wide = Array.from({ length: 40 }, (_, index) => `<m:r><m:t>${index}</m:t></m:r>`).join(
      ''
    );
    const nodeProjection = projectOmmlEquation(
      equationOf(readDocument(`<m:oMath>${wide}</m:oMath>`)),
      {
        maxNodes: 12,
      }
    );
    expect(nodeProjection?.truncated).toBe(true);
    expect(nodeProjection!.visitedNodes).toBeLessThanOrEqual(12);

    const textProjection = projectOmmlEquation(
      equationOf(readDocument('<m:oMath><m:r><m:t>abcdefghij</m:t></m:r></m:oMath>')),
      { maxTextLength: 4 }
    );
    expect(textProjection).toMatchObject({
      truncated: true,
      fallbackText: 'abcd…',
      expression: { kind: 'fallback', text: 'abcd…' },
    });

    const operatorProjection = projectOmmlEquation(
      equationOf(
        readDocument(
          '<m:oMath><m:nary><m:naryPr><m:chr m:val="123456"/></m:naryPr>' +
            '<m:sub/><m:sup/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary></m:oMath>'
        )
      ),
      { maxTextLength: 4 }
    );
    expect(operatorProjection).toMatchObject({
      truncated: true,
      fallbackText: '1234…',
      expression: { kind: 'fallback', text: '1234…' },
    });
  });
});

describe('compact linear math to canonical OMML', () => {
  test.each([
    ['x^2', 'script'],
    ['x_i', 'script'],
    ['{a+b}/{2}', 'fraction'],
    ['√{x}', 'radical'],
    ['√[3]{x}', 'radical'],
    ['∑[n]{x}', 'nary'],
  ])('parses %s as %s', (source, kind) => {
    const parsed = parseLinearMath(source);
    expect(parsed).toMatchObject({ ok: true, expression: { kind } });
  });

  test('reuses bounded default parse results across validation and apply', () => {
    const parsed = parseLinearMath('{a+b}/{2}');
    expect(parseLinearMath('{a+b}/{2}')).toBe(parsed);
    expect(parseLinearMath('{a+b}/{2}', { maxNodes: 256 })).not.toBe(parsed);
  });

  test('round-trips radical degrees through reversible linear math', () => {
    const projected = projectOmmlEquation(
      equationOf(
        readDocument(
          '<m:oMath><m:rad><m:deg><m:r><m:t>3</m:t></m:r></m:deg>' +
            '<m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>'
        )
      )
    );
    expect(projected?.expression).toMatchObject({
      kind: 'radical',
      degree: { kind: 'text', value: '3' },
    });
    expect(equationExpressionToLinearMath(projected!.expression)).toBe('√[3]{x}');
    expect(parseLinearMath('√[3]{x}')).toMatchObject({
      ok: true,
      expression: {
        kind: 'radical',
        degree: { kind: 'text', value: '3' },
      },
    });
  });

  test('does not expose lossy linear text for reserved literals or arbitrary n-ary operators', () => {
    const reserved = projectOmmlEquation(
      equationOf(readDocument('<m:oMath><m:r><m:t>√{x}</m:t></m:r></m:oMath>'))
    );
    const arbitraryNary = projectOmmlEquation(
      equationOf(
        readDocument(
          '<m:oMath><m:nary><m:naryPr><m:chr m:val="∫"/>' +
            '<m:limLoc m:val="undOvr"/></m:naryPr>' +
            '<m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary></m:oMath>'
        )
      )
    );
    const unsupported = projectOmmlEquation(
      equationOf(
        readDocument('<m:oMath><m:box><m:e><m:r><m:t>x</m:t></m:r></m:e></m:box></m:oMath>')
      )
    );

    expect(equationExpressionToLinearMath(reserved!.expression)).toBe('');
    expect(equationExpressionToLinearMath(arbitraryNary!.expression)).toBe('');
    expect(equationExpressionToLinearMath(unsupported!.expression)).toBe('');
  });

  test('creates valid namespaced OMML with fresh IDs and reopens it', () => {
    const loaded = readOoxmlPart(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body>` +
        '<w:p xmlns:m="urn:hostile"><w:r><w:t>before</w:t></w:r></w:p>' +
        '</w:body></w:document>',
      metadata
    );
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.part;
    const sourceIds = new Set(allNodes(part.root).map((node) => node.id));
    const converted = linearMathToOmml(
      '{a+b}/{2}+√{x}+x^2+x_i+∑[n]{x}',
      createNodeIdAllocator(part)
    );
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;

    const generatedNodes = allNodes(converted.equation);
    const generatedIds = generatedNodes.map((node) => node.id);
    expect(new Set(generatedIds).size).toBe(generatedIds.length);
    expect(generatedIds.every((id) => !sourceIds.has(id))).toBe(true);
    const generatedNames = generatedNodes.flatMap((node) =>
      node.kind === 'textValue' ? [] : [node.localName]
    );
    expect(generatedNames).toEqual(
      expect.arrayContaining(['oMath', 'f', 'rad', 'sSup', 'sSub', 'nary'])
    );

    const paragraph = paragraphOf(part);
    const inserted = insertChildren(part, paragraph.id, paragraph.children.length, [
      converted.equation,
    ]);
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    expect(validateOoxmlPart(inserted.part).ok).toBe(true);

    const xml = serializeOoxmlPart(inserted.part);
    expect(xml).toContain('xmlns:m="urn:hostile"');
    expect(xml).toContain(`xmlns:m="${OFFICE_MATH_NAMESPACE_URI}"`);

    const reopened = readOoxmlPart(xml, metadata);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const projection = projectOmmlEquation(equationOf(reopened.part));
    expect(projection?.truncated).toBe(false);
    expect(expressionKinds(projection!.expression)).toEqual(
      expect.arrayContaining(['fraction', 'radical', 'script', 'nary'])
    );
    expect(findNode(reopened.part, equationOf(reopened.part).id)).not.toBeNull();
  });

  test('preserves boundary whitespace on generated math text', () => {
    const part = readDocument('');
    const converted = linearMathToOmml(' x ', createNodeIdAllocator(part));
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    const paragraph = paragraphOf(part);
    const inserted = insertChildren(part, paragraph.id, 0, [converted.equation]);
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;

    expect(serializeOoxmlPart(inserted.part)).toContain('<m:t xml:space="preserve"> x </m:t>');
  });

  test('refuses malformed, hostile, and XML-invalid input', () => {
    expect(parseLinearMath('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseLinearMath('x^')).toEqual({ ok: false, reason: 'invalid-syntax' });
    expect(parseLinearMath('{a}/{')).toEqual({ ok: false, reason: 'invalid-syntax' });
    expect(parseLinearMath('√x')).toEqual({ ok: false, reason: 'invalid-syntax' });
    expect(parseLinearMath('∑[]{x}')).toEqual({ ok: false, reason: 'invalid-syntax' });
    expect(parseLinearMath('a\u0000b')).toEqual({ ok: false, reason: 'invalid-xml-text' });
    expect(parseLinearMath('abcdef', { maxTextLength: 5 })).toEqual({
      ok: false,
      reason: 'text-limit',
    });
    expect(parseLinearMath(`${'{'.repeat(30)}x${'}'.repeat(30)}`, { maxDepth: 8 })).toEqual({
      ok: false,
      reason: 'depth-limit',
    });
    expect(parseLinearMath('a^ba^ba^ba^b', { maxNodes: 5 })).toEqual({
      ok: false,
      reason: 'node-limit',
    });
  });

  test('round-trips lower and upper n-ary limits through linear math', () => {
    const projected = projectOmmlEquation(
      equationOf(
        readDocument(
          '<m:oMath><m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr>' +
            '<m:sub><m:r><m:t>i=1</m:t></m:r></m:sub>' +
            '<m:sup><m:r><m:t>n</m:t></m:r></m:sup>' +
            '<m:e><m:r><m:t>i</m:t></m:r></m:e></m:nary></m:oMath>'
        )
      )
    );
    if (!projected) throw new Error('missing projection');
    const linear = equationExpressionToLinearMath(projected.expression);
    expect(linear).toBe('∑[i=1]^[n]{i}');
    expect(parseLinearMath(linear)).toMatchObject({
      ok: true,
      expression: {
        kind: 'nary',
        lowerLimit: { kind: 'text', value: 'i=1' },
        upperLimit: { kind: 'text', value: 'n' },
      },
    });
  });
});
