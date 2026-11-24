import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { fixture, p } from '../../layout/__tests__/table-exact-visible-fixtures.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

test('the source-derived exact row paints text through the paragraph clip without clipping cell borders', () => {
  const part = fixture(),
    before = serializeOoxmlPart(part);
  const result = layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer(6, 11) });
  const container = document.createElement('div');
  paintSemanticLayout(container, result, { scale: 2 });
  const cell = container.querySelector<HTMLElement>('.docx-table-cell')!;
  const paragraph = cell.querySelector<HTMLElement>('.docx-paragraph-fragment')!;
  expect(cell.style.overflow).toBe('visible');
  expect(cell.style.height).toBe('34px');
  expect(paragraph.textContent).toBe('甲');
  expect(paragraph.style.overflow).toBe('hidden');
  expect(paragraph.style.height).toBe('34px');
  expect(serializeOoxmlPart(part)).toBe(before);
});
test('retained paint removes clipping when the row returns to its minimum-height rule', () => {
  const container = document.createElement('div'),
    measurer = createFixedMeasurer(6, 11);
  paintSemanticLayout(container, layoutSemanticDocument(fixture(), 0, { measurer }), { scale: 1 });
  expect(container.querySelector<HTMLElement>('.docx-paragraph-fragment')!.style.overflow).toBe(
    'hidden'
  );
  paintSemanticLayout(container, layoutSemanticDocument(fixture('atLeast'), 1, { measurer }), {
    scale: 1,
  });
  expect(container.querySelector<HTMLElement>('.docx-paragraph-fragment')!.style.overflow).not.toBe(
    'hidden'
  );
  expect(container.querySelector<HTMLElement>('.docx-paragraph-fragment')!.textContent).toBe('甲');
});

test('the clip frame does not widen indented paragraph shading or move its border', () => {
  const props =
    '<w:ind w:left="240" w:right="120" w:hanging="120"/>' +
    '<w:pBdr><w:left w:val="single" w:sz="8" w:space="0"/></w:pBdr>' +
    '<w:shd w:val="clear" w:fill="FFFF00"/>';
  const geometry = (rule: string) => {
    const container = document.createElement('div');
    const result = layoutSemanticDocument(fixture(rule, p('A', 380, props)), 0, {
      measurer: createFixedMeasurer(6, 11),
    });
    paintSemanticLayout(container, result, { scale: 1 });
    const paragraph = container.querySelector<HTMLElement>('.docx-paragraph-fragment')!;
    const shading = paragraph.querySelector<HTMLElement>('.docx-paragraph-shading')!;
    const border = paragraph.querySelector<HTMLElement>('.docx-paragraph-border-left')!;
    return {
      overflow: paragraph.style.overflow,
      shadingX: parseFloat(paragraph.style.left) + parseFloat(shading.style.left),
      shadingWidth: shading.style.width,
      borderX: parseFloat(paragraph.style.left) + parseFloat(border.style.left),
      borderWidth: border.style.width,
    };
  };
  const exact = geometry('exact'),
    minimum = geometry('atLeast');
  expect(exact.overflow).toBe('hidden');
  expect(exact.shadingX).toBe(minimum.shadingX);
  expect(exact.shadingWidth).toBe(minimum.shadingWidth);
  expect(exact.borderX).toBe(minimum.borderX);
  expect(exact.borderWidth).toBe(minimum.borderWidth);
});
