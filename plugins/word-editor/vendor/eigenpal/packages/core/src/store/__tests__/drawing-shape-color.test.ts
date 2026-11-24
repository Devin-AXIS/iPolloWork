// DrawingML colours (ECMA-376 Part 1, 20.1.2.3): the six colour models, and every colour
// transform, bounded and exact under identity.

import { describe, expect, test } from 'bun:test';
import { resolveColorNode } from '../package/drawing-shape-color.ts';
import { readOoxmlPart, type OoxmlElement } from '../package/ooxml-tree.ts';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function color(xml: string): OoxmlElement {
  const parsed = readOoxmlPart(xml.replace(/^<a:(\w+)/, `<a:$1 xmlns:a="${A}"`), {
    name: '/word/test.xml',
    contentType: 'application/xml',
  });
  if (!parsed.ok) throw new Error('parse failed');
  return parsed.part.root;
}

function resolve(xml: string) {
  return resolveColorNode(color(xml), (token) => (token === 'accent1' ? '4F81BD' : null));
}

function srgb(hex: string, transforms: string) {
  return resolve(`<a:srgbClr val="${hex}">${transforms}</a:srgbClr>`);
}

describe('shape colour bases', () => {
  test('scrgbClr converts linear percentages through the sRGB transfer curve', () => {
    expect(resolve('<a:scrgbClr r="100000" g="0" b="50000"/>')).toEqual({
      hex: 'FF00BC',
      alpha: 1,
    });
    expect(resolve('<a:scrgbClr r="0" g="0" b="0"/>')).toEqual({ hex: '000000', alpha: 1 });
    expect(resolve('<a:scrgbClr r="0" g="0"/>')).toBeNull();
  });

  test('sysClr keeps its last colour, else the system default', () => {
    expect(resolve('<a:sysClr val="windowText" lastClr="123456"/>')?.hex).toBe('123456');
    expect(resolve('<a:sysClr val="windowText"/>')?.hex).toBe('000000');
    expect(resolve('<a:sysClr val="window"/>')?.hex).toBe('FFFFFF');
    expect(resolve('<a:sysClr val="notASystemColour"/>')).toBeNull();
  });

  test('scheme colours resolve through the resolver; unknown ones refuse', () => {
    expect(resolve('<a:schemeClr val="accent1"/>')?.hex).toBe('4F81BD');
    expect(resolve('<a:schemeClr val="accent6"/>')).toBeNull();
    expect(resolve('<a:prstClr val="red"/>')?.hex).toBe('FF0000');
    expect(resolve('<a:prstClr val="notAColour"/>')).toBeNull();
  });
});

