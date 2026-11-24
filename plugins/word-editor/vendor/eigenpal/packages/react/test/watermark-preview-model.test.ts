// The Watermark dialog preview geometry for the caret's section: the page proportion, the
// text area, and the shape the command writes, in portrait and landscape. The model is
// byte-identical in both adapters, so one suite covers both.

import { describe, expect, test } from 'bun:test';
import type { PageSetup } from '@docx-editor.dev/core/contracts/editor';
import {
  DEFAULT_WATERMARK_FIELDS,
  watermarkPreviewLines,
  watermarkPreviewPage,
  watermarkPreviewText,
} from '../src/editor/watermark-dialog-model';

const MARGINS = { top: 1440, right: 1440, bottom: 1440, left: 1440 };
const LANDSCAPE: PageSetup = {
  pageWidthTwips: 15840,
  pageHeightTwips: 12240,
  orientation: 'landscape',
  marginsTwips: MARGINS,
};
const draft = { ...DEFAULT_WATERMARK_FIELDS, kind: 'text' as const, text: 'DRAFT' };

describe('watermark preview geometry', () => {
  test('without a page setup the preview is a portrait Letter page', () => {
    const page = watermarkPreviewPage(null);
    expect(page).toEqual({
      width: 612,
      height: 792,
      area: { x: 72, y: 72, width: 468, height: 648 },
    });
  });

  test('a landscape section draws a landscape page and keeps the lines in its text area', () => {
    const page = watermarkPreviewPage(LANDSCAPE);
    expect(page).toMatchObject({ width: 792, height: 612 });
    expect(page.area).toEqual({ x: 72, y: 72, width: 648, height: 468 });
    for (const line of watermarkPreviewLines(page)) {
      expect(line.x + line.width).toBeLessThanOrEqual(72 + 648);
      expect(line.y + line.height).toBeLessThanOrEqual(72 + 468);
    }
  });

  test('a diagonal shape turned on its center stays inside the text area in both orientations', () => {
    for (const setup of [null, LANDSCAPE]) {
      const page = watermarkPreviewPage(setup);
      const { box } = watermarkPreviewText({ ...draft, layout: 'diagonal' }, page)!;
      const span = (box.width + box.height) / Math.SQRT2;
      expect(span).toBeLessThanOrEqual(Math.min(page.area.width, page.area.height) + 0.01);
      expect(box.x + box.width / 2).toBeCloseTo(page.area.x + page.area.width / 2, 1);
      expect(box.y + box.height / 2).toBeCloseTo(page.area.y + page.area.height / 2, 1);
    }
  });

  test('a horizontal shape spans the text area width of the section', () => {
    const page = watermarkPreviewPage(LANDSCAPE);
    const { box } = watermarkPreviewText({ ...draft, layout: 'horizontal' }, page)!;
    expect(box.width).toBe(648);
  });
});
