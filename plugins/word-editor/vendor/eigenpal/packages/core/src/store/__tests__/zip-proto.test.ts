// A part name whose segment is a dangerous object key (__proto__/constructor/prototype)
// is rejected at the OPC name boundary — fail closed — so it is never silently dropped,
// never crashes the zip writer, and never pollutes Object.prototype.
import { describe, expect, test } from 'bun:test';
import { writeZip } from '../package/zip.ts';
import { normalizePartName } from '../package/opc-names.ts';

describe('dangerous part-name keys fail closed', () => {
  test('normalizePartName rejects __proto__ / constructor / prototype segments', () => {
    for (const n of ['/__proto__', '/word/constructor', '/prototype']) {
      const r = normalizePartName(n);
      expect(r.ok).toBe(false);
    }
    expect(normalizePartName('/word/document.xml').ok).toBe(true);
  });

  test('writeZip fails closed on such a part and does not pollute Object.prototype', () => {
    expect(() =>
      writeZip(
        new Map([
          ['/word/document.xml', new Uint8Array([1])],
          ['/__proto__', new Uint8Array([9])],
        ])
      )
    ).toThrow(/unsafe part name/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
