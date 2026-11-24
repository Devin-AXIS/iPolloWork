// Task 17 — drawing fixture manifest, round-trip oracles, and table-driven open/layout/paint.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import {
  canonicalOoxmlFingerprint,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../package/ooxml-package.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
  projectDrawingsInPackage,
} from '../package/drawing-projection.ts';
import {
  createImageResourceCache,
  validateRasterHeader,
  type ImageDecodePort,
} from '../package/image-resources.ts';
import { resolveImageResourceLimits } from '../runtime/limits.ts';
import { mockReadyImageResource } from './drawing-ready-fixture.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import type { InlineDrawingLayoutContext } from '../../layout/drawing-layout.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import type { PaintImageUrlPort } from '../../output/semantic-paint-drawings.ts';
import { FIXTURE_ORACLES } from './drawing-fixture-oracles.ts';

const FIXTURES_DIR = resolve(import.meta.dir, '../../../../../e2e/fixtures');
const MANIFEST_PATH = resolve(FIXTURES_DIR, 'drawings-fixtures.md');
const OWNER = '/word/document.xml';

/**
 * The whole-package oracles read, save, reopen and lay out real Word documents — a quarter of a
 * megabyte of XML in the case of `list-pagination-break.docx`. Seconds is what that costs, and
 * the default per-test timeout is five of them, so on a loaded CI box these went red for being
 * slow rather than for being wrong. The budget is stated instead of inherited.
 */
const FIXTURE_TIMEOUT_MS = 60_000;

interface ManifestEntry {
  readonly file: string;
  readonly source: string;
  readonly version?: string;
  readonly features: string | readonly string[];
  readonly geometry?: string;
  readonly branch?: string;
  readonly refusal?: string;
  readonly wordEvidence?: string;
  readonly tolerance?: string;
  readonly sha256: string;
}

interface Manifest {
  readonly version: number;
  readonly entries: readonly ManifestEntry[];
}

function loadManifest(): Manifest {
  const md = readFileSync(MANIFEST_PATH, 'utf8');
  const match = md.match(/<!-- DRAWINGS_FIXTURE_MANIFEST\n([\s\S]*?)\n-->/);
  if (!match) throw new Error('missing DRAWINGS_FIXTURE_MANIFEST block');
  return JSON.parse(match[1]!) as Manifest;
}

function sha256File(name: string): string {
  return createHash('sha256')
    .update(readFileSync(resolve(FIXTURES_DIR, name)))
    .digest('hex');
}

/**
 * Fixtures are opened once per file and shared.
 *
 * Reading `list-pagination-break.docx` alone costs well over a second, and the oracles below
 * open every entry three times. Nothing here writes to a package — `writeOoxmlPackage`,
 * `projectDrawingsInPackage`, `createImageResourceCache` and `layoutSemanticDocument` all read
 * — so one parse per fixture is the same test at a fraction of the wall clock.
 */
const OPEN_CACHE = new Map<string, OoxmlPackage>();

function openFixture(name: string): OoxmlPackage {
  const cached = OPEN_CACHE.get(name);
  if (cached) return cached;
  const result = readOoxmlPackage(new Uint8Array(readFileSync(resolve(FIXTURES_DIR, name))));
  if (!result.ok) throw new Error(`${name}: ${result.reason}`);
  OPEN_CACHE.set(name, result.package);
  return result.package;
}

function mockDecodePort(): ImageDecodePort {
  return Object.freeze({
    async decode(bytes, mime) {
      const header = validateRasterHeader(bytes, mime);
      if (!header) throw new Error('invalid raster');
      const limits = resolveImageResourceLimits();
      if (header.pixelWidth * header.pixelHeight > limits.maxPixels) throw new Error('too large');
      return Object.freeze({ ...header, dpiX: 96, dpiY: 96 });
    },
  });
}

function fakeUrlPort(): PaintImageUrlPort {
  return Object.freeze({
    create: () => 'blob:fixture-test',
    revoke: () => {},
  });
}

