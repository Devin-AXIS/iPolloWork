import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import {
  createLayoutShaping,
  disposeLayoutShaping,
  createShapingEnvironment,
  FontResolutionError,
  sha256FontBytes,
  prepareLayoutFontConfiguration,
  type LayoutShapingOptions,
  type LayoutFontConfiguration,
} from '../../layout/index.ts';
import {
  acquireSharedExportShaping,
  MAX_SHARED_EXPORT_SHAPING_CONFIGURATIONS,
  MAX_SHARED_EXPORT_SHAPING_FONT_BYTES,
} from '../shared-export-shaping.ts';
import { openFontBackedDocumentForExport } from '../document-export-shaping.ts';

const bytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const padded = new Uint8Array(16 * 2 ** 20 + 1);
padded.set(bytes);
const family = 'Public Execution Face';
const request = { family, weight: 400, style: 'normal' as const };
function configuration(data = padded): LayoutFontConfiguration {
  return {
    epoch: 1,
    maxFontBytes: 20 * 2 ** 20,
    sources: [
      {
        request,
        id: 'public-execution-face',
        bytes: data,
        hash: sha256FontBytes(data),
        faceIndex: 0,
      },
    ],
    defaultFont: { family, sizeHalfPoints: 24 },
  };
}
function shape(shaping: LayoutShapingOptions) {
  const font = shaping.fonts.resolve(request);
  if (font instanceof FontResolutionError) throw font;
  return shaping.shaper.shape({
    text: 'office AV',
    fontSizeHalfPoints: 24,
    bidiLevel: 0,
    environment: createShapingEnvironment({
      ...shaping.environment,
      font,
      script: 'Latn',
      direction: 'ltr',
      fallbackOrder: [],
    }),
  });
}
function documentBytes() {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${rel}"><Relationship Id="doc" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/><w:sz w:val="24"/></w:rPr><w:t>office AV</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

test('the public layout API keeps preparation separate and fingerprints explicit execution', async () => {
  const prepared = prepareLayoutFontConfiguration(configuration());
  const options = { maxFontBytes: 20 * 2 ** 20 };
  const explicitPending = createLayoutShaping(prepared, undefined, options);
  options.maxFontBytes = 1;
  const [explicit, defaults, reference] = await Promise.all([
    explicitPending,
    createLayoutShaping(prepared),
    createLayoutShaping(configuration(bytes)),
  ]);
  try {
    expect(explicit.operation.extensionFingerprint).toBe(defaults.operation.extensionFingerprint);
    expect(explicit.operation.shapingHash).not.toBe(defaults.operation.shapingHash);
    expect(shape(explicit).glyphs.map((glyph) => [glyph.id, glyph.advanceX])).toEqual(
      shape(reference).glyphs.map((glyph) => [glyph.id, glyph.advanceX])
    );
    expect(() => shape(defaults)).toThrow(expect.objectContaining({ code: 'fontOverLimit' }));
  } finally {
    disposeLayoutShaping(explicit);
    disposeLayoutShaping(defaults);
    disposeLayoutShaping(reference);
  }
});

test('shared export views separate execution identity while retaining the original aggregate ceilings', async () => {
  expect(MAX_SHARED_EXPORT_SHAPING_CONFIGURATIONS).toBe(32);
  expect(MAX_SHARED_EXPORT_SHAPING_FONT_BYTES).toBe(128 * 2 ** 20);
  const prepared = prepareLayoutFontConfiguration(configuration());
  const explicit = await acquireSharedExportShaping(prepared, undefined, {
    maxFontBytes: 20 * 2 ** 20,
  });
  const repeated = await acquireSharedExportShaping(prepared, undefined, {
    maxFontBytes: 20 * 2 ** 20,
  });
  const defaults = await acquireSharedExportShaping(prepared);
  expect(repeated).toBe(explicit);
  expect(defaults).not.toBe(explicit);
  expect(explicit.extensionFingerprint).toBe(defaults.extensionFingerprint);
  expect(explicit.producer).not.toBe(defaults.producer);
});

test('document-aware export admits and shapes an explicitly permitted face but refuses it by default', async () => {
  const input = documentBytes();
  const original = input.slice();
  const opened = await openFontBackedDocumentForExport(input, {
    fonts: configuration(),
    fontShaping: { maxFontBytes: 20 * 2 ** 20 },
    onFontResolution: () => {},
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const admitted = opened.session.admittedFontFace(request);
    expect(admitted?.byteLength).toBe(padded.byteLength);
    const layout = await opened.session.layout();
    const spans = layout.pages
      .flatMap((page) => page.fragments)
      .flatMap((fragment) =>
        fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans) : []
      )
      .filter((span) => span.text.length > 0);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.map((span) => span.text).join('')).toBe('office AV');
    expect(spans[0]!.range.start).toBe(0);
    expect(spans.at(-1)!.range.end).toBe('office AV'.length);
    for (const span of spans) {
      const shaped = opened.session.shapeLaidOutText(span);
      expect(shaped).not.toBeNull();
      expect(shaped!.font.hash).toBe(admitted!.hash);
      expect(shaped!.font.byteLength).toBe(padded.byteLength);
      expect(shaped!.font.faceIndex).toBe(0);
      expect(shaped!.run.glyphs.every((glyph) => glyph.id !== 0)).toBe(true);
    }
  } finally {
    opened.session.dispose();
  }
  const defaultOpened = await openFontBackedDocumentForExport(input, {
    fonts: configuration(),
    onFontResolution: () => {},
  });
  expect(defaultOpened.ok).toBe(true);
  if (!defaultOpened.ok) throw new Error(defaultOpened.reason);
  try {
    expect(defaultOpened.session.admittedFontFace(request)).toBeNull();
    expect(defaultOpened.session.fontResolution.originFailures.length).toBeGreaterThan(0);
  } finally {
    defaultOpened.session.dispose();
  }
  expect(input).toEqual(original);
});

test('an explicit execution allowance cannot enlarge a stricter font admission budget', async () => {
  await expect(
    createLayoutShaping({ ...configuration(), maxFontBytes: 2 * 2 ** 20 }, undefined, {
      maxFontBytes: 20 * 2 ** 20,
    })
  ).rejects.toMatchObject({
    code: 'overLimit',
    message: 'Font source public-execution-face exceeds the per-font byte ceiling',
  });
});
