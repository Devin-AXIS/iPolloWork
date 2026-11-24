import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { defineFontResolver } from '../../editor/index.ts';
import {
  DEFAULT_RUN_STYLE,
  forEachSemanticSpan,
  prepareLayoutFontConfiguration,
  sha256FontBytes,
  type StyleSpanRecord,
} from '../../layout/index.ts';
import { ExportResourceError, openDocumentForExport } from '../export-session.ts';
import { openFontBackedDocumentForExport } from '../document-export-shaping.ts';
import {
  acquireSharedExportShaping,
  createSessionExportShaping,
} from '../shared-export-shaping.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const fontUrl = new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url);
const fontBytes = new Uint8Array(readFileSync(fontUrl));
const fontHash = sha256FontBytes(fontBytes);
const SHARED_TEST_FAMILY = 'Export Laid Out Test Face';

function span(
  text: string,
  style: StyleSpanRecord['style'] = DEFAULT_RUN_STYLE,
  extra: Partial<StyleSpanRecord> = {}
): StyleSpanRecord {
  return {
    range: { paragraphId: 'p', start: 0, end: text.length },
    text,
    props: [],
    style,
    box: { x: 0, y: 0, width: 0, height: 0 },
    ...extra,
  };
}

function shapedAdvance(glyphs: readonly { readonly advanceX: number }[], scale: number): number {
  let total = 0;
  for (const glyph of glyphs) total += glyph.advanceX;
  return total / scale;
}

test('document ligature capability fingerprints and aligns measurement with emitted glyphs', async () => {
  const request = { family: SHARED_TEST_FAMILY, weight: 400, style: 'normal' } as const;
  const prepared = prepareLayoutFontConfiguration({
    epoch: 1,
    maxFontBytes: 2_000_000,
    sources: [{ request, id: 'ligatures', bytes: fontBytes, hash: fontHash, faceIndex: 0 }],
    defaultFont: { family: SHARED_TEST_FAMILY, sizeHalfPoints: 22 },
  });
  const browser = await createSessionExportShaping(prepared);
  const capable = await createSessionExportShaping(prepared, undefined, [], true);
  expect(capable.producer).not.toBe(browser.producer);
  const plain = { ...DEFAULT_RUN_STYLE, fontFamily: SHARED_TEST_FAMILY };
  const standard = {
    ...plain,
    ligatures: { standard: true, contextual: false, historical: false, discretionary: false },
  };
  for (const style of [plain, standard]) {
    for (const session of [browser, capable]) {
      const laidOut = session.shapeLaidOutText(span('office', style))!;
      expect(shapedAdvance(laidOut.run.glyphs, laidOut.fixedPointScale)).toBeCloseTo(
        session.createMeasurer().measure('office', style),
        8
      );
      expect(laidOut.run.glyphs.length).toBe(session === capable && style === plain ? 6 : 4);
    }
  }
  expect(browser.createMeasurer().measure('office', plain)).toBe(
    browser.createMeasurer().measure('office', standard)
  );
});

async function sharedShaping(options?: {
  readonly family?: string;
  readonly substitutions?: readonly {
    readonly from: {
      readonly family: string;
      readonly weight: number;
      readonly style: 'normal' | 'italic';
    };
    readonly to: {
      readonly family: string;
      readonly weight: number;
      readonly style: 'normal' | 'italic';
    };
  }[];
  readonly extraSources?: readonly {
    readonly family: string;
    readonly id: string;
  }[];
}) {
  const family = options?.family ?? SHARED_TEST_FAMILY;
  const prepared = prepareLayoutFontConfiguration({
    epoch: 1,
    maxFontBytes: 2_000_000,
    sources: [
      {
        request: { family, weight: 400, style: 'normal' as const },
        id: `laid-out:${family}`,
        bytes: fontBytes,
        hash: fontHash,
        faceIndex: 0,
      },
      ...(options?.extraSources ?? []).map((source) => ({
        request: { family: source.family, weight: 400 as const, style: 'normal' as const },
        id: source.id,
        bytes: fontBytes,
        hash: fontHash,
        faceIndex: 0,
      })),
    ],
    substitutions: options?.substitutions,
    defaultFont: { family, sizeHalfPoints: 22 },
  });
  return acquireSharedExportShaping(prepared);
}

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="doc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

