// XML serialization name-safety tests (document-engine task 3.5).

import { describe, expect, test } from 'bun:test';
import { isValidQName, assertValidQName, PrefixAllocator, escapeXml } from '../index.ts';

describe('QName validation', () => {
  test('accepts valid element/attribute QNames', () => {
    for (const ok of ['w:document', 'w:p', 'Types', 'w:rFonts', 'a_b-c.d'])
      expect(isValidQName(ok)).toBe(true);
  });
  test('rejects injection / malformed names', () => {
    for (const bad of ['w:p><x', 'a:b:c', '1abc', 'w:', ':local', 'has space', 'a"b', '']) {
      expect(isValidQName(bad)).toBe(false);
    }
    expect(() => assertValidQName('</w:t>')).toThrow(/invalid QName/);
  });
  test('attacker-derived names are never emitted; values are escaped instead', () => {
    // A malicious "tag name" from a file is escaped as a VALUE, never used as a name.
    expect(escapeXml('</w:t><w:evil/>')).toBe('&lt;/w:t&gt;&lt;w:evil/&gt;');
  });
});

describe('controlled prefix allocation', () => {
  test('known URIs keep their prefix; new URIs get deterministic ns{n}', () => {
    const alloc = new PrefixAllocator({
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main': 'w',
    });
    expect(alloc.prefixFor('http://schemas.openxmlformats.org/wordprocessingml/2006/main')).toBe(
      'w'
    );
    const p1 = alloc.prefixFor('urn:custom:one');
    const p2 = alloc.prefixFor('urn:custom:two');
    expect(p1).not.toBe(p2);
    expect(alloc.prefixFor('urn:custom:one')).toBe(p1); // stable
    // Never collides with a registered prefix.
    expect([p1, p2]).not.toContain('w');
  });
  test('bindings are emittable as xmlns declarations', () => {
    const alloc = new PrefixAllocator();
    alloc.prefixFor('urn:x');
    expect(alloc.bindings()).toEqual([{ prefix: 'ns1', uri: 'urn:x' }]);
  });
});
