// Pasted HTML names PHYSICAL sides; a bidi paragraph's `w:jc` and `w:ind` name leading and
// trailing ones. The reader has to mirror the physical values and keep the logical ones.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { projectExternalHtml } from '../clipboard-html-read.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';

function pastedBody(html: string): string {
  const projected = projectExternalHtml(html);
  if (!projected.ok) throw new Error(`projection refused: ${projected.reason}`);
  const read = readOoxmlPackage(projected.fragmentBytes);
  if (!read.ok) throw new Error(`read-back refused: ${read.reason}`);
  const part = read.package.parts.get('/word/document.xml');
  if (!part) throw new Error('fragment lost its document part');
  return serializeOoxmlPart(part);
}

test('an RTL paragraph keeps its physical alignment and margins', () => {
  // Word's right-aligned RTL paragraph is at its LEADING edge, which `w:jc` spells `left`.
  const [rtl, ltr] = pastedBody(
    '<p dir="rtl" style="direction:rtl;text-align:right;margin-right:36pt;margin-left:18pt">' +
      '<span dir="rtl">مرحبا</span></p>' +
      '<p style="text-align:right;margin-left:18pt">ltr</p>'
  ).split('</w:p>');
  expect(rtl).toContain('<w:bidi/>');
  expect(rtl).toContain('<w:jc w:val="left"/>');
  expect(rtl).toContain('<w:ind w:left="720" w:right="360"/>');
  expect(ltr).toContain('<w:jc w:val="right"/>');
  expect(ltr).toContain('<w:ind w:left="360"/>');
});

test('text-align start and end stay logical in either direction', () => {
  const paragraphs = pastedBody(
    '<p dir="rtl" style="direction:rtl;text-align:start">a</p>' +
      '<p dir="rtl" style="direction:rtl;text-align:end">b</p>' +
      '<p style="text-align:end">c</p>'
  ).split('</w:p>');
  expect(paragraphs[0]).toContain('<w:jc w:val="left"/>');
  expect(paragraphs[1]).toContain('<w:jc w:val="right"/>');
  expect(paragraphs[2]).toContain('<w:jc w:val="right"/>');
});
