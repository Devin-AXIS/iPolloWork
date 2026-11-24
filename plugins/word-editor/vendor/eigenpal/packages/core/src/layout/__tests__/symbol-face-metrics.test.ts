// Unavailable symbol-encoded faces: no text substitute, and their own geometry.
//
// Symbol, Wingdings, Wingdings 2, Wingdings 3 and Webdings draw private-use codes. A text face
// standing in for one paints missing glyphs and sizes the line by its own ascent, so the plan
// must leave these families unresolved. The measurer then keeps the face's real line box
// (usWinAscent + usWinDescent) and advances, while other unresolved families keep the plain
// fallback.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { openHeadlessDocument } from '../../store/headless-document-view.ts';
import {
  applyDocumentFontSubstitutions,
  documentFontSubstitutionPlan,
} from '../document-font-substitution.ts';
import { composeFontConfiguration } from '../font-composition.ts';
import { markerSymbolFontAvailability } from '../marker-symbol-font.ts';
import { symbolFaceMetrics, withSymbolFaceMetrics } from '../symbol-face-metrics.ts';
import { symbolFaceByteOf } from '../symbol-encoding.ts';
import { openFontBackedDocumentForExport } from '../../export/document-export-shaping.ts';
import type { FontSource } from '../../contracts/editor.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import {
  DEFAULT_RUN_STYLE,
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFixedMeasurer,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapedMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
  type FontRequest,
  type ResolvedFont,
  type ResolvedRunStyle,
} from '../index.ts';

await initializeHarfBuzz();

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const FONT_BYTES = new Uint8Array(
  readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);

