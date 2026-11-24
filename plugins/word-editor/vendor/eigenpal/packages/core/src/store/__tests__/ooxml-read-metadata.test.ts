import { describe, expect, test } from 'bun:test';
import { OoxmlReadMetadata } from '../package/ooxml-read-metadata.ts';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlAttribute,
  type OoxmlElement,
} from '../package/ooxml-tree.ts';

const metadata = { name: '/word/document.xml', contentType: 'application/xml' };
function parse(xml: string): OoxmlElement {
  const result = readOoxmlPart(xml, metadata);
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}
function attributes(value: string): readonly OoxmlAttribute[] {
  return [{ kind: 'genericExtension', namespaceUri: '', localName: 'value', value }];
}

describe('immutable metadata during OOXML reads', () => {
  test('shares repeated metadata but retains distinct node identities and source content', () => {
    const xml = '<root>' + '<item value="same"/>'.repeat(500) + '</root>';
    const root = parse(xml);
    const children = root.children as readonly OoxmlElement[];
    expect(new Set(children.map((node) => node.attributes)).size).toBe(1);
    expect(new Set(children.map((node) => node.namespaceBindings)).size).toBe(1);
    expect(new Set(children.map((node) => node.children)).size).toBe(1);
    expect(new Set(children.map((node) => node.id)).size).toBe(500);
    expect(new Set(children).size).toBe(500);
    expect(Object.isFrozen(children[0]!.attributes)).toBe(true);
    expect(Object.isFrozen(children[0]!.attributes[0])).toBe(true);
    expect(Object.isFrozen(children[0]!.children)).toBe(true);
    const part = { ...metadata, id: `part:${metadata.name}`, root };
    const saved = serializeOoxmlPart(part);
    const reopened = readOoxmlPart(saved, metadata);
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(part));
  });

  test('keeps namespace bindings, prefixes, values, and attribute order distinct', () => {
    const root = parse(
      '<root xmlns:a="urn:first" xmlns:b="urn:first">' +
        '<item a:value="one"/><item b:value="one"/>' +
        '<item xmlns:a="urn:second" a:value="one"/>' +
        '<item a:value="two"/><item x="1" y="2"/><item y="2" x="1"/>' +
        '</root>'
    );
    const children = root.children as readonly OoxmlElement[];
    expect(new Set(children.map((node) => node.attributes)).size).toBe(6);
    expect(children[2]!.attributes[0]!.namespaceUri).toBe('urn:second');
    expect(children[2]!.namespaceBindings).toEqual([{ prefix: 'a', namespaceUri: 'urn:second' }]);
    expect(children[5]!.attributes.map((attribute) => attribute.localName)).toEqual(['y', 'x']);
  });

  test('does not confuse delimiter-like values or prototype property names', () => {
    const pool = new OoxmlReadMetadata();
    const values = ['__proto__', 'constructor', 'prototype', 'a","value":"b', '1:a2:bc', '😀'];
    const shared = values.map((value) => pool.shareAttributes(attributes(value)));
    expect(shared.map((items) => items[0]!.value)).toEqual(values);
    expect(new Set(shared).size).toBe(values.length);
  });

  test('evicts unique metadata and keeps the cache local to one read', () => {
    const pool = new OoxmlReadMetadata();
    const first = pool.shareAttributes(attributes('first'));
    for (let index = 0; index < 3_000; index++) {
      pool.shareAttributes(attributes(String(index)));
    }
    expect(pool.shareAttributes(attributes('first'))).not.toBe(first);
    const recent = pool.shareAttributes(attributes('recent'));
    expect(pool.shareAttributes(attributes('recent'))).toBe(recent);
    expect(new OoxmlReadMetadata().shareAttributes(attributes('recent'))).not.toBe(recent);
  });

  test('bounds retained key bytes, including a single oversized value', () => {
    const pool = new OoxmlReadMetadata();
    const first = pool.shareAttributes(attributes('first'));
    const value = 'x'.repeat(64 * 1024);
    for (let index = 0; index < 16; index++) {
      pool.shareAttributes(attributes(value + index));
    }
    expect(pool.shareAttributes(attributes('first'))).not.toBe(first);
    const oversized = attributes('x'.repeat(1024 * 1024));
    expect(pool.shareAttributes(oversized)).toBe(oversized);
    expect(pool.shareAttributes(attributes(oversized[0]!.value))).not.toBe(oversized);
  });
});
