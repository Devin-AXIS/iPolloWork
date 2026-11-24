import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { describe, expect, test } from 'bun:test';
import { readOoxmlPackage } from '../store/index.ts';
import { DEFAULT_ZIP_LIMITS, readZip } from '../store/package/zip.ts';
import { PERFORMANCE_FIXTURE_BASENAMES } from './performance-fixture-registry.ts';

const FIXTURE = 'typing-perf-521pp.docx';

function fixtureBytes() {
  return readFileSync(new URL(`../../../../e2e/fixtures/${FIXTURE}`, import.meta.url));
}

describe('typing-perf-521pp fixture manifest', () => {
  test('matches the committed manifest fields', () => {
    const manifestPath = new URL(
      '../../../../e2e/fixtures/typing-perf-521pp.manifest.json',
      import.meta.url
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      sourceCategory: string;
      purpose: string;
      fixtures: Record<
        string,
        {
          sha256: string;
          byteSize: number;
          expectedPageCount: number;
          targetParagraphContentMarker: string;
          targetParagraphNodeId: string;
        }
      >;
    };
    expect(manifest.sourceCategory.length).toBeGreaterThan(0);
    expect(manifest.purpose.length).toBeGreaterThan(0);
    const entry = manifest.fixtures[FIXTURE];
    expect(entry).toBeDefined();

    const bytes = fixtureBytes();
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(bytes.byteLength).toBe(entry.byteSize);
    expect(digest).toBe(entry.sha256);
    expect(entry.expectedPageCount).toBe(521);
    expect(entry.targetParagraphContentMarker).toBe('Total Element Categories: 50+');
    expect(entry.targetParagraphNodeId).toBe('/word/document.xml#0.0.8');
  });

  test('is registered in the performance fixture registry', () => {
    expect(PERFORMANCE_FIXTURE_BASENAMES.has(FIXTURE)).toBe(true);
  });
});

describe('typing-perf-521pp fixture security inventory', () => {
  test('passes bounded ZIP read with no traversal or absolute filesystem paths', () => {
    const result = readZip(fixtureBytes(), DEFAULT_ZIP_LIMITS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const name of result.entries.keys()) {
      expect(name.includes('..')).toBe(false);
      expect(name.includes('\\')).toBe(false);
    }
  });

  test('contains no macros, OLE objects, or executables', () => {
    const entries = unzipSync(fixtureBytes());
    const blocked = /\.(bin|exe|dll|vbs|js|bat|cmd|ps1|jar|class)$/i;
    for (const name of Object.keys(entries)) {
      expect(name.toLowerCase()).not.toMatch(/vba|macro|oleobject|activex/);
      expect(name).not.toMatch(blocked);
    }
  });

  test('stays within expanded-byte and per-entry compression-ratio budgets', () => {
    const fixture = fixtureBytes();
    const maxRatio = DEFAULT_ZIP_LIMITS.maxRatio ?? 200;
    let expanded = 0;
    unzipSync(fixture, {
      filter: (file) => {
        if (file.name.endsWith('/')) return false;
        const compressed = file.size ?? 0;
        const original = file.originalSize ?? compressed;
        if (compressed > 0) {
          expect(original / compressed).toBeLessThanOrEqual(maxRatio);
        }
        expanded += original;
        return true;
      },
    });
    expect(expanded).toBeLessThanOrEqual(DEFAULT_ZIP_LIMITS.maxTotalBytes);
    expect(fixture.byteLength).toBeGreaterThan(0);
  });

  test('lists external relationships and field instructions without executing them', () => {
    const pkg = readOoxmlPackage(fixtureBytes());
    expect(pkg.ok).toBe(true);
    if (!pkg.ok) return;
    const externals: string[] = [];
    for (const [partName, part] of pkg.package.relationships) {
      for (const rel of part) {
        if (rel.targetMode === 'External') externals.push(`${partName} -> ${rel.rawTarget}`);
      }
    }
    const document = pkg.package.parts.get('/word/document.xml');
    expect(document).toBeDefined();
    const xml = new TextDecoder().decode(
      unzipSync(fixtureBytes())['word/document.xml'] ?? new Uint8Array()
    );
    const fieldInstructions = [...xml.matchAll(/<w:instrText[^>]*>([^<]*)<\/w:instrText>/g)].map(
      (match) => match[1] ?? ''
    );
    expect(externals.sort()).toEqual([
      '/word/document.xml -> https://example.com',
      '/word/document.xml -> https://www.anthropic.com',
    ]);
    expect(fieldInstructions).toHaveLength(20);
    expect(new Set(fieldInstructions)).toEqual(new Set(['TOC \\h \\o &quot;1-5&quot;']));
    expect(fieldInstructions.join(' ')).not.toMatch(/\b(?:DDE|EXEC|INCLUDEPICTURE|INCLUDETEXT)\b/i);
  });
});
