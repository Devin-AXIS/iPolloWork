// A chart that does not paint carries the title it shows and its plot types, so a host
// component that replaces its placeholder can name the chart.

import { expect, test } from 'bun:test';
import { projectDrawingsInPackage } from '../package/drawing-projection.ts';
import { drawingRenderers } from '../package/drawing-renderers.ts';
import { CATEGORY_VALUE_AXES, chartPackage, chartSpace, series } from './chart-fixture.ts';

const BAR =
  '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>' +
  series(0, 'One', ['A', 'B'], [1, 2]) +
  '<c:axId val="1"/><c:axId val="2"/></c:barChart>';
const LINE =
  '<c:lineChart><c:grouping val="standard"/>' +
  series(1, 'Two', ['A', 'B'], [3, 4]) +
  '<c:axId val="1"/><c:axId val="2"/></c:lineChart>';

test('an unpainted chart carries its title and plot types', () => {
  expect(drawingRenderers().chart).toBeUndefined();
  const [projection] = projectDrawingsInPackage(
    chartPackage(chartSpace(BAR + LINE + CATEGORY_VALUE_AXES, { title: 'Revenue  by\nquarter' }))
  );
  expect(projection!.chartSummary).toEqual({
    title: 'Revenue by quarter',
    plotTypes: ['bar', 'line'],
    shownAs: 'placeholder',
  });
});

test('a chart without a title has a null title', () => {
  const [projection] = projectDrawingsInPackage(
    chartPackage(chartSpace(BAR + CATEGORY_VALUE_AXES))
  );
  expect(projection!.chartSummary).toEqual({
    title: null,
    plotTypes: ['bar'],
    shownAs: 'placeholder',
  });
});

const summaryOf = (xml: string) => projectDrawingsInPackage(chartPackage(xml))[0]!.chartSummary;
const automatic = (xml: string) =>
  xml.replace('<c:autoTitleDeleted val="1"/>', '<c:autoTitleDeleted val="0"/>');

test('title paragraphs and line breaks read as spaces', () => {
  const twoLines = 'Revenue</a:t></a:r></a:p><a:p><a:r><a:t>2024';
  const summary = summaryOf(chartSpace(BAR + CATEGORY_VALUE_AXES, { title: twoLines }));
  expect(summary?.title).toBe('Revenue 2024');
});

test('a title from a cell reads its cached text', () => {
  const cell =
    '<c:title><c:tx><c:strRef><c:f>S!A1</c:f><c:strCache><c:ptCount val="1"/>' +
    '<c:pt idx="0"><c:v>Sales</c:v></c:pt></c:strCache></c:strRef></c:tx></c:title>';
  const xml = chartSpace(BAR + CATEGORY_VALUE_AXES).replace(
    '<c:autoTitleDeleted',
    `${cell}<c:autoTitleDeleted`
  );
  expect(summaryOf(xml)?.title).toBe('Sales');
});

test('an automatic title is the name of the only series', () => {
  expect(summaryOf(automatic(chartSpace(BAR + CATEGORY_VALUE_AXES)))?.title).toBe('One');
  expect(summaryOf(automatic(chartSpace(BAR + LINE + CATEGORY_VALUE_AXES)))?.title).toBeNull();
});

test('a bare automatic-title flag deletes the automatic title', () => {
  const xml = chartSpace(BAR + CATEGORY_VALUE_AXES).replace(
    '<c:autoTitleDeleted val="1"/>',
    '<c:autoTitleDeleted/>'
  );
  expect(summaryOf(xml)?.title).toBeNull();
});

test('an authored title with empty text shows no title', () => {
  const empty = automatic(chartSpace(BAR + CATEGORY_VALUE_AXES)).replace(
    '<c:autoTitleDeleted',
    '<c:title><c:tx><c:rich><a:bodyPr/><a:p/></c:rich></c:tx></c:title><c:autoTitleDeleted'
  );
  expect(summaryOf(empty)?.title).toBeNull();
});

test('an automatic title shows the first cell of a series name', () => {
  const twoCells = series(0, 'One', ['A', 'B'], [1, 2]).replace(
    '<c:pt idx="0"><c:v>One</c:v></c:pt>',
    '<c:pt idx="0"><c:v>One</c:v></c:pt><c:pt idx="1"><c:v>Extra</c:v></c:pt>'
  );
  const bar = BAR.replace(series(0, 'One', ['A', 'B'], [1, 2]), twoCells);
  expect(summaryOf(automatic(chartSpace(bar + CATEGORY_VALUE_AXES)))?.title).toBe('One');
});
