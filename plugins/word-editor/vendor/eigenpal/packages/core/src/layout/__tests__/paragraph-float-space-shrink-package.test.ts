import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { readOoxmlPackage, writeOoxmlPackage } from '../../store/package/ooxml-package.ts';
import type { ImageDecodePort } from '../../store/package/image-resources.ts';
import { createInlineDrawingLayoutBundle } from '../inline-drawing-source.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type SemanticLayout } from '../semantic-records.ts';
import {
  floatSpaceMeasurer,
  floatSpacePackage,
} from './paragraph-float-space-shrink-package-fixture.ts';

async function open(bytes: Uint8Array) {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const imageBytes = unzipSync(bytes)['word/media/image1.png']!;
  let decodeCalls = 0;
  // The package validates the real PNG header and bytes. This port does not decode browser pixels.
  const decodePort: ImageDecodePort = {
    async decode(source, mime, _limits, signal) {
      decodeCalls += 1;
      expect(source).toEqual(imageBytes);
      expect(mime).toBe('image/png');
      expect(signal?.aborted).toBe(false);
      return { pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 };
    },
  };
  let notifySettled = () => {};
  const settled = new Promise<void>((resolve) => {
    notifySettled = resolve;
  });
  const bundle = createInlineDrawingLayoutBundle({
    session: {
      packageRevision: () => 0,
      currentPackage: () => loaded.package,
      part: () => part,
    },
    decodePort,
    onResourcesChanged: () => notifySettled(),
  });
  const layout = () =>
    layoutSemanticDocument(part, 0, {
      measurer: floatSpaceMeasurer,
      compatibilityMode: 15,
      inlineDrawingLayout: bundle.bodyContext,
    });
  try {
    layout();
    expect(bundle.pendingResourceCount()).toBe(1);
    await settled;
    expect(bundle.pendingResourceCount()).toBe(0);
    expect(decodeCalls).toBe(1);
    const result = layout();
    const resource = result.pages[0]!.anchoredDrawings![0]!.resource;
    expect(resource.kind).toBe('ready');
    if (resource.kind !== 'ready') throw Error('The package picture did not validate');
    expect(bundle.mintValidatedBytes(resource.validatedHandle, resource.contentId)).toEqual(
      imageBytes
    );
    return { package: loaded.package, layout: result };
  } finally {
    // The caller inspects geometry only. Release the lookup and every retained byte handle.
    bundle.dispose();
  }
}

const geometry = (layout: SemanticLayout) =>
  linesOf(layout).map((line) => ({
    box: line.box,
    spans: line.spans.map((span) => ({ text: span.text, box: span.box, style: span.style })),
  }));

test('real square picture projection compresses each passage and survives save/reopen', async () => {
  const source = floatSpacePackage();
  const original = await open(source);
  const image = original.layout.pages[0]!.anchoredDrawings![0]!;
  expect(image.x).toBe(162);
  expect(image.width).toBe(108);
  const first = linesOf(original.layout)[0]!;
  const right = first.spans.filter((span) => span.box.x >= 270);
  expect(
    right
      .map((span) => span.text)
      .join('')
      .trimEnd()
  ).toBe('hh ii jj');
  expect(
    right.at(-1)!.box.x +
      floatSpaceMeasurer.measure(right.at(-1)!.text.trimEnd(), right.at(-1)!.style)
  ).toBeCloseTo(336, 6);
  for (const line of linesOf(original.layout)) {
    for (const span of line.spans) {
      if (!span.text.trimEnd()) continue;
      const end = span.box.x + floatSpaceMeasurer.measure(span.text.trimEnd(), span.style);
      expect(end <= 162.001 || span.box.x >= 269.999).toBe(true);
    }
  }
  const saved = writeOoxmlPackage(original.package);
  const reopened = await open(saved);
  expect(geometry(reopened.layout)).toEqual(geometry(original.layout));
  const restoredImage = reopened.layout.pages[0]!.anchoredDrawings![0]!;
  expect([restoredImage.x, restoredImage.y, restoredImage.width, restoredImage.height]).toEqual([
    image.x,
    image.y,
    image.width,
    image.height,
  ]);
  const before = unzipSync(source);
  const after = unzipSync(saved);
  expect(after['word/media/image1.png']).toEqual(before['word/media/image1.png']);
  expect(strFromU8(after['word/document.xml']!)).toContain('wp:anchor');
  expect(strFromU8(after['word/document.xml']!)).not.toMatch(/<w:spacing(?:\s|\/|>)/u);
  expect(strFromU8(after['word/settings.xml']!)).toContain('w:val="15"');
});

test('real square picture keeps ordinary left-aligned wrapping', async () => {
  const { layout } = await open(floatSpacePackage('left'));
  const right = linesOf(layout)[0]!.spans.filter((span) => span.box.x >= 270);
  expect(
    right
      .map((span) => span.text)
      .join('')
      .trimEnd()
  ).toBe('gg hh');
  expect(right.every((span) => !span.style.shaping?.wordSpacingPt)).toBe(true);
});
