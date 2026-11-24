// A chart paints through an installed renderer; without one it keeps its placeholder.

import { afterEach, expect, test } from 'bun:test';
import { projectDrawingsInPackage } from '../package/drawing-projection.ts';
import { drawingRenderers, installDrawingRenderers } from '../package/drawing-renderers.ts';
import { CATEGORY_VALUE_AXES, chartPackage, chartSpace, series } from './chart-fixture.ts';

const before = drawingRenderers();
afterEach(() =>
  installDrawingRenderers({ chart: before.chart, diagramLayout: before.diagramLayout })
);

const barChart = () =>
  chartPackage(
    chartSpace(
      `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${series(0, 'S', ['a', 'b'], [1, 2])}` +
        `<c:axId val="1"/><c:axId val="2"/></c:barChart>${CATEGORY_VALUE_AXES}`
    )
  );

test('a chart keeps its placeholder without a renderer', () => {
  installDrawingRenderers({ chart: undefined });
  const [drawing] = projectDrawingsInPackage(barChart());
  expect(drawing!.vectorShape).toBeNull();
  expect(drawing!.groupTextboxes).toBeUndefined();
});

test('an installed renderer paints the chart and reads its part', () => {
  const parts: string[] = [];
  installDrawingRenderers({
    chart(_anchor, extent, context) {
      parts.push(context.resolveChartPart ? 'resolver' : 'none');
      return {
        vectorShape: {
          extentEmu: { cx: extent.cx, cy: extent.cy },
          subpathsEmu: [],
          fillHex: null,
          strokeHex: null,
          strokeWidthEmu: 0,
          components: [
            {
              subpathsEmu: [
                [
                  { x: 0, y: 0 },
                  { x: extent.cx, y: 0 },
                  { x: 0, y: extent.cy },
                ],
              ],
              fillHex: 'FF0000',
              fillAlpha: 1,
              strokeHex: null,
              strokeAlpha: 1,
              strokeWidthEmu: 0,
            },
          ],
        },
        groupTextboxes: null,
      };
    },
  });
  const [drawing] = projectDrawingsInPackage(barChart());
  expect(parts).toEqual(['resolver']);
  expect(drawing!.vectorShape!.components[0]!.fillHex).toBe('FF0000');
});
