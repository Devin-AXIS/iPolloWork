// Copy-side degrade tiers (rich-clipboard-fidelity 3.5): over budget, media leaves the
// fragment first; still over, the fragment attribute drops — and the interop HTML plus
// plain text always ship.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  extractFragmentPackage,
  readOoxmlPackage,
  type FragmentCoverage,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { RICH_CLIPBOARD_FIXTURE } from '../../store/__tests__/clipboard-fragment-fixtures.ts';
import { paragraphLength } from '../../store/store/tree-op-segments.ts';
import { buildCopyFlavours } from '../clipboard-copy-payload.ts';
import { fragmentFromHtml } from '../clipboard-fragment-codec.ts';

const SAMPLE = RICH_CLIPBOARD_FIXTURE;

function samplePackage(): OoxmlPackage {
  const result = readOoxmlPackage(new Uint8Array(readFileSync(SAMPLE)));
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

function fullBodyCoverage(pkg: OoxmlPackage): FragmentCoverage {
  const part = pkg.parts.get(pkg.mainDocumentPart)!;
  const body = (part.root as { children: readonly unknown[] }).children.find(
    (child) => (child as { kind: string }).kind === 'body'
  ) as { children: readonly unknown[] };
  const ids: string[] = [];
  const fullBlocks: string[] = [];
  const walk = (node: unknown, collect: boolean): void => {
    const typed = node as { kind: string; id: string; children?: readonly unknown[] };
    if (typed.kind === 'textValue') return;
    if (typed.kind === 'paragraph') ids.push(typed.id);
    if (collect && (typed.kind === 'table' || typed.kind === 'contentControl')) {
      fullBlocks.push(typed.id);
      for (const child of typed.children ?? []) walk(child, false);
      return;
    }
    for (const child of typed.children ?? []) walk(child, collect);
  };
  for (const child of body.children) walk(child, true);
  let last: unknown = null;
  const findLast = (node: unknown): void => {
    const typed = node as { kind: string; id: string; children?: readonly unknown[] };
    if (typed.kind === 'textValue') return;
    if (typed.kind === 'paragraph' && typed.id === ids[ids.length - 1]) last = node;
    for (const child of typed.children ?? []) findLast(child);
  };
  findLast(part.root);
  return {
    partName: part.name,
    paragraphIds: ids,
    startOffset: 0,
    endOffset: paragraphLength(last as never),
    coveredParagraphIds: ids,
    fullyCoveredBlockIds: fullBlocks,
    lastMarkCovered: true,
  };
}

describe('copy degrade tiers', () => {
  const pkg = samplePackage();
  const coverage = fullBodyCoverage(pkg);
  const input = { text: 'whole document', cellRectangle: false, coverage, pkg };

  test('inside the budget, the fragment travels with its media', () => {
    const flavours = buildCopyFlavours(input);
    expect(flavours.html).not.toBeNull();
    const fragment = fragmentFromHtml(flavours.html!);
    expect(fragment).not.toBeNull();
    const read = readOoxmlPackage(fragment!.bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect([...read.package.partBytes.keys()].some((name) => name.includes('/media/'))).toBe(true);
  });

  test('tier 1: over budget, the media leaves the fragment', () => {
    // The sample's media dominates the zip, so a budget under the full size but over the
    // lean size forces exactly the first tier.
    const full = fragmentFromHtml(buildCopyFlavours(input).html!)!;
    const flavours = buildCopyFlavours({
      ...input,
      maxFragmentBytes: full.bytes.byteLength - 1,
    });
    expect(flavours.html).not.toBeNull();
    const fragment = fragmentFromHtml(flavours.html!);
    expect(fragment).not.toBeNull();
    expect(fragment!.bytes.byteLength).toBeLessThan(full.bytes.byteLength);
    const read = readOoxmlPackage(fragment!.bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect([...read.package.partBytes.keys()].some((name) => name.includes('/media/'))).toBe(false);
  });

  test('tier 2: still over budget, the fragment drops and the HTML ships anyway', () => {
    const flavours = buildCopyFlavours({ ...input, maxFragmentBytes: 16 });
    expect(flavours.text).toBe('whole document');
    expect(flavours.html).not.toBeNull();
    expect(fragmentFromHtml(flavours.html!)).toBeNull();
    expect(flavours.html).toContain('<table');
    expect(flavours.html).toContain('<ol');
    expect(flavours.html).toContain('font-weight:bold');
  });

  test('a cell rectangle copies as grid text plus a flattened table, no fragment', () => {
    const flavours = buildCopyFlavours({
      text: 'a\tb\nc\td',
      cellRectangle: true,
      coverage: null,
      pkg: null,
    });
    expect(flavours.html).toContain('<table>');
    expect(flavours.html).toContain('<td>a</td><td>b</td>');
    expect(fragmentFromHtml(flavours.html!)).toBeNull();
  });

  test('an empty cell rectangle still writes its HTML table flavour', () => {
    const flavours = buildCopyFlavours({
      text: '',
      cellRectangle: true,
      coverage: null,
      pkg: null,
    });
    expect(flavours.html).toBe('<div><table><tr><td></td></tr></table></div>');
  });

  test('non-text body coverage still writes rich clipboard flavours', () => {
    const flavours = buildCopyFlavours({ ...input, text: '' });
    expect(flavours.text).toBe('');
    expect(flavours.html).not.toBeNull();
    expect(fragmentFromHtml(flavours.html!)).not.toBeNull();
  });
});

test('the drawing showcase reports unsupported content instead of silently omitting its charts', () => {
  const loaded = readOoxmlPackage(
    new Uint8Array(
      readFileSync(`${import.meta.dir}/../../../../../examples/vite/public/sample.docx`)
    )
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  const pkg = loaded.package;
  const coverage = fullBodyCoverage(pkg);
  expect(extractFragmentPackage(pkg, coverage)).toEqual({
    ok: false,
    reason: 'unsupported-content',
  });
  expect(buildCopyFlavours({ pkg, coverage, text: 'selected text', cellRectangle: false })).toEqual(
    {
      text: 'selected text',
      html: null,
      reason: 'unsupported-content',
    }
  );
});
