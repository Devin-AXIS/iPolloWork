// Word emits decorative rules and signature marks as `wps:wsp` custom-geometry shapes
// wrapped in run-level `mc:AlternateContent` (Choice Requires="wps", Fallback VML).
// The projection must (1) select the wps Choice branch instead of dropping the atom, and
// (2) type solid-fill polygon geometry so paint can draw the shape instead of a card.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlDrawingNode,
  type OoxmlElement,
  type OoxmlPackage,
  type OoxmlPart,
} from '../index.ts';
import {
  indexInlineDrawingProjectionsInPart,
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  DEFAULT_SUPPORTED_MC_REQUIRES,
  projectDrawingWithState,
  projectDrawingsInPart,
} from '../package/drawing-projection.ts';
import { createWalkState, type DrawingDiagnostic } from '../package/drawing-projection-walk.ts';
import { drawingPaintFields } from '../../layout/drawing-paint-fields.ts';
import { createPackageShapeThemeResolvers } from '../package/theme-color-resolution.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';
const OWNER = '/word/document.xml';

function parsePart(body: string) {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:wps="${WPS}" xmlns:wpg="${WPG}" xmlns:mc="${MC}" xmlns:v="${V}">` +
    `<w:body>${body}</w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function drawingOf(part: OoxmlPart): OoxmlDrawingNode {
  const stack: OoxmlElement[] = [part.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === 'drawing') return node;
    for (const child of node.children) {
      if (child.kind !== 'textValue') stack.push(child);
    }
  }
  throw new Error('missing drawing');
}

function projectWithDiagnostics(part: OoxmlPart, diagnostics: DrawingDiagnostic[]) {
  const state = createWalkState();
  state.diagnostics.push(...diagnostics);
  return projectDrawingWithState(
    drawingOf(part),
    {
      ownerPartName: part.name,
      supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    },
    state
  );
}

/** Double-rule custGeom shape, verbatim structure from Word's cover-page separator. */
function doubleRuleShapeDrawing(): string {
  return (
    '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="487593984" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>428612</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>145771</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="6696075" cy="47625"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapTopAndBottom/><wp:docPr id="5" name="Graphic 5"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<wps:wsp><wps:cNvSpPr><a:spLocks/></wps:cNvSpPr><wps:spPr>' +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="6696075" cy="47625"/></a:xfrm>' +
    '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/>' +
    '<a:pathLst>' +
    '<a:path w="6696075" h="47625">' +
    '<a:moveTo><a:pt x="6696075" y="38100"/></a:moveTo>' +
    '<a:lnTo><a:pt x="0" y="38100"/></a:lnTo>' +
    '<a:lnTo><a:pt x="0" y="47625"/></a:lnTo>' +
    '<a:lnTo><a:pt x="6696075" y="47625"/></a:lnTo>' +
    '<a:lnTo><a:pt x="6696075" y="38100"/></a:lnTo>' +
    '<a:close/></a:path>' +
    '<a:path w="6696075" h="47625">' +
    '<a:moveTo><a:pt x="6696075" y="0"/></a:moveTo>' +
    '<a:lnTo><a:pt x="0" y="0"/></a:lnTo>' +
    '<a:lnTo><a:pt x="0" y="9525"/></a:lnTo>' +
    '<a:lnTo><a:pt x="6696075" y="9525"/></a:lnTo>' +
    '<a:lnTo><a:pt x="6696075" y="0"/></a:lnTo>' +
    '<a:close/></a:path>' +
    '</a:pathLst></a:custGeom>' +
    '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>' +
    '</wps:spPr><wps:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0">' +
    '<a:prstTxWarp prst="textNoShape"><a:avLst/></a:prstTxWarp><a:noAutofit/></wps:bodyPr>' +
    '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>'
  );
}

function mcWrapped(drawing: string): string {
  return (
    '<mc:AlternateContent><mc:Choice Requires="wps">' +
    drawing +
    '</mc:Choice><mc:Fallback><w:pict>' +
    '<v:shape id="s1" style="position:absolute" coordsize="6696075,47625" path="m0,0l10,10e"/>' +
    '</w:pict></mc:Fallback></mc:AlternateContent>'
  );
}

/** Attribute-escape a raw value so a hostile spelling reaches the parser intact. */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function unsupportedGraphic(nodeId: string, detail: string): DrawingDiagnostic {
  return { code: 'unsupported-graphic', nodeId, detail };
}

