// Text the browser composes beside an inline picture reads back on the picture's side.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import { paintedTextIn } from '../surface-composition-readback.ts';
import { layoutContext, load } from '../../layout/__tests__/anchored-drawing-test-fixtures.ts';

const NAMESPACES =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** An inline picture 100pt wide and 10pt tall. */
const PICTURE =
  '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="1270000" cy="127000"/><wp:docPr id="1" name="p1"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="1270000" cy="127000"/></a:xfrm><a:prstGeom prst="rect"/>' +
  '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';

function painted(content: string): { root: HTMLElement; line: Element; paragraphId: string } {
  const part = load(
    `<w:document ${NAMESPACES}><w:body><w:p>${content}</w:p></w:body></w:document>`
  );
  const layout = layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
  });
  const root = document.createElement('div');
  paintSemanticLayout(root, layout, { scale: 1 });
  const line = root.querySelector<HTMLElement>('.docx-line')!;
  return { root, line, paragraphId: line.dataset.paragraphId! };
}

test('text composed after a lone picture reads back after it', () => {
  const { root, line, paragraphId } = painted(`<w:r>${PICTURE}</w:r>`);
  const spacer = line.querySelector('.docx-inline-drawing-advance')!;
  spacer.after(document.createTextNode('あ'));
  expect(paintedTextIn(root, paragraphId, '￼', null)).toBe('￼あ');
});

test('text composed before a picture that opens a line reads back before it', () => {
  const { root, line, paragraphId } = painted(`<w:r>${PICTURE}</w:r>`);
  const spacer = line.querySelector('.docx-inline-drawing-advance')!;
  spacer.before(document.createTextNode('あ'));
  expect(paintedTextIn(root, paragraphId, '￼', null)).toBe('あ￼');
});
