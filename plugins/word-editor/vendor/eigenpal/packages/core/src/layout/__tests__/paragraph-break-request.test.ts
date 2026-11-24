import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../index.ts';
import { createParagraphLayoutCache, paragraphLayoutKey } from '../layout-cache.ts';
import { breakParagraph, type PendingLine } from '../paragraph-flow.ts';
import {
  bodyParagraphBreakKey,
  breakPreparedParagraph,
  breakPreparedParagraphLazily,
  positionedParagraphExclusionToken,
  prepareParagraphBreakInputs,
  type ParagraphBreakDependencies,
} from '../paragraph-break-request.ts';
import { resolveParagraphLayoutInputs } from '../style-cascade.ts';
import { resolveCjkTypography } from '../cjk-typography.ts';
import { tabStopsFingerprint, withDefaultTabInterval } from '../paragraph-tabs.ts';

function paragraph(): OoxmlElement {
  const result = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:pPr><w:spacing w:line="360"/><w:rPr><w:sz w:val="32"/></w:rPr>' +
      '<w:tabs><w:tab w:val="right" w:pos="1800"/></w:tabs></w:pPr>' +
      '<w:r><w:t>one two</w:t><w:tab/><w:t>three four five</w:t></w:r></w:p></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part.root.children[0]!.children[0]!;
}

const noDependencies: ParagraphBreakDependencies = {
  listToken: undefined,
  hostedListToken: '',
  refToken: '',
};