function layoutContext(part: OoxmlPart, owner: string = OWNER): InlineDrawingLayoutContext {
  const atomProjections = indexInlineDrawingProjectionsInPart(part);
  const ready = mockReadyImageResource({
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  });
  return {
    ownerPartName: owner,
    projectionForAtom: (atomId) => atomProjections.get(atomId) ?? null,
    project: (node) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, { ownerPartName: owner, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => ready,
  };
}

function* walk(node: OoxmlNode): Generator<OoxmlNode> {
  yield node;
  if (node.kind === 'textValue') return;
  for (const child of node.children) yield* walk(child);
}

/**
 * Raw zip entries, read with `unzip` rather than with the reader under test — and memoized,
 * because a subprocess per assertion is the kind of cost that only shows up in aggregate.
 */
const UNZIP_CACHE = new Map<string, string>();

function unzipEntry(name: string, entry: string): string {
  const key = `${name}\0${entry}`;
  const cached = UNZIP_CACHE.get(key);
  if (cached !== undefined) return cached;
  const text = execSync(`unzip -p "${resolve(FIXTURES_DIR, name)}" ${entry}`).toString();
  UNZIP_CACHE.set(key, text);
  return text;
}

function countExternalImageRelationships(name: string): number {
  const rels = unzipEntry(name, 'word/_rels/document.xml.rels');
  return (rels.match(/relationships\/image[^>]*TargetMode="External"/g) ?? []).length;
}

function assertSaveReopenOracle(before: OoxmlPart, after: OoxmlPart): void {
  expect(canonicalOoxmlFingerprint(after)).toBe(canonicalOoxmlFingerprint(before));
  expect(diffSemanticDigests(semanticDigest([before]), semanticDigest([after]))).toEqual([]);
}

describe('fixture manifest matches checked-in drawings', () => {
  const manifest = loadManifest();

  test('lists eighteen entries', () => {
    expect(manifest.entries).toHaveLength(18);
  });

  for (const entry of manifest.entries) {
    test(`${entry.file} exists with matching SHA-256 and metadata`, () => {
      expect(() => readFileSync(resolve(FIXTURES_DIR, entry.file))).not.toThrow();
      expect(sha256File(entry.file)).toBe(entry.sha256);
      expect(entry.source.length).toBeGreaterThan(0);
      expect(entry.features).toBeTruthy();
      expect(entry.branch ?? entry.refusal).toBeTruthy();
      expect(FIXTURE_ORACLES[entry.file]).toBeDefined();
    });
  }
});

describe('comprehensive fixture empty srcRect scope (7.9)', () => {
  test('all eleven pictures in comprehensive-word-element-test.docx have empty a:srcRect', () => {
    const xml = unzipEntry('comprehensive-word-element-test.docx', 'word/document.xml');
    const rects = [...xml.matchAll(/<a:srcRect[^/]*\/>/g)].map((m) => m[0]!);
    expect(rects.length).toBeGreaterThanOrEqual(11);
    for (const rect of rects) {
      expect(rect).toBe('<a:srcRect/>');
    }
    expect(xml).not.toMatch(/<a:srcRect[^/]*\sl="/);
  });
});

describe('list-pagination external zero-fetch (7.1)', () => {
  test('carries 27 external image relationships', () => {
    expect(countExternalImageRelationships('list-pagination-break.docx')).toBe(27);
  });

  test(
    'loads and projects without network or decode for external embeds',
    async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() => {
        throw new Error('fetch must not run');
      }) as typeof fetch;
      try {
        const pkg = openFixture('list-pagination-break.docx');
        const decode = mockDecodePort();
        let decodeCalls = 0;
        const cache = createImageResourceCache(pkg, {
          decodePort: {
            decode: async (...args) => {
              decodeCalls += 1;
              return decode.decode(...args);
            },
          },
        });
        const projections = projectDrawingsInPackage(pkg);
        const relsXml = unzipEntry('list-pagination-break.docx', 'word/_rels/document.xml.rels');
        const externalIds = [...relsXml.matchAll(/<Relationship\b[^>]*>/g)]
          .map((m) => m[0]!)
          .filter(
            (tag) => tag.includes('relationships/image') && tag.includes('TargetMode="External"')
          )
          .map((tag) => tag.match(/Id="([^"]+)"/)?.[1])
          .filter((id): id is string => id !== undefined);
        expect(externalIds.length).toBe(27);
        for (const relId of externalIds) {
          const state = await cache.resolveEmbedded('/word/document.xml', relId);
          expect(state.kind).toBe('external');
        }
        for (const projection of projections) {
          const state = await cache.resolveForProjection(projection);
          if (state.kind === 'external') {
            expect(decodeCalls).toBe(0);
          }
        }
        const saved = readOoxmlPackage(writeOoxmlPackage(pkg));
        if (!saved.ok) throw new Error(saved.reason);
        expect(saved.package.externalTargets.some((t) => t.type.includes('image'))).toBe(true);
        expect(decodeCalls).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
    FIXTURE_TIMEOUT_MS
  );
});

describe('manifest-driven fixture oracles (7.1–7.9)', () => {
  const manifest = loadManifest();
  const measurer = createFixedMeasurer(6, 14);

  for (const entry of manifest.entries) {
    const oracle = FIXTURE_ORACLES[entry.file]!;

    test(
      `${entry.file}: fingerprint-stable save/reopen with semantic digest equality`,
      () => {
        const pkg = openFixture(entry.file);
        const main = pkg.parts.get(pkg.mainDocumentPart);
        if (!main) throw new Error('no main part');
        const saved = writeOoxmlPackage(pkg);
        const reopened = readOoxmlPackage(saved);
        if (!reopened.ok) throw new Error(reopened.reason);
        const mainAfter = reopened.package.parts.get(reopened.package.mainDocumentPart)!;
        assertSaveReopenOracle(main, mainAfter);
      },
      FIXTURE_TIMEOUT_MS
    );

    test(
      `${entry.file}: projects with manifest oracle`,
      async () => {
        const pkg = openFixture(entry.file);
        const projections = projectDrawingsInPackage(pkg);
        expect(projections.length).toBe(oracle.drawingCount);
        oracle.assertProjections(projections);
        if (oracle.assertResourceKinds) {
          const cache = createImageResourceCache(pkg, { decodePort: mockDecodePort() });
          const kinds = await Promise.all(
            projections.map((p) => cache.resolveForProjection(p).then((s) => s.kind))
          );
          oracle.assertResourceKinds(kinds);
        }
      },
      FIXTURE_TIMEOUT_MS
    );

    test(
      `${entry.file}: layout and paint without network`,
      async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (() => {
          throw new Error('fetch must not run');
        }) as typeof fetch;
        try {
          const pkg = openFixture(entry.file);
          const main = pkg.parts.get(pkg.mainDocumentPart)!;
          const layout = layoutSemanticDocument(main, 1, {
            measurer,
            inlineDrawingLayout: layoutContext(main),
          });
          expect(layout.pages.length).toBe(oracle.pageCount);
          oracle.assertLayout?.(layout);
          const container = document.createElement('div');
          paintSemanticLayout(container, layout, { scale: 1, imageUrlPort: fakeUrlPort() });
          expect(container.querySelectorAll('.docx-drawing-ready').length).toBe(oracle.readyCount);
          expect(container.querySelectorAll('.docx-drawing-placeholder').length).toBe(
            oracle.placeholderCount
          );
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
      FIXTURE_TIMEOUT_MS
    );
  }

  test('images-external.docx refuses unsafe and external resources', async () => {
    const pkg = openFixture('images-external.docx');
    const cache = createImageResourceCache(pkg, { decodePort: mockDecodePort() });
    const projections = projectDrawingsInPackage(pkg);
    const kinds = await Promise.all(
      projections.map((p) => cache.resolveForProjection(p).then((s) => s.kind))
    );
    expect(kinds).toContain('external');
  });

  test('images-compatibility-malformed.docx preserves OLE, altChunk, and VML as generic', () => {
    const pkg = openFixture('images-compatibility-malformed.docx');
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const names = new Set<string>();
    for (const node of walk(main.root)) {
      if (node.kind !== 'textValue') names.add(node.localName);
    }
    expect(names.has('pict')).toBe(true);
    expect(names.has('object')).toBe(true);
    expect(names.has('altChunk')).toBe(true);
    expect(names.has('AlternateContent')).toBe(true);
  });

  test('issue-705-anchored-header-letterhead.docx preserves MC letterhead drawings in header3', () => {
    const pkg = openFixture('issue-705-anchored-header-letterhead.docx');
    const header = pkg.parts.get('/word/header3.xml');
    expect(header).toBeDefined();
    let mcDrawings = 0;
    for (const node of walk(header!.root)) {
      if (node.kind === 'generic' && node.localName === 'drawing') mcDrawings += 1;
    }
    expect(mcDrawings).toBeGreaterThanOrEqual(7);
  });
});
