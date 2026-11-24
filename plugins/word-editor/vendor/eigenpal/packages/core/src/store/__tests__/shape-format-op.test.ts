// `setShapeFormat` writes the fill and outline markup Word writes for the same edit, keeps a
// matching VML fallback in step, and refuses targets and values it cannot write exactly.

import { describe, expect, test } from 'bun:test';
import { projectDrawingsInPart } from '../package/drawing-projection.ts';
import { readShapeFormat, shapeFormatTargets } from '../package/shape-format.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp } from '../store/tree-ops.ts';
import type { TreeDocOp } from '../store/tree-op-types.ts';

const NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
  'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"',
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
  'xmlns:v="urn:schemas-microsoft-com:vml"',
  'xmlns:o="urn:schemas-microsoft-com:office:office"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
].join(' ');

const XFRM = '<a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>';
const RECT = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
const STYLE =
  '<wps:style><a:lnRef idx="2"><a:srgbClr val="2F528F"/></a:lnRef>' +
  '<a:fillRef idx="1"><a:srgbClr val="4472C4"/></a:fillRef>' +
  '<a:effectRef idx="0"><a:srgbClr val="4472C4"/></a:effectRef>' +
  '<a:fontRef idx="minor"><a:srgbClr val="FFFFFF"/></a:fontRef></wps:style>';

const wsp = (spPr: string, id = 1) =>
  `<wps:wsp><wps:cNvSpPr/><wps:spPr>${spPr}</wps:spPr>${STYLE}<wps:bodyPr/></wps:wsp>`.replace(
    '<wps:cNvSpPr/>',
    `<wps:cNvSpPr><a:spLocks noChangeArrowheads="${id % 2}"/></wps:cNvSpPr>`
  );

const anchor = (uri: string, payload: string, id = 1) =>
  `<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  `<wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
  `<wp:docPr id="${id}" name="Shape ${id}"/><wp:cNvGraphicFramePr/>` +
  `<a:graphic><a:graphicData uri="${uri}">${payload}</a:graphicData></a:graphic></wp:anchor></w:drawing>`;

const WPS_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';

function alternate(spPr: string, fallback: string): string {
  return (
    `<mc:AlternateContent><mc:Choice Requires="wps">${anchor(WPS_URI, wsp(spPr))}</mc:Choice>` +
    `<mc:Fallback><w:pict>${fallback}</w:pict></mc:Fallback></mc:AlternateContent>`
  );
}

function parse(run: string): OoxmlPart {
  const xml = `<w:document ${NS}><w:body><w:p><w:r>${run}</w:r></w:p></w:body></w:document>`;
  const loaded = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.part;
}

function find(node: OoxmlNode, localName: string): OoxmlNode | null {
  if (node.kind === 'textValue') return null;
  if (node.localName === localName) return node;
  for (const child of node.children) {
    const found = find(child, localName);
    if (found) return found;
  }
  return null;
}

function idOf(part: OoxmlPart, localName: string): string {
  const node = find(part.root, localName);
  if (!node) throw new Error(`no ${localName}`);
  return node.id;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.part;
}

const xml = (part: OoxmlPart) => serializeOoxmlPart(part);
const between = (text: string, start: string, end: string) =>
  text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)) + end.length);

