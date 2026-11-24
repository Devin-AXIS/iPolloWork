import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { layoutContext } from '../../layout/__tests__/anchored-drawing-test-fixtures.ts';
import { elevenPointDefaults } from '../../layout/__tests__/fixtures/eleven-point-defaults.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

test.each([
  ['vertical', '0pt', '18pt', '0,360', 'm0,360l0,0e'],
  ['horizontal', '24pt', '0pt', '480,0', 'm0,0l480,0e'],
])(
  'paints the %s zero-extent VML shape without a placeholder',
  (_label, width, height, size, path) => {
    const loaded = readOoxmlPart(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml"><w:body><w:p><w:r><w:t>Body</w:t><w:pict><v:shape style="position:absolute;width:${width};height:${height};" coordsize="${size}" path="${path}" filled="false" strokecolor="#123456" strokeweight="1pt"/></w:pict></w:r></w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'application/xml' }
    );
    if (!loaded.ok) throw new Error(loaded.reason);
    const layout = layoutSemanticDocument(loaded.part, 1, {
      measurer: createFixedMeasurer(6, 14),
      styleCascade: elevenPointDefaults(),
      inlineDrawingLayout: layoutContext(loaded.part),
    });
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    expect(container.querySelector('.docx-drawing-placeholder-card')).toBeNull();
    const line = container.querySelector('svg path[stroke="#123456"]');
    expect(line).not.toBeNull();
    expect(line?.getAttribute('d')).toContain('L');
    expect(Number(line?.getAttribute('stroke-width'))).toBeGreaterThan(0);
  }
);