/** One body run per family, plus a font table that gives `Unknown Face` a whole alternate. */
function documentBytes(
  families: readonly string[],
  extra: Record<string, Uint8Array> = {},
  body = ''
): Uint8Array {
  const runs = families
    .map(
      (family) =>
        `<w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/></w:rPr><w:t>PUBLIC</w:t></w:r>`
    )
    .join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="f" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p>${runs}</w:p>${body}</w:body></w:document>`
    ),
    'word/fontTable.xml': strToU8(
      `<w:fonts xmlns:w="${W}"><w:font w:name="Unknown Face"><w:altName w:val="Courier New"/></w:font></w:fonts>`
    ),
    ...extra,
  });
}

function view(families: readonly string[]) {
  const opened = openHeadlessDocument(documentBytes(families));
  if (!opened.ok) throw new Error(opened.reason);
  return opened.view;
}

function source(family: string): FontSource {
  return {
    request: { family, weight: 400, style: 'normal' },
    id: family,
    bytes: new Uint8Array([1]),
    hash: '0'.repeat(64),
    faceIndex: 0,
  };
}

const SYMBOL_FAMILIES = ['Symbol', 'Wingdings', 'Wingdings 2', 'Wingdings 3', 'Webdings'];

test('symbol-encoded families never take a text default', () => {
  const plan = documentFontSubstitutionPlan(view([...SYMBOL_FAMILIES, 'Unknown Latin']), [
    ...SYMBOL_FAMILIES,
    'Unknown Latin',
  ]);
  for (const family of SYMBOL_FAMILIES)
    expect(plan.fallbacks.has(family.toLowerCase())).toBe(false);
  // A text family that is unavailable still takes the document Latin default.
  expect(plan.fallbacks.get('unknown latin')).toBe('Calibri');
  const fonts = composeFontConfiguration({ sources: [source('Calibri')] });
  const substituted = (applyDocumentFontSubstitutions(fonts, plan).substitutions ?? []).map(
    (substitution) => substitution.from.family
  );
  expect(substituted).toContain('Unknown Latin');
  for (const family of SYMBOL_FAMILIES) expect(substituted).not.toContain(family);
});

test('an available symbol face is used directly', () => {
  const plan = documentFontSubstitutionPlan(view(['Symbol']), ['Symbol']);
  const fonts = composeFontConfiguration({ sources: [source('Symbol'), source('Calibri')] });
  expect(applyDocumentFontSubstitutions(fonts, plan).substitutions).toBeUndefined();
});

test('a whole font-table alternate still resolves next to symbol families', () => {
  const plan = documentFontSubstitutionPlan(view(['Symbol', 'Unknown Face']), [
    'Symbol',
    'Unknown Face',
  ]);
  expect(plan.families).toContain('Courier New');
  const fonts = composeFontConfiguration({ sources: [source('Courier New')] });
  expect(applyDocumentFontSubstitutions(fonts, plan).substitutions).toEqual([
    {
      from: { family: 'Unknown Face', weight: 400, style: 'normal' },
      to: { family: 'Courier New', weight: 400, style: 'normal' },
    },
  ]);
});

test('export keeps an unavailable symbol face unresolved, so bullets map to Unicode', async () => {
  const physical: FontSource = {
    request: { family: 'Calibri', weight: 400, style: 'normal' },
    id: 'public-font-fixture',
    bytes: FONT_BYTES,
    hash: sha256FontBytes(FONT_BYTES),
    faceIndex: 0,
  };
  const opened = await openFontBackedDocumentForExport(
    documentBytes(['Symbol', 'Wingdings', 'Unknown Latin']),
    { fonts: () => ({ sources: [physical] }) }
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const face = (family: string) =>
      opened.session.admittedFontFace({ family, weight: 400, style: 'normal' });
    expect(face('Symbol')).toBeFalsy();
    expect(face('Wingdings')).toBeFalsy();
    expect(face('Unknown Latin')?.id).toBe(physical.id);
  } finally {
    opened.session.dispose();
  }
});

// ---- Measurement -------------------------------------------------------------------------

const REQUEST: FontRequest = { family: 'DejaVu Sans', weight: 400, style: 'normal' };

function resolvedFixture(): ResolvedFont {
  const snapshot = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 2_000_000,
    resources: [
      {
        request: REQUEST,
        id: 'dejavu-400',
        bytes: FONT_BYTES,
        hash: sha256FontBytes(FONT_BYTES),
        faceIndex: 0,
      },
    ],
    validateFont: harfBuzzFontValidator,
  });
  const result = snapshot.resolve(REQUEST);
  if (result instanceof FontResolutionError) throw result;
  return result;
}

const font = resolvedFixture();
const fixed = createFixedMeasurer(6, 14);

/** A measurer that resolves only the listed families, all to the fixture face. */
const measurer = (available: readonly string[]) =>
  createShapedMeasurer({
    shaper: createHarfBuzzTextShaper(),
    resolveFont: (style) =>
      style.fontFamily === null ||
      available.some((family) => family.toLowerCase() === style.fontFamily!.toLowerCase())
        ? font
        : null,
    fallback: fixed,
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
  });

const style = (fontFamily: string | null, overrides: Partial<ResolvedRunStyle> = {}) =>
  ({ ...DEFAULT_RUN_STYLE, fontSizePt: 11, fontFamily, ...overrides }) as ResolvedRunStyle;

/** Face units are 1/2048 em. */
const em = (units: number, sizePt = 11) => (units * sizePt) / 2048;

test('an unavailable symbol face keeps its own line box', () => {
  const shaped = measurer([]);
  // usWinAscent + usWinDescent: Symbol 2059 + 450, Wingdings 1841 + 432, Webdings 1638 + 410.
  for (const [family, ascent, descent] of [
    ['Symbol', 2059, 450],
    ['wingdings', 1841, 432],
    ['Wingdings 2', 1727, 432],
    ['Wingdings 3', 1900, 432],
    ['Webdings', 1638, 410],
  ] as const) {
    const metrics = shaped.lineMetrics(style(family), '\u{f0b7}');
    expect(metrics.height).toBeCloseTo(em(ascent + descent), 6);
    expect(metrics.baseline).toBeCloseTo(em(ascent), 6);
  }
  // Superscript draws smaller, and the line box scales with it.
  const superscript = shaped.lineMetrics(style('Symbol', { verticalAlign: 'superscript' }));
  expect(superscript.height).toBeLessThan(em(2509));
  // Another unavailable family keeps the plain fallback.
  expect(shaped.lineMetrics(style('Unknown Latin')).height).toBe(14);
});

test('an unavailable symbol face keeps its own advances', () => {
  const shaped = measurer([]);
  // Symbol 0xB7 (bullet) is 942 units: the private-use code, its Unicode twin, the bare byte.
  for (const text of ['\u{f0b7}', '\u{2022}', '\u{00b7}'])
    expect(shaped.measure(text, style('Symbol'))).toBeCloseTo(em(942), 6);
  // Wingdings 0xFC (check mark) is 1609 units, through the private-use code and its twin.
  expect(shaped.measure('\u{f0fc}', style('Wingdings'))).toBeCloseTo(em(1609), 6);
  expect(shaped.measure('\u{2714}', style('Wingdings'))).toBeCloseTo(em(1609), 6);
  // Caret edges add up to the measured width.
  const edges = shaped.caretAdvances!('\u{f0b7}\u{f0b7}', style('Symbol'));
  expect(edges?.length).toBe(3);
  expect(edges?.[2]).toBeCloseTo(em(1884), 6);
  // Horizontal scale and character spacing apply like any other run.
  expect(
    shaped.measure(
      '\u{f0b7}',
      style('Symbol', { horizontalScalePercent: 50, characterSpacingPt: 1 })
    )
  ).toBeCloseTo(em(942) / 2 + 1, 6);
});

test('text that is no byte of the symbol face keeps the plain fallback width', () => {
  const shaped = measurer([]);
  expect(shaped.measure('\u{3042}', style('Symbol'))).toBe(6);
  expect(shaped.measure('PUBLIC', style('Unknown Latin'))).toBe(36);
});

test('an available symbol face measures through the face, not the table', () => {
  const available = measurer(['Symbol']);
  const reference = measurer(['DejaVu Sans']);
  expect(available.measure('ab', style('Symbol'))).toBeCloseTo(
    reference.measure('ab', style('DejaVu Sans')),
    6
  );
  expect(available.lineMetrics(style('Symbol'), 'ab')).toEqual(
    reference.lineMetrics(style('DejaVu Sans'), 'ab')
  );
  // The marker oracle still reports the admitted face, so its private-use bullet survives.
  expect(markerSymbolFontAvailability(available)?.('Symbol')).toBe(true);
  expect(markerSymbolFontAvailability(measurer([]))).toBeUndefined();
});

test('the table covers exactly the five symbol-encoded families', () => {
  for (const family of SYMBOL_FAMILIES) expect(symbolFaceMetrics(family)).toBeDefined();
  expect(symbolFaceMetrics('Symbol Neu')).toBeUndefined();
  expect(symbolFaceMetrics('Calibri')).toBeUndefined();
  expect(symbolFaceByteOf(0xf0b7, 'Calibri')).toBeNull();
  // The wrapper passes other families to the wrapped measurer untouched.
  const wrapped = withSymbolFaceMetrics(fixed);
  expect(wrapped.measure('PUBLIC', style('Calibri'))).toBe(36);
});

test('export sizes a translated marker by the symbol face and paints its Unicode twin', async () => {
  const physical: FontSource = {
    request: { family: 'Calibri', weight: 400, style: 'normal' },
    id: 'public-font-fixture',
    bytes: FONT_BYTES,
    hash: sha256FontBytes(FONT_BYTES),
    faceIndex: 0,
  };
  const numbering = strToU8(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">` +
      '<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="\uf0b7"/>' +
      '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>' +
      '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl>' +
      '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>'
  );
  const files = unzipSync(
    documentBytes(
      [],
      { 'word/numbering.xml': numbering },
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
        '<w:r><w:t>PUBLIC</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>PUBLIC</w:t></w:r><w:r><w:sym w:font="Wingdings" w:char="F0FC"/></w:r></w:p>'
    )
  );
  files['word/_rels/document.xml.rels'] = strToU8(
    strFromU8(files['word/_rels/document.xml.rels']!).replace(
      '</Relationships>',
      '<Relationship Id="n" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>'
    )
  );
  const opened = await openFontBackedDocumentForExport(zipSync(files), {
    fonts: () => ({ sources: [physical] }),
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const layout = await opened.session.layout();
    const [, listed, symbol] = paragraphFragmentsOf(layout.pages[0]!);
    const marker = listed!.marker!;
    expect(marker.text).toBe('\u{2022}');
    expect(marker.style.fontFamily).toBe('Symbol');
    // Symbol 0xB7 advance, and a first line at least as tall as the Symbol line box.
    expect(marker.box.width).toBeCloseTo(em(942, marker.style.fontSizePt), 3);
    expect(listed!.lines[0]!.box.height).toBeGreaterThanOrEqual(
      em(2509, marker.style.fontSizePt) - 1e-6
    );
    const span = listed!.lines[0]!.spans[0]!;
    const painted = opened.session.shapeLaidOutText({
      ...span,
      text: marker.text,
      style: marker.style,
      box: marker.box,
    });
    expect(painted?.run.glyphs.length).toBe(1);
    expect(painted?.run.glyphs[0]?.id).not.toBe(0);
    // A symbol glyph that is no Unicode twin keeps the symbol face only; its twin paints.
    const check = symbol!.lines[0]!.spans.find((candidate) => candidate.text === '\u{2714}');
    expect(check?.style.fontFamily).toBe('Wingdings');
    expect(opened.session.shapeLaidOutText(check!)?.run.glyphs[0]?.id).not.toBe(0);
  } finally {
    opened.session.dispose();
  }
});
