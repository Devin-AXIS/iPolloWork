// The shape around a legacy VML text box: outline, text area, turn, flow, outline style and
// shadow, as the projection reads them. Values follow measured renderings of each construct.

import { describe, expect, test } from 'bun:test';
import { projectDrawingsInPart, type DrawingProjection } from '../package/drawing-projection.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:w10="urn:schemas-microsoft-com:office:word" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const EMU = 12_700;
const POS =
  'position:absolute;margin-left:144pt;margin-top:200pt;width:200pt;height:100pt;z-index:1;' +
  'mso-position-horizontal-relative:page;mso-position-vertical-relative:page';
const T202 =
  '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe">' +
  '<v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>';
const DOWN_ARROW =
  '<v:shapetype id="_x0000_t67" coordsize="21600,21600" o:spt="67" adj="16200,5400" ' +
  'path="m0@0l@1@0@1,0@2,0@2@0,21600@0,10800,21600xe"><v:stroke joinstyle="miter"/><v:formulas>' +
  '<v:f eqn="val #0"/><v:f eqn="val #1"/><v:f eqn="sum height 0 #1"/><v:f eqn="sum 10800 0 #1"/>' +
  '<v:f eqn="sum width 0 #0"/><v:f eqn="prod @4 @3 10800"/><v:f eqn="sum width 0 @5"/></v:formulas>' +
  '<v:path o:connecttype="custom" o:connectlocs="10800,0;0,@0;10800,21600;21600,@0" ' +
  'o:connectangles="270,180,90,0" textboxrect="@1,0,@2,@6"/>' +
  '<v:handles><v:h position="#1,#0" xrange="0,10800" yrange="0,21600"/></v:handles></v:shapetype>';

const story = '<w:txbxContent><w:p><w:r><w:t>Story</w:t></w:r></w:p></w:txbxContent>';

function box(options: {
  host?: string;
  attrs?: string;
  style?: string;
  kids?: string;
  textbox?: string;
  template?: string;
}): string {
  const host = options.host ?? 'v:shape';
  const template = options.template ?? (host === 'v:shape' ? T202 : '');
  const attrs =
    options.attrs ?? (host === 'v:shape' ? 'type="#_x0000_t202" filled="f"' : 'filled="f"');
  return (
    `<w:pict>${template}<${host} style="${options.style ?? POS}" ${attrs}>${options.kids ?? ''}` +
    `<v:textbox${options.textbox ?? ''}>${story}</v:textbox></${host}></w:pict>`
  );
}

