import { describe, expect, test } from 'bun:test';
import type { OoxmlPackage } from '../../ooxml-package.ts';
import { freePartName } from '../package.ts';

/** A package stand-in with only the part maps that the name search reads. */
function packageWithParts(names: readonly string[]): OoxmlPackage {
  const parts = new Map(names.map((name) => [name, {}]));
  return { parts, partBytes: new Map() } as unknown as OoxmlPackage;
}

describe('freePartName', () => {
  test('skips OPC-equivalent names in a package with many parts', () => {
    const names = Array.from({ length: 2000 }, (_, i) => `/word/charts/chart${i + 1}.xml`);
    names.push('word/charts/CHART2001.xml');
    const pkg = packageWithParts(names);
    expect(freePartName(pkg, '/word/charts/chart', '.xml')).toBe('/word/charts/chart2002.xml');
  });

  test('treats reserved names as taken', () => {
    const pkg = packageWithParts(['/word/charts/chart1.xml']);
    const reserved = new Set(['/word/charts/chart2.xml']);
    expect(freePartName(pkg, '/word/charts/chart', '.xml', undefined, reserved)).toBe(
      '/word/charts/chart3.xml'
    );
  });
});
