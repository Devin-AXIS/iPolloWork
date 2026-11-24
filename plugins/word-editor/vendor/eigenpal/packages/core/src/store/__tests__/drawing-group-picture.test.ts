// A `wpg:wgp` group can hold a raster picture beside its vector members, for example a
// scanned page with ruled lines drawn over it. The vector projection accepts `wps:wsp`
// members only, so a picture member made the whole group project as nothing. These tests pin
// the group picture projection: which groups it accepts, where the picture lands inside the
// drawing extent, and every group it still refuses.

import { createPackageShapeThemeResolvers } from '../package/theme-color-resolution.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI, type OoxmlPart } from '../index.ts';
import {
  indexInlineDrawingProjectionsInPart,
  projectDrawingsInPart,
} from '../package/drawing-projection.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';

/** Group child space: offset (100, 200), extent 3000 x 4000, drawn at 6000000 x 8000000 EMU. */
const SCALE = 2000;

function parsePart(body: string): OoxmlPart {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:pic="${PIC}" xmlns:r="${R}" xmlns:wps="${WPS}" xmlns:wpg="${WPG}" ` +
    `xmlns:mc="${MC}" xmlns:v="${V}"><w:body>${body}</w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

interface PictureOptions {
  readonly x?: number;
  readonly y?: number;
  readonly cx?: number;
  readonly cy?: number;
  readonly xfrmAttributes?: string;
  readonly blip?: string;
  readonly fill?: string;
  readonly geometry?: string;
}

function pictureMember(options: PictureOptions = {}): string {
  const { x = 100, y = 200, cx = 3000, cy = 1000 } = options;
  return (
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill>${options.blip ?? '<a:blip r:embed="rIdImg"/>'}` +
    `${options.fill ?? '<a:stretch><a:fillRect/></a:stretch>'}</pic:blipFill>` +
    `<pic:spPr><a:xfrm${options.xfrmAttributes ?? ''}><a:off x="${x}" y="${y}"/>` +
    `<a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `${options.geometry ?? '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'}</pic:spPr></pic:pic>`
  );
}

/** A thin black bar in group child space. */
function barMember(y: number, x = 600, line = ''): string {
  return (
    '<wps:wsp><wps:cNvPr id="3" name="Bar"/><wps:cNvSpPr/><wps:spPr>' +
    `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="1000" cy="10"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    `<a:solidFill><a:srgbClr val="000000"/></a:solidFill>${line}</wps:spPr><wps:bodyPr/></wps:wsp>`
  );
}

function textboxMember(): string {
  return (
    '<wps:wsp><wps:spPr><a:xfrm><a:off x="600" y="3000"/><a:ext cx="1000" cy="500"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Box</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
    '<wps:bodyPr/></wps:wsp>'
  );
}

function groupDrawing(members: string, groupXfrmAttributes = ''): string {
  return (
    '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="10" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>360000</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>180000</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="6000000" cy="8000000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapNone/><wp:docPr id="1" name="Group 1"/>' +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    `<a:xfrm${groupXfrmAttributes}><a:off x="0" y="0"/><a:ext cx="6000000" cy="8000000"/>` +
    '<a:chOff x="100" y="200"/><a:chExt cx="3000" cy="4000"/></a:xfrm></wpg:grpSpPr>' +
    `${members}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing>`
  );
}

function mcWrapped(drawing: string): string {
  return (
    `<mc:AlternateContent><mc:Choice Requires="wpg">${drawing}</mc:Choice>` +
    '<mc:Fallback><w:pict><v:group id="fallback"/></w:pict></mc:Fallback></mc:AlternateContent>'
  );
}

function projectionsOf(run: string) {
  return projectDrawingsInPart(parsePart(`<w:p><w:r>${run}</w:r></w:p>`));
}

describe('group picture projection', () => {
  test('an MC-wrapped group projects its picture member and its vector members', () => {
    const drawing = groupDrawing(
      pictureMember({ blip: '<a:blip r:embed="rIdImg"><a:extLst/></a:blip>' }) +
        barMember(2100) +
        barMember(2600)
    );
    const projections = projectionsOf(mcWrapped(drawing));
    expect(projections).toHaveLength(1);
    const projection = projections[0]!;
    expect(projection.picture).toBeNull();
    expect(projection.groupPicture).toMatchObject({
      embeddedRelationshipId: 'rIdImg',
      linkedRelationshipId: null,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      frameEmu: { x: 0, y: 0, cx: 3000 * SCALE, cy: 1000 * SCALE },
    });
    // The picture member is not a vector member; only the two bars are.
    expect(projection.vectorShape?.components).toHaveLength(2);
    expect(projection.vectorShape?.components[0]!.subpathsEmu[0]![0]).toEqual({
      x: 500 * SCALE,
      y: 1900 * SCALE,
    });
    expect(projection.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'unsupported-graphic'
    );
  });

  test('a text box member paints only its shape, and one without paint is skipped', () => {
    // A group does not lay out text box text. An unfilled, unoutlined text box paints nothing.
    const [plain] = projectionsOf(mcWrapped(groupDrawing(pictureMember() + textboxMember())));
    expect(plain!.groupPicture).toMatchObject({ embeddedRelationshipId: 'rIdImg' });
    expect(plain!.vectorShape).toBeNull();
    // A text box member before the picture paints nothing, so it does not order the picture.
    const [first] = projectionsOf(mcWrapped(groupDrawing(textboxMember() + pictureMember())));
    expect(first!.groupPicture).toMatchObject({ embeddedRelationshipId: 'rIdImg' });
    // A filled text box paints its fill above the picture.
    const filled = textboxMember().replace(
      '</a:prstGeom>',
      '</a:prstGeom><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>'
    );
    const [painted] = projectionsOf(mcWrapped(groupDrawing(pictureMember() + filled)));
    expect(painted!.groupPicture).not.toBeNull();
    expect(painted!.vectorShape?.components.map((c) => c.fillHex)).toEqual(['00FF00']);
    // A text box with an effect the group cannot paint still leaves the group unpainted.
    const shadowed = textboxMember().replace(
      '</a:prstGeom>',
      '</a:prstGeom><a:effectLst><a:outerShdw dist="38100"/></a:effectLst>'
    );
    expect(projectionsOf(mcWrapped(groupDrawing(pictureMember() + shadowed)))).toHaveLength(1);
    // So does one whose theme effect the group cannot resolve.
    const themed = textboxMember().replace(
      '</wps:spPr>',
      '</wps:spPr><wps:style><a:effectRef idx="1"><a:schemeClr val="accent1"/></a:effectRef></wps:style>'
    );
    expect(projectionsOf(mcWrapped(groupDrawing(pictureMember() + themed)))).toHaveLength(1);
  });

  test('the picture frame maps through the group child offset and extent', () => {
    const [projection] = projectionsOf(
      groupDrawing(
        pictureMember({
          x: 1100,
          y: 1200,
          cx: 500,
          cy: 250,
          fill: '<a:srcRect l="10000" t="20000"/><a:stretch><a:fillRect/></a:stretch>',
        })
      )
    );
    expect(projection!.groupPicture).toMatchObject({
      crop: { left: 0.1, top: 0.2, right: 0, bottom: 0 },
      frameEmu: { x: 1000 * SCALE, y: 1000 * SCALE, cx: 500 * SCALE, cy: 250 * SCALE },
    });
    // A picture-only group has no vector members to paint.
    expect(projection!.vectorShape).toBeNull();
  });

  test('a linked picture member names its link and never an embedded part', () => {
    const [projection] = projectionsOf(
      mcWrapped(groupDrawing(pictureMember({ blip: '<a:blip r:link="rIdLink"/>' })))
    );
    expect(projection!.groupPicture).toMatchObject({
      embeddedRelationshipId: null,
      linkedRelationshipId: 'rIdLink',
    });
  });

  test('only an MC-wrapped group picture is marked as alternate content', () => {
    // Layout drops an MC-wrapped group whose picture resource fails; a bare group keeps its card.
    const drawing = groupDrawing(pictureMember() + barMember(2100));
    expect(projectionsOf(mcWrapped(drawing))[0]!.groupPicture?.alternateContent).toBe(true);
    expect(projectionsOf(drawing)[0]!.groupPicture?.alternateContent).toBe(false);
  });

  test('a picture frame partly outside the group extent keeps its frame', () => {
    // Half the picture lies left of the child offset; paint clips it to the extent.
    const [projection] = projectionsOf(groupDrawing(pictureMember({ x: -1400 })));
    expect(projection!.groupPicture?.frameEmu).toEqual({
      x: -1500 * SCALE,
      y: 0,
      cx: 3000 * SCALE,
      cy: 1000 * SCALE,
    });
  });

  test('the run-level atom index carries the group picture', () => {
    const part = parsePart(`<w:p><w:r>${mcWrapped(groupDrawing(pictureMember()))}</w:r></w:p>`);
    const atoms = [...indexInlineDrawingProjectionsInPart(part).values()];
    expect(atoms).toHaveLength(1);
    expect(atoms[0]!.groupPicture?.embeddedRelationshipId).toBe('rIdImg');
  });

  test('identity fill rectangles and explicit no-outline properties remain supported', () => {
    for (const fill of [
      '<a:stretch/>',
      '<a:stretch><a:fillRect l="0" t="+0" r="-0" b="000"/></a:stretch>',
    ]) {
      const member = pictureMember({ fill })
        .replace('name="Picture"', 'name="Picture" hidden="false"')
        .replace('</pic:spPr>', '<a:ln><a:noFill/></a:ln><a:effectLst/></pic:spPr>');
      expect(projectionsOf(groupDrawing(member))[0]!.groupPicture).not.toBeNull();
    }
  });

  for (const [kind, members] of [
    ['picture', pictureMember()],
    ['vector', barMember(2100)],
    ['mixed', pictureMember() + barMember(2100)],
  ]) {
    for (const [name, property] of [
      ['shadow', '<a:effectLst><a:outerShdw><a:srgbClr val="000000"/></a:outerShdw></a:effectLst>'],
      ['effect graph', '<a:effectDag/>'],
      ['scene', '<a:scene3d/>'],
      ['3D shape', '<a:sp3d/>'],
    ]) {
      test(`${kind} group refuses unsupported ${name} without partial rendering`, () => {
        const drawing = groupDrawing(members!).replace(
          '</wpg:grpSpPr>',
          `${property}</wpg:grpSpPr>`
        );
        expect(projectionsOf(mcWrapped(drawing))).toHaveLength(1);
        const [bare] = projectionsOf(drawing);
        expect(bare!.groupPicture).toBeNull();
        expect(bare!.vectorShape).toBeNull();
        expect(bare!.picture).toBeNull();
        expect(bare!.diagnostics.map((item) => item.code)).toContain('unsupported-graphic');
      });
    }
    // A group's own fill paints nothing: only members that say `a:grpFill` paint it.
    test(`${kind} group with a fill of its own paints its members as without it`, () => {
      const drawing = groupDrawing(members!);
      const filled = drawing.replace(
        '</wpg:grpSpPr>',
        '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></wpg:grpSpPr>'
      );
      const [plain] = projectionsOf(drawing);
      const [withFill] = projectionsOf(filled);
      expect(withFill!.vectorShape?.components ?? null).toEqual(
        plain!.vectorShape?.components ?? null
      );
      expect(withFill!.groupPicture).toEqual(plain!.groupPicture);
    });
    for (const hidden of ['1', 'true', ' true ', 'invalid']) {
      test(`${kind} group refuses hidden=${hidden}`, () => {
        const drawing = groupDrawing(members!).replace(
          '<wpg:cNvGrpSpPr/>',
          `<wpg:cNvPr id="99" name="Group" hidden="${hidden}"/><wpg:cNvGrpSpPr/>`
        );
        expect(projectionsOf(mcWrapped(drawing))).toHaveLength(1);
        expect(projectionsOf(drawing)[0]!.vectorShape).toBeNull();
        expect(projectionsOf(drawing)[0]!.groupPicture).toBeNull();
      });
    }
    test(`${kind} group preserves default visual properties`, () => {
      const drawing = groupDrawing(members!)
        .replace(
          '<wpg:cNvGrpSpPr/>',
          '<wpg:cNvPr id="99" name="Group" hidden=" false "/><wpg:cNvGrpSpPr/>'
        )
        .replace('<wpg:grpSpPr>', '<wpg:grpSpPr bwMode="auto">')
        .replace('</wpg:grpSpPr>', '<a:noFill/><a:effectLst/><a:extLst/></wpg:grpSpPr>');
      expect(projectionsOf(mcWrapped(drawing))).toHaveLength(1);
    });
    test(`${kind} group refuses nonidentity color mode and nested groups`, () => {
      const drawing = groupDrawing(members!).replace(
        '<wpg:grpSpPr>',
        '<wpg:grpSpPr bwMode="gray">'
      );
      expect(projectionsOf(mcWrapped(drawing))).toHaveLength(1);
      expect(projectionsOf(mcWrapped(groupDrawing(members! + '<wpg:grpSp/>')))).toHaveLength(1);
    });
  }

  for (const members of [barMember(2100), pictureMember() + barMember(2100)]) {
    for (const property of [
      '<a:effectLst><a:glow rad="12700"/></a:effectLst>',
      '<a:scene3d/>',
      '<a:sp3d/>',
    ]) {
      test(`a group refuses a vector member with ${property}`, () => {
        const drawing = groupDrawing(members.replace('</wps:spPr>', `${property}</wps:spPr>`));
        expect(projectionsOf(mcWrapped(drawing))).toHaveLength(1);
        expect(projectionsOf(drawing)[0]!.groupPicture).toBeNull();
        expect(projectionsOf(drawing)[0]!.vectorShape).toBeNull();
      });
    }
    test('a group refuses a hidden vector member', () => {
      const drawing = groupDrawing(members.replace('name="Bar"', 'name="Bar" hidden="1"'));
      expect(projectionsOf(mcWrapped(drawing))).toHaveLength(1);
      expect(projectionsOf(drawing)[0]!.groupPicture).toBeNull();
    });
  }

  test('a picture member refuses an unsupported color mode', () => {
    const drawing = groupDrawing(pictureMember().replace('<pic:spPr>', '<pic:spPr bwMode="gray">'));
    expect(projectionsOf(mcWrapped(drawing))).toHaveLength(1);
    expect(projectionsOf(drawing)[0]!.groupPicture).toBeNull();
  });

  test('theme effects refuse the whole group while empty theme defaults remain supported', () => {
    const themeFor = (effect: string) => {
      const theme = readOoxmlPart(
        `<a:theme xmlns:a="${A}"><a:themeElements><a:fmtScheme name="Anonymous">` +
          `<a:effectStyleLst><a:effectStyle>${effect}</a:effectStyle></a:effectStyleLst>` +
          '</a:fmtScheme></a:themeElements></a:theme>',
        { name: '/word/theme/theme1.xml', contentType: 'application/xml' }
      );
      if (!theme.ok) throw new Error(theme.reason);
      return createPackageShapeThemeResolvers({
        parts: new Map([['/word/theme/theme1.xml', theme.part]]),
        partBytes: new Map(),
        relationships: new Map(),
        externalTargets: [],
        contentTypes: {},
        mainDocumentPart: '/word/document.xml',
      } as unknown as OoxmlPackage);
    };
    const empty = themeFor('<a:effectLst/>');
    const shadow = themeFor(
      '<a:effectLst><a:outerShdw blurRad="40000" dist="200000" dir="0"><a:srgbClr val="000000"/></a:outerShdw></a:effectLst>'
    );
    const scene = themeFor('<a:effectLst/><a:scene3d/>');
    for (const [index, theme, admitted] of [
      ['0', shadow, true],
      [' +00 ', shadow, true],
      ['1', empty, true],
      ['1', shadow, false],
      ['1', scene, false],
      ['2', empty, false],
      ['1', undefined, false],
      ['invalid', empty, false],
      ['4294967295', empty, false],
    ] as const) {
      const vector = barMember(2100).replace(
        '<wps:bodyPr/>',
        `<wps:style><a:effectRef idx="${index}"><a:srgbClr val="000000"/></a:effectRef></wps:style><wps:bodyPr/>`
      );
      const picture = pictureMember().replace(
        '</pic:pic>',
        `<pic:style><a:effectRef idx="${index}"/></pic:style></pic:pic>`
      );
      for (const members of [vector, pictureMember() + vector, picture]) {
        const drawing = groupDrawing(members);
        const project = (xml: string) =>
          projectDrawingsInPart(parsePart(`<w:p><w:r>${xml}</w:r></w:p>`), theme);
        const [wrapped] = project(mcWrapped(drawing));
        expect(Boolean(wrapped!.vectorShape || wrapped!.groupPicture)).toBe(admitted);
        const cleared = drawing
          .replace('</wps:spPr>', '<a:effectLst/></wps:spPr>')
          .replace('</pic:spPr>', '<a:effectLst/></pic:spPr>');
        const [clearedProjection] = project(mcWrapped(cleared));
        expect(Boolean(clearedProjection!.vectorShape || clearedProjection!.groupPicture)).toBe(
          admitted || (theme === shadow && index === '1')
        );
        if (!admitted) {
          const [bare] = project(drawing);
          expect(bare!.vectorShape).toBeNull();
          expect(bare!.groupPicture).toBeNull();
        }
      }
    }
  });

  const refused: readonly (readonly [string, string])[] = [
    [
      'a displaced fill rectangle',
      groupDrawing(pictureMember({ fill: '<a:stretch><a:fillRect l="50000"/></a:stretch>' })),
    ],
    [
      'a malformed fill rectangle',
      groupDrawing(pictureMember({ fill: '<a:stretch><a:fillRect l="unknown"/></a:stretch>' })),
    ],
    [
      'a picture shadow',
      groupDrawing(
        pictureMember().replace(
          '</pic:spPr>',
          '<a:effectLst><a:outerShdw blurRad="12700" dist="12700" dir="0"><a:srgbClr val="000000"/></a:outerShdw></a:effectLst></pic:spPr>'
        )
      ),
    ],
    [
      'a picture 3D transform',
      groupDrawing(pictureMember().replace('</pic:spPr>', '<a:sp3d z="12700"/></pic:spPr>')),
    ],
    [
      'a hidden picture member',
      groupDrawing(pictureMember().replace('name="Picture"', 'name="Picture" hidden="1"')),
    ],
    [
      'a second picture above a vector member',
      groupDrawing(pictureMember() + barMember(2100) + pictureMember({ y: 1500 })),
    ],
    [
      'a second picture member that is hidden',
      groupDrawing(
        pictureMember() +
          pictureMember({ y: 1500 }).replace('name="Picture"', 'name="Picture" hidden="1"')
      ),
    ],
    ['a picture above a vector member', groupDrawing(barMember(2100) + pictureMember())],
    ['a rotated picture', groupDrawing(pictureMember({ xfrmAttributes: ' rot="5400000"' }))],
    ['a flipped picture', groupDrawing(pictureMember({ xfrmAttributes: ' flipH="1"' }))],
    [
      'a picture with a blip effect',
      groupDrawing(pictureMember({ blip: '<a:blip r:embed="rIdImg"><a:grayscl/></a:blip>' })),
    ],
    [
      'a tiled picture',
      groupDrawing(pictureMember({ fill: '<a:tile tx="0" ty="0" sx="100000" sy="100000"/>' })),
    ],
    [
      'a picture with a non-rectangle geometry',
      groupDrawing(
        pictureMember({ geometry: '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>' })
      ),
    ],
    ['a picture without a relationship', groupDrawing(pictureMember({ blip: '<a:blip/>' }))],
    ['a picture without an extent', groupDrawing(pictureMember({ cx: 0 }))],
    ['a picture beside a nested group', groupDrawing(pictureMember() + '<wpg:grpSp/>')],
    ['a rotated group', groupDrawing(pictureMember(), ' rot="60000"')],
    // A zero child extent is legal for a group of straight lines, but leaves a picture no size.
    [
      'a group with a zero child extent',
      groupDrawing(pictureMember()).replace('<a:chExt cx="3000"', '<a:chExt cx="0"'),
    ],
    // Frame bounds: a frame with no visible part, or one that reaches more than one extent
    // past the group, is refused before its coordinates reach any output.
    ['a picture right of the group extent', groupDrawing(pictureMember({ x: 3100 }))],
    ['a picture above the group extent', groupDrawing(pictureMember({ y: -800 }))],
    [
      'a picture offset far past the group extent',
      groupDrawing(pictureMember({ x: 999999999999999 }) + barMember(2100)),
    ],
    [
      'a picture reaching more than one extent past the group',
      groupDrawing(pictureMember({ x: -2950, cx: 3200 })),
    ],
    // The picture makes its vector members visible, so they get the same outer bound.
    [
      'a vector member far past a picture group',
      groupDrawing(pictureMember() + barMember(2100, 999999999999999)),
    ],
    [
      'a vector member stroke wider than a picture group',
      groupDrawing(
        pictureMember() +
          barMember(
            2100,
            600,
            // Line widths are absolute, so only a width past the group extent is wider.
            '<a:ln w="20116800"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>'
          )
      ),
    ],
  ];

  test('a picture outline paints over the picture at its own width', () => {
    const [projection] = projectionsOf(
      groupDrawing(
        pictureMember().replace(
          '</pic:spPr>',
          '<a:ln w="127000"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></pic:spPr>'
        )
      )
    );
    expect(projection!.groupPicture).not.toBeNull();
    const stroke = projection!.vectorShape!.components[0]!;
    expect(stroke.strokeHex).toBe('FF0000');
    expect(stroke.strokeWidthEmu).toBe(127000);
  });

  for (const [name, drawing] of refused) {
    test(`${name} stays unpainted`, () => {
      // MC retains one unsupported drawing for the placeholder.
      expect(projectionsOf(mcWrapped(drawing))).toHaveLength(1);
      // A bare drawing still projects, for its placeholder, but with no picture to paint.
      const [bare] = projectionsOf(drawing);
      expect(bare!.groupPicture).toBeNull();
      expect(bare!.picture).toBeNull();
    });
  }
});

describe('members that paint the group fill', () => {
  const SOLID = '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>';
  const GRADIENT =
    '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>' +
    '<a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>';
  const filledGroup = (fill: string, members: string) =>
    groupDrawing(members).replace('</wpg:grpSpPr>', `${fill}</wpg:grpSpPr>`);
  const groupFillBox = () => textboxMember().replace('</a:prstGeom>', '</a:prstGeom><a:grpFill/>');

  test('a text box with a:grpFill before a picture orders it, so the group refuses', () => {
    const [projection] = projectionsOf(filledGroup(SOLID, groupFillBox() + pictureMember()));
    expect(projection!.groupPicture).toBeNull();
    // After the picture, the text box paints the group fill above it.
    const [after] = projectionsOf(filledGroup(SOLID, pictureMember() + groupFillBox()));
    expect(after!.groupPicture).not.toBeNull();
    expect(after!.vectorShape?.components.map((c) => c.fillHex)).toEqual(['FF0000']);
  });

  test('a gradient group fill spans the group box, so its members refuse', () => {
    // Word paints one gradient across the group box, not one per member (2026-11-12 render).
    const bar = barMember(2100).replace(
      '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>',
      '<a:grpFill/>'
    );
    expect(projectionsOf(filledGroup(GRADIENT, bar))[0]!.vectorShape).toBeNull();
    // A text box that paints the gradient is not text alone, so its text does not render bare.
    const [box] = projectionsOf(filledGroup(GRADIENT, groupFillBox()));
    expect(box!.vectorShape).toBeNull();
    expect(box!.groupTextboxes).toBeUndefined();
  });
});