function project(content: string): DrawingProjection[] {
  const loaded = readOoxmlPart(
    `<w:document ${NS}><w:body><w:p><w:r>${content}</w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return projectDrawingsInPart(loaded.part);
}

function storyOf(content: string) {
  const drawings = project(content);
  expect(drawings).toHaveLength(1);
  const story = drawings[0]!.textboxStory;
  expect(story).toBeTruthy();
  return story!;
}

const points = (emu: number) => emu / EMU;

describe('rectangle templates', () => {
  test('a plain text box has no frame and a centred outline', () => {
    const story = storyOf(box({ attrs: 'type="#_x0000_t202" filled="f"' }));
    expect(story.legacyFrame).toBeUndefined();
    expect(story.strokeCentered).toBe(true);
  });

  test('each rectangle spelling, template and text box id is a rectangle', () => {
    const alt = T202.replace('m,l,21600r21600,l21600,xe', 'm0,0l0,21600,21600,21600,21600,0xe');
    const noStroke = T202.replace('<v:stroke joinstyle="miter"/>', '');
    const reused = T202.replace('_x0000_t202', '_x0000_t3');
    const rectangle =
      '<v:shapetype id="_x0000_t1" coordsize="21600,21600" o:spt="1" path="m,l,21600r21600,l21600,xe">' +
      '<v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>';
    for (const [template, type] of [
      [alt, '#_x0000_t202'],
      [noStroke, '#_x0000_t202'],
      ['', '#_x0000_t202'],
      [reused, '#_x0000_t3'],
      [rectangle, '#_x0000_t1'],
    ] as const) {
      const story = storyOf(box({ template, attrs: `type="${type}" filled="f"` }));
      expect(story.legacyFrame).toBeUndefined();
    }
  });

  test('inert path flags, extrusions, empty images and border hints keep the box', () => {
    for (const kids of [
      '<v:path o:extrusionok="f" fillok="t" limo="10800,10800"/>',
      '<o:extrusion v:ext="view" on="f"/>',
      '<v:imagedata o:title=""/>',
      '<w10:bordertop type="single" width="4"/>',
    ])
      expect(storyOf(box({ kids })).contentNodeId).toBeTruthy();
  });

  test('inherited object names in file values read as unknown, not as built-ins', () => {
    for (const style of ['constructor', '__proto__', 'tostring', 'hasownproperty'])
      expect(storyOf(box({ kids: `<v:stroke dashstyle="${style}"/>` })).strokeDash).toBeUndefined();
  });

  test('formulas on the shape itself refuse the box', () => {
    expect(project(box({ kids: '<v:formulas><v:f eqn="val 1"/></v:formulas>' }))).toEqual([]);
  });

  test('a picture fill or a switched-on extrusion refuses the box', () => {
    expect(project(box({ kids: '<v:imagedata r:id="rImage"/>' }))).toEqual([]);
    expect(project(box({ kids: '<o:extrusion v:ext="view" on="t"/>' }))).toEqual([]);
  });

  test('path switches hide the fill and the outline', () => {
    const noFill = storyOf(
      box({ attrs: 'type="#_x0000_t202" fillcolor="#ffd966"', kids: '<v:path fillok="f"/>' })
    );
    expect(noFill.fillHex).toBeNull();
    const noOutline = storyOf(
      box({
        attrs: 'type="#_x0000_t202" filled="f" strokeweight="4pt"',
        kids: '<v:path strokeok="f"/>',
      })
    );
    expect(noOutline.strokeHex).toBeNull();
    // The hidden outline still insets the text by half its width.
    expect(points(noOutline.legacyFrame!.textAreaEmu.left)).toBe(2);
  });

  test('an inset pen on the shape or its outline keeps the outline inside the box', () => {
    for (const options of [
      { attrs: 'type="#_x0000_t202" filled="f" insetpen="t"' },
      { kids: '<v:stroke weight="6pt" insetpen="t"/>' },
    ]) {
      const story = storyOf(box(options));
      expect(story.strokeInset).toBe(true);
      expect(story.strokeCentered).toBeUndefined();
    }
  });

  test('a shape takes its fill and outline switches, outline colour and weight from its template', () => {
    const off = T202.replace('o:spt="202"', 'o:spt="202" filled="f" stroked="f"');
    const quiet = storyOf(box({ template: off, attrs: 'type="#_x0000_t202"' }));
    expect(quiet.fillHex).toBeNull();
    expect(quiet.strokeHex).toBeNull();
    const styled = T202.replace(
      'o:spt="202"',
      'o:spt="202" fillcolor="#9dc3e6" strokecolor="#c00000" strokeweight="3pt"'
    ).replace('<v:stroke joinstyle="miter"/>', '<v:stroke joinstyle="miter" dashstyle="dash"/>');
    const story = storyOf(box({ template: styled, attrs: 'type="#_x0000_t202"' }));
    expect(story.strokeHex).toBe('C00000');
    expect(story.strokeWidthEmu).toBe(3 * EMU);
    // The template's fill colour and its outline element do not carry.
    expect(story.fillHex).toBe('FFFFFF');
    expect(story.strokeDash).toBeUndefined();
    const own = storyOf(
      box({
        template: off,
        attrs: 'type="#_x0000_t202" filled="t" stroked="t" fillcolor="#ffd966"',
      })
    );
    expect(own.fillHex).toBe('FFD966');
    expect(own.strokeHex).toBe('000000');
  });

  test('an explicit inset applies in either inset mode', () => {
    const auto = storyOf(box({ textbox: ' o:insetmode="auto" inset="2pt,6pt,14pt,24pt"' }));
    expect(auto.insetsEmu).toEqual({
      left: 2 * EMU,
      top: 6 * EMU,
      right: 14 * EMU,
      bottom: 24 * EMU,
    });
    const defaults = storyOf(box({ textbox: ' o:insetmode="auto"' }));
    expect(points(defaults.insetsEmu.left)).toBeCloseTo(7.2, 6);
  });
});

describe('outlines and text areas', () => {
  test('an oval keeps its text in the inscribed rectangle', () => {
    const frame = storyOf(box({ host: 'v:oval' })).legacyFrame!;
    expect(frame.outline).toEqual({ kind: 'ellipse' });
    const share = (1 - Math.SQRT1_2) / 2;
    expect(points(frame.textAreaEmu.left)).toBeCloseTo(200 * share, 2);
    expect(points(frame.textAreaEmu.top)).toBeCloseTo(100 * share, 2);
  });

  test('a round rectangle moves its text inside the corner arcs', () => {
    const frame = storyOf(
      box({ host: 'v:roundrect', attrs: 'arcsize="10923f" filled="f"' })
    ).legacyFrame!;
    expect(frame.outline).toEqual({ kind: 'roundRect', arc: 10923 / 65536 });
    // A sixth of the shorter side is the radius; the text clears its inscribed square.
    expect(points(frame.textAreaEmu.left)).toBeCloseTo((100 / 6) * (1 - Math.SQRT1_2), 2);
    expect(points(frame.textAreaEmu.top)).toBeCloseTo((100 / 6) * (1 - Math.SQRT1_2), 2);
  });

  test('a preset reads its outline and text area from its formulas', () => {
    const frame = storyOf(
      box({ template: DOWN_ARROW, attrs: 'type="#_x0000_t67" filled="f"' })
    ).legacyFrame!;
    expect(frame.outline?.kind).toBe('polygon');
    if (frame.outline?.kind !== 'polygon') throw new Error('polygon');
    expect(frame.outline.subpaths[0]![0]).toEqual({ x: 0, y: 0.75 });
    expect(points(frame.textAreaEmu.left)).toBeCloseTo(50, 2);
    expect(points(frame.textAreaEmu.right)).toBeCloseTo(50, 2);
    expect(points(frame.textAreaEmu.top)).toBe(0);
  });

  test('a flip mirrors a preset outline', () => {
    const frame = storyOf(
      box({ template: DOWN_ARROW, attrs: 'type="#_x0000_t67" filled="f"', style: `${POS};flip:y` })
    ).legacyFrame!;
    if (frame.outline?.kind !== 'polygon') throw new Error('polygon');
    expect(frame.outline.subpaths[0]![0]).toEqual({ x: 0, y: 0.25 });
  });

  test('a text area written on some shapes hides their text', () => {
    const inner = '<v:path textboxrect="2160,4320,19440,17280"/>';
    expect(storyOf(box({ host: 'v:rect', kids: inner })).legacyFrame?.textHidden).toBe(true);
    expect(storyOf(box({ host: 'v:oval', kids: inner })).legacyFrame?.textHidden).toBe(true);
    // A rectangle with its own coordinate size keeps an area that covers it.
    const covered = storyOf(
      box({
        host: 'v:rect',
        attrs: 'coordsize="21600,21600" filled="f"',
        kids: '<v:path textboxrect="0,0,21600,21600"/>',
      })
    );
    expect(covered.legacyFrame).toBeUndefined();
    // A round rectangle ignores its own area.
    const round = storyOf(
      box({ host: 'v:roundrect', attrs: 'arcsize="10923f" filled="f"', kids: inner })
    );
    expect(round.legacyFrame?.textHidden).toBeUndefined();
  });

  test('an untyped shape with no path paints nothing', () => {
    const story = storyOf(box({ attrs: 'fillcolor="#ffd966" strokeweight="3pt"', template: '' }));
    expect(story.legacyFrame?.textHidden).toBe(true);
    expect(story.fillHex).toBeNull();
    expect(story.strokeHex).toBeNull();
  });
});

describe('turn and flow', () => {
  test('a turn reads degrees and fixed-point degrees', () => {
    for (const rotation of ['90', '5898240f', '5898240fd', '-270'])
      expect(
        storyOf(box({ style: `${POS};rotation:${rotation}` })).legacyFrame?.rotationDegrees
      ).toBe(90);
  });

  test('text turns with the shape only when the text box says so', () => {
    const upright = storyOf(box({ style: `${POS};rotation:30` })).legacyFrame!;
    expect(upright.textTurnsWithShape).toBe(false);
    const turned = storyOf(
      box({ style: `${POS};rotation:30`, textbox: ' style="mso-rotate-with-shape:t"' })
    ).legacyFrame!;
    expect(turned.textTurnsWithShape).toBe(true);
  });

  test('vertical flow runs top to bottom or bottom to top', () => {
    expect(storyOf(box({ textbox: ' style="layout-flow:vertical"' })).legacyFrame?.flow).toBe(
      'vertical'
    );
    expect(
      storyOf(box({ textbox: ' style="layout-flow:vertical-ideographic"' })).legacyFrame?.flow
    ).toBe('vertical');
    expect(
      storyOf(box({ textbox: ' style="layout-flow:vertical;mso-layout-flow-alt:bottom-to-top"' }))
        .legacyFrame?.flow
    ).toBe('verticalBottomToTop');
    expect(
      storyOf(box({ textbox: ' style="mso-direction-alt:auto"' })).legacyFrame
    ).toBeUndefined();
    // Ideographic vertical flow keeps CJK text upright, which a turned story cannot do.
    const cjk = box({ textbox: ' style="layout-flow:vertical-ideographic"' }).replace(
      'Story',
      '縦書き'
    );
    expect(project(cjk)).toEqual([]);
  });

  test('a box that fits its text says so', () => {
    expect(storyOf(box({ textbox: ' style="mso-fit-shape-to-text:t"' })).fitHeightToText).toBe(
      true
    );
  });
});

describe('outline style and shadow', () => {
  test('named and two-part dash patterns are read in outline widths', () => {
    const dash = (style: string) =>
      storyOf(box({ kids: `<v:stroke dashstyle="${style}"/>` })).strokeDash;
    expect(dash('dash')).toEqual([4, 3]);
    expect(dash('shortdashdot')).toEqual([3, 1, 1, 1]);
    expect(dash('longdashdotdot')).toEqual([8, 3, 1, 3, 1, 3]);
    expect(dash('dot')).toEqual([1, 3]);
    expect(dash('1 1')).toEqual([1, 1]);
    expect(dash('5 2 1 2')).toBeUndefined();
    expect(dash('solid')).toBeUndefined();
    expect(storyOf(box({ kids: '<v:stroke dashstyle="dash" endcap="round"/>' })).strokeCap).toBe(
      'round'
    );
  });

  test('a text box keeps 9 pt beside wrapped text unless it names its distances', () => {
    const [drawing] = project(box({ kids: '<w10:wrap type="square"/>' }));
    expect(drawing!.wrapGeometry?.distancesEmu).toEqual({
      top: 0,
      right: 9 * EMU,
      bottom: 0,
      left: 9 * EMU,
    });
    const [named] = project(
      box({
        kids: '<w10:wrap type="square"/>',
        style: `${POS};mso-wrap-distance-left:2pt;mso-wrap-distance-right:0`,
      })
    );
    expect(named!.wrapGeometry?.distancesEmu.left).toBe(2 * EMU);
    expect(named!.wrapGeometry?.distancesEmu.right).toBe(0);
  });

  test('a shadow paints only when switched on', () => {
    expect(storyOf(box({ kids: '<v:shadow/>' })).shadow).toBeUndefined();
    expect(storyOf(box({ kids: '<v:shadow on="t"/>' })).shadow).toEqual({
      hex: '808080',
      alpha: 1,
      offsetXEmu: 2 * EMU,
      offsetYEmu: 2 * EMU,
      obscured: false,
    });
    expect(storyOf(box({ kids: '<v:shadow on="t" obscured="t"/>' })).shadow?.obscured).toBe(true);
    expect(
      storyOf(box({ kids: '<v:shadow on="t" color="#c00000" offset="6pt,-4pt" opacity=".5"/>' }))
        .shadow
    ).toEqual({
      hex: 'C00000',
      alpha: 0.5,
      offsetXEmu: 6 * EMU,
      offsetYEmu: -4 * EMU,
      obscured: false,
    });
  });
});
