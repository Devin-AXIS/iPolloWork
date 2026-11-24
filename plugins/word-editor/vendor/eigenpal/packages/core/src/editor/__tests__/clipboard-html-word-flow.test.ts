import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { projectExternalHtml } from '../clipboard-html-read.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';

test('WordSection1 wrapper keeps page-break extraction and spacer skipping', () => {
  const html =
    '<html><head><meta name=ProgId content=Word.Document></head><body>' +
    '<div class=WordSection1>' +
    '<p class=MsoNormal>one</p>' +
    "<span style='page-break-before:always'><br style='page-break-before:always'></span>" +
    '<p class=MsoNormal><o:p>&nbsp;</o:p></p>' +
    '<p class=MsoNormal>two</p>' +
    '</div></body></html>';
  const projected = projectExternalHtml(html);
  expect(projected.ok).toBe(true);
  if (!projected.ok) return;
  const read = readOoxmlPackage(projected.fragmentBytes);
  expect(read.ok).toBe(true);
  if (!read.ok) return;
  const part = read.package.parts.get(read.package.mainDocumentPart)!;
  const xml = serializeOoxmlPart(part);
  expect(xml).toContain('<w:pageBreakBefore/>');
  expect(xml).not.toContain('<w:br w:type="page"/>');
  expect((xml.match(/<w:p>/g) ?? []).length).toBe(2);
});

test('unwrapped note definition divs do not double-project', () => {
  const html =
    '<html><head><meta name=ProgId content=Word.Document></head><body>' +
    "<p class=MsoNormal>body<a style='mso-footnote-id:ftn1' href='#_ftn1'>[1]</a></p>" +
    "<div style='mso-element:footnote' id=ftn1><p class=MsoNormal>note text</p></div>" +
    '</body></html>';
  const projected = projectExternalHtml(html);
  expect(projected.ok).toBe(true);
  if (!projected.ok) return;
  const read = readOoxmlPackage(projected.fragmentBytes);
  expect(read.ok).toBe(true);
  if (!read.ok) return;
  const docXml = serializeOoxmlPart(read.package.parts.get(read.package.mainDocumentPart)!);
  expect(docXml).not.toContain('note text');
  expect((docXml.match(/<w:footnoteReference /g) ?? []).length).toBe(1);
  const notesXml = serializeOoxmlPart(read.package.parts.get('/word/footnotes.xml')!);
  expect(notesXml).toContain('note text');
});