describe('setShapeFormat on a DrawingML shape', () => {
  const SOLID = `${XFRM}${RECT}<a:solidFill><a:srgbClr val="D9E2F3"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>`;
  const FALLBACK =
    '<v:rect id="_x0000_s1026" style="width:72pt;height:36pt" fillcolor="#d9e2f3" strokeweight="1pt"/>';

  test('a solid colour replaces the fill in place and writes the fallback colour', () => {
    const part = parse(alternate(SOLID, FALLBACK));
    const ac = idOf(part, 'AlternateContent');
    const out = xml(
      apply(part, {
        op: 'setShapeFormat',
        drawingNodeId: ac,
        fill: { type: 'solid', color: 'ff0000' },
      })
    );
    expect(between(out, '<wps:spPr>', '</wps:spPr>')).toBe(
      `<wps:spPr>${XFRM}${RECT}<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr>`
    );
    expect(out).toContain('fillcolor="#ff0000"');
  });

  test('no fill keeps the old fill in a14:hiddenFill, and a solid fill without a colour restores it', () => {
    const part = parse(alternate(SOLID, FALLBACK));
    const ac = idOf(part, 'AlternateContent');
    const hidden = apply(part, { op: 'setShapeFormat', drawingNodeId: ac, fill: { type: 'none' } });
    const out = xml(hidden);
    expect(between(out, '<wps:spPr>', '</wps:spPr>')).toMatch(
      /<a:prstGeom prst="rect"><a:avLst\/><\/a:prstGeom><a:noFill\/><a:ln w="12700">.*<\/a:ln><a:extLst><a:ext uri="\{909E8E84-426E-40DD-AFC4-6F175D3DCCD1\}"><a14:hiddenFill( xmlns:a14="[^"]+")?><a:solidFill><a:srgbClr val="D9E2F3"\/><\/a:solidFill><\/a14:hiddenFill><\/a:ext><\/a:extLst><\/wps:spPr>/
    );
    expect(out).toContain('filled="f"');
    const restored = xml(
      apply(hidden, { op: 'setShapeFormat', drawingNodeId: ac, fill: { type: 'solid' } })
    );
    expect(between(restored, '<wps:spPr>', '</wps:spPr>')).toBe(
      between(xml(part), '<wps:spPr>', '</wps:spPr>')
    );
    expect(restored).not.toContain('filled=');
    // A fill moves into and out of hiding as a copy with new ids, never with its own: a room
    // keeps two file-id fills that concurrent undos leave side by side as the file's content.
    // The shape's own fill: the outline's fill under `a:ln` stays where it is.
    const idsOf = (node: OoxmlNode, out: string[] = []): string[] => {
      if (node.kind === 'textValue' || node.localName === 'ln') return out;
      if (node.localName === 'solidFill') out.push(node.id);
      for (const child of node.children) idsOf(child, out);
      return out;
    };
    const original = idsOf(part.root);
    const hiddenIds = idsOf(hidden.root);
    const shown = idsOf(
      apply(hidden, { op: 'setShapeFormat', drawingNodeId: ac, fill: { type: 'solid' } }).root
    );
    expect(hiddenIds.some((id) => original.includes(id))).toBe(false);
    expect(shown.some((id) => hiddenIds.includes(id) || original.includes(id))).toBe(false);
  });

  test('transparency writes a:alpha, and a new colour keeps it', () => {
    const part = parse(alternate(SOLID, FALLBACK));
    const ac = idOf(part, 'AlternateContent');
    const clear = apply(part, {
      op: 'setShapeFormat',
      drawingNodeId: ac,
      fill: { type: 'solid', transparency: 0.5 },
    });
    expect(xml(clear)).toContain('<a:srgbClr val="D9E2F3"><a:alpha val="50000"/></a:srgbClr>');
    const recolored = apply(clear, {
      op: 'setShapeFormat',
      drawingNodeId: ac,
      fill: { type: 'solid', color: '00FF00' },
    });
    expect(xml(recolored)).toContain('<a:srgbClr val="00FF00"><a:alpha val="50000"/></a:srgbClr>');
    const opaque = apply(recolored, {
      op: 'setShapeFormat',
      drawingNodeId: ac,
      fill: { type: 'solid', transparency: 0 },
    });
    expect(xml(opaque)).toContain('<a:srgbClr val="00FF00"/>');
  });

  test('a theme colour writes a:schemeClr with lumMod and lumOff, and reads back as a theme', () => {
    const part = parse(alternate(SOLID, FALLBACK));
    const ac = idOf(part, 'AlternateContent');
    const clear = apply(part, {
      op: 'setShapeFormat',
      drawingNodeId: ac,
      fill: { type: 'solid', transparency: 0.5 },
    });
    // Lighter 40%: lumMod 60000 and lumOff 40000, and the transparency stays.
    const tint = apply(clear, {
      op: 'setShapeFormat',
      drawingNodeId: ac,
      fill: { type: 'solid', color: '8FAADC', theme: { name: 'accent1', shift: 40 } },
    });
    expect(xml(tint)).toContain(
      '<a:solidFill><a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/><a:alpha val="50000"/></a:schemeClr></a:solidFill>'
    );
    // The VML fallback takes the colour the reference resolves to.
    expect(xml(tint)).toContain('fillcolor="#8faadc"');
    // Darker 25%: lumMod 75000 only; the theme colour itself has no transform.
    const shade = apply(tint, {
      op: 'setShapeFormat',
      drawingNodeId: ac,
      outline: { color: '2F5597', theme: { name: 'accent1', shift: -25 } },
    });
    expect(xml(shade)).toContain(
      '<a:ln w="12700"><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr></a:solidFill></a:ln>'
    );
    const plain = apply(shade, {
      op: 'setShapeFormat',
      drawingNodeId: ac,
      outline: { color: '000000', theme: { name: 'tx1' } },
    });
    expect(xml(plain)).toContain('<a:schemeClr val="tx1"/>');
    const targets = shapeFormatTargets(plain, ac);
    if (!targets) throw new Error('no targets');
    const theme = {
      resolveSchemeColor: (slot: string) => (slot === 'tx1' ? '000000' : '4472C4'),
      resolveStyleMatrixReference: () => null,
      cacheToken: 'test',
    };
    const format = readShapeFormat(targets, theme);
    expect(format.fill).toMatchObject({ type: 'solid', color: '8FAADC', transparency: 0.5 });
    expect(format.fill.theme).toEqual({ name: 'accent1', shift: 40 });
    expect(format.outline.theme).toEqual({ name: 'tx1', shift: 0 });
    // An RGB colour has no theme, even when it matches a theme colour.
    expect(readShapeFormat(shapeFormatTargets(part, ac)!, theme).fill.theme).toBeUndefined();
  });

  test('a theme colour refuses a bad name, shift, or a missing resolved colour', () => {
    const part = parse(alternate(SOLID, FALLBACK));
    const ac = idOf(part, 'AlternateContent');
    const refused = (fill: unknown) =>
      applyTreeOp(part, { op: 'setShapeFormat', drawingNodeId: ac, fill } as TreeDocOp);
    for (const fill of [
      { type: 'solid', color: '4472C4', theme: { name: 'accent9' } },
      { type: 'solid', color: '4472C4', theme: { name: 'accent1', shift: 101 } },
      { type: 'solid', color: '4472C4', theme: { name: 'accent1', shift: 2.5 } },
      { type: 'solid', theme: { name: 'accent1' } },
      { type: 'solid', color: '', theme: { name: 'accent1' } },
    ])
      expect(refused(fill)).toMatchObject({ ok: false, reason: 'invalid-drawing-value' });
  });

  test('an outline colour and width write a:ln and the fallback stroke', () => {
    const part = parse(alternate(SOLID, FALLBACK));
    const ac = idOf(part, 'AlternateContent');
    const out = xml(
      apply(part, {
        op: 'setShapeFormat',
        drawingNodeId: ac,
        outline: { color: '0000FF', widthPt: 3 },
      })
    );
    expect(out).toContain(
      '<a:ln w="38100"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln>'
    );
    expect(out).toContain('strokecolor="#0000ff"');
    expect(out).toContain('strokeweight="3pt"');
  });

  test('a hidden outline keeps @w and moves the colour to a14:hiddenLine; showing it restores the colour', () => {
    const part = parse(alternate(SOLID, FALLBACK));
    const ac = idOf(part, 'AlternateContent');
    const hidden = apply(part, {
      op: 'setShapeFormat',
      drawingNodeId: ac,
      outline: { visible: false },
    });
    expect(xml(hidden)).toMatch(
      /<a:ln w="12700"><a:noFill\/><a:extLst><a:ext uri="\{91240B29-F687-4F45-9708-019B960494DF\}"><a14:hiddenLine( xmlns:a14="[^"]+")? w="12700"><a:solidFill><a:srgbClr val="000000"\/><\/a:solidFill><\/a14:hiddenLine><\/a:ext><\/a:extLst><\/a:ln>/
    );
    expect(xml(hidden)).toContain('stroked="f"');
    const shown = apply(hidden, {
      op: 'setShapeFormat',
      drawingNodeId: ac,
      outline: { visible: true },
    });
    expect(xml(shown)).toContain(
      '<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>'
    );
  });

  test('a shape that takes its paint from its style gets the fill and line in schema order', () => {
    const part = parse(anchor(WPS_URI, wsp(`${XFRM}${RECT}`)));
    const drawing = idOf(part, 'drawing');
    const out = xml(
      apply(part, {
        op: 'setShapeFormat',
        drawingNodeId: drawing,
        fill: { type: 'none' },
        outline: { widthPt: 2.25 },
      })
    );
    expect(between(out, '<wps:spPr>', '</wps:spPr>')).toBe(
      `<wps:spPr>${XFRM}${RECT}<a:noFill/><a:ln w="28575"/></wps:spPr>`
    );
  });

  test('reads the fill and outline back, through the style and theme', () => {
    const part = parse(alternate(SOLID, FALLBACK));
    const targets = shapeFormatTargets(part, idOf(part, 'AlternateContent'));
    if (typeof targets === 'string') throw new Error(targets);
    expect(readShapeFormat(targets)).toEqual({
      fill: { type: 'solid', color: 'D9E2F3', transparency: 0 },
      outline: { visible: true, color: '000000', widthPt: 1, dash: 'solid' },
    });
  });
});

