import { expect, test } from 'bun:test';
import {
  DEFAULT_RUN_STYLE,
  FontResolutionError,
  createLayoutShaping,
  disposeLayoutShaping,
  fontRequestKey,
  prepareLayoutFontConfiguration,
  sha256FontBytes,
  type LayoutShapingOptions,
} from '../../layout/index.ts';
import {
  describeAdmittedFontIdentity,
  snapshotAdmittedFontFace,
} from '../document-export-font-resolution.ts';
import { trustedFontBytes } from '../../layout/font-resource.ts';
import { bindExportLaidOutText } from '../export-laid-out-text.ts';
import {
  createShapingFontResolutionCache,
  resolveShapingFontFace,
  resolveShapingFontFromStyle,
} from '../export-shaping-font-resolution.ts';
import { acquireSharedExportShaping } from '../shared-export-shaping.ts';

const fontUrl = new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url);
const SHARED_FAMILY = 'Shaping Resolver DejaVu';

async function preparedShaping(defaultFamily = SHARED_FAMILY) {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const hash = sha256FontBytes(bytes);
  const request = { family: SHARED_FAMILY, weight: 400, style: 'normal' as const };
  const prepared = prepareLayoutFontConfiguration({
    epoch: 1,
    maxFontBytes: 2_000_000,
    sources: [{ request, id: 'shaping-resolver-dejavu', bytes, hash, faceIndex: 0 }],
    defaultFont: { family: defaultFamily, sizeHalfPoints: 22 },
  });
  const shaping = await createLayoutShaping(prepared);
  return { shaping, prepared, bytes, hash, request };
}

test('resolveShapingFontFromStyle applies default family, weight/style mapping, and request-key cache', async () => {
  const { shaping } = await preparedShaping();
  const cache = createShapingFontResolutionCache();

  const normal = resolveShapingFontFromStyle(shaping, cache, {
    ...DEFAULT_RUN_STYLE,
    fontFamily: SHARED_FAMILY,
  });
  resolveShapingFontFromStyle(shaping, cache, {
    ...DEFAULT_RUN_STYLE,
    fontFamily: SHARED_FAMILY,
    bold: true,
    italic: true,
  });
  const cachedNormal = resolveShapingFontFromStyle(shaping, cache, {
    ...DEFAULT_RUN_STYLE,
    fontFamily: SHARED_FAMILY,
  });
  const defaulted = resolveShapingFontFromStyle(shaping, cache, {
    ...DEFAULT_RUN_STYLE,
    fontFamily: null,
  });

  expect(normal).not.toBeNull();
  expect(cache.has(fontRequestKey({ family: SHARED_FAMILY, weight: 700, style: 'italic' }))).toBe(
    true
  );
  expect(cachedNormal).toBe(normal);
  expect(defaulted).toBe(normal);
  expect(cache.size).toBe(2);
  disposeLayoutShaping(shaping);
});

test('resolveShapingFontFace swallows thrown resolution and caches FontResolutionError as null', async () => {
  const { shaping } = await preparedShaping();
  const cache = createShapingFontResolutionCache();
  const throwing = {
    ...shaping,
    fonts: {
      ...shaping.fonts,
      resolve() {
        throw new Error('resolver exploded');
      },
    },
  } satisfies LayoutShapingOptions;

  expect(
    resolveShapingFontFace(throwing, cache, 'Throwing Face', { bold: false, italic: false })
  ).toBeNull();
  expect(
    resolveShapingFontFace(throwing, cache, 'Throwing Face', { bold: false, italic: false })
  ).toBeNull();
  expect(cache.size).toBe(0);

  const missing = resolveShapingFontFace(shaping, cache, 'Missing Face', {
    bold: false,
    italic: false,
  });
  expect(missing).toBeNull();
  expect(
    cache.get(fontRequestKey({ family: 'Missing Face', weight: 400, style: 'normal' }))
  ).toBeInstanceOf(FontResolutionError);
  expect(
    resolveShapingFontFace(shaping, cache, 'Missing Face', { bold: false, italic: false })
  ).toBeNull();
  expect(cache.size).toBe(1);

  disposeLayoutShaping(shaping);
});

test('shared export measurement and laid-out text resolve the same admitted face policy', async () => {
  const { prepared } = await preparedShaping();
  const shaping = await acquireSharedExportShaping(prepared);
  const style = { ...DEFAULT_RUN_STYLE, fontFamily: SHARED_FAMILY };
  const measurer = shaping.createMeasurer();
  const laidOut = shaping.shapeLaidOutText({
    range: { paragraphId: 'p', start: 0, end: 3 },
    text: 'Hi!',
    props: [],
    style,
    box: { x: 0, y: 0, width: 0, height: 0 },
  });

  expect(laidOut).not.toBeNull();
  expect(laidOut?.font.request).toEqual({
    family: SHARED_FAMILY,
    weight: 400,
    style: 'normal',
  });
  expect(measurer.measure('Hi!', style)).toBeGreaterThan(0);
  expect(
    shaping.shapeLaidOutText({
      range: { paragraphId: 'p', start: 0, end: 0 },
      text: '',
      props: [],
      style,
      box: { x: 0, y: 0, width: 0, height: 0 },
    })
  ).toBeNull();
  expect(measurer.measure('', style)).toBe(0);
});

test('bindExportLaidOutText and shaped measurer share one resolver implementation', async () => {
  const { shaping } = await preparedShaping('Default Fallback Family');
  const cache = createShapingFontResolutionCache();
  const fromStyle = resolveShapingFontFromStyle(shaping, cache, {
    ...DEFAULT_RUN_STYLE,
    fontFamily: null,
  });
  const fromFace = resolveShapingFontFace(shaping, cache, 'Default Fallback Family', {
    bold: false,
    italic: false,
  });
  expect(fromStyle).toBe(fromFace);

  const substrate = bindExportLaidOutText(shaping);
  const laidOut = substrate({
    range: { paragraphId: 'p', start: 0, end: 4 },
    text: 'Same',
    props: [],
    style: { ...DEFAULT_RUN_STYLE, fontFamily: null },
    box: { x: 0, y: 0, width: 0, height: 0 },
  });
  expect(laidOut?.font.identity).toBe(fromStyle?.identity);
  disposeLayoutShaping(shaping);
});

test('snapshotAdmittedFontFace exposes the shared session buffer, not a defensive copy', async () => {
  const { shaping, request } = await preparedShaping();
  const resolved = shaping.fonts.resolve(request);
  if (resolved instanceof FontResolutionError) throw resolved;
  const snapshot = snapshotAdmittedFontFace(resolved);
  expect(snapshot.bytes).toBe(trustedFontBytes(resolved));
  expect(snapshot.bytes).not.toBe(resolved.bytes);
  expect(describeAdmittedFontIdentity(resolved).byteLength).toBe(snapshot.byteLength);
  disposeLayoutShaping(shaping);
});