describe('signed colour transforms', () => {
  test('hue offsets and modulation turn the hue', () => {
    expect(srgb('FF0000', '<a:hueOff val="7200000"/>')?.hex).toBe('00FF00');
    expect(srgb('00FF00', '<a:hueMod val="200000"/>')?.hex).toBe('0000FF');
  });

  test('saturation offsets and modulation', () => {
    expect(srgb('FF0000', '<a:satOff val="-100000"/>')?.hex).toBe('808080');
    expect(srgb('FF0000', '<a:satMod val="50000"/>')?.hex).toBe('BF4040');
  });

  test('luminance offsets work in both directions', () => {
    expect(srgb('FF0000', '<a:lumOff val="-25000"/>')?.hex).toBe('800000');
    expect(srgb('FF0000', '<a:lumOff val="25000"/>')?.hex).toBe('FF8080');
  });

  test('alpha offsets and modulation', () => {
    expect(srgb('000000', '<a:alpha val="50000"/><a:alphaOff val="25000"/>')?.alpha).toBeCloseTo(
      0.75,
      9
    );
    expect(srgb('000000', '<a:alphaMod val="50000"/>')?.alpha).toBeCloseTo(0.5, 9);
    expect(srgb('000000', '<a:alphaOff val="-100000"/>')?.alpha).toBe(0);
  });

  test('identity offsets leave the colour exactly as authored', () => {
    const identity =
      '<a:hueOff val="0"/><a:satOff val="0"/><a:lumOff val="0"/><a:alphaOff val="0"/>' +
      '<a:satMod val="100000"/><a:hueMod val="100000"/><a:alphaMod val="100000"/>';
    for (const hex of ['4F81BD', '1F3864', 'C0504D', '7F7F7F']) {
      expect(srgb(hex, identity)).toEqual({ hex, alpha: 1 });
    }
    expect(resolve(`<a:schemeClr val="accent1">${identity}</a:schemeClr>`)?.hex).toBe('4F81BD');
  });

  test('the Strict percentage spelling matches the integer one', () => {
    expect(srgb('FF0000', '<a:lumOff val="-25%"/>')?.hex).toBe('800000');
    expect(srgb('FF0000', '<a:satMod val="50%"/>')?.hex).toBe('BF4040');
  });

  test('malformed values, or values outside their schema type, refuse the colour', () => {
    // Not an `xsd:int`.
    expect(srgb('FF0000', '<a:hueOff val="99999999999"/>')).toBeNull();
    expect(srgb('FF0000', '<a:lumOff val="2147483648"/>')).toBeNull();
    expect(srgb('FF0000', '<a:satOff val="abc"/>')).toBeNull();
    expect(srgb('FF0000', '<a:satOff/>')).toBeNull();
    expect(srgb('FF0000', '<a:lumOff val="1e5"/>')).toBeNull();
    expect(srgb('FF0000', '<a:red val="1e5"/>')).toBeNull();
    // `ST_Angle` and `ST_PositiveFixedAngle` have no percentage literal.
    expect(srgb('FF0000', '<a:hueOff val="10%"/>')).toBeNull();
    expect(srgb('FF0000', '<a:hue val="10%"/>')).toBeNull();
    // `ST_PositiveFixedAngle` is 0 up to but not including 21600000.
    expect(srgb('FF0000', '<a:hue val="21600000"/>')).toBeNull();
    expect(srgb('FF0000', '<a:hue val="-60000"/>')).toBeNull();
    // `ST_PositivePercentage` has no negative value.
    expect(srgb('000000', '<a:alphaMod val="-50000"/>')).toBeNull();
    expect(srgb('FF0000', '<a:hueMod val="-50%"/>')).toBeNull();
    // `ST_FixedPercentage` is -100% to 100%.
    expect(srgb('000000', '<a:alphaOff val="-150000"/>')).toBeNull();
    expect(srgb('000000', '<a:alphaOff val="100.5%"/>')).toBeNull();
    // The percentage pattern has no `+`.
    expect(srgb('FF0000', '<a:satMod val="+50%"/>')).toBeNull();
    expect(srgb('FF0000', '<a:shade val="-50000"/>')).toBeNull();
    expect(srgb('FF0000', '<a:notATransform/>')).toBeNull();
  });

  test('legal values at the edge of their type resolve', () => {
    // An `ST_Angle` can exceed one turn, and the hue wraps.
    expect(srgb('FF0000', '<a:hueOff val="43200000"/>')?.hex).toBe('FF0000');
    expect(srgb('FF0000', '<a:hueOff val="-14400000"/>')?.hex).toBe('00FF00');
    // An `ST_Percentage` has no upper bound; the component clamps.
    expect(srgb('FF0000', '<a:lumOff val="20000000"/>')?.hex).toBe('FFFFFF');
    expect(srgb('FF0000', '<a:lum val="20000000"/>')?.hex).toBe('FFFFFF');
    // Leading zeros and a leading `+` are legal on an `xsd:int`.
    expect(srgb('FF0000', '<a:satMod val="0050000"/>')?.hex).toBe('BF4040');
    expect(srgb('FF0000', '<a:satMod val="+50000"/>')?.hex).toBe('BF4040');
    // The percentage pattern allows any number of fraction digits.
    expect(srgb('FF0000', '<a:satMod val="50.0000%"/>')?.hex).toBe('BF4040');
  });
});

describe('placeholder and scRGB bases', () => {
  test('phClr keeps the placeholder alpha, and transforms apply after it', () => {
    const placeholder = { hex: 'ED7D31', alpha: 0.5 };
    expect(
      resolveColorNode(
        color(
          '<a:schemeClr val="phClr"><a:shade val="50000"/><a:alphaMod val="50000"/></a:schemeClr>'
        ),
        undefined,
        placeholder
      )
    ).toEqual({ hex: 'AE5A21', alpha: 0.25 });
  });

  test('an scrgbClr base stays unrounded until the end of the chain', () => {
    // `r="1000"` is sRGB 25.46. Rounding the base to 25 first would give `0F0000`.
    expect(
      resolve('<a:scrgbClr r="1000" g="0" b="0"><a:shade val="50000"/></a:scrgbClr>')?.hex
    ).toBe('100000');
  });
});

