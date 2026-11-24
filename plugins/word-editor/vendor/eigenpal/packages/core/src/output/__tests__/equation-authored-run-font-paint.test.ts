import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  buildStyleCascadeTable,
  createFixedMeasurer,
  layoutSemanticDocument,
} from '@docx-editor.dev/core/layout';
import { paintSemanticLayout } from '../semantic-paint.ts';

test('paints authored digit faces and inherited normal text without restyling math symbols', () => {
  const styles = readOoxmlPart(
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr>' +
      '<w:rFonts w:ascii="Paragraph Face" w:hAnsi="Paragraph Face"/>' +
      '</w:rPr></w:style></w:styles>',
    { name: '/word/styles.xml', contentType: 'app/xml' }
  );
  if (!styles.ok) throw new Error(styles.reason);
  const read = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p>' +
      '<m:oMath><m:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/></w:rPr>' +
      '<m:t>x12+α</m:t></m:r><m:r><m:rPr><m:nor/></m:rPr><m:t>normal</m:t></m:r>' +
      '</m:oMath></w:p></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 14),
    styleCascade: buildStyleCascadeTable(styles.part.root),
  });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('.docx-equation-text'));
  // The spaced `+` and the letter after it share a face, so one span draws both.
  expect(nodes.map((node) => node.textContent)).toEqual(['𝑥', '12', '+𝛼', 'normal']);
  expect(nodes[0]?.style.fontFamily).toContain('Cambria Math');
  expect(nodes[0]?.style.fontStyle).toBe('normal');
  expect(nodes[1]?.style.fontFamily).toContain('Arial');
  expect(nodes[1]?.style.fontStyle).toBe('italic');
  expect(nodes[1]?.style.fontWeight).toBe('bold');
  expect(nodes[2]?.style.fontFamily).toContain('Cambria Math');
  expect(nodes[3]?.style.fontFamily).toContain('Paragraph Face');
  expect(nodes[3]?.style.fontStyle).toBe('normal');
});

test('normal text without a resolved paragraph face uses the surface default face', () => {
  const read = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p>' +
      '<m:oMath><m:r><m:rPr><m:nor/></m:rPr><m:t>normal</m:t></m:r>' +
      '<m:r><m:t>x</m:t></m:r></m:oMath></w:p></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 1, { measurer: createFixedMeasurer(6, 14) });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1, defaultFontFamily: 'Host Default' });
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('.docx-equation-text'));
  expect(nodes.map((node) => node.textContent)).toEqual(['normal', '𝑥']);
  expect(nodes[0]?.style.fontFamily).toContain('Host Default');
  expect(nodes[1]?.style.fontFamily).toContain('Cambria Math');
});
