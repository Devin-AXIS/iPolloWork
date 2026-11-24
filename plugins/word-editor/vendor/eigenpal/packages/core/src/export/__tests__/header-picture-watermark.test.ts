// A header picture watermark as authored VML: a picture frame shape (`#_x0000_t75`) whose
// template omits its formulas, placed absolutely, centered on the margin box, behind the text,
// with a `w10:wrap` anchored to the margin. It is furniture on every page that shows the header.

import { describe, expect, test } from 'bun:test';
import type { AnchoredDrawingRecord } from '../../layout/drawing-layout.ts';
import type { SemanticLayout } from '../../layout/semantic-records.ts';
import { readOoxmlPackage, writeOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { serializeOoxmlPart } from '../../store/package/ooxml-serialize.ts';
import {
  applyPackageWatermark,
  readPackageWatermark,
} from '../../store/package/watermark-package.ts';
import { docx, layoutOf, MARGIN_BOX, PNG } from './header-picture-watermark-fixture.ts';

/** The header picture of each page, in page coordinates. */
function pictures(layout: SemanticLayout) {
  return layout.pages.map((page) => {
    const drawings: readonly AnchoredDrawingRecord[] = page.header?.anchoredDrawings ?? [];
    expect(drawings).toHaveLength(1);
    const drawing = drawings[0]!;
    // The header box is in document coordinates, where pages stack.
    const origin = page.header!.box;
    return {
      drawing,
      box: {
        x: origin.x - page.box.x + drawing.x,
        y: origin.y - page.box.y + drawing.y,
        width: drawing.width,
        height: drawing.height,
      },
    };
  });
}

function expectCentered(box: { x: number; y: number; width: number; height: number }) {
  expect(box.x + box.width / 2).toBeCloseTo(MARGIN_BOX.x + MARGIN_BOX.width / 2, 3);
  expect(box.y + box.height / 2).toBeCloseTo(MARGIN_BOX.y + MARGIN_BOX.height / 2, 3);
}

describe('an authored header picture watermark', () => {
  test.each([
    [200, 100],
    [595.2, 841.9],
  ])(
    'a %d by %d pt picture sits centered on the margin box behind the text on every page',
    async (width, height) => {
      const layout = await layoutOf(docx({ width, height }));
      expect(layout.contentWarnings ?? []).toEqual([]);
      expect(layout.pages).toHaveLength(3);
      for (const { drawing, box } of pictures(layout)) {
        expect(box.width).toBeCloseTo(width, 3);
        expect(box.height).toBeCloseTo(height, 3);
        expectCentered(box);
        expect(drawing.behindDocument).toBe(true);
        expect(drawing.wrap).toBe('behind');
        expect([drawing.horizontalFrame, drawing.verticalFrame]).toEqual(['margin', 'margin']);
        expect(drawing.resource.kind).toBe('ready');
        expect(drawing.effects).toEqual({ grayscale: false, brightness: 0, contrast: 0 });
      }
    }
  );

  test('gain and black level wash the picture out', async () => {
    const layout = await layoutOf(docx({ imageData: ' gain="19661f" blacklevel="22938f"' }));
    for (const { drawing, box } of pictures(layout)) {
      expectCentered(box);
      expect(drawing.effects.brightness).toBeGreaterThan(0);
      expect(drawing.effects.contrast).toBeLessThan(0);
    }
  });

  test('an external picture is never fetched', async () => {
    const layout = await layoutOf(docx({ external: true }));
    for (const { drawing } of pictures(layout)) expect(drawing.resource.kind).toBe('external');
  });

  test('a picture that also names a linked source file stays refused', async () => {
    const layout = await layoutOf(docx({ imageData: ' o:href="file:///C:/images/wm.png"' }));
    expect(layout.contentWarnings).toContainEqual(
      expect.objectContaining({ code: 'legacy-drawing' })
    );
    for (const page of layout.pages) expect(page.header?.anchoredDrawings ?? []).toEqual([]);
  });

  test('the header markup survives save and reopen unchanged', () => {
    const read = readOoxmlPackage(docx({ imageData: ' gain="19661f" blacklevel="22938f"' }));
    if (!read.ok) throw new Error(read.reason);
    const reread = readOoxmlPackage(writeOoxmlPackage(read.package));
    if (!reread.ok) throw new Error(reread.reason);
    const before = serializeOoxmlPart(read.package.parts.get('/word/header1.xml')!);
    expect(serializeOoxmlPart(reread.package.parts.get('/word/header1.xml')!)).toBe(before);
    expect(before).toContain('o:spt="75"');
    expect(before).not.toContain('v:formulas');
    expect(before).toContain('<w10:wrap anchorx="margin" anchory="margin"/>');
  });

  test('the watermark API reads, replaces and removes it', () => {
    const read = readOoxmlPackage(docx({ imageData: ' gain="19661f" blacklevel="22938f"' }));
    if (!read.ok) throw new Error(read.reason);
    expect(readPackageWatermark(read.package)).toMatchObject({
      kind: 'picture',
      washout: true,
      widthPt: 200,
      heightPt: 100,
      relationshipId: 'rImg',
      mediaPartName: '/word/media/wm.png',
    });
    const replaced = applyPackageWatermark(
      read.package,
      {
        kind: 'picture',
        washout: false,
        widthPt: 120,
        heightPt: 60,
        image: { bytes: PNG, mime: 'image/png' },
      },
      () => null
    );
    if (!replaced.ok) throw new Error(replaced.detail);
    const xml = serializeOoxmlPart(replaced.package.parts.get('/word/header1.xml')!);
    expect(xml.match(/WordPictureWatermark/g)).toHaveLength(1);
    expect(xml).not.toContain('o:title="wm"');
    expect(readPackageWatermark(replaced.package)).toMatchObject({
      kind: 'picture',
      washout: false,
      widthPt: 120,
    });
    // The authored picture's media goes with it.
    expect(replaced.package.partBytes.has('/word/media/wm.png')).toBe(false);
    const removed = applyPackageWatermark(read.package, null, () => null);
    if (!removed.ok) throw new Error(removed.detail);
    expect(readPackageWatermark(removed.package)).toBeNull();
    expect(serializeOoxmlPart(removed.package.parts.get('/word/header1.xml')!)).not.toContain(
      'WordPictureWatermark'
    );
  });
});