describe('hslClr', () => {
  test('reads hue, saturation and luminance, in both spellings', () => {
    expect(resolve('<a:hslClr hue="0" sat="100000" lum="50000"/>')).toEqual({
      hex: 'FF0000',
      alpha: 1,
    });
    expect(resolve('<a:hslClr hue="14400000" sat="100%" lum="25%"/>')?.hex).toBe('000080');
    // `sat` and `lum` are `ST_Percentage` values, so they clamp to 0..1.
    expect(resolve('<a:hslClr hue="0" sat="250000" lum="-10000"/>')?.hex).toBe('000000');
  });

  test('transforms apply to an hslClr base', () => {
    expect(resolve('<a:hslClr hue="0" sat="100000" lum="50000"><a:comp/></a:hslClr>')?.hex).toBe(
      '00FFFF'
    );
  });

  test('a missing or malformed attribute refuses the colour', () => {
    expect(resolve('<a:hslClr sat="100000" lum="50000"/>')).toBeNull();
    expect(resolve('<a:hslClr hue="21600000" sat="100000" lum="50000"/>')).toBeNull();
    expect(resolve('<a:hslClr hue="0" sat="abc" lum="50000"/>')).toBeNull();
  });
});

describe('linear-light transforms', () => {
  test('shade and tint blend in linear light through the sRGB curve, rounding once', () => {
    expect(srgb('ED7D31', '<a:shade val="50000"/>')?.hex).toBe('AE5A21');
    expect(srgb('4F81BD', '<a:shade val="50000"/>')?.hex).toBe('385D8A');
    expect(srgb('4472C4', '<a:shade val="50000"/>')?.hex).toBe('2F528F');
    expect(srgb('5B9BD5', '<a:shade val="50000"/>')?.hex).toBe('41719C');
    expect(srgb('00FF00', '<a:shade val="50%"/>')?.hex).toBe('00BC00');
    expect(srgb('0000FF', '<a:tint val="20000"/>')?.hex).toBe('E7E7FF');
  });

  test('a chain rounds once, at the end', () => {
    // Rounding to a byte after each step would give `1E0A01`.
    expect(srgb('ED7D31', '<a:shade val="10000"/><a:shade val="15000"/>')?.hex).toBe('1E0A02');
  });

  test('tint, shade and alpha accept a leading plus sign on the integer', () => {
    expect(srgb('ED7D31', '<a:shade val="+50000"/>')?.hex).toBe('AE5A21');
    expect(srgb('0000FF', '<a:tint val="+20000"/>')?.hex).toBe('E7E7FF');
    expect(srgb('000000', '<a:alpha val="+50000"/>')?.alpha).toBe(0.5);
  });

  test('inv inverts each linear-light component', () => {
    expect(srgb('4472C4', '<a:inv/>')?.hex).toBe('F8EBB3');
    expect(srgb('000000', '<a:inv/>')?.hex).toBe('FFFFFF');
    expect(srgb('4472C4', '<a:inv/><a:inv/>')?.hex).toBe('4472C4');
  });

  test('red, green and blue set, scale and offset one linear-light component', () => {
    expect(srgb('808080', '<a:red val="100000"/>')?.hex).toBe('FF8080');
    expect(srgb('808080', '<a:redMod val="50000"/>')?.hex).toBe('5C8080');
    expect(srgb('808080', '<a:greenOff val="10000"/>')?.hex).toBe('809880');
    expect(srgb('808080', '<a:blue val="0"/>')?.hex).toBe('808000');
    expect(srgb('808080', '<a:greenMod val="500000"/>')?.hex).toBe('80FF80');
    expect(srgb('808080', '<a:blueOff val="-100%"/>')?.hex).toBe('808000');
  });

  test('gamma and invGamma apply the sRGB curve and its inverse', () => {
    expect(srgb('808080', '<a:gamma/>')?.hex).toBe('BCBCBC');
    expect(srgb('808080', '<a:invGamma/>')?.hex).toBe('373737');
    expect(srgb('808080', '<a:invGamma/><a:gamma/>')?.hex).toBe('808080');
  });
});

describe('HSL and grayscale transforms', () => {
  test('gray weights the sRGB components by the Rec. 709 primaries', () => {
    expect(srgb('ED7D31', '<a:gray/>')?.hex).toBe('8F8F8F');
    expect(srgb('FFFFFF', '<a:gray/>')?.hex).toBe('FFFFFF');
  });

  test('comp turns the hue by 180 degrees', () => {
    expect(srgb('FF0000', '<a:comp/>')?.hex).toBe('00FFFF');
    expect(srgb('808080', '<a:comp/>')?.hex).toBe('808080');
  });

  test('hue, sat and lum set one HSL component', () => {
    expect(srgb('FF0000', '<a:hue val="7200000"/>')?.hex).toBe('00FF00');
    expect(srgb('FF0000', '<a:sat val="0"/>')?.hex).toBe('808080');
    expect(srgb('FF0000', '<a:lum val="25000"/>')?.hex).toBe('800000');
    expect(srgb('FF0000', '<a:lum val="25%"/>')?.hex).toBe('800000');
  });
});
