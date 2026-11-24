import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { projectExternalHtml } from '../clipboard-html-read.ts';

function documentXmlOf(html: string): string {
  const projected = projectExternalHtml(html);
  if (!projected.ok) throw new Error(projected.reason);
  const read = readOoxmlPackage(projected.fragmentBytes);
  if (!read.ok) throw new Error(read.reason);
  return serializeOoxmlPart(read.package.parts.get('/word/document.xml')!);
}

describe('clipboard HTML language inheritance', () => {
  test('the root HTML language reaches body text', () => {
    const xml = documentXmlOf(
      '<html lang="pl-PL"><body><p class="MsoNormal">tekst</p></body></html>'
    );
    expect(xml).toContain('<w:lang w:val="pl-PL"/>');
  });

  test('root direction reaches paragraph and run properties', () => {
    const xml = documentXmlOf('<html dir="rtl"><body><p class="MsoNormal">tekst</p></body></html>');
    expect(xml).toContain('<w:bidi/>');
    expect(xml).toContain('<w:rtl/>');
  });

  test('Word language declarations keep separate script slots', () => {
    const xml = documentXmlOf(
      '<p><span style="direction:rtl;mso-ansi-language:EN-US;' +
        'mso-fareast-language:JA-JP;mso-bidi-language:AR-SA">mixed</span></p>'
    );
    const language = xml.match(/<w:lang [^>]+\/>/)?.[0];
    expect(language).toContain('w:val="EN-US"');
    expect(language).toContain('w:eastAsia="JA-JP"');
    expect(language).toContain('w:bidi="AR-SA"');
  });
});
