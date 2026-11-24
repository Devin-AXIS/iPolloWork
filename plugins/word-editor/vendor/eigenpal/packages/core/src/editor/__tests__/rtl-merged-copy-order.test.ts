import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { documentOrder, everyStoryOrder } from '../../layout/document-order.ts';
import { forEachSemanticSpan } from '../../layout/export-traversal.ts';
import { spansInSelection } from '../../layout/semantic-interaction.ts';
import { selectionMarkRects } from '../../layout/selection-rects.ts';
import { scopedDocumentOrder } from '../surface-scope.ts';
import type { SemanticLayout } from '../../layout/semantic-records.ts';
import { selectedTextIn } from '../surface-selection-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
for (const displayMode of ['proposed', 'original'] as const) {
  test.each([false, true])(
    `${displayMode} RTL merged copy follows source order (table=%s)`,
    (table) => {
      const mark = displayMode === 'proposed' ? 'del' : 'ins';
      const paragraphs = `<w:p><w:pPr><w:bidi/><w:rPr><w:${mark} w:id="1" w:author="A"/></w:rPr></w:pPr><w:r><w:t>مرحبا</w:t></w:r></w:p><w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t>عالم</w:t></w:r></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p>`;
      const body = table
        ? `<w:tbl><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>${paragraphs}</w:tc></w:tr></w:tbl>`
        : paragraphs;
      const result = readOoxmlPart(
        `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
        { name: '/word/document.xml', contentType: 'app/xml' }
      );
      if (!result.ok) throw Error(result.reason);
      const ids: string[] = [];
      const visit = (node: OoxmlNode) => {
        if (node.kind === 'paragraph') ids.push(node.id);
        if ('children' in node) node.children.forEach(visit);
      };
      visit(result.part.root);
      const layout = layoutSemanticDocument(result.part, 0, { measurer, displayMode });
      const scoped: SemanticLayout = {
        ...layout,
        pages: layout.pages.map((page) => ({
          ...page,
          fragments: [],
          header: {
            kind: 'header',
            variant: 'default',
            rId: 'rIdH',
            partName: '/word/header1.xml',
            box: page.contentBox,
            fragments: page.fragments,
          },
        })),
      };
      expect(
        scopedDocumentOrder(scoped, {
          scope: { kind: 'headerFooter', rId: 'rIdH' },
          pageIndex: 0,
          kind: 'header',
          partName: '/word/header1.xml',
          variant: 'default',
        })
      ).toEqual(ids);
      expect(everyStoryOrder(scoped)).toEqual(ids);
      expect(documentOrder(layout)).toEqual(ids);
      expect(everyStoryOrder(layout)).toEqual(ids);
      const anchor = { paragraphId: ids[0]!, offset: 0 };
      const head = { paragraphId: ids[1]!, offset: 4 };
      expect(selectedTextIn(layout, anchor, head)).toBe('مرحباعالم');
      expect(
        spansInSelection(layout, { anchor, head }, documentOrder(layout))
          .map((span) => span.text)
          .join('')
      ).toBe('مرحباعالم');
      const exported: string[] = [];
      let secondLeft = Infinity;
      forEachSemanticSpan(layout, ({ span }) => {
        exported.push(span.text);
        if (span.range.paragraphId === ids[1]) secondLeft = Math.min(secondLeft, span.box.x);
      });
      expect(exported.join('')).toBe('مرحباعالمNext');
      const markRects = selectionMarkRects(
        layout,
        { anchor, head: { paragraphId: ids[2]!, offset: 0 } },
        documentOrder(layout),
        measurer
      );
      expect(markRects).toHaveLength(1);
      expect(markRects[0]!.x + markRects[0]!.width).toBeCloseTo(secondLeft);
      expect(selectedTextIn(layout, anchor, { paragraphId: ids[2]!, offset: 4 })).toBe(
        'مرحباعالم\nNext'
      );
    }
  );
}