test('shared shaping returns the exact glyph run measurement used and a frozen admitted face', async () => {
  const shaping = await sharedShaping();
  const style = { ...DEFAULT_RUN_STYLE, fontFamily: SHARED_TEST_FAMILY };
  const text = 'Shape me';
  const laidOut = shaping.shapeLaidOutText(span(text, style));
  expect(laidOut).not.toBeNull();
  if (!laidOut) return;

  expect(laidOut.run.text).toBe(text);
  expect(laidOut.run.glyphs.length).toBeGreaterThan(0);
  expect(laidOut.font.family).toBe(SHARED_TEST_FAMILY);
  expect(laidOut.font.identity).toBe(`${laidOut.font.hash}#${laidOut.font.faceIndex}`);
  expect(laidOut.font.hash).toBe(fontHash);
  expect(laidOut.font.substitution).toBeNull();
  expect('bytes' in laidOut.font).toBe(false);
  expect(Object.isFrozen(laidOut)).toBe(true);
  expect(Object.isFrozen(laidOut.run)).toBe(true);
  expect(Object.isFrozen(laidOut.font)).toBe(true);

  const measurer = shaping.createMeasurer();
  expect(shapedAdvance(laidOut.run.glyphs, laidOut.fixedPointScale)).toBeCloseTo(
    measurer.measure(text, style),
    8
  );
});

test('caps shape the displayed uppercase run, not the source characters', async () => {
  const shaping = await sharedShaping();
  const style = { ...DEFAULT_RUN_STYLE, fontFamily: SHARED_TEST_FAMILY, caps: true };
  const laidOut = shaping.shapeLaidOutText(span('ab', style));
  expect(laidOut?.run.text).toBe('AB');
  const measurer = shaping.createMeasurer();
  expect(shapedAdvance(laidOut!.run.glyphs, laidOut!.fixedPointScale)).toBeCloseTo(
    measurer.measure('AB', style),
    8
  );
});

test('eastAsia slots resolve the east-asia admitted face', async () => {
  const shaping = await sharedShaping({
    extraSources: [{ family: 'CJK Face', id: 'laid-out:cjk' }],
  });
  const style = {
    ...DEFAULT_RUN_STYLE,
    fontFamily: SHARED_TEST_FAMILY,
    fontFamilyEastAsia: 'CJK Face',
  };
  const laidOut = shaping.shapeLaidOutText(span('漢', style, { fontSlot: 'eastAsia' }));
  expect(laidOut?.font.family).toBe('CJK Face');
  expect(laidOut?.font.request.family).toBe('CJK Face');
});

test('substitution evidence travels with the admitted face identity', async () => {
  const shaping = await sharedShaping({
    substitutions: [
      {
        from: { family: 'Calibri', weight: 400, style: 'normal' },
        to: { family: SHARED_TEST_FAMILY, weight: 400, style: 'normal' },
      },
    ],
  });
  const style = { ...DEFAULT_RUN_STYLE, fontFamily: 'Calibri' };
  const laidOut = shaping.shapeLaidOutText(span('Hi', style));
  expect(laidOut?.font.family).toBe(SHARED_TEST_FAMILY);
  expect(laidOut?.font.substitution).toEqual({
    requested: { family: 'Calibri', weight: 400, style: 'normal' },
    resolved: { family: SHARED_TEST_FAMILY, weight: 400, style: 'normal' },
  });
});

test('missing faces and empty text return null instead of a fallback glyph run', async () => {
  const shaping = await sharedShaping();
  expect(shaping.shapeLaidOutText(span(''))).toBeNull();
  expect(
    shaping.shapeLaidOutText(span('Hi', { ...DEFAULT_RUN_STYLE, fontFamily: 'Missing Face' }))
  ).toBeNull();
});

