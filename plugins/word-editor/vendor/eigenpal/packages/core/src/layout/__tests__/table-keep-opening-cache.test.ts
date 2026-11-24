import { describe, expect, test } from 'bun:test';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { buildNumberingIndex } from '../numbering-index.ts';
import { createLayoutSession } from '../layout-session.ts';
import { tableKeepOpening, type TableKeepFlow } from '../table-row-keeps.ts';
import type { TableFlowDeps } from '../semantic-table-layout.ts';
import {
  load,
  lay,
  para,
  row,
  table,
  pages,
  read,
  W,
  styleCascade,
  measurer,
} from './table-row-keep-fixtures.ts';

const numbered =
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' +
  '<w:keepLines/><w:spacing w:line="280" w:lineRule="exact"/></w:pPr>' +
  '<w:r><w:t>alpha beta gamma delta epsilon zeta eta theta</w:t></w:r></w:p>';
const author =
  '<w:p><w:pPr><w:keepLines/><w:spacing w:line="280" w:lineRule="exact"/></w:pPr>' +
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> AUTHOR </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
const body = (cell: string) =>
  para('P', 7) +
  para('CAP', 1, { keep: true }) +
  table([row('R', { first: cell, cantSplit: true })]) +
  para('END');
const numbering = (left: number) =>
  buildNumberingIndex(
    read(
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">` +
        '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
        `<w:pPr><w:ind w:left="${left}"/></w:pPr></w:lvl></w:abstractNum>` +
        '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>',
      '/word/numbering.xml'
    ).root
  );

describe('table opening measurements after external input changes', () => {
  for (const retained of [false, true]) {
    for (const growing of [false, true]) {
      test(`numbering indent: retained=${retained}, growing=${growing}`, () => {
        const xml = body(numbered);
        const part = load(xml);
        const session = retained ? createLayoutSession() : undefined;
        const small = { numberingIndex: numbering(0) };
        const large = { numberingIndex: numbering(1800) };
        const before = pages(lay(part, 15, { ...(growing ? small : large), session }));
        const options = growing ? large : small;
        const actual = pages(lay(part, 15, { ...options, session }));
        const expected = pages(lay(load(xml), 15, options));
        expect(actual).toEqual(expected);
        expect(actual).not.toEqual(before);
        expect(actual.find((page) => page.includes('CAP1'))).toContain('alpha');
      });
      test(`document property: retained=${retained}, growing=${growing}`, () => {
        const xml = body(author);
        const part = load(xml);
        const session = retained ? createLayoutSession() : undefined;
        const small = { documentProperties: { creator: 'One' } };
        const large = {
          documentProperties: {
            creator: 'alpha beta gamma delta epsilon zeta eta theta '.repeat(3),
          },
        };
        const before = pages(lay(part, 15, { ...(growing ? small : large), session }));
        const options = growing ? large : small;
        const actual = pages(lay(part, 15, { ...options, session }));
        const expected = pages(lay(load(xml), 15, options));
        expect(actual).toEqual(expected);
        expect(actual).not.toEqual(before);
        expect(actual.find((page) => page.includes('CAP1'))).toContain(growing ? 'alpha' : 'One');
      });
    }
  }
});

test('ordinary repeated table probes share measurements only within one pass', () => {
  const part = load(table([row('R', { lines: 3 })]));
  const bodyNode = part.root.children.find((node) => node.kind === 'body') as OoxmlElement;
  const block = {
    kind: 'table',
    table: bodyNode.children.find((node) => node.kind === 'table') as OoxmlElement,
  };
  let calls = 0;
  const counted = {
    ...measurer,
    measure: (...args: Parameters<typeof measurer.measure>) => {
      calls++;
      return measurer.measure(...args);
    },
  };
  const deps: TableFlowDeps = {
    measurer: counted,
    producer: 'table-opening-test',
    styleCascade,
    nextLineId: (id, start) => `${id}:${start}`,
  };
  const flow: TableKeepFlow = {
    width: 310,
    styleCascade,
    displayMode: 'all-markup',
    authorFilter: undefined,
    compatibilityMode: 15,
  };
  const first = tableKeepOpening(block, flow, 170, deps);
  const measured = calls;
  expect(measured).toBeGreaterThan(0);
  expect(tableKeepOpening(block, flow, 170, deps)).toBe(first);
  expect(calls).toBe(measured);
  expect(tableKeepOpening(block, flow, 170, { ...deps })).toEqual(first);
  expect(calls).toBeGreaterThan(measured);
  const dynamic = { ...deps, pageExclusionZones: () => [] };
  tableKeepOpening(block, flow, 170, dynamic);
  const dynamicMeasured = calls;
  tableKeepOpening(block, flow, 170, dynamic);
  expect(calls).toBeGreaterThan(dynamicMeasured);
});

test('reset document properties removes cached field text in a retained layout', () => {
  const xml = body(author);
  const part = load(xml);
  const session = createLayoutSession();
  lay(part, 15, { session, documentProperties: { creator: 'One' } });
  const reset = lay(part, 15, { session });
  expect(pages(reset)).toEqual(pages(lay(load(xml), 15)));
  expect(pages(reset).join(' ')).not.toContain('One');
  const unchanged = lay(part, 15, { session, documentProperties: {} });
  expect(unchanged.pages[0]).toBe(reset.pages[0]);
});

test('changed scalar values invalidate a reused property object', () => {
  const xml = body(author);
  const part = load(xml);
  const session = createLayoutSession();
  const documentProperties = { creator: 'One' };
  const before = lay(part, 15, { session, documentProperties });
  expect(lay(part, 15, { session, documentProperties }).pages[0]).toBe(before.pages[0]);
  documentProperties.creator = 'Two';
  const changed = lay(part, 15, { session, documentProperties });
  expect(pages(changed)).toEqual(pages(lay(load(xml), 15, { documentProperties })));
  expect(pages(changed).join(' ')).toContain('Two');
  expect(pages(changed).join(' ')).not.toContain('One');
});

for (const projection of [
  { projectionEpoch: 'fixed' },
  { projectionTokenForParagraph: () => '' },
]) {
  test(`partial projection inputs retain property invalidation: ${Object.keys(projection)[0]}`, () => {
    const xml = body(author);
    const part = load(xml);
    const session = createLayoutSession();
    lay(part, 15, { session, ...projection, documentProperties: { creator: 'One' } });
    const documentProperties = { creator: 'Two' };
    const changed = lay(part, 15, { session, ...projection, documentProperties });
    expect(pages(changed)).toEqual(pages(lay(load(xml), 15, { documentProperties })));
    expect(pages(changed).join(' ')).toContain('Two');
    expect(pages(changed).join(' ')).not.toContain('One');
  });
}
