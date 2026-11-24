import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { DEFAULT_RUN_STYLE } from '../../layout/run-style.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import { applyTextOutline } from '../semantic-paint-text-outline.ts';
import { recordWebkitStyleWrites } from './style-writes.ts';

let styles: ReturnType<typeof recordWebkitStyleWrites>;
beforeEach(() => {
  styles = recordWebkitStyleWrites();
});
afterEach(() => styles.stop());

describe('text outline paint', () => {
  test('paints a glyph stroke at zoom scale, retaining one selectable text node and fill', () => {
    const read = readOoxmlPart(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body><w:p><w:r><w:rPr><w:color w:val="CC0000"/><w14:textOutline w14:w="12700"><w14:solidFill><w14:srgbClr w14:val="00AA00"/></w14:solidFill></w14:textOutline></w:rPr><w:t>Sample</w:t></w:r></w:p></w:body></w:document>',
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const before = serializeOoxmlPart(read.part);
    const layout = layoutSemanticDocument(read.part, 1, { measurer: createFixedMeasurer(6, 14) });
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 2 });
    const span = container.querySelector<HTMLElement>('.layout-run-text')!;
    expect(styles.writes).toEqual([
      ['-webkit-text-stroke-width', '2px'],
      ['-webkit-text-stroke-color', '#00AA00'],
    ]);
    expect(span.style.color).toBe('#CC0000');
    expect(span.style.fontWeight).toBe('');
    expect(span.childNodes).toHaveLength(1);
    expect(span.firstChild?.nodeType).toBe(3);
    expect(span.textContent).toBe('Sample');
    expect(span.dataset.start).toBe('0');
    expect(span.dataset.end).toBe('6');
    expect(serializeOoxmlPart(read.part)).toBe(before);
  });
  test('the paint sink independently refuses invalid values', () => {
    for (const outline of [
      { widthPt: NaN, color: '000000' },
      { widthPt: Infinity, color: '000000' },
      { widthPt: -1, color: '000000' },
      { widthPt: 1585, color: '000000' },
      { widthPt: 1, color: 'url(https://bad.invalid)' },
    ]) {
      const css = document.createElement('span').style;
      applyTextOutline(css, { ...DEFAULT_RUN_STYLE, textOutline: outline }, 1);
      expect(css.cssText).toBe('');
      expect(styles.writes).toEqual([]);
    }
    for (const scale of [0, -1, Infinity, NaN]) {
      const css = document.createElement('span').style;
      applyTextOutline(
        css,
        { ...DEFAULT_RUN_STYLE, textOutline: { widthPt: 1, color: '000000' } },
        scale
      );
      expect(css.cssText).toBe('');
      expect(styles.writes).toEqual([]);
    }
  });
  test('ordinary run styles do not acquire a stroke', () => {
    const css = document.createElement('span').style;
    applyTextOutline(css, DEFAULT_RUN_STYLE, 1);
    expect(css.cssText).toBe('');
    expect(styles.writes).toEqual([]);
  });
});