describe('setShapeFormat on groups and legacy VML', () => {
  const member = (fill: string) =>
    wsp(`${XFRM}${RECT}<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>`);
  const group = `<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr/>${member('111111')}${member('222222')}</wpg:wgp>`;

  test('a group formats every shape, or the one shapeNodeId names', () => {
    const part = parse(anchor(WPG_URI, group));
    const drawing = idOf(part, 'drawing');
    const all = xml(
      apply(part, {
        op: 'setShapeFormat',
        drawingNodeId: drawing,
        fill: { type: 'solid', color: 'ABCDEF' },
      })
    );
    expect(all.match(/val="ABCDEF"/g)?.length).toBe(2);
    const targets = shapeFormatTargets(part, drawing);
    if (typeof targets === 'string') throw new Error(targets);
    expect(readShapeFormat(targets).fill.type).toBe('mixed');
    const second = targets.shapes[1]!.id;
    const one = xml(
      apply(part, {
        op: 'setShapeFormat',
        drawingNodeId: drawing,
        shapeNodeId: second,
        fill: { type: 'none' },
      })
    );
    expect(one).toContain('val="111111"');
    expect(one).toContain('<a:noFill/>');
  });

  test('a legacy VML shape takes the VML attributes and its v:fill override goes', () => {
    const part = parse(
      '<w:pict><v:rect id="_x0000_s1030" style="width:72pt;height:36pt" fillcolor="red" strokecolor="black"><v:fill color="green"/></v:rect></w:pict>'
    );
    const pict = idOf(part, 'pict');
    const out = xml(
      apply(part, {
        op: 'setShapeFormat',
        drawingNodeId: pict,
        fill: { type: 'solid', color: '00FF00' },
        outline: { visible: false },
      })
    );
    expect(out).toContain('fillcolor="#00ff00"');
    expect(out).toContain('stroked="f"');
    expect(out).toContain('<v:fill/>');
    const targets = shapeFormatTargets(
      apply(part, { op: 'setShapeFormat', drawingNodeId: pict, fill: { type: 'none' } }),
      pict
    );
    if (typeof targets === 'string') throw new Error(targets);
    expect(readShapeFormat(targets).fill.type).toBe('none');
  });

  test('refuses pictures, bad values, and a legacy transparency', () => {
    const picture = parse(
      anchor(
        'http://schemas.openxmlformats.org/drawingml/2006/picture',
        '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill><pic:spPr/></pic:pic>'
      )
    );
    const refused = (part: OoxmlPart, op: TreeDocOp) => {
      const result = applyTreeOp(part, op);
      return result.ok ? 'applied' : result.reason;
    };
    expect(
      refused(picture, {
        op: 'setShapeFormat',
        drawingNodeId: idOf(picture, 'drawing'),
        fill: { type: 'none' },
      })
    ).toBe('not-a-shape-drawing');
    const shape = parse(anchor(WPS_URI, wsp(`${XFRM}${RECT}`)));
    const drawing = idOf(shape, 'drawing');
    for (const op of [
      { op: 'setShapeFormat', drawingNodeId: drawing },
      { op: 'setShapeFormat', drawingNodeId: drawing, fill: { type: 'solid', color: 'red' } },
      { op: 'setShapeFormat', drawingNodeId: drawing, fill: { type: 'solid', transparency: 2 } },
      { op: 'setShapeFormat', drawingNodeId: drawing, outline: { widthPt: 0 } },
      { op: 'setShapeFormat', drawingNodeId: drawing, outline: { widthPt: 2000 } },
      {
        op: 'setShapeFormat',
        drawingNodeId: drawing,
        outline: { visible: false, color: '000000' },
      },
    ] as TreeDocOp[])
      expect(refused(shape, op)).toBe('invalid-drawing-value');
    const legacy = parse(
      '<w:pict><v:rect id="_x0000_s1030" style="width:72pt;height:36pt"/></w:pict>'
    );
    expect(
      refused(legacy, {
        op: 'setShapeFormat',
        drawingNodeId: idOf(legacy, 'pict'),
        fill: { type: 'solid', color: 'FF0000', transparency: 0.5 },
      })
    ).toBe('unsupported-property');
  });
});

