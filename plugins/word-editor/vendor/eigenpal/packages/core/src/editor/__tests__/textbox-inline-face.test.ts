// An inline text box in a paragraph whose mark is bold or italic: the line that holds the box
// carries the mark's face, and the box's story must not inherit it. A story run paints bold or
// italic only when it is.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { EMU, MC, SHAPE_URI, mount, p } from './shape-selection-fixture.ts';

const GRAPHIC =
  `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>` +
  `<a:ext cx="${200 * EMU}" cy="${60 * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/>` +
  '</a:prstGeom></wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>Plain</w:t></w:r></w:p>' +
  '</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>';

const INLINE =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  `<wp:extent cx="${200 * EMU}" cy="${60 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
  `<wp:docPr id="5" name="Inline box"/><wp:cNvGraphicFramePr/><a:graphic>` +
  `<a:graphicData uri="${SHAPE_URI}">${GRAPHIC}</a:graphicData></a:graphic></wp:inline>` +
  '</w:drawing></w:r>';

const WORD_INLINE = INLINE.replace(
  '<w:r><w:drawing>',
  `<w:r><mc:AlternateContent xmlns:mc="${MC}"><mc:Choice Requires="wps"><w:drawing>`
).replace(
  '</w:drawing></w:r>',
  '</w:drawing></mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r>'
);

for (const [label, drawing] of [
  ['an inline text box', INLINE],
  ['an inline text box with a VML fallback', WORD_INLINE],
] as const) {
  test(`${label} does not take its paragraph mark's bold or italic`, async () => {
    const mark = '<w:pPr><w:rPr><w:b/><w:i/></w:rPr></w:pPr>';
    const { editor, container } = await mount(p(mark + drawing));
    try {
      const content = container.querySelector<HTMLElement>('.docx-drawing-textbox-content')!;
      expect(content).not.toBeNull();
      expect(content.textContent).toContain('Plain');
      expect(content.style.fontWeight).toBe('normal');
      expect(content.style.fontStyle).toBe('normal');
      for (const run of content.querySelectorAll<HTMLElement>('.layout-run-text')) {
        expect(run.style.fontWeight).not.toBe('bold');
        expect(run.style.fontStyle).not.toBe('italic');
      }
    } finally {
      editor.destroy();
      container.remove();
    }
  });
}
