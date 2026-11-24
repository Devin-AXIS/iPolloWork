// Bounded XML reader tests (document-engine task 2.4): DTD/entity rejection,
// order/attribute/whitespace preservation, and no value coercion.

import { describe, expect, test } from 'bun:test';
import {
  readXml,
  XML_DEFAULT_MAX_ELEMENTS,
  findElement,
  childElements,
  textContent,
  requireXmlStringScalar,
} from '../package/xml-reader.ts';

describe('trust boundary rejections', () => {
  test('refuses DTDs, entity declarations, and custom entity refs', () => {
    expect(readXml('<!DOCTYPE x><x/>')).toMatchObject({ ok: false, reason: 'dtd-forbidden' });
    expect(readXml('<!ENTITY lol "z"><x/>')).toMatchObject({
      ok: false,
      reason: 'entity-forbidden',
    });
    // Billion-laughs style reference to a custom entity.
    expect(readXml('<x>&lol;</x>')).toMatchObject({ ok: false, reason: 'entity-forbidden' });
    // The five predefined entities are allowed.
    expect(readXml('<x>a &amp; b</x>').ok).toBe(true);
  });
  test('enforces a size bound', () => {
    expect(readXml('<x/>', { maxBytes: 2 })).toMatchObject({ ok: false, reason: 'too-large' });
  });
  test('enforces an element-count bound', () => {
    expect(readXml('<x><a/><b/></x>', { maxBytes: 100, maxElements: 3 }).ok).toBe(true);
    expect(readXml('<x><a/><b/></x>', { maxBytes: 100, maxElements: 2 })).toMatchObject({
      ok: false,
      reason: 'too-many-elements',
    });
  });
  test('honors an element budget above the default before parser allocation', () => {
    // Intentionally malformed: distinguish the element preflight from XML validation
    // without allocating millions of parsed nodes in the test process.
    const xml = '<x>' + '<a/>'.repeat(XML_DEFAULT_MAX_ELEMENTS) + '</x><unclosed';
    expect(readXml(xml)).toMatchObject({ ok: false, reason: 'too-many-elements' });
    expect(
      readXml(xml, { maxBytes: xml.length, maxElements: XML_DEFAULT_MAX_ELEMENTS + 2 })
    ).toMatchObject({ ok: false, reason: 'parse-error' });
  });
  test('counts elements before parser allocation and before full XML validation', () => {
    expect(readXml('<x><a/><b/><unclosed', { maxBytes: 100, maxElements: 2 })).toMatchObject({
      ok: false,
      reason: 'too-many-elements',
    });
  });
  test('rejects NaN and non-finite configured limits', () => {
    expect(readXml('<x/>', { maxBytes: Number.NaN })).toMatchObject({
      ok: false,
      reason: 'invalid-limits',
    });
    expect(readXml('<x/>', { maxBytes: Number.POSITIVE_INFINITY })).toMatchObject({
      ok: false,
      reason: 'invalid-limits',
    });
    expect(readXml('<x/>', { maxBytes: 100, maxElements: Number.NaN })).toMatchObject({
      ok: false,
      reason: 'invalid-limits',
    });
    expect(readXml('<x/>', { maxBytes: 100, maxElements: Number.NEGATIVE_INFINITY })).toMatchObject(
      { ok: false, reason: 'invalid-limits' }
    );
  });

  test('rejects decoded numeric references forbidden by XML 1.0', () => {
    for (const reference of [
      '&#0;',
      '&#1;',
      '&#x8;',
      '&#xB;',
      '&#xC;',
      '&#xD800;',
      '&#xFFFE;',
      '&#xFFFF;',
      '&#x110000;',
      '&#999999999999999999999999;',
    ]) {
      expect(readXml(`<x>${reference}</x>`)).toMatchObject({
        ok: false,
        reason: 'parse-error',
      });
      expect(readXml(`<x a="${reference}"/>`)).toMatchObject({
        ok: false,
        reason: 'parse-error',
      });
    }
  });

  test('rejects literal XML 1.0-invalid characters in every value context', () => {
    for (const invalid of ['\u0000', '\uFFFE', '\uFFFF', '\uD800', '\uDC00']) {
      expect(readXml(`<x>${invalid}</x>`)).toMatchObject({
        ok: false,
        reason: 'parse-error',
      });
      expect(readXml(`<x a="${invalid}"/>`)).toMatchObject({
        ok: false,
        reason: 'parse-error',
      });
      expect(readXml(`<x><![CDATA[${invalid}]]></x>`)).toMatchObject({
        ok: false,
        reason: 'parse-error',
      });
    }
  });

  test('measures maxBytes as UTF-8 bytes rather than UTF-16 code units', () => {
    const xml = '<x>é</x>';
    expect(xml.length).toBe(8);
    expect(readXml(xml, { maxBytes: 8 })).toMatchObject({
      ok: false,
      reason: 'too-large',
    });
    expect(readXml(xml, { maxBytes: 9 }).ok).toBe(true);
  });
});

describe('fidelity preservation', () => {
  test('preserves significant child order', () => {
    const r = readXml('<p><a/><b/><a/></p>');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = findElement(r.nodes, 'p')!;
    expect(
      p.children.filter((c) => c.type === 'element').map((c) => (c as { name: string }).name)
    ).toEqual(['a', 'b', 'a']);
  });

  test('preserves attributes and raw lexical values without coercion', () => {
    const r = readXml('<w:t w:space="preserve" n="007" b="true">0042</w:t>');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = findElement(r.nodes, 'w:t')!;
    // Zero-padded / boolean-looking attribute values stay strings, verbatim.
    expect(t.attributes).toEqual({ 'w:space': 'preserve', n: '007', b: 'true' });
    expect(Object.getPrototypeOf(t.attributes)).toBeNull();
    expect(textContent(t)).toBe('0042'); // not coerced to number 42
  });

  test('preserves significant whitespace in text', () => {
    const r = readXml('<w:t>  spaced  </w:t>');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(textContent(findElement(r.nodes, 'w:t')!)).toBe('  spaced  ');
  });

  test('reads a wordprocessing paragraph structure', () => {
    const xml =
      '<w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t> world</w:t></w:r></w:p></w:body>';
    const r = readXml(xml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const body = findElement(r.nodes, 'w:body')!;
    const paras = childElements(body, 'w:p');
    expect(paras).toHaveLength(1);
    expect(textContent(paras[0])).toBe('Hello world');
  });

  test('preserves valid supplementary numeric references', () => {
    const result = readXml('<x>&#x1F600;</x>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(textContent(findElement(result.nodes, 'x')!)).toBe('😀');
  });

  test('treats numeric-reference spelling inside CDATA as literal text', () => {
    const result = readXml('<x><![CDATA[&#0; &lol; <!DOCTYPE x>]]></x>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(textContent(findElement(result.nodes, 'x')!)).toBe('&#0; &lol; <!DOCTYPE x>');
    expect(readXml('<x>&#0;</x>')).toMatchObject({
      ok: false,
      reason: 'parse-error',
    });
  });

  test('requireXmlStringScalar fails closed on non-string text/CDATA/attribute values', () => {
    expect(requireXmlStringScalar('ok', 'text')).toBe('ok');
    expect(() => requireXmlStringScalar({} as unknown, 'text')).toThrow(/non-scalar text/);
    expect(() => requireXmlStringScalar(42 as unknown, 'cdata')).toThrow(/non-scalar cdata/);
    expect(() => requireXmlStringScalar(['x'] as unknown, 'attribute')).toThrow(
      /non-scalar attribute/
    );
  });
});
