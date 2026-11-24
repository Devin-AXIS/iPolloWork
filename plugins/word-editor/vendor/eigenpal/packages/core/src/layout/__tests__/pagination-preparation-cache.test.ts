import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { hiddenStyleSeparatorMark } from '../style-separator-flow.ts';
import { keepNextFlowKeys } from '../pagination-keeps.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function paragraph(mark = ''): OoxmlElement {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:pStyle w:val="Body"/><w:rPr>${mark}</w:rPr></w:pPr><w:r><w:t>Text</w:t></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const body = parsed.part.root.children[0];
  if (body?.kind !== 'body') throw new Error('Missing body');
  const result = body.children[0];
  if (result?.kind !== 'paragraph') throw new Error('Missing paragraph');
  return result;
}
function styles(mark: string) {
  const parsed = readOoxmlPart(
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Body"><w:rPr>${mark}</w:rPr></w:style></w:styles>`,
    { name: '/word/styles.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return buildStyleCascadeTable(parsed.part.root);
}

test('unchanged paragraphs reuse both separator classifications without style lookups', () => {
  const cascade = styles('<w:vanish/>');
  const definitions = new Map(cascade.styles);
  let reads = 0;
  const get = definitions.get.bind(definitions);
  definitions.get = (key) => {
    reads += 1;
    return get(key);
  };
  const observed = { ...cascade, styles: definitions };
  const node = paragraph();
  expect(hiddenStyleSeparatorMark(node, observed)).toBe(false);
  expect(reads).toBeGreaterThan(0);
  const other = styles('');
  expect(hiddenStyleSeparatorMark(node, other)).toBe(false);
  expect(hiddenStyleSeparatorMark(node)).toBe(false);
  reads = 0;
  for (let i = 0; i < 100; i += 1) {
    expect(hiddenStyleSeparatorMark(node)).toBe(false);
    expect(hiddenStyleSeparatorMark(node, other)).toBe(false);
    expect(hiddenStyleSeparatorMark(node, observed, false)).toBe(true);
    expect(hiddenStyleSeparatorMark(node, observed)).toBe(false);
  }
  expect(reads).toBe(0);
});

test('separator classification invalidates for styles and direct mark changes', () => {
  const node = paragraph();
  const hidden = styles('<w:vanish/><w:specVanish/>');
  const visible = styles('');
  expect(hiddenStyleSeparatorMark(node, hidden)).toBe(true);
  expect(hiddenStyleSeparatorMark(node, visible)).toBe(false);
  expect(hiddenStyleSeparatorMark(node, hidden)).toBe(true);
  expect(hiddenStyleSeparatorMark(node)).toBe(false);
  expect(hiddenStyleSeparatorMark(paragraph('<w:vanish w:val="0"/>'), hidden)).toBe(false);
  expect(hiddenStyleSeparatorMark(paragraph('<w:vanish/><w:specVanish/>'))).toBe(true);
});

test('ordinary flow does not read key text to construct unused keep digests', () => {
  const keys = Array.from({ length: 1000 }, () => 'x'.repeat(1024));
  let reads = 0;
  const observed = new Proxy(keys, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  expect(keepNextFlowKeys(observed, () => false)).toBe(observed);
  expect(reads).toBe(0);
});

test('a short keep chain does not digest unrelated paragraph keys', () => {
  const keys = Array.from({ length: 1000 }, (_, i) => `${i}:` + 'x'.repeat(1024));
  let unrelatedReads = 0;
  const observed = new Proxy(keys, {
    get(target, key, receiver) {
      if (key === '900') unrelatedReads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  const kept = (i: number) => i === 2;
  const flow = keepNextFlowKeys(observed, kept);
  // The returned array copies this key once. It needs no dependency digest.
  expect(unrelatedReads).toBe(1);
  expect(flow[2]).not.toBe(keys[2]);
  const changed = [...keys];
  changed[900] = 'unrelated change';
  expect(keepNextFlowKeys(changed, kept)[2]).toBe(flow[2]);
  changed[3] = 'kept successor change';
  expect(keepNextFlowKeys(changed, kept)[2]).not.toBe(flow[2]);
});
