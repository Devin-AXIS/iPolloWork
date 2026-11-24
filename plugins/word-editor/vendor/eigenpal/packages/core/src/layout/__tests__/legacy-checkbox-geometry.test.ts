import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { layoutSemanticDocument, createFixedMeasurer } from '../semantic-layout.ts';
import { caretAt, caretStops } from '../semantic-interaction.ts';

const fixture = new URL('../../../../../e2e/fixtures/form-controls-catalog.docx', import.meta.url);

test('catalog checkbox reserves its field size independently of font glyph metrics and caret edges', () => {
  const loaded = readOoxmlPackage(new Uint8Array(readFileSync(fixture)));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  for (const glyphWidth of [3, 6, 10]) {
    const layout = layoutSemanticDocument(part, 0, {
      measurer: createFixedMeasurer(glyphWidth, 14),
    });
    const spans = layout.pages.flatMap((page) =>
      page.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans) : []
      )
    );
    const boxes = spans.filter((span) => span.fieldAtom?.formControl?.kind === 'checkbox');
    expect(boxes.length).toBe(2);
    for (const box of boxes) {
      expect(box.box.width).toBe(12);
      const start = caretAt(layout, {
        paragraphId: box.range.paragraphId,
        offset: box.range.start,
      })!;
      const end = caretAt(layout, { paragraphId: box.range.paragraphId, offset: box.range.end })!;
      expect(end.x - start.x).toBe(12);
      expect(
        caretStops(layout).some(
          (stop) =>
            stop.position.paragraphId === box.range.paragraphId &&
            stop.position.offset === box.range.end
        )
      ).toBe(true);
    }
  }
});
