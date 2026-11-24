// The stepped part read must produce exactly the one-shot read's answer: the same tree, ids
// included, for every part of every fixture document, and the same rejection for hostile and
// malformed input. The body is cut every few hundred characters here, so the fixtures cross
// many cut points.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { readOoxmlPart, type OoxmlReadResult } from '../package/ooxml-tree.ts';
import { readOoxmlPartSteps, setSteppedPartReadForTest } from '../package/ooxml-part-steps.ts';

const FIXTURES = join(import.meta.dir, '../../../../../e2e/fixtures');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const metadata = { name: '/word/document.xml', contentType: 'application/xml' } as const;

let restore: () => void = () => {};
beforeAll(() => {
  restore = setSteppedPartReadForTest(0, 300);
});
afterAll(() => restore());

function stepped(xml: string, name = metadata.name): { result: OoxmlReadResult; steps: number } {
  const reader = readOoxmlPartSteps(xml, { ...metadata, name });
  let steps = 0;
  for (;;) {
    const next = reader.next();
    if (next.done) return { result: next.value, steps };
    steps += 1;
  }
}

function expectSameRead(xml: string, name = metadata.name): number {
  const once = readOoxmlPart(xml, { ...metadata, name });
  const { result, steps } = stepped(xml, name);
  expect(result.ok).toBe(once.ok);
  if (!once.ok || !result.ok) {
    expect(result).toEqual(once);
    return steps;
  }
  expect(result.part).toEqual(once.part);
  expect(Object.isFrozen(result.part.root)).toBe(true);
  return steps;
}

describe('stepped part read', () => {
  test('every XML part of every fixture reads to the same tree', () => {
    let parts = 0;
    let longSteps = 0;
    for (const file of readdirSync(FIXTURES).filter((name) => name.endsWith('.docx'))) {
      const entries = unzipSync(new Uint8Array(readFileSync(join(FIXTURES, file))));
      for (const [name, bytes] of Object.entries(entries)) {
        if (!name.endsWith('.xml')) continue;
        parts += 1;
        const steps = expectSameRead(strFromU8(bytes), `/${name}`);
        if (name === 'word/document.xml') longSteps = Math.max(longSteps, steps);
      }
    }
    expect(parts).toBeGreaterThan(500);
    // The body was cut into many runs, so the cut points were exercised.
    expect(longSteps).toBeGreaterThan(50);
  }, 120_000);

  const doc = (body: string, rootExtra = '') =>
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"${rootExtra}>${body}</w:document>`;
  const paragraphs = (count: number) =>
    Array.from({ length: count }, (_, index) => `<w:p><w:r><w:t>p${index}</w:t></w:r></w:p>`).join(
      ''
    );

  const cases: Record<string, string> = {
    'plain body': doc(`<w:body>${paragraphs(80)}<w:sectPr/></w:body>`),
    'whitespace between blocks': doc(
      `<w:body>\n  ${paragraphs(40).replaceAll('</w:p>', '</w:p>\n  ')}</w:body>`
    ),
    'text directly in the body': doc(
      `<w:body>${paragraphs(40)}stray text${paragraphs(40)}</w:body>`
    ),
    'element before and after the body': doc(
      `<w:background w:color="FFFFFF"/><w:body>${paragraphs(60)}</w:body><w:extra/>`
    ),
    'comments, processing instructions and CDATA': doc(
      `<w:body>${paragraphs(30)}<!-- <w:body> --><?pi <w:p> ?>${paragraphs(30)}<w:p><w:r><w:t><![CDATA[</w:body>]]></w:t></w:r></w:p></w:body>`
    ),
    'attribute values holding a greater-than sign': doc(
      `<w:body>${paragraphs(30)}<w:p w:rsidR="a>b" w:x='c>d'/>${paragraphs(30)}</w:body>`
    ),
    'a self-closing body': doc('<w:body/>'),
    'no body': doc(paragraphs(40)),
    'a nested body name': doc(
      `<w:body>${paragraphs(30)}<w:p><w:body/></w:p>${paragraphs(30)}</w:body>`
    ),
    'a mismatched end tag': doc(`<w:body>${paragraphs(30)}<w:p></w:r>${paragraphs(30)}</w:body>`),
    'an unclosed element': doc(`<w:body>${paragraphs(30)}<w:p>${paragraphs(30)}</w:body>`),
    'an undeclared prefix': doc(`<w:body>${paragraphs(30)}<x:p/>${paragraphs(30)}</w:body>`),
    'a duplicate attribute through two prefixes': doc(
      `<w:body>${paragraphs(30)}<w:p xmlns:a="urn:s" xmlns:b="urn:s" a:i="1" b:i="2"/>${paragraphs(30)}</w:body>`
    ),
    'a namespace declared on the body': doc(
      `<w:body xmlns:x="urn:x">${paragraphs(30)}<x:p/>${paragraphs(30)}</w:body>`
    ),
    'xml:space preserve on the body': doc(
      `<w:body xml:space="preserve">${paragraphs(30)}   ${paragraphs(30)}</w:body>`
    ),
    'a document type declaration': `<!DOCTYPE x [<!ENTITY a "b">]>${doc(`<w:body>${paragraphs(40)}</w:body>`)}`,
    'two roots': doc(`<w:body>${paragraphs(40)}</w:body>`) + '<w:document/>',
    'a long table': doc(
      `<w:body><w:tbl>${Array.from({ length: 200 }, (_, index) => `<w:tr><w:tc><w:p><w:r><w:t>r${index}</w:t></w:r></w:p></w:tc></w:tr>`).join('')}</w:tbl></w:body>`
    ),
    'drawing kinds demoted under a generic host': doc(
      `<w:body>${paragraphs(30)}<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"/></w:drawing></w:r></w:p>${paragraphs(30)}</w:body>`
    ),
  };
  for (const [name, xml] of Object.entries(cases)) {
    test(`same answer for ${name}`, () => {
      expectSameRead(xml);
    });
  }

  test('random edits of a real document get the same answer from both reads', () => {
    // Malformed input must be rejected exactly when the one-shot read rejects it. Each edit
    // inserts or deletes markup somewhere in the body; the cuts every 300 characters put many
    // of them right at, or inside, a cut.
    const entries = unzipSync(
      new Uint8Array(readFileSync(join(FIXTURES, 'float-wrap-comprehensive-test.docx')))
    );
    const original = strFromU8(entries['word/document.xml']!);
    let seed = 1234567;
    const random = (limit: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % limit;
    };
    const inserts = [
      '<',
      '>',
      '"',
      "'",
      '&',
      '/',
      '</w:p>',
      '<w:p>',
      '<w:r/>',
      ']]>',
      '<!--',
      '-->',
      '<?xml version="1.0"?>',
      '<![CDATA[',
      'x',
    ];
    let rejected = 0;
    for (let edit = 0; edit < 240; edit += 1) {
      const at = random(original.length);
      const xml =
        edit % 3 === 0
          ? original.slice(0, at) + original.slice(at + 1 + random(4))
          : original.slice(0, at) + inserts[random(inserts.length)]! + original.slice(at);
      const once = readOoxmlPart(xml, metadata);
      if (!once.ok) rejected += 1;
      expectSameRead(xml);
    }
    // Most edits break the document, so the rejection paths were the ones exercised.
    expect(rejected).toBeGreaterThan(100);
  }, 120_000);
});
