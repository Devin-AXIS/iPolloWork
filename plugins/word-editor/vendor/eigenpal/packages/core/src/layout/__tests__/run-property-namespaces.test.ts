import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { propertiesOfRunContainer } from '../field-run-text.ts';
import { resolveRunStyle } from '../run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const bindings = `xmlns:w="${W}" xmlns:w14="${W14}" xmlns:mc="${MC}" xmlns:e="urn:foreign" mc:Ignorable="e"`;

function part(xml: string) {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const style = (inner: string) =>
  resolveRunStyle(propertiesOfRunContainer(part(`<w:rPr ${bindings}>${inner}</w:rPr>`).root));

describe('run property namespace boundaries', () => {
  test('foreign elements and attributes set no run properties', () => {
    const resolved = style(
      '<e:b/><w:sz w:val="24" e:val="48"/><w:color w:val="FF0000"/><e:color e:val="00FF00"/>'
    );
    expect(resolved.bold).toBe(false);
    expect(resolved.fontSizePt).toBe(12);
    expect(resolved.color).toBe('FF0000');
  });

  test('a foreign font attribute does not select a face', () => {
    expect(style('<w:rFonts e:eastAsia="SimSun"/>').fontFamilyEastAsia).toBeNull();
    expect(style('<w:rFonts w:eastAsia="MS Mincho" e:eastAsia="SimSun"/>').fontFamilyEastAsia).toBe(
      'MS Mincho'
    );
  });

  test('an unqualified font attribute does not override the qualified one', () => {
    expect(style('<w:rFonts w:ascii="Arial" ascii="Courier New"/>').fontFamily).toBe('Arial');
    expect(style('<w:rFonts ascii="Courier New" w:ascii="Arial"/>').fontFamily).toBe('Arial');
    expect(style('<w:rFonts ascii="Courier New"/>').fontFamily).toBeNull();
  });

  test('w14 children keep their own namespace-checked readers', () => {
    expect(style('<w14:ligatures w14:val="standard"/>').ligatures?.standard).toBe(true);
    expect(style('<w:ligatures w:val="standard"/>').ligatures).toBeUndefined();
    expect(style('<e:ligatures e:val="standard"/>').ligatures).toBeUndefined();
  });

  test('reading run properties leaves foreign extensions in the canonical tree', () => {
    const document = part(`<w:rPr ${bindings}><e:b/><w:sz w:val="24" e:val="48"/></w:rPr>`);
    const before = serializeOoxmlPart(document);
    propertiesOfRunContainer(document.root);
    expect(serializeOoxmlPart(document)).toBe(before);
    expect(before).toContain('e:b');
    expect(before).toContain('e:val="48"');
  });
});
