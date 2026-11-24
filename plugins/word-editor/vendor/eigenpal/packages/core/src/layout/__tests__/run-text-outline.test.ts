import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { propertiesOfRunContainer } from '../field-run-text.ts';
import { resolveRunStyle, runStylesEqual } from '../run-style.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const namespaces = `xmlns:w="${W}" xmlns:w14="${W14}"`;
const outline = (color = '123abc', width = '3556', extra = '') =>
  `<w14:textOutline w14:w="${width}" w14:cap="flat" w14:cmpd="sng">` +
  `<w14:solidFill><w14:srgbClr w14:val="${color}"/></w14:solidFill>${extra}</w14:textOutline>`;
function part(xml: string, name = '/word/document.xml') {
  const read = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}
const props = (xml: string) =>
  propertiesOfRunContainer(part(`<w:rPr ${namespaces}>${xml}</w:rPr>`).root);

describe('solid Word 2010 text outlines', () => {
  test('projects EMU width and an opaque RGB outline, without making text bold', () => {
    const resolved = resolveRunStyle(
      props(outline('123abc', '3556', '<w14:prstDash w14:val="solid"/><w14:miter w14:lim="1"/>'))
    );
    expect(resolved.textOutline).toEqual({ widthPt: 0.28, color: '123ABC' });
    expect(resolved.bold).toBe(false);
    expect(resolved.color).toBeNull();
    expect(Object.isFrozen(resolved.textOutline)).toBe(true);
  });
  test('a direct noFill, empty, or zero-width outline clears an inherited outline', () => {
    for (const reset of [
      '<w14:textOutline><w14:noFill/></w14:textOutline>',
      '<w14:textOutline/>',
      outline('000000', '0'),
    ]) {
      expect(resolveRunStyle([...props(outline()), ...props(reset)]).textOutline).toBeUndefined();
    }
  });
  test('does not conflate outline and normal run colour', () => {
    const resolved = resolveRunStyle(props('<w:color w:val="CC0000"/>' + outline('00AA00')));
    expect(resolved.color).toBe('CC0000');
    expect(resolved.textOutline?.color).toBe('00AA00');
  });
  test('refuses unsupported or hostile variants without retaining an inherited outline', () => {
    const unsupported = [
      outline('red'),
      outline('url(x)'),
      outline('000000', '-1'),
      outline('000000', '20116801'),
      outline().replace('w14:cmpd="sng"', 'w14:cmpd="dbl"'),
      outline().replace('w14:cap="flat"', 'w14:algn="in"'),
      outline('000000', '12700', '<w14:prstDash w14:val="dash"/>'),
      outline().replace(
        '/></w14:solidFill>',
        '><w14:alpha w14:val="50000"/></w14:srgbClr></w14:solidFill>'
      ),
      outline().replace('srgbClr', 'schemeClr'),
      outline('000000', '12700', '<w14:gradFill/>'),
      outline('000000', '12700', '<w14:miter w14:lim="oops"/>'),
    ];
    for (const xml of unsupported)
      expect(resolveRunStyle([...props(outline()), ...props(xml)]).textOutline).toBeUndefined();
  });
  test('checks namespaces but does not require a specific prefix', () => {
    const renamed = outline().replaceAll('w14:', 'x:');
    const root = part(`<w:rPr xmlns:w="${W}" xmlns:x="${W14}">${renamed}</w:rPr>`).root;
    expect(resolveRunStyle(propertiesOfRunContainer(root)).textOutline?.widthPt).toBe(0.28);
    const foreign = part(`<w:rPr xmlns:w="${W}" xmlns:w14="urn:foreign">${outline()}</w:rPr>`).root;
    expect(propertiesOfRunContainer(foreign)).toEqual([]);
    expect(
      resolveRunStyle(
        props(outline().replace('<w14:srgbClr', '<w14:srgbClr xmlns:w14="urn:foreign"'))
      ).textOutline
    ).toBeUndefined();
  });
  test('style equality includes colour and width, but compares values not object identity', () => {
    const a = resolveRunStyle(props(outline()));
    expect(runStylesEqual(a, resolveRunStyle(props(outline())))).toBe(true);
    expect(runStylesEqual(a, resolveRunStyle(props(outline('000000'))))).toBe(false);
    expect(runStylesEqual(a, resolveRunStyle(props(outline('123abc', '12700'))))).toBe(false);
    expect(runStylesEqual(a, resolveRunStyle([]))).toBe(false);
  });
  test('character-style inheritance and its fingerprint retain nested outline colours', () => {
    const table = (color: string) =>
      buildStyleCascadeTable(
        part(
          `<w:styles ${namespaces}><w:style w:type="character" w:styleId="Outline"><w:rPr>${outline(color)}</w:rPr></w:style></w:styles>`,
          '/word/styles.xml'
        ).root
      );
    expect(table('000000').cacheToken).not.toBe(table('000001').cacheToken);
    const doc = part(
      `<w:document ${namespaces}><w:body><w:p><w:r><w:rPr><w:rStyle w:val="Outline"/></w:rPr><w:t>Header</w:t></w:r></w:p></w:body></w:document>`
    );
    const result = layoutSemanticDocument(doc, 1, {
      measurer: createFixedMeasurer(6, 14),
      styleCascade: table('000000'),
    });
    expect(linesOf(result)[0]!.spans[0]!.style.textOutline?.color).toBe('000000');
  });
  test('outline ink never changes wrapping, boxes, model ranges, or saved source XML', () => {
    const layout = (effect: string) => {
      const doc = part(
        `<w:document ${namespaces}><w:body><w:p><w:r><w:rPr><w:sz w:val="22"/>${effect}</w:rPr><w:t>AB CD EF</w:t></w:r></w:p></w:body></w:document>`
      );
      const before = serializeOoxmlPart(doc);
      const result = layoutSemanticDocument(doc, 1, {
        measurer: createFixedMeasurer(6, 14),
        geometry: { width: 30, height: 100, margin: { left: 0, right: 0, top: 0, bottom: 0 } },
      });
      expect(serializeOoxmlPart(doc)).toBe(before);
      return linesOf(result).map((line) => ({
        box: line.box,
        range: line.range,
        spans: line.spans.map((span) => ({ text: span.text, box: span.box, range: span.range })),
      }));
    };
    expect(layout(outline())).toEqual(layout(''));
  });
});
