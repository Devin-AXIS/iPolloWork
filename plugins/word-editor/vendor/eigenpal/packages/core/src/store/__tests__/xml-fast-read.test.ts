// The one-pass XML reader against the bounded reader. Whatever it accepts, the bounded reader
// accepts with the same tree; whatever is outside its subset, it hands back.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { fastReadXml } from '../package/xml-fast-read.ts';
import { readXml, readXmlBounded, type XmlNode } from '../package/xml-reader.ts';

const BUDGET = 1_000_000;

/** The tree with attribute order spelled out, so an order change is a difference. */
function shape(nodes: readonly XmlNode[] | null): unknown {
  if (nodes === null) return null;
  return nodes.map((node) =>
    node.type === 'text'
      ? ['text', node.value]
      : [node.name, Object.entries(node.attributes), shape(node.children)]
  );
}

/** The fast read, held to the bounded read: same tree when accepted. */
function agrees(xml: string): readonly XmlNode[] | null {
  const fast = fastReadXml(xml, BUDGET);
  if (fast !== null) {
    const bounded = readXmlBounded(xml);
    expect(bounded.ok).toBe(true);
    if (bounded.ok) expect(shape(fast)).toEqual(shape(bounded.nodes));
    for (const node of fast)
      if (node.type === 'element') expect(Object.getPrototypeOf(node.attributes)).toBeNull();
  }
  return fast;
}

describe('accepted subset', () => {
  const accepted = [
    '<a/>',
    '<a />',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document xmlns:w="u"><w:body/></w:document>',
    "<a b='1' c=\"it's\"/>",
    '<a b = "1"\n\tc="2"></a >',
    '<a>  </a>',
    '<a>x &amp; y &lt;&gt;&quot;&apos; &#65;&#x42;</a>',
    '<a b="&amp;&#x41;">t</a>',
    '<a>line\r\nnext\rlast</a>',
    '<a b="x\r\ny\tz">q</a>',
    '<a b="1 > 0">gt > here</a>',
    '<a:b c:d="1" xmlns:a="x" xmlns:c="y"><e.f-g_h/></a:b>',
    '<r><t xml:space="preserve"> lead</t><t>mid</t>tail</r>',
    '\n  <a/>\n  ',
  ];
  for (const xml of accepted) {
    test(JSON.stringify(xml), () => {
      expect(agrees(xml)).not.toBeNull();
    });
  }
});

describe('shared attribute records', () => {
  test('equal attribute text reads to one frozen record; other text to its own', () => {
    const nodes = agrees('<a><b x="1" y="2"/><c x="1" y="2"/><b x="1"  y="2"/></a>')!;
    const root = nodes[0] as Extract<XmlNode, { type: 'element' }>;
    const [first, second, third] = root.children as Extract<XmlNode, { type: 'element' }>[];
    expect(first!.attributes).toBe(second!.attributes);
    expect(Object.isFrozen(first!.attributes)).toBe(true);
    expect(third!.attributes).not.toBe(first!.attributes);
    expect(Object.entries(third!.attributes)).toEqual(Object.entries(first!.attributes));
  });
});

describe('handed back to the bounded reader', () => {
  const declined = [
    '﻿<a/>',
    '<!DOCTYPE a><a/>',
    '<a><!-- c --></a>',
    '<a><![CDATA[x]]></a>',
    '<a><?pi x?></a>',
    '<?xml version="1.0"?><?other?><a/>',
    '<a>&lol;</a>',
    '<a>& b</a>',
    '<a>&#;</a>',
    '<a>&#X41;</a>',
    '<a>&#1;</a>',
    '<a b="&lol;"/>',
    '<a b="<"/>',
    '<a b="1"c="2"/>',
    '<a b="1" b="2"/>',
    '<a b/>',
    '<a b=1/>',
    '<a/ >',
    '<a></b>',
    '<a>',
    '<a/><b/>',
    'x<a/>',
    '<a/>x',
    '<é/>',
    '<a é="1"/>',
    '<constructor/>',
    '<__proto__/>',
    '<toString/>',
    '<a>\u0001</a>',
    '<a b="￿"/>',
    '<' + 'a>'.repeat(91) + '</a>'.repeat(91),
  ];
  for (const xml of declined) {
    test(JSON.stringify(xml.slice(0, 40)), () => {
      expect(fastReadXml(xml, BUDGET)).toBeNull();
    });
  }

  test('an element budget the tags may exceed', () => {
    // Four tags, three elements: the tag count decides, before any node is built.
    expect(fastReadXml('<a><b/><c/></a>', 4)).not.toBeNull();
    expect(fastReadXml('<a><b/><c/></a>', 3)).toBeNull();
    expect(readXml('<a><b/><c/></a>', { maxBytes: 100, maxElements: 3 }).ok).toBe(true);
    expect(readXml('<a><b/><c/></a>', { maxBytes: 100, maxElements: 2 })).toMatchObject({
      ok: false,
      reason: 'too-many-elements',
    });
  });
});

describe('mutations of a part', () => {
  // A deterministic generator, so a failure reproduces.
  let seed = 0x2545f491;
  const random = (n: number) => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % n;
  };
  const base =
    '<?xml version="1.0" standalone="yes"?>\n<w:document xmlns:w="u" xmlns:r="v">' +
    '<w:body><w:p w:rsidR="00A1"><w:pPr><w:jc w:val="center"/></w:pPr>' +
    '<w:r><w:t xml:space="preserve"> a &amp; b </w:t></w:r></w:p>' +
    "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>c'd</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" +
    '</w:body></w:document>';
  const pieces = ['<', '>', '/', '"', "'", '=', '&', ';', ' ', '\r', '!', '?', 'w:', 'x', '#'];

  test('never accepts what the bounded reader refuses, and agrees on what it accepts', () => {
    let accepted = 0;
    for (let round = 0; round < 4000; round += 1) {
      let xml = base;
      for (let edits = 1 + random(3); edits > 0; edits -= 1) {
        const at = random(xml.length);
        const kind = random(3);
        if (kind === 0) xml = xml.slice(0, at) + xml.slice(at + 1);
        else if (kind === 1) xml = xml.slice(0, at) + pieces[random(pieces.length)] + xml.slice(at);
        else xml = xml.slice(0, at) + pieces[random(pieces.length)] + xml.slice(at + 1);
      }
      if (agrees(xml) !== null) accepted += 1;
    }
    // Both outcomes occur, so the comparison is not vacuous.
    expect(accepted).toBeGreaterThan(100);
    expect(accepted).toBeLessThan(4000);
  });
});

describe('fixture parts', () => {
  const fixtures = join(import.meta.dir, '../../../../../e2e/fixtures');
  test('read the same tree from every XML part of every fixture', () => {
    let fast = 0;
    for (const file of readdirSync(fixtures).filter((name) => name.endsWith('.docx'))) {
      const entries = unzipSync(new Uint8Array(readFileSync(join(fixtures, file))));
      for (const [name, bytes] of Object.entries(entries)) {
        if (!/\.(xml|rels)$/i.test(name)) continue;
        const offset = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
        if (agrees(strFromU8(bytes.subarray(offset))) !== null) fast += 1;
      }
    }
    expect(fast).toBeGreaterThan(1000);
  });
});
