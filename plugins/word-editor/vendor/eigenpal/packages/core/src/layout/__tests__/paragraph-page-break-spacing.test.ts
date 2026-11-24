import { expect, test } from 'bun:test';
import { loadBody, squareWrapZone } from './float-over-table-harness.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { PendingLine } from '../paragraph-flow.ts';

const p = (text: string, properties = '') =>
  `<w:p><w:pPr><w:spacing w:before="480" w:after="0" w:line="240" w:lineRule="exact"/>${properties}</w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

for (const explicit of [false, true]) {
  test(`${explicit ? 'explicit' : 'natural'} page starts use the correct before-spacing and wrap origin`, () => {
    const text = 'abcdefghij abcdefghij abcdefgh';
    const source = loadBody(p('Lead') + p(text, explicit ? '<w:pageBreakBefore/>' : ''));
    const lead = source.root.children[0]!.children[0]!;
    const options = {
      measurer: createFixedMeasurer(6, 12),
      geometry: { width: 180, height: 60, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
      session: createLayoutSession(),
      cache: createParagraphLayoutCache<readonly PendingLine[]>(),
      drawingExclusionPass: 0,
      drawingExclusionZonesByPage: new Map([
        [
          1,
          [squareWrapZone({ anchorParagraphId: lead.id, top: 0, height: 20, left: 0, width: 90 })],
        ],
      ]),
    };
    const layout = layoutSemanticDocument(source, 0, options);
    expect(layoutSemanticDocument(source, 0, options).pages).toEqual(layout.pages);
    expect(layout.pages).toHaveLength(2);
    const paragraph = layout.pages[1]!.fragments[0]!;
    if (paragraph.kind !== 'paragraph') throw new Error('missing paragraph');
    expect(paragraph.lines[0]!.box.y).toBe(explicit ? 24 : 0);
    expect(paragraph.lines[0]!.spans[0]!.box.x).toBe(explicit ? 0 : 90);
    expect(paragraph.lines).toHaveLength(explicit ? 1 : 3);
  });
}
