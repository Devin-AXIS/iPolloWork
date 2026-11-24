// Faces that chart parts name for their labels, outside every document story.

import { expect, test } from 'bun:test';
import { drawingPartFontFamilies } from '../package/drawing-part-fonts.ts';
import { CATEGORY_VALUE_AXES, chartPackage, chartSpace, series } from './chart-fixture.ts';

test('chart parts name their faces and each theme token resolves to its own slot', () => {
  const plot =
    '<c:barChart><c:barDir val="col"/>' +
    series(0, 'Alpha', ['A'], [1]) +
    '<c:axId val="1"/><c:axId val="2"/></c:barChart>' +
    CATEGORY_VALUE_AXES;
  const xml = chartSpace(plot).replace(
    '</c:chartSpace>',
    '<c:txPr><a:bodyPr/><a:p><a:pPr><a:defRPr><a:latin typeface="Georgia"/>' +
      '<a:ea typeface="+mj-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:pPr></a:p></c:txPr>' +
      '</c:chartSpace>'
  );
  const families = drawingPartFontFamilies(chartPackage(xml), {
    major: 'Major Face',
    minor: 'Minor Face',
    majorEastAsia: 'Major East Asian Face',
    minorBidi: 'Minor Complex Face',
  });
  // Latin labels only: the East Asian and complex script faces would render nothing.
  expect(families).toEqual(['Minor Face', 'Georgia']);
});

test('a chart asks for its East Asian and complex script faces only for text in them', () => {
  const plot = (name: string) =>
    '<c:barChart><c:barDir val="col"/>' +
    series(0, name, ['A'], [1]) +
    '<c:axId val="1"/><c:axId val="2"/></c:barChart>' +
    CATEGORY_VALUE_AXES;
  const withFaces = (name: string) =>
    chartSpace(plot(name)).replace(
      '</c:chartSpace>',
      '<c:txPr><a:bodyPr/><a:p><a:pPr><a:defRPr><a:latin typeface="+mn-lt"/>' +
        '<a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:pPr></a:p></c:txPr>' +
        '</c:chartSpace>'
    );
  const theme = { minor: 'Body', minorEastAsia: 'CJK Body', minorBidi: 'Bidi Body' };
  expect(drawingPartFontFamilies(chartPackage(withFaces('Sales')), theme)).toEqual(['Body']);
  expect(drawingPartFontFamilies(chartPackage(withFaces('売上')), theme)).toEqual([
    'Body',
    'CJK Body',
  ]);
  expect(drawingPartFontFamilies(chartPackage(withFaces('מכירות')), theme)).toEqual([
    'Body',
    'Bidi Body',
  ]);
});
