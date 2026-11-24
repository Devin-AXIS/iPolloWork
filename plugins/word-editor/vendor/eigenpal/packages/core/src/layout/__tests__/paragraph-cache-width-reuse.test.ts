import {
  setLineHangingPunctuationAdvance,
  lineHangingPunctuationAdvance,
} from '../line-hanging-punctuation.ts';
import { frozenLine } from '../pending-line.ts';
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createParagraphLayoutCache, type ParagraphKeyInputs } from '../layout-cache.ts';
import { lineTiedToPlacement, reuseParagraphAtWidth } from '../paragraph-cache-width-reuse.ts';
import { breakParagraph, type PendingLine } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';

function fixture(text = 'Token') {
  const read = readOoxmlPart(
    `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`,
    {
      name: '/word/document.xml',
      contentType: 'app/xml',
    }
  );
  if (!read.ok) throw Error(read.reason);
  const paragraph = read.part.root;
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const inputs: ParagraphKeyInputs = { paragraph, properties: [], width: 100, producer: 'test' };
  const key = cache.keyFor!(inputs);
  const measurer = createFixedMeasurer(6, 14);
  breakParagraph(paragraph, paragraph.id, 0, 100, measurer, cache, key);
  return { paragraph, cache, inputs, key, measurer };
}

test('a complete fitting token transfers to a different width without growing the cache', () => {
  const { paragraph, cache, inputs, key, measurer } = fixture();
  const measured = cache.get(key);
  for (const width of [120, 60, 150, 40]) {
    const next = cache.keyFor!({ ...inputs, width });
    const reused = reuseParagraphAtWidth(cache, paragraph, next, width);
    expect(reused).toBe(measured);
    expect(reused).toEqual(
      breakParagraph(paragraph, paragraph.id, 0, width, measurer, undefined, null)
    );
    expect(cache.stats.size).toBe(1);
  }
});

for (const changed of [
  { producer: 'another-font' },
  { drawingToken: 'picture' },
  { projectionToken: 'field-value' },
  { exclusionToken: 'float' },
  { properties: [{ localName: 'sz', attributes: { val: '40' } }] },
])
  test(`a width alternative rejects changed dependencies ${JSON.stringify(changed)}`, () => {
    const { paragraph, cache, inputs } = fixture();
    const next = cache.keyFor!({ ...inputs, width: 120, ...changed });
    expect(reuseParagraphAtWidth(cache, paragraph, next, 120)).toBeUndefined();
  });

for (const text of ['Token ', 'Two\u00a0words', 'tab\tstop', 'אבג', '漢字', 'LongToken'.repeat(10)])
  test(`width reuse refuses spacing, script, or wrapping dependencies: ${text.slice(0, 12)}`, () => {
    const { paragraph, cache, inputs } = fixture(text);
    const next = cache.keyFor!({ ...inputs, width: 120 });
    expect(reuseParagraphAtWidth(cache, paragraph, next, 120)).toBeUndefined();
  });

test('a token that no longer fits requires a fresh break', () => {
  const { paragraph, cache, inputs } = fixture();
  const next = cache.keyFor!({ ...inputs, width: 10 });
  expect(reuseParagraphAtWidth(cache, paragraph, next, 10)).toBeUndefined();
});

test('hanging punctuation retains its width-dependent alignment decision in the cache', () => {
  const { cache, key } = fixture('Token.');
  const line = (cache.get(key) as readonly PendingLine[])[0]!;
  const pending = { ...line };
  setLineHangingPunctuationAdvance(pending, 3);
  const retained = frozenLine(pending);
  expect(lineHangingPunctuationAdvance(retained)).toBe(3);
  expect(lineTiedToPlacement(retained)).toBe(true);
});
