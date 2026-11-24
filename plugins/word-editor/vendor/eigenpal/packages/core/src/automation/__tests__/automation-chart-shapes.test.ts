// A chart in `mc:AlternateContent` is listed through its Choice: one shape of type Unsupported
// with the Choice's `wp:docPr` id. The listing does not depend on whether a chart renderer is
// installed or on which branch the page paints. Its fallback picture is never listed as an
// inline picture, so no picture write reaches it.

import { expect, test } from 'bun:test';
import { chartexPackage, waterfallChartSpace } from '../../store/__tests__/chartex-fixture.ts';
import { bodyStoryRoot, storyParagraphs } from '../../store/package/story-blocks.ts';
import { shapesInParagraphs } from '../shapes.ts';
import { pictureIdsInSpans } from '../pictures.ts';
import { storeEditDiagnosticCode } from '../diagnostics.ts';

function shapes(options: { emptyFallback?: boolean } = {}) {
  const pkg = chartexPackage(waterfallChartSpace(), { alternateContent: true, ...options });
  const part = pkg.parts.get('/word/document.xml')!;
  const listing = shapesInParagraphs(part, storyParagraphs(bodyStoryRoot(part) ?? part.root));
  if (!listing.ok) throw new Error(listing.reason);
  return listing.shapes.map(({ id, name, type }) => ({ id, name, type }));
}

test('a wrapped chart is one Unsupported shape named by its Choice', () => {
  expect(shapes()).toEqual([{ id: 1, name: 'Chart 1', type: 'Unsupported' }]);
  expect(shapes({ emptyFallback: true })).toEqual([
    { id: 1, name: 'Chart 1', type: 'Unsupported' },
  ]);
});

test('a chart fallback picture is no inline picture, and its edits map to unsupported content', () => {
  const pkg = chartexPackage(waterfallChartSpace(), { alternateContent: true });
  const part = pkg.parts.get('/word/document.xml')!;
  const paragraphId = storyParagraphs(bodyStoryRoot(part) ?? part.root)[0]!.id;
  expect(pictureIdsInSpans(part, [{ paragraphId, start: 0, end: 1 }])).toEqual([]);
  expect(storeEditDiagnosticCode('chart-drawing')).toBe('edit.unsupported-content');
});