test('oversized input stays inside the measurement refusal bound', async () => {
  const shaping = await sharedShaping();
  const style = { ...DEFAULT_RUN_STYLE, fontFamily: SHARED_TEST_FAMILY };
  const overLimit = 'x'.repeat(1_000_001);
  expect(shaping.shapeLaidOutText(span(overLimit, style))).toBeNull();
  expect(shaping.createMeasurer().measure(overLimit, style)).toBeGreaterThan(0);
});

test('font-backed sessions shape published spans and keep prior results after disposal', async () => {
  const opened = await openFontBackedDocumentForExport(
    docx('<w:p><w:r><w:rPr><w:rFonts w:ascii="DejaVu Sans"/></w:rPr><w:t>Body</w:t></w:r></w:p>'),
    {
      fonts: defineFontResolver(() => ({
        sources: [
          {
            request: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
            id: 'session-dejavu',
            bytes: fontBytes,
            hash: fontHash,
            faceIndex: 0,
          },
        ],
        defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 22 },
      })),
    }
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;

  const layout = await opened.session.layout();
  const visits: StyleSpanRecord[] = [];
  forEachSemanticSpan(layout, ({ span: published }) => visits.push(published));
  const body = visits.find((published) => published.text === 'Body');
  expect(body).toBeDefined();
  const laidOut = opened.session.shapeLaidOutText(body!);
  expect(laidOut?.run.text).toBe('Body');
  expect(laidOut?.font.identity).toBe(`${fontHash}#0`);
  expect(laidOut?.font.hash).toBe(fontHash);
  expect(laidOut && 'bytes' in laidOut.font).toBe(false);
  const face = opened.session.admittedFontFace(laidOut!.font.request);
  expect(face?.identity).toBe(laidOut!.font.identity);
  expect(face?.bytes.byteLength).toBe(laidOut!.font.byteLength);
  expect(face?.bytes).toEqual(fontBytes);

  opened.session.dispose();
  expect(laidOut?.run.glyphs[0]?.id).toBeGreaterThan(0);
  expect(() => opened.session.shapeLaidOutText(body!)).toThrow(ExportResourceError);
  try {
    opened.session.shapeLaidOutText(body!);
  } catch (error) {
    expect((error as ExportResourceError).code).toBe('disposed');
  }
});

test('an aborted font-backed session refuses later laid-out shaping', async () => {
  const controller = new AbortController();
  const opened = await openFontBackedDocumentForExport(
    docx('<w:p><w:r><w:t>Abort</w:t></w:r></w:p>'),
    {
      fonts: defineFontResolver(() => ({
        sources: [
          {
            request: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
            id: 'abort-dejavu',
            bytes: fontBytes,
            hash: fontHash,
            faceIndex: 0,
          },
        ],
        defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 22 },
      })),
      signal: controller.signal,
    }
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  controller.abort('job-cancelled');
  expect(() =>
    opened.session.shapeLaidOutText(
      span('Abort', { ...DEFAULT_RUN_STYLE, fontFamily: 'DejaVu Sans' })
    )
  ).toThrow(ExportResourceError);
  try {
    opened.session.shapeLaidOutText(
      span('Abort', { ...DEFAULT_RUN_STYLE, fontFamily: 'DejaVu Sans' })
    );
  } catch (error) {
    expect((error as ExportResourceError).code).toBe('aborted');
  }
});

test('sessions without admitted fonts do not grow ExportSession with required shaping', async () => {
  const opened = openDocumentForExport(docx('<w:p><w:r><w:t>Fixed</w:t></w:r></w:p>'));
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  expect('shapeLaidOutText' in opened.session).toBe(false);
  opened.session.dispose();
});

test('font-backed sessions with no admitted source return null for laid-out text', async () => {
  const opened = await openFontBackedDocumentForExport(
    docx('<w:p><w:r><w:t>Fallback</w:t></w:r></w:p>'),
    { fonts: [] }
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  const layout = await opened.session.layout();
  const visits: StyleSpanRecord[] = [];
  forEachSemanticSpan(layout, ({ span: published }) => visits.push(published));
  expect(opened.session.shapeLaidOutText(visits[0]!)).toBeNull();
  opened.session.dispose();
});