describe('setShapeFormat output paints', () => {
  test('the projection paints the transparency, hidden outline and new outline as written', () => {
    const spPr = `${XFRM}${RECT}<a:solidFill><a:srgbClr val="D9E2F3"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>`;
    let part = parse(anchor(WPS_URI, wsp(spPr)));
    const drawing = idOf(part, 'drawing');
    const paint = () => projectDrawingsInPart(part)[0]?.vectorShape;
    part = apply(part, {
      op: 'setShapeFormat',
      drawingNodeId: drawing,
      fill: { type: 'solid', transparency: 0.25 },
      outline: { visible: false },
    });
    expect(paint()).toMatchObject({ fillHex: 'D9E2F3', fillAlpha: 0.75, strokeHex: null });
    part = apply(part, {
      op: 'setShapeFormat',
      drawingNodeId: drawing,
      fill: { type: 'none' },
      outline: { color: 'FF0000', widthPt: 4 },
    });
    expect(paint()).toMatchObject({ fillHex: null, strokeHex: 'FF0000', strokeWidthEmu: 50800 });
  });
});

describe('setShapeFormat never invents a fill', () => {
  const refused = (part: OoxmlPart, op: TreeDocOp) => {
    const result = applyTreeOp(part, op);
    return result.ok ? 'applied' : result.reason;
  };

  test('a style with fillRef idx 0 has no fill to make transparent or bring back', () => {
    const noFillStyle = wsp(`${XFRM}${RECT}`).replace('fillRef idx="1"', 'fillRef idx="0"');
    const part = parse(anchor(WPS_URI, noFillStyle));
    const drawing = idOf(part, 'drawing');
    expect(
      refused(part, {
        op: 'setShapeFormat',
        drawingNodeId: drawing,
        fill: { type: 'solid', transparency: 0.5 },
      })
    ).toBe('no-solid-fill');
    expect(
      refused(part, { op: 'setShapeFormat', drawingNodeId: drawing, fill: { type: 'solid' } })
    ).toBe('no-solid-fill');
    // A colour is always enough.
    const out = xml(
      apply(part, {
        op: 'setShapeFormat',
        drawingNodeId: drawing,
        fill: { type: 'solid', color: '00B050', transparency: 0.5 },
      })
    );
    expect(out).toContain('<a:srgbClr val="00B050"><a:alpha val="50000"/></a:srgbClr>');
  });

  // Word renders a:grpFill members in the group's grpSpPr fill and paints no fill for the group
  // itself (2026-11-12 render). Its Mac scripting model has no access to group members, so how
  // Word saves a recoloured member is not probed; the write keeps the group fill and gives the
  // member an explicit fill, as the members of a group with no grpSpPr fill already carry.
  test('a group member with a:grpFill reads the group colour and writes it as its own', () => {
    const member = wsp(`${XFRM}${RECT}<a:grpFill/>`);
    const group = (fill: string) =>
      `<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>${XFRM}${fill}</wpg:grpSpPr>${member}</wpg:wgp>`;
    const part = parse(
      anchor(WPG_URI, group('<a:solidFill><a:srgbClr val="C00000"/></a:solidFill>'))
    );
    const drawing = idOf(part, 'drawing');
    const targets = shapeFormatTargets(part, drawing);
    if (typeof targets === 'string') throw new Error(targets);
    expect(readShapeFormat(targets).fill).toEqual({
      type: 'solid',
      color: 'C00000',
      transparency: 0,
    });
    const out = xml(
      apply(part, {
        op: 'setShapeFormat',
        drawingNodeId: drawing,
        fill: { type: 'solid', transparency: 0.25 },
      })
    );
    expect(out).toContain('<a:srgbClr val="C00000"><a:alpha val="75000"/></a:srgbClr>');
    expect(out).not.toContain('<a:grpFill/>');
    // A group with no solid fill of its own leaves nothing to make transparent.
    const plain = parse(anchor(WPG_URI, group('')));
    expect(
      refused(plain, {
        op: 'setShapeFormat',
        drawingNodeId: idOf(plain, 'drawing'),
        fill: { type: 'solid', transparency: 0.25 },
      })
    ).toBe('no-solid-fill');
  });
});