/** A `wpg:wgp` group of two independently filled children, with a group `a:xfrm`. */
function groupShapeDrawing(): string {
  return (
    '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="200000" cy="100000"/><wp:docPr id="13" name="Group 13"/>' +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:grpSpPr>` +
    '<a:xfrm><a:chOff x="0" y="0"/><a:chExt cx="200000" cy="100000"/></a:xfrm>' +
    '</wpg:grpSpPr>' +
    '<wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100000" cy="100000"/></a:xfrm>' +
    '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>' +
    '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill></wps:spPr></wps:wsp>' +
    '<wps:wsp><wps:spPr><a:xfrm><a:off x="100000" y="0"/><a:ext cx="100000" cy="100000"/></a:xfrm>' +
    '<a:custGeom><a:pathLst><a:path w="100000" h="100000">' +
    '<a:moveTo><a:pt x="0" y="0"/></a:moveTo>' +
    '<a:cubicBezTo><a:pt x="25000" y="0"/><a:pt x="75000" y="100000"/>' +
    '<a:pt x="100000" y="100000"/></a:cubicBezTo><a:close/>' +
    '</a:path></a:pathLst></a:custGeom>' +
    '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></wps:spPr></wps:wsp>' +
    '</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing>'
  );
}

describe('wps vector shape projection', () => {
  test('package theme colours honor the settings colour mapping', () => {
    const theme = readOoxmlPart(
      `<a:theme xmlns:a="${A}"><a:themeElements><a:clrScheme name="Test">` +
        '<a:accent1><a:srgbClr val="112233"/></a:accent1>' +
        '<a:accent2><a:srgbClr val="AABBCC"/></a:accent2>' +
        '<a:dk2><a:srgbClr val="334455"/></a:dk2>' +
        '</a:clrScheme><a:fmtScheme name="Test">' +
        '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
        '<a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/>' +
        '</a:fmtScheme></a:themeElements></a:theme>',
      { name: '/word/theme/theme1.xml', contentType: 'application/xml' }
    );
    const settings = readOoxmlPart(
      `<w:settings xmlns:w="${WML_NAMESPACE_URI}">` +
        '<w:clrSchemeMapping w:accent1="accent2" w:bg1="dark2"/>' +
        '</w:settings>',
      { name: '/word/settings.xml', contentType: 'application/xml' }
    );
    if (!theme.ok || !settings.ok) throw new Error('test package parts must parse');
    const pkg = {
      parts: new Map([
        ['/word/theme/theme1.xml', theme.part],
        ['/word/settings.xml', settings.part],
      ]),
      partBytes: new Map(),
      relationships: new Map(),
      externalTargets: [],
      contentTypes: {},
      mainDocumentPart: OWNER,
    } as unknown as OoxmlPackage;
    const themeResolvers = createPackageShapeThemeResolvers(pkg);
    const resolve = themeResolvers.resolveSchemeColor;
    expect(resolve('accent1')).toBe('AABBCC');
    expect(resolve('accent2')).toBe('AABBCC');
    expect(resolve('bg1')).toBe('334455');
    expect(resolve('missing')).toBeNull();
    expect(themeResolvers.resolveStyleMatrixReference('fill', 1)?.localName).toBe('solidFill');
    const changedTheme = readOoxmlPart(
      `<a:theme xmlns:a="${A}"><a:themeElements><a:clrScheme name="Changed">` +
        '<a:accent1><a:srgbClr val="FFFFFF"/></a:accent1>' +
        '</a:clrScheme></a:themeElements></a:theme>',
      { name: '/word/theme/theme1.xml', contentType: 'application/xml' }
    );
    if (!changedTheme.ok) throw new Error(changedTheme.reason);
    const changedPackage = {
      ...pkg,
      parts: new Map(pkg.parts).set('/word/theme/theme1.xml', changedTheme.part),
    };
    expect(createPackageShapeThemeResolvers(changedPackage).cacheToken).not.toBe(
      themeResolvers.cacheToken
    );
  });

  // `word/settings.xml` and `word/theme/theme1.xml` are sender-controlled, so an attribute
  // name or value that names a prototype member must answer "no mapping" rather than a
  // function. Before the lookups became Maps, `w:accent1="constructor"` made
  // `resolveSchemeColor('accent1')` return null and every accent1-filled shape in the
  // document stop painting.
  test('a prototype-member name in the colour mapping does not break resolution', () => {
    const theme = readOoxmlPart(
      `<a:theme xmlns:a="${A}"><a:themeElements><a:clrScheme name="T">` +
        '<a:accent1><a:srgbClr val="112233"/></a:accent1>' +
        '<a:accent2><a:srgbClr val="AABBCC"/></a:accent2>' +
        '<a:constructor><a:srgbClr val="DDEEFF"/></a:constructor>' +
        '</a:clrScheme></a:themeElements></a:theme>',
      { name: '/word/theme/theme1.xml', contentType: 'application/xml' }
    );
    const hostile = readOoxmlPart(
      `<w:settings xmlns:w="${WML_NAMESPACE_URI}">` +
        '<w:clrSchemeMapping w:accent1="constructor" w:accent2="__proto__" ' +
        'w:__proto__="accent2" w:constructor="accent2"/>' +
        '</w:settings>',
      { name: '/word/settings.xml', contentType: 'application/xml' }
    );
    if (!theme.ok || !hostile.ok) throw new Error('test package parts must parse');
    const resolvers = createPackageShapeThemeResolvers({
      parts: new Map([
        ['/word/theme/theme1.xml', theme.part],
        ['/word/settings.xml', hostile.part],
      ]),
      partBytes: new Map(),
      relationships: new Map(),
      externalTargets: [],
      contentTypes: {},
      mainDocumentPart: OWNER,
    } as unknown as OoxmlPackage);
    // Unmappable values leave the default mapping in place, so both slots still resolve.
    expect(resolvers.resolveSchemeColor('accent1')).toBe('112233');
    expect(resolvers.resolveSchemeColor('accent2')).toBe('AABBCC');
    // A prototype member is never a slot, and nothing was polluted along the way.
    expect(resolvers.resolveSchemeColor('__proto__')).toBeNull();
    expect(resolvers.resolveSchemeColor('toString')).toBeNull();
    expect(({} as Record<string, unknown>)['accent2']).toBeUndefined();
  });

  test('MC-wrapped anchored custGeom shape projects with typed vector geometry', () => {
    const part = parsePart(`<w:p><w:r>${mcWrapped(doubleRuleShapeDrawing())}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part);
    expect(atoms.size).toBe(1);
    const projection = [...atoms.values()][0]!;
    expect(projection.kind).toBe('anchored');
    expect(projection.extentEmu).toEqual({ cx: 6696075, cy: 47625 });
    expect(projection.picture).toBeNull();
    // Compatibility (generic) anchors must still read wrap and position — a dropped
    // position paints the shape at the page origin.
    expect(projection.wrap).toBe('topAndBottom');
    expect(projection.position?.horizontal).toEqual({
      relativeFrom: 'page',
      align: null,
      offsetEmu: 428612,
    });
    expect(projection.position?.vertical).toEqual({
      relativeFrom: 'paragraph',
      align: null,
      offsetEmu: 145771,
    });
    const shape = projection.vectorShape;
    expect(shape).not.toBeNull();
    expect(shape!.fillHex).toBe('000000');
    expect(shape!.strokeHex).toBeNull();
    expect(shape!.subpathsEmu).toHaveLength(2);
    // Points land in extent-EMU space (path w/h equals the extent here).
    expect(shape!.subpathsEmu[0]![0]).toEqual({ x: 6696075, y: 38100 });
    expect(shape!.subpathsEmu[1]![2]).toEqual({ x: 0, y: 9525 });
  });

  test('a supported vector shape removes its own provisional unsupported diagnostic', () => {
    const part = parsePart(`<w:p><w:r>${doubleRuleShapeDrawing()}</w:r></w:p>`);
    const projection = [...indexInlineDrawingProjectionsInPart(part).values()][0]!;

    expect(projection.vectorShape).not.toBeNull();
    expect(projection.diagnostics.filter(({ code }) => code === 'unsupported-graphic')).toEqual([]);
  });

  test('a supported vector shape leaves an unsupported sibling diagnostic intact', () => {
    const part = parsePart(`<w:p><w:r>${doubleRuleShapeDrawing()}</w:r></w:p>`);
    const sibling = unsupportedGraphic('unsupported-sibling', 'diagram');
    const projection = projectWithDiagnostics(part, [sibling])!;
    const unsupported = projection.diagnostics.filter(({ code }) => code === 'unsupported-graphic');

    expect(projection.vectorShape).not.toBeNull();
    expect(unsupported).toHaveLength(1);
    expect(unsupported).toEqual(expect.arrayContaining([sibling]));
  });

  test('removing a vector provisional leaves multiple unrelated diagnostics intact', () => {
    const part = parsePart(`<w:p><w:r>${doubleRuleShapeDrawing()}</w:r></w:p>`);
    const firstUnsupported = unsupportedGraphic('unsupported-chart', 'chart');
    const malformed: DrawingDiagnostic = {
      code: 'wrap-polygon-malformed',
      nodeId: 'malformed-wrap',
      detail: 'invalid-coordinate',
    };
    const secondUnsupported = unsupportedGraphic('unsupported-diagram', 'diagram');
    const projection = projectWithDiagnostics(part, [
      firstUnsupported,
      malformed,
      secondUnsupported,
    ])!;

    expect(projection.vectorShape).not.toBeNull();
    expect(projection.diagnostics).toHaveLength(3);
    expect(projection.diagnostics).toEqual(
      expect.arrayContaining([firstUnsupported, malformed, secondUnsupported])
    );
  });

  test('diagnostic replacement does not change the rendered vector projection', () => {
    const part = parsePart(`<w:p><w:r>${doubleRuleShapeDrawing()}</w:r></w:p>`);
    const shape = [...indexInlineDrawingProjectionsInPart(part).values()][0]!.vectorShape;

    expect(shape).toMatchObject({
      extentEmu: { cx: 6696075, cy: 47625 },
      fillHex: '000000',
      strokeHex: null,
      subpathsEmu: [
        [
          { x: 6696075, y: 38100 },
          { x: 0, y: 38100 },
          { x: 0, y: 47625 },
          { x: 6696075, y: 47625 },
          { x: 6696075, y: 38100 },
        ],
        [
          { x: 6696075, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 9525 },
          { x: 6696075, y: 9525 },
          { x: 6696075, y: 0 },
        ],
      ],
    });
  });

  test('direct (unwrapped) wps shape also carries vector geometry', () => {
    const part = parsePart(`<w:p><w:r>${doubleRuleShapeDrawing()}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part);
    expect(atoms.size).toBe(1);
    expect([...atoms.values()][0]!.vectorShape).not.toBeNull();
  });

  test('scheme colours apply luminance and alpha transforms', () => {
    const drawing = doubleRuleShapeDrawing().replace(
      '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>',
      '<a:solidFill><a:schemeClr val="accent1">' +
        '<a:lumMod val="50000"/><a:alpha val="50000"/>' +
        '</a:schemeClr></a:solidFill>'
    );
    const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part, {
      resolveSchemeColor: (token) => (token === 'accent1' ? '4472C4' : null),
    });
    const shape = [...atoms.values()][0]!.vectorShape!;
    expect(shape.fillHex).toBe('203864');
    expect(shape.fillAlpha).toBe(0.5);
  });

  // `a:tint` and `a:shade` are a blend in LINEAR light, through the sRGB transfer curve, and
  // `val` is the fraction of the INPUT colour (ECMA-376 Part 1, 20.1.2.3.34 and 20.1.2.3.31):
  // not of white, and not a blend on the stored component. The result rounds to a byte once.
  // The two right-hand columns are what the rejected readings give:
  //
  //   base    transform        this engine   `val` as white-fraction   blend on stored value
  //   0000FF  tint  20000      E7E7FF        3333FF                    CCCCFF
  //   0000FF  shade 20000      00007C        —                         000033
  //   808080  tint  50000      CDCDCD        C0C0C0                    C0C0C0
  //   808080  shade 50000      5C5C5C        —                         404040
  //   336699  tint  60000      ADB8CA        ADC2D6                    85A3C2
  //   336699  shade 40000      1E4164        —                         14293D
  //   ED7D31  shade 50000      AE5A21        —                         773F19
  //
  // Only the `ED7D31` row is a measured value; the other rows follow from the rule. Mid-gray
  // at 50% is where the white-fraction reading and the input-fraction reading agree, so it
  // cannot be the only tint case.
  test('theme colours apply tint, shade, and luminance offset transforms', () => {
    const cases = [
      ['0000FF', 'tint', '20000', 'E7E7FF'],
      ['0000FF', 'shade', '20000', '00007C'],
      ['808080', 'tint', '50000', 'CDCDCD'],
      ['808080', 'shade', '50000', '5C5C5C'],
      ['336699', 'tint', '60000', 'ADB8CA'],
      ['336699', 'shade', '40000', '1E4164'],
      ['ED7D31', 'shade', '50000', 'AE5A21'],
      // `lumMod`/`lumOff` are NOT linear-light: they stay in HSL over the stored channels.
      ['808080', 'lumOff', '10000', '9A9A9A'],
      ['6F55D7', 'lumMod', '50000', '2F1D79'],
      ['6F55D7', 'lumMod', '75000', '472BB6'],
    ] as const;
    for (const [base, transform, value, expected] of cases) {
      const drawing = doubleRuleShapeDrawing().replace(
        '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>',
        `<a:solidFill><a:schemeClr val="accent1"><a:${transform} val="${value}"/>` +
          '</a:schemeClr></a:solidFill>'
      );
      const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
      const atoms = indexInlineDrawingProjectionsInPart(part, {
        resolveSchemeColor: () => base,
      });
      expect([...atoms.values()][0]!.vectorShape?.fillHex).toBe(expected);
    }
  });

  // `val` has two legal spellings: the integer in 1000ths of a percent (`50000`), which is
  // an `xsd:int` and so may carry a leading `+`, and the percentage literal (`50%`), which
  // the spec's own worked examples use. The Transitional schema admits both, the Strict
  // schema only the second. All of them must resolve, and to the same colour.
  test('a colour transform accepts both the integer and the percentage spelling', () => {
    const fillFor = (val: string): string | null => {
      const drawing = doubleRuleShapeDrawing().replace(
        '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>',
        `<a:solidFill><a:srgbClr val="00FF00"><a:shade val="${val}"/></a:srgbClr></a:solidFill>`
      );
      const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
      return (
        [...indexInlineDrawingProjectionsInPart(part).values()][0]?.vectorShape?.fillHex ?? null
      );
    };
    // ECMA-376 Part 1, 20.1.2.3.31's worked `a:shade` example: `00FF00` at 50% is `00BC00`.
    // A blend on the stored component would give `008000`.
    expect(fillFor('50%')).toBe('00BC00');
    expect(fillFor('50000')).toBe('00BC00');
    expect(fillFor('+50000')).toBe('00BC00');
    for (const [percent, integer] of [
      ['0%', '0'],
      ['100%', '100000'],
      ['12.5%', '12500'],
      ['99.99%', '99990'],
    ] as const) {
      expect(`${percent}: ${fillFor(percent)}`).toBe(`${percent}: ${fillFor(integer)}`);
      expect(fillFor(percent)).not.toBeNull();
    }
    // Everything else refuses, and a refused transform fails the whole colour closed.
    // `100.99%` is the case the PATTERN admits but the value space does not: 22.9.2.10's
    // regex matches it, and it is 1.0099 as a ratio. The explicit ceiling refuses it, the
    // same way the integer branch refuses `100001`.
    for (const rejected of [
      '101%',
      '100.99%',
      '100.1%',
      '-5%',
      ' 50% ',
      '50.123%',
      '1e2%',
      '%',
      '50 %',
      '1000000',
      '-50000',
      '++50000',
      '+100001',
      '+50%',
    ]) {
      expect(`${rejected}: ${fillFor(rejected)}`).toBe(`${rejected}: null`);
    }
  });

  // A ratio of 100000 is the identity, so the round trip through linear light and back must
  // return the authored byte. A 100% tint or shade is by definition a no-op.
  test('a full-strength tint or shade returns the authored colour unchanged', () => {
    for (const transform of ['tint', 'shade'] as const) {
      const drawing = doubleRuleShapeDrawing().replace(
        '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>',
        `<a:solidFill><a:srgbClr val="010203"><a:${transform} val="100000"/></a:srgbClr>` +
          '</a:solidFill>'
      );
      const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
      const atoms = indexInlineDrawingProjectionsInPart(part);
      expect([...atoms.values()][0]!.vectorShape?.fillHex).toBe('010203');
    }
  });

  // `flipH`/`flipV` are `xsd:boolean`. Shapes and groups honor legal flips. Invalid spellings
  // refuse instead of painting unflipped.
  //
  // Four call sites read a flip: `flipH` and `flipV` on a shape's own `a:xfrm`, and the same
  // pair on a group's `wpg:grpSpPr/a:xfrm`. The group pair is the lane this file exists for,
  // so every spelling runs against all four.
  test('legal shape and group flips paint; schema-invalid spellings still refuse', () => {
    const spellings = [
      // Legal `xsd:boolean` false, including the forms the fixed `whiteSpace="collapse"`
      // facet makes valid. The XML reader does not trim, so the helper has to.
      [undefined, true],
      ['0', true],
      ['false', true],
      [' 0 ', true],
      ['\nfalse\n', true],
      // Legal true — supported for shapes, but still refused at group level below.
      ['1', false],
      ['true', false],
      [' 1 ', false],
      // Schema-invalid: refuse rather than read as unset.
      ['TRUE', false],
      ['True', false],
      ['yes', false],
      ['2', false],
      ['', false],
      ['0 1', false],
    ] as const;

    const SHAPE_XFRM = '<a:xfrm><a:off x="0" y="0"/><a:ext cx="6696075" cy="47625"/></a:xfrm>';
    const GROUP_XFRM = '<a:xfrm><a:chOff x="0" y="0"/><a:chExt cx="200000" cy="100000"/></a:xfrm>';
    const sites = [
      {
        name: 'shape flipH',
        drawing: (attrs: string) =>
          doubleRuleShapeDrawing().replace(SHAPE_XFRM, `<a:xfrm${attrs}>${SHAPE_XFRM.slice(9)}`),
        attr: 'flipH',
      },
      {
        name: 'shape flipV',
        drawing: (attrs: string) =>
          doubleRuleShapeDrawing().replace(SHAPE_XFRM, `<a:xfrm${attrs}>${SHAPE_XFRM.slice(9)}`),
        attr: 'flipV',
      },
      {
        name: 'group flipH',
        drawing: (attrs: string) =>
          groupShapeDrawing().replace(GROUP_XFRM, `<a:xfrm${attrs}>${GROUP_XFRM.slice(9)}`),
        attr: 'flipH',
      },
      {
        name: 'group flipV',
        drawing: (attrs: string) =>
          groupShapeDrawing().replace(GROUP_XFRM, `<a:xfrm${attrs}>${GROUP_XFRM.slice(9)}`),
        attr: 'flipV',
      },
    ];

    for (const site of sites) {
      for (const [value, paints] of spellings) {
        const attrs = value === undefined ? '' : ` ${site.attr}="${escapeAttribute(value)}"`;
        const part = parsePart(`<w:p><w:r>${site.drawing(attrs)}</w:r></w:p>`);
        const shape = [
          ...indexInlineDrawingProjectionsInPart(part, {
            resolveSchemeColor: () => '4472C4',
          }).values(),
        ][0]?.vectorShape;
        const label = `${site.name}=${JSON.stringify(value)}`;
        const supportedShapeFlip = ['1', 'true'].includes(value?.trim() ?? '');
        expect(`${label}: ${shape !== null && shape !== undefined}`).toBe(
          `${label}: ${paints || supportedShapeFlip}`
        );
      }
    }
  });

  // `rot` is `ST_Angle`, which derives from `xsd:int` — so it carries the same fixed
  // `whiteSpace="collapse"` facet as the flip flags, plus a sign and leading zeros. Every
  // spelling of zero below is a shape Word paints upright; comparing the raw string to `'0'`
  // refused all but the bare one. Both `a:xfrm` sites read `rot`, so both are driven. A shape
  // and a group turn by any legal angle.
  test('every legal spelling of a rotation paints, on a shape and on a group', () => {
    const spellings = [
      [undefined, true],
      ['0', true],
      [' 0 ', true],
      ['\n0\n', true],
      ['00', true],
      ['+0', true],
      ['-0', true],
      ['000000', true],
      // A real angle: a shape turns, a group refuses.
      ['60000', false],
      ['-60000', false],
      ['1', false],
      // Not a legal `xsd:int` at all.
      ['0.0', false],
      ['0deg', false],
      ['', false],
      ['0 0', false],
    ] as const;

    const SHAPE_XFRM = '<a:xfrm><a:off x="0" y="0"/><a:ext cx="6696075" cy="47625"/></a:xfrm>';
    const GROUP_XFRM = '<a:xfrm><a:chOff x="0" y="0"/><a:chExt cx="200000" cy="100000"/></a:xfrm>';
    const sites = [
      { name: 'shape rot', base: SHAPE_XFRM, drawing: doubleRuleShapeDrawing },
      { name: 'group rot', base: GROUP_XFRM, drawing: groupShapeDrawing },
    ];

    for (const site of sites) {
      for (const [value, paints] of spellings) {
        const attrs = value === undefined ? '' : ` rot="${escapeAttribute(value)}"`;
        const xml = site.drawing().replace(site.base, `<a:xfrm${attrs}>${site.base.slice(9)}`);
        const part = parsePart(`<w:p><w:r>${xml}</w:r></w:p>`);
        const shape = [
          ...indexInlineDrawingProjectionsInPart(part, {
            resolveSchemeColor: () => '4472C4',
          }).values(),
        ][0]?.vectorShape;
        const label = `${site.name}=${JSON.stringify(value)}`;
        const turnedShape = /^[+-]?\d+$/.test(value ?? '');
        expect(`${label}: ${shape !== null && shape !== undefined}`).toBe(
          `${label}: ${paints || turnedShape}`
        );
      }
    }
  });

  // One bound (16 entries) covers the fill list, the background fill list based at 1001 and
  // the line list. The index is file content, so both edges of each range must refuse.
  test('a style matrix index past the list size resolves to nothing', () => {
    const entries = (name: string, tag: string): string =>
      `<a:${name}>` +
      Array.from({ length: 20 }, (_, index) => `<${tag} n="${index}"/>`).join('') +
      `</a:${name}>`;
    const theme = readOoxmlPart(
      `<a:theme xmlns:a="${A}"><a:themeElements><a:clrScheme name="T">` +
        '<a:accent1><a:srgbClr val="112233"/></a:accent1>' +
        '</a:clrScheme><a:fmtScheme name="T">' +
        entries('fillStyleLst', 'a:solidFill') +
        entries('lnStyleLst', 'a:ln') +
        '<a:effectStyleLst/>' +
        entries('bgFillStyleLst', 'a:gradFill') +
        '</a:fmtScheme></a:themeElements></a:theme>',
      { name: '/word/theme/theme1.xml', contentType: 'application/xml' }
    );
    if (!theme.ok) throw new Error(theme.reason);
    const resolvers = createPackageShapeThemeResolvers({
      parts: new Map([['/word/theme/theme1.xml', theme.part]]),
      partBytes: new Map(),
      relationships: new Map(),
      externalTargets: [],
      contentTypes: {},
      mainDocumentPart: OWNER,
    } as unknown as OoxmlPackage);
    const resolved = (kind: 'fill' | 'line', index: number): string | null =>
      resolvers.resolveStyleMatrixReference(kind, index)?.localName ?? null;
    expect(resolved('fill', 1)).toBe('solidFill');
    expect(resolved('fill', 16)).toBe('solidFill');
    expect(resolved('fill', 17)).toBeNull();
    expect(resolved('fill', 1001)).toBe('gradFill');
    expect(resolved('fill', 1016)).toBe('gradFill');
    expect(resolved('fill', 1017)).toBeNull();
    expect(resolved('line', 16)).toBe('ln');
    expect(resolved('line', 17)).toBeNull();
    // A line index never selects the background list, however large it is.
    expect(resolved('line', 1001)).toBeNull();
  });

  test('a shape style fill reference resolves its theme colour', () => {
    const drawing = doubleRuleShapeDrawing()
      .replace('<a:solidFill><a:srgbClr val="000000"/></a:solidFill>', '')
      .replace(
        '</wps:spPr>',
        '</wps:spPr><wps:style><a:fillRef idx="1">' +
          '<a:schemeClr val="accent1"/>' +
          '</a:fillRef></wps:style>'
      );
    const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
    const matrix = readOoxmlPart(
      `<a:solidFill xmlns:a="${A}"><a:schemeClr val="phClr"/></a:solidFill>`,
      { name: '/word/theme/test.xml', contentType: 'application/xml' }
    );
    if (!matrix.ok) throw new Error(matrix.reason);
    const atoms = indexInlineDrawingProjectionsInPart(part, {
      resolveSchemeColor: () => '4472C4',
      resolveStyleMatrixReference: () => matrix.part.root,
    });
    expect([...atoms.values()][0]!.vectorShape?.fillHex).toBe('4472C4');
  });

  test('explicit noFill does not fall through to a style fill reference', () => {
    const drawing = doubleRuleShapeDrawing()
      .replace('<a:solidFill><a:srgbClr val="000000"/></a:solidFill>', '<a:noFill/>')
      .replace(
        '</wps:spPr>',
        '</wps:spPr><wps:style><a:fillRef idx="1">' +
          '<a:schemeClr val="accent1"/>' +
          '</a:fillRef></wps:style>'
      );
    const matrix = readOoxmlPart(
      `<a:solidFill xmlns:a="${A}"><a:schemeClr val="phClr"/></a:solidFill>`,
      { name: '/word/theme/test.xml', contentType: 'application/xml' }
    );
    if (!matrix.ok) throw new Error(matrix.reason);
    const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
    const projection = [
      ...indexInlineDrawingProjectionsInPart(part, {
        resolveSchemeColor: () => '4472C4',
        resolveStyleMatrixReference: () => matrix.part.root,
      }).values(),
    ][0]!;
    // It paints nothing, and keeps its box with no placeholder, as a shape with no paint does.
    expect(projection.vectorShape?.components).toEqual([]);
  });

  test('a line style reference paints without a direct line node', () => {
    const drawing = doubleRuleShapeDrawing().replace(
      '</wps:spPr>',
      '</wps:spPr><wps:style><a:lnRef idx="1">' +
        '<a:schemeClr val="accent1"/>' +
        '</a:lnRef></wps:style>'
    );
    const matrix = readOoxmlPart(
      `<a:ln xmlns:a="${A}" w="25400">` +
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
        '</a:ln>',
      { name: '/word/theme/test.xml', contentType: 'application/xml' }
    );
    if (!matrix.ok) throw new Error(matrix.reason);
    const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
    const shape = [
      ...indexInlineDrawingProjectionsInPart(part, {
        resolveSchemeColor: () => '4472C4',
        resolveStyleMatrixReference: () => matrix.part.root,
      }).values(),
    ][0]!.vectorShape!;
    expect(shape.strokeHex).toBe('4472C4');
    expect(shape.strokeWidthEmu).toBe(25_400);
    expect(shape.components[0]!.strokeInset).toBeUndefined();

    // An inset theme line marks the outline inset.
    const insetMatrix = readOoxmlPart(
      `<a:ln xmlns:a="${A}" w="25400" algn="in">` +
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
        '</a:ln>',
      { name: '/word/theme/test.xml', contentType: 'application/xml' }
    );
    if (!insetMatrix.ok) throw new Error(insetMatrix.reason);
    const inset = [
      ...indexInlineDrawingProjectionsInPart(part, {
        resolveSchemeColor: () => '4472C4',
        resolveStyleMatrixReference: () => insetMatrix.part.root,
      }).values(),
    ][0]!.vectorShape!;
    expect(inset.components[0]!.strokeInset).toBe(true);

    // A direct line with its own fill still inherits the theme line's alignment.
    const ownFill = parsePart(
      `<w:p><w:r>${drawing.replace(
        '</wps:spPr>',
        '<a:ln><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></wps:spPr>'
      )}</w:r></w:p>`
    );
    const inherited = [
      ...indexInlineDrawingProjectionsInPart(ownFill, {
        resolveSchemeColor: () => '4472C4',
        resolveStyleMatrixReference: () => insetMatrix.part.root,
      }).values(),
    ][0]!.vectorShape!;
    expect(inherited.strokeHex).toBe('FF0000');
    expect(inherited.components[0]!.strokeInset).toBe(true);
    // The width inherits the same way: the direct line names none, so the theme's applies.
    expect(inherited.strokeWidthEmu).toBe(25_400);
    // And the theme line keeps its attributes when its colour cannot resolve.
    const unresolved = [
      ...indexInlineDrawingProjectionsInPart(ownFill, {
        resolveStyleMatrixReference: () => insetMatrix.part.root,
      }).values(),
    ][0]!.vectorShape!;
    expect(unresolved.strokeHex).toBe('FF0000');
    expect(unresolved.strokeWidthEmu).toBe(25_400);
    expect(unresolved.components[0]!.strokeInset).toBe(true);
    // A theme entry that is not a line carries no line attributes.
    const notLine = readOoxmlPart(
      `<a:solidFill xmlns:a="${A}" w="254000" algn="in"><a:schemeClr val="phClr"/></a:solidFill>`,
      { name: '/word/theme/test.xml', contentType: 'application/xml' }
    );
    if (!notLine.ok) throw new Error(notLine.reason);
    const odd = [
      ...indexInlineDrawingProjectionsInPart(ownFill, {
        resolveSchemeColor: () => '4472C4',
        resolveStyleMatrixReference: () => notLine.part.root,
      }).values(),
    ][0]!.vectorShape!;
    expect(odd.strokeWidthEmu).toBe(12_700);
    expect(odd.components[0]!.strokeInset).toBeUndefined();
  });

  test('an out-of-range colour transform refuses the vector payload', () => {
    const drawing = doubleRuleShapeDrawing().replace(
      '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>',
      '<a:solidFill><a:schemeClr val="accent1">' +
        '<a:alphaOff val="150000"/>' +
        '</a:schemeClr></a:solidFill>'
    );
    const part = parsePart(`<w:p><w:r>${mcWrapped(drawing)}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part, {
      resolveSchemeColor: () => '4472C4',
    });
    // Unsupported geometry keeps a visible placeholder with the authored extent.
    expect([...atoms.values()].map((atom) => [atom.footprintOnly, atom.vectorShape])).toEqual([
      [undefined, null],
    ]);
  });

  test('an MC wpg group projects each child with its own geometry and colour', () => {
    const drawing = groupShapeDrawing();
    const wrapped =
      '<mc:AlternateContent><mc:Choice Requires="wpg">' +
      drawing +
      '</mc:Choice><mc:Fallback><w:pict><v:shape id="fallback"/></w:pict></mc:Fallback>' +
      '</mc:AlternateContent>';
    const directPart = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
    expect(
      indexInlineDrawingProjectionsInPart(directPart, {
        resolveSchemeColor: () => '4472C4',
      }).size
    ).toBe(1);
    const part = parsePart(`<w:p><w:r>${wrapped}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part, {
      resolveSchemeColor: () => '4472C4',
    });
    expect(atoms.size).toBe(1);
    const shape = [...atoms.values()][0]!.vectorShape!;
    expect(shape.components).toHaveLength(2);
    expect(shape.components?.map((component) => component.fillHex)).toEqual(['4472C4', 'FF0000']);
    // The ellipse flattens adaptively from the geometry engine.
    expect(shape.components?.[0]!.subpathsEmu[0]!.length).toBeGreaterThanOrEqual(8);
    expect(shape.components?.[1]!.subpathsEmu[0]![0]).toEqual({ x: 100000, y: 0 });

    // A turned group paints turned (see drawing-turned-group-projection.test.ts).
    const rotated = parsePart(
      `<w:p><w:r>${drawing.replace('<a:xfrm><a:chOff', '<a:xfrm rot="60000"><a:chOff')}</w:r></w:p>`
    );
    expect(
      [
        ...indexInlineDrawingProjectionsInPart(rotated, {
          resolveSchemeColor: () => '4472C4',
        }).values(),
      ][0]!.vectorShape?.rotationDegrees
    ).toBe(1);

    const childFlipped = parsePart(
      `<w:p><w:r>${drawing.replace(
        '<wps:wsp><wps:spPr><a:xfrm>',
        '<wps:wsp><wps:spPr><a:xfrm flipH="true">'
      )}</w:r></w:p>`
    );
    expect(
      [
        ...indexInlineDrawingProjectionsInPart(childFlipped, {
          resolveSchemeColor: () => '4472C4',
        }).values(),
      ][0]!.vectorShape
    ).not.toBeNull();

    const withMetadata = parsePart(
      `<w:p><w:r>${drawing.replace('<wpg:wgp>', '<wpg:wgp><wpg:cNvPr id="1"/>')}</w:r></w:p>`
    );
    expect(
      [
        ...indexInlineDrawingProjectionsInPart(withMetadata, {
          resolveSchemeColor: () => '4472C4',
        }).values(),
      ][0]!.vectorShape
    ).not.toBeNull();

    const nested = parsePart(
      `<w:p><w:r>${drawing.replace('</wpg:wgp>', '<wpg:grpSp/></wpg:wgp>')}</w:r></w:p>`
    );
    expect(
      [
        ...indexInlineDrawingProjectionsInPart(nested, {
          resolveSchemeColor: () => '4472C4',
        }).values(),
      ][0]!.vectorShape
    ).toBeNull();
  });

  test('an MC-wrapped wps textbox projects a story; the VML fallback never renders', () => {
    const drawing =
      '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="914400" cy="457200"/><wp:docPr id="9" name="TextBox 9"/>' +
      '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
      '<wps:wsp><wps:spPr><a:xfrm><a:ext cx="914400" cy="457200"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></wps:spPr>' +
      '<wps:txbx><w:txbxContent><w:p><w:r><w:t>boxed</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
      '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>';
    const part = parsePart(`<w:p><w:r>${mcWrapped(drawing)}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part);
    // ONE projection: the wps Choice branch carries the story; the VML fallback is not a
    // second drawing, so nothing double-renders.
    expect(atoms.size).toBe(1);
    const projection = [...atoms.values()][0]!;
    expect(projection.picture).toBeNull();
    expect(projection.vectorShape).toBeNull();
    const story = projection.textboxStory;
    expect(story).not.toBeNull();
    expect(story!.fillHex).toBe('FF0000');
    expect(story!.verticalAnchor).toBe('top');
    // Empty bodyPr means the OOXML inset defaults, not zero.
    expect(story!.insetsEmu).toEqual({ top: 45_720, right: 91_440, bottom: 45_720, left: 91_440 });

    // A text box outline with its own fill but no width takes the theme line's width.
    const theme = readOoxmlPart(
      `<a:ln xmlns:a="${A}" w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`,
      { name: '/word/theme/test.xml', contentType: 'application/xml' }
    );
    if (!theme.ok) throw new Error(theme.reason);
    const outlined = parsePart(
      `<w:p><w:r>${drawing
        .replace(
          '</wps:spPr>',
          '<a:ln><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln></wps:spPr>'
        )
        .replace(
          '<wps:bodyPr/>',
          '<wps:style><a:lnRef idx="1"/></wps:style><wps:bodyPr/>'
        )}</w:r></w:p>`
    );
    const box = [
      ...indexInlineDrawingProjectionsInPart(outlined, {
        resolveStyleMatrixReference: () => theme.part.root,
      }).values(),
    ][0]!.textboxStory!;
    expect(box.strokeHex).toBe('0000FF');
    expect(box.strokeWidthEmu).toBe(6350);
  });

  test('a wps txbx without txbxContent projects no story and keeps the placeholder path', () => {
    const drawing =
      '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="914400" cy="457200"/><wp:docPr id="11" name="TextBox 11"/>' +
      '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
      '<wps:wsp><wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
      '<wps:txbx></wps:txbx>' +
      '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>';
    const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part);
    expect(atoms.size).toBe(1);
    const projection = [...atoms.values()][0]!;
    expect(projection.textboxStory).toBeNull();
    expect(projection.picture).toBeNull();
    expect(projection.diagnostics.filter((d) => d.code === 'unsupported-graphic')).toHaveLength(1);
  });

  test('an MC-wrapped inline chart without a fallback that paints keeps its placeholder', () => {
    const drawing =
      '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="914400" cy="457200"/><wp:docPr id="10" name="Chart 10"/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
      '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>' +
      '</a:graphicData></a:graphic></wp:inline></w:drawing>';
    const part = parsePart(`<w:p><w:r>${mcWrapped(drawing)}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part);
    // A chart never paints nothing: it keeps its labelled placeholder at its extent.
    expect([...atoms.values()].map((atom) => [atom.footprintOnly, atom.extentEmu])).toEqual([
      [undefined, { cx: 914400, cy: 457200 }],
    ]);
    expect(projectDrawingsInPart(part)).toHaveLength(1);
    const [projection] = projectDrawingsInPart(part);
    expect(projection?.picture).toBeNull();
    expect(drawingPaintFields(projection!).placeholderGraphicKind).toBe('chart');
  });

  test('unsupported path verbs refuse vector geometry and keep a placeholder under MC', () => {
    const bezier = doubleRuleShapeDrawing().replace(
      '<a:lnTo><a:pt x="0" y="38100"/></a:lnTo>',
      '<a:spiralTo><a:pt x="1" y="1"/><a:pt x="0" y="38100"/></a:spiralTo>'
    );
    const part = parsePart(`<w:p><w:r>${mcWrapped(bezier)}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part);
    // Unsupported geometry keeps a visible placeholder with the authored extent.
    expect([...atoms.values()].map((atom) => [atom.footprintOnly, atom.vectorShape])).toEqual([
      [undefined, null],
    ]);
  });

  test('limits are respected', () => {
    expect(DEFAULT_DRAWING_PROJECTION_LIMITS.maxVisitedElements).toBeGreaterThan(0);
  });

  test('an over-limit group does not project unbounded child geometry', () => {
    const child =
      '<wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      '<a:solidFill><a:srgbClr val="000000"/></a:solidFill></wps:spPr></wps:wsp>';
    const drawing =
      '<w:drawing><wp:inline><wp:extent cx="100" cy="100"/><wp:docPr id="14" name="Group"/>' +
      `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:grpSpPr>` +
      '<a:xfrm><a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/></a:xfrm>' +
      `</wpg:grpSpPr>${child.repeat(129)}</wpg:wgp></a:graphicData></a:graphic>` +
      '</wp:inline></w:drawing>';
    const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
    const projection = [...indexInlineDrawingProjectionsInPart(part).values()][0]!;
    expect(projection.vectorShape).toBeNull();
  });

  test('a drawing deep in a large document is still discovered', () => {
    // Real documents easily exceed the per-drawing walk budget in TOTAL element count;
    // the part scan must not silently stop before reaching a late drawing.
    const filler = '<w:p><w:r><w:t>x</w:t></w:r></w:p>'.repeat(3000);
    const part = parsePart(`${filler}<w:p><w:r>${mcWrapped(doubleRuleShapeDrawing())}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part);
    expect(atoms.size).toBe(1);
  });
});
