import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { caretAt, caretStops } from '../semantic-interaction.ts';
const measurer = createFixedMeasurer(6, 14);
test.each([false, true])(
  'painted bidi carets share downstream affinity with navigation stops (merged=%s)',
  (merged) => {
    for (const rtl of [false, true]) {
      const body = ['אבג ABC דהו', 'DEF مرحبا XYZ']
        .map(
          (text, index) =>
            `<w:p><w:pPr>${rtl ? '<w:bidi/>' : ''}${merged && index === 0 ? '<w:rPr><w:del w:id="1" w:author="A"/></w:rPr>' : ''}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
        )
        .join('');
      const source = readOoxmlPart(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
        { name: '/word/document.xml', contentType: 'app/xml' }
      );
      if (!source.ok) throw Error(source.reason);
      const layout = layoutSemanticDocument(source.part, 0, { measurer, displayMode: 'proposed' });
      for (const stop of caretStops(layout, measurer)) {
        const painted = caretAt(layout, stop.position, measurer);
        expect(painted).not.toBeNull();
        expect(painted!.x).toBeCloseTo(stop.x);
        expect(painted!.lineId).toBe(stop.lineId);
      }
    }
  }
);
