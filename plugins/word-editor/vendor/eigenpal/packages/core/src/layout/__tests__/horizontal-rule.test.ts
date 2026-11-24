// A horizontal rule (`v:rect` with `o:hr`) spans its line as a bar or a shaded groove.

import { describe, expect, test } from 'bun:test';
import { projectDrawingsInPart } from '../../store/package/drawing-projection.ts';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { widenedRule } from '../horizontal-rule.ts';

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';
const RULE =
  '<v:rect id="_x0000_i1025" o:hralign="center" o:hrstd="t" o:hr="t" style="width:0pt;height:1.5pt;visibility:visible" fillcolor="#A0A0A0" stroked="false" strokeweight="0.75pt"/>';
const EMU = 12_700;

function project(shape: string) {
  const read = readOoxmlPart(
    `<w:document ${NS}><w:body><w:p><w:r><w:pict>${shape}</w:pict></w:r></w:p></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!read.ok) throw new Error(read.reason);
  return projectDrawingsInPart(read.part);
}

describe('horizontal rules', () => {
  test('a standard rule projects with no width and its colour and shading', () => {
    const [rule] = project(RULE);
    expect(rule!.kind).toBe('inline');
    expect(rule!.extentEmu).toEqual({ cx: 0, cy: 1.5 * EMU });
    expect(rule!.horizontalRule).toEqual({
      fillHex: 'A0A0A0',
      shaded: true,
      widthFraction: 1,
      align: 'center',
    });
    expect(rule!.vectorShape).toBeNull();
  });

  test('layout widens a shaded rule to its line as a groove', () => {
    const [rule] = project(RULE);
    const input = { drawingNodeId: 'd', ownerPartName: '', projection: rule!, resource: {} };
    const wide = widenedRule(input as never, 400);
    expect(wide.projection.extentEmu.cx).toBe(400 * EMU);
    const components = wide.projection.vectorShape!.components;
    expect(components.map((component) => component.fillHex)).toEqual(['A0A0A0', 'E0E0E0']);
    // The same width gives the same object, so layout caches see one projection.
    expect(widenedRule(input as never, 400)).toBe(wide);
  });

  test('a rule without shading is one bar', () => {
    const [rule] = project(RULE.replace('o:hr="t"', 'o:hr="t" o:hrnoshade="t"'));
    const input = { drawingNodeId: 'd', ownerPartName: '', projection: rule!, resource: {} };
    expect(widenedRule(input as never, 100).projection.vectorShape!.components).toHaveLength(1);
  });

  test('a rule with a share of its line draws the bar at its alignment', () => {
    const [rule] = project(RULE.replace('o:hr="t"', 'o:hr="t" o:hrpct="500"'));
    const input = { drawingNodeId: 'd', ownerPartName: '', projection: rule!, resource: {} };
    const wide = widenedRule(input as never, 400);
    // The drawing keeps the whole line; the bar is its middle half.
    expect(wide.projection.extentEmu.cx).toBe(400 * EMU);
    const xs = wide.projection.vectorShape!.components[0]!.subpathsEmu[0]!.map((p) => p.x / EMU);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([100, 300]);
  });

  test('a rule with its own width and no share draws that width, capped by its line', () => {
    const [rule] = project(RULE.replace('width:0pt', 'width:100pt'));
    const input = { drawingNodeId: 'd', ownerPartName: '', projection: rule!, resource: {} };
    const xs = (width: number) =>
      widenedRule(input as never, width).projection.vectorShape!.components[0]!.subpathsEmu[0]!.map(
        (p) => p.x / EMU
      );
    // Centred: a 100pt bar in a 400pt line, and the whole of a 60pt line.
    expect([Math.min(...xs(400)), Math.max(...xs(400))]).toEqual([150, 250]);
    expect([Math.min(...xs(60)), Math.max(...xs(60))]).toEqual([0, 60]);
  });
});
