import { describe, expect, test } from 'bun:test';
import { projectDrawingsInPart } from '../package/drawing-projection.ts';
import { readOoxmlPart, serializeOoxmlPart } from '../package/ooxml-tree.ts';

function project(z: string, extra = '') {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml"><w:body><w:p><w:r><w:pict><v:rect style="position:absolute;width:20pt;height:10pt;z-index:${z};${extra}" fillcolor="#112233" stroked="f"/></w:pict></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  const result = projectDrawingsInPart(parsed.part);
  expect(serializeOoxmlPart(parsed.part)).toBe(before);
  return result;
}

describe('VML stacking order has its own integer bound', () => {
  test('accepts common Word layer IDs without treating them as huge coordinates', () => {
    for (const z of [251658240, 251670528, 2147483647]) {
      const result = project(String(z));
      expect(result).toHaveLength(1);
      expect(result[0]!.legacyGraphic).not.toBeNull();
      expect(result[0]!.anchor).toMatchObject({ relativeHeight: z, behindDocument: false });
      expect(result[0]!.extentEmu).toEqual({ cx: 254000, cy: 127000 });
      expect(result[0]!.wrap).toBe('inFront');
    }
  });
  test('negative order remains behind text and distinct within the behind-text layer', () => {
    const low = project('-251663872')[0]!,
      high = project('-251658240')[0]!;
    expect(low.wrap).toBe('behind');
    expect(high.wrap).toBe('behind');
    expect(low.anchor?.behindDocument).toBe(true);
    expect(low.anchor!.relativeHeight).toBeLessThan(high.anchor!.relativeHeight);
    expect(project('-2147483648')[0]!.anchor?.relativeHeight).toBe(0);
  });
  test('auto and signed integral values have a deterministic ordering', () => {
    expect(project('auto')[0]!.anchor?.relativeHeight).toBe(0);
    expect(project('AUTO')[0]!.anchor?.relativeHeight).toBe(0);
    expect(project('+2')[0]!.anchor?.relativeHeight).toBe(2);
    expect(project('-0')[0]!.anchor?.behindDocument).toBe(false);
  });
  test('rejects malformed or over-limit order while retaining all geometry bounds', () => {
    for (const raw of [
      '2147483648',
      '-2147483649',
      '999999999999999999',
      '1.5',
      'NaN',
      'Infinity',
      '1e9',
      'url(x)',
    ]) {
      expect(project(raw).some((drawing) => drawing.legacyGraphic)).toBe(false);
    }
    expect(
      project('251658240', 'margin-left:100001pt').some((drawing) => drawing.legacyGraphic)
    ).toBe(false);
  });
});