describe('shared paragraph break dependencies', () => {
  test('preserves legacy property order, empty-list inclusion and tab key framing', () => {
    const node = paragraph();
    const inputs = resolveParagraphLayoutInputs(node, 180);
    for (const defaultTabStopPt of [undefined, 24]) {
      for (const listToken of [undefined, '', 'list:1']) {
        const deps = { listToken, hostedListToken: 'box:2', refToken: 'ref:3' };
        const prepared = prepareParagraphBreakInputs(inputs, defaultTabStopPt, deps);
        const tabs = withDefaultTabInterval(inputs.tabStops, defaultTabStopPt);
        const legacyProperties = [
          ...inputs.props,
          ...inputs.inheritedRunProperties,
          ...inputs.markRunProperties,
          {
            localName: 'tabStops',
            attributes: {
              token:
                tabs === inputs.tabStops ? inputs.tabStopsCacheToken : tabStopsFingerprint(tabs),
            },
          },
          ...(listToken !== undefined
            ? [{ localName: 'list', attributes: { token: listToken } }]
            : []),
          { localName: 'txbxList', attributes: { token: deps.hostedListToken } },
          { localName: 'refFields', attributes: { token: deps.refToken } },
        ];
        expect(prepared.properties).toEqual(legacyProperties);
        expect(prepared.tabStops).toEqual(tabs);
        const key = { paragraph: node, width: inputs.available, producer: 'fixed' };
        expect(paragraphLayoutKey({ ...key, properties: prepared.properties })).toBe(
          paragraphLayoutKey({ ...key, properties: legacyProperties })
        );
      }
    }
  });

  test('each external dependency invalidates a stable source paragraph key', () => {
    const node = paragraph();
    const inputs = resolveParagraphLayoutInputs(node, 180);
    const keyFor = (deps: ParagraphBreakDependencies, defaultTabStopPt?: number) =>
      paragraphLayoutKey({
        paragraph: node,
        width: inputs.available,
        producer: 'fixed',
        properties: prepareParagraphBreakInputs(inputs, defaultTabStopPt, deps).properties,
      });
    const baseline = keyFor(noDependencies);
    const variants: ParagraphBreakDependencies[] = [
      { ...noDependencies, listToken: 'new marker' },
      { ...noDependencies, hostedListToken: 'new textbox list' },
      { ...noDependencies, refToken: 'new REF result' },
    ];
    for (const variant of variants) expect(keyFor(variant)).not.toBe(baseline);
    expect(keyFor(noDependencies, 24)).not.toBe(baseline);
    expect(keyFor(noDependencies)).toBe(baseline);
  });

  test('placement adapters preserve column, Y precision, suffix offset and empty-zone behavior', () => {
    const placement = {
      exclusionToken: 'zone',
      paragraphStartY: 1.23456,
      columnIndex: 2,
      startOffset: 7,
    };
    expect(positionedParagraphExclusionToken('zone', placement.paragraphStartY)).toBe('1.235|zone');
    expect(bodyParagraphBreakKey('base', placement)).toBe('base\0excl:2|1.235|zone\0from:7');
    expect(
      bodyParagraphBreakKey('base', { ...placement, exclusionToken: '', startOffset: 0 })
    ).toBe('base');
    expect(positionedParagraphExclusionToken('', 99)).toBe('');
    for (const changed of [
      { ...placement, paragraphStartY: 2 },
      { ...placement, columnIndex: 3 },
      { ...placement, exclusionToken: 'other' },
      { ...placement, startOffset: 8 },
      { ...placement, anchorParagraphStartY: -2 },
    ])
      expect(bodyParagraphBreakKey('base', changed)).not.toBe(
        bodyParagraphBreakKey('base', placement)
      );
  });

  test('named request preserves positional geometry and cached line identity', () => {
    const node = paragraph();
    const formatting = resolveParagraphLayoutInputs(node, 180);
    const prepared = prepareParagraphBreakInputs(formatting, 24, noDependencies);
    const measurer = createFixedMeasurer(6, 14);
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const key = paragraphLayoutKey({
      paragraph: node,
      properties: prepared.properties,
      width: formatting.available,
      producer: 'fixed',
    });
    const request = {
      paragraph: node,
      paragraphId: node.id,
      indentLeft: formatting.indent.left,
      available: formatting.available,
      measurer,
      cache,
      cacheKey: key,
      formatting,
      producer: 'fixed',
      styleCascade: undefined,
      tabStops: prepared.tabStops,
      flow: { firstLineOffset: 3, marginExtent: { left: 0, right: 180 } },
    };
    const legacy = breakParagraph(
      node,
      node.id,
      formatting.indent.left,
      formatting.available,
      measurer,
      undefined,
      null,
      formatting.inheritedRunProperties,
      prepared.tabStops,
      undefined,
      undefined,
      {
        ...request.flow,
        lineSpacing: formatting.lineSpacing,
        typography: resolveCjkTypography(formatting.props),
        equationCacheToken: 'fixed',
        markRunProperties: formatting.markRunProperties,
      }
    );
    const lines = breakPreparedParagraph(request);
    expect(lines).toEqual(legacy);
    const cached = breakPreparedParagraph(request);
    expect(cached).toEqual(lines);
    expect(breakPreparedParagraph(request)).toBe(cached);
    for (const retainAcrossPasses of [true, false]) {
      const lazyCache = createParagraphLayoutCache<readonly PendingLine[]>({ retainAcrossPasses });
      let preparations = 0;
      const prepare = () => {
        preparations += 1;
        return request;
      };
      const initial = breakPreparedParagraphLazily(lazyCache, key, prepare);
      expect(initial).toEqual(legacy);
      const reused = breakPreparedParagraphLazily(lazyCache, key, prepare);
      expect(reused).toEqual(initial);
      expect(preparations).toBe(1);
      expect(lazyCache.stats.hits).toBe(1);
      expect(lazyCache.stats.misses).toBe(1);
      if (retainAcrossPasses) {
        expect(reused).not.toBe(initial);
        expect(reused[0]).not.toBe(initial[0]);
      } else expect(reused).toBe(initial);
      expect(breakPreparedParagraphLazily(lazyCache, null, prepare)).toEqual(legacy);
      expect(preparations).toBe(2);
      expect(lazyCache.stats.hits).toBe(1);
      expect(lazyCache.stats.misses).toBe(1);
    }
  });
});