describe('a:grpFill paints the group fill', () => {
  test('a member that inherits a solid group fill paints it, before and after a write', () => {
    const groupXfrm =
      '<a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/>' +
      '<a:chOff x="0" y="0"/><a:chExt cx="914400" cy="457200"/></a:xfrm>';
    const member = wsp(`${XFRM}${RECT}<a:grpFill/>`);
    const group =
      `<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>${groupXfrm}` +
      `<a:solidFill><a:srgbClr val="C00000"/></a:solidFill></wpg:grpSpPr>${member}</wpg:wgp>`;
    let part = parse(anchor(WPG_URI, group));
    const paint = () => projectDrawingsInPart(part)[0]?.vectorShape?.components[0];
    expect(paint()).toMatchObject({ fillHex: 'C00000', fillAlpha: 1 });
    part = apply(part, {
      op: 'setShapeFormat',
      drawingNodeId: idOf(part, 'drawing'),
      fill: { type: 'solid', transparency: 0.25 },
    });
    expect(paint()).toMatchObject({ fillHex: 'C00000', fillAlpha: 0.75 });
  });
});

describe('setShapeFormat writes an outline dash', () => {
  const LINE = `${XFRM}${RECT}<a:solidFill><a:srgbClr val="D9E2F3"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:round/></a:ln>`;
  const FALLBACK =
    '<v:rect id="_x0000_s1026" style="width:72pt;height:36pt" fillcolor="#d9e2f3" strokeweight="1pt"/>';
  const dashOf = (part: OoxmlPart) =>
    readShapeFormat(shapeFormatTargets(part, idOf(part, 'AlternateContent')) as never).outline.dash;

  test('a preset dash goes after the line fill, keeps the join, and reaches the fallback', () => {
    const part = parse(alternate(LINE, FALLBACK));
    const ac = idOf(part, 'AlternateContent');
    expect(dashOf(part)).toBe('solid');
    const dashed = apply(part, {
      op: 'setShapeFormat',
      drawingNodeId: ac,
      outline: { dash: 'sysDot' },
    });
    const out = xml(dashed);
    expect(between(out, '<a:ln', '</a:ln>')).toBe(
      '<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="sysDot"/><a:round/></a:ln>'
    );
    expect(out).toMatch(/<v:stroke dashstyle="shortdot"\/>/);
    expect(dashOf(dashed)).toBe('sysDot');
    // A second dash replaces the first; solid writes an explicit solid and drops the VML style.
    const long = apply(dashed, {
      op: 'setShapeFormat',
      drawingNodeId: ac,
      outline: { dash: 'lgDashDot' },
    });
    expect(xml(long).match(/prstDash/g)).toHaveLength(1);
    expect(xml(long)).toContain('dashstyle="longdashdot"');
    const solid = xml(
      apply(long, { op: 'setShapeFormat', drawingNodeId: ac, outline: { dash: 'solid' } })
    );
    expect(solid).toContain('<a:prstDash val="solid"/>');
    expect(solid).not.toContain('dashstyle=');
  });

  test('a custom dash reads as custom; a bad preset refuses', () => {
    const custom = LINE.replace(
      '<a:round/>',
      '<a:custDash><a:ds d="200000" sp="50000"/></a:custDash>'
    );
    const part = parse(alternate(custom, FALLBACK));
    expect(dashOf(part)).toBe('custom');
    const ac = idOf(part, 'AlternateContent');
    const out = xml(
      apply(part, { op: 'setShapeFormat', drawingNodeId: ac, outline: { dash: 'dash' } })
    );
    expect(out).not.toContain('custDash');
    expect(out).toContain('<a:prstDash val="dash"/>');
    const result = applyTreeOp(part, {
      op: 'setShapeFormat',
      drawingNodeId: ac,
      outline: { dash: 'wavy' as never },
    });
    expect(result).toMatchObject({ ok: false, reason: 'invalid-drawing-value' });
  });

  test('a legacy VML shape writes v:stroke dashstyle and reads it back', () => {
    const legacy = parse(
      '<w:pict><v:rect id="_x0000_s1030" style="width:72pt;height:36pt" strokecolor="black"><v:stroke weight="2pt"/></v:rect></w:pict>'
    );
    const pict = idOf(legacy, 'pict');
    const dashed = apply(legacy, {
      op: 'setShapeFormat',
      drawingNodeId: pict,
      outline: { dash: 'dash' },
    });
    expect(xml(dashed)).toContain('<v:stroke dashstyle="dash" weight="2pt"/>');
    expect(readShapeFormat(shapeFormatTargets(dashed, pict) as never).outline.dash).toBe('dash');
  });
});
