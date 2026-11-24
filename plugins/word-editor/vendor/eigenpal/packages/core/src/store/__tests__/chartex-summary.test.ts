// A chartex chart (waterfall, funnel, histogram, ...) with no renderer installed shows the
// picture fallback of its `mc:AlternateContent` when it has one that paints, and otherwise
// keeps the labelled `chart` placeholder with a summary. It never paints nothing.

import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { drawingPaintFields } from '../../layout/drawing-paint-fields.ts';
import { diagramPartsToken } from '../package/diagram-parts.ts';
import { projectDrawingsInPackage } from '../package/drawing-projection.ts';
import { drawingRenderers } from '../package/drawing-renderers.ts';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import { chartexDocx, chartexPackage, waterfallChartSpace } from './chartex-fixture.ts';

test('a chartex chart without a renderer keeps a chart placeholder with its summary', () => {
  expect(drawingRenderers().chart).toBeUndefined();
  const [projection] = projectDrawingsInPackage(
    chartexPackage(waterfallChartSpace({ title: 'Net  cash' }))
  );
  expect(projection!.picture).toBeNull();
  expect(projection!.chartSummary).toEqual({
    title: 'Net cash',
    plotTypes: ['waterfall'],
    shownAs: 'placeholder',
  });
  const fields = drawingPaintFields(projection!);
  expect(fields.placeholderGraphicKind).toBe('chart');
  expect(fields.chart?.plotTypes).toEqual(['waterfall']);
});

test('without a renderer, a wrapped chartex chart shows its fallback picture', () => {
  const [projection] = projectDrawingsInPackage(
    chartexPackage(waterfallChartSpace({ title: 'Net' }), { alternateContent: true })
  );
  expect(projection!.picture?.embeddedRelationshipId).toBe('rId11');
  // The fallback carries the chart's summary, so a host can tell it stands for a chart.
  expect(projection!.chartSummary).toEqual({
    title: 'Net',
    plotTypes: ['waterfall'],
    shownAs: 'fallback',
  });
  expect(drawingPaintFields(projection!).placeholderGraphicKind).toBeFalsy();
  expect(drawingPaintFields(projection!).chart?.title).toBe('Net');
});

test('without a renderer or a fallback that paints, the chart placeholder shows', () => {
  const [projection] = projectDrawingsInPackage(
    chartexPackage(waterfallChartSpace({ title: 'Net' }), {
      alternateContent: true,
      emptyFallback: true,
    })
  );
  expect(projection!.picture).toBeNull();
  expect(drawingPaintFields(projection!).placeholderGraphicKind).toBe('chart');
  expect(projection!.chartSummary).toEqual({
    title: 'Net',
    plotTypes: ['waterfall'],
    shownAs: 'placeholder',
  });
});

test('an empty title element and a missing title both read as no title', () => {
  const empty = projectDrawingsInPackage(chartexPackage(waterfallChartSpace()));
  expect(empty[0]!.chartSummary?.title).toBeNull();
  const none = projectDrawingsInPackage(chartexPackage(waterfallChartSpace({ title: null })));
  expect(none[0]!.chartSummary?.title).toBeNull();
});

test('layout ids map to plot types; a Pareto chart is one plot type', () => {
  const pareto = waterfallChartSpace({ layoutId: 'clusteredColumn' }).replace(
    '</cx:plotAreaRegion>',
    '<cx:series layoutId="paretoLine" ownerIdx="0"><cx:dataId val="0"/></cx:series></cx:plotAreaRegion>'
  );
  expect(projectDrawingsInPackage(chartexPackage(pareto))[0]!.chartSummary?.plotTypes).toEqual([
    'pareto',
  ]);
  const histogram = waterfallChartSpace({ layoutId: 'clusteredColumn' });
  expect(projectDrawingsInPackage(chartexPackage(histogram))[0]!.chartSummary?.plotTypes).toEqual([
    'histogram',
  ]);
  for (const layoutId of ['__proto__', 'constructor', 'unknownLayout']) {
    const summary = projectDrawingsInPackage(chartexPackage(waterfallChartSpace({ layoutId })))[0]!
      .chartSummary;
    expect(summary?.plotTypes).toEqual([]);
  }
});

test('a chartex chart reports one plot type, also when its series name several', () => {
  const mixed = waterfallChartSpace().replace(
    '</cx:plotAreaRegion>',
    '<cx:series layoutId="funnel"><cx:dataId val="0"/></cx:series></cx:plotAreaRegion>'
  );
  expect(projectDrawingsInPackage(chartexPackage(mixed))[0]!.chartSummary?.plotTypes).toEqual([
    'waterfall',
  ]);
});

test('the parts token covers chartex and chart style parts', () => {
  const token = diagramPartsToken(chartexPackage(waterfallChartSpace()));
  expect(token.split(',')).toHaveLength(3);
});

test('a chart in a Choice the reader does not support still names the chart its fallback shows', () => {
  const files = unzipSync(
    chartexDocx(waterfallChartSpace({ title: 'Net' }), { alternateContent: true })
  );
  files['word/document.xml'] = strToU8(
    strFromU8(files['word/document.xml']!)
      .replace('Requires="cx1"', 'Requires="zz"')
      .replace('<w:document ', '<w:document xmlns:zz="urn:example:unknown-namespace" ')
  );
  const loaded = readOoxmlPackage(zipSync(files));
  if (!loaded.ok) throw new Error(loaded.reason);
  const [projection] = projectDrawingsInPackage(loaded.package);
  expect(projection!.picture?.embeddedRelationshipId).toBe('rId11');
  expect(projection!.chartSummary).toEqual({
    title: 'Net',
    plotTypes: ['waterfall'],
    shownAs: 'fallback',
  });
  expect(projection!.chartFallbackPicture).toEqual(projection!.picture!);
  expect(drawingPaintFields(projection!).chart?.shownAs).toBe('fallback');
});
